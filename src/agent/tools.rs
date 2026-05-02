use crate::agent::llm::{ToolDef, ToolFunc};
use crate::agent::prompt;
use crate::store::{Sensor, SensorUpdate, Store};
use crate::mqtt::MqttManager;
use crate::server::DashboardMessage;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tokio::sync::broadcast;

fn default_broker_port() -> u16 { 1883 }
fn default_widget_type() -> String { "text".into() }

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
    history_enabled: Option<bool>,
    #[serde(default)]
    history_chart: Option<bool>,
    #[serde(default)]
    history_retain_days: Option<i32>,

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

#[derive(Debug, Serialize, Deserialize)]
struct UpdateSensorParams {
    name: String,
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
    history_enabled: Option<bool>,
    #[serde(default)]
    history_chart: Option<bool>,
    #[serde(default)]
    history_retain_days: Option<i32>,

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

#[derive(Debug, Serialize, Deserialize)]
struct SetBrokerParams {
    broker: String,
    #[serde(default = "default_broker_port")]
    port: u16,
}

// ── Tool Executor ────────────────────────────────────────────────

pub struct ToolExecutor {
    store: Arc<Store>,
    mqtt: Arc<MqttManager>,
    dashboard_tx: Option<broadcast::Sender<DashboardMessage>>,
}

impl ToolExecutor {
    pub fn new(store: Arc<Store>, mqtt: Arc<MqttManager>) -> Self {
        Self {
            store,
            mqtt,
            dashboard_tx: None,
        }
    }

    pub fn with_dashboard_tx(mut self, tx: broadcast::Sender<DashboardMessage>) -> Self {
        self.dashboard_tx = Some(tx);
        self
    }

