mod agent;
mod config;
mod mqtt;
mod repl;
mod server;
mod storage;
mod store;
mod transform;

use clap::{Parser, Subcommand};
use config::Config;
use log::info;
use server::DashboardMessage;
use tokio::sync::broadcast;

#[derive(Parser)]
#[command(name = "pi-sense", about = "Sensor monitoring agent with web dashboard and terminal REPL")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Serve {
        #[arg(short, long, default_value = "pi-sense.json")]
        config: String,
    },
    Repl {
        #[arg(short, long, default_value = "pi-sense.json")]
        config: String,
    },
    Daemon {
        #[arg(short, long, default_value = "pi-sense.json")]
        config: String,
    },
}

#[tokio::main]
async fn main() {
    env_logger::init();
    let cli = Cli::parse();

    if let Err(e) = match cli.command {
        Command::Serve { config } => run_serve(&config).await,
        Command::Repl { config } => run_repl(&config).await,
        Command::Daemon { config } => run_daemon(&config).await,
    } {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

async fn run_serve(config_path: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = Config::load(config_path);
    if config.llm.is_none() {
        return Err("No LLM configured. Run `pi-sense repl` first to set up via /connect, or create pi-sense.json.".into());
    }
    info!("pi-sense serve — port {}", config.server.port);

    let store = std::sync::Arc::new(store::Store::load("sensors.yaml")?);
    let reading_db = std::sync::Arc::new(storage::ReadingDb::open(&config.db_path)?);
    let mqtt_mgr = std::sync::Arc::new(mqtt::MqttManager::new(config.mqtt.client_id.clone()));
    let (dashboard_tx, _) = broadcast::channel::<DashboardMessage>(256);

    if store.mqtt_broker().is_empty() {
        log::warn!("No MQTT broker configured. Set mqtt_broker in sensors.yaml");
    }

    server::serve(config, store, reading_db, mqtt_mgr, dashboard_tx).await
}

async fn run_repl(config_path: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = Config::load(config_path);
    let store = std::sync::Arc::new(store::Store::load("sensors.yaml")?);
    let _reading_db = std::sync::Arc::new(storage::ReadingDb::open(&config.db_path)?);
    let mqtt_mgr = std::sync::Arc::new(mqtt::MqttManager::new(config.mqtt.client_id.clone()));
    let (dashboard_tx, _) = broadcast::channel::<DashboardMessage>(256);
    let agent = agent::Agent::new(config.clone(), store.clone(), mqtt_mgr, dashboard_tx);
    let agent = std::sync::Arc::new(tokio::sync::Mutex::new(agent));

    let mut r = repl::Repl::new(agent, config, store);
    r.run().await?;
    Ok(())
}

async fn run_daemon(config_path: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = Config::load(config_path);

    let store = std::sync::Arc::new(store::Store::load("sensors.yaml")?);
    let reading_db = std::sync::Arc::new(storage::ReadingDb::open(&config.db_path)?);
    let mqtt_mgr = std::sync::Arc::new(mqtt::MqttManager::new(config.mqtt.client_id.clone()));
    let (dashboard_tx, _) = broadcast::channel::<DashboardMessage>(256);

    if store.mqtt_broker().is_empty() {
        log::warn!("No MQTT broker configured. Set mqtt_broker in sensors.yaml");
    }

    let server_handle = {
        let store = store.clone();
        let reading_db = reading_db.clone();
        let mqtt_mgr = mqtt_mgr.clone();
        let dashboard_tx = dashboard_tx.clone();
        let config = config.clone();
        tokio::spawn(async move {
            server::serve(config, store, reading_db, mqtt_mgr, dashboard_tx).await
        })
    };

    let agent = agent::Agent::new(config.clone(), store.clone(), mqtt_mgr, dashboard_tx);
    let agent = std::sync::Arc::new(tokio::sync::Mutex::new(agent));

    let mut r = repl::Repl::new(agent, config, store);
    r.run().await?;

    server_handle.abort();
    Ok(())
}