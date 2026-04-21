import { useEffect, useRef } from 'react'
import './App.css'
import { useMqttData } from './hooks/useMqttData'

function NetworkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number
    let w = 0
    let h = 0

    interface Node {
      x: number
      y: number
      vx: number
      vy: number
      radius: number
    }

    let nodes: Node[] = []

    const COLORS = [
      'rgba(56,189,248,',
      'rgba(129,140,248,',
      'rgba(6,182,212,',
    ]

    function resize() {
      w = canvas!.width = window.innerWidth
      h = canvas!.height = window.innerHeight
      const count = Math.floor((w * h) / 18000)
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        radius: Math.random() * 1.5 + 0.5,
      }))
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h)

      for (const node of nodes) {
        node.x += node.vx
        node.y += node.vy
        if (node.x < 0 || node.x > w) node.vx *= -1
        if (node.y < 0 || node.y > h) node.vy *= -1
      }

      const maxDist = 160
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * 0.15
            ctx!.strokeStyle = `rgba(56,189,248,${alpha})`
            ctx!.lineWidth = 0.5
            ctx!.beginPath()
            ctx!.moveTo(nodes[i].x, nodes[i].y)
            ctx!.lineTo(nodes[j].x, nodes[j].y)
            ctx!.stroke()
          }
        }
      }

      for (const node of nodes) {
        const color = COLORS[Math.floor(Math.random() * 1000) % COLORS.length]
        ctx!.beginPath()
        ctx!.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
        ctx!.fillStyle = `${color}0.5)`
        ctx!.fill()
      }

      animationId = requestAnimationFrame(draw)
    }

    resize()
    draw()
    window.addEventListener('resize', resize)

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="network-bg" />
}

function Gauge({ value, max = 100, label, unit }: { value: number; max?: number; label: string; unit: string }) {
  const radius = 70
  const strokeWidth = 14
  const cx = 90
  const cy = 90
  const arcLength = Math.PI * radius
  const fillLength = (value / max) * arcLength
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
        <span className="gauge-value">{value}</span>
        <span className="gauge-unit">{unit}</span>
      </div>
      <div className="gauge-label">{label}</div>
      <div className="gauge-ticks">
        <span>0</span>
        <span>{max / 2}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}

function FlowIndicator({ value, unit }: { value: number; unit: string }) {
  const bars = 8
  const activeBars = Math.round((value / 20) * bars)
  return (
    <div className="flow-indicator">
      <div className="flow-value">
        <span className="flow-number">{value}</span>
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

function StatusIndicator({ label, status }: { label: string; status: 'connected' | 'disconnected' }) {
  const isOnline = status === 'connected'
  return (
    <div className={`status-indicator ${isOnline ? 'online' : 'offline'}`}>
      <span className="status-dot">
        <span className="status-dot-core" />
        <span className="status-dot-ring" />
      </span>
      <span className="status-indicator-label">{label}</span>
    </div>
  )
}

function App() {
  const { data, socketStatus, mqttStatus } = useMqttData()
  const tank = data.waterTank ?? {}

  const systemStatus = (socketStatus === 'connected' && mqttStatus === 'connected') ? 'connected' : 'disconnected'

  return (
    <div className="app">
      <NetworkBackground />
      <div className="ambient-orb orb-1" />
      <div className="ambient-orb orb-2" />
      <div className="ambient-orb orb-3" />

      <div className="content-layer">
        <header className="header">
          <div className="header-top">
            <div className="logo-group">
              <img src="/favicon.png" alt="PiSense" className="logo-icon" />
              <div>
                <h1 className="title">PiSense</h1>
                <p className="subtitle">Smart Home Monitoring</p>
              </div>
            </div>
            <div className="header-status-group">
              <StatusIndicator label="System" status={systemStatus} />
            </div>
          </div>
        </header>

        <main className="main">
          <section className="status-grid">
            <div className="card">
              <div className="card-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
                </svg>
              </div>
              <h2>Water Tank</h2>
              <Gauge value={tank.level ?? 0} max={100} label="Tank Level" unit="%" />
            </div>
            <div className="card">
              <div className="card-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M9 3v18" />
                </svg>
              </div>
              <h2>Water Volume</h2>
              <Gauge value={tank.volume ?? 0} max={500} label="Volume" unit="L" />
            </div>
            <div className="card">
              <div className="card-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M2 12l4-4v8l-4-4M22 12l-4-4v8l4-4" />
                </svg>
              </div>
              <h2>Water Flow</h2>
              <FlowIndicator value={tank.flow ?? 0} unit="L/min" />
            </div>
          </section>
        </main>

        <footer className="footer">
          <div className="footer-inner">
            <span className="footer-brand">PiSense</span>
            <span className="footer-sep">&bull;</span>
            <span>Powered by Raspberry Pi</span>
            <span className="footer-sep">&bull;</span>
            <span className="footer-time" id="footer-time">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default App
