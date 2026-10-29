# MAIKE-LEDGER-PECUARIO-L1-PARALELO — relatório

**Branch:** `claude/maike-ledger-pecuario-l1`, numa worktree física separada
(`git worktree add … origin/main`), base `origin/main` = `1344ffe2`.\
**Contrato:** [`MAIKE-ESTOQUE-PECUARIO-LEDGER-L1-CONTRATO.md`](./MAIKE-ESTOQUE-PECUARIO-LEDGER-L1-CONTRATO.md)\
**Paralelismo:** PR #145 (`claude/catalogo-global-icones-lotes-01`) não foi
tocada. Os 35 arquivos dela foram comparados com os 10 do L1 duas vezes (antes
do código e antes do commit, com a #145 já em `9bad34ce`); a interseção ficou
vazia nas duas.

## O que é real × o que é pendente

| Item | Estado |
|---|---|
| Contrato puro (eventos, partidas, normalização, validação, erros) | **Código escrito e testado** (unitário) |
| Serviço transacional (idempotência real, trava `FOR UPDATE`, rollback, retry) | **Código escrito e testado contra PostgreSQL 16 real**, em esquema descartável |
| Tabelas do ledger | **Prova de conceito:** DDL em esquema descartável criado e destruído pelo teste. **Não** existe migration nem model Prisma. |
| Reconciliação read-only do legado | **Código escrito e testado** (fixture sintética do caso 150/250/50) |
| Models Prisma + migration aditiva | **PENDING L2** (depende do merge da #145 em `schema.prisma`) |
| Rota HTTP + códigos no mapa global de erros | **PENDING L2** (`app.js` / `errorCodes.js` compartilhados) |
| Grants/RLS backend-only | **PENDING L2** |
| Backfill do legado | **PENDING L2** (após revisão manual da quarentena) |
| Mapa/cadastro lendo a posição | **PENDING L2** (sem mudança visual) |

**Não está pronto para usuários:** não há API, migration nem integração de
frontend.

## Testes

| Arquivo | Resultado |
|---|---|
| `estoquePecuarioLedgerTransacional.test.mjs` (PostgreSQL real) | 18/18 PASS, estável em 5 execuções seguidas |
| `estoquePecuarioLedgerContrato.test.mjs` | 14 PASS + 5 `todo` (PENDING L2, não contados como PASS) |
| `npm run verify:all` | PASS, 29/29 etapas, 381 s. `test:backend`: 323 testes, 318 pass, 0 fail, 5 todo. `test:smoke`: 918/918. Typecheck backend, lint, tenancy e build PASS. |

**Cenários cobertos contra o banco:**
- 1000 em A → 400/350/250 → B→C, com total constante e a entrada histórica
  intacta;
- `Lote` não reescrito (`updatedAt` igual);
- mistura de entradas sem proveniência;
- origem = destino recusada;
- saldo insuficiente sem gravação parcial;
- categoria distinta e `SEM_CATEGORIA`;
- tenant e empresa cruzados recusados;
- destino inativo recusado;
- falha simulada após o 1º débito: rollback total, sem idempotência presa;
- append-only no banco;
- `public` recusado;
- replay, conflito e mesma chave em paralelo;
- 2 saídas concorrentes pelo mesmo saldo (10 rodadas) e A↔B sem deadlock;
- estorno (duplicado, de estorno, sem motivo, de outro tenant, exigindo
  saldo);
- uma entrada ativa por lote.

## Dados existentes (150/250/50)

- **Nada foi lido nem escrito no Supabase remoto.** A reconciliação roda sobre
  dumps locais.
- **Caso reproduzido em fixture:**
  - Lote 1: lacuna de −15 em X e movimento de 15 para a própria área marcado
    como `origem_igual_destino`.
  - Lote 2: P = 0, Q = 50, R = 200, sem lacuna.
  - Lote 3 ("MOVIMENTAÇÃO"): listado como gerado e não somado como compra.
- **Estratégia:**
  1. Rodar a reconciliação sobre um dump.
  2. Revisar a quarentena e as suspeitas manualmente.
  3. No L2, fazer o backfill com `operation_id` determinístico (reexecutar =
     replay), primeiro em modo sombra.

## Plano L2 (após merge da #145)

1. Rebase do L1 no novo `main`.
2. Models Prisma + migration aditiva (§5 do contrato).
3. Grants/RLS.
4. Rotas + códigos no `errorCodes.js`.
5. Trocar a DDL de prova de conceito pelos models (o teste passa a usar o
   schema real).
6. Aplicar a correção de self-target (§8).
7. Escrita sombra + comparação.
8. Mapa lendo a posição.
9. Registrar a decisão em `DECISIONS.md` e atualizar `CURRENT-STATE.md` no
   rebase (os dois ficaram de fora do L1 por serem compartilhados).
