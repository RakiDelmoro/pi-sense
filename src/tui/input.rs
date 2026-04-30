use ratatui::{
    Frame,
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
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
        self.cursor += c.len_utf8();
    }

    pub fn backspace(&mut self) {
        if self.cursor > 0 {
            let prev = self.buffer[..self.cursor].chars().rev().next();
            if let Some(c) = prev {
                self.cursor -= c.len_utf8();
                self.buffer.remove(self.cursor);
            }
        }
    }

    pub fn cursor_left(&mut self) {
        if self.cursor == 0 {
            return;
        }
        // Move back to the start of the previous UTF-8 character
        let mut pos = self.cursor.saturating_sub(1);
        while pos > 0 && !self.buffer.is_char_boundary(pos) {
            pos -= 1;
        }
        self.cursor = pos;
    }

    pub fn cursor_right(&mut self) {
        if self.cursor >= self.buffer.len() {
            return;
        }
        // Move forward to the end of the current UTF-8 character
        let mut pos = self.cursor + 1;
        while pos < self.buffer.len() && !self.buffer.is_char_boundary(pos) {
            pos += 1;
        }
        self.cursor = pos;
    }

    pub fn cursor_home(&mut self) {
        self.cursor = 0;
    }

    pub fn cursor_end(&mut self) {
        self.cursor = self.buffer.len();
    }

    pub fn take(&mut self) -> String {
        let s = self.buffer.clone();
        self.buffer.clear();
        self.cursor = 0;
        s
    }

    pub fn draw(&self, f: &mut Frame, area: Rect, loading: bool) {
        let block = Block::default()
            .borders(Borders::TOP)
            .style(Style::default().fg(Color::DarkGray));

        if loading {
            let text = " > thinking...".to_string();
            let style = Style::default().fg(Color::Yellow).add_modifier(Modifier::SLOW_BLINK);
            let line = Line::from(Span::styled(text, style));
            let paragraph = Paragraph::new(line)
                .wrap(Wrap { trim: false })
                .block(block);
            f.render_widget(paragraph, area);
            return;
        }

        let prefix = " > ";
        let before = &self.buffer[..self.cursor];
        let after = &self.buffer[self.cursor..];

        // Show a blinking block cursor at the insertion point.
        // When the buffer is empty the cursor sits right after the prefix.
        let spans = vec![
            Span::styled(prefix, Style::default().fg(Color::White)),
            Span::styled(before.to_string(), Style::default().fg(Color::White)),
            Span::styled(
                "█",
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::SLOW_BLINK),
            ),
            Span::styled(after.to_string(), Style::default().fg(Color::White)),
        ];

        let line = Line::from(spans);
        let paragraph = Paragraph::new(line)
            .wrap(Wrap { trim: false })
            .block(block);

        f.render_widget(paragraph, area);
    }
}
