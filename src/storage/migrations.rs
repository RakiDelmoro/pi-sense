use rusqlite::Connection;

pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sensors (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            topic TEXT NOT NULL,
            broker TEXT NOT NULL,
            broker_port INTEGER NOT NULL DEFAULT 1883,
            widget_type TEXT NOT NULL CHECK(widget_type IN ('text','gauge','chart','switch')),
            unit TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    )
}