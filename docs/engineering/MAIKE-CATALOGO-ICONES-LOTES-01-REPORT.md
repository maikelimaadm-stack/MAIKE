# MAIKE-CATALOGO-ICONES-LOTES-01 — ícone oficial no cadastro de lotes (R2: sem painel, vínculo real)

**Missões:** `MAIKE-CATALOGO-GLOBAL-ICONES-LOTES-01` → corretiva `MAIKE-PR145-CATALOGO-SUPABASE-LOTES-R2`
**Data:** 29/10/2026 · **Base:** `main` `1344ffe2` (pós-#144) · **Branch:** `claude/catalogo-global-icones-lotes-01` · **PR:** #145 (DRAFT)
**Decisão:** D-PROD-69 · **Runbook:** `docs/engineering/MAIKE-CATALOGO-OPERACAO-SUPABASE.md` · **Merge:** exclusivo do proprietário.

## 1. Mudança de decisão (R2)

O proprietário já tem as imagens oficiais e **não quer painel de gerenciamento de ícones no MAIKE**, nem oculto por URL.
O catálogo é dado global do produto:

- metadados no Supabase PostgreSQL e bytes no Supabase Storage;
- mantido server-side pelo proprietário;
- os clientes só consomem o que está publicado.

A primeira versão desta PR (painel `/CatalogoGlobalMaike` e prévia com `categoriaVisualId={null}`) foi **revertida**.

## 2. Inventário antes → depois

| Peça | Antes (R1 da PR) | Depois (R2) |
|---|---|---|
| `src/pages/CatalogoGlobalMaike.jsx` | painel ~537 linhas | **removido** |
| `src/pages.config.js`, `config/mapa-manejo-scope.json` | página registrada | **revertidos** = `main` |
| `vercel.json` | 4 rewrites do painel | **regenerado** por `scripts/vercel/sync-vercel-json.mjs` = `main` |
| `GET /catalogo-global/admin/visao`, `obterVisaoAdmin`, `limitesUploadCatalogo` | adicionados | **revertidos** (os 3 arquivos = `main`) |
| Frontend `src/apis/catalogoGlobal/*`, `catalogoGlobalService` | leitura + escrita admin + upload | **só leitura**: tipos, categorias e ícones publicados |
| Rotas admin preexistentes (`/admin/tipos`, `/categorias`, `/assets`, `/icones`, publicar/desativar, regras-misto), `exigirOperadorProduto`, `Catalogo*`, CAS, auditoria, compensação de Storage, migrations | — | **preservadas** sem alteração |
| Vínculo CategoriaManejo → catálogo | inexistente (`null` fixo) | `CategoriaManejo.catalogo_categoria_visual_id` |
| `FormularioLote` | `<IconeOficialLotePreview categoriaVisualId={null} />` | id real derivado da categoria de manejo |
| Legado `ConfiguracaoIcone`, `GerenciadorIcones`, MapLibre, `MapaGeral` | intocados | intocados |

## 3. Vínculo real (D-PROD-69)

**Uma fonte de verdade:** `CategoriaManejo.catalogo_categoria_visual_id`. Não havia mecanismo global equivalente:
`categoria_oficial` é texto livre e o `Lote` só tem `categoria_manejo_id`.

- **Migration aditiva** `backend/prisma/migrations/20261029200000_categoria_manejo_vinculo_catalogo`:
  - coluna `VARCHAR(64)` nullable;
  - índice `(cliente_id, catalogo_categoria_visual_id)`, conforme `gate:indices`;
  - FK `ON DELETE RESTRICT` para `CatalogoCategoriaVisual.id`. O id é global (catálogo sem `cliente_id`, D-PROD-60), então
    a FK não cruza tenants.
  - SQL de reversão no cabeçalho.
  - `prisma migrate diff` (migrations → schema) = vazio.
- **Backend** (`categoriaManejoService.js` + `catalogoValidacao.exigirCategoriaVisualLoteVinculavel`):
  - aceita só categoria **ativa** do tipo **`lote`** **ativo**;
  - inexistente, de outro tipo ou inativa → 422 `CATALOGO_GLOBAL_INVALID`;
  - `SELECT … FOR SHARE` na mesma transação da gravação (corrida com desativação);
  - `null`/vazio remove o vínculo; sem o campo no corpo, o vínculo é mantido;
  - reenviar o mesmo vínculo já gravado não revalida, então um cadastro antigo segue editável;
  - tenant sempre de `auth_context`.

  Exposto pelo contrato nativo existente (`comoPublico` devolve o campo). Correção lateral: `CATEGORIA_MANEJO_NOT_FOUND`
  passou a ser 404 (antes caía em 500).
- **Frontend:**
  - `FormularioCategoriaManejo` ganhou o campo "Ícone oficial (catálogo MAIKE)" (`CategoriaOficialCatalogoSelect`). Ele lista
    só as categorias publicadas do tipo `lote` e não tem upload, cor ou edição de imagem. Um vínculo inativo continua visível
    em vez de ser apagado em silêncio.
  - `normalizarCategoriaManejo` envia `catalogo_categoria_visual_id`.
- **Lote:** o payload não muda. `FormularioLote` resolve `categoria_manejo_id` → `catalogo_categoria_visual_id` em memória e
  passa o id para `IconeOficialLotePreview`, ao criar, editar e duplicar. Os status são:
  - `sem_categoria`;
  - `mapeamento_pendente` (categoria sem vínculo; nem consulta o catálogo);
  - `carregando`;
  - `ok`;
  - `sem_icone_publicado`;
  - `erro` (aviso, não bloqueia salvar).

  Imagem quebrada → cor de fallback. Cache: 60 s.
- **Resolver** (`resolverIconeOficialDoLote`):
  - filtra pelo tipo `lote` e pelo `categoria_id` exato;
  - com vários publicados, **maior `revisao` vence; empate → menor `id`**, determinístico;
  - nunca usa nome, sexo, raça ou idade. MISTO fora do escopo.

## 4. Operação no Supabase sem UI

- Runbook `docs/engineering/MAIKE-CATALOGO-OPERACAO-SUPABASE.md`:
  - preflight de migrations, RLS e grants por ambiente;
  - bucket e publicação;
  - operador;
  - manifesto de exemplo **fictício**;
  - troca de imagem sem deploy, mantendo o id;
  - associação, validação em staging, backup, rollback e checklist;
  - proibição de mexer em produção sem aprovação separada.
- CLI `scripts/catalogo/importar-icones.mjs` (núcleo `importarIconesLib.mjs`):
  - **dry-run por padrão**; `--apply` exige `--confirmar=<host da API>`;
  - usa só a API admin existente, então herda validação, CAS, auditoria e compensação;
  - envia os bytes sem transformação;
  - é idempotente pelo sha256 da URL versionada;
  - lê as credenciais do ambiente e nunca as imprime.

## 5. Gates e testes (local, PostgreSQL 16)

| Gate / teste | Resultado |
|---|---|
| `git diff --check` | PASS |
| `npm run verify:all` (migrations da branch aplicadas do zero em `maike_test`) | ver PR / §8 |
| Backend `categoriaManejoVinculoCatalogo.test.mjs` | **10/10**: vínculo nulo, persistência e listagem, inexistente (sem gravar nem auditar), tipo errado, categoria ou tipo inativos, atualização (troca, preserva, reenvio do vínculo desativado, remoção), isolamento de tenant (404 e `cliente_id` do corpo ignorado), rollback por falha de auditoria, corrida com desativação (422 via `FOR SHARE`), FK RESTRICT |
| Backend `catalogoImportacaoIcones.test.mjs` | **3/3**: manifesto inválido (SVG, acima do limite, repetido, código, ausente) sem escrita; aplicar → publicado, reaplicar → nada, trocar imagem → **mesmo id** e URL nova, auditado; admin do tenant → 403 e nada gravado |
| Backend `catalogoGlobalNativo.test.mjs` CG-16..19 | CG-16 `/admin/visao` → **404**; CG-17 usuário comum e admin do tenant: publicar e alterar → 403, rascunho fora da leitura publicada, nada muda; CG-18 upload inválido não persiste; CG-19 desativar preserva id, asset e auditoria (via Prisma) |
| Smoke `tests/smoke/catalogoGlobalLote.test.jsx` | **13/13**: sem página, escopo ou rewrite do painel; API do frontend só leitura; resolver (tipo, categoria, precedência independente da ordem); Categoria de Manejo lista só publicadas `lote` e o id vai no payload; edição com catálogo fora do ar salva; prévia troca e limpa ao mudar de categoria, fallback de imagem; FormularioLote novo, editar, duplicar, sem vínculo e catálogo fora do ar salvando sem campo de ícone |

## 6. E2E local com ícone publicado

**Ambiente:**

- Chromium com Fastify + Vite;
- PostgreSQL `maike_ui_test` recriado do zero, com as migrations da branch;
- Storage falso local no formato da API do Supabase Storage, em `127.0.0.1`;
- tenant e operador sintéticos;
- imagem fixture PNG 8×8 gerada no teste (nenhum asset do proprietário).

Evidências em `docs/engineering/evidencias/catalogo-icones-lotes-01/`.

1. **CLI** (`cli-importacao.txt`):
   - validação local;
   - dry-run (plano, nada gravado);
   - `--apply` sem `--confirmar` → recusado;
   - admin do tenant → 403;
   - operador `--apply --confirmar=127.0.0.1` → tipo, categoria e ícone publicados;
   - reaplicar → "nada a fazer".
2. **UI** (`e2e-ui-resultado.txt`, **15/15 PASS**):
   - o admin do tenant edita a Categoria de Manejo; o select lista só "Bezerro (fixture E2E)"; não há input de arquivo;
     salvar e recarregar → vínculo persiste (captura 01);
   - lote novo: sem categoria → fallback; categoria sem vínculo → pendente; categoria vinculada → imagem servida pelo Storage
     (URL `v2/{sha16}-{uuid}.png`, carregada); trocar de categoria limpa a prévia; salvar (captura 02);
   - reabrir o lote salvo → ícone (04); duplicar → ícone (05);
   - 768, 390 e 412 px: prévia com ícone, sem rolagem horizontal (06-*);
   - `/CatalogoGlobalMaike` → 404 da SPA, sem UI administrativa (07).
3. **API negativa** (`provas-negativas-api.txt`):
   - admin do tenant em publicar, alterar ou upload → 403;
   - `/admin/visao` → 404;
   - sem JWT → 401;
   - vínculo com id inexistente → 422;
   - ícone inalterado.

Observação: a sobreposição de texto em "Sistema produtivo" no formulário de lote é **preexistente** e não foi alterada aqui.

## 7. Rollout — PENDENTE DE AUTORIZAÇÃO

Produção: **NOT_RUN** para migrations, Storage, seeds, uploads, operador, envs da Vercel e deploy. Nenhuma escrita remota
nesta missão.

O relato de 29/10 (SELECT somente leitura: 0/3 migrations do catálogo, 0 tabelas, bucket ausente) **não foi revalidado**
nesta R2. A migration `20261029200000` também está pendente.

**Ordem obrigatória do rollout:**

1. migrations;
2. backend;
3. bucket e envs;
4. operador;
5. importação com as imagens reais;
6. vínculos.

O backend **não pode** ir antes da migration: o salvamento de Categoria de Manejo passa a enviar a coluna nova.

## 8. Veredito

**READY_FOR_ARCHITECT_AUDIT** (código, testes e E2E locais verdes) · **PENDENTE DE ROLLOUT/ASSET** (imagens reais e ambiente
remoto dependem do proprietário). Não é READY_FOR_PRODUCTION.
