use std::cell::Cell;
use ratatui::{
    Frame,
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
};
use unicode_width::UnicodeWidthStr;

enum ChatLine {
    System(String),
    User(String),
    Thinking(String),
    Assistant(String),
    ToolCall(String),
    ToolResult(String),
}

const SPINNER_FRAMES: [&str; 10] = [
    "\u{280b}", "\u{2819}", "\u{2839}", "\u{2838}", "\u{283c}",
    "\u{2834}", "\u{2826}", "\u{2827}", "\u{2807}", "\u{280f}",
];

pub struct ChatPane {
    messages: Vec<ChatLine>,
    scroll_offset: u16,
    thinking_buffer: String,
    stream_buffer: String,
    streaming: bool,
    following: bool,
    spinner_frame: Cell<u8>,
    line_count: usize,
    new_messages_while_scrolled: usize,
}

impl ChatPane {
    pub fn new() -> Self {
        Self {
            messages: Vec::new(),
            scroll_offset: 0,
            thinking_buffer: String::new(),
            stream_buffer: String::new(),
            streaming: false,
            following: true,
            spinner_frame: Cell::new(0),
            line_count: 0,
            new_messages_while_scrolled: 0,
        }
    }

    pub fn add_system(&mut self, text: &str) {
        self.messages.push(ChatLine::System(text.into()));
        self.bump_new_counter();
    }

    pub fn add_user(&mut self, text: &str) {
        self.messages.push(ChatLine::User(text.into()));
        self.following = true;
        self.scroll_offset = 0;
        self.new_messages_while_scrolled = 0;
    }

    pub fn add_assistant(&mut self, text: &str) {
        self.messages.push(ChatLine::Assistant(text.into()));
        self.bump_new_counter();
    }

    pub fn start_stream(&mut self) {
        self.streaming = true;
        self.thinking_buffer.clear();
        self.stream_buffer.clear();
        self.spinner_frame.set(0);
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
        self.bump_new_counter();
    }

    pub fn add_tool_result(&mut self, name: &str, result: &str) {
        self.messages.push(ChatLine::ToolResult(format!("[{name}] {result}")));
        self.bump_new_counter();
    }

    pub fn finish_stream(&mut self) {
        if self.streaming {
            self.commit_thinking();
            if !self.stream_buffer.is_empty() {
                self.messages.push(ChatLine::Assistant(std::mem::take(&mut self.stream_buffer)));
            }
            self.streaming = false;
            if self.following {
                self.scroll_offset = 0;
            }
        }
    }

    pub fn cancel_stream(&mut self) {
        if self.streaming {
            self.thinking_buffer.clear();
            self.stream_buffer.clear();
            self.streaming = false;
        }
    }

    fn bump_new_counter(&mut self) {
        if !self.following {
            self.new_messages_while_scrolled = self.new_messages_while_scrolled.saturating_add(1);
        }
    }

    // ── scroll ─────────────────────────────────────────────────────

    pub fn scroll_up(&mut self) {
        self.scroll_offset = self.scroll_offset.saturating_add(1);
        self.following = false;
    }

    pub fn scroll_down(&mut self) {
        self.scroll_offset = self.scroll_offset.saturating_sub(1);
        self.following = false;
    }

    pub fn scroll_page_up(&mut self) {
        self.scroll_offset = self.scroll_offset.saturating_add(10);
        self.following = false;
    }

    pub fn scroll_page_down(&mut self) {
        self.scroll_offset = self.scroll_offset.saturating_sub(10);
        self.following = false;
    }

    pub fn scroll_rows(&mut self, rows: i16) {
        if rows > 0 {
            self.scroll_offset = self.scroll_offset.saturating_sub(rows as u16);
        } else {
            self.scroll_offset = self.scroll_offset.saturating_add((-rows) as u16);
        }
        self.following = false;
    }

    pub fn snap_to_bottom(&mut self) {
        self.following = true;
        self.scroll_offset = 0;
        self.new_messages_while_scrolled = 0;
    }

    pub fn is_following(&self) -> bool {
        self.following
    }

    pub fn scroll_offset(&self) -> u16 {
        self.scroll_offset
    }

    pub fn new_messages_while_scrolled(&self) -> usize {
        self.new_messages_while_scrolled
    }

    pub fn line_count(&self) -> usize {
        self.line_count
    }

    pub fn tick_spinner(&self) {
        if self.streaming {
            let next = (self.spinner_frame.get() + 1) % SPINNER_FRAMES.len() as u8;
            self.spinner_frame.set(next);
        }
    }

    // ── rendering ───────────────────────────────────────────────────

