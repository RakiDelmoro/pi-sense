use crate::config::Config;
use crate::agent::Agent;
use crate::mqtt::{MqttManager, SensorReading};
use crate::store::Store;
use crate::storage::ReadingDb;
use crate::transform;
use axum::{
    Router,
    extract::{State, WebSocketUpgrade, ws::{Message, WebSocket}},
    response::IntoResponse,
    routing::get,
};
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::broadcast;

pub mod ws;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<Store>,
    pub reading_db: Arc<ReadingDb>,
    pub mqtt: Arc<MqttManager>,
    #[allow(dead_code)]
    pub agent: Arc<tokio::sync::Mutex<Agent>>,
    pub dashboard_tx: broadcast::Sender<DashboardMessage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum DashboardMessage {
    #[serde(rename = "state:full")]
    StateFull { sensors: Vec<crate::store::Sensor> },
    #[serde(rename = "widget:add")]
    WidgetAdd { sensor: crate::store::Sensor },
    #[serde(rename = "widget:remove")]
    WidgetRemove { id: String },
    #[serde(rename = "widget:update")]
    WidgetUpdate { sensor: crate::store::Sensor },
    #[serde(rename = "value:update")]
    ValueUpdate { sensor_id: String, value: String, timestamp: i64, alert: bool },
    #[serde(rename = "history:data")]
    HistoryData { sensor_id: String, readings: Vec<crate::storage::SensorReadingRecord> },
}

