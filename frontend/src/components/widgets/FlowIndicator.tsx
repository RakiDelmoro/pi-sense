interface FlowIndicatorProps {
  value: number
  unit: string
  max?: number
  min?: number
}

export function FlowIndicator({ value, unit, max = 20, min = 0 }: FlowIndicatorProps) {
  const range = max - min
  const clamped = Math.max(min, Math.min(max, value))
  const bars = 8
  const activeBars = Math.round(((clamped - min) / range) * bars)

  return (
    <div className="flow-indicator">
      <div className="flow-value">
        <span className="flow-number">{Math.round(clamped)}</span>
        <span className="flow-unit">{unit}</span>
      </div>
      <div className="flow-bars">
        {Array.from({ length: bars }, (_, i) => (
          <div
            key={i}
            className={`flow-bar ${i < activeBars ? 'active' : ''}`}
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
      <div className="flow-label">Flow Rate</div>
    </div>
  )
}
