import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { authAPI } from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  })
  const [loading, setLoading] = useState(false)

  const login = async (email, senha) => {
    setLoading(true)
    try {
      const { data } = await authAPI.login(email, senha)
      localStorage.setItem('token', data.access_token)
      localStorage.setItem('user', JSON.stringify(data.usuario))
      setUser(data.usuario)
      return { ok: true }
    } catch (err) {
      if (!err.response) {
        return {
          ok: false,
          message: 'Backend indisponível. Verifique se a API está rodando em http://localhost:8000.',
        }
      }
      return { ok: false, message: err.response?.data?.detail || 'Erro ao fazer login' }
    } finally {
      setLoading(false)
    }
  }

  const logout = useCallback(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }, [])

  const isAdmin = user?.papel === 'admin'
  const isGerente = user?.papel === 'gerente_pos_venda' || isAdmin
  const isDiretor = user?.papel === 'diretor_comercial' || isAdmin
  const isGestorEstoque = user?.papel === 'gestor_estoque' || isAdmin
  const isOperador = user?.papel === 'operador' || isAdmin

  const podeAssinar = (caso) => {
    if (!user || !caso) return false
    const statusEtapaEstoque = [
      'Aguardando Conferência Estoque',
      'Aguardando Impressão Oficina',
    ]
    if (user.papel === 'admin') {
      return [
        'Aguardando Aprovação Pós-Venda',
        'Aguardando Aprovação Diretoria',
        ...statusEtapaEstoque,
      ].includes(caso.status)
    }
    if (user.papel === 'gerente_pos_venda') {
      return caso.status === 'Aguardando Aprovação Pós-Venda'
    }
    if (user.papel === 'diretor_comercial') {
      return caso.status === 'Aguardando Aprovação Diretoria'
    }
    if (user.papel === 'gestor_estoque') {
      return statusEtapaEstoque.includes(caso.status)
    }
    return false
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isGerente, isDiretor, isGestorEstoque, isOperador, podeAssinar }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
