import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const DRONE_IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/0/09/DJI_Agras_T50_demonstrating_sprayers_in_flight.jpg'

const DRONES = [
  { top: '12%', size: 152, duration: '26s', delay: '-4s', depth: 'near', path: 'path-a' },
  { top: '24%', size: 124, duration: '32s', delay: '-16s', depth: 'mid', path: 'path-c' },
  { top: '38%', size: 108, duration: '30s', delay: '-9s', depth: 'far', path: 'path-b' },
  { top: '52%', size: 142, duration: '27s', delay: '-13s', depth: 'near', path: 'path-b' },
  { top: '66%', size: 118, duration: '34s', delay: '-18s', depth: 'mid', path: 'path-a' },
  { top: '78%', size: 96, duration: '36s', delay: '-23s', depth: 'far', path: 'path-c' },
  { top: '9%', size: 104, duration: '33s', delay: '-11s', depth: 'far', path: 'path-c' },
  { top: '18%', size: 134, duration: '29s', delay: '-21s', depth: 'mid', path: 'path-a' },
  { top: '31%', size: 146, duration: '25s', delay: '-15s', depth: 'near', path: 'path-b' },
  { top: '47%', size: 102, duration: '38s', delay: '-26s', depth: 'far', path: 'path-a' },
  { top: '59%', size: 130, duration: '31s', delay: '-19s', depth: 'mid', path: 'path-c' },
  { top: '72%', size: 148, duration: '27s', delay: '-29s', depth: 'near', path: 'path-b' },
]

const SPRAY_PARTICLES = [
  { left: 8, duration: '1.7s', delay: '-0.6s', size: 2.2 },
  { left: 14, duration: '2.1s', delay: '-1.2s', size: 2.6 },
  { left: 23, duration: '1.9s', delay: '-0.8s', size: 2.1 },
  { left: 31, duration: '2.3s', delay: '-1.9s', size: 2.8 },
  { left: 39, duration: '1.8s', delay: '-0.4s', size: 2.0 },
  { left: 47, duration: '2.0s', delay: '-1.4s', size: 2.4 },
  { left: 56, duration: '2.2s', delay: '-1.1s', size: 2.7 },
  { left: 64, duration: '1.8s', delay: '-0.2s', size: 2.1 },
  { left: 72, duration: '2.4s', delay: '-1.7s', size: 2.9 },
  { left: 81, duration: '2.0s', delay: '-0.9s', size: 2.3 },
  { left: 89, duration: '1.9s', delay: '-1.5s', size: 2.0 },
]

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

function DroneSprite() {
  return (
    <div className="login-drone-shell">
      <span className="login-rotor rotor-fl" />
      <span className="login-rotor rotor-fr" />
      <span className="login-rotor rotor-rl" />
      <span className="login-rotor rotor-rr" />

      <svg viewBox="0 0 220 110" className="login-drone-frame-svg" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round">
          <line x1="38" y1="36" x2="94" y2="52" />
          <line x1="182" y1="36" x2="126" y2="52" />
          <line x1="38" y1="74" x2="94" y2="58" />
          <line x1="182" y1="74" x2="126" y2="58" />
          <line x1="97" y1="76" x2="90" y2="100" />
          <line x1="123" y1="76" x2="130" y2="100" />
          <line x1="82" y1="100" x2="98" y2="100" />
          <line x1="122" y1="100" x2="138" y2="100" />
        </g>
        <rect x="88" y="40" width="44" height="26" rx="9" fill="currentColor" opacity="0.92" />
        <rect x="98" y="67" width="24" height="17" rx="5" fill="currentColor" opacity="0.86" />
        <circle cx="38" cy="36" r="8" fill="currentColor" opacity="0.82" />
        <circle cx="182" cy="36" r="8" fill="currentColor" opacity="0.82" />
        <circle cx="38" cy="74" r="8" fill="currentColor" opacity="0.82" />
        <circle cx="182" cy="74" r="8" fill="currentColor" opacity="0.82" />
      </svg>

      <div className="login-spray-cloud">
        <span className="login-spray-core" />
        {SPRAY_PARTICLES.map((dot, particleIndex) => (
          <span
            key={particleIndex}
            className="login-spray-dot"
            style={{
              left: `${dot.left}%`,
              '--dot-duration': dot.duration,
              '--dot-delay': dot.delay,
              '--dot-size': `${dot.size}px`,
            }}
          />
        ))}
      </div>

    </div>
  )
}

