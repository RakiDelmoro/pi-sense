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
}

pub struct Db {
    conn: Mutex<Connection>,
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
            "INSERT INTO sensors (id, name, topic, broker, broker_port, widget_type, unit, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                sensor.id,
                sensor.name,
                sensor.topic,
                sensor.broker,
                sensor.broker_port,
                sensor.widget_type,
                sensor.unit,
                sensor.created_at,
                sensor.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_sensor(&self, id: &str) -> Result<bool, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute("DELETE FROM sensors WHERE id = ?1", rusqlite::params![id])?;
        Ok(n > 0)
    }

    #[allow(dead_code)]
    pub fn get_sensor(&self, id: &str) -> Result<Option<Sensor>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, topic, broker, broker_port, widget_type, unit, created_at, updated_at
             FROM sensors WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![id], |row| {
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
            })
        })?;
        match rows.next() {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
    }

    pub fn get_sensor_by_name(&self, name: &str) -> Result<Option<Sensor>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, topic, broker, broker_port, widget_type, unit, created_at, updated_at
             FROM sensors WHERE name = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![name], |row| {
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
            })
        })?;
        match rows.next() {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
    }

    pub fn list_sensors(&self) -> Result<Vec<Sensor>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, topic, broker, broker_port, widget_type, unit, created_at, updated_at
             FROM sensors ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], |row| {
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
            })
        })?;
        let mut sensors = Vec::new();
        for r in rows {
            sensors.push(r?);
        }
        Ok(sensors)
    }
}