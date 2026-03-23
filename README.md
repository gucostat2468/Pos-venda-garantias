# 🚁 DronePro – Sistema de Gerenciamento de Aprovações de Garantias

## Sobre o Sistema

Plataforma web para centralizar e formalizar o processo de aprovação de garantias de produtos DJI Agriculture comercializados pela DronePro Comércio.

**Versão:** 1.0.0 | **Data:** Março/2026

---

## Funcionalidades

- **Upload centralizado** de documentos por caso de garantia (PDF, imagens)
- **Compilação automática** de todos os documentos em um único dossiê PDF
- **Fluxo de aprovação em 2 etapas**: Gerente de Pós-venda → Diretor Comercial
- **Suporte a Garantia de Peças e Garantia de Baterias**
- **Controle de rebates** com status de apuração mensal
- **4 perfis de acesso**: Admin, Time Oficina, Gerente Pós-venda, Diretor Comercial

---

## Início Rápido

### Pré-requisitos
- Python 3.9+ (obrigatório)
- Node.js 18+ (para rebuild do frontend, já incluído pré-compilado)

### Windows
```
start.bat
```

### Linux / macOS
```bash
chmod +x start.sh
./start.sh
```

### Acesso
Após iniciar, acesse: **http://localhost:8000**

---

## Usuários Padrão (Criados Automaticamente)

| Nome de usuário | Senha | Papel |
|--------|-------|-------|
| admin@dronepro | admin123 | Administrador |
| operador@dronepro | operador123 | Time Oficina |
| gerente@dronepro | gerente123 | Gerente Pós-venda |
| diretor@dronepro | diretor123 | Diretor Comercial |

> ⚠️ **Altere as senhas padrão** após o primeiro acesso em produção!

---

## Fluxo de Trabalho

### Garantia de Peças
1. Time Oficina cria o caso e anexa:
   - Remessa (obrigatório)
   - Nota Fiscal de remessa para garantia (opcional)
   - Relatório técnico (opcional)
2. Sistema muda status automaticamente para **Aguardando Aprovação Pós-Venda**
3. Gerente de Pós-venda assina (aprova ou reprova)
4. Diretor Comercial assina (aprova ou reprova)
5. Sistema compila dossiê PDF e muda status para **Aguardando Impressão Oficina**
6. Time Oficina confirma impressão em 3 vias e o caso muda para **Finalizado**
7. Status de rebate vai para **Aguardando Apuração**

### Garantia de Baterias
1. Time Oficina cria o caso e anexa os documentos da etapa inicial (igual ao fluxo de peça)
2. Fluxo de aprovação em 2 etapas (igual à peça)
3. Após aprovação da diretoria: Time Oficina faz upload do **vídeo de descarte**
4. Sistema finaliza e compila o dossiê PDF

---

## Estrutura de Arquivos

```
garantias/
├── backend/              # FastAPI (Python)
│   ├── main.py           # Ponto de entrada
│   ├── models.py         # Modelos SQLAlchemy
│   ├── schemas.py        # Schemas Pydantic
│   ├── auth.py           # Autenticação JWT
│   ├── seed_data.py      # Dados iniciais
│   ├── database.py       # Configuração SQLite
│   ├── routers/          # Rotas da API
│   │   ├── auth.py
│   │   ├── casos.py
│   │   ├── clientes.py
│   │   └── usuarios.py
│   ├── utils/
│   │   └── pdf_compiler.py  # Compilação de PDF
│   ├── uploads/          # Documentos enviados (criado automaticamente)
│   ├── compiled/         # PDFs compilados (criado automaticamente)
│   ├── garantias.db      # Banco SQLite (criado automaticamente)
│   └── requirements.txt
│
├── frontend/             # React + Vite
│   ├── src/
│   │   ├── App.jsx       # Roteamento principal
│   │   ├── api.js        # Chamadas à API
│   │   ├── contexts/     # AuthContext
│   │   ├── pages/        # Telas do sistema
│   │   └── components/   # Componentes reutilizáveis
│   ├── dist/             # Build compilado (pronto para uso)
│   └── package.json
│
├── start.sh              # Script Linux/macOS
├── start.bat             # Script Windows
├── docker-compose.yml    # Configuração Docker
└── README.md
```

---

## API REST

Documentação interativa disponível em: **http://localhost:8000/docs**

### Endpoints Principais
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | /api/auth/login | Login |
| GET | /api/casos | Listar casos |
| POST | /api/casos | Criar caso |
| GET | /api/casos/{id} | Detalhe do caso |
| POST | /api/casos/{id}/documentos | Upload de documento |
| POST | /api/casos/{id}/assinar | Assinar/aprovar |
| GET | /api/casos/{id}/pdf | Baixar dossiê PDF |
| GET | /api/clientes | Listar clientes |
| GET | /api/usuarios | Listar usuários (admin) |

---

## Docker (Alternativo)

```bash
docker-compose up -d
```

---

## Base de Créditos (Planilhas XLSX)

As planilhas de crédito podem ser importadas para o sistema sem sobrescrever arquivos existentes.

### Importar ZIP de créditos

```bash
cd backend
python scripts/import_credito_zip.py --zip "c:\Users\Vitor\Documents\sistema-pós-venda\credito.zip"
```

### Regras de segurança de dados

- Não apaga arquivos existentes.
- Se houver conflito de nome com conteúdo diferente, mantém ambos.
- Gera auditoria em `backend/credito/manifest.json` (hash SHA-256, origem e data de importação).

### Acesso no sistema

- Tela web: **Créditos** (menu lateral)
- API de arquivos: `GET /api/credito/` e `GET /api/credito/{arquivo_path}/download`

### Sincronizar dados internos (planilha -> banco)

As planilhas são convertidas em extratos e lançamentos internos no SQLite.

```bash
cd backend
python -m scripts.sync_credito_db
```

APIs de dados:
- `GET /api/credito/extratos`
- `GET /api/credito/extratos/{id}`
- `GET /api/credito/extratos/{id}/lancamentos`
- `POST /api/credito/sync` (admin/operador)
- `POST /api/credito/reconciliar` (admin/operador)

Conciliação com casos:
- vínculo automático `extrato -> cliente` por similaridade de dealer
- rateio automático `lançamento -> caso` por competência mensal e tipo (peça/bateria)
- consulta por caso:
  - `GET /api/casos/{id}/credito-vinculos`
  - `GET /api/casos/{id}/credito-resumo`

---

## Tecnologias

- **Backend**: FastAPI, SQLAlchemy, SQLite, JWT, pypdf, Pillow, reportlab
- **Frontend**: React 18, Vite, React Router, Axios
- **Banco de Dados**: SQLite (sem servidor externo)
- **PDF**: Compilação automática de PDFs e imagens em dossiê único
