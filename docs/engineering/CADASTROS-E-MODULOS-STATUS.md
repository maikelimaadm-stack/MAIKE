# Cadastros e módulos — status operacional

**Atualizado em:** 2026-10-27  
**Branch de referência:** `cursor/base44-exit-final-516d` (P5.5, D-PROD-51)  
**URL de produção observada:** `https://maike-five.vercel.app`  
**SSOT de escopo:** `config/mapa-manejo-scope.json` · **Menu:** `src/lib/menuConfig.js` · **Rotas:** `src/pages.config.js` → `/NomeDaPagina`

Este documento responde: *o que abre no menu, de onde vêm os dados (PostgreSQL nativo) e se está pronto para uso em produção*.

---

## Legenda

| Coluna | Significado |
|---|---|
| **Backend** | Onde o CRUD persiste hoje |
| **UI** | Chrome Base1 (`CadastroListaChrome`, grades, export CSV) vs legado parcial |
| **Produção** | **Sim** = tela roteável + dados via API nativa no monólito Vercel + Supabase; **Parcial** = depende de env/permissão/migração; **Não** = fora do escopo ou bloqueado |

**Tenant (`Cliente`):** não há página de cadastro. O tenant é criado via `npm run auth:bootstrap:local` (ou equivalente em produção). Login nativo usa só `login` + `senha` (D-PROD-33).

**Empresa vs Cliente:** a tela **Empresa** (`Empresa`) é cadastro operacional no PostgreSQL (`Empresa`), não o model raiz `Cliente`.

**Áreas de pastagem:** não há item de menu `AreasPastagem` (domínio proibido no manifesto). Áreas são editadas em **Mapa Geral** e **Cadastro do Mapa**, com persistência nativa desde P4.2.