    pub fn draw(&mut self, f: &mut Frame, area: Rect) {
        let width = area.width;
        let offset = self.scroll_offset;
        let follow = self.following;

        let lines = build_lines(
            &self.messages,
            self.streaming,
            &self.thinking_buffer,
            &self.stream_buffer,
            self.spinner_frame.get() as usize,
            width,
        );

        let total = lines.len() as u16;
        self.line_count = lines.len();
        let height = area.height;
        let max_offset = if total > height { total - height } else { 0 };

        let scroll = if follow {
            max_offset
        } else {
            max_offset.saturating_sub(offset)
        };

        let paragraph = Paragraph::new(lines)
            .block(Block::default().borders(Borders::NONE))
            .scroll((scroll, 0));

        f.render_widget(paragraph, area);
    }
}

// ── text wrapping ──────────────────────────────────────────────────

/// Wrap a plain-text string into one `Line` per visual row, each styled
/// with `style`. Every returned `Line` occupies exactly one terminal row
/// at the given `width`, so logical lines == visual rows.
fn wrap_text_styled(text: &str, width: u16, style: Style) -> Vec<Line<'static>> {
    let max = width as usize;
    if max == 0 {
        return vec![Line::from("")];
    }

    let mut out = Vec::new();

    for paragraph in text.split('\n') {
        if paragraph.is_empty() {
            out.push(Line::from(Span::styled(String::new(), style)));
            continue;
        }

        let mut line_buf = String::new();
        let mut line_width = 0usize;

        for word in paragraph.split_whitespace() {
            let word_width = UnicodeWidthStr::width(word);
            let space_width = if line_buf.is_empty() { 0 } else { 1 };

            if line_width + space_width + word_width > max && !line_buf.is_empty() {
                out.push(Line::from(Span::styled(std::mem::take(&mut line_buf), style)));
                line_width = 0;
                line_buf.clear();
            }

            if line_width + space_width + word_width <= max {
                if line_width > 0 {
                    line_buf.push(' ');
                    line_width += 1;
                }
                line_buf.push_str(word);
                line_width += word_width;
            } else {
                for ch in word.chars() {
                    let cw = UnicodeWidthStr::width(ch.encode_utf8(&mut [0; 4]));
                    if line_width + cw > max && line_width > 0 {
                        out.push(Line::from(Span::styled(std::mem::take(&mut line_buf), style)));
                        line_width = 0;
                    }
                    line_buf.push(ch);
                    line_width += cw;
                }
            }
        }

        if !line_buf.is_empty() || paragraph.is_empty() {
            out.push(Line::from(Span::styled(line_buf, style)));
        }
    }

    if out.is_empty() {
        out.push(Line::from(Span::styled(String::new(), style)));
    }

    out
}

/// Wrap text that has a fixed prefix (e.g. `"◆ "`, `"▸ "`, `"│ "`, `"▶ "`).
/// The prefix is only rendered on the first visual line; continuation lines
/// get a smaller indent so the text aligns nicely.
fn wrap_prefixed(text: &str, prefix: &str, indent: &str, width: u16, prefix_style: Style, body_style: Style) -> Vec<Line<'static>> {
    let max = width as usize;
    if max == 0 {
        return vec![Line::from(Span::styled(String::new(), body_style))];
    }

    let mut out = Vec::new();
    let prefix_w = UnicodeWidthStr::width(prefix);
    let indent_w = UnicodeWidthStr::width(indent);

    for (para_idx, paragraph) in text.split('\n').enumerate() {
        if para_idx > 0 {
            out.push(Line::from(Span::styled(String::new(), body_style)));
        }

        if paragraph.is_empty() && para_idx > 0 {
            continue;
        }

        let effective_prefix = if para_idx == 0 { prefix } else { "" };
        let effective_prefix_w = if para_idx == 0 { prefix_w } else { 0 };
        let effective_indent = if para_idx == 0 { "" } else { indent };
        let effective_indent_w = if para_idx == 0 { 0 } else { indent_w };
        let first_line_max = max.saturating_sub(effective_prefix_w);
        let cont_line_max = max.saturating_sub(effective_indent_w);

        let mut first_line = true;
        let mut line_buf = String::new();
        let mut line_width = 0usize;
        let _line_max = if first_line { first_line_max } else { cont_line_max };

        for word in paragraph.split_whitespace() {
            let word_width = UnicodeWidthStr::width(word);
            let space_width = if line_buf.is_empty() { 0 } else { 1 };
            let current_max = if first_line { first_line_max } else { cont_line_max };

            if line_width + space_width + word_width > current_max && !line_buf.is_empty() {
                let cur_indent = if first_line { effective_prefix } else { effective_indent };
                let cur_indent_w = if first_line { effective_prefix_w } else { effective_indent_w };
                out.push(make_prefixed_line(cur_indent, cur_indent_w, &line_buf, prefix_style, body_style));
                first_line = false;
                line_buf.clear();
                line_width = 0;
            }

            let current_max = if first_line { first_line_max } else { cont_line_max };

            if line_width + space_width + word_width <= current_max {
                if line_width > 0 {
                    line_buf.push(' ');
                    line_width += 1;
                }
                line_buf.push_str(word);
                line_width += word_width;
            } else {
                for ch in word.chars() {
                    let cw = UnicodeWidthStr::width(ch.encode_utf8(&mut [0; 4]));
                    let current_max = if first_line { first_line_max } else { cont_line_max };
                    if line_width + cw > current_max && line_width > 0 {
                        let cur_indent = if first_line { effective_prefix } else { effective_indent };
                        let cur_indent_w = if first_line { effective_prefix_w } else { effective_indent_w };
                        out.push(make_prefixed_line(cur_indent, cur_indent_w, &line_buf, prefix_style, body_style));
                        first_line = false;
                        line_buf.clear();
                        line_width = 0;
                    }
                    line_buf.push(ch);
                    line_width += cw;
                }
            }
        }

        if !line_buf.is_empty() || (paragraph.is_empty() && para_idx == 0) {
            let cur_indent = if first_line { effective_prefix } else { effective_indent };
            let cur_indent_w = if first_line { effective_prefix_w } else { effective_indent_w };
            out.push(make_prefixed_line(cur_indent, cur_indent_w, &line_buf, prefix_style, body_style));
        }
    }

    if out.is_empty() {
        out.push(Line::from(Span::styled(String::new(), body_style)));
    }

    out
}

fn make_prefixed_line(indent: &str, _indent_w: usize, body: &str, indent_style: Style, body_style: Style) -> Line<'static> {
    if indent.is_empty() {
        Line::from(Span::styled(body.to_string(), body_style))
    } else {
        Line::from(vec![
            Span::styled(indent.to_string(), indent_style),
            Span::styled(body.to_string(), body_style),
        ])
    }
}

// ── build_lines ────────────────────────────────────────────────────

fn build_lines<'a>(
    messages: &'a [ChatLine],
    streaming: bool,
    thinking_buffer: &'a str,
    stream_buffer: &'a str,
    spinner_idx: usize,
    width: u16,
) -> Vec<Line<'a>> {
    let mut lines: Vec<Line> = Vec::new();

    for msg in messages {
        match msg {
            ChatLine::System(t) => {
                lines.extend(wrap_prefixed(
                    t, "\u{25C6} ", "  ", width,
                    Style::default().fg(Color::DarkGray),
                    Style::default().fg(Color::DarkGray),
                ));
            }
            ChatLine::User(t) => {
                lines.extend(wrap_prefixed(
                    t, "\u{25B8} ", "  ", width,
                    Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
                    Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
                ));
            }
            ChatLine::Thinking(t) => {
                lines.extend(wrap_prefixed(
                    t, "\u{2502} ", "\u{2502} ", width,
                    Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC),
                    Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC),
                ));
            }
            ChatLine::Assistant(t) => {
                if t.is_empty() {
                    lines.push(Line::from(""));
                } else {
                    lines.extend(wrap_text_styled(
                        t, width,
                        Style::default().fg(Color::Gray),
                    ));
                }
            }
            ChatLine::ToolCall(t) => {
                lines.extend(wrap_prefixed(
                    t, "\u{25B6} ", "  ", width,
                    Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
                    Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
                ));
            }
            ChatLine::ToolResult(t) => {
                lines.extend(wrap_text_styled(
                    t, width,
                    Style::default().fg(Color::DarkGray),
                ));
            }
        }
    }

    if streaming && stream_buffer.is_empty() {
        let spinner = SPINNER_FRAMES[spinner_idx];
        lines.push(Line::from(Span::styled(
            format!("  {spinner} Thinking..."),
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::ITALIC),
        )));
    }

    if streaming && !thinking_buffer.is_empty() {
        lines.extend(wrap_prefixed(
            thinking_buffer, "\u{2502} ", "\u{2502} ", width,
            Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC),
            Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC),
        ));
    }

    if streaming {
        if stream_buffer.is_empty() && thinking_buffer.is_empty() {
            lines.push(Line::from(""));
        } else if !stream_buffer.is_empty() {
            lines.extend(wrap_text_styled(
                stream_buffer, width,
                Style::default().fg(Color::Gray),
            ));
        }
    }

    lines
}