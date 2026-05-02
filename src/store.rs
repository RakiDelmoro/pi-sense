use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex as StdMutex;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sensor {
    pub name: String,
    pub topic: String,
    pub broker: String,
    pub broker_port: u16,
    pub widget_type: String,
    pub unit: String,

    pub gauge_min: f64,
    pub gauge_max: f64,
    pub gauge_color_low: String,
    pub gauge_color_mid: String,
    pub gauge_color_high: String,
    pub gauge_threshold_low: f64,
    pub gauge_threshold_high: f64,

    pub chart_color: String,

    pub history_enabled: bool,
    pub history_chart: bool,
    pub history_retain_days: i32,

    pub display_precision: i32,
    pub card_accent: String,
    pub card_size: String,

    pub publish_topic: Option<String>,
    pub publish_payload_on: String,
    pub publish_payload_off: String,
    pub allow_publish: bool,

    pub value_transform: Option<String>,
    pub alert_min: Option<f64>,
    pub alert_max: Option<f64>,
}

#[derive(Debug, Default)]
pub struct SensorUpdate {
    pub topic: Option<String>,
    pub broker: Option<String>,
    pub broker_port: Option<u16>,
    pub widget_type: Option<String>,
    pub unit: Option<String>,
    pub gauge_min: Option<f64>,
    pub gauge_max: Option<f64>,
    pub gauge_color_low: Option<String>,
    pub gauge_color_mid: Option<String>,
    pub gauge_color_high: Option<String>,
    pub gauge_threshold_low: Option<f64>,
    pub gauge_threshold_high: Option<f64>,
    pub chart_color: Option<String>,
    pub history_enabled: Option<bool>,
    pub history_chart: Option<bool>,
    pub history_retain_days: Option<i32>,
    pub display_precision: Option<i32>,
    pub card_accent: Option<String>,
    pub card_size: Option<String>,
    pub publish_topic: Option<Option<String>>,
    pub publish_payload_on: Option<String>,
    pub publish_payload_off: Option<String>,
    pub allow_publish: Option<bool>,
    pub value_transform: Option<Option<String>>,
    pub alert_min: Option<Option<f64>>,
    pub alert_max: Option<Option<f64>>,
}

impl Default for Sensor {
    fn default() -> Self {
        Self {
            name: String::new(),
            topic: String::new(),
            broker: String::new(),
            broker_port: 1883,
            widget_type: "text".into(),
            unit: String::new(),

            gauge_min: 0.0,
            gauge_max: 100.0,
            gauge_color_low: "#4caf50".into(),
            gauge_color_mid: "#4fc3f7".into(),
            gauge_color_high: "#ef5350".into(),
            gauge_threshold_low: 30.0,
            gauge_threshold_high: 70.0,

            chart_color: "#4fc3f7".into(),

            history_enabled: true,
            history_chart: false,
            history_retain_days: 30,

            display_precision: 1,
            card_accent: "#4fc3f7".into(),
            card_size: "medium".into(),

            publish_topic: None,
            publish_payload_on: "1".into(),
            publish_payload_off: "0".into(),
            allow_publish: false,

            value_transform: None,
            alert_min: None,
            alert_max: None,
        }
    }
}

// ── YAML structures ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct SensorsYaml {
    #[serde(default)]
    mqtt_broker: String,
    #[serde(default = "default_mqtt_port")]
    mqtt_port: u16,
    #[serde(default)]
    sensors: Vec<SensorYaml>,
}

fn default_mqtt_port() -> u16 { 1883 }

#[derive(Debug, Serialize, Deserialize)]
struct SensorYaml {
    name: String,
    mqtt_topic: String,
    #[serde(default)]
    broker: Option<String>,
    #[serde(default)]
    broker_port: Option<u16>,
    #[serde(default = "default_widget")]
    widget: String,
    #[serde(default)]
    unit: String,
    #[serde(default)]
    gauge: Option<GaugeYaml>,
    #[serde(default)]
    chart: Option<ChartYaml>,
    #[serde(default)]
    history: Option<HistoryYaml>,
    #[serde(default)]
    display: Option<DisplayYaml>,
    #[serde(default)]
    card: Option<CardYaml>,
    #[serde(default)]
    alert: Option<AlertYaml>,
    #[serde(default)]
    transform: Option<String>,
    #[serde(default)]
    publish: Option<PublishYaml>,
}

