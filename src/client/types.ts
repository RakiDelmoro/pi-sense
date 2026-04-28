export type PayloadType = "plain" | "json";
export type WidgetType = "text" | "gauge" | "switch";

export interface SensorConfig {
  id: string;
  topic: string;
  label: string;
  payloadType: PayloadType;
  jsonPath: string;
  widgetType: WidgetType;
  unit: string;
  min: number;
  max: number;
}

export interface SensorReading {
  topic: string;
  value: string | number | boolean;
  rawPayload: string;
  timestamp: number;
}

export interface MqttMessage {
  topic: string;
  payload: string;
}
