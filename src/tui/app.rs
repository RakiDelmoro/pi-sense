use crate::agent::{Agent, AgentEvent};
use crate::config::{self, Config, LlmConfig};
use crate::tui::chat::ChatPane;
use crate::tui::connect::{ConnectResult, ConnectScreen};
use crate::tui::input::InputPane;
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    Frame,
    Terminal,
    backend::CrosstermBackend,
    layout::{Constraint, Layout},
};
use std::collections::HashMap;
use std::io;
use std::sync::Arc;
use tokio::sync::mpsc;

enum AppScreen {
    Chat,
    Connect(ConnectScreen),
    ModelPicker(ConnectScreen),
}

impl AppScreen {
    fn is_model_picker(&self) -> bool {
        matches!(self, AppScreen::ModelPicker(_))
    }
}

pub struct App {
    chat: ChatPane,
    input: InputPane,
    agent: Arc<tokio::sync::Mutex<Agent>>,
    config: Config,
    model_cache: HashMap<String, Vec<String>>,
    screen: AppScreen,
    loading: bool,
    stream_rx: Option<mpsc::Receiver<AgentEvent>>,
}

impl App {
    pub fn new(agent: Arc<tokio::sync::Mutex<Agent>>, config: Config) -> Self {
        let mut chat = ChatPane::new();
        let configured = config.llm.is_some();
        if configured {
            chat.add_system("PiSense Agent — type your prompt below. Press Enter to submit.");
        } else {
            chat.add_system("Welcome to PiSense! No LLM configured. Type /connect to set up your provider.");
        }

        Self {
            chat,
            input: InputPane::new(),
            agent,
            config,
            model_cache: HashMap::new(),
            screen: AppScreen::Chat,
            loading: false,
            stream_rx: None,
        }
    }

    pub async fn run(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen)?;
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;

