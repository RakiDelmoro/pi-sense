use crate::agent::{ChatMessage, ToolCall, FunctionCall};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct LlmResponse {
    pub choices: Vec<LlmChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct LlmChoice {
    pub message: LlmMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct LlmMessage {
    pub role: String,
    pub content: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDef {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: ToolFunc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFunc {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum StreamEvent {
    ThinkingChunk(String),
    TextChunk(String),
    ToolCallStart(String),
    ToolCall { id: String, name: String, arguments: String },
    Done,
    Error(String),
}

pub struct LlmClient {
    api_base: String,
    api_key: String,
    model: String,
    http: reqwest::Client,
}

impl Clone for LlmClient {
    fn clone(&self) -> Self {
        Self {
            api_base: self.api_base.clone(),
            api_key: self.api_key.clone(),
            model: self.model.clone(),
            http: self.http.clone(),
        }
    }
}

impl LlmClient {
    pub fn new(api_base: String, api_key: String, model: String) -> Self {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            api_base,
            api_key,
            model,
            http,
        }
    }

    #[allow(dead_code)]
    pub async fn chat(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDef],
    ) -> Result<LlmResponse, Box<dyn std::error::Error + Send + Sync>> {
        let mut body = serde_json::json!({
            "model": self.model,
            "messages": messages,
        });

        if !tools.is_empty() {
            body["tools"] = serde_json::to_value(tools)?;
        }

        let url = format!("{}/chat/completions", self.api_base.trim_end_matches('/'));
        log::info!("LLM request: POST {url} model={}", self.model);

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("LLM API error {status}: {text}").into());
        }

        let llm_resp: LlmResponse = resp.json().await?;
        Ok(llm_resp)
    }

    pub async fn chat_stream(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDef],
        tx: mpsc::Sender<StreamEvent>,
    ) -> Result<Option<Vec<ToolCall>>, Box<dyn std::error::Error + Send + Sync>> {
        let mut body = serde_json::json!({
            "model": self.model,
            "messages": messages,
            "stream": true,
        });

        if !tools.is_empty() {
            body["tools"] = serde_json::to_value(tools)?;
        }

        let url = format!("{}/chat/completions", self.api_base.trim_end_matches('/'));
        log::info!("LLM stream: POST {url} model={}", self.model);

        let mut resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            let _ = tx.send(StreamEvent::Error(format!("LLM API error {status}: {text}"))).await;
            return Ok(None);
        }

        let mut buf = String::new();
        let mut accumulated_tool_calls: Vec<ToolCall> = Vec::new();
        let mut in_tool_mode = false;
        let mut tool_start_sent = false;

        while let Some(chunk) = resp.chunk().await? {
            buf.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = buf.find("\n\n") {
                let event = buf[..pos].to_string();
                buf = buf[pos + 2..].to_string();
                Self::process_sse_event(&event, &tx, &mut accumulated_tool_calls, &mut in_tool_mode, &mut tool_start_sent).await;
            }
        }

        // Process any remaining data after the last newline
        if !buf.trim().is_empty() {
            Self::process_sse_event(&buf, &tx, &mut accumulated_tool_calls, &mut in_tool_mode, &mut tool_start_sent).await;
        }

        let _ = tx.send(StreamEvent::Done).await;

        if in_tool_mode && !accumulated_tool_calls.is_empty() {
            Ok(Some(accumulated_tool_calls))
        } else {
            Ok(None)
        }
    }

    async fn process_sse_event(
        raw: &str,
        tx: &mpsc::Sender<StreamEvent>,
        accumulated_tool_calls: &mut Vec<ToolCall>,
        in_tool_mode: &mut bool,
        tool_start_sent: &mut bool,
    ) {
        for line in raw.lines() {
            if !line.starts_with("data: ") {
                continue;
            }
            let data = &line[6..];
            if data == "[DONE]" {
                return;
            }

            let event: serde_json::Value = match serde_json::from_str(data) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let choices = match event.get("choices").and_then(|c| c.as_array()) {
                Some(c) => c,
                None => continue,
            };
            let choice = match choices.first() {
                Some(c) => c,
                None => continue,
            };

            let delta = choice.get("delta").unwrap_or(&serde_json::Value::Null);
            let finish_reason = choice.get("finish_reason").and_then(|f| f.as_str());

            if finish_reason == Some("tool_calls") || finish_reason == Some("function_call") {
                *in_tool_mode = true;
                return;
            }

            // Reasoning / thinking content
            // Some providers use "reasoning_content" (DeepSeek, Claude 3.7+), others "reasoning" (PPQ/Stepfun)
            let reasoning_text = delta.get("reasoning_content")
                .and_then(|c| c.as_str())
                .or_else(|| delta.get("reasoning").and_then(|c| c.as_str()));
            if let Some(reasoning) = reasoning_text {
                if !reasoning.is_empty() {
                    let _ = tx.send(StreamEvent::ThinkingChunk(reasoning.to_string())).await;
                }
            }

            // Text content
            if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                if !content.is_empty() {
                    let _ = tx.send(StreamEvent::TextChunk(content.to_string())).await;
                }
            }

            // Tool call deltas
            if let Some(tcs) = delta.get("tool_calls").and_then(|tc| tc.as_array()) {
                *in_tool_mode = true;
                for tc_delta in tcs {
                    let idx = tc_delta.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;

                    // Ensure we have a slot
                    if idx >= accumulated_tool_calls.len() {
                        accumulated_tool_calls.push(ToolCall {
                            id: tc_delta.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string(),
                            call_type: tc_delta.get("type").and_then(|t| t.as_str()).unwrap_or("function").to_string(),
                            function: FunctionCall {
                                name: String::new(),
                                arguments: String::new(),
                            },
                        });
                    }

                    let tc = &mut accumulated_tool_calls[idx];

                    // Merge name
                    if let Some(name) = tc_delta.get("function").and_then(|f| f.get("name")).and_then(|n| n.as_str()) {
                        if tc.function.name.is_empty() {
                            tc.function.name = name.to_string();
                        }
                        if !*tool_start_sent {
                            *tool_start_sent = true;
                            let _ = tx.send(StreamEvent::ToolCallStart(name.to_string())).await;
                        }
                    }

                    // Merge arguments
                    if let Some(args) = tc_delta.get("function").and_then(|f| f.get("arguments")).and_then(|a| a.as_str()) {
                        tc.function.arguments.push_str(args);
                    }
                }
            }
        }
    }
}
