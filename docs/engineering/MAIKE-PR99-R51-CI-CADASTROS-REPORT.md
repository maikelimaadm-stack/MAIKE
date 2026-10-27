# MAIKE PR #99 — R5.1 CI + Cadastros E2E

**Data:** 2026-10-27  
**PR:** https://github.com/maikelimaadm-stack/MAIKE/pull/99 (DRAFT)  
**Branch:** `cursor/r5-categorias-integridade-516d`  
**HEAD inicial (auditoria):** `7df03cbc1874a656af6fedfc124b624801c3d932`  
**Base main (auditoria):** `1e78e9d75e19ec7d827cab100749bf8422316858`  
**Estado PR:** DRAFT — correções na mesma branch; merge manual pelo usuário.

## 1. Identidade e arquivos

Alterações desta missão (R5.1 hotfix):

| Área | Arquivos |
|------|----------|
| Transporte R4 | `config/nativeApiPath.js`, `backend/src/app.js`, `api/fastify.js` |
| Empresa | `backend/src/modules/empresas/empresaRoutes.js`, `src/services/empresaWritePayload.js`, `src/apis/empresa/empresaApi.js`, `src/components/empresa/FormularioEmpresa.jsx` |
| Lotes cadastro | `src/components/lotes/FormularioLote.jsx` |
| Categorias manejo | `src/components/categorias-manejo/FormularioCategoriaManejo.jsx`, `src/pages/CategoriasManejo.jsx`, `src/services/categoriaManejoService.js` |
| Testes | `backend/tests/foundation.test.mjs` (BE-02b verde), `p54Base44ExitNativo.test.mjs`, `loteNativo.test.mjs`, smoke `nativeApiPath`, `empresaBoundary`, `manejoServices` |

R5 Categorias Produto: **preservado** (sem remoção de testes CAT/R5).

## 2. Diagnóstico CI — BE-02b

**Antes:** `app.inject('/api/native/health')` → **404** porque `onRequest` alterava `request.raw.url` **depois** do roteamento Fastify.

**Depois:** `rewriteUrl: (req) => reescreverUrlApiNativa(req.url)` em `construirApp`, com fronteira exata `/api/native` (não `/api/nativefake`). Adaptador Vercel usa a mesma função (idempotente se o prefixo já foi removido).

**Evidência local:** `npm run test:backend` — suite `health` incl. BE-02b **200**; BE-01 `/health` **200**.

## 3. Matriz cadastros (menu SSOT)

| Tela | Endpoint | Reparo nesta missão |
|------|----------|---------------------|
| Empresas | `/empresas` | Allowlist Fastify + projeção payload; sync formulário ao trocar registro |
| Lotes (cadastro) | `/lotes` | Obrigatórios UI alinhados ao POST mínimo + área |
| Categorias produto | `/categorias` | R5 intacto — PATCH NOW só se bug novo (nenhum encontrado além do CI) |
| Categorias manejo | `/categorias-manejo` | GMD opcional; `onError` create/update |
| Demais cadastros menu | vários | **DEFERRED** — matriz completa fora do escopo deste hotfix |

## 4. Contrato de campos

**Empresa — graváveis:** `apelido`, `nome`, `tipo_pessoa`, documentos/endereço opcionais. **Recusados (400):** `id`, `cliente_id`, `created_date`, `updated_date`, quaisquer extras.

**Lote — UI mínimo:** `nome`, `quantidade_cabecas` (>0), `area_entrada_id`, `motivo_entrada`; motivo Ajuste/Outros exige texto específico; Compra **não** exige NF/GTA/valores no front.

**Categoria manejo — UI mínimo:** `nome`, `sigla`, `especie`, `sexo`, `raca`, `categoria_oficial`; GMDs e idades opcionais; decimais `1,25` / `0,0` suportados.

## 5. Testes executados

- `npm run verify:all` — **30/30 etapas PASS** (Postgres local `DATABASE_URL` de `.env`).
- Backend: BE-02b, BE-P54-01b (PATCH metadados → 400), BE-P54-01c (prefixo nativo 401), lote Inventário 150 cabeças.
- Smoke: payload empresa, nativeApiPath, normalização categoria manejo CM3/CM3c.
- **Browser autenticado / preview:** PENDING (sem credenciais de laboratório neste agente).

## 6. GitHub Actions

Push desta branch dispara `quality / verify:all`. URL de referência do job vermelho anterior:  
https://github.com/maikelimaadm-stack/MAIKE/actions/runs/40583067703/job/122467326005?pr=99  

Confirmar run verde no **HEAD final** após push (ver seção 1 commit SHA).

## 7. Riscos e veredito

| Risco | Mitigação |
|-------|-----------|
| Double-strip Vercel + Fastify | `semPrefixoApiNativa` idempotente |
| Regressão R5 categorias | Nenhum arquivo R5 de hierarquia alterado |
| Lotes movimentação/saldo | **Fora de escopo** — zero alteração em movimentação/ledger |

**Veredito: PASS (local)** — CI remoto pendente confirmação pós-push. **BLOCKED para merge** até usuário validar cadastros em preview e Actions verde.
