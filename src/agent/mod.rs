use crate::config::Config;
use crate::storage::Db;
use crate::mqtt::MqttManager;
use crate::agent::llm::LlmClient;
use crate::agent::tools::ToolExecutor;
use crate::server::DashboardMessage;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};

pub mod llm;
pub mod prompt;
pub mod tools;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone)]
pub enum AgentEvent {
    Chunk(String),
    ToolCallStart(String),
    ToolResult { name: String, result: String },
    Done,
    Error(String),
}

#[derive(Debug)]
pub struct AgentResponse {
    pub text: String,
    pub tool_results: Vec<ToolResult>,
}

#[derive(Debug)]
pub struct ToolResult {
    pub name: String,
    pub result: String,
}

pub struct Agent {
    llm: Option<LlmClient>,
    tool_executor: ToolExecutor,
    history: Vec<ChatMessage>,
    config: Config,
}

impl Agent {
    pub fn new(config: Config, db: Arc<Db>, mqtt: Arc<MqttManager>, dashboard_tx: broadcast::Sender<DashboardMessage>) -> Self {
        let default_broker = config.mqtt.default_broker.clone();
        let llm = config.llm.as_ref().map(|llm| {
            LlmClient::new(
                config.llm_api_base().unwrap_or_default(),
                llm.api_key.clone(),
                llm.model.clone(),
            )
        });
        Self {
            llm,
            tool_executor: ToolExecutor::new(db, mqtt)
                .with_default_broker(default_broker)
                .with_dashboard_tx(dashboard_tx),
            history: Vec::new(),
            config,
        }
    }

    pub fn reload_config(&mut self, config: Config) {
        if let Some(ref llm) = config.llm {
            self.llm = Some(LlmClient::new(
                config.llm_api_base().unwrap_or_default(),
                llm.api_key.clone(),
                llm.model.clone(),
            ));
        }
        self.config = config;
    }

    #[allow(dead_code)]
    pub fn is_configured(&self) -> bool {
        self.llm.is_some()
    }

    pub async fn run_prompt(&mut self, user_prompt: &str) -> Result<AgentResponse, Box<dyn std::error::Error + Send + Sync>> {
        let llm = match &self.llm {
            Some(l) => l,
            None => return Ok(AgentResponse {
                text: "No LLM configured. Run /connect first.".into(),
                tool_results: Vec::new(),
            }),
        };

        self.history.push(ChatMessage {
            role: "user".into(),
            content: Some(user_prompt.into()),
            tool_calls: None,
            tool_call_id: None,
        });

        let system_prompt = self.tool_executor.build_system_prompt_context().await;
        let tools = self.tool_executor.tool_definitions();

        let mut response = AgentResponse {
            text: String::new(),
            tool_results: Vec::new(),
        };

        for _ in 0..5 {
            let mut messages = vec![ChatMessage {
                role: "system".into(),
                content: Some(system_prompt.clone()),
                tool_calls: None,
                tool_call_id: None,
            }];
            messages.extend(self.history.clone());

            let llm_response = llm.chat(&messages, &tools).await?;

            let assistant_msg = llm_response.choices.first()
                .ok_or("no choices in LLM response")?
                .message.clone();

            let has_tool_calls = assistant_msg.tool_calls.is_some()
                && !assistant_msg.tool_calls.as_ref().unwrap().is_empty();

            if !has_tool_calls {
                let text = assistant_msg.content.unwrap_or_default();
                self.history.push(ChatMessage {
                    role: "assistant".into(),
                    content: Some(text.clone()),
                    tool_calls: None,
                    tool_call_id: None,
                });
                response.text = text;
                return Ok(response);
            }

            let tool_calls = assistant_msg.tool_calls.unwrap();
            let mut tool_results_msg = Vec::new();

            for tc in &tool_calls {
                let result = self.tool_executor.execute(&tc.function.name, &tc.function.arguments).await;
                response.tool_results.push(ToolResult {
                    name: tc.function.name.clone(),
                    result: result.clone(),
                });
                tool_results_msg.push(ChatMessage {
                    role: "tool".into(),
                    content: Some(result),
                    tool_calls: None,
                    tool_call_id: Some(tc.id.clone()),
                });
            }

            self.history.push(ChatMessage {
                role: "assistant".into(),
                content: assistant_msg.content,
                tool_calls: Some(tool_calls),
                tool_call_id: None,
            });
            for msg in tool_results_msg {
                self.history.push(msg);
            }
        }

        response.text = "I reached the maximum number of tool calls. Please try again.".into();
        Ok(response)
    }

