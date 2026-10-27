# Cadastros e módulos — status operacional

**Atualizado em:** 2026-10-27  
**Branch de referência:** `origin/main` (pós-merge PR #73)  
**URL de produção observada:** `https://maike-five.vercel.app`  
**SSOT de escopo:** `config/mapa-manejo-scope.json` · **Menu:** `src/lib/menuConfig.js` · **Rotas:** `src/pages.config.js` → `/NomeDaPagina`

Este documento responde: *o que abre no menu, de onde vêm os dados (PostgreSQL nativo vs Base44) e se está pronto para uso em produção*.

---

## Legenda

| Coluna | Significado |
|---|---|
| **Backend** | Onde o CRUD persiste hoje |
| **UI** | Chrome Base1 (`CadastroListaChrome`, grades, export CSV) vs legado parcial |
| **Produção** | **Sim** = tela roteável + dados funcionam no monólito Vercel com Supabase + provider Base44 quando aplicável; **Parcial** = depende de env/permissão/migração; **Não** = fora do escopo ou bloqueado |

**Tenant (`Cliente`):** não há página de cadastro. O tenant é criado via `npm run auth:bootstrap:local` (ou equivalente em produção). Login nativo usa só `login` + `senha` (D-PROD-33).

**Empresa vs Cliente:** a tela **Empresa** (`Empresa`) é cadastro operacional Base44 (`Empresa`), não o model Prisma `Cliente`.

**Áreas de pastagem:** não há item de menu `AreasPastagem` (domínio proibido no manifesto). Áreas são editadas em **Mapa Geral** e **Cadastro do Mapa**, com persistência nativa desde P4.2.

---

## Matriz — páginas do produto (16)

| Módulo | Rota (app) | Menu | Backend | UI | Produção | Notas |
|---|---|---|---|---|---|---|
| **Mapa Geral** | `/MapaGeral` | Mapa → Mapa Geral | **Misto** — setores/áreas/geografia nativos; lotes, tarefas, bebedouros, suplementação Base44 | Mapa (não é cadastro lista) | **Sim** | Superfície primária (D-PROD-05). Requer `VITE_GOOGLE_MAPS_API_KEY` no build. |
| **Cadastro do Mapa** | `/MapaCadastro` | Mapa → Cadastro do Mapa | **Misto** — `AreaPastagem`, pontos, linhas, ícones nativos; demais camadas Base44 | Formulários mapa | **Sim** | CRUD de polígonos/áreas via API `/areas-pastagem`. |
| **Lotes** | `/CadastroLotes` | Manejo → Lotes | **Base44** (`Lote`, movimentações, anexos) | Base1 parcial (chrome lista) | **Sim*** | *Depende do token Base44 e empresa selecionada (`localStorage`). |
| **Setores** | `/CadastroSetores` | Manejo → Setores | **Nativo** — `GET/POST/PATCH /setores` → Prisma `Setor` | Base1 parcial | **Sim** | Sem `DELETE` no backend (D-PROD-25). Sincronização de nomes para entidades Base44 via `syncEntityReferences`. |
| **Categorias de Manejo** | `/CategoriasManejo` | Manejo → Categorias de Manejo | **Base44** (`CategoriaManejo`) | Base1 parcial | **Sim*** | Ícones podem ler cache; entidade manejo na Base44. |
| **Bebedouros** | `/Bebedouros` | Manejo → Bebedouros | **Base44** (`Bebedouro`, histórico, sanidade) | Base1 grade | **Sim*** | |
| **Produtos** | `/Produtos` | Suporte do Mapa → Produtos | **Base44** (`Produto`, estoque) | Base1 parcial | **Sim*** | Sem backend Prisma `Produto` (P5+). |
| **Categorias de Produto** | `/Categorias` | Suporte → Categorias de Produto | **Base44** (`Categoria`) | Base1 parcial | **Sim*** | |
| **Marcas** | `/marcas` | Suporte → Marcas | **Nativo** — `GET/POST/PATCH/DELETE /marcas` → Prisma `Marca` (P4.4, D-PROD-43) | **Base1 modelo** (`pageLayout="base1-list"`) | **Sim** | `empresa_id`: empresa Base44 em `localStorage` ou fallback `cliente_id` do JWT (P4.6). |
| **Unidades de Medida** | `/UnidadesMedida` | Suporte → Unidades de Medida | **Base44** (`UnidadeMedida`) | Base1 grade | **Sim*** | |
| **Locais de Estoque** | `/LocaisEstoque` | Suporte → Locais de Estoque | **Base44** (`LocalEstoque`) | Base1 grade | **Sim*** | |
| **Tipos de Tarefa** | `/TiposTarefa` | Suporte → Tipos de Tarefa | **Base44** (`TipoTarefa`, `GrupoAtividade`) | Base1 parcial | **Sim*** | |
| **Grupos de Atividades** | `/GruposAtividades` | Suporte → Grupos de Atividades | **Base44** (`GrupoAtividade`) | Base1 parcial | **Sim*** | |
| **Empresa** | `/Empresa` | Administração → Empresa | **Base44** (`Empresa`) | Base1 parcial | **Sim*** | Seleção de empresa ativa usa `localStorage` (`empresa_selecionada_id`). |
| **Usuários e Permissões** | `/Usuarios` | Administração → Usuários e Permissões | **Misto** — contas **nativas** `GET/POST/PATCH /usuarios` (P6.0); permissões de menu **Base44** (`Permissao`, `User`) | Base1 parcial | **Parcial** | CRUD de contas no PostgreSQL; matriz de permissões ainda no provider legado. |
| **Configurações Gerais** | `/ConfiguracoesGerais` | Administração → Configurações Gerais | **Nativo** — `ConfiguracaoIcone` via `/configuracao-icones` (P4.3) | Workspace + cards | **Parcial** | Exige perfil admin (regra em `sessionService` + permissões Base44). |

\* **Sim\*** = funcional desde que login nativo, `DATABASE_URL` no Vercel, `FRONTEND_ORIGINS` corretos e **sessão Base44** válida para leitura/escrita do provider (fluxo herdado P1).

---

## Matriz — capacidades nativas sem página dedicada

| Capacidade | API (monólito) | Prisma | Menu / consumidor | Produção |
|---|---|---|---|---|
| **Autenticação** | `POST /auth/login`, `GET /auth/contexto` | `Usuario`, `Cliente` | Login na abertura do app | **Sim** (ver checklist se `VITE_SKIP_NATIVE_LOGIN` ainda ativo) |
| **Health** | `GET /health` | ping DB | Ops / deploy | **Sim** |
| **Áreas de pastagem** | `/areas-pastagem` | `AreaPastagem` | Mapa Geral, Cadastro do Mapa | **Sim** |
| **Pontos de referência** | `/pontos-referencia` | `PontoReferencia` | Mapa / cadastro mapa | **Sim** |
| **Linhas geográficas** | `/linhas-geograficas` | `LinhaGeografica` | Mapa | **Sim** |
| **Ícones do mapa** | `/configuracao-icones` | `ConfiguracaoIcone` | Configurações Gerais, componentes do mapa | **Sim** |
| **Cliente (tenant)** | — (bootstrap CLI) | `Cliente` | Não exposto na UI | **N/A** |

Rewrites Vercel: `vercel.json` encaminha as rotas acima para `api/fastify.js` (D-PROD-36).

---

## Backend registrado (`backend/src/app.js`)

| Prefixo | Métodos | Model / módulo |
|---|---|---|
| `/health` | GET | diagnóstico |
| `/auth/login`, `/auth/contexto` | POST, GET | auth |
| `/setores` | GET, POST, PATCH `:id` | Setor |
| `/areas-pastagem` | GET, POST, PATCH `:id` | AreaPastagem |
| `/configuracao-icones` | GET, POST, PATCH `:id` | ConfiguracaoIcone |
| `/pontos-referencia` | GET, POST, PATCH, DELETE `:id` | PontoReferencia |
| `/linhas-geograficas` | GET, POST, PATCH `:id` | LinhaGeografica |
| `/usuarios` | GET, POST, PATCH `:id` | Usuario (sem DELETE) |
| `/marcas` | GET, POST, PATCH `:id`, DELETE `:id` | Marca (P4.4) |

Não existem rotas nativas para: Produto, Categoria, Empresa, Lote, Bebedouro, Permissao, etc. (roadmap P5–P6).

---

## Fronteira de APIs (`src/apis/`)

| Domínio | Módulo API | Provider |
|---|---|---|
| Setores | `setores/setoresApi.js` | `setorNativePort` |
| Áreas | `areas/areasApi.js` | `areaPastagemNativePort` |
| Geografia | `mapaGeografia/mapaGeografiaApi.js` | nativo |
| Usuários admin | `usuarios/usuariosApi.js` | `usuarioNativePort` |
| Sessão (permissões, `me` legado) | `session/sessionApi.js` | Base44 + patch nome via nativo |
| Marcas | `marcas/marcasApi.js` | `marcaNativePort` |
| Produtos, Empresa, estoque, tarefas, … | respectivos `*Api.js` | `base44Provider.js` |

---

## Roadmap (resumo)

| Missão | Impacto nos cadastros |
|---|---|
| **P4** (em execução) | Mapa core + **Marcas** nativos (setores, áreas, geografia, marcas); migration `20261027140000_p4_marcas_native` aplicada no Supabase MAIKE pós-PR #73 |
| **P5** | Manejo core nativo — lotes, bebedouros, categorias manejo (futuro) |
| **P6** | **P6.0** usuários nativos **entregue** no backend; permissões ainda Base44; demais itens P6 não iniciados |
| **P7** | Remoção final Base44 |
| **UX Base1** | Marcas piloto; demais cadastros **pausados** (D-PROD-41) até aceite H.5 |

Ver `docs/engineering/ROADMAP.md` e `docs/engineering/CURRENT-STATE.md`.

---

## Checklist rápido — produção

1. Login nativo com usuário bootstrapado no Supabase/PostgreSQL.  
2. `GET /health` → `banco: up`.  
3. `GET /marcas` sem JWT → **401** `TENANT_CONTEXT_REQUIRED` (rota nativa publicada).  
4. Monólito: `VITE_MAIKE_API_URL` vazio no build (same-origin).  
5. `FRONTEND_ORIGINS` inclui a URL exata do frontend.  
6. Cadastros Base44: empresa selecionada e provider respondendo.  
7. Mapa: chave Google Maps no build.

Detalhes: `docs/engineering/PRODUCAO-GO-LIVE-CHECKLIST.md`.
