use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensorReadingRecord {
    pub id: i64,
    pub sensor_id: String,
    pub value: String,
    pub timestamp: i64,
}

pub struct ReadingDb {
    conn: Mutex<Connection>,
}

impl ReadingDb {
    pub fn open(path: &str) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;

        conn.execute_batch("PRAGMA foreign_keys = OFF;")?;

        let has_fk = Self::table_has_foreign_key(&conn);
        if has_fk {
            Self::migrate_remove_fk(&conn);
        }

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sensor_readings (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                sensor_id   TEXT NOT NULL,
                value       TEXT NOT NULL,
                timestamp   INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_readings_sensor_time
                ON sensor_readings(sensor_id, timestamp DESC);",
        )?;

        let _: Result<(), _> = conn.execute_batch("DROP TABLE IF EXISTS sensors;");

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn table_has_foreign_key(conn: &Connection) -> bool {
        let Ok(mut stmt) = conn.prepare("PRAGMA foreign_key_list(sensor_readings)") else {
            return false;
        };
        let Ok(mut rows) = stmt.query([]) else {
            return false;
        };
        rows.next().ok().flatten().is_some()
    }

    fn migrate_remove_fk(conn: &Connection) {
        let steps = [
            "ALTER TABLE sensor_readings RENAME TO sensor_readings_old;",
            "CREATE TABLE sensor_readings (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                sensor_id   TEXT NOT NULL,
                value       TEXT NOT NULL,
                timestamp   INTEGER NOT NULL
            );",
            "INSERT INTO sensor_readings (id, sensor_id, value, timestamp)
                SELECT id, sensor_id, value, timestamp FROM sensor_readings_old;",
            "DROP TABLE sensor_readings_old;",
        ];
        for step in steps {
            if let Err(e) = conn.execute_batch(step) {
                log::warn!("migration step failed: {e}");
            }
        }
        log::info!("migrated sensor_readings: removed foreign key constraint");
    }

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

    pub fn get_latest_reading(&self, sensor_id: &str) -> Option<SensorReadingRecord> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, sensor_id, value, timestamp FROM sensor_readings
             WHERE sensor_id = ?1 ORDER BY timestamp DESC LIMIT 1",
        ).ok()?;
        let row = stmt.query_row(rusqlite::params![sensor_id], |row| {
            Ok(SensorReadingRecord {
                id: row.get(0)?,
                sensor_id: row.get(1)?,
                value: row.get(2)?,
                timestamp: row.get(3)?,
            })
        }).ok()?;
        Some(row)
    }

    pub fn prune_readings_older_than(&self, sensor_id: &str, retain_days: i32) -> Result<usize, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let cutoff = now_secs - (retain_days as i64 * 86400);
        let n = conn.execute(
            "DELETE FROM sensor_readings WHERE sensor_id = ?1 AND timestamp < ?2",
            rusqlite::params![sensor_id, cutoff],
        )?;
        Ok(n)
    }
}