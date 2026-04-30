use ratatui::{
    Frame,
    layout::Rect,
    style::{Color, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
};

enum ChatLine {
    System(String),
    User(String),
    Thinking(String),
    Assistant(String),
    ToolCall(String),
    ToolResult(String),
}

pub struct ChatPane {
    messages: Vec<ChatLine>,
    scroll_offset: u16,
    thinking_buffer: String,
    stream_buffer: String,
    streaming: bool,
}

impl ChatPane {
    pub fn new() -> Self {
        Self {
            messages: Vec::new(),
            scroll_offset: 0,
            thinking_buffer: String::new(),
            stream_buffer: String::new(),
            streaming: false,
        }
    }

    pub fn add_system(&mut self, text: &str) {
        self.messages.push(ChatLine::System(text.into()));
    }

    pub fn add_user(&mut self, text: &str) {
        self.messages.push(ChatLine::User(text.into()));
        self.scroll_offset = 0;
    }

    pub fn add_assistant(&mut self, text: &str) {
        self.messages.push(ChatLine::Assistant(text.into()));
        self.scroll_offset = 0;
    }

    pub fn start_stream(&mut self) {
        self.streaming = true;
        self.thinking_buffer.clear();
        self.stream_buffer.clear();
        self.scroll_offset = 0;
    }

    pub fn append_thinking(&mut self, text: &str) {
        self.thinking_buffer.push_str(text);
    }

    pub fn commit_thinking(&mut self) {
        if !self.thinking_buffer.is_empty() {
            self.messages.push(ChatLine::Thinking(std::mem::take(&mut self.thinking_buffer)));
        }
    }

    pub fn append_stream(&mut self, text: &str) {
        self.stream_buffer.push_str(text);
    }

    pub fn add_tool_call(&mut self, name: &str) {
        self.commit_thinking();
        if self.streaming && !self.stream_buffer.is_empty() {
            self.messages.push(ChatLine::Assistant(std::mem::take(&mut self.stream_buffer)));
        }
        self.messages.push(ChatLine::ToolCall(format!("Calling {name}...")));
        self.scroll_offset = 0;
    }

    pub fn add_tool_result(&mut self, name: &str, result: &str) {
        self.messages.push(ChatLine::ToolResult(format!("[{name}] {result}")));
        self.scroll_offset = 0;
    }

    pub fn finish_stream(&mut self) {
        if self.streaming {
            self.commit_thinking();
            if !self.stream_buffer.is_empty() {
                self.messages.push(ChatLine::Assistant(std::mem::take(&mut self.stream_buffer)));
            }
            self.streaming = false;
        }
        self.scroll_offset = 0;
    }

    pub fn cancel_stream(&mut self) {
        if self.streaming {
            self.thinking_buffer.clear();
            self.stream_buffer.clear();
            self.streaming = false;
        }
    }

    pub fn scroll_up(&mut self) {
        self.scroll_offset = self.scroll_offset.saturating_add(1);
    }

    pub fn scroll_down(&mut self) {
        self.scroll_offset = self.scroll_offset.saturating_sub(1);
    }

    pub fn scroll_page_up(&mut self) {
        self.scroll_offset = self.scroll_offset.saturating_add(10);
    }

    pub fn scroll_page_down(&mut self) {
        self.scroll_offset = self.scroll_offset.saturating_sub(10);
    }

    pub fn draw(&self, f: &mut Frame, area: Rect) {
        let mut lines: Vec<Line> = Vec::new();

        for msg in &self.messages {
            match msg {
                ChatLine::System(t) => {
                    lines.push(Line::from(Span::styled(
                        format!("[pi-sense] {t}"),
                        Style::default().fg(Color::DarkGray),
                    )));
                }
                ChatLine::User(t) => {
                    lines.push(Line::from(Span::styled(
                        format!("> {t}"),
                        Style::default().fg(Color::Cyan),
                    )));
                }
                ChatLine::Thinking(t) => {
                    for line in t.lines() {
                        lines.push(Line::from(Span::styled(
                            format!("│ {line}"),
                            Style::default().fg(Color::DarkGray),
                        )));
                    }
                }
                ChatLine::Assistant(t) => {
                    if t.is_empty() {
                        lines.push(Line::from(""));
                    } else {
                        for line in t.lines() {
                            lines.push(Line::from(Span::styled(
                                line.to_string(),
                                Style::default().fg(Color::White),
                            )));
                        }
                    }
                }
                ChatLine::ToolCall(t) => {
                    lines.push(Line::from(Span::styled(
                        format!("▶ {t}"),
                        Style::default().fg(Color::Yellow),
                    )));
                }
                ChatLine::ToolResult(t) => {
                    lines.push(Line::from(Span::styled(
                        format!("  {t}"),
                        Style::default().fg(Color::DarkGray),
                    )));
                }
            }
        }

        // Append the live thinking buffer at the bottom
        if self.streaming && !self.thinking_buffer.is_empty() {
            for line in self.thinking_buffer.lines() {
                lines.push(Line::from(Span::styled(
                    format!("│ {line}"),
                    Style::default().fg(Color::DarkGray),
                )));
            }
        }

        // Append the live streaming buffer at the bottom
        if self.streaming {
            if self.stream_buffer.is_empty() && self.thinking_buffer.is_empty() {
                lines.push(Line::from(""));
            } else if !self.stream_buffer.is_empty() {
                for line in self.stream_buffer.lines() {
                    lines.push(Line::from(Span::styled(
                        line.to_string(),
                        Style::default().fg(Color::White),
                    )));
                }
            }
        }

        let paragraph = Paragraph::new(lines)
            .block(Block::default().borders(Borders::NONE))
            .wrap(Wrap { trim: false })
            .scroll((self.scroll_offset, 0));

        f.render_widget(paragraph, area);
    }
}
