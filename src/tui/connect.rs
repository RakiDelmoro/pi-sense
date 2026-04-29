use crate::config::PROVIDERS;
use crossterm::event::{KeyCode, KeyEventKind};
use ratatui::{
    Frame,
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph},
};

const MAX_VISIBLE: usize = 15;

pub enum ConnectStep {
    SelectProvider { selected: usize },
    EnterKey { provider: String, buffer: String },
    SelectModel {
        provider: String,
        api_key: String,
        models: Vec<String>,
        search: String,
        selected: usize,
        scroll: usize,
    },
}

pub enum ConnectResult {
    None,
    Cancelled,
    NeedModels { provider: String, api_key: String },
    Done { provider: String, api_key: String, model: String },
}

pub struct ConnectScreen {
    pub step: ConnectStep,
}

impl ConnectScreen {
    pub fn new() -> Self {
        Self {
            step: ConnectStep::SelectProvider { selected: 0 },
        }
    }

    pub fn set_models(&mut self, models: Vec<String>, api_key: String) {
        if let ConnectStep::EnterKey { provider, .. } = &self.step {
            self.step = ConnectStep::SelectModel {
                provider: provider.clone(),
                api_key,
                models,
                search: String::new(),
                selected: 0,
                scroll: 0,
            };
        }
    }

    #[allow(dead_code)]
    pub fn set_fetch_error(&mut self, _error: String) -> ConnectResult {
        self.step = ConnectStep::SelectProvider { selected: 0 };
        ConnectResult::Cancelled
    }

    #[allow(dead_code)]
    pub fn filtered_models(step: &ConnectStep) -> Vec<String> {
        if let ConnectStep::SelectModel { models, search, .. } = step {
            if search.is_empty() {
                models.clone()
            } else {
                let q = search.to_lowercase();
                models.iter().filter(|m| m.to_lowercase().contains(&q)).cloned().collect()
            }
        } else {
            Vec::new()
        }
    }

    pub fn handle_event(&mut self, key: crossterm::event::KeyEvent) -> ConnectResult {
        if key.kind != KeyEventKind::Press {
            return ConnectResult::None;
        }

        match &mut self.step {
            ConnectStep::SelectProvider { selected } => match key.code {
                KeyCode::Up => {
                    *selected = (*selected + PROVIDERS.len() - 1) % PROVIDERS.len();
                    ConnectResult::None
                }
                KeyCode::Down => {
                    *selected = (*selected + 1) % PROVIDERS.len();
                    ConnectResult::None
                }
                KeyCode::Enter => {
                    let provider = PROVIDERS[*selected].to_lowercase();
                    self.step = ConnectStep::EnterKey {
                        provider: provider.clone(),
                        buffer: String::new(),
                    };
                    ConnectResult::None
                }
                KeyCode::Esc => ConnectResult::Cancelled,
                _ => ConnectResult::None,
            },

            ConnectStep::EnterKey { provider, buffer } => match key.code {
                KeyCode::Enter => {
                    if buffer.is_empty() {
                        return ConnectResult::None;
                    }
                    let provider = provider.clone();
                    let api_key = std::mem::take(buffer);
                    ConnectResult::NeedModels { provider, api_key }
                }
                KeyCode::Esc => {
                    self.step = ConnectStep::SelectProvider { selected: 0 };
                    ConnectResult::Cancelled
                }
                KeyCode::Backspace => {
                    buffer.pop();
                    ConnectResult::None
                }
                KeyCode::Char(c) => {
                    buffer.push(c);
                    ConnectResult::None
                }
                _ => ConnectResult::None,
            },

            ConnectStep::SelectModel { models, search, selected, scroll, .. } => {
                let filtered = if search.is_empty() {
                    models.clone()
                } else {
                    let q = search.to_lowercase();
                    models.iter().filter(|m| m.to_lowercase().contains(&q)).cloned().collect::<Vec<_>>()
                };

                match key.code {
                    KeyCode::Up => {
                        if !filtered.is_empty() {
                            *selected = selected.saturating_sub(1);
                            if *selected < *scroll {
                                *scroll = *selected;
                            }
                        }
                        ConnectResult::None
                    }
                    KeyCode::Down => {
                        if !filtered.is_empty() {
                            *selected = (*selected + 1).min(filtered.len() - 1);
                            if *selected >= *scroll + MAX_VISIBLE {
                                *scroll = *selected - MAX_VISIBLE + 1;
                            }
                        }
                        ConnectResult::None
                    }
                    KeyCode::Enter => {
                        if filtered.is_empty() {
                            return ConnectResult::None;
                        }
                        let model = filtered[*selected].clone();
                        let (provider, api_key) = match &self.step {
                            ConnectStep::SelectModel { provider, api_key, .. } => (provider.clone(), api_key.clone()),
                            _ => unreachable!(),
                        };
                        self.step = ConnectStep::SelectProvider { selected: 0 };
                        ConnectResult::Done { provider, api_key, model }
                    }
                    KeyCode::Esc => {
                        let (provider, api_key) = match &self.step {
                            ConnectStep::SelectModel { provider, api_key, .. } => (provider.clone(), api_key.clone()),
                            _ => unreachable!(),
                        };
                        self.step = ConnectStep::EnterKey { provider, buffer: api_key };
                        ConnectResult::None
                    }
                    KeyCode::Backspace => {
                        search.pop();
                        *selected = 0;
                        *scroll = 0;
                        ConnectResult::None
                    }
                    KeyCode::Char(c) => {
                        search.push(c);
                        *selected = 0;
                        *scroll = 0;
                        ConnectResult::None
                    }
                    _ => ConnectResult::None,
                }
            }
        }
    }

