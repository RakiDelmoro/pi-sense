mod agent;
mod config;
mod mqtt;
mod server;
mod storage;
mod tui;

use clap::{Parser, Subcommand};
use config::Config;
use log::info;
use server::DashboardMessage;
use tokio::sync::broadcast;

#[derive(Parser)]
#[command(name = "pi-sense", about = "Sensor monitoring agent with web dashboard and TUI")]
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
    Tui {
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
        Command::Tui { config } => run_tui(&config).await,
        Command::Daemon { config } => run_daemon(&config).await,
    } {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

async fn run_serve(config_path: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = Config::load(config_path);
    if config.llm.is_none() {
        return Err("No LLM configured. Run `pi-sense tui` first to set up via /connect, or create pi-sense.json.".into());
    }
    info!("pi-sense serve — port {}", config.server.port);
    server::serve(config).await
}

async fn run_tui(config_path: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = Config::load(config_path);
    let db = std::sync::Arc::new(storage::Db::open(&config.db_path)?);
    let mqtt_mgr = std::sync::Arc::new(mqtt::MqttManager::new(config.mqtt.client_id.clone()));
    let (dashboard_tx, _) = broadcast::channel::<DashboardMessage>(256);
    let agent = agent::Agent::new(config.clone(), db, mqtt_mgr, dashboard_tx);
    let agent = std::sync::Arc::new(tokio::sync::Mutex::new(agent));

    let mut app = tui::app::App::new(agent, config);
    app.run().await
}

async fn run_daemon(config_path: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = Config::load(config_path);
    let config_clone = config.clone();

    let server_handle = tokio::spawn(async move {
        server::serve(config_clone).await
    });

    let db = std::sync::Arc::new(storage::Db::open(&config.db_path)?);
    let mqtt_mgr = std::sync::Arc::new(mqtt::MqttManager::new(config.mqtt.client_id.clone()));
    let (dashboard_tx, _) = broadcast::channel::<DashboardMessage>(256);
    let agent = agent::Agent::new(config.clone(), db, mqtt_mgr, dashboard_tx);
    let agent = std::sync::Arc::new(tokio::sync::Mutex::new(agent));
    let mut app = tui::app::App::new(agent, config);
    app.run().await?;

    server_handle.abort();
    Ok(())
}