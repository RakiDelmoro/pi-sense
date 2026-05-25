import { useState, useEffect } from 'preact/hooks';

const WS_URL = (import.meta.env?.WS_URL) || `ws://${location.host}/ws`;

interface SensorUpdate {
  topic: string;
  value: number;
  timestamp: string;
}

type TopicHandler = (update: SensorUpdate) => void;

// Singleton WebSocket client — all sensor cards share one connection
class SensorDataClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<TopicHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const topics = Array.from(this.handlers.keys());
      if (topics.length > 0) {
        this.ws.send(JSON.stringify({ action: 'subscribe', topics }));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: SensorUpdate = JSON.parse(event.data);
        const handlers = this.handlers.get(msg.topic);
        if (handlers) for (const h of handlers) h(msg);
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = () => { this.scheduleReconnect(); };
    this.ws.onerror = () => { this.ws?.close(); };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  subscribe(topic: string, handler: TopicHandler) {
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, new Set());
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'subscribe', topics: [topic] }));
      }
    }
    this.handlers.get(topic)!.add(handler);
    this.connect();
  }

  unsubscribe(topic: string, handler: TopicHandler) {
    const handlers = this.handlers.get(topic);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(topic);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ action: 'unsubscribe', topics: [topic] }));
        }
      }
    }
  }
}

const client = new SensorDataClient();

/** Get real-time value for a topic. Fetches latest from InfluxDB on mount,
    then updates from live WebSocket pushes. */
export function useSensorValue(topic: string): number | null {
  const [value, setValue] = useState<number | null>(null);

  // Fetch latest value from InfluxDB on mount so we don't show '—' for
  // data that arrived before the browser connected.
  useEffect(() => {
    fetch(`/api/history?topic=${encodeURIComponent(topic)}&range=1h`)
      .then(r => r.json())
      .then((data: { value: number; timestamp: string }[]) => {
        if (data.length > 0) {
          setValue(data[data.length - 1].value);
        }
      })
      .catch(() => { /* latest unavailable — wait for live push */ });
  }, [topic]);

  // Subscribe to live updates
  useEffect(() => {
    const handler: TopicHandler = (msg) => setValue(msg.value);
    client.subscribe(topic, handler);
    return () => client.unsubscribe(topic, handler);
  }, [topic]);

  return value;
}

export interface HistoryPoint {
  value: number;
  timestamp: string;
}

/** Get historical values for a topic. Fetches from /api/history on mount,
    then appends live updates as they arrive. */
export function useSensorHistory(topic: string, maxPoints: number = 60): HistoryPoint[] {
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  // Fetch historical data on mount
  useEffect(() => {
    fetch(`/api/history?topic=${encodeURIComponent(topic)}&range=1h`)
      .then(r => r.json())
      .then((data: HistoryPoint[]) => {
        setHistory(data.length > maxPoints ? data.slice(-maxPoints) : data);
      })
      .catch(() => { /* history unavailable — start empty */ });
  }, [topic, maxPoints]);

  // Append live updates
  useEffect(() => {
    const handler: TopicHandler = (msg) => {
      setHistory(prev => {
        const next = [...prev, { value: msg.value, timestamp: msg.timestamp }];
        return next.length > maxPoints ? next.slice(-maxPoints) : next;
      });
    };
    client.subscribe(topic, handler);
    return () => client.unsubscribe(topic, handler);
  }, [topic, maxPoints]);

  return history;
}