export default function Login() {
  const { login, loading } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [senha, setSenha] = useState('')
  const [error, setError] = useState('')
  const [pilotEnabled, setPilotEnabled] = useState(false)
  const [pilotActive, setPilotActive] = useState(false)
  const sceneRef = useRef(null)
  const cardRef = useRef(null)
  const pilotDroneRef = useRef(null)
  const pilotAnimationRef = useRef(null)
  const pilotActiveRef = useRef(false)
  const pilotStateRef = useRef({ x: 0, y: 0, tilt: 0 })
  const pilotTargetRef = useRef({ x: 0, y: 0, tilt: 0 })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia('(pointer: fine)')
    const sync = () => setPilotEnabled(Boolean(mq.matches))
    sync()
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync)
      return () => mq.removeEventListener('change', sync)
    }
    mq.addListener(sync)
    return () => mq.removeListener(sync)
  }, [])

  useEffect(() => () => {
    if (pilotAnimationRef.current) {
      cancelAnimationFrame(pilotAnimationRef.current)
      pilotAnimationRef.current = null
    }
  }, [])

  useEffect(() => {
    pilotActiveRef.current = pilotActive
  }, [pilotActive])

  useEffect(() => {
    if (pilotEnabled) return
    pilotActiveRef.current = false
    setPilotActive(false)
    if (pilotAnimationRef.current) {
      cancelAnimationFrame(pilotAnimationRef.current)
      pilotAnimationRef.current = null
    }
  }, [pilotEnabled])

  const animatePilotDrone = () => {
    const el = pilotDroneRef.current
    if (!el) {
      pilotAnimationRef.current = null
      return
    }
    const state = pilotStateRef.current
    const target = pilotTargetRef.current
    state.x += (target.x - state.x) * 0.24
    state.y += (target.y - state.y) * 0.24
    state.tilt += (target.tilt - state.tilt) * 0.24

    el.style.setProperty('--pilot-x', `${state.x.toFixed(2)}px`)
    el.style.setProperty('--pilot-y', `${state.y.toFixed(2)}px`)
    el.style.setProperty('--pilot-tilt', `${state.tilt.toFixed(2)}deg`)

    const stillMoving =
      Math.abs(target.x - state.x) > 0.5 ||
      Math.abs(target.y - state.y) > 0.5 ||
      Math.abs(target.tilt - state.tilt) > 0.15

    if (pilotActiveRef.current || stillMoving) {
      pilotAnimationRef.current = requestAnimationFrame(animatePilotDrone)
      return
    }
    pilotAnimationRef.current = null
  }

  const ensurePilotAnimation = () => {
    if (!pilotAnimationRef.current) {
      pilotAnimationRef.current = requestAnimationFrame(animatePilotDrone)
    }
  }

  const hidePilotDrone = () => {
    if (pilotActiveRef.current) {
      pilotActiveRef.current = false
      setPilotActive(false)
    }
  }

  const handleScenePointerMove = (event) => {
    if (!pilotEnabled || event.pointerType !== 'mouse') return
    const scene = sceneRef.current
    const card = cardRef.current
    if (!scene || !card) return

    const cardRect = card.getBoundingClientRect()
    const insideCard =
      event.clientX >= cardRect.left &&
      event.clientX <= cardRect.right &&
      event.clientY >= cardRect.top &&
      event.clientY <= cardRect.bottom

    if (insideCard) {
      hidePilotDrone()
      return
    }

    const sceneRect = scene.getBoundingClientRect()
    const x = clamp(event.clientX - sceneRect.left, 70, sceneRect.width - 70)
    const y = clamp(event.clientY - sceneRect.top, 52, sceneRect.height - 72)
    const previousX = pilotTargetRef.current.x || x
    const rawTilt = (x - previousX) * 0.26
    const tilt = clamp(rawTilt, -13, 13)
    pilotTargetRef.current = { x, y, tilt }

    if (!pilotActive) {
      pilotActiveRef.current = true
      setPilotActive(true)
      pilotStateRef.current = { x, y, tilt }
      const el = pilotDroneRef.current
      if (el) {
        el.style.setProperty('--pilot-x', `${x.toFixed(2)}px`)
        el.style.setProperty('--pilot-y', `${y.toFixed(2)}px`)
        el.style.setProperty('--pilot-tilt', `${tilt.toFixed(2)}deg`)
      }
    }
    ensurePilotAnimation()
  }

  const handleScenePointerLeave = () => {
    hidePilotDrone()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    const base = String(username || '').trim().toLowerCase()
    let resolvedUsername = base
    if (base && !base.includes('@')) {
      resolvedUsername = `${base}@dronepro.com.br`
    } else if (base.endsWith('@dronepro')) {
      resolvedUsername = `${base}.com.br`
    }
    const result = await login(resolvedUsername, senha)
    if (result.ok) {
      navigate('/')
    } else {
      setError(result.message)
    }
  }

  return (
    <div
      className="login-scene"
      ref={sceneRef}
      onPointerMove={handleScenePointerMove}
      onPointerLeave={handleScenePointerLeave}
    >
      <div className="login-bg-layer login-bg-vignette" />
      <div className="login-bg-layer login-bg-grid" />
      <div className="login-bg-layer login-bg-aurora" />
      <div className="login-bg-layer login-bg-spotlights" />
      <div className="login-bg-layer login-bg-noise" />
      <div className="login-ground-haze" />

      <div className="login-drone-field" aria-hidden="true">
        {DRONES.map((drone, index) => (
          <div
            key={`${drone.top}-${drone.path}-${index}`}
            className={`login-flying-drone ${drone.path} depth-${drone.depth}`}
            style={{
              top: drone.top,
              width: drone.size,
              height: Math.round(drone.size * 0.46),
              animationDuration: drone.duration,
              animationDelay: drone.delay,
            }}
          >
            <DroneSprite />
          </div>
        ))}

        {pilotEnabled && (
          <div
            ref={pilotDroneRef}
            className={`login-flying-drone is-pilot ${pilotActive ? 'is-active' : ''}`}
            style={{ width: 168, height: 78 }}
          >
            <DroneSprite />
          </div>
        )}
      </div>

      <div className="login-card" ref={cardRef}>
        <div className="login-header">
          <span className="login-mission-chip">Operação DJI em Tempo Real</span>
          <div className="login-image-wrap">
            <img className="login-real-drone" src={DRONE_IMAGE_URL} alt="Drone DJI em operação de pulverização" />
          </div>
          <h1 className="login-title">DronePro</h1>
          <p className="login-subtitle">Sistema de Gerenciamento de Garantias</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error-box">
              <span>⚠️</span> {error}
            </div>
          )}

          <div className="login-field">
            <label className="login-label">Nome de usuário</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="login-input"
            />
          </div>

          <div className="login-field">
            <label className="login-label">Senha</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              className="login-input"
            />
          </div>

          <button type="submit" disabled={loading} className="login-btn">
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
