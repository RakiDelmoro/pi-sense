pub mod migrations;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sensor {
    pub id: String,
    pub name: String,
    pub topic: String,
    pub broker: String,
    pub broker_port: u16,
    pub widget_type: String,
    pub unit: String,
    pub created_at: String,
    pub updated_at: String,

    pub gauge_min: f64,
    pub gauge_max: f64,
    pub gauge_color_low: String,
    pub gauge_color_mid: String,
    pub gauge_color_high: String,
    pub gauge_threshold_low: f64,
    pub gauge_threshold_high: f64,

    pub chart_color: String,
    pub chart_max_points: i32,

    pub display_precision: i32,
    pub card_accent: String,
    pub card_size: String,

    pub publish_topic: Option<String>,
    pub publish_payload_on: String,
    pub publish_payload_off: String,
    pub allow_publish: bool,

    pub value_transform: Option<String>,
    pub alert_min: f64,
    pub alert_max: f64,
}

#[derive(Debug, Default)]
pub struct SensorUpdate {
    pub new_name: Option<String>,
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
    pub chart_max_points: Option<i32>,
    pub display_precision: Option<i32>,
    pub card_accent: Option<String>,
    pub card_size: Option<String>,
    pub publish_topic: Option<Option<String>>,
    pub publish_payload_on: Option<String>,
    pub publish_payload_off: Option<String>,
    pub allow_publish: Option<bool>,
    pub value_transform: Option<Option<String>>,
    pub alert_min: Option<f64>,
    pub alert_max: Option<f64>,
}

impl Default for Sensor {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            topic: String::new(),
            broker: String::new(),
            broker_port: 1883,
            widget_type: "text".into(),
            unit: String::new(),
            created_at: String::new(),
            updated_at: String::new(),

            gauge_min: 0.0,
            gauge_max: 100.0,
            gauge_color_low: "#4caf50".into(),
            gauge_color_mid: "#4fc3f7".into(),
            gauge_color_high: "#ef5350".into(),
            gauge_threshold_low: 30.0,
            gauge_threshold_high: 70.0,

            chart_color: "#4fc3f7".into(),
            chart_max_points: 120,

            display_precision: 1,
            card_accent: "#4fc3f7".into(),
            card_size: "medium".into(),

            publish_topic: None,
            publish_payload_on: "1".into(),
            publish_payload_off: "0".into(),
            allow_publish: false,