    pub fn tool_definitions(&self) -> Vec<ToolDef> {
        let broker = self.store.mqtt_broker();
        vec![
            ToolDef {
                tool_type: "function".into(),
                function: ToolFunc {
                    name: "add_sensor".into(),
                    description: format!("Add a sensor widget to the dashboard. Subscribes to an MQTT topic and creates a visual widget. Infer sensible design defaults based on sensor type (temperature -> gauge -10..50, humidity -> gauge 0..100, etc.). Default broker: {}:1883.", if broker.is_empty() { "not configured" } else { &broker }).into(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "required": ["name", "topic"],
                        "properties": {
                            "name": {"type": "string", "description": "Human-readable name for the sensor (unique identifier)"},
                            "topic": {"type": "string", "description": "MQTT topic to subscribe to"},
                            "broker": {"type": "string", "description": "MQTT broker address (default: from sensors.yaml)"},
                            "broker_port": {"type": "integer", "description": "MQTT broker port (default 1883)"},
                            "widget_type": {"type": "string", "enum": ["text", "gauge", "switch"], "description": "Type of widget to display"},
                            "unit": {"type": "string", "description": "Unit of measurement (e.g. °C, %, hPa)"},

                            "gauge_min": {"type": "number", "description": "Gauge minimum value (default 0)"},
                            "gauge_max": {"type": "number", "description": "Gauge maximum value (default 100)"},
                            "gauge_color_low": {"type": "string", "description": "Color for low segment (default #4caf50)"},
                            "gauge_color_mid": {"type": "string", "description": "Color for mid segment (default #4fc3f7)"},
                            "gauge_color_high": {"type": "string", "description": "Color for high segment (default #ef5350)"},
                            "gauge_threshold_low": {"type": "number", "description": "Low-to-mid threshold (default 30)"},
                            "gauge_threshold_high": {"type": "number", "description": "Mid-to-high threshold (default 70)"},

                            "chart_color": {"type": "string", "description": "Line color for history chart (default #4fc3f7)"},
                            "history_enabled": {"type": "boolean", "description": "Record history for this sensor (default true)"},
                            "history_chart": {"type": "boolean", "description": "Show chart icon on card to view history (default false)"},
                            "history_retain_days": {"type": "integer", "description": "Days to retain history (default 30)"},

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
                            "topic": {"type": "string", "description": "New MQTT topic"},
                            "broker": {"type": "string"},
                            "broker_port": {"type": "integer"},
                            "widget_type": {"type": "string", "enum": ["text", "gauge", "switch"]},
                            "unit": {"type": "string"},

                            "gauge_min": {"type": "number"},
                            "gauge_max": {"type": "number"},
                            "gauge_color_low": {"type": "string"},
                            "gauge_color_mid": {"type": "string"},
                            "gauge_color_high": {"type": "string"},
                            "gauge_threshold_low": {"type": "number"},
                            "gauge_threshold_high": {"type": "number"},

                            "chart_color": {"type": "string"},
                            "history_enabled": {"type": "boolean"},
                            "history_chart": {"type": "boolean"},
                            "history_retain_days": {"type": "integer"},

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
            ToolDef {
                tool_type: "function".into(),
                function: ToolFunc {
                    name: "set_broker".into(),
                    description: "Set the default MQTT broker address and port. New sensors will use this broker unless overridden.".into(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "required": ["broker"],
                        "properties": {
                            "broker": {"type": "string", "description": "MQTT broker IP address or hostname"},
                            "port": {"type": "integer", "description": "MQTT broker port (default 1883)"}
                        }
                    }),
                },
            },
        ]
    }

    pub async fn build_system_prompt_context(&self) -> String {
        let sensor_list = match self.store.list_sensors().await {
            Ok(sensors) if sensors.is_empty() => "(none)".into(),
            Ok(sensors) => sensors
                .iter()
                .map(|s| {
                    let design = match s.widget_type.as_str() {
                        "gauge" => format!(" [{}..{}]", s.gauge_min, s.gauge_max),
                        _ => String::new(),
                    };
                    let hist = if s.history_chart { " [chart]" } else { "" };
                    let pub_info = if s.allow_publish {
                        format!(" (publishes to {})", s.publish_topic.as_deref().unwrap_or("?"))
                    } else {
                        String::new()
                    };
                    format!("- {} → {} on {}:{}, widget: {}{}{}{}",
                        s.name, s.topic, s.broker, s.broker_port, s.widget_type, design, hist, pub_info)
                })
                .collect::<Vec<_>>()
                .join("\n"),
            Err(_) => "(error reading sensors)".into(),
        };
        let broker = self.store.mqtt_broker();
        prompt::build_system_prompt(&sensor_list, &broker)
    }

    pub async fn execute(&self, name: &str, arguments: &str) -> String {
        match name {
            "add_sensor" => self.exec_add_sensor(arguments).await,
            "update_sensor" => self.exec_update_sensor(arguments).await,
            "remove_sensor" => self.exec_remove_sensor(arguments).await,
            "list_sensors" => self.exec_list_sensors().await,
            "publish_value" => self.exec_publish_value(arguments).await,
            "set_broker" => self.exec_set_broker(arguments).await,
            _ => format!("Unknown tool: {name}"),
        }
    }

    // ── add_sensor ────────────────────────────────────────────────

    async fn exec_add_sensor(&self, arguments: &str) -> String {
        let params: AddSensorParams = match serde_json::from_str(arguments) {
            Ok(p) => p,
            Err(e) => return format!("Error parsing parameters: {e}"),
        };

        let broker = match params.broker.clone() {
            Some(b) => b,
            None => {
                let default = self.store.mqtt_broker();
                log::info!("add_sensor: no broker in tool args, using '{}'", default);
                default
            }
        };

        let mut sensor = Sensor::default();
        sensor.name = params.name.clone();
        sensor.topic = params.topic.clone();
        sensor.broker = broker.clone();
        sensor.broker_port = params.broker_port;
        sensor.widget_type = params.widget_type.clone();
        sensor.unit = params.unit.clone().unwrap_or_default();

        Self::apply_sensor_defaults(&mut sensor, &params);

        if let Some(v) = params.gauge_min { sensor.gauge_min = v; }
        if let Some(v) = params.gauge_max { sensor.gauge_max = v; }
        if let Some(v) = params.gauge_color_low { sensor.gauge_color_low = v; }
        if let Some(v) = params.gauge_color_mid { sensor.gauge_color_mid = v; }
        if let Some(v) = params.gauge_color_high { sensor.gauge_color_high = v; }
        if let Some(v) = params.gauge_threshold_low { sensor.gauge_threshold_low = v; }
        if let Some(v) = params.gauge_threshold_high { sensor.gauge_threshold_high = v; }
        if let Some(v) = params.chart_color { sensor.chart_color = v; }
        if let Some(v) = params.history_enabled { sensor.history_enabled = v; }
        if let Some(v) = params.history_chart { sensor.history_chart = v; }
        if let Some(v) = params.history_retain_days { sensor.history_retain_days = v; }
        if let Some(v) = params.display_precision { sensor.display_precision = v; }
        if let Some(v) = params.card_accent { sensor.card_accent = v; }
        if let Some(v) = params.card_size { sensor.card_size = v; }
        if let Some(v) = params.publish_topic { sensor.publish_topic = Some(v); }
        if let Some(v) = params.publish_payload_on { sensor.publish_payload_on = v; }
        if let Some(v) = params.publish_payload_off { sensor.publish_payload_off = v; }
        if let Some(v) = params.allow_publish { sensor.allow_publish = v; }
        if let Some(v) = params.value_transform { sensor.value_transform = Some(v); }
        if let Some(v) = params.alert_min { sensor.alert_min = Some(v); }
        if let Some(v) = params.alert_max { sensor.alert_max = Some(v); }

        if let Err(e) = self.store.insert_sensor(&sensor).await {
            return format!("Error saving sensor: {e}");
        }

        if let Err(e) = self.mqtt.subscribe(sensor.name.clone(), params.topic.clone(), broker.clone(), params.broker_port).await {
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

        let sensor = match self.store.get_sensor_by_name(&params.name).await {
            Ok(Some(s)) => s,
            Ok(None) => return format!("Sensor '{}' not found", params.name),
            Err(e) => return format!("Error looking up sensor: {e}"),
        };

        let mut updates = SensorUpdate::default();
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
        updates.history_enabled = params.history_enabled;
        updates.history_chart = params.history_chart;
        updates.history_retain_days = params.history_retain_days;
        updates.display_precision = params.display_precision;
        updates.card_accent = params.card_accent;
        updates.card_size = params.card_size;
        updates.publish_topic = Some(params.publish_topic);
        updates.publish_payload_on = params.publish_payload_on;
        updates.publish_payload_off = params.publish_payload_off;
        updates.allow_publish = params.allow_publish;
        updates.value_transform = Some(params.value_transform);
        updates.alert_min = Some(params.alert_min);
        updates.alert_max = Some(params.alert_max);

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
            if let Err(e) = self.mqtt.subscribe(sensor.name.clone(), new_topic.clone(), new_broker.clone(), new_port).await {
                return format!("Updated DB but MQTT re-subscription failed: {e}");
            }
        }

        if let Err(e) = self.store.update_sensor(&sensor.name, &updates).await {
            return format!("Error updating sensor: {e}");
        }

        let updated = match self.store.get_sensor(&sensor.name).await {
            Ok(Some(s)) => s,
            _ => return format!("Updated but failed to reload sensor '{}'", params.name),
        };

        let widget_type_changed = params.widget_type.is_some() && params.widget_type.as_ref() != Some(&sensor.widget_type);

        if let Some(ref tx) = self.dashboard_tx {
            if widget_type_changed {
                let _ = tx.send(DashboardMessage::WidgetRemove { id: updated.name.clone() });
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

        let sensor = match self.store.get_sensor_by_name(&params.name).await {
            Ok(Some(s)) => s,
            Ok(None) => return format!("Sensor '{}' not found", params.name),
            Err(e) => return format!("Error looking up sensor: {e}"),
        };

        if let Err(e) = self.mqtt.unsubscribe(&sensor.topic, &sensor.broker, sensor.broker_port).await {
            log::warn!("MQTT unsubscribe error: {e}");
        }

        match self.store.delete_sensor(&sensor.name).await {
            Ok(true) => {
                if let Some(ref tx) = self.dashboard_tx {
                    let _ = tx.send(DashboardMessage::WidgetRemove { id: sensor.name.clone() });
                }
                format!("OK: sensor '{}' removed", params.name)
            }
            Ok(false) => format!("Sensor '{}' not found", params.name),
            Err(e) => format!("Error removing sensor: {e}"),
        }
    }

    // ── list_sensors ──────────────────────────────────────────────

    async fn exec_list_sensors(&self) -> String {
        match self.store.list_sensors().await {
            Ok(sensors) if sensors.is_empty() => "No sensors configured.".into(),
            Ok(sensors) => sensors
                .iter()
                .map(|s| {
                    let mut parts = vec![
                        format!("{}: ({}) → {} on {}:{}, widget: {}, unit: {}",
                            s.name, s.widget_type, s.topic, s.broker, s.broker_port, s.widget_type, s.unit)
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
                    if s.alert_min.is_some() || s.alert_max.is_some() {
                        parts.push(format!("  alerts: {}..{}",
                            s.alert_min.map_or("-∞".into(), |v| format!("{:.1}", v)),
                            s.alert_max.map_or("+∞".into(), |v| format!("{:.1}", v))));
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

        let sensor = match self.store.get_sensor_by_name(&params.name).await {
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
                            sensor_id: sensor.name.clone(),
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

    async fn exec_set_broker(&self, arguments: &str) -> String {
        let params: SetBrokerParams = match serde_json::from_str(arguments) {
            Ok(p) => p,
            Err(e) => return format!("Error parsing parameters: {e}"),
        };

        match self.store.set_mqtt_broker(&params.broker, params.port).await {
            Ok(()) => format!("OK: MQTT broker set to {}:{}", params.broker, params.port),
            Err(e) => format!("Error setting broker: {e}"),
        }
    }
}
