use crate::agent::llm::{ToolDef, ToolFunc};
use crate::agent::prompt;
use crate::mqtt::MqttManager;
use crate::server::DashboardMessage;
use crate::storage::{Db, Sensor};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

fn make_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:016x}", now.as_nanos() as u64)
}

fn make_timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let h = time_of_day / 3600;
    let m = (time_of_day % 3600) / 60;
    let s = time_of_day % 60;
    format!("day-{days}T{h:02}:{m:02}:{s:02}Z")
}

#[derive(Debug, Serialize, Deserialize)]
struct AddSensorParams {
    name: String,
    topic: String,
    #[serde(default)]
    broker: Option<String>,
    #[serde(default = "default_broker_port")]
    broker_port: u16,
    #[serde(default = "default_widget_type")]
    widget_type: String,
    #[serde(default)]
    unit: Option<String>,
}

fn default_broker_port() -> u16 { 1883 }
fn default_widget_type() -> String { "text".into() }

#[derive(Debug, Serialize, Deserialize)]
struct RemoveSensorParams {
    name: String,
}

pub struct ToolExecutor {
    db: Arc<Db>,
    mqtt: Arc<MqttManager>,
    dashboard_tx: Option<broadcast::Sender<DashboardMessage>>,
    default_broker: String,
}

impl ToolExecutor {
    pub fn new(db: Arc<Db>, mqtt: Arc<MqttManager>) -> Self {
        Self {
            db,
            mqtt,
            dashboard_tx: None,
            default_broker: "localhost".into(),
        }
    }

    pub fn with_default_broker(mut self, broker: String) -> Self {
        self.default_broker = broker;
        self
    }

    pub fn with_dashboard_tx(mut self, tx: broadcast::Sender<DashboardMessage>) -> Self {
        self.dashboard_tx = Some(tx);
        self
    }

    pub fn tool_definitions(&self) -> Vec<ToolDef> {
        vec![
            ToolDef {
                tool_type: "function".into(),
                function: ToolFunc {
                    name: "add_sensor".into(),
                    description: "Add a sensor widget to the dashboard. This subscribes to an MQTT topic and creates a visual widget.".into(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "required": ["name", "topic"],
                        "properties": {
                            "name": {"type": "string", "description": "Human-readable name for the sensor"},
                            "topic": {"type": "string", "description": "MQTT topic to subscribe to"},
                            "broker": {"type": "string", "description": "MQTT broker address (defaults to config default)"},
                            "broker_port": {"type": "integer", "description": "MQTT broker port (default 1883)"},
                            "widget_type": {"type": "string", "enum": ["text", "gauge", "chart", "switch"], "description": "Type of widget to display"},
                            "unit": {"type": "string", "description": "Unit of measurement (e.g. °C, %, hPa)"}
                        }
                    }),
                },
            },
            ToolDef {
                tool_type: "function".into(),
                function: ToolFunc {
                    name: "remove_sensor".into(),
                    description: "Remove a sensor and its widget from the dashboard".into(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "required": ["name"],
                        "properties": {
                            "name": {"type": "string", "description": "Name of the sensor to remove"}
                        }
                    }),
                },
            },
            ToolDef {
                tool_type: "function".into(),
                function: ToolFunc {
                    name: "list_sensors".into(),
                    description: "List all currently configured sensors on the dashboard".into(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "properties": {}
                    }),
                },
            },
        ]
    }

    pub async fn build_system_prompt_context(&self) -> String {
        let sensor_list = match self.db.list_sensors() {
            Ok(sensors) if sensors.is_empty() => "(none)".into(),
            Ok(sensors) => sensors
                .iter()
                .map(|s| format!("- {} ({}) → {} on {}:{}, widget: {}", s.name, s.id, s.topic, s.broker, s.broker_port, s.widget_type))
                .collect::<Vec<_>>()
                .join("\n"),
            Err(_) => "(error reading sensors)".into(),
        };
        prompt::build_system_prompt(&sensor_list)
    }

    pub async fn execute(&self, name: &str, arguments: &str) -> String {
        match name {
            "add_sensor" => self.exec_add_sensor(arguments).await,
            "remove_sensor" => self.exec_remove_sensor(arguments).await,
            "list_sensors" => self.exec_list_sensors(),
            _ => format!("Unknown tool: {name}"),
        }
    }

    async fn exec_add_sensor(&self, arguments: &str) -> String {
        let params: AddSensorParams = match serde_json::from_str(arguments) {
            Ok(p) => p,
            Err(e) => return format!("Error parsing parameters: {e}"),
        };

        let broker = params.broker.unwrap_or_else(|| self.default_broker.clone());
        let unit = params.unit.unwrap_or_default();
        let id = make_id();
        let now = make_timestamp();

        let sensor = Sensor {
            id: id.clone(),
            name: params.name.clone(),
            topic: params.topic.clone(),
            broker: broker.clone(),
            broker_port: params.broker_port,
            widget_type: params.widget_type.clone(),
            unit: unit.clone(),
            created_at: now.clone(),
            updated_at: now,
        };

        if let Err(e) = self.db.insert_sensor(&sensor) {
            return format!("Error saving sensor: {e}");
        }

        if let Err(e) = self.mqtt.subscribe(id.clone(), params.topic.clone(), broker.clone(), params.broker_port).await {
            return format!("Sensor saved but MQTT subscription failed: {e}");
        }

        if let Some(ref tx) = self.dashboard_tx {
            let _ = tx.send(DashboardMessage::WidgetAdd { sensor: sensor.clone() });
        }

        format!("OK: sensor '{}' added", params.name)
    }

    async fn exec_remove_sensor(&self, arguments: &str) -> String {
        let params: RemoveSensorParams = match serde_json::from_str(arguments) {
            Ok(p) => p,
            Err(e) => return format!("Error parsing parameters: {e}"),
        };

        let sensor = match self.db.get_sensor_by_name(&params.name) {
            Ok(Some(s)) => s,
            Ok(None) => return format!("Sensor '{}' not found", params.name),
            Err(e) => return format!("Error looking up sensor: {e}"),
        };

        if let Err(e) = self.mqtt.unsubscribe(&sensor.topic, &sensor.broker, sensor.broker_port).await {
            log::warn!("MQTT unsubscribe error: {e}");
        }

        match self.db.delete_sensor(&sensor.id) {
            Ok(true) => {
                if let Some(ref tx) = self.dashboard_tx {
                    let _ = tx.send(DashboardMessage::WidgetRemove { id: sensor.id.clone() });
                }
                format!("OK: sensor '{}' removed", params.name)
            }
            Ok(false) => format!("Sensor '{}' not found", params.name),
            Err(e) => format!("Error removing sensor: {e}"),
        }
    }

    fn exec_list_sensors(&self) -> String {
        match self.db.list_sensors() {
            Ok(sensors) if sensors.is_empty() => "No sensors configured.".into(),
            Ok(sensors) => sensors
                .iter()
                .map(|s| format!("{}: {} ({}) → {} on {}:{}, widget: {}, unit: {}", s.id, s.name, s.widget_type, s.topic, s.broker, s.broker_port, s.widget_type, s.unit))
                .collect::<Vec<_>>()
                .join("\n"),
            Err(e) => format!("Error listing sensors: {e}"),
        }
    }
}