pub async fn serve(
    config: Config,
    store: Arc<Store>,
    reading_db: Arc<ReadingDb>,
    mqtt: Arc<MqttManager>,
    dashboard_tx: broadcast::Sender<DashboardMessage>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let agent = Agent::new(config.clone(), store.clone(), mqtt.clone(), dashboard_tx.clone());
    let agent = Arc::new(tokio::sync::Mutex::new(agent));

    let state = AppState {
        store: store.clone(),
        reading_db: reading_db.clone(),
        mqtt: mqtt.clone(),
        agent: agent.clone(),
        dashboard_tx: dashboard_tx.clone(),
    };

    let mqtt_rx = mqtt.subscribe_rx();
    let dashboard_tx_clone = dashboard_tx.clone();
    let store_clone = store.clone();
    let reading_db_clone = reading_db.clone();
    tokio::spawn(mqtt_to_dashboard(mqtt_rx, dashboard_tx_clone, store_clone, reading_db_clone));

    restore_mqtt_subscriptions(&store, &mqtt).await;

    let app = Router::new()
        .route("/", get(serve_index))
        .route("/ws", get(ws_handler))
        .route("/dashboard.js", get(serve_dashboard_js))
        .route("/widgets.js", get(serve_widgets_js))
        .route("/style.css", get(serve_style_css))
        .with_state(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], config.server.port));
    log::info!("pi-sense web server on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn mqtt_to_dashboard(
    mut rx: broadcast::Receiver<SensorReading>,
    tx: broadcast::Sender<DashboardMessage>,
    store: Arc<Store>,
    reading_db: Arc<ReadingDb>,
) {
    loop {
        match rx.recv().await {
            Ok(reading) => {
                let sensor_id = reading.sensor_id.clone();
                let timestamp = reading.timestamp;

                let sensor = match store.get_sensor(&sensor_id).await {
                    Ok(Some(s)) => s,
                    Ok(None) => {
                        log::warn!("sensor not found for id: '{}'", sensor_id);
                        continue;
                    }
                    Err(e) => {
                        log::warn!("error looking up sensor '{}': {}", sensor_id, e);
                        continue;
                    }
                };

                let mut display_value = reading.value.clone();
                let mut numeric_value: Option<f64> = reading.value.parse().ok();

                if let Some(ref transform_expr) = sensor.value_transform {
                    if let Some(raw) = numeric_value {
                        if let Some(transformed) = transform::evaluate_transform(transform_expr, raw) {
                            display_value = format!("{:.1$}", transformed, sensor.display_precision as usize);
                            numeric_value = Some(transformed);
                        }
                    }
                }

                // Check alert thresholds
                let alert = if let Some(v) = numeric_value {
                    sensor.alert_min.map_or(false, |min| v < min) || sensor.alert_max.map_or(false, |max| v > max)
                } else {
                    false
                };

                if sensor.history_enabled {
                    if let Err(e) = reading_db.insert_reading(&sensor_id, &display_value, timestamp) {
                        log::warn!("failed to store reading for {}: {}", sensor_id, e);
                    }

                    if let Err(e) = reading_db.prune_readings_older_than(&sensor_id, sensor.history_retain_days) {
                        log::warn!("failed to prune readings: {}", e);
                    }
                }

                let msg = DashboardMessage::ValueUpdate {
                    sensor_id,
                    value: display_value,
                    timestamp,
                    alert,
                };
                let _ = tx.send(msg);
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                log::warn!("MQTT broadcast lagged by {n} messages");
            }
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
}

async fn restore_mqtt_subscriptions(store: &Arc<Store>, mqtt: &Arc<MqttManager>) {
    match store.list_sensors().await {
        Ok(sensors) => {
            for s in &sensors {
                if let Err(e) = mqtt.subscribe(s.name.clone(), s.topic.clone(), s.broker.clone(), s.broker_port).await {
                    log::warn!("failed to restore MQTT sub for {}: {e}", s.name);
                }
            }
            log::info!("restored {} sensor subscriptions", sensors.len());
        }
        Err(e) => log::error!("failed to load sensors for MQTT restore: {e}"),
    }
}

async fn serve_index() -> impl IntoResponse {
    ([("Content-Type", "text/html")], include_str!("../../web/index.html"))
}

async fn serve_dashboard_js() -> impl IntoResponse {
    ([("Content-Type", "application/javascript")], include_str!("../../web/dashboard.js"))
}

async fn serve_widgets_js() -> impl IntoResponse {
    ([("Content-Type", "application/javascript")], include_str!("../../web/widgets.js"))
}

async fn serve_style_css() -> impl IntoResponse {
    ([("Content-Type", "text/css")], include_str!("../../web/style.css"))
}

async fn ws_handler(ws: WebSocketUpgrade, state: State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: State<AppState>) {
    let mut rx = state.dashboard_tx.subscribe();

    if let Ok(sensors) = state.store.list_sensors().await {
        let msg = DashboardMessage::StateFull { sensors: sensors.clone() };
        let json = serde_json::to_string(&msg).unwrap_or_default();
        let _ = socket.send(Message::Text(json.into())).await;

        for sensor in &sensors {
            if sensor.history_chart {
                if let Ok(readings) = state.reading_db.get_readings(&sensor.name, 500) {
                    if !readings.is_empty() {
                        let hist_msg = DashboardMessage::HistoryData {
                            sensor_id: sensor.name.clone(),
                            readings,
                        };
                        let json = serde_json::to_string(&hist_msg).unwrap_or_default();
                        if !json.is_empty() {
                            let _ = socket.send(Message::Text(json.into())).await;
                        }
                    }
                }
            }

            if let Some(reading) = state.reading_db.get_latest_reading(&sensor.name) {
                let val_msg = DashboardMessage::ValueUpdate {
                    sensor_id: sensor.name.clone(),
                    value: reading.value,
                    timestamp: reading.timestamp,
                    alert: false,
                };
                let json = serde_json::to_string(&val_msg).unwrap_or_default();
                if !json.is_empty() {
                    let _ = socket.send(Message::Text(json.into())).await;
                }
            }
        }
    }

    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Ok(dash_msg) => {
                        let json = serde_json::to_string(&dash_msg).unwrap_or_default();
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Err(e) = handle_incoming_ws(&text, &state).await {
                            log::warn!("WS incoming error: {}", e);
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

async fn handle_incoming_ws(text: &str, state: &State<AppState>) -> Result<(), String> {
    let msg: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| format!("parse error: {}", e))?;

    let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

    if msg_type == "sensor:publish" {
        let sensor_id = msg.get("sensor_id").and_then(|v| v.as_str()).unwrap_or("");
        let value = msg.get("value").and_then(|v| v.as_str()).unwrap_or("");

        if sensor_id.is_empty() || value.is_empty() {
            return Err("sensor:publish missing sensor_id or value".into());
        }

        let sensor = match state.store.get_sensor(sensor_id).await {
            Ok(Some(s)) => s,
            Ok(None) => return Err(format!("sensor not found: {}", sensor_id)),
            Err(e) => return Err(format!("error looking up sensor: {}", e)),
        };

        if !sensor.allow_publish {
            return Err(format!("sensor {} does not allow publishing", sensor_id));
        }

        let publish_topic = match sensor.publish_topic {
            Some(t) => t,
            None => return Err(format!("sensor {} has no publish_topic", sensor_id)),
        };

        let payload = if value == "1" || value.to_lowercase() == "on" || value.to_lowercase() == "true" {
            sensor.publish_payload_on.clone()
        } else {
            sensor.publish_payload_off.clone()
        };

        state.mqtt.publish(
            publish_topic.clone(),
            sensor.broker.clone(),
            sensor.broker_port,
            payload.clone()
        ).await.map_err(|e| format!("publish failed: {}", e))?;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let _ = state.dashboard_tx.send(DashboardMessage::ValueUpdate {
            sensor_id: sensor.name.clone(),
            value: value.to_string(),
            timestamp,
            alert: false,
        });

        log::info!("WS published '{}' to {}", payload, publish_topic);
    }

    if msg_type == "history:request" {
        let sensor_id = msg.get("sensor_id").and_then(|v| v.as_str()).unwrap_or("");
        if sensor_id.is_empty() {
            return Err("history:request missing sensor_id".into());
        }

        let sensor = match state.store.get_sensor(sensor_id).await {
            Ok(Some(s)) => s,
            Ok(None) => return Err(format!("sensor not found: {}", sensor_id)),
            Err(e) => return Err(format!("error looking up sensor: {}", e)),
        };

        if !sensor.history_enabled {
            return Err(format!("sensor {} has history disabled", sensor_id));
        }

        match state.reading_db.get_readings(&sensor.name, 500) {
            Ok(readings) => {
                let _ = state.dashboard_tx.send(DashboardMessage::HistoryData {
                    sensor_id: sensor.name.clone(),
                    readings,
                });
            }
            Err(e) => {
                log::error!("history:request DB error for '{}': {}", sensor.name, e);
                return Err(format!("failed to read history: {}", e));
            }
        }
    }

    Ok(())
}