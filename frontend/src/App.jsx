import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import CasosList from './pages/CasosList'
import CasoDetail from './pages/CasoDetail'
import NovoCaso from './pages/NovoCaso'
import Clientes from './pages/Clientes'
import Usuarios from './pages/Usuarios'
import CreditoArquivos from './pages/CreditoArquivos'
import ImpressaoFinalizacao from './pages/ImpressaoFinalizacao'
import DocumentoViewer from './pages/DocumentoViewer'

function PrivateRoute({ children, adminOnly = false }) {
  const { user, isAdmin } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />
  return <Layout>{children}</Layout>
}

function PublicRoute({ children }) {
  const { user } = useAuth()
  if (user) return <Navigate to="/" replace />
  return children
}

function AuthOnlyRoute({ children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
      <Route path="/casos" element={<PrivateRoute><CasosList /></PrivateRoute>} />
      <Route path="/casos/novo" element={<PrivateRoute><NovoCaso /></PrivateRoute>} />
      <Route path="/casos/:id" element={<PrivateRoute><CasoDetail /></PrivateRoute>} />
      <Route path="/documento-viewer" element={<AuthOnlyRoute><DocumentoViewer /></AuthOnlyRoute>} />
      <Route path="/impressao-finalizacao" element={<PrivateRoute><ImpressaoFinalizacao /></PrivateRoute>} />
      <Route path="/clientes" element={<PrivateRoute><Clientes /></PrivateRoute>} />
      <Route path="/credito" element={<PrivateRoute><CreditoArquivos /></PrivateRoute>} />
      <Route path="/usuarios" element={<PrivateRoute adminOnly><Usuarios /></PrivateRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