fn default_widget() -> String { "text".into() }

#[derive(Debug, Serialize, Deserialize)]
struct GaugeYaml {
    #[serde(default = "default_zero")]
    min: f64,
    #[serde(default = "default_hundred")]
    max: f64,
    #[serde(default = "default_color_low")]
    color_low: String,
    #[serde(default = "default_color_mid")]
    color_mid: String,
    #[serde(default = "default_color_high")]
    color_high: String,
    #[serde(default = "default_threshold_low")]
    threshold_low: f64,
    #[serde(default = "default_threshold_high")]
    threshold_high: f64,
}

fn default_zero() -> f64 { 0.0 }
fn default_hundred() -> f64 { 100.0 }
fn default_color_low() -> String { "#4caf50".into() }
fn default_color_mid() -> String { "#4fc3f7".into() }
fn default_color_high() -> String { "#ef5350".into() }
fn default_threshold_low() -> f64 { 30.0 }
fn default_threshold_high() -> f64 { 70.0 }

#[derive(Debug, Serialize, Deserialize)]
struct ChartYaml {
    #[serde(default = "default_chart_color")]
    color: String,
}

fn default_chart_color() -> String { "#4fc3f7".into() }

#[derive(Debug, Serialize, Deserialize)]
struct HistoryYaml {
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default = "default_retain")]
    retain: i32,
    #[serde(default)]
    chart: bool,
}

fn default_true() -> bool { true }
fn default_retain() -> i32 { 30 }

#[derive(Debug, Serialize, Deserialize)]
struct DisplayYaml {
    #[serde(default = "default_precision")]
    precision: i32,
}

fn default_precision() -> i32 { 1 }

#[derive(Debug, Serialize, Deserialize)]
struct CardYaml {
    #[serde(default = "default_accent")]
    accent: String,
    #[serde(default = "default_size")]
    size: String,
}

fn default_accent() -> String { "#4fc3f7".into() }
fn default_size() -> String { "medium".into() }

