# MAIKE-CATALOGO-GLOBAL-ICONES-LOTES-01 — painel interno do catálogo global + ícone no cadastro de lotes

**Data:** 29/10/2026 · **Base:** `main` `1344ffe2` (pós-#144) · **Branch:** `claude/catalogo-global-icones-lotes-01`
**PR:** DRAFT (link na própria PR) · **Merge:** exclusivo do proprietário.

## 1. Gate zero

PR #144 já **MERGED** (17:36 UTC). Nenhuma PR aberta no início. Worktree limpo; branch nova a partir de `origin/main`.

## 2. Inventário — fonte de verdade global vs legado

| Peça | Arquivo | Papel |
|---|---|---|
| Catálogo global (SSOT) | `backend/prisma/schema.prisma` (`Catalogo*`, `OperadorProdutoMaike`, `AuditoriaCatalogoGlobal`) | já existia — **não recriado** |
| Leitura publicada | `catalogoGlobalRoutes.js` `/catalogo-global/{manifest,tipos,categorias,icones,regras-misto}` | já existia |
| Escrita admin | `/catalogo-global/admin/*` sob `exigirOperadorProduto` (`backend/src/shared/auth/exigirOperadorProduto.js`) | já existia; CAS/409, auditoria atômica, compensação de Storage (R2/R3) preservados |
| Cliente frontend do catálogo | — | **não existia** |
| Legado por tenant | `ConfiguracaoIcone`, `src/components/configuracoes/GerenciadorIcones.jsx`, `src/services/configuracaoIconeService.js`, `mapaCacheService` (`icones`) | **intocado** — continua servindo o mapa |
| Lote | `Lote` (sem campo de ícone); `categoria_manejo_id` → `CategoriaManejo` | intocado |
| `CategoriaManejo.categoria_oficial` | texto livre: lista fixa em `src/pages/CategoriasManejo.jsx:86-101` + categorias do `ConfiguracaoIcone` do tenant | **não é identificador estável** |

### Matriz de lacunas

| Necessário | Já existe | Lacuna | Arquivo afetado | Risco |
|---|---|---|---|---|
| Painel listar tudo (rascunho/inativo) | só leitura publicada | leitura admin | `GET /catalogo-global/admin/visao` (novo) | baixo — só operador |
| Limites de upload na UI | validador backend | expor limites | `limitesUploadCatalogo()` | nenhum (mesma constante) |
| Upload/criar/trocar/publicar/desativar | endpoints admin | UI + cliente | `src/apis/catalogoGlobal/*`, `src/services/catalogoGlobalService.js`, `src/pages/CatalogoGlobalMaike.jsx` | médio — UI nova |
| Rota direta + refresh | — | registrar página | `config/mapa-manejo-scope.json`, `src/pages.config.js`, `vercel.json` (gerado) | baixo |
| Ícone do lote por vínculo explícito | — | **vínculo inexistente** | — | ver §4 |

## 3. Entregas reais

**Backend (aditivo):**
- `GET /catalogo-global/admin/visao` — `exigirOperadorProduto`; devolve `revisao`, `limites` (`mimes`, `max_bytes` do validador real), tipos, categorias, ícones em **qualquer estado** com assets e `public_url`, últimos 200 assets. Sem `cliente_id`, sem `storage_path`, sem chave. Também é o "sou operador?" da UI (403 `PRODUCT_OPERATOR_REQUIRED`).
- Nenhuma mutação nova; nenhum schema/migration novo.

**Frontend:**
- Porta/API/service: `src/apis/catalogoGlobal/{catalogoGlobalNativePort,catalogoGlobalApi,index}.js`, `src/services/catalogoGlobalService.js`.
- Painel `src/pages/CatalogoGlobalMaike.jsx` (rota `/CatalogoGlobalMaike`, **fora do menu**):
  - lista ícones (prévia principal/subícone, categoria, tipo, revisão, estado rascunho/publicado/inativo) com filtro por tipo;
  - cria tipo e categoria (códigos `^[a-z0-9_]+$`, sem lista hardcoded);
  - novo ícone: tipo + categoria + imagem principal e subícone opcional (prévia local antes do envio), cor de fallback; nasce rascunho;
  - trocar imagem (novo asset versionado, **mesmo id lógico** via PATCH), publicar, desativar (registro e asset preservados);
  - toda escrita envia `revisao_esperada`; fluxo de várias escritas relê a revisão entre passos; 409 → aviso "alterado por outro operador", recarrega, nada sobrescrito; sucesso só após resposta;
  - estados: carregando, vazio, erro com "Tentar novamente", acesso restrito (403), enviando.
  - **Imagens enviadas sem transformação** (FileReader → base64); validação real no backend (MIME real, whitelist PNG/JPEG/WebP/GIF, ≤ 512 KB; SVG recusado).

## 4. Cadastro de lotes — `LOTES_MAPPING_PENDING`

Não há vínculo explícito entre `CategoriaManejo` (tenant) e `CatalogoCategoriaVisual` (global). `categoria_oficial`
é texto livre; casar por nome/sexo exibiria ícone errado e confundiria a regra visual MISTO com `sexo = Misto`.
Nenhum campo foi adicionado a `Lote`.

Implementado:
- `resolverIconeOficialDoLote({ categoriaVisualId, icones })` — só resolve com **id explícito**; sem ele →
  `mapeamento_pendente`; id sem ícone publicado → `sem_icone_publicado`.
- `src/components/catalogoGlobal/IconeOficialLotePreview.jsx` no `FormularioLote` (fora do `DynamicFormRenderer`,
  para não alterar layouts salvos por usuário nem o payload): hoje mostra "vínculo da categoria com o catálogo MAIKE
  ainda não configurado", **não consulta o catálogo** sem vínculo, nunca bloqueia o cadastro. Payload do lote inalterado.

Próximo slice proposto (decisão de domínio do proprietário): coluna opcional
`CategoriaManejo.catalogo_categoria_visual_id` (nullable, migration aditiva), escolhida no formulário de Categoria de
Manejo a partir das categorias publicadas do tipo `lote`; lotes legados continuam sem vínculo (fallback). O resolver
e a prévia já aceitam o id.

**MapLibre / mapa:** nenhuma alteração. O mapa continua no `ConfiguracaoIcone` legado; migração para o catálogo
global é slice separado.

## 5. Gates e evidências

| Gate | Resultado |
|---|---|
| `git diff --check` | PASS |
| `npm run verify:all` (PostgreSQL 16 local) | PASS — gates 617/617, backend 290/290, smoke 929/929 (77 arquivos), types 1337 ≤ 1746, lint 0 erros |
| Backend novos CG-16..19 | PASS — 401 sem JWT; 403 para `is_admin` sem operador; visão do operador com rascunho/limites/revisão sem `cliente_id`/`storage_path`; SVG, MIME divergente e > limite → 4xx sem persistir; desativar preserva id/asset/auditoria |
| Smoke `tests/smoke/catalogoGlobalPainel.test.jsx` | PASS 11/11 — 403, erro+retry, prévia/limites, 409 sem sucesso + recarga, CAS no criar tipo, upload sem alteração + revisão relida, resolver, whitelist/limite local, prévia pendente sem consulta, fallback em erro |
| E2E real local (Chromium; Fastify + Vite + PG `maike_ui_test`; operador/tenant sintéticos) | PASS 13/13 — `docs/engineering/evidencias/catalogo-icones-lotes-01/smoke-e2e-resultado.txt` |
| Responsivo 1440 / 768 / 390 / 412 | PASS — sem rolagem horizontal; capturas na pasta de evidências |
| CI da PR | ver PR |

Observação: a sobreposição de texto no campo "Sistema produtivo" do formulário de lote (captura 05) é **preexistente**, não alterada aqui.

## 6. Rollout — `DEPLOYMENT_NOT_READY`

Leitura (SELECT) no Supabase `uuemcasqcdjucflulkne`, 29/10/2026: migrations do catálogo `20261028250000/250100/250200` **0/3**,
tabelas do catálogo **0**, bucket `maike-catalogo-global` **ausente**; migration `20261029100000` (SCALE-01) também não aplicada.
Variáveis `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`CATALOGO_STORAGE_BUCKET` na Vercel e operador produto: **NÃO VERIFICADO**
(acesso Vercel bloqueado nesta sessão). Em produção hoje o painel mostraria erro ao carregar; o cadastro de lotes não é afetado.

Procedimento (para aprovação do proprietário, não executado): (1) backup/PITR; (2) `npm run deploy:migrate` com
`MIGRATION_DATABASE_URL` direta; conferir 3/3 + 9 tabelas + RLS/REVOKE; (3) criar bucket conforme
`scripts/catalogo/bootstrap-storage-bucket.sql` (instruções) com escrita só servidor; (4) envs server-only na Vercel;
(5) `scripts/catalogo/bootstrap-operador-produto.mjs` para o usuário do proprietário; (6) smoke: `/admin/visao` 200 para
operador e 403 para tenant, upload de uma imagem real, publicar. Reversão: desativar ícones; tabelas ficam vazias/inertes.

## 7. Veredito

**READY_FOR_CODE_REVIEW** (código, testes e E2E local verdes) · **DEPLOYMENT_NOT_READY** (rollout remoto pendente) ·
**LOTES_MAPPING_PENDING** (vínculo categoria → catálogo exige decisão de domínio + migration).
