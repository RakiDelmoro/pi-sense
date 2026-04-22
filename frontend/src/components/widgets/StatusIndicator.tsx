interface StatusIndicatorProps {
  value: number
  label: string
}

export function StatusIndicator({ value, label }: StatusIndicatorProps) {
  const isOnline = value > 0
  return (
    <div className={`status-indicator ${isOnline ? 'online' : 'offline'}`}>
      <span className="status-dot">
        <span className="status-dot-core" />
        <span className="status-dot-ring" />
      </span>
      <span className="status-indicator-label">
        {label}
        <svg className="ekg-line" viewBox="0 0 60 24" preserveAspectRatio="none">
          <polyline
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points="0,12 6,12 8,6 10,18 12,2 14,22 16,8 18,12 60,12"
          />
        </svg>
      </span>
    </div>
  )
}