#[derive(Debug, Serialize, Deserialize)]
struct AlertYaml {
    #[serde(default)]
    min: Option<f64>,
    #[serde(default)]
    max: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PublishYaml {
    #[serde(default)]
    topic: Option<String>,
    #[serde(default = "default_payload_on")]
    payload_on: String,
    #[serde(default = "default_payload_off")]
    payload_off: String,
    #[serde(default)]
    allow: bool,
}

fn default_payload_on() -> String { "1".into() }
fn default_payload_off() -> String { "0".into() }

// ── Mapping: YAML ↔ flat Sensor ──────────────────────────────────

fn yaml_to_sensor(sy: &SensorYaml, global_broker: &str, global_port: u16) -> Sensor {
    let g = sy.gauge.as_ref();
    let ch = sy.chart.as_ref();
    let h = sy.history.as_ref();
    let d = sy.display.as_ref();
    let c = sy.card.as_ref();
    let a = sy.alert.as_ref();
    let p = sy.publish.as_ref();

    Sensor {
        name: sy.name.clone(),
        topic: sy.mqtt_topic.clone(),
        broker: sy.broker.clone().unwrap_or_else(|| global_broker.to_string()),
        broker_port: sy.broker_port.unwrap_or(global_port),
        widget_type: sy.widget.clone(),
        unit: sy.unit.clone(),

        gauge_min: g.map(|g| g.min).unwrap_or(0.0),
        gauge_max: g.map(|g| g.max).unwrap_or(100.0),
        gauge_color_low: g.map(|g| g.color_low.clone()).unwrap_or_else(default_color_low),
        gauge_color_mid: g.map(|g| g.color_mid.clone()).unwrap_or_else(default_color_mid),
        gauge_color_high: g.map(|g| g.color_high.clone()).unwrap_or_else(default_color_high),
        gauge_threshold_low: g.map(|g| g.threshold_low).unwrap_or_else(default_threshold_low),
        gauge_threshold_high: g.map(|g| g.threshold_high).unwrap_or_else(default_threshold_high),

        chart_color: ch.map(|c| c.color.clone()).unwrap_or_else(default_chart_color),

        history_enabled: h.map(|h| h.enabled).unwrap_or(true),
        history_chart: h.map(|h| h.chart).unwrap_or(false),
        history_retain_days: h.map(|h| h.retain).unwrap_or_else(default_retain),

        display_precision: d.map(|d| d.precision).unwrap_or_else(default_precision),

        card_accent: c.map(|c| c.accent.clone()).unwrap_or_else(default_accent),
        card_size: c.map(|c| c.size.clone()).unwrap_or_else(default_size),

        publish_topic: p.and_then(|p| p.topic.clone()),
        publish_payload_on: p.map(|p| p.payload_on.clone()).unwrap_or_else(default_payload_on),
        publish_payload_off: p.map(|p| p.payload_off.clone()).unwrap_or_else(default_payload_off),
        allow_publish: p.map(|p| p.allow).unwrap_or(false),

        value_transform: sy.transform.clone(),
        alert_min: a.as_ref().and_then(|a| a.min),
        alert_max: a.as_ref().and_then(|a| a.max),
    }
}

fn sensor_to_yaml(s: &Sensor) -> SensorYaml {
    let gauge = if s.widget_type == "gauge" {
        Some(GaugeYaml {
            min: s.gauge_min,
            max: s.gauge_max,
            color_low: s.gauge_color_low.clone(),
            color_mid: s.gauge_color_mid.clone(),
            color_high: s.gauge_color_high.clone(),
            threshold_low: s.gauge_threshold_low,
            threshold_high: s.gauge_threshold_high,
        })
    } else {
        None
    };

    let chart = None;

    let history = Some(HistoryYaml {
        enabled: s.history_enabled,
        retain: s.history_retain_days,
        chart: s.history_chart,
    });

    let display = if s.display_precision != 1 {
        Some(DisplayYaml { precision: s.display_precision })
    } else {
        None
    };

    let card = if s.card_accent != "#4fc3f7" || s.card_size != "medium" {
        Some(CardYaml {
            accent: s.card_accent.clone(),
            size: s.card_size.clone(),
        })
    } else {
        None
    };

    let alert = if s.alert_min.is_some() || s.alert_max.is_some() {
        Some(AlertYaml {
            min: s.alert_min,
            max: s.alert_max,
        })
    } else {
        None
    };

    let publish = if s.allow_publish || s.publish_topic.is_some() {
        Some(PublishYaml {
            topic: s.publish_topic.clone(),
            payload_on: s.publish_payload_on.clone(),
            payload_off: s.publish_payload_off.clone(),
            allow: s.allow_publish,
        })
    } else {
        None
    };

    SensorYaml {
        name: s.name.clone(),
        mqtt_topic: s.topic.clone(),
        broker: if s.broker.is_empty() { None } else { Some(s.broker.clone()) },
        broker_port: if s.broker_port == 1883 { None } else { Some(s.broker_port) },
        widget: s.widget_type.clone(),
        unit: if s.unit.is_empty() { String::new() } else { s.unit.clone() },
        gauge,
        chart,
        history,
        display,
        card,
        alert,
        transform: s.value_transform.clone(),
        publish,
    }
}

// ── Store ────────────────────────────────────────────────────────

pub struct Store {
    path: String,
    sensors: Mutex<Vec<Sensor>>,
    mqtt_broker: StdMutex<String>,
    mqtt_port: StdMutex<u16>,
}

impl Store {
    pub fn load(path: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let (yaml_broker, yaml_port, sensors) = if Path::new(path).exists() {
            let content = std::fs::read_to_string(path)?;
            let yaml: SensorsYaml = if content.trim().is_empty() {
                SensorsYaml { mqtt_broker: String::new(), mqtt_port: 1883, sensors: vec![] }
            } else {
                serde_yaml_ng::from_str(&content)?
            };
            let broker = yaml.mqtt_broker.clone();
            let port = yaml.mqtt_port;
            let sensors: Vec<Sensor> = yaml.sensors.iter()
                .map(|sy| yaml_to_sensor(sy, &broker, port))
                .collect();
            (broker, port, sensors)
        } else {
            // Try migrating from old sensors.json
            let json_path = "sensors.json";
            if Path::new(json_path).exists() {
                let content = std::fs::read_to_string(json_path)?;
                let old_sensors: Vec<SensorOld> = if content.trim().is_empty() {
                    vec![]
                } else {
                    serde_json::from_str(&content)?
                };
                let sensors: Vec<Sensor> = old_sensors.into_iter().map(|o| o.into()).collect();
                log::info!("migrated {} sensors from JSON to YAML", sensors.len());
                (String::new(), 1883, sensors)
            } else {
                (String::new(), 1883, vec![])
            }
        };

        Ok(Self {
            path: path.into(),
            sensors: Mutex::new(sensors),
            mqtt_broker: StdMutex::new(yaml_broker),
            mqtt_port: StdMutex::new(yaml_port),
        })
    }

    pub fn mqtt_broker(&self) -> String {
        self.mqtt_broker.lock().unwrap().clone()
    }

    pub async fn set_mqtt_broker(&self, broker: &str, port: u16) -> Result<(), String> {
        *self.mqtt_broker.lock().unwrap() = broker.to_string();
        *self.mqtt_port.lock().unwrap() = port;
        self.save(&self.sensors).await
    }

    pub async fn list_sensors(&self) -> Result<Vec<Sensor>, String> {
        let guard = self.sensors.lock().await;
        Ok(guard.clone())
    }

    pub async fn get_sensor(&self, name: &str) -> Result<Option<Sensor>, String> {
        let guard = self.sensors.lock().await;
        Ok(guard.iter().find(|s| s.name == name).cloned())
    }

    pub async fn get_sensor_by_name(&self, name: &str) -> Result<Option<Sensor>, String> {
        self.get_sensor(name).await
    }

    pub async fn insert_sensor(&self, sensor: &Sensor) -> Result<(), String> {
        {
            let mut guard = self.sensors.lock().await;
            guard.push(sensor.clone());
        }
        self.save(&self.sensors).await
    }

    pub async fn update_sensor(&self, name: &str, updates: &SensorUpdate) -> Result<bool, String> {
        let modified = {
            let mut guard = self.sensors.lock().await;
            let Some(s) = guard.iter_mut().find(|s| s.name == name) else {
                return Ok(false);
            };

            if let Some(ref v) = updates.topic { s.topic = v.clone(); }
            if let Some(ref v) = updates.broker { s.broker = v.clone(); }
            if let Some(v) = updates.broker_port { s.broker_port = v; }
            if let Some(ref v) = updates.widget_type { s.widget_type = v.clone(); }
            if let Some(ref v) = updates.unit { s.unit = v.clone(); }
            if let Some(v) = updates.gauge_min { s.gauge_min = v; }
            if let Some(v) = updates.gauge_max { s.gauge_max = v; }
            if let Some(ref v) = updates.gauge_color_low { s.gauge_color_low = v.clone(); }
            if let Some(ref v) = updates.gauge_color_mid { s.gauge_color_mid = v.clone(); }
            if let Some(ref v) = updates.gauge_color_high { s.gauge_color_high = v.clone(); }
            if let Some(v) = updates.gauge_threshold_low { s.gauge_threshold_low = v; }
            if let Some(v) = updates.gauge_threshold_high { s.gauge_threshold_high = v; }
            if let Some(ref v) = updates.chart_color { s.chart_color = v.clone(); }
            if let Some(v) = updates.history_enabled { s.history_enabled = v; }
            if let Some(v) = updates.history_chart { s.history_chart = v; }
            if let Some(v) = updates.history_retain_days { s.history_retain_days = v; }
            if let Some(v) = updates.display_precision { s.display_precision = v; }
            if let Some(ref v) = updates.card_accent { s.card_accent = v.clone(); }
            if let Some(ref v) = updates.card_size { s.card_size = v.clone(); }

            if let Some(ref v) = updates.publish_topic {
                s.publish_topic = v.clone();
            }
            if let Some(ref v) = updates.publish_payload_on { s.publish_payload_on = v.clone(); }
            if let Some(ref v) = updates.publish_payload_off { s.publish_payload_off = v.clone(); }
            if let Some(v) = updates.allow_publish { s.allow_publish = v; }

            if let Some(ref v) = updates.value_transform {
                s.value_transform = v.clone();
            }
            if let Some(v) = updates.alert_min { s.alert_min = v; }
            if let Some(v) = updates.alert_max { s.alert_max = v; }

            true
        };

        self.save(&self.sensors).await?;
        Ok(modified)
    }

