use rusqlite::Connection;

pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap_or(0);

    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sensors (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                topic       TEXT NOT NULL,
                broker      TEXT NOT NULL,
                broker_port INTEGER NOT NULL DEFAULT 1883,
                widget_type TEXT NOT NULL CHECK(widget_type IN ('text','gauge','chart','switch')),
                unit        TEXT NOT NULL DEFAULT '',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );",
        )?;
        conn.pragma_update(None, "user_version", 1)?;
    }

    if version < 2 {
        // Add v2 columns (widget design, publish, transform, alerts).
        // Ignore errors if columns already exist.
        let v2_columns = [
            "ALTER TABLE sensors ADD COLUMN gauge_min REAL",
            "ALTER TABLE sensors ADD COLUMN gauge_max REAL",
            "ALTER TABLE sensors ADD COLUMN gauge_color_low TEXT NOT NULL DEFAULT '#4caf50'",
            "ALTER TABLE sensors ADD COLUMN gauge_color_mid TEXT NOT NULL DEFAULT '#4fc3f7'",
            "ALTER TABLE sensors ADD COLUMN gauge_color_high TEXT NOT NULL DEFAULT '#ef5350'",
            "ALTER TABLE sensors ADD COLUMN gauge_threshold_low REAL",
            "ALTER TABLE sensors ADD COLUMN gauge_threshold_high REAL",
            "ALTER TABLE sensors ADD COLUMN chart_color TEXT NOT NULL DEFAULT '#4fc3f7'",
            "ALTER TABLE sensors ADD COLUMN chart_max_points INTEGER NOT NULL DEFAULT 120",
            "ALTER TABLE sensors ADD COLUMN display_precision INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE sensors ADD COLUMN card_accent TEXT NOT NULL DEFAULT '#4fc3f7'",
            "ALTER TABLE sensors ADD COLUMN card_size TEXT NOT NULL DEFAULT 'medium' CHECK(card_size IN ('small','medium','large'))",
            "ALTER TABLE sensors ADD COLUMN publish_topic TEXT",
            "ALTER TABLE sensors ADD COLUMN publish_payload_on TEXT NOT NULL DEFAULT '1'",
            "ALTER TABLE sensors ADD COLUMN publish_payload_off TEXT NOT NULL DEFAULT '0'",
            "ALTER TABLE sensors ADD COLUMN allow_publish INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE sensors ADD COLUMN value_transform TEXT",
            "ALTER TABLE sensors ADD COLUMN alert_min REAL",
            "ALTER TABLE sensors ADD COLUMN alert_max REAL",
        ];
        for sql in &v2_columns {
            let _ = conn.execute(sql, []);
        }

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sensor_readings (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                sensor_id   TEXT NOT NULL,
                value       TEXT NOT NULL,
                timestamp   INTEGER NOT NULL,
                FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_readings_sensor_time
                ON sensor_readings(sensor_id, timestamp DESC);",
        )?;

        conn.pragma_update(None, "user_version", 2)?;
    }

    Ok(())
}
