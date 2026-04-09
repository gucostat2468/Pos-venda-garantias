import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

const encodePath = (path) => String(path).split('/').map((p) => encodeURIComponent(p)).join('/')

// Inject token automaticamente
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Handle 401 (token expirado)
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

// ─── Auth ────────────────────────────────────────────────────────────────────
export const authAPI = {
  login: (email, senha) => api.post('/auth/login', { email, senha }),
  me: () => api.get('/auth/me'),
  alterarSenha: (data) => api.post('/auth/alterar-senha', data),
}

// ─── Casos ───────────────────────────────────────────────────────────────────
export const casosAPI = {
  listar: (params) => api.get('/casos/', { params }),
  stats: () => api.get('/casos/stats'),
  criar: (data) => api.post('/casos/', data),
  obter: (id) => api.get(`/casos/${id}`),
  atualizar: (id, data) => api.put(`/casos/${id}`, data),
  deletar: (id) => api.delete(`/casos/${id}`),
  uploadDocumento: (id, formData) => api.post(`/casos/${id}/documentos`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  }),
  listarDocumentos: (id) => api.get(`/casos/${id}/documentos`),
  deletarDocumento: (caseId, docId) => api.delete(`/casos/${caseId}/documentos/${docId}`),
  downloadDocumentoFile: (caseId, docId, params) => api.get(`/casos/${caseId}/documentos/${docId}/download`, { responseType: 'blob', params }),
  assinarDocumento: (caseId, docId, payload) => {
    const body = typeof payload === 'string'
      ? { assinatura_data_url: payload }
      : (payload || {})
    return api.post(`/casos/${caseId}/documentos/${docId}/assinar`, body)
  },
  assinar: (id, data) => api.post(`/casos/${id}/assinar`, data),
  confirmarImpressao: (id) => api.post(`/casos/${id}/confirmar-impressao`),
  compilarPdf: (id) => api.post(`/casos/${id}/compilar-pdf`),
  downloadPdfFile: (id, params) => api.get(`/casos/${id}/pdf`, { responseType: 'blob', params }),
  listarCreditoVinculos: (id) => api.get(`/casos/${id}/credito-vinculos`),
  obterCreditoResumo: (id) => api.get(`/casos/${id}/credito-resumo`),
}

// ─── Clientes ─────────────────────────────────────────────────────────────────
export const clientesAPI = {
  listar: (busca) => api.get('/clientes/', { params: busca ? { busca } : undefined }),
  criar: (data) => api.post('/clientes/', data),
  obter: (id) => api.get(`/clientes/${id}`),
  atualizar: (id, data) => api.put(`/clientes/${id}`, data),
  deletar: (id) => api.delete(`/clientes/${id}`),
}

// ─── Usuários ────────────────────────────────────────────────────────────────
export const usuariosAPI = {
  listar: () => api.get('/usuarios/'),
  criar: (data) => api.post('/usuarios/', data),
  atualizar: (id, data) => api.put(`/usuarios/${id}`, data),
  desativar: (id) => api.delete(`/usuarios/${id}`),
  resetSenha: (id, nova_senha) => api.post(`/usuarios/${id}/reset-senha`, { nova_senha }),
  obterMinhaAssinatura: () => api.get('/usuarios/minha-assinatura'),
  salvarMinhaAssinatura: (assinatura_data_url) => api.post('/usuarios/minha-assinatura', { assinatura_data_url }),
  excluirMinhaAssinatura: () => api.delete('/usuarios/minha-assinatura'),
}

// ─── Crédito ────────────────────────────────────────────────────────────────
export const creditoAPI = {
  listarArquivos: () => api.get('/credito/'),
  listarExtratos: () => api.get('/credito/extratos'),
  obterExtrato: (id) => api.get(`/credito/extratos/${id}`),
  listarLancamentos: (id) => api.get(`/credito/extratos/${id}/lancamentos`),
  sincronizarDados: () => api.post('/credito/sync'),
  reconciliar: () => api.post('/credito/reconciliar'),
  listarVinculosCliente: () => api.get('/credito/cliente-vinculos'),
  listarVinculosCaso: (casoId) => api.get('/credito/caso-vinculos', { params: casoId ? { caso_id: casoId } : undefined }),
  downloadArquivoFile: (caminhoRelativo, params) => api.get(`/credito/${encodePath(caminhoRelativo)}/download`, { responseType: 'blob', params }),
}

// ─── Notificações ───────────────────────────────────────────────────────────
export const notificacoesAPI = {
  listar: (params) => api.get('/notificacoes/', { params }),
  resumo: () => api.get('/notificacoes/resumo'),
  marcarLida: (id) => api.post(`/notificacoes/${id}/marcar-lida`),
  marcarTodasLidas: () => api.post('/notificacoes/marcar-todas-lidas'),
}
