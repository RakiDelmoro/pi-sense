use crate::config::Config;
use crate::agent::Agent;
use crate::mqtt::{MqttManager, SensorReading};
use crate::storage::Db;
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
    pub db: Arc<Db>,
    pub mqtt: Arc<MqttManager>,
    pub agent: Arc<tokio::sync::Mutex<Agent>>,
    pub dashboard_tx: broadcast::Sender<DashboardMessage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum DashboardMessage {
    #[serde(rename = "state:full")]
    StateFull { sensors: Vec<crate::storage::Sensor> },
    #[serde(rename = "widget:add")]
    WidgetAdd { sensor: crate::storage::Sensor },
    #[serde(rename = "widget:remove")]
    WidgetRemove { id: String },
    #[serde(rename = "widget:update")]
    WidgetUpdate { sensor: crate::storage::Sensor },
    #[serde(rename = "value:update")]
    ValueUpdate { sensor_id: String, value: String, timestamp: i64, alert: bool },
    #[serde(rename = "history:data")]
    HistoryData { sensor_id: String, readings: Vec<crate::storage::SensorReadingRecord> },
}

pub async fn serve(config: Config) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db = Arc::new(Db::open(&config.db_path)?);
    let mqtt = Arc::new(MqttManager::new(config.mqtt.client_id.clone()));
    let (dashboard_tx, _) = broadcast::channel::<DashboardMessage>(256);

    let agent = Agent::new(config.clone(), db.clone(), mqtt.clone(), dashboard_tx.clone());
    let agent = Arc::new(tokio::sync::Mutex::new(agent));

    let state = AppState {
        db: db.clone(),
        mqtt: mqtt.clone(),
        agent: agent.clone(),
        dashboard_tx: dashboard_tx.clone(),
    };

    let mqtt_rx = mqtt.subscribe_rx();
    let dashboard_tx_clone = dashboard_tx.clone();
    let db_clone = db.clone();
    tokio::spawn(mqtt_to_dashboard(mqtt_rx, dashboard_tx_clone, db_clone));

    restore_mqtt_subscriptions(&db, &mqtt).await;

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
    db: Arc<Db>,
) {
    loop {
        match rx.recv().await {
            Ok(reading) => {
                let sensor_id = reading.sensor_id.clone();
                let timestamp = reading.timestamp;

                // Get sensor config from DB for transform/alert settings
                let sensor = match db.get_sensor(&sensor_id) {
                    Ok(Some(s)) => s,
                    Ok(None) => {
                        log::warn!("sensor not found for id: {}", sensor_id);
                        continue;
                    }
                    Err(e) => {
                        log::warn!("db error getting sensor: {}", e);
                        continue;
                    }
                };

                // Apply value transformation
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
                    v < sensor.alert_min || v > sensor.alert_max
                } else {
                    false
                };

                // Store reading in DB for history
                if let Err(e) = db.insert_reading(&sensor_id, &display_value, timestamp) {
                    log::warn!("failed to store reading: {}", e);
                }

                // Prune old readings
                if let Err(e) = db.prune_readings(&sensor_id, sensor.chart_max_points as i64) {
                    log::warn!("failed to prune readings: {}", e);
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

async fn restore_mqtt_subscriptions(db: &Arc<Db>, mqtt: &Arc<MqttManager>) {
    match db.list_sensors() {
        Ok(sensors) => {
            for s in &sensors {
                if let Err(e) = mqtt.subscribe(s.id.clone(), s.topic.clone(), s.broker.clone(), s.broker_port).await {
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

    if let Ok(sensors) = state.db.list_sensors() {
        let msg = DashboardMessage::StateFull { sensors: sensors.clone() };
        let json = serde_json::to_string(&msg).unwrap_or_default();
        let _ = socket.send(Message::Text(json.into())).await;

        for sensor in &sensors {
            if sensor.widget_type == "chart" {
                if let Ok(readings) = state.db.get_readings(&sensor.id, sensor.chart_max_points as i64) {
                    if !readings.is_empty() {
                        let hist_msg = DashboardMessage::HistoryData {
                            sensor_id: sensor.id.clone(),
                            readings,
                        };
                        let json = serde_json::to_string(&hist_msg).unwrap_or_default();
                        let _ = socket.send(Message::Text(json.into())).await;
                    }
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

        let sensor = match state.db.get_sensor(sensor_id) {
            Ok(Some(s)) => s,
            Ok(None) => return Err(format!("sensor not found: {}", sensor_id)),
            Err(e) => return Err(format!("db error: {}", e)),
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
            sensor_id: sensor.id.clone(),
            value: value.to_string(),
            timestamp,
            alert: false,
        });

        log::info!("WS published '{}' to {}", payload, publish_topic);
    }

    Ok(())
}