    pub async fn delete_sensor(&self, name: &str) -> Result<bool, String> {
        let found = {
            let mut guard = self.sensors.lock().await;
            let len_before = guard.len();
            guard.retain(|s| s.name != name);
            guard.len() < len_before
        };

        if found {
            self.save(&self.sensors).await?;
        }
        Ok(found)
    }

    async fn save(&self, sensors_lock: &Mutex<Vec<Sensor>>) -> Result<(), String> {
        let sensors = sensors_lock.lock().await;
        let broker = self.mqtt_broker.lock().unwrap().clone();
        let port = *self.mqtt_port.lock().unwrap();

        let yaml_data = SensorsYaml {
            mqtt_broker: broker.clone(),
            mqtt_port: port,
            sensors: sensors.iter().map(sensor_to_yaml).collect(),
        };

        let yaml_str = serde_yaml_ng::to_string(&yaml_data)
            .map_err(|e| format!("serialize YAML: {e}"))?;

        let tmp = format!("{}.tmp", self.path);
        std::fs::write(&tmp, yaml_str)
            .map_err(|e| format!("write tmp: {e}"))?;

        std::fs::rename(&tmp, &self.path)
            .map_err(|e| format!("rename: {e}"))?;

        Ok(())
    }
}

// ── Old Sensor format (for JSON migration) ────────────────────────

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct SensorOld {
    id: String,
    name: String,
    topic: String,
    broker: String,
    broker_port: u16,
    widget_type: String,
    unit: String,
    gauge_min: f64,
    gauge_max: f64,
    gauge_color_low: String,
    gauge_color_mid: String,
    gauge_color_high: String,
    gauge_threshold_low: f64,
    gauge_threshold_high: f64,
    chart_color: String,
    chart_max_points: i32,
    display_precision: i32,
    card_accent: String,
    card_size: String,
    publish_topic: Option<String>,
    publish_payload_on: String,
    publish_payload_off: String,
    allow_publish: bool,
    value_transform: Option<String>,
    alert_min: f64,
    alert_max: f64,
}

impl From<SensorOld> for Sensor {
    fn from(o: SensorOld) -> Self {
        let was_chart = o.widget_type == "chart";
        let wt = if was_chart { "text".to_string() } else { o.widget_type };
        Sensor {
            name: o.name,
            topic: o.topic,
            broker: o.broker,
            broker_port: o.broker_port,
            widget_type: wt,
            unit: o.unit,
            gauge_min: o.gauge_min,
            gauge_max: o.gauge_max,
            gauge_color_low: o.gauge_color_low,
            gauge_color_mid: o.gauge_color_mid,
            gauge_color_high: o.gauge_color_high,
            gauge_threshold_low: o.gauge_threshold_low,
            gauge_threshold_high: o.gauge_threshold_high,
            chart_color: o.chart_color,
            history_enabled: true,
            history_chart: was_chart,
            history_retain_days: 30,
            display_precision: o.display_precision,
            card_accent: o.card_accent,
            card_size: o.card_size,
            publish_topic: o.publish_topic,
            publish_payload_on: o.publish_payload_on,
            publish_payload_off: o.publish_payload_off,
            allow_publish: o.allow_publish,
            value_transform: o.value_transform,
            alert_min: if o.alert_min.is_finite() { Some(o.alert_min) } else { None },
            alert_max: if o.alert_max.is_finite() { Some(o.alert_max) } else { None },
        }
    }
}