    pub fn draw(&self, f: &mut Frame, area: Rect) {
        match &self.step {
            ConnectStep::SelectProvider { selected } => {
                draw_provider_picker(f, area, *selected);
            }
            ConnectStep::EnterKey { provider, buffer } => {
                draw_key_input(f, area, provider, buffer);
            }
            ConnectStep::SelectModel { models, search, selected, scroll, .. } => {
                draw_model_picker(f, area, models, search, *selected, *scroll);
            }
        }
    }
}

fn draw_provider_picker(f: &mut Frame, area: Rect, selected: usize) {
    let modal_w = 44u16;
    let modal_h = 13u16;
    let x = (area.width.saturating_sub(modal_w)) / 2;
    let y = (area.height.saturating_sub(modal_h)) / 2;
    let modal = Rect::new(x, y, modal_w.min(area.width), modal_h.min(area.height));

    f.render_widget(Clear, modal);

    let mut lines = vec![
        Line::from(Span::styled(
            " Select LLM Provider",
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
    ];

    for (i, name) in PROVIDERS.iter().enumerate() {
        let indicator = if i == selected { " > ● " } else { "   ○ " };
        let style = if i == selected {
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::DarkGray)
        };
        lines.push(Line::from(Span::styled(format!("{indicator}{name}"), style)));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        " ↑↓ to pick · Enter = select · Esc = cancel",
        Style::default().fg(Color::DarkGray),
    )));

    let paragraph = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).style(Style::default().fg(Color::DarkGray)));
    f.render_widget(paragraph, modal);
}

fn draw_key_input(f: &mut Frame, area: Rect, provider: &str, buffer: &str) {
    let modal_w = 50u16;
    let modal_h = 9u16;
    let x = (area.width.saturating_sub(modal_w)) / 2;
    let y = (area.height.saturating_sub(modal_h)) / 2;
    let modal = Rect::new(x, y, modal_w.min(area.width), modal_h.min(area.height));

    f.render_widget(Clear, modal);

    let display = capitalize(provider);
    let lines = vec![
        Line::from(Span::styled(
            format!(" Enter API Key for {display}"),
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from(Span::styled(
            format!(" > {buffer}"),
            Style::default().fg(Color::White),
        )),
        Line::from(""),
        Line::from(Span::styled(
            " Enter = save · Esc = cancel",
            Style::default().fg(Color::DarkGray),
        )),
    ];

    let paragraph = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).style(Style::default().fg(Color::DarkGray)));
    f.render_widget(paragraph, modal);
}

fn draw_model_picker(f: &mut Frame, area: Rect, models: &[String], search: &str, selected: usize, scroll: usize) {
    let modal_w = 52u16;
    let modal_h = 22u16;
    let x = (area.width.saturating_sub(modal_w)) / 2;
    let y = (area.height.saturating_sub(modal_h)) / 2;
    let modal = Rect::new(x, y, modal_w.min(area.width), modal_h.min(area.height));

    f.render_widget(Clear, modal);

    let filtered: Vec<String> = if search.is_empty() {
        models.to_vec()
    } else {
        let q = search.to_lowercase();
        models.iter().filter(|m| m.to_lowercase().contains(&q)).cloned().collect()
    };

    let visible: &[String] = if filtered.len() > scroll + MAX_VISIBLE {
        &filtered[scroll..scroll + MAX_VISIBLE]
    } else {
        &filtered[scroll..]
    };

    let mut lines = vec![
        Line::from(Span::styled(
            " Select Model (type to search)",
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
    ];

    lines.push(Line::from(Span::styled(
        format!(" search: {search}█"),
        Style::default().fg(Color::Yellow),
    )));
    lines.push(Line::from(""));

    if visible.is_empty() {
        lines.push(Line::from(Span::styled(
            " No models match your search",
            Style::default().fg(Color::Red),
        )));
    } else {
        for (i, model) in visible.iter().enumerate() {
            let abs_idx = scroll + i;
            let indicator = if abs_idx == selected { " > ● " } else { "   ○ " };
            let style = if abs_idx == selected {
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::DarkGray)
            };
            let display_name = if model.len() > 40 {
                format!("{}…", &model[..39])
            } else {
                model.clone()
            };
            lines.push(Line::from(Span::styled(format!("{indicator}{display_name}"), style)));
        }
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        " ↑↓ pick · type to filter · Enter = select · Esc = back",
        Style::default().fg(Color::DarkGray),
    )));

    let paragraph = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).style(Style::default().fg(Color::DarkGray)));
    f.render_widget(paragraph, modal);
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}