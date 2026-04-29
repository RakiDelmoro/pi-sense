use crate::config::Config;
use crate::agent::Agent;
use crate::mqtt::{MqttManager, SensorReading};
use crate::storage::Db;
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
    #[serde(rename = "value:update")]
    ValueUpdate { sensor_id: String, value: String, timestamp: i64 },
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
    tokio::spawn(mqtt_to_dashboard(mqtt_rx, dashboard_tx_clone));

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
) {
    loop {
        match rx.recv().await {
            Ok(reading) => {
                let msg = DashboardMessage::ValueUpdate {
                    sensor_id: reading.sensor_id,
                    value: reading.value,
                    timestamp: reading.timestamp,
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
        let msg = DashboardMessage::StateFull { sensors };
        let json = serde_json::to_string(&msg).unwrap_or_default();
        let _ = socket.send(Message::Text(json.into())).await;
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
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}