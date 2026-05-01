use crate::agent::llm::{ToolDef, ToolFunc};
use crate::agent::prompt;
use crate::mqtt::MqttManager;
use crate::server::DashboardMessage;
use crate::storage::{Db, Sensor, SensorUpdate};
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

fn default_broker_port() -> u16 { 1883 }
fn default_widget_type() -> String { "text".into() }

// ── Add Sensor Parameters ────────────────────────────────────────

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

    // gauge design
    #[serde(default)]
    gauge_min: Option<f64>,
    #[serde(default)]
    gauge_max: Option<f64>,
    #[serde(default)]
    gauge_color_low: Option<String>,
    #[serde(default)]
    gauge_color_mid: Option<String>,
    #[serde(default)]
    gauge_color_high: Option<String>,
    #[serde(default)]
    gauge_threshold_low: Option<f64>,
    #[serde(default)]
    gauge_threshold_high: Option<f64>,

    // chart design
    #[serde(default)]
    chart_color: Option<String>,
    #[serde(default)]
    chart_max_points: Option<i32>,

    // display
    #[serde(default)]
    display_precision: Option<i32>,
    #[serde(default)]
    card_accent: Option<String>,
    #[serde(default)]
    card_size: Option<String>,

    // bidirectional publish
    #[serde(default)]
    publish_topic: Option<String>,
    #[serde(default)]
    publish_payload_on: Option<String>,
    #[serde(default)]
    publish_payload_off: Option<String>,
    #[serde(default)]
    allow_publish: Option<bool>,

    // transform & alerts
    #[serde(default)]
    value_transform: Option<String>,
    #[serde(default)]
    alert_min: Option<f64>,
    #[serde(default)]
    alert_max: Option<f64>,
}

// ── Update Sensor Parameters ─────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct UpdateSensorParams {
    name: String,
    #[serde(default)]
    new_name: Option<String>,
    #[serde(default)]
    topic: Option<String>,
    #[serde(default)]
    broker: Option<String>,
    #[serde(default)]
    broker_port: Option<u16>,
    #[serde(default)]
    widget_type: Option<String>,
    #[serde(default)]
    unit: Option<String>,

    #[serde(default)]
    gauge_min: Option<f64>,
    #[serde(default)]
    gauge_max: Option<f64>,
    #[serde(default)]
    gauge_color_low: Option<String>,
    #[serde(default)]
    gauge_color_mid: Option<String>,
    #[serde(default)]
    gauge_color_high: Option<String>,
    #[serde(default)]
    gauge_threshold_low: Option<f64>,
    #[serde(default)]
    gauge_threshold_high: Option<f64>,

    #[serde(default)]
    chart_color: Option<String>,
    #[serde(default)]
    chart_max_points: Option<i32>,

    #[serde(default)]
    display_precision: Option<i32>,
    #[serde(default)]
    card_accent: Option<String>,
    #[serde(default)]
    card_size: Option<String>,

    #[serde(default)]
    publish_topic: Option<String>,
    #[serde(default)]
    publish_payload_on: Option<String>,
    #[serde(default)]
    publish_payload_off: Option<String>,
    #[serde(default)]
    allow_publish: Option<bool>,

    #[serde(default)]
    value_transform: Option<String>,
    #[serde(default)]
    alert_min: Option<f64>,
    #[serde(default)]
    alert_max: Option<f64>,
}

// ── Remove / Publish Parameters ──────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct RemoveSensorParams {
    name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PublishValueParams {
    name: String,
    value: String,
}

// ── Tool Executor ────────────────────────────────────────────────

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
                    description: "Add a sensor widget to the dashboard. Subscribes to an MQTT topic and creates a visual widget. The LLM should infer sensible design defaults based on sensor type (temperature -> gauge -10..50, humidity -> gauge 0..100, etc.).".into(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "required": ["name", "topic"],
                        "properties": {
                            "name": {"type": "string", "description": "Human-readable name for the sensor"},
                            "topic": {"type": "string", "description": "MQTT topic to subscribe to"},
                            "broker": {"type": "string", "description": "MQTT broker address (defaults to config default)"},
                            "broker_port": {"type": "integer", "description": "MQTT broker port (default 1883)"},
                            "widget_type": {"type": "string", "enum": ["text", "gauge", "chart", "switch"], "description": "Type of widget to display"},
                            "unit": {"type": "string", "description": "Unit of measurement (e.g. °C, %, hPa)"},

                            "gauge_min": {"type": "number", "description": "Gauge minimum value (default 0)"},
                            "gauge_max": {"type": "number", "description": "Gauge maximum value (default 100)"},
                            "gauge_color_low": {"type": "string", "description": "Color for low segment (default #4caf50)"},
                            "gauge_color_mid": {"type": "string", "description": "Color for mid segment (default #4fc3f7)"},
                            "gauge_color_high": {"type": "string", "description": "Color for high segment (default #ef5350)"},
                            "gauge_threshold_low": {"type": "number", "description": "Low-to-mid threshold (default 30)"},
                            "gauge_threshold_high": {"type": "number", "description": "Mid-to-high threshold (default 70)"},

                            "chart_color": {"type": "string", "description": "Line color for chart (default #4fc3f7)"},
                            "chart_max_points": {"type": "integer", "description": "Max history points for chart (default 120)"},

                            "display_precision": {"type": "integer", "description": "Decimal places (default 1)"},
                            "card_accent": {"type": "string", "description": "Card accent color (default #4fc3f7)"},
                            "card_size": {"type": "string", "enum": ["small", "medium", "large"], "description": "Card size (default medium)"},

                            "publish_topic": {"type": "string", "description": "MQTT topic to publish to for bidirectional control"},
                            "publish_payload_on": {"type": "string", "description": "Payload for ON state (default 1)"},
                            "publish_payload_off": {"type": "string", "description": "Payload for OFF state (default 0)"},
                            "allow_publish": {"type": "boolean", "description": "Allow dashboard to publish (default false)"},

                            "value_transform": {"type": "string", "description": "Math expression with x (e.g. 'x * 1.8 + 32')"},
                            "alert_min": {"type": "number", "description": "Alert below this value"},
                            "alert_max": {"type": "number", "description": "Alert above this value"}
                        }
                    }),
                },
            },
            ToolDef {
                tool_type: "function".into(),
                function: ToolFunc {
                    name: "update_sensor".into(),
                    description: "Update an existing sensor's configuration, widget design, or alerts. Only provide fields you want to change.".into(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "required": ["name"],
                        "properties": {
                            "name": {"type": "string", "description": "Name of the sensor to update"},
                            "new_name": {"type": "string", "description": "Rename the sensor"},
                            "topic": {"type": "string", "description": "New MQTT topic"},
                            "broker": {"type": "string"},
                            "broker_port": {"type": "integer"},
                            "widget_type": {"type": "string", "enum": ["text", "gauge", "chart", "switch"]},
                            "unit": {"type": "string"},

                            "gauge_min": {"type": "number"},
                            "gauge_max": {"type": "number"},
                            "gauge_color_low": {"type": "string"},
                            "gauge_color_mid": {"type": "string"},
                            "gauge_color_high": {"type": "string"},
                            "gauge_threshold_low": {"type": "number"},
                            "gauge_threshold_high": {"type": "number"},

                            "chart_color": {"type": "string"},
                            "chart_max_points": {"type": "integer"},

                            "display_precision": {"type": "integer"},
                            "card_accent": {"type": "string"},
                            "card_size": {"type": "string", "enum": ["small", "medium", "large"]},

                            "publish_topic": {"type": "string", "description": "Set null to clear"},
                            "publish_payload_on": {"type": "string"},
                            "publish_payload_off": {"type": "string"},
                            "allow_publish": {"type": "boolean"},

                            "value_transform": {"type": "string", "description": "Set null to clear"},
                            "alert_min": {"type": "number"},
                            "alert_max": {"type": "number"}
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
            ToolDef {
                tool_type: "function".into(),
                function: ToolFunc {
                    name: "publish_value".into(),
                    description: "Publish a value to a sensor's configured publish_topic. Used to control devices (e.g. turn on a light).".into(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "required": ["name", "value"],
                        "properties": {
                            "name": {"type": "string", "description": "Sensor name whose publish_topic to use"},
                            "value": {"type": "string", "description": "Value to publish (typically '1'/'0' or 'on'/'off')"}
                        }
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
                .map(|s| {
                    let design = match s.widget_type.as_str() {
                        "gauge" => format!(" [{}..{}]", s.gauge_min, s.gauge_max),
                        "chart" => format!(" [max {} pts]", s.chart_max_points),
                        _ => String::new(),
                    };
                    let pub_info = if s.allow_publish {
                        format!(" (publishes to {})", s.publish_topic.as_deref().unwrap_or("?"))
                    } else {
                        String::new()
                    };
                    format!("- {} → {} on {}:{}, widget: {}{}{}",
                        s.name, s.topic, s.broker, s.broker_port, s.widget_type, design, pub_info)
                })
                .collect::<Vec<_>>()
                .join("\n"),
            Err(_) => "(error reading sensors)".into(),
        };
        prompt::build_system_prompt(&sensor_list)
    }

    pub async fn execute(&self, name: &str, arguments: &str) -> String {
        match name {
            "add_sensor" => self.exec_add_sensor(arguments).await,
            "update_sensor" => self.exec_update_sensor(arguments).await,
            "remove_sensor" => self.exec_remove_sensor(arguments).await,
            "list_sensors" => self.exec_list_sensors(),
            "publish_value" => self.exec_publish_value(arguments).await,
            _ => format!("Unknown tool: {name}"),
        }
    }

    // ── add_sensor ────────────────────────────────────────────────

    async fn exec_add_sensor(&self, arguments: &str) -> String {
        let params: AddSensorParams = match serde_json::from_str(arguments) {
            Ok(p) => p,
            Err(e) => return format!("Error parsing parameters: {e}"),
        };

        let broker = params.broker.clone().unwrap_or_else(|| self.default_broker.clone());
        let unit = params.unit.clone().unwrap_or_default();
        let id = make_id();
        let now = make_timestamp();

        let mut sensor = Sensor::default();
        sensor.id = id.clone();
        sensor.name = params.name.clone();
        sensor.topic = params.topic.clone();
        sensor.broker = broker.clone();
        sensor.broker_port = params.broker_port;
        sensor.widget_type = params.widget_type.clone();
        sensor.unit = unit.clone();
        sensor.created_at = now.clone();
        sensor.updated_at = now;

        // Apply widget design defaults inferred from sensor type
        Self::apply_sensor_defaults(&mut sensor, &params);

        // Overlay explicit parameters
        if let Some(v) = params.gauge_min { sensor.gauge_min = v; }
        if let Some(v) = params.gauge_max { sensor.gauge_max = v; }
        if let Some(v) = params.gauge_color_low { sensor.gauge_color_low = v; }
        if let Some(v) = params.gauge_color_mid { sensor.gauge_color_mid = v; }
        if let Some(v) = params.gauge_color_high { sensor.gauge_color_high = v; }
        if let Some(v) = params.gauge_threshold_low { sensor.gauge_threshold_low = v; }
        if let Some(v) = params.gauge_threshold_high { sensor.gauge_threshold_high = v; }
        if let Some(v) = params.chart_color { sensor.chart_color = v; }
        if let Some(v) = params.chart_max_points { sensor.chart_max_points = v; }
        if let Some(v) = params.display_precision { sensor.display_precision = v; }
        if let Some(v) = params.card_accent { sensor.card_accent = v; }
        if let Some(v) = params.card_size { sensor.card_size = v; }
        if let Some(v) = params.publish_topic { sensor.publish_topic = Some(v); }
        if let Some(v) = params.publish_payload_on { sensor.publish_payload_on = v; }
        if let Some(v) = params.publish_payload_off { sensor.publish_payload_off = v; }
        if let Some(v) = params.allow_publish { sensor.allow_publish = v; }
        if let Some(v) = params.value_transform { sensor.value_transform = Some(v); }
        if let Some(v) = params.alert_min { sensor.alert_min = v; }
        if let Some(v) = params.alert_max { sensor.alert_max = v; }

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

    fn apply_sensor_defaults(sensor: &mut Sensor, params: &AddSensorParams) {
        let wt = params.widget_type.as_str();
        let unit_hint = params.unit.as_deref().unwrap_or("").to_lowercase();

        if wt == "gauge" {
            if unit_hint.contains("°c") || unit_hint.contains("celsius") || unit_hint.contains("temp") {
                if params.gauge_min.is_none() { sensor.gauge_min = -10.0; }
                if params.gauge_max.is_none() { sensor.gauge_max = 50.0; }
                if params.gauge_threshold_low.is_none() { sensor.gauge_threshold_low = 10.0; }
                if params.gauge_threshold_high.is_none() { sensor.gauge_threshold_high = 35.0; }
            } else if unit_hint.contains("°f") || unit_hint.contains("fahrenheit") {
                if params.gauge_min.is_none() { sensor.gauge_min = 14.0; }
                if params.gauge_max.is_none() { sensor.gauge_max = 122.0; }
                if params.gauge_threshold_low.is_none() { sensor.gauge_threshold_low = 50.0; }
                if params.gauge_threshold_high.is_none() { sensor.gauge_threshold_high = 95.0; }
            } else if unit_hint.contains('%') || unit_hint.contains("humid") {
                if params.gauge_min.is_none() { sensor.gauge_min = 0.0; }
                if params.gauge_max.is_none() { sensor.gauge_max = 100.0; }
                if params.gauge_threshold_low.is_none() { sensor.gauge_threshold_low = 30.0; }
                if params.gauge_threshold_high.is_none() { sensor.gauge_threshold_high = 70.0; }
            } else if unit_hint.contains("hpa") || unit_hint.contains("pressure") {
                if params.gauge_min.is_none() { sensor.gauge_min = 950.0; }
                if params.gauge_max.is_none() { sensor.gauge_max = 1050.0; }
                if params.gauge_threshold_low.is_none() { sensor.gauge_threshold_low = 980.0; }
                if params.gauge_threshold_high.is_none() { sensor.gauge_threshold_high = 1030.0; }
            }
        }

        if wt == "switch" && params.allow_publish.unwrap_or(false) {
            if params.card_accent.is_none() { sensor.card_accent = "#4caf50".into(); }
        }
    }

    // ── update_sensor ─────────────────────────────────────────────

    async fn exec_update_sensor(&self, arguments: &str) -> String {
        let params: UpdateSensorParams = match serde_json::from_str(arguments) {
            Ok(p) => p,
            Err(e) => return format!("Error parsing parameters: {e}"),
        };

        let sensor = match self.db.get_sensor_by_name(&params.name) {
            Ok(Some(s)) => s,
            Ok(None) => return format!("Sensor '{}' not found", params.name),
            Err(e) => return format!("Error looking up sensor: {e}"),
        };

        let mut updates = SensorUpdate::default();
        updates.new_name = params.new_name;
        updates.topic = params.topic.clone();
        updates.broker = params.broker.clone();
        updates.broker_port = params.broker_port;
        updates.widget_type = params.widget_type.clone();
        updates.unit = params.unit;
        updates.gauge_min = params.gauge_min;
        updates.gauge_max = params.gauge_max;
        updates.gauge_color_low = params.gauge_color_low;
        updates.gauge_color_mid = params.gauge_color_mid;
        updates.gauge_color_high = params.gauge_color_high;
        updates.gauge_threshold_low = params.gauge_threshold_low;
        updates.gauge_threshold_high = params.gauge_threshold_high;
        updates.chart_color = params.chart_color;
        updates.chart_max_points = params.chart_max_points;
        updates.display_precision = params.display_precision;
        updates.card_accent = params.card_accent;
        updates.card_size = params.card_size;
        updates.publish_topic = Some(params.publish_topic);
        updates.publish_payload_on = params.publish_payload_on;
        updates.publish_payload_off = params.publish_payload_off;
        updates.allow_publish = params.allow_publish;
        updates.value_transform = Some(params.value_transform);
        updates.alert_min = params.alert_min;
        updates.alert_max = params.alert_max;

        // Handle MQTT topic/broker changes
        let topic_changed = params.topic.is_some() && params.topic.as_ref() != Some(&sensor.topic);
        let broker_changed = params.broker.is_some() && params.broker.as_ref() != Some(&sensor.broker);
        let port_changed = params.broker_port.is_some() && params.broker_port != Some(sensor.broker_port);

        if topic_changed || broker_changed || port_changed {
            let old_topic = sensor.topic.clone();
            let old_broker = sensor.broker.clone();
            let old_port = sensor.broker_port;
            let new_topic = params.topic.unwrap_or(sensor.topic);
            let new_broker = params.broker.unwrap_or(sensor.broker);
            let new_port = params.broker_port.unwrap_or(sensor.broker_port);

            if let Err(e) = self.mqtt.unsubscribe(&old_topic, &old_broker, old_port).await {
                log::warn!("MQTT unsubscribe error during update: {e}");
            }
            if let Err(e) = self.mqtt.subscribe(sensor.id.clone(), new_topic.clone(), new_broker.clone(), new_port).await {
                return format!("Updated DB but MQTT re-subscription failed: {e}");
            }
        }

        if let Err(e) = self.db.update_sensor(&sensor.id, &updates) {
            return format!("Error updating sensor: {e}");
        }

        // Reload updated sensor for broadcast
        let updated = match self.db.get_sensor(&sensor.id) {
            Ok(Some(s)) => s,
            _ => return format!("Updated but failed to reload sensor '{}'", params.name),
        };

        let widget_type_changed = params.widget_type.is_some() && params.widget_type.as_ref() != Some(&sensor.widget_type);

        if let Some(ref tx) = self.dashboard_tx {
            if widget_type_changed {
                // Widget type change needs full re-render: remove then add
                let _ = tx.send(DashboardMessage::WidgetRemove { id: updated.id.clone() });
                let _ = tx.send(DashboardMessage::WidgetAdd { sensor: updated.clone() });
            } else {
                let _ = tx.send(DashboardMessage::WidgetUpdate { sensor: updated.clone() });
            }
        }

        format!("OK: sensor '{}' updated", params.name)
    }

    // ── remove_sensor ─────────────────────────────────────────────

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

    // ── list_sensors ──────────────────────────────────────────────

    fn exec_list_sensors(&self) -> String {
        match self.db.list_sensors() {
            Ok(sensors) if sensors.is_empty() => "No sensors configured.".into(),
            Ok(sensors) => sensors
                .iter()
                .map(|s| {
                    let mut parts = vec![
                        format!("{}: {} ({}) → {} on {}:{}, widget: {}, unit: {}",
                            s.id, s.name, s.widget_type, s.topic, s.broker, s.broker_port, s.widget_type, s.unit)
                    ];
                    if s.widget_type == "gauge" {
                        parts.push(format!("  range: {}..{}, colors: {}/{}/{}",
                            s.gauge_min, s.gauge_max, s.gauge_color_low, s.gauge_color_mid, s.gauge_color_high));
                    }
                    if s.allow_publish {
                        parts.push(format!("  publishes to: {}", s.publish_topic.as_deref().unwrap_or("?")));
                    }
                    if s.value_transform.is_some() {
                        parts.push(format!("  transform: {}", s.value_transform.as_deref().unwrap_or("?")));
                    }
                    if s.alert_min.is_finite() || s.alert_max.is_finite() {
                        parts.push(format!("  alerts: {}..{}",
                            if s.alert_min.is_finite() { format!("{:.1}", s.alert_min) } else { "-∞".into() },
                            if s.alert_max.is_finite() { format!("{:.1}", s.alert_max) } else { "+∞".into() }));
                    }
                    parts.join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n\n"),
            Err(e) => format!("Error listing sensors: {e}"),
        }
    }

    // ── publish_value ─────────────────────────────────────────────

    async fn exec_publish_value(&self, arguments: &str) -> String {
        let params: PublishValueParams = match serde_json::from_str(arguments) {
            Ok(p) => p,
            Err(e) => return format!("Error parsing parameters: {e}"),
        };

        let sensor = match self.db.get_sensor_by_name(&params.name) {
            Ok(Some(s)) => s,
            Ok(None) => return format!("Sensor '{}' not found", params.name),
            Err(e) => return format!("Error looking up sensor: {e}"),
        };

        let publish_topic = match sensor.publish_topic {
            Some(t) => t,
            None => return format!("Sensor '{}' has no publish_topic configured", params.name),
        };

        if !sensor.allow_publish {
            return format!("Sensor '{}' does not allow publishing", params.name);
        }

        let payload = if params.value == "1" || params.value.to_lowercase() == "on" || params.value.to_lowercase() == "true" {
            sensor.publish_payload_on.clone()
        } else {
            sensor.publish_payload_off.clone()
        };

        match self.mqtt.publish(publish_topic.clone(), sensor.broker.clone(), sensor.broker_port, payload.clone()).await {
            Ok(()) => {
                if let Some(ref tx) = self.dashboard_tx {
                    let _ = tx.send(DashboardMessage::ValueUpdate {
                        sensor_id: sensor.id.clone(),
                        value: params.value.clone(),
                        timestamp: std::time::SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs() as i64,
                        alert: false,
                    });
                }
                format!("OK: published '{}' to {}", payload, publish_topic)
            }
            Err(e) => format!("Publish failed: {e}"),
        }
    }
}
