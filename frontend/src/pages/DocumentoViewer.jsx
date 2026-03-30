import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { casosAPI } from '../api'
import { downloadBlob, extractFilenameFromHeaders, openBlobInTab } from '../utils/file'

export default function DocumentoViewer() {
  const [searchParams] = useSearchParams()
  const [statusMsg, setStatusMsg] = useState('Preparando abertura do documento...')
  const [errorMsg, setErrorMsg] = useState('')

  const caseId = useMemo(() => searchParams.get('caseId') || '', [searchParams])
  const docId = useMemo(() => searchParams.get('docId') || '', [searchParams])

  useEffect(() => {
    let cancelado = false

    const abrir = async () => {
      if (!caseId || !docId) {
        setErrorMsg('Parâmetros inválidos para abertura do documento.')
        return
      }

      setStatusMsg('Carregando documento...')
      setErrorMsg('')

      try {
        const resInline = await casosAPI.downloadDocumentoFile(caseId, docId, { disposition: 'inline' })
        if (cancelado) return
        const abriu = openBlobInTab(resInline.data, window)
        if (!abriu) {
          const fallback = `documento_${docId}`
          const filename = extractFilenameFromHeaders(resInline.headers, fallback)
          downloadBlob(resInline.data, filename)
          setStatusMsg('Janela bloqueada pelo navegador. Download iniciado.')
        }
      } catch {
        try {
          const resAttachment = await casosAPI.downloadDocumentoFile(caseId, docId, { disposition: 'attachment' })
          if (cancelado) return
          const abriu = openBlobInTab(resAttachment.data, window)
          if (!abriu) {
            const fallback = `documento_${docId}`
            const filename = extractFilenameFromHeaders(resAttachment.headers, fallback)
            downloadBlob(resAttachment.data, filename)
            setStatusMsg('Janela bloqueada pelo navegador. Download iniciado.')
          }
        } catch (err) {
          if (cancelado) return
          setErrorMsg(err.response?.data?.detail || 'Não foi possível abrir o documento.')
        }
      }
    }

    abrir()
    return () => {
      cancelado = true
    }
  }, [caseId, docId])

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>Abrindo documento</h1>
        <p style={s.text}>{errorMsg || statusMsg}</p>
        {errorMsg && (
          <button type="button" onClick={() => window.location.reload()} style={s.btn}>
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  )
}

const s = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    background: '#f8fafc',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    background: '#fff',
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    boxShadow: '0 8px 28px rgba(2, 6, 23, 0.08)',
    padding: 20,
  },
  title: {
    margin: 0,
    marginBottom: 8,
    fontSize: 20,
    color: '#0f172a',
  },
  text: {
    margin: 0,
    fontSize: 14,
    color: '#334155',
  },
  btn: {
    marginTop: 14,
    border: 'none',
    borderRadius: 8,
    padding: '10px 14px',
    background: '#0f766e',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },
}