        loop {
            terminal.draw(|f| self.draw(f))?;

            // Drain stream events and update UI instantly
            let mut events = Vec::new();
            if let Some(mut rx) = self.stream_rx.take() {
                loop {
                    match rx.try_recv() {
                        Ok(event) => events.push(event),
                        Err(mpsc::error::TryRecvError::Empty) => {
                            self.stream_rx = Some(rx);
                            break;
                        }
                        Err(mpsc::error::TryRecvError::Disconnected) => {
                            self.loading = false;
                            self.chat.finish_stream();
                            break;
                        }
                    }
                }
            }
            for event in events {
                self.apply_stream_event(event);
            }

            if event::poll(std::time::Duration::from_millis(50))? {
                if let Event::Key(key) = event::read()? {
                    self.handle_key(key).await;
                }
            }
        }
    }

    fn apply_stream_event(&mut self, event: AgentEvent) {
        match event {
            AgentEvent::Chunk(text) => self.chat.append_stream(&text),
            AgentEvent::ToolCallStart(name) => self.chat.add_tool_call(&name),
            AgentEvent::ToolResult { name, result } => self.chat.add_tool_result(&name, &result),
            AgentEvent::Done => {
                self.loading = false;
                self.chat.finish_stream();
                self.stream_rx = None;
            }
            AgentEvent::Error(e) => {
                self.loading = false;
                self.chat.cancel_stream();
                self.chat.add_system(&format!("Error: {e}"));
                self.stream_rx = None;
            }
        }
    }

    async fn handle_key(&mut self, key: crossterm::event::KeyEvent) {
        if key.kind != KeyEventKind::Press {
            return;
        }

        let is_connect_or_model = matches!(self.screen, AppScreen::Connect(_) | AppScreen::ModelPicker(_));

        if is_connect_or_model {
            self.handle_connect_key(key).await;
            return;
        }

        match key.code {
            KeyCode::Esc => {
                disable_raw_mode().ok();
                execute!(io::stdout(), LeaveAlternateScreen).ok();
                std::process::exit(0);
            }
            KeyCode::Enter => {
                if !self.loading {
                    let prompt = self.input.take();
                    if prompt.is_empty() {
                        return;
                    }
                    if prompt == "/connect" {
                        self.screen = AppScreen::Connect(ConnectScreen::new());
                        return;
                    }
                    if prompt == "/model" {
                        self.open_model_picker().await;
                        return;
                    }
                    if prompt == "/help" {
                        self.show_help();
                        return;
                    }
                    if prompt == "/exit" {
                        disable_raw_mode().ok();
                        execute!(io::stdout(), LeaveAlternateScreen).ok();
                        std::process::exit(0);
                    }
                    self.chat.add_user(&prompt);
                    self.loading = true;
                    self.chat.start_stream();

                    let (tx, rx) = mpsc::channel(128);
                    self.stream_rx = Some(rx);

                    let agent = self.agent.clone();
                    tokio::spawn(async move {
                        let mut agent = agent.lock().await;
                        agent.run_prompt_stream(&prompt, tx).await;
                    });
                }
            }
            KeyCode::Char(c) => self.input.insert(c),
            KeyCode::Backspace => self.input.backspace(),
            KeyCode::Up => self.chat.scroll_up(),
            KeyCode::Down => self.chat.scroll_down(),
            KeyCode::PageUp => self.chat.scroll_page_up(),
            KeyCode::PageDown => self.chat.scroll_page_down(),
            _ => {}
        }
    }

    async fn handle_connect_key(&mut self, key: crossterm::event::KeyEvent) {
        let is_model = self.screen.is_model_picker();

        let mut screen = match std::mem::replace(&mut self.screen, AppScreen::Chat) {
            AppScreen::Connect(s) => s,
            AppScreen::ModelPicker(s) => s,
            other => {
                self.screen = other;
                return;
            }
        };

        let result = screen.handle_event(key);

        match result {
            ConnectResult::None => {
                self.screen = if is_model {
                    AppScreen::ModelPicker(screen)
                } else {
                    AppScreen::Connect(screen)
                };
            }
            ConnectResult::Cancelled => {
                self.screen = AppScreen::Chat;
                if is_model {
                    self.chat.add_system("Model selection cancelled.");
                } else {
                    self.chat.add_system("Connect cancelled.");
                }
            }
            ConnectResult::NeedModels { provider, api_key } => {
                let models = match self.get_models(&provider, &api_key).await {
                    Ok(m) => m,
                    Err(e) => {
                        self.chat.add_system(&format!("Failed to fetch models from {}: {e}", capitalize(&provider)));
                        self.screen = AppScreen::Chat;
                        return;
                    }
                };
                if models.is_empty() {
                    self.chat.add_system(&format!("No models found for {}.", capitalize(&provider)));
                    self.screen = AppScreen::Chat;
                    return;
                }
                let mut screen = screen;
                screen.set_models(models, api_key);
                self.screen = if is_model {
                    AppScreen::ModelPicker(screen)
                } else {
                    AppScreen::Connect(screen)
                };
            }
            ConnectResult::Done { provider, api_key, model } => {
                let new_llm = LlmConfig {
                    provider: provider.clone(),
                    api_key: api_key.clone(),
                    model: model.clone(),
                    api_base: None,
                };
                self.config.llm = Some(new_llm);
                if let Err(e) = self.config.save() {
                    self.chat.add_system(&format!("Error saving config: {e}"));
                } else {
                    let mut agent = self.agent.lock().await;
                    agent.reload_config(self.config.clone());
                    drop(agent);
                    if is_model {
                        self.chat.add_system(&format!("Model updated to: {model}"));
                    } else {
                        self.chat.add_system(&format!("Connected to {}! Model: {model}", capitalize(&provider)));
                    }
                }
                self.screen = AppScreen::Chat;
            }
        }
    }

    async fn open_model_picker(&mut self) {
        let (provider, api_key) = match &self.config.llm {
            Some(llm) => (llm.provider.clone(), llm.api_key.clone()),
            None => {
                self.chat.add_system("No provider configured. Run /connect first.");
                return;
            }
        };

        let models = match self.get_models(&provider, &api_key).await {
            Ok(m) => m,
            Err(e) => {
                self.chat.add_system(&format!("Failed to fetch models: {e}"));
                return;
            }
        };
        if models.is_empty() {
            self.chat.add_system(&format!("No models found for {}.", capitalize(&provider)));
            return;
        }

        let mut screen = ConnectScreen::new();
        screen.set_models(models, api_key);
        self.screen = AppScreen::ModelPicker(screen);
    }

    async fn get_models(&mut self, provider: &str, api_key: &str) -> Result<Vec<String>, String> {
        if let Some(cached) = self.model_cache.get(provider).cloned() {
            return Ok(cached);
        }
        let models = config::fetch_models(provider, api_key).await?;
        self.model_cache.insert(provider.to_string(), models.clone());
        Ok(models)
    }

    fn show_help(&mut self) {
        self.chat.add_system(
            "Commands:\n\
             /connect — Configure LLM provider, API key, and model\n\
             /model   — Switch to a different model\n\
             /help    — Show this help\n\
             /exit    — Exit PiSense\n\
             \n\
             Just type a prompt to talk to the agent.\
            ",
        );
    }

    fn draw(&self, f: &mut Frame) {
        let chunks = Layout::default()
            .direction(ratatui::layout::Direction::Vertical)
            .constraints([Constraint::Min(3), Constraint::Length(3)])
            .split(f.area());

        self.chat.draw(f, chunks[0]);
        self.input.draw(f, chunks[1], self.loading);

        match &self.screen {
            AppScreen::Connect(screen) | AppScreen::ModelPicker(screen) => {
                screen.draw(f, f.area());
            }
            AppScreen::Chat => {}
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