    pub async fn run_prompt_stream(
        &mut self,
        user_prompt: &str,
        tx: mpsc::Sender<AgentEvent>,
    ) {
        if self.llm.is_none() {
            let _ = tx.send(AgentEvent::Chunk("No LLM configured. Run /connect first.".into())).await;
            let _ = tx.send(AgentEvent::Done).await;
            return;
        }

        self.history.push(ChatMessage {
            role: "user".into(),
            content: Some(user_prompt.into()),
            tool_calls: None,
            tool_call_id: None,
        });

        let system_prompt = self.tool_executor.build_system_prompt_context().await;
        let tools = self.tool_executor.tool_definitions();

        for _ in 0..5 {
            let mut messages = vec![ChatMessage {
                role: "system".into(),
                content: Some(system_prompt.clone()),
                tool_calls: None,
                tool_call_id: None,
            }];
            messages.extend(self.history.clone());

            let llm = self.llm.as_ref().unwrap().clone();
            let (llm_tx, mut llm_rx) = mpsc::channel::<llm::StreamEvent>(128);

            let tools_for_spawn = tools.clone();
            let handle = tokio::spawn(async move {
                llm.chat_stream(&messages, &tools_for_spawn, llm_tx).await
            });

            let mut accumulated_text = String::new();
            while let Some(event) = llm_rx.recv().await {
                match event {
                    llm::StreamEvent::TextChunk(text) => {
                        accumulated_text.push_str(&text);
                        let _ = tx.send(AgentEvent::Chunk(text)).await;
                    }
                    llm::StreamEvent::ToolCallStart(name) => {
                        let _ = tx.send(AgentEvent::ToolCallStart(name)).await;
                    }
                    llm::StreamEvent::Done => break,
                    llm::StreamEvent::Error(e) => {
                        let _ = tx.send(AgentEvent::Error(e)).await;
                        return;
                    }
                    llm::StreamEvent::ToolCall { .. } => {}
                }
            }

            let tool_calls_result = match handle.await {
                Ok(Ok(tc)) => tc,
                Ok(Err(e)) => {
                    let _ = tx.send(AgentEvent::Error(format!("{e}"))).await;
                    return;
                }
                Err(e) => {
                    let _ = tx.send(AgentEvent::Error(format!("Task join error: {e}"))).await;
                    return;
                }
            };

            if let Some(tool_calls) = tool_calls_result {
                let mut tool_results_msg = Vec::new();
                for tc in &tool_calls {
                    let result = self.tool_executor.execute(&tc.function.name, &tc.function.arguments).await;
                    let display = if result.starts_with("OK:") { &result[3..] } else { &result };
                    let _ = tx.send(AgentEvent::ToolResult {
                        name: tc.function.name.clone(),
                        result: display.to_string(),
                    }).await;
                    tool_results_msg.push(ChatMessage {
                        role: "tool".into(),
                        content: Some(result),
                        tool_calls: None,
                        tool_call_id: Some(tc.id.clone()),
                    });
                }

                self.history.push(ChatMessage {
                    role: "assistant".into(),
                    content: Some(accumulated_text).filter(|s| !s.is_empty()),
                    tool_calls: Some(tool_calls),
                    tool_call_id: None,
                });
                for msg in tool_results_msg {
                    self.history.push(msg);
                }
            } else {
                self.history.push(ChatMessage {
                    role: "assistant".into(),
                    content: Some(accumulated_text.clone()).filter(|s| !s.is_empty()),
                    tool_calls: None,
                    tool_call_id: None,
                });
                let _ = tx.send(AgentEvent::Done).await;
                return;
            }
        }

        let _ = tx.send(AgentEvent::Chunk("I reached the maximum number of tool calls. Please try again.".into())).await;
        let _ = tx.send(AgentEvent::Done).await;
    }

    #[allow(dead_code)]
    pub fn clear_history(&mut self) {
        self.history.clear();
    }
}
