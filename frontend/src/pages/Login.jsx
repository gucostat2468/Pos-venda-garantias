import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const DRONE_IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/0/09/DJI_Agras_T50_demonstrating_sprayers_in_flight.jpg'

const DRONES = [
  { top: '14%', left: '-12%', size: 54, duration: '18s', delay: '-3s' },
  { top: '28%', left: '-18%', size: 48, duration: '24s', delay: '-10s' },
  { top: '42%', left: '-14%', size: 62, duration: '21s', delay: '-6s' },
  { top: '56%', left: '-10%', size: 50, duration: '19s', delay: '-12s' },
  { top: '68%', left: '-20%', size: 58, duration: '23s', delay: '-8s' },
]

export default function Login() {
  const { login, loading } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [senha, setSenha] = useState('')
  const [error, setError] = useState('')

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
    <div className="login-scene">
      <div className="login-bg-layer login-bg-noise" />
      <div className="login-bg-layer login-bg-glow-a" />
      <div className="login-bg-layer login-bg-glow-b" />

      <div className="login-drone-field" aria-hidden="true">
        {DRONES.map((drone, index) => (
          <div
            key={`${drone.top}-${drone.left}-${index}`}
            className="login-flying-drone"
            style={{
              top: drone.top,
              left: drone.left,
              width: drone.size,
              height: drone.size,
              animationDuration: drone.duration,
              animationDelay: drone.delay,
            }}
          >
            <svg viewBox="0 0 120 120" className="login-flying-drone-svg" aria-hidden="true">
              <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
                <line x1="28" y1="28" x2="50" y2="50" />
                <line x1="92" y1="28" x2="70" y2="50" />
                <line x1="28" y1="92" x2="50" y2="70" />
                <line x1="92" y1="92" x2="70" y2="70" />
                <circle cx="24" cy="24" r="10" />
                <circle cx="96" cy="24" r="10" />
                <circle cx="24" cy="96" r="10" />
                <circle cx="96" cy="96" r="10" />
                <rect x="40" y="42" width="40" height="34" rx="8" />
                <line x1="50" y1="78" x2="44" y2="98" />
                <line x1="70" y1="78" x2="76" y2="98" />
              </g>
            </svg>
            <span className="login-spray login-spray-a" />
            <span className="login-spray login-spray-b" />
          </div>
        ))}
      </div>

      <div className="login-card">
        <div className="login-header">
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

        <div className="login-hint">
          <p>
            Usuários padrão: <strong>diretor@dronepro</strong> · <strong>gerente@dronepro</strong> · <strong>operador@dronepro</strong>
          </p>
          <p>
            Compatibilidade: também aceita <strong>@dronepro.com.br</strong>.
          </p>
        </div>
      </div>
    </div>
  )
}
