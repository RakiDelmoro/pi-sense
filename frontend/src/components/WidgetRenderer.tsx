import { Gauge } from './widgets/Gauge.tsx'
import { FlowIndicator } from './widgets/FlowIndicator.tsx'
import { NumericDisplay } from './widgets/NumericDisplay.tsx'
import { StatusIndicator } from './widgets/StatusIndicator.tsx'
import type { FieldConfig } from '../api/sensors.ts'

interface WidgetRendererProps {
  field: FieldConfig
  value: number
}

export function WidgetRenderer({ field, value }: WidgetRendererProps) {
  const { widgetType, settings, label } = field

  switch (widgetType) {
    case 'gauge':
      return (
        <Gauge
          value={value}
          min={settings.min}
          max={settings.max}
          label={label}
          unit={settings.unit}
        />
      )
    case 'flow':
      return (
        <FlowIndicator
          value={value}
          min={settings.min}
          max={settings.max}
          unit={settings.unit}
        />
      )
    case 'numeric':
      return <NumericDisplay value={value} label={label} unit={settings.unit} />
    case 'status':
      return <StatusIndicator value={value} label={label} />
    default:
      return <NumericDisplay value={value} label={label} unit={settings.unit} />
  }
}
