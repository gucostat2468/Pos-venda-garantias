import React, { useState, useEffect } from 'react'
import { clientesAPI } from '../api'
import useMediaQuery from '../hooks/useMediaQuery'

export default function Clientes() {
  const isMobile = useMediaQuery('(max-width: 760px)')
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState({ razao_social: '', cnpj: '', email: '', telefone: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchClientes = async () => {
    setLoading(true)
    try {
      const res = await clientesAPI.listar(busca || undefined)
      setClientes(res.data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(fetchClientes, 300)
    return () => clearTimeout(timer)
  }, [busca])

  const openModal = (cliente = null) => {
    setEditando(cliente)
    setForm(cliente ? {
      razao_social: cliente.razao_social,
      cnpj: cliente.cnpj || '',
      email: cliente.email || '',
      telefone: cliente.telefone || '',
    } : { razao_social: '', cnpj: '', email: '', telefone: '' })
    setError('')
    setModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (editando) {
        await clientesAPI.atualizar(editando.id, form)
      } else {
        await clientesAPI.criar(form)
      }
      setModal(false)
      fetchClientes()
    } catch (err) {
      setError(err.response?.data?.detail || 'Erro ao salvar cliente')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (cliente) => {
    if (!window.confirm(`Excluir "${cliente.razao_social}"?`)) return
    try {
      await clientesAPI.deletar(cliente.id)
      fetchClientes()
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao excluir cliente')
    }
  }

  return (
    <div>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Clientes</h1>
          <p style={s.sub}>{clientes.length} cliente(s) cadastrado(s)</p>
        </div>
        <button onClick={() => openModal()} style={s.newBtn}>+ Novo Cliente</button>
      </div>

      <div style={s.searchBar}>
        <input
          type="text"
          value={busca}
          onChange={e => setBusca(e.target.value)}
          style={s.input}
        />
      </div>

      <div style={s.tableCard}>
        {loading ? (
          <div style={s.loading}>Carregando...</div>
        ) : clientes.length === 0 ? (
          <div style={s.empty}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🏢</div>
            <p>Nenhum cliente encontrado</p>
          </div>
        ) : (
          isMobile ? (
            <div style={s.mobileList}>
              {clientes.map((c) => (
                <article key={c.id} style={s.mobileCard}>
                  <div style={s.mobileTop}>
                    <div style={{ fontWeight: 700, color: 'var(--text)' }}>{c.razao_social}</div>
                    <span style={s.mobileId}>#{c.id}</span>
                  </div>
                  <div style={s.mobileLine}><strong>CNPJ:</strong> {c.cnpj || '—'}</div>
                  <div style={s.mobileLine}><strong>E-mail:</strong> {c.email || '—'}</div>
                  <div style={s.mobileLine}><strong>Telefone:</strong> {c.telefone || '—'}</div>
                  <div style={s.mobileActions}>
                    <button onClick={() => openModal(c)} style={s.editBtn}>Editar</button>
                    <button onClick={() => handleDelete(c)} style={s.delBtn}>🗑 Excluir</button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={s.thead}>
                <th style={s.th}>#</th>
                <th style={s.th}>Razão Social</th>
                <th style={s.th}>CNPJ</th>
                <th style={s.th}>E-mail</th>
                <th style={s.th}>Telefone</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c, i) => (
                <tr key={c.id} style={{ ...s.tr, background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={s.td}>{c.id}</td>
                  <td style={{ ...s.td, fontWeight: 600 }}>{c.razao_social}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12 }}>{c.cnpj || '—'}</td>
                  <td style={s.td}>{c.email || '—'}</td>
                  <td style={s.td}>{c.telefone || '—'}</td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => openModal(c)} style={s.editBtn}>✏️</button>
                      <button onClick={() => handleDelete(c)} style={s.delBtn}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )
        )}
      </div>

      {modal && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
              {editando ? 'Editar Cliente' : 'Novo Cliente'}
            </h3>
            {error && <div style={s.errorBox}>⚠️ {error}</div>}
            <form onSubmit={handleSave}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="Razão Social *" value={form.razao_social} onChange={v => setForm({ ...form, razao_social: v })} required />
                <Field label="CNPJ" value={form.cnpj} onChange={v => setForm({ ...form, cnpj: v })} />
                <Field label="E-mail" type="email" value={form.email} onChange={v => setForm({ ...form, email: v })} />
                <Field label="Telefone" value={form.telefone} onChange={v => setForm({ ...form, telefone: v })} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setModal(false)} style={s.cancelBtn}>Cancelar</button>
                <button type="submit" disabled={saving} style={s.saveBtn}>{saving ? 'Salvando...' : 'Salvar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, required, type = 'text' }) {
  return (
    <div>
      <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        style={{ width: '100%', padding: '9px 12px', borderRadius: 7, border: '1.5px solid var(--border)', fontSize: 13, outline: 'none' }}
      />
    </div>
  )
}

const s = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 24, fontWeight: 800, marginBottom: 2 },
  sub: { color: 'var(--text-muted)', fontSize: 13 },
  newBtn: { background: 'var(--primary)', color: '#fff', padding: '9px 18px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  searchBar: { background: '#fff', borderRadius: 10, padding: 14, boxShadow: 'var(--shadow)', border: '1px solid var(--border)', marginBottom: 16 },
  input: { padding: '8px 12px', borderRadius: 7, border: '1.5px solid var(--border)', fontSize: 13, width: '100%', outline: 'none' },
  tableCard: { background: '#fff', borderRadius: 10, boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden' },
  loading: { textAlign: 'center', padding: 60, color: 'var(--text-muted)' },
  empty: { textAlign: 'center', padding: 60, color: 'var(--text-muted)' },
  mobileList: { display: 'grid', gap: 10, padding: 10 },
  mobileCard: { border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'grid', gap: 8, background: '#fff' },
  mobileTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  mobileId: { fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' },
  mobileLine: { fontSize: 13, color: 'var(--text)', lineHeight: 1.35 },
  mobileActions: { display: 'flex', gap: 8, marginTop: 4 },
  thead: { background: '#f8fafc', borderBottom: '2px solid var(--border)' },
  th: { padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 14px', fontSize: 13, color: 'var(--text)' },
  editBtn: { padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer', fontSize: 13 },
  delBtn: { padding: '4px 8px', borderRadius: 6, border: '1px solid #fecaca', background: '#fff', cursor: 'pointer', fontSize: 13 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal: { background: '#fff', borderRadius: 12, padding: 28, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' },
  errorBox: { background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 },
  cancelBtn: { padding: '9px 18px', borderRadius: 7, border: '1.5px solid var(--border)', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  saveBtn: { padding: '9px 18px', borderRadius: 7, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
}
