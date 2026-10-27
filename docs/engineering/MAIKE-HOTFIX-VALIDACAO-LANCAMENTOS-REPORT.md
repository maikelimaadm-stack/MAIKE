# MAIKE — Hotfix validação de lançamentos (pós-PR #103)

Data: 2026-10-27. Branch: `cursor/hotfix-validacao-lancamentos-pos103-ed48`. Base: `origin/main` @ merge PR #103 (`ee4b7d3d`).

## Sintoma

Toast genérico **「Dados inválidos para a operação.」** ao tentar lançar registros; auditoria estática apontou GET com `?limit=` rejeitado pelo schema Fastify (`additionalProperties: false`, `removeAdditional: false`).

## Causa raiz comprovada

Ports frontend (`*NativePort.js`, `lotesApi.js`) enviam `?limit=N` em oito listagens JSON. Rotas backend só declaravam `empresa_id`. AJV respondia `REQUEST_VALIDATION_FAILED` → frontend traduzia para `API_INVALID_ARGUMENT` sem campo. Fluxos como `validarOrdemTemporalLote` (`filterMovimentacoes` com `limit:200`) falhavam **antes** do POST.

## Correções

1. **Contrato GET `limit`**: `backend/src/shared/http/listQueryLimit.js` — `limit` integer 1…5000; oito rotas/repositórios aplicam `take` no Prisma (ordenacao `createdAt desc`, `id desc` preservada).
2. **Diagnóstico seguro**: `validationDiagnostic.js` + `errorHandler` expõem `{ field, reason }` allowlisted; sem mensagem AJV, body ou valores.
3. **Frontend**: `nativeHttpClient` repassa `field`/`reason` em `details`; `getApiErrorMessage` usa `validationUserMessage.js` para texto em português.
4. **Tarefas mapa**: falha em `registrarHistorico` após `criarTarefa` → `MAPA_PARTIAL_OPERATION`, invalida cache, evita retry duplicado.

## RED → GREEN (backend PostgreSQL)

| Operação | Antes (audit) | Depois |
| --- | --- | --- |
| GET `/movimentacoes-mapa?limit=200` | 400 esperado | 200 |
| GET irmãos (8 endpoints) + `limit` | 400 esperado | 200 |
| GET `/api/native/movimentacoes-mapa?limit=200` | 400 esperado | 200 |
| GET `?foo=1` | 400 | 400 + `field=foo`, `reason=unknown_field` |
| GET `?limit=99999` | — | 400 + `field=limit`, `reason=range` |
| POST `/lancamentos-tarefa` sem `titulo` | 400 opaco | 400 + `field=titulo`, `reason=required` |

Testes: `backend/tests/listagemLimitNativo.test.mjs`, `backend/tests/validationDiagnosticNativo.test.mjs`.

## Gates / CI

Executar localmente: `npm run verify:all` (HEAD da branch). CI remoto: link na PR DRAFT.

## Riscos / deferidos

- **Validação temporal com `limit=200`**: não garante varredura exaustiva da cronologia; limite continua sendo janela — evolução futura exige query dirigida server-side (fora deste hotfix).
- **Browser E2E LAB**: PENDING — sem credenciais/sessão autorizada neste ambiente.
- **Outros GET** (ex. `aplicacoes-medicamento`) ainda podem enviar `limit` sem schema; não estavam na matriz da auditoria.

## Arquivos principais

- Backend: `listQueryLimit.js`, oito `*Routes.js` / `*Repository.js`, `errorHandler.js`, `validationDiagnostic.js`
- Frontend: `nativeHttpClient.js`, `ApiError.js`, `validationUserMessage.js`, `TarefasMapaPanel.jsx`
