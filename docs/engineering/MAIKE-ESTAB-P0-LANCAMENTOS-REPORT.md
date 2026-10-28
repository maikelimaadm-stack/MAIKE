# MAIKE — ESTAB-P0-01 — Estabilização transacional dos lançamentos

Data: 2026-10-28. Branch: `cursor/maike-estab-p0-lancamentos-516d`. Base: `origin/main` @ `3963a825` (merge PR #105).

## Escopo entregue

- Comandos HTTP transacionais: saída de suplementação, transferência entre locais, lançamento de suplementação (evento + lotes).
- Idempotência persistida (`OperacaoIdempotente`) com `operation_id` por tenant.
- Numeração de movimentação exclusiva no backend (cliente não define número em create).
- `GET /movimentacoes-estoque?limit=` com `take` Prisma; `GET /estoque-lotes-nota/:id`.
- Tarefa mapa: histórico na mesma transação via `historico_*` no PATCH/POST.
- Portas offline P0 com `tenantScoped: true`.
- Fail-closed em consulta temporal truncada (`loteManejoService`, limite 200).

## Migration

- `20261028230000_operacao_idempotente` — tabela `OperacaoIdempotente`.

## Testes

- `backend/tests/estabP0LancamentosNativo.test.mjs` — PostgreSQL real.
- `listagemLimitNativo` inclui `/movimentacoes-estoque`.

## Pendências / próxima slice

- E2E browser autenticado em preview (PENDING).
- Paginação SQL cronológica completa por lote/empresa (>5000 movimentos).
- Fechamento de período anterior no mesmo comando de lançamento de cocho (se ainda multi-POST no formulário).
