use ratatui::{
    Frame,
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
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
        let inner = block.inner(area);

        if loading {
            let text = " > thinking...".to_string();
            let style = Style::default().fg(Color::Yellow).add_modifier(Modifier::SLOW_BLINK);
            let line = Line::from(Span::styled(text, style));
            let para = Paragraph::new(line).block(block);
            f.render_widget(para, area);
            return;
        }

        // Build the full display string with a blinking "█" cursor.
        let before = &self.buffer[..self.cursor];
        let after = &self.buffer[self.cursor..];
        let full = format!("{before}█{after}");

        // Character-wrap so the text never overflows the allocated width.
        let width = inner.width as usize;
        let max_lines = inner.height as usize;
        let mut lines: Vec<String> = Vec::new();
        let mut current = String::new();
        for c in full.chars() {
            if width > 0 && current.len() >= width {
                lines.push(std::mem::take(&mut current));
            }
            current.push(c);
        }
        if !current.is_empty() {
            lines.push(current);
        }

        // Only keep the last N lines that fit in the area.
        let total = lines.len();
        let start = if total > max_lines && max_lines > 0 {
            total - max_lines
        } else {
            0
        };
        let visible_lines = lines[start..]
            .iter()
            .map(|l| Line::from(Span::styled(l.as_str(), Style::default().fg(Color::White))))
            .collect::<Vec<_>>();

        let text = Text::from(visible_lines);
        let paragraph = Paragraph::new(text).block(block);
        f.render_widget(paragraph, area);
    }
}
