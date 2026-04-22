interface StatusIndicatorProps {
  value: number
  label: string
}

export function StatusIndicator({ value, label }: StatusIndicatorProps) {
  const isOnline = value > 0
  return (
    <div className={`status-indicator ${isOnline ? 'online' : 'offline'}`}>
      <svg className="ekg-icon" viewBox="0 0 60 24" preserveAspectRatio="none">
        <polyline
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points="0,12 6,12 8,6 10,18 12,2 14,22 16,8 18,12 60,12"
        />
      </svg>
      <span className="status-indicator-label">{label}</span>
    </div>
  )
}