            value_transform: None,
            alert_min: f64::NEG_INFINITY,
            alert_max: f64::INFINITY,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensorReadingRecord {
    pub id: i64,
    pub sensor_id: String,
    pub value: String,
    pub timestamp: i64,
}

pub struct Db {
    conn: Mutex<Connection>,
}

fn sensor_from_row(row: &rusqlite::Row) -> Result<Sensor, rusqlite::Error> {
    Ok(Sensor {
        id: row.get(0)?,
        name: row.get(1)?,
        topic: row.get(2)?,
        broker: row.get(3)?,
        broker_port: row.get(4)?,
        widget_type: row.get(5)?,
        unit: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        gauge_min: row.get(9).unwrap_or(0.0),
        gauge_max: row.get(10).unwrap_or(100.0),
        gauge_color_low: row.get(11).unwrap_or_else(|_| "#4caf50".into()),
        gauge_color_mid: row.get(12).unwrap_or_else(|_| "#4fc3f7".into()),
        gauge_color_high: row.get(13).unwrap_or_else(|_| "#ef5350".into()),
        gauge_threshold_low: row.get(14).unwrap_or(30.0),
        gauge_threshold_high: row.get(15).unwrap_or(70.0),
        chart_color: row.get(16).unwrap_or_else(|_| "#4fc3f7".into()),
        chart_max_points: row.get(17).unwrap_or(120),
        display_precision: row.get(18).unwrap_or(1),
        card_accent: row.get(19).unwrap_or_else(|_| "#4fc3f7".into()),
        card_size: row.get(20).unwrap_or_else(|_| "medium".into()),
        publish_topic: row.get(21)?,
        publish_payload_on: row.get(22).unwrap_or_else(|_| "1".into()),
        publish_payload_off: row.get(23).unwrap_or_else(|_| "0".into()),
        allow_publish: row.get::<_, i32>(24).unwrap_or(0) != 0,
        value_transform: row.get(25)?,
        alert_min: row.get(26).unwrap_or(f64::NEG_INFINITY),
        alert_max: row.get(27).unwrap_or(f64::INFINITY),
    })
}

impl Db {
    pub fn open(path: &str) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        migrations::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn insert_sensor(&self, sensor: &Sensor) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sensors (
                id, name, topic, broker, broker_port, widget_type, unit,
                created_at, updated_at,
                gauge_min, gauge_max, gauge_color_low, gauge_color_mid, gauge_color_high,
                gauge_threshold_low, gauge_threshold_high,
                chart_color, chart_max_points, display_precision, card_accent, card_size,
                publish_topic, publish_payload_on, publish_payload_off, allow_publish,
                value_transform, alert_min, alert_max
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                ?17, ?18, ?19, ?20, ?21,
                ?22, ?23, ?24, ?25,
                ?26, ?27, ?28
            )",
            rusqlite::params![
                sensor.id, sensor.name, sensor.topic, sensor.broker, sensor.broker_port,
                sensor.widget_type, sensor.unit, sensor.created_at, sensor.updated_at,
                sensor.gauge_min, sensor.gauge_max, &sensor.gauge_color_low,
                &sensor.gauge_color_mid, &sensor.gauge_color_high,
                sensor.gauge_threshold_low, sensor.gauge_threshold_high,
                &sensor.chart_color, sensor.chart_max_points, sensor.display_precision,
                &sensor.card_accent, &sensor.card_size,
                sensor.publish_topic.as_deref(), &sensor.publish_payload_on, &sensor.publish_payload_off,
                sensor.allow_publish as i32,
                sensor.value_transform.as_deref(), sensor.alert_min, sensor.alert_max,
            ],
        )?;
        Ok(())
    }

    pub fn delete_sensor(&self, id: &str) -> Result<bool, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute("DELETE FROM sensors WHERE id = ?1", rusqlite::params![id])?;
        Ok(n > 0)
    }

    pub fn get_sensor(&self, id: &str) -> Result<Option<Sensor>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, topic, broker, broker_port, widget_type, unit, created_at, updated_at,
             gauge_min, gauge_max, gauge_color_low, gauge_color_mid, gauge_color_high,
             gauge_threshold_low, gauge_threshold_high,
             chart_color, chart_max_points, display_precision, card_accent, card_size,
             publish_topic, publish_payload_on, publish_payload_off, allow_publish,
             value_transform, alert_min, alert_max
             FROM sensors WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![id], sensor_from_row)?;
        match rows.next() {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
    }

    pub fn get_sensor_by_name(&self, name: &str) -> Result<Option<Sensor>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, topic, broker, broker_port, widget_type, unit, created_at, updated_at,
             gauge_min, gauge_max, gauge_color_low, gauge_color_mid, gauge_color_high,
             gauge_threshold_low, gauge_threshold_high,
             chart_color, chart_max_points, display_precision, card_accent, card_size,
             publish_topic, publish_payload_on, publish_payload_off, allow_publish,
             value_transform, alert_min, alert_max
             FROM sensors WHERE name = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![name], sensor_from_row)?;
        match rows.next() {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
    }

    pub fn list_sensors(&self) -> Result<Vec<Sensor>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, topic, broker, broker_port, widget_type, unit, created_at, updated_at,
             gauge_min, gauge_max, gauge_color_low, gauge_color_mid, gauge_color_high,
             gauge_threshold_low, gauge_threshold_high,
             chart_color, chart_max_points, display_precision, card_accent, card_size,
             publish_topic, publish_payload_on, publish_payload_off, allow_publish,
             value_transform, alert_min, alert_max
             FROM sensors ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], sensor_from_row)?;
        let mut sensors = Vec::new();
        for r in rows {
            sensors.push(r?);
        }
        Ok(sensors)
    }

    pub fn update_sensor(&self, id: &str, updates: &SensorUpdate) -> Result<bool, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut set_clauses = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        macro_rules! push_opt {
            ($field:ident) => {
                if let Some(ref v) = updates.$field {
                    set_clauses.push(format!("{} = ?", set_clauses.len() + 1));
                    params.push(Box::new(v.clone()));
                }
            };
            ($field:ident, $conv:expr) => {
                if let Some(v) = updates.$field {
                    set_clauses.push(format!("{} = ?", set_clauses.len() + 1));
                    params.push(Box::new(($conv)(v)));
                }
            };
        }

        push_opt!(new_name);
        push_opt!(topic);
        push_opt!(broker);
        push_opt!(broker_port);
        push_opt!(widget_type);
        push_opt!(unit);
        push_opt!(gauge_min);
        push_opt!(gauge_max);
        push_opt!(gauge_color_low);
        push_opt!(gauge_color_mid);
        push_opt!(gauge_color_high);
        push_opt!(gauge_threshold_low);
        push_opt!(gauge_threshold_high);
        push_opt!(chart_color);
        push_opt!(chart_max_points);
        push_opt!(display_precision);
        push_opt!(card_accent);
        push_opt!(card_size);

        if let Some(ref v) = updates.publish_topic {
            set_clauses.push(format!("publish_topic = ?{}", set_clauses.len() + 1));
            params.push(Box::new(v.as_deref()));
        }
        push_opt!(publish_payload_on);
        push_opt!(publish_payload_off);
        if let Some(v) = updates.allow_publish {
            set_clauses.push(format!("allow_publish = ?{}", set_clauses.len() + 1));
            params.push(Box::new(v as i32));
        }
        if let Some(ref v) = updates.value_transform {
            set_clauses.push(format!("value_transform = ?{}", set_clauses.len() + 1));
            params.push(Box::new(v.as_deref()));
        }
        push_opt!(alert_min);
        push_opt!(alert_max);

        if set_clauses.is_empty() {
            return Ok(false);
        }

        let sql = format!(
            "UPDATE sensors SET {} WHERE id = ?{}",
            set_clauses.join(", "),
            set_clauses.len() + 1
        );
        params.push(Box::new(id.to_string()));

        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let n = conn.execute(&sql, &param_refs[..])?;
        Ok(n > 0)
    }

    // ── sensor readings ───────────────────────────────────────────

    pub fn insert_reading(&self, sensor_id: &str, value: &str, timestamp: i64) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sensor_readings (sensor_id, value, timestamp) VALUES (?1, ?2, ?3)",
            rusqlite::params![sensor_id, value, timestamp],
        )?;
        Ok(())
    }

    pub fn get_readings(&self, sensor_id: &str, limit: i64) -> Result<Vec<SensorReadingRecord>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, sensor_id, value, timestamp FROM sensor_readings
             WHERE sensor_id = ?1 ORDER BY timestamp DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(rusqlite::params![sensor_id, limit], |row| {
            Ok(SensorReadingRecord {
                id: row.get(0)?,
                sensor_id: row.get(1)?,
                value: row.get(2)?,
                timestamp: row.get(3)?,
            })
        })?;
        let mut records = Vec::new();
        for r in rows {
            records.push(r?);
        }
        Ok(records)
    }

    pub fn prune_readings(&self, sensor_id: &str, keep: i64) -> Result<usize, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "DELETE FROM sensor_readings WHERE sensor_id = ?1 AND id NOT IN (
                SELECT id FROM sensor_readings WHERE sensor_id = ?1 ORDER BY timestamp DESC LIMIT ?2
            )",
            rusqlite::params![sensor_id, keep],
        )?;
        Ok(n)
    }
}