**Base44 (pós-P7):** dados de domínio **não** passam pelo SDK. Permanecem apenas schemas `base44/entities/*.jsonc` como especificação legada no manifesto; runtime `VITE_BASE44_*` removido (PR #85, D-PROD-52).

---

## Matriz — páginas do produto (16)

| Módulo | Rota (app) | Menu | Backend | UI | Produção | Notas |
|---|---|---|---|---|---|---|
| **Mapa Geral** | `/MapaGeral` | Mapa → Mapa Geral | **Nativo** — setores, áreas, geografia, lotes, tarefas, bebedouros, suplementação, movimentações | Mapa (não é cadastro lista) | **Sim** | Superfície primária (D-PROD-05). Requer `VITE_GOOGLE_MAPS_API_KEY` no build. |
| **Cadastro do Mapa** | `/MapaCadastro` | Mapa → Cadastro do Mapa | **Nativo** — geometria + camadas via APIs `/areas-pastagem`, movimentações mapa, etc. | Formulários mapa | **Sim** | |
| **Lotes** | `/CadastroLotes` | Manejo → Lotes | **Nativo** — `/lotes`, movimentações pecuária/mapa nativas (P5.1 + P5.5) | Base1 parcial | **Sim** | |
| **Setores** | `/CadastroSetores` | Manejo → Setores | **Nativo** — `/setores` | Base1 parcial | **Sim** | Sem `DELETE` no backend (D-PROD-25). Renomeação propaga via `/referencias/sincronizar`. |
| **Categorias de Manejo** | `/CategoriasManejo` | Manejo → Categorias de Manejo | **Nativo** — `/categorias-manejo` (P5.4) | Base1 parcial | **Sim** | |
| **Bebedouros** | `/Bebedouros` | Manejo → Bebedouros | **Nativo** — `/bebedouros` + histórico/sanidade/alertas (P5.4 + P5.5) | Base1 grade | **Sim** | |
| **Produtos** | `/Produtos` | Suporte do Mapa → Produtos | **Nativo** — `/produtos` (P5.2) | Base1 parcial | **Sim** | Movimentações de estoque nativas (P5.4). |
| **Categorias de Produto** | `/Categorias` | Suporte → Categorias de Produto | **Nativo** — `/categorias` (P5.2) | Base1 parcial | **Sim** | |
| **Marcas** | `/marcas` | Suporte → Marcas | **Nativo** — `/marcas` (P4.4) | **Base1 modelo** | **Sim** | `empresa_id` ligado a empresa nativa ou fallback JWT. |
| **Unidades de Medida** | `/UnidadesMedida` | Suporte → Unidades de Medida | **Nativo** — `/unidades-medida` (P5.x cadastro) | Base1 grade | **Sim** | |
| **Locais de Estoque** | `/LocaisEstoque` | Suporte → Locais de Estoque | **Nativo** — `/locais-estoque` (P5.2) | Base1 grade | **Sim** | |
| **Tipos de Tarefa** | `/TiposTarefa` | Suporte → Tipos de Tarefa | **Nativo** — `/tipos-tarefa`, `/grupos-atividades` | Base1 parcial | **Sim** | |
| **Grupos de Atividades** | `/GruposAtividades` | Suporte → Grupos de Atividades | **Nativo** — `/grupos-atividades` | Base1 parcial | **Sim** | |
| **Empresa** | `/Empresa` | Administração → Empresa | **Nativo** — `/empresas` (P5.4) | **Base1 completo** (MOTORBASE1-ROLLOUT-07, PR #123) | **Sim** | Lista tenant-global; seleção ativa em `localStorage`. |
| **Usuários e Permissões** | `/Usuarios` | Administração → Usuários e Permissões | **Nativo** — `/usuarios` + `/permissoes` (P6.0 + P5.4) | Base1 parcial | **Sim** | Matriz de menu no PostgreSQL. |
| **Configurações Gerais** | `/ConfiguracoesGerais` | Administração → Configurações Gerais | **Nativo** — `/configuracao-icones` (P4.3) | Workspace + cards | **Parcial** | Exige perfil admin (`sessionService` + permissões nativas). |

---

## Matriz — capacidades nativas sem página dedicada

| Capacidade | API (monólito) | Prisma | Menu / consumidor | Produção |
|---|---|---|---|---|
| **Autenticação** | `POST /auth/login`, `GET /auth/contexto` | `Usuario`, `Cliente` | Login na abertura do app | **Sim** |
| **Health** | `GET /health` | ping DB | Ops / deploy | **Sim** |
| **Upload de arquivos** | `POST /arquivos/upload` | data-URL persistida | Anexos, logos, ícones | **Sim** |
| **Sync de referências** | `POST /referencias/sincronizar` | vários models | Renomeações em cadastros | **Sim** |
| **Registros anexo** | `/registros-anexo` | `RegistroAnexo` | Diálogos de anexo | **Sim** |
| **Áreas de pastagem** | `/areas-pastagem` | `AreaPastagem` | Mapa Geral, Cadastro do Mapa | **Sim** |
| **Pontos de referência** | `/pontos-referencia` | `PontoReferencia` | Mapa / cadastro mapa | **Sim** |
| **Linhas geográficas** | `/linhas-geograficas` | `LinhaGeografica` | Mapa | **Sim** |
| **Ícones do mapa** | `/configuracao-icones` | `ConfiguracaoIcone` | Configurações Gerais | **Sim** |
| **Cliente (tenant)** | — (bootstrap CLI) | `Cliente` | Não exposto na UI | **N/A** |

Rewrites Vercel: `vercel.json` encaminha as rotas acima para `api/fastify.js` (D-PROD-36).

---

## Backend registrado (`backend/src/app.js`) — resumo P5.5

Além de auth, health, setores, geografia, usuários, marcas e cadastros P5.1–P5.4, o monólito expõe:

| Prefixo | Model / módulo |
|---|---|
| `/movimentacoes-mapa` | MovimentacaoMapa (JSON doc) |
| `/movimentacoes-pecuaria` | MovimentacaoPecuaria |
| `/suplementacao-eventos`, `/suplementacao-lotes` | SuplementacaoEvento, SuplementacaoLote |
| `/aplicacoes-medicamento`, `/eventos-sanitarios`, `/manejos-tecnico-rebanho` | documentos sanitários |
| `/bebedouros-historico`, `/bebedouros-sanidade`, `/bebedouros-alertas` | satélites bebedouro |
| `/registros-anexo` | RegistroAnexo |
| `/arquivos/upload` | upload nativo |
| `/referencias/sincronizar` | propagação de nomes |

Migration de produção: `20261028120000_p55_base44_exit_final`.

---

## Fronteira de APIs (`src/apis/`)

| Domínio | Provider |
|---|---|
| Cadastros, mapa, manejo, estoque, sessão | Portas `*NativePort` + `nativeRequest` |
| `base44Provider.js` | Registry **vazio** (P5.5) — só satisfaz gate de fronteira |

---

## Roadmap (resumo)

| Missão | Impacto |
|---|---|
| **P5.5** (esta branch) | Saída final Base44 — dados 100% PostgreSQL; SDK removido |
| **P6+** | Evoluções de produto (sem retorno ao provider Base44) |
| **P7** (opcional) | Arquivar schemas `base44/entities` no manifesto — runtime já sem SDK (PR #85) |
| **UX Base1** | Marcas piloto; demais cadastros pausados até aceite H.5 (D-PROD-41) |

Ver `docs/engineering/ROADMAP.md`, `BASE44-EXIT-PLAN.md` e `CURRENT-STATE.md`.

---

## Checklist rápido — produção

1. Login nativo com usuário bootstrapado no Supabase/PostgreSQL.  
2. `GET /health` → `banco: up`.  
3. Migrations aplicadas (`npm run deploy:migrate` / CI pre-deploy), incluindo P5.5.  
4. Monólito: `VITE_MAIKE_API_URL` vazio no build (same-origin).  
5. `FRONTEND_ORIGINS` inclui a URL exata do frontend.  
6. Mapa: chave Google Maps no build.

Detalhes: `docs/engineering/PRODUCAO-GO-LIVE-CHECKLIST.md`.
