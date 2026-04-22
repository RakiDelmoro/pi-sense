interface NumericDisplayProps {
  value: number
  label: string
  unit: string
}

export function NumericDisplay({ value, label, unit }: NumericDisplayProps) {
  return (
    <div className="numeric-display">
      <div className="numeric-value">
        <span className="numeric-number">{Math.round(value)}</span>
        <span className="numeric-unit">{unit}</span>
      </div>
      <div className="numeric-label">{label}</div>
    </div>
  )
}
