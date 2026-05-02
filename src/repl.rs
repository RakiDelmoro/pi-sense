use crate::agent::{Agent, AgentEvent};
use crate::config::{Config, LlmConfig};
use crate::store::Store;
use std::io::{self, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::mpsc;

const SPINNER_FRAMES: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

pub struct Repl {
    agent: Arc<tokio::sync::Mutex<Agent>>,
    config: Config,
    store: Arc<Store>,
    spinner_active: Arc<AtomicBool>,
}

impl Repl {
    pub fn new(agent: Arc<tokio::sync::Mutex<Agent>>, config: Config, store: Arc<Store>) -> Self {
        Self {
            agent,
            config,
            store,
            spinner_active: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn run(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let configured = self.config.llm.is_some();
        if configured {
            println!("PiSense Agent \u{2014} type /help for commands, /exit to quit.");
        } else {
            println!("Welcome to PiSense! No LLM configured. Type /connect to set up.");
        }

        if self.store.mqtt_broker().is_empty() {
            println!("\nNo MQTT broker configured. Set mqtt_broker in sensors.yaml or say:");
            println!("  > set broker to 192.168.x.y");
        }
        println!();

        loop {
            print!("> ");
            let _ = io::stdout().flush();

            let mut line = String::new();
            match io::stdin().read_line(&mut line) {
                Ok(0) => {
                    println!();
                    break;
                }
                Err(e) => {
                    println!("\nread error: {e}");
                    break;
                }
                Ok(_) => {}
            }

            let input = line.trim().to_string();
            if input.is_empty() {
                continue;
            }

            if input == "/exit" || input == "/quit" {
                println!("Goodbye!");
                break;
            }

            if input == "/help" {
                println!("  Commands:");
                println!("    /connect  Configure LLM provider, API key, and model");
                println!("    /model    Switch to a different model");
                println!("    /help     Show this help");
                println!("    /exit     Exit PiSense");
                println!();
                println!("  Or type a prompt to talk to the agent.");
                println!();
                continue;
            }

            if input.starts_with("/set broker") {
                self.text_set_broker(&input).await;
                continue;
            }

            if input == "/connect" {
                self.text_connect().await;
                continue;
            }

            if input == "/model" {
                self.text_model_switch().await;
                continue;
            }

            self.handle_prompt(&input).await;
        }

        Ok(())
    }

    async fn handle_prompt(&mut self, prompt: &str) {
        let (tx, mut rx) = mpsc::channel(128);
        let agent = self.agent.clone();
        let prompt = prompt.to_string();

        tokio::spawn(async move {
            let mut agent = agent.lock().await;
            agent.run_prompt_stream(&prompt, tx).await;
        });

        let spinner_active = self.spinner_active.clone();
        let mut tool_header = false;
        let mut first_chunk = true;

        self.start_spinner(&spinner_active);

        while let Some(event) = rx.recv().await {
            match event {
                AgentEvent::ThinkingChunk(_) => {}
                AgentEvent::Chunk(text) => {
                    self.stop_spinner(&spinner_active);
                    if tool_header {
                        println!();
                        tool_header = false;
                    }
                    if first_chunk {
                        print!("  ");
                        first_chunk = false;
                    }
                    print!("{text}");
                }
                AgentEvent::ToolCallStart(name) => {
                    self.stop_spinner(&spinner_active);
                    if !tool_header {
                        println!();
                        print!("  [{name}]");
                        tool_header = true;
                    } else {
                        print!(" [{name}]");
                    }
                }
                AgentEvent::ToolResult { name, result } => {
                    self.stop_spinner(&spinner_active);
                    println!("\n  [{name}] {result}");
                    tool_header = false;
                    self.start_spinner(&spinner_active);
                }
                AgentEvent::Done => {
                    self.stop_spinner(&spinner_active);
                    println!();
                    if tool_header {
                        println!();
                    }
                    break;
                }
                AgentEvent::Error(e) => {
                    self.stop_spinner(&spinner_active);
                    println!("\n  Error: {e}");
                    break;
                }
            }
            let _ = io::stdout().flush();
        }
        println!();
    }

    fn start_spinner(&self, active: &Arc<AtomicBool>) {
        if active.load(Ordering::Relaxed) {
            return;
        }
        active.store(true, Ordering::Relaxed);
        let active = active.clone();
        tokio::spawn(async move {
            let mut i = 0usize;
            while active.load(Ordering::Relaxed) {
                let frame = SPINNER_FRAMES[i % SPINNER_FRAMES.len()];
                print!("\r\x1B[2K  {frame} thinking...");
                let _ = io::stdout().flush();
                i += 1;
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            print!("\r\x1B[2K");
            let _ = io::stdout().flush();
        });
    }

    fn stop_spinner(&self, active: &Arc<AtomicBool>) {
        if active.load(Ordering::Relaxed) {
            active.store(false, Ordering::Relaxed);
            std::thread::sleep(std::time::Duration::from_millis(120)); print!("\r\x1B[2K");
            let _ = io::stdout().flush();
        }
    }

    async fn text_connect(&mut self) {
        let provider = self.prompt("  LLM provider [ppq/togetherai/openrouter]: ").await;
        if provider.is_empty() { return; }

        let api_key = self.prompt("  API key: ").await;
        if api_key.is_empty() { return; }

        let model = self.prompt("  Model: ").await;
        if model.is_empty() { return; }

        let new_llm = LlmConfig {
            provider: provider.clone(),
            api_key: api_key.clone(),
            model: model.clone(),
            api_base: None,
        };
        self.config.llm = Some(new_llm);
        if let Err(e) = self.config.save() {
            println!("  Error saving config: {e}");
        } else {
            let mut agent = self.agent.lock().await;
            agent.reload_config(self.config.clone());
            println!("  Connected to {}! Model: {}", capitalize(&provider), model);
        }
    }

    async fn text_model_switch(&mut self) {
        let (provider, api_key) = match &self.config.llm {
            Some(llm) => (llm.provider.clone(), llm.api_key.clone()),
            None => {
                println!("  No provider configured. Run /connect first.");
                return;
            }
        };

        let model = self.prompt("  Model: ").await;
        if model.is_empty() { return; }

        let new_llm = LlmConfig {
            provider: provider.clone(),
            api_key: api_key.clone(),
            model: model.clone(),
            api_base: None,
        };
        self.config.llm = Some(new_llm);
        if let Err(e) = self.config.save() {
            println!("  Error saving config: {e}");
        } else {
            let mut agent = self.agent.lock().await;
            agent.reload_config(self.config.clone());
            println!("  Model updated to: {}", model);
        }
    }

    async fn text_set_broker(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        if parts.len() < 3 {
            println!("  Usage: /set broker <ip> [port]");
            return;
        }
        let broker = parts[2].to_string();
        let port: u16 = parts.get(3).and_then(|p| p.parse().ok()).unwrap_or(1883);
        match self.store.set_mqtt_broker(&broker, port).await {
            Ok(()) => println!("  MQTT broker set to {}:{}", broker, port),
            Err(e) => println!("  Error: {e}"),
        }
    }

    async fn prompt(&self, label: &str) -> String {
        print!("{label}");
        let _ = io::stdout().flush();
        let mut line = String::new();
        match io::stdin().read_line(&mut line) {
            Ok(_) => line.trim().to_string(),
            Err(_) => String::new(),
        }
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}