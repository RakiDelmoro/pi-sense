use ratatui::{
    Frame,
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
};

pub struct InputPane {
    buffer: String,
    cursor: usize,
}

impl InputPane {
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
            cursor: 0,
        }
    }

    pub fn insert(&mut self, c: char) {
        self.buffer.insert(self.cursor, c);
        self.cursor += 1;
    }

    pub fn backspace(&mut self) {
        if self.cursor > 0 {
            self.cursor -= 1;
            self.buffer.remove(self.cursor);
        }
    }

    pub fn take(&mut self) -> String {
        let s = self.buffer.clone();
        self.buffer.clear();
        self.cursor = 0;
        s
    }

    pub fn draw(&self, f: &mut Frame, area: Rect, loading: bool) {
        let prompt = if loading {
            "thinking...".to_string()
        } else if self.buffer.is_empty() {
            String::new()
        } else {
            self.buffer.clone()
        };

        let prefix = " > ";
        let display = format!("{prefix}{prompt}");
        let style = if loading {
            Style::default().fg(Color::Yellow).add_modifier(Modifier::SLOW_BLINK)
        } else {
            Style::default().fg(Color::White)
        };

        let line = Line::from(Span::styled(display, style));
        let paragraph = Paragraph::new(line).block(
            Block::default()
                .borders(Borders::TOP)
                .style(Style::default().fg(Color::DarkGray)),
        );

        f.render_widget(paragraph, area);
    }
}