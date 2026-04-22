interface GaugeProps {
  value: number
  max?: number
  min?: number
  label: string
  unit: string
}

export function Gauge({ value, max = 100, min = 0, label, unit }: GaugeProps) {
  const range = max - min
  const clamped = Math.max(min, Math.min(max, value))
  const radius = 70
  const strokeWidth = 14
  const cx = 90
  const cy = 90
  const arcLength = Math.PI * radius
  const fillLength = ((clamped - min) / range) * arcLength

  return (
    <div className="gauge">
      <svg width="180" height="100" viewBox="0 0 180 100">
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke="rgba(56, 189, 248, 0.1)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke="#5BC8F5"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${fillLength} ${arcLength}`}
          className="gauge-arc-fill"
        />
      </svg>
      <div className="gauge-cover">
        <span className="gauge-value">{Math.round(clamped)}</span>
        <span className="gauge-unit">{unit}</span>
      </div>
      <div className="gauge-label">{label}</div>
      <div className="gauge-ticks">
        <span>{min}</span>
        <span>{min + range / 2}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
