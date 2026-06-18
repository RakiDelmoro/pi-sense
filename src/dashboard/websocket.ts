import type { ServerWebSocket } from 'bun';

export const wsClients = new Set<ServerWebSocket>();
export const topicSubs = new Map<string, Set<ServerWebSocket>>(); // topic → set of ws

export function subscribeWs(ws: ServerWebSocket, topics: string[]) {
  for (const topic of topics) {
    if (!topicSubs.has(topic)) topicSubs.set(topic, new Set());
    topicSubs.get(topic)!.add(ws);
  }
}

export function unsubscribeWs(ws: ServerWebSocket, topics: string[]) {
  for (const topic of topics) {
    topicSubs.get(topic)?.delete(ws);
    if (topicSubs.get(topic)?.size === 0) topicSubs.delete(topic);
  }
}

export function removeWs(ws: ServerWebSocket) {
  wsClients.delete(ws);
  for (const [, subs] of topicSubs) {
    subs.delete(ws);
  }
  for (const [topic, subs] of topicSubs) {
    if (subs.size === 0) topicSubs.delete(topic);
  }
}

/** Push a sensor update to all browsers subscribed to that topic */
export function broadcastUpdate(topic: string, value: number, timestamp: string, timeOffsetMs?: number) {
  const msg = JSON.stringify({ topic, value, timestamp, ...(timeOffsetMs != null && { timeOffsetMs }) });
  const subs = topicSubs.get(topic);
  console.log(`📤 WS → ${topic}: ${value} (${subs?.size ?? 0} clients)`);
  if (subs) {
    for (const ws of subs) {
      ws.send(msg);
    }
  }
}
