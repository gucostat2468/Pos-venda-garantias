@echo off
:: ─────────────────────────────────────────────────────────────
:: DronePro – Sistema de Garantias
:: Script de inicialização Windows
:: ─────────────────────────────────────────────────────────────

title DronePro - Sistema de Garantias

echo.
echo   🚁 DronePro - Sistema de Gerenciamento de Garantias
echo   ====================================================
echo.

:: Ir para o diretório do script
cd /d "%~dp0"

:: Verificar Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo   ERRO: Python nao encontrado.
    echo   Instale em: https://python.org
    pause
    exit /b 1
)

:: Instalar dependências Python
echo   Instalando dependencias Python...
cd backend
pip install -r requirements.txt -q

:: Verificar Node.js e construir frontend se necessário
node --version >nul 2>&1
if %errorlevel% equ 0 (
    if not exist "..\frontend\dist" (
        echo   Construindo frontend React...
        cd ..\frontend
        call npm install --silent
        call npm run build
        cd ..\backend
    )
) else (
    echo   Aviso: Node.js nao encontrado. Frontend nao sera reconstruido.
)

:: Iniciar servidor
echo.
echo   Iniciando servidor...
echo.
echo   URL:      http://localhost:8000
echo   API Docs: http://localhost:8000/docs
echo.
echo   Pressione Ctrl+C para parar
echo   -----------------------------------------
echo.

python main.py

pause
