#!/bin/bash
# ─────────────────────────────────────────────────────────────
# DronePro – Sistema de Garantias
# Script de inicialização (sem Docker)
# ─────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

echo ""
echo "🚁 DronePro – Sistema de Gerenciamento de Garantias"
echo "═══════════════════════════════════════════════════"
echo ""

# ── Python Check ───────────────────────────────────────────
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 não encontrado. Instale em: https://python.org"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1-2)
echo "✓ Python $PYTHON_VERSION encontrado"

# ── Node.js Check ──────────────────────────────────────────
if ! command -v node &> /dev/null; then
    echo "⚠️  Node.js não encontrado. O frontend não será reconstruído."
    SKIP_BUILD=true
else
    NODE_VERSION=$(node --version)
    echo "✓ Node.js $NODE_VERSION encontrado"
    SKIP_BUILD=false
fi

# ── Instalar dependências Python ───────────────────────────
echo ""
echo "📦 Instalando dependências Python..."
cd "$BACKEND_DIR"
pip install -r requirements.txt -q

# ── Build do Frontend (se necessário) ─────────────────────
if [ "$SKIP_BUILD" = false ] && [ ! -d "$FRONTEND_DIR/dist" ]; then
    echo ""
    echo "🔨 Construindo o frontend React..."
    cd "$FRONTEND_DIR"
    npm install --silent
    npm run build --silent
    echo "✓ Frontend construído em frontend/dist/"
fi

# ── Iniciar o Backend ──────────────────────────────────────
echo ""
echo "🚀 Iniciando o servidor..."
echo ""
echo "   URL: http://localhost:8000"
echo "   Docs API: http://localhost:8000/docs"
echo ""
echo "   Pressione Ctrl+C para parar"
echo "─────────────────────────────"
echo ""

cd "$BACKEND_DIR"
python main.py
