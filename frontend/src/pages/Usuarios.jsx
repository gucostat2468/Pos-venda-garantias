import React, { useState, useEffect } from 'react'
import { usuariosAPI } from '../api'
import { useAuth } from '../contexts/AuthContext'
import useMediaQuery from '../hooks/useMediaQuery'

const PAPEIS = [
  { value: 'operador', label: 'Time Oficina' },
  { value: 'gerente_pos_venda', label: 'Gerente Pós-venda' },
  { value: 'diretor_comercial', label: 'Diretor Comercial' },
  { value: 'admin', label: 'Administrador' },
]

const PAPEL_LABEL = {
  admin: 'Administrador',
  operador: 'Time Oficina',
  gerente_pos_venda: 'Gerente Pós-venda',
  diretor_comercial: 'Diretor Comercial',
}

const PAPEL_COLOR = {
  admin: { color: '#5b21b6', bg: '#ede9fe' },
  operador: { color: '#1e40af', bg: '#dbeafe' },
  gerente_pos_venda: { color: '#065f46', bg: '#d1fae5' },
  diretor_comercial: { color: '#92400e', bg: '#fef3c7' },
}

export default function Usuarios() {
  const isMobile = useMediaQuery('(max-width: 760px)')
  const { user: currentUser } = useAuth()
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState({ nome: '', email: '', senha: '', papel: 'operador' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [resetModal, setResetModal] = useState(null)
  const [novaSenha, setNovaSenha] = useState('')
  const [resetting, setResetting] = useState(false)

  const fetchUsuarios = async () => {
    setLoading(true)
    try {
      const res = await usuariosAPI.listar()
      setUsuarios(res.data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchUsuarios() }, [])

  const openModal = (usuario = null) => {
    setEditando(usuario)
    setForm(usuario ? {
      nome: usuario.nome, email: usuario.email,
      senha: '', papel: usuario.papel,
    } : { nome: '', email: '', senha: '', papel: 'operador' })
    setError('')
    setModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (editando) {
        const upd = { nome: form.nome, email: form.email, papel: form.papel }
        await usuariosAPI.atualizar(editando.id, upd)
      } else {
        if (form.senha.length < 6) { setError('Senha deve ter pelo menos 6 caracteres'); setSaving(false); return }
        await usuariosAPI.criar({ nome: form.nome, email: form.email, senha: form.senha, papel: form.papel })
      }
      setModal(false)
      fetchUsuarios()
    } catch (err) {
      setError(err.response?.data?.detail || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const handleDesativar = async (usuario) => {
    if (!window.confirm(`Desativar usuário "${usuario.nome}"?`)) return
    try {
      await usuariosAPI.desativar(usuario.id)
      fetchUsuarios()
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao desativar')
    }
  }

  const handleResetSenha = async () => {
    if (novaSenha.length < 6) { alert('Senha deve ter pelo menos 6 caracteres'); return }
    setResetting(true)
    try {
      await usuariosAPI.resetSenha(resetModal.id, novaSenha)
      alert('Senha redefinida com sucesso!')
      setResetModal(null)
      setNovaSenha('')
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao redefinir senha')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Usuários</h1>
          <p style={s.sub}>{usuarios.length} usuário(s) cadastrado(s)</p>
        </div>
        <button onClick={() => openModal()} style={s.newBtn}>+ Novo Usuário</button>
      </div>

      <div style={s.tableCard}>
        {loading ? (
          <div style={s.loading}>Carregando...</div>
        ) : (
          isMobile ? (
            <div style={s.mobileList}>
              {usuarios.map((u) => {
                const cfg = PAPEL_COLOR[u.papel] || { color: '#374151', bg: '#f3f4f6' }
                return (
                  <article key={u.id} style={s.mobileCard}>
                    <div style={s.mobileTop}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: '50%', background: cfg.bg,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: cfg.color, fontWeight: 700, fontSize: 14,
                        }}>
                          {u.nome.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700 }}>{u.nome}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email}</div>
                        </div>
                      </div>
                      <span style={{
                        display: 'inline-block', padding: '2px 10px', borderRadius: 20,
                        fontSize: 11, fontWeight: 600, background: cfg.bg, color: cfg.color,
                      }}>
                        {PAPEL_LABEL[u.papel] || u.papel}
                      </span>
                    </div>
                    <div style={s.mobileMeta}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 20,
                        fontSize: 11, fontWeight: 600,
                        background: u.ativo ? '#d1fae5' : '#fee2e2',
                        color: u.ativo ? '#065f46' : '#991b1b',
                      }}>
                        {u.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        Desde {u.criado_em ? new Date(u.criado_em).toLocaleDateString('pt-BR') : '—'}
                      </span>
                    </div>
                    <div style={s.mobileActions}>
                      <button onClick={() => openModal(u)} style={s.editBtn}>Editar</button>
                      <button onClick={() => { setResetModal(u); setNovaSenha('') }} style={s.editBtn}>Senha</button>
                      {u.id !== currentUser?.id && u.ativo && (
                        <button onClick={() => handleDesativar(u)} style={s.delBtn}>Desativar</button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={s.thead}>
                <th style={s.th}>Nome</th>
                <th style={s.th}>E-mail</th>
                <th style={s.th}>Papel</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Desde</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u, i) => {
                const cfg = PAPEL_COLOR[u.papel] || { color: '#374151', bg: '#f3f4f6' }
                return (
                  <tr key={u.id} style={{ ...s.tr, background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={s.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%', background: cfg.bg,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: cfg.color, fontWeight: 700, fontSize: 14, flexShrink: 0,
                        }}>
                          {u.nome.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{u.nome}</div>
                          {u.id === currentUser?.id && (
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Você</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={s.td}>{u.email}</td>
                    <td style={s.td}>
                      <span style={{
                        display: 'inline-block', padding: '2px 10px', borderRadius: 20,
                        fontSize: 11, fontWeight: 600, background: cfg.bg, color: cfg.color,
                      }}>
                        {PAPEL_LABEL[u.papel] || u.papel}
                      </span>
                    </td>
                    <td style={s.td}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 20,
                        fontSize: 11, fontWeight: 600,
                        background: u.ativo ? '#d1fae5' : '#fee2e2',
                        color: u.ativo ? '#065f46' : '#991b1b',
                      }}>
                        {u.ativo ? '● Ativo' : '● Inativo'}
                      </span>
                    </td>
                    <td style={s.td}>
                      {u.criado_em ? new Date(u.criado_em).toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => openModal(u)} style={s.editBtn}>✏️ Editar</button>
                        <button onClick={() => { setResetModal(u); setNovaSenha('') }} style={s.editBtn}>🔑</button>
                        {u.id !== currentUser?.id && u.ativo && (
                          <button onClick={() => handleDesativar(u)} style={s.delBtn}>🚫</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          )
        )}
      </div>

      {/* Modal Criar/Editar */}
      {modal && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
              {editando ? 'Editar Usuário' : 'Novo Usuário'}
            </h3>
            {error && <div style={s.errorBox}>⚠️ {error}</div>}
            <form onSubmit={handleSave}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={s.label}>Nome Completo *</label>
                  <input required style={s.input} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
                </div>
                <div>
                  <label style={s.label}>E-mail *</label>
                  <input type="email" required style={s.input} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
                {!editando && (
                  <div>
                    <label style={s.label}>Senha (mínimo 6 caracteres) *</label>
                    <input type="password" required style={s.input} value={form.senha} onChange={e => setForm({ ...form, senha: e.target.value })} />
                  </div>
                )}
                <div>
                  <label style={s.label}>Papel / Permissão *</label>
                  <select required style={{ ...s.input, cursor: 'pointer' }} value={form.papel} onChange={e => setForm({ ...form, papel: e.target.value })}>
                    {PAPEIS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setModal(false)} style={s.cancelBtn}>Cancelar</button>
                <button type="submit" disabled={saving} style={s.saveBtn}>{saving ? 'Salvando...' : 'Salvar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Reset Senha */}
      {resetModal && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Redefinir Senha</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>{resetModal.nome}</p>
            <div>
              <label style={s.label}>Nova Senha (mínimo 6 caracteres)</label>
              <input type="password" style={s.input} value={novaSenha} onChange={e => setNovaSenha(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => { setResetModal(null); setNovaSenha('') }} style={s.cancelBtn}>Cancelar</button>
              <button onClick={handleResetSenha} disabled={resetting} style={s.saveBtn}>
                {resetting ? 'Redefinindo...' : 'Redefinir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 24, fontWeight: 800, marginBottom: 2 },
  sub: { color: 'var(--text-muted)', fontSize: 13 },
  newBtn: { background: 'var(--primary)', color: '#fff', padding: '9px 18px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  tableCard: { background: '#fff', borderRadius: 10, boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden' },
  loading: { textAlign: 'center', padding: 60, color: 'var(--text-muted)' },
  mobileList: { display: 'grid', gap: 10, padding: 10 },
  mobileCard: { border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: '#fff', display: 'grid', gap: 8 },
  mobileTop: { display: 'grid', gap: 8 },
  mobileMeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  mobileActions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  thead: { background: '#f8fafc', borderBottom: '2px solid var(--border)' },
  th: { padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 16px', fontSize: 13, color: 'var(--text)' },
  editBtn: { padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500 },
  delBtn: { padding: '4px 8px', borderRadius: 6, border: '1px solid #fecaca', background: '#fff', cursor: 'pointer', fontSize: 12 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal: { background: '#fff', borderRadius: 12, padding: 28, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' },
  errorBox: { background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 },
  label: { display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6 },
  input: { width: '100%', padding: '9px 12px', borderRadius: 7, border: '1.5px solid var(--border)', fontSize: 13, outline: 'none' },
  cancelBtn: { padding: '9px 18px', borderRadius: 7, border: '1.5px solid var(--border)', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  saveBtn: { padding: '9px 18px', borderRadius: 7, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
}
