# MAIKE-LEDGER-PECUARIO-L1 — relatório (L1 + R2 de correções da auditoria)

**Branch:** `claude/maike-ledger-pecuario-l1`, numa worktree física separada,
base `origin/main` = `1344ffe2`.\
**PR:** maikelimaadm-stack/MAIKE#146 (DRAFT).\
**Contrato:** [`MAIKE-ESTOQUE-PECUARIO-LEDGER-L1-CONTRATO.md`](./MAIKE-ESTOQUE-PECUARIO-LEDGER-L1-CONTRATO.md)\
**Paralelismo:**
- A PR #145 não foi tocada.
- A lista de arquivos dela é variável: 35 numa leitura inicial, 95 no head
  `9bad34ce`.
- A interseção com os 11 arquivos do L1 é recalculada contra o head atual da
  #145 antes de cada push; foi **vazia** em todas as verificações.

## R2 — auditoria arquitetural (CHANGES_REQUESTED) → correções

Diagnóstico BEFORE: probe sobre o código `9356bb12`, não versionado. As novas
suítes também falham no código antigo, porque dependem das exportações
corretivas.

| Bloqueio | BEFORE (medido) | Correção | AFTER (medido) |
|---|---|---|---|
| **P0** duas ENTRADAS concorrentes do mesmo lote (`operation_id` diferentes) | **10/10** rodadas gravaram DUAS entradas | `SELECT … FOR UPDATE` no `"Lote"` (tenant + empresa) **antes** da checagem de entrada ativa, na transação da idempotência; `lote_referencia_id` obrigatório; snapshot histórico validado | 10/10 rodadas: exatamente 1 entrada, a outra é recusada; 0 idempotência presa; projeção = soma dos fatos |
| **P0** reconciliação descartava a entrada de lote **Inativo** | `total_entradas = 0`; A esperado −1000 (lacuna artificial de 1000) | Entrada conta qualquer que seja o status; status com cara de anulação conta + quarentena; classes de origem (cadastro/nascimento/derivados) | A = 0, B = 1000, total 1000, 0 lacunas, `conciliada` |
| **P1** categoria da entrada pela categoria ATUAL | usou `cm:boi_novo` (atual) | Entrada usa `categoria_manejo_entrada_id`; posição usa a atual; transferência só infere do lote que nunca mudou, senão mapeamento explícito ou quarentena | entrada sob `cm:bezerro`, posição sob `cm:garrote`, movimento em quarentena, `bloqueada_para_backfill` |
| **P1** quantidade truncada | `"10.5"` contou como 10 | `inteiroPositivoEstrito` + quarentena | 0 entradas válidas; 4/4 entradas inválidas em quarentena |
| **P1** sem estado verificável | sem campo `estado` | `conciliada` / `reconciliacao_parcial` / `bloqueada_para_backfill`, geral e `por_empresa` | diferença zero com quarentena nunca sai `conciliada` |
| **P1** data operacional frouxa | aceitava `2026-10-29abc`, `2026-02-30`, `2026-02-29`, `" 2026-10-29"` | Regex na string inteira + reconstrução UTC dos componentes | os 16 casos inválidos são recusados; 2024-02-29 e 2000-02-29 aceitos |
| **P1** esquema arbitrário (DROP CASCADE) | aceitava `auth`, `storage`, `pg_catalog`, `information_schema`, `prisma`, arbitrário | Só `^ledger_l1_[0-9a-f]{12,32}$`; `gerarEsquemaDescartavel()` | 18 nomes negativos recusados (criar e DROP); a suíte prova que criou/removeu só o próprio esquema |

## O que é real × o que é pendente

| Item | Estado |
|---|---|
| Contrato puro + validação contra snapshot do lote | **Código escrito e testado** (unitário) |
| Serviço transacional (idempotência real, trava de Lote e de posições, rollback, retry) | **Código escrito e testado contra PostgreSQL 16 real**, em esquema descartável `ledger_l1_<hex>` |
| Tabelas do ledger | **Prova de conceito:** DDL em esquema descartável. **Não** existe migration nem model Prisma. |
| Reconciliação read-only | **Código escrito e testado** (fixtures sintéticas: Inativo total, caso real 150/250/50, mudança de categoria, texto/mapeamento, quantidades inválidas, anulação/nascimento/derivados, duplicata) |
| Models Prisma + migration, rota, grants/RLS, backfill, mapa lendo a posição | **PENDING L2** (5 `test.todo`), **não automático**: exige aprovação manual de cada etapa (contrato §5) |

**Não está pronto para produção nem para usuários:** não há API, migration nem
integração de frontend.

## Testes

| Arquivo / comando | Resultado |
|---|---|
| `estoquePecuarioLedgerTransacional.test.mjs` (PostgreSQL 16 real) | 27/27 PASS em 5 execuções seguidas (7,6–8,1 s cada) |
| `estoquePecuarioLedgerContrato.test.mjs` | 24 PASS + 5 `todo` (PENDING L2, não contados como PASS) |
| `npm run verify:all` | PASS, 29/29 etapas, 405 s. `test:backend`: 342 testes, 337 pass, 0 fail, 5 todo (inclui `prisma validate`). `test:smoke`: 918/918. Typecheck backend, gate:types, lint, tenancy e build PASS. |

## Riscos remanescentes

- A garantia de "uma entrada ativa por lote" é procedural (trava + checagem),
  não declarativa. No L2 avaliar coluna/índice que a torne constraint.
- A trava `FOR UPDATE` no `"Lote"` legado bloqueia por milissegundos um update
  concorrente do mesmo lote durante a ENTRADA do ledger. É aceitável, porque o
  ledger fica desligado para usuários até o L2.
- Nascimento, reversão e mudança de categoria não têm evento no L1: a
  reconciliação bloqueia o backfill enquanto existirem.
- Dados reais nunca foram lidos. Os resultados são de fixtures que reproduzem
  o padrão relatado.

## Próximos passos L2 (após merge da #145; nada automático)

1. Rebase supervisionado.
2. Models/migration Prisma com FKs tenant-aware.
3. Grants/RLS.
4. API autenticada + `errorCodes.js`.
5. E2E real.
6. Export/backup.
7. Reconciliação com dump autorizado.
8. **Aprovação manual** de backfill/cutover.
9. Escrita sombra atômica; ledger desligado até os gates de paridade e
   rollback.
10. Correção de self-target (§8 do contrato).
11. Registrar em `DECISIONS.md` / `CURRENT-STATE.md` no rebase.
