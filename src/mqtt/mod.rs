use rumqttc::{AsyncClient, Event, EventLoop, Incoming, MqttOptions, QoS};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};

#[derive(Debug, Clone, Serialize)]
pub struct SensorReading {
    pub sensor_id: String,
    pub topic: String,
    pub value: String,
    pub timestamp: i64,
}

struct BrokerHandle {
    client: AsyncClient,
    eventloop: Arc<Mutex<EventLoop>>,
    subscribed_topics: Vec<String>,
}

pub struct MqttManager {
    brokers: Arc<Mutex<HashMap<String, BrokerHandle>>>,
    tx: broadcast::Sender<SensorReading>,
    client_id_base: String,
    topic_to_sensor: Arc<Mutex<HashMap<String, String>>>,
}

impl MqttManager {
    pub fn new(client_id_base: String) -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            brokers: Arc::new(Mutex::new(HashMap::new())),
            tx,
            client_id_base,
            topic_to_sensor: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn subscribe_rx(&self) -> broadcast::Receiver<SensorReading> {
        self.tx.subscribe()
    }

    pub async fn subscribe(&self, sensor_id: String, topic: String, broker: String, broker_port: u16) -> Result<(), String> {
        let broker_key = format!("{broker}:{broker_port}");
        let mut brokers = self.brokers.lock().await;

        {
            let mut map = self.topic_to_sensor.lock().await;
            map.insert(topic.clone(), sensor_id.clone());
        }

        if let Some(handle) = brokers.get_mut(&broker_key) {
            if !handle.subscribed_topics.contains(&topic) {
                handle
                    .client
                    .subscribe(&topic, QoS::AtLeastOnce)
                    .await
                    .map_err(|e| format!("mqtt subscribe error: {e}"))?;
                handle.subscribed_topics.push(topic.clone());
            }
            return Ok(());
        }

        let client_id = format!("{}-{}", self.client_id_base, broker_key.replace('.', "-").replace(':', "-"));
        let mut options = MqttOptions::new(client_id, &broker, broker_port);
        options.set_keep_alive(std::time::Duration::from_secs(30));

        let (client, eventloop) = AsyncClient::new(options, 10);
        client
            .subscribe(&topic, QoS::AtLeastOnce)
            .await
            .map_err(|e| format!("mqtt subscribe error: {e}"))?;

        let handle = BrokerHandle {
            client,
            eventloop: Arc::new(Mutex::new(eventloop)),
            subscribed_topics: vec![topic.clone()],
        };

        brokers.insert(broker_key.clone(), handle);

        drop(brokers);
        self.spawn_event_loop(broker, broker_port);

        Ok(())
    }

    pub async fn unsubscribe(&self, topic: &str, broker: &str, broker_port: u16) -> Result<(), String> {
        let broker_key = format!("{broker}:{broker_port}");
        let mut brokers = self.brokers.lock().await;

        {
            let mut map = self.topic_to_sensor.lock().await;
            map.remove(topic);
        }

        if let Some(handle) = brokers.get_mut(&broker_key) {
            handle
                .client
                .unsubscribe(topic)
                .await
                .map_err(|e| format!("mqtt unsubscribe error: {e}"))?;
            handle.subscribed_topics.retain(|t| t != topic);

            if handle.subscribed_topics.is_empty() {
                brokers.remove(&broker_key);
            }
        }

        Ok(())
    }

    pub async fn publish(&self, topic: String, broker: String, broker_port: u16, payload: String) -> Result<(), String> {
        let broker_key = format!("{broker}:{broker_port}");
        let brokers = self.brokers.lock().await;

        let handle = brokers.get(&broker_key)
            .ok_or_else(|| format!("No MQTT connection to {broker_key}"))?;

        handle.client
            .publish(&topic, QoS::AtLeastOnce, false, payload)
            .await
            .map_err(|e| format!("mqtt publish error: {e}"))
    }

    fn spawn_event_loop(&self, broker: String, broker_port: u16) {
        let brokers = self.brokers.clone();
        let tx = self.tx.clone();
        let topic_map = self.topic_to_sensor.clone();

        tokio::spawn(async move {
            let broker_key = format!("{broker}:{broker_port}");

            loop {
                let eventloop_arc = {
                    let brokers = brokers.lock().await;
                    match brokers.get(&broker_key) {
                        Some(handle) => handle.eventloop.clone(),
                        None => {
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            continue;
                        }
                    }
                };

                let mut el = eventloop_arc.lock().await;

                loop {
                    match el.poll().await {
                        Ok(Event::Incoming(Incoming::Publish(publish))) => {
                            let payload = String::from_utf8_lossy(&publish.payload).to_string();
                            let timestamp = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs() as i64;

                            let sensor_id = {
                                let map = topic_map.lock().await;
                                map.get(&publish.topic).cloned().unwrap_or_default()
                            };

                            let reading = SensorReading {
                                sensor_id,
                                topic: publish.topic.clone(),
                                value: payload,
                                timestamp,
                            };
                            let _ = tx.send(reading);
                        }
                        Ok(_) => {}
                        Err(e) => {
                            log::warn!("mqtt event loop error for {broker_key}: {e}");
                            drop(el);
                            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                            break;
                        }
                    }
                }
            }
        });
    }
}
