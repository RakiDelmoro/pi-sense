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
    Assistant(String),
    ToolCall(String),
    ToolResult(String),
}

pub struct ChatPane {
    messages: Vec<ChatLine>,
    scroll_offset: u16,
    stream_buffer: String,
    streaming: bool,
}

impl ChatPane {
    pub fn new() -> Self {
        Self {
            messages: Vec::new(),
            scroll_offset: 0,
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
        self.stream_buffer.clear();
        self.scroll_offset = 0;
    }

    pub fn append_stream(&mut self, text: &str) {
        self.stream_buffer.push_str(text);
    }

    pub fn add_tool_call(&mut self, name: &str) {
        if self.streaming && !self.stream_buffer.is_empty() {
            self.messages.push(ChatLine::Assistant(self.stream_buffer.clone()));
            self.stream_buffer.clear();
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
            if !self.stream_buffer.is_empty() {
                self.messages.push(ChatLine::Assistant(self.stream_buffer.clone()));
                self.stream_buffer.clear();
            }
            self.streaming = false;
        }
        self.scroll_offset = 0;
    }

    pub fn cancel_stream(&mut self) {
        if self.streaming {
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

        // Append the live streaming buffer at the bottom
        if self.streaming {
            if self.stream_buffer.is_empty() {
                lines.push(Line::from(""));
            } else {
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
