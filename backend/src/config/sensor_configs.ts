export interface SensorFieldConfig {
  label: string
  unit: string
  max: number
  topic: string
}

export interface SensorConfig {
  label: string
  fields: Record<string, SensorFieldConfig>
}

export interface AppConfig {
  mqtt: {
    brokerUrl: string
  }
  server: {
    port: number
  }
  sensors: Record<string, SensorConfig>
}

const config: AppConfig = {
  mqtt: {
    brokerUrl: 'mqtt://localhost:1883',
  },
  server: {
    port: 3001,
  },
  sensors: {
    waterTank: {
      label: 'Water Tank',
      fields: {
        level: {
          label: 'Tank Level',
          unit: '%',
          max: 100,
          topic: 'esp/water-tank-test',
        },
        volume: {
          label: 'Volume',
          unit: 'L',
          max: 500,
          topic: 'esp/water-tank/volume',
        },
        flow: {
          label: 'Flow Rate',
          unit: 'L/min',
          max: 20,
          topic: 'esp/water-tank/flow',
        },
      },
    },
  },
}

export default config
