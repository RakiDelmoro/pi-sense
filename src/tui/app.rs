use crate::agent::{Agent, AgentEvent};
use crate::config::{self, Config, LlmConfig};
use crate::tui::chat::ChatPane;
use crate::tui::connect::{ConnectResult, ConnectScreen};
use crate::tui::input::InputPane;
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind, MouseEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    Frame,
    Terminal,
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    widgets::{Block, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState},
    text::{Line, Span},
};
use std::collections::HashMap;
use std::io;
use std::sync::Arc;
use tokio::sync::mpsc;

const PI_SENSE_ACCENT: Color = Color::Rgb(100, 200, 255);

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
    scroll_accel: f32,
    scroll_last_time: Option<std::time::Instant>,
}

impl App {
    pub fn new(agent: Arc<tokio::sync::Mutex<Agent>>, config: Config) -> Self {
        let mut chat = ChatPane::new();
        let configured = config.llm.is_some();
        if configured {
            chat.add_system("PiSense Agent \u{2014} type your prompt below. Press Enter to submit.");
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
            scroll_accel: 1.0,
            scroll_last_time: None,
        }
    }

    pub async fn run(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen, crossterm::event::EnableMouseCapture)?;
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;

        loop {
            self.chat.tick_spinner();
            terminal.draw(|f| self.draw(f))?;

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
                match event::read()? {
                    Event::Key(key) => self.handle_key(key).await,
                    Event::Mouse(mouse) => self.handle_mouse(mouse),
                    _ => {}
                }
            }
        }
    }

    fn apply_stream_event(&mut self, event: AgentEvent) {
        match event {
            AgentEvent::ThinkingChunk(text) => self.chat.append_thinking(&text),
            AgentEvent::Chunk(text) => {
                self.chat.commit_thinking();
                self.chat.append_stream(&text);
            }
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
                execute!(io::stdout(), LeaveAlternateScreen, crossterm::event::DisableMouseCapture).ok();
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
                        execute!(io::stdout(), LeaveAlternateScreen, crossterm::event::DisableMouseCapture).ok();
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
            KeyCode::Left => self.input.cursor_left(),
            KeyCode::Right => self.input.cursor_right(),
            KeyCode::Home => self.input.cursor_home(),
            KeyCode::End => self.chat.snap_to_bottom(),
            KeyCode::Up => self.chat.scroll_up(),
            KeyCode::Down => self.chat.scroll_down(),
            KeyCode::PageUp => self.chat.scroll_page_up(),
            KeyCode::PageDown => self.chat.scroll_page_down(),
            _ => {}
        }
    }

    fn handle_mouse(&mut self, mouse: crossterm::event::MouseEvent) {
        match mouse.kind {
            MouseEventKind::ScrollDown => {
                let rows = self.scroll_accel_rows(3);
                self.chat.scroll_rows(rows);
            }
            MouseEventKind::ScrollUp => {
                let rows = self.scroll_accel_rows(3);
                self.chat.scroll_rows(-rows);
            }
            _ => {}
        }
    }

    fn scroll_accel_rows(&mut self, base: i16) -> i16 {
        let now = std::time::Instant::now();
        if let Some(last) = self.scroll_last_time {
            let delta = now.duration_since(last).as_secs_f32();
            if delta < 0.1 {
                self.scroll_accel = (self.scroll_accel + 0.5).min(8.0);
            } else {
                self.scroll_accel = 1.0;
            }
        }
        self.scroll_last_time = Some(now);
        (base as f32 * self.scroll_accel).round() as i16
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
             /connect \u{2014} Configure LLM provider, API key, and model\n\
             /model   \u{2014} Switch to a different model\n\
             /help    \u{2014} Show this help\n\
             /exit    \u{2014} Exit PiSense\n\
             \n\
             Just type a prompt to talk to the agent.\
            ",
        );
    }

    fn draw(&mut self, f: &mut Frame) {
        let size = f.area();

        // Fill entire frame with black background
        f.render_widget(
            Block::default().style(Style::default().bg(Color::Black).fg(Color::White)),
            size,
        );

        let main_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Min(3),
                Constraint::Length(3),
                Constraint::Length(1),
            ])
            .split(size);

        // ── chat pane ───────────────────────────────────────────────────
        self.chat.draw(f, main_chunks[0]);

        // ── scrollbar ───────────────────────────────────────────────────
        let line_count = self.chat.line_count() as u16;
        let visible_height = main_chunks[0].height;
        if line_count > visible_height {
            let max_offset = line_count.saturating_sub(visible_height);
            let scroll = if self.chat.is_following() {
                max_offset as usize
            } else {
                max_offset.saturating_sub(self.chat.scroll_offset()) as usize
            };

            let mut scrollbar_state = ScrollbarState::new(line_count as usize)
                .position(scroll)
                .viewport_content_length(visible_height as usize);

            let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
                .thumb_style(Style::default().fg(PI_SENSE_ACCENT))
                .track_style(Style::default().fg(Color::Rgb(40, 40, 50)));

            f.render_stateful_widget(scrollbar, main_chunks[0], &mut scrollbar_state);
        }

        // ── "new messages" badge ────────────────────────────────────────
        let new_count = self.chat.new_messages_while_scrolled();
        if new_count > 0 && main_chunks[0].height > 4 && main_chunks[0].width > 20 {
            let indicator = format!(
                " \u{2193} {} new ",
                if new_count == 1 {
                    "1 message".to_string()
                } else {
                    format!("{new_count} messages")
                }
            );
            let ind_len = indicator.len() as u16;
            let ind_x = main_chunks[0]
                .x
                .saturating_add(main_chunks[0].width.saturating_sub(ind_len + 2));
            let ind_y = main_chunks[0].y + main_chunks[0].height.saturating_sub(1);
            let ind_area = Rect {
                x: ind_x,
                y: ind_y,
                width: ind_len.min(main_chunks[0].width.saturating_sub(2)),
                height: 1,
            };
            let ind_line = Line::from(vec![Span::styled(
                indicator,
                Style::default()
                    .fg(Color::Black)
                    .bg(PI_SENSE_ACCENT)
                    .add_modifier(Modifier::BOLD),
            )]);
            f.render_widget(Paragraph::new(vec![ind_line]), ind_area);
        }

        // ── scroll-follow hint ──────────────────────────────────────────
        if !self.chat.is_following() {
            let hint = Paragraph::new("  End to follow  ")
                .style(
                    Style::default()
                        .fg(Color::DarkGray)
                        .bg(Color::Black)
                        .add_modifier(Modifier::REVERSED),
                )
                .alignment(Alignment::Right);
            let hint_area = Rect {
                x: main_chunks[0].x + main_chunks[0].width.saturating_sub(17),
                y: main_chunks[0].y,
                width: 17,
                height: 1,
            };
            f.render_widget(hint, hint_area);
        }

        // ── input pane ──────────────────────────────────────────────────
        self.input.draw(f, main_chunks[1], self.loading);

        // ── footer ──────────────────────────────────────────────────────
        let model_name = self.config.llm.as_ref()
            .map(|l| l.model.as_str())
            .unwrap_or("Not connected");
        let footer_line = Line::from(vec![
            Span::styled(
                "\u{25C6} PiSense",
                Style::default()
                    .fg(PI_SENSE_ACCENT)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                "  |  ",
                Style::default().fg(Color::DarkGray),
            ),
            Span::styled(
                format!("{model_name}"),
                Style::default().fg(Color::DarkGray),
            ),
            Span::styled(
                "  |  mouse: scroll \u{2022} arrows \u{2022} PageUp/Down \u{2022} End = follow",
                Style::default().fg(Color::DarkGray),
            ),
        ]);
        let footer = Paragraph::new(footer_line)
            .style(Style::default().fg(Color::DarkGray));
        f.render_widget(footer, main_chunks[2]);
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}