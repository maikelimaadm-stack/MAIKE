# MAIKE-R2A — Cancelamento e estorno seguro de movimentação (backend primeiro)

**Data:** 2026-10-31 · **Decisão:** D-PROD-95 · **Base:** `main` d2cba91 (merge da #161)
**PR:** maikelimaadm-stack/MAIKE#162 (DRAFT) · **Branch:** `claude/new-session-26kpxu`
- É a branch designada da sessão. Foi recriada a partir de `main` depois do merge da #161; nenhum commit novo foi empilhado sobre a #161.
- Sem migration. Sem escrita em produção. Sem ledger L1.

## 1. Inventário (consumidores reais das escritas operacionais)

| Rota | Consumidor legítimo no `src/` | Decisão |
|---|---|---|
| `PATCH /movimentacoes-mapa/:id` | só `movimentacaoReconciliation` (exclusão do histórico, já suspensa) | **fechada** |
| `DELETE /movimentacoes-mapa/:id` | `HistoricoMovimentacoes` (suspenso), **`HistoricoAbateCurral`** (ativo, P0), **`RenomearLoteForm.handleReverter`** (ativo, P0) | **fechada**; os dois P0 migraram |
| `PATCH`/`DELETE /movimentacoes-pecuaria/:id` | nenhum | **fechadas** |
| `PATCH /suplementacao-eventos/:id` | `fecharPeriodoSuplementacao` (`sobra_kg`, `dias_periodo`, `consumo_diario_grupo_kg`) e `reabrirPeriodo` (só no serviço legado suspenso) | allow-list |
| `PATCH /suplementacao-lotes/:id` | `fecharPeriodoSuplementacao` (7 métricas de consumo) | allow-list |
| `DELETE` suplementação | só `suplementacaoHistoricoService` (suspenso na R1.1) | **fechadas** |
| `PATCH /movimentacoes-estoque/:id` | `FormularioPonto` (renomeação de depósito: `local_origem`/`local_destino`) e o serviço suspenso | allow-list conferida |
| `DELETE /movimentacoes-estoque/:id` | só o serviço suspenso | **fechada** |

## 2. Matriz por endpoint

| Endpoint | Antes | Depois | Código | Autorização |
|---|---|---|---|---|
| `DELETE /movimentacoes-mapa/:id` | 204, apagava | 409, nada muda | `MOVIMENTO_CANCELAMENTO_OBRIGATORIO` | token; outro tenant 404 |
| `PATCH /movimentacoes-mapa/:id` | 200, reescrevia `dados` | 409 | idem | idem |
| `POST /movimentacoes-mapa` (+bulk) | aceitava qualquer campo | 400 se vier campo reservado | `CAMPO_RESERVADO_CANCELAMENTO` | token |
| `PATCH`/`DELETE /movimentacoes-pecuaria/:id` | 200/204 | 409 | `MOVIMENTO_CANCELAMENTO_OBRIGATORIO` | token |
| `PATCH /suplementacao-eventos/:id` | qualquer campo | só 3 métricas (número ou null); demais 409; reservado 400 | `REGISTRO_OPERACIONAL_IMUTAVEL` | token |
| `DELETE /suplementacao-eventos/:id` | 204 | 409 | `MOVIMENTO_CANCELAMENTO_OBRIGATORIO` | token |
| `PATCH /suplementacao-lotes/:id` | qualquer campo | só 7 métricas; vínculo e `empresa_id` diferente → 409 | `REGISTRO_OPERACIONAL_IMUTAVEL` | token |
| `DELETE /suplementacao-lotes/:id` | 204 | 409 | `MOVIMENTO_CANCELAMENTO_OBRIGATORIO` | token |
| `PATCH /movimentacoes-estoque/:id` | qualquer campo | só `local_origem`/`local_destino` iguais ao nome do `LocalEstoque` do movimento | 409 / 422 `NOME_LOCAL_DIVERGENTE` | token, mesmo tenant |
| `DELETE /movimentacoes-estoque/:id` | 204 | 409 | `MOVIMENTO_CANCELAMENTO_OBRIGATORIO` | token |
| **novo** `POST /movimentacoes-mapa/:id/cancelamento` | — | 200 / 409 estável | ver 4 | **admin ativo** (`exigirAdminTenant`) |
| **novo** `GET /movimentacoes-mapa/:id/elegibilidade-cancelamento` | — | 200 `{elegivel, codigo, motivo, efeitos, pode_cancelar}` | — | token; outro tenant 404 |
| UI `HistoricoAbateCurral` "Excluir" | `atualizarLote(+q)` + `DELETE` | removido → "Cancelar movimentação" (comando) | — | admin |
| UI `RenomearLoteForm` "Reverter para nome original" | `atualizarLote(nome)` + `DELETE` em laço | "Usar nome original" (renomeação nova) | — | — |

## 3. Matriz de tipos

| Tipo / subtipo | Status | Prova |
|---|---|---|
| Morte (lote_id, efeito no AuditLog) | **SUPORTADO_COM_PROVA** | 500 → 450 → 500; replay; concorrência; rollback; dependência; sem prova |
| Abate (idem; Inativo/0 volta Ativo) | **SUPORTADO_COM_PROVA** | 50 → 0 Inativo → 50 Ativo; replay 50, não 100; curral E2E |
| Transferência total no lugar (legado e novo) | **SUPORTADO_COM_PROVA** | área volta à origem; cabeças e entrada histórica intactas |
| Transferência parcial com lote novo (`parcial_novo_lote` + `lote_destino_id`) | **SUPORTADO_COM_PROVA** | 500 → 450+50 → 500+0; derivado Inativo, não apagado, `quantidade_entrada` 50 intacta |
| Transferência parcial unificada (`parcial_unificado`) | **SUPORTADO_COM_PROVA** | 500/100 → 450/150 → 500/100 |
| Transferência total unificada (`total_unificado`) | **SUPORTADO_COM_PROVA** (mesmo motor da parcial unificada, com a checagem extra de origem 0/Inativo) | ver o teste da parcial unificada; o caminho total tem guarda própria |
| Transferência parcial ou unificada **legada** (sem lote de destino gravado) | **BLOQUEADO_POR_AMBIGUIDADE** | `CANCELAMENTO_VINCULO_AMBIGUO`, nada muda (backend e E2E) |
| Movimento sem `lote_id` (vínculo só por nome) | **BLOQUEADO_POR_AMBIGUIDADE** | `CANCELAMENTO_VINCULO_AMBIGUO` |
| Movimento sem prova do efeito no AuditLog (falha no meio do fluxo legado) | **BLOQUEADO_POR_AMBIGUIDADE** | `CANCELAMENTO_EFEITO_NAO_COMPROVADO`: não devolve cabeças que nunca saíram |
| Nascimento | **ADIADO** | o lote pode ter sido criado pelo nascimento; subtrair exige contrato próprio |
| Pesagem, Mudança de Categoria, Junção, Renomear Lote, Entrada/Saída genéricas | **ADIADO** | sem snapshot suficiente → `CANCELAMENTO_TIPO_NAO_SUPORTADO` |

## 4. Contrato do comando

- **Entrada:** `{operation_id (8–128, [A-Za-z0-9_.:-]), motivo (3–500)}`, com `additionalProperties: false`. `cliente_id`, quantidade ou qualquer outro campo dá 400. Movimento, lotes, empresa (coluna do documento), áreas e quantidade são lidos do servidor.
- **Transação única:**
  1. `exigirAdminTenant` (papel relido do banco);
  2. `executarComIdempotencia` (cliente, operation_id, `cancelamento_movimentacao_mapa`; fingerprint `{movimentacao_id, motivo}`):
     - mesma chave e mesmo payload → replay (`replay: true`), sem segundo crédito;
     - mesma chave com outro motivo → 409 `IDEMPOTENCY_CONFLICT`;
  3. `SELECT … FOR UPDATE` no movimento e depois nos lotes, ordenados por id;
  4. elegibilidade, prova e dependências;
  5. updates dos lotes e do movimento, mais as auditorias.
  - Qualquer erro → rollback completo, inclusive da reserva idempotente. O retry com a mesma chave conclui (teste com trigger que falha).
- **Concorrência:**
  - chaves diferentes no mesmo original: a segunda espera o `FOR UPDATE` e lê `situacao: cancelado` → 409 `CANCELAMENTO_JA_REALIZADO`. Teste com 3 requisições paralelas: exatamente um 200;
  - mesma chave em paralelo: `ON CONFLICT DO NOTHING` + espera → replay.
- **Prova do efeito:**
  - existe `AuditLog` do lote, em ±15 min da criação do movimento, com delta exato (−q / +q), troca exata de área ou criação do derivado com q na área de destino;
  - auditorias geradas por cancelamento são excluídas da prova.
- **Dependências (conservadoras, no banco, sem teto):**
  - qualquer registro posterior (por `createdAt` ou data operacional) ligado aos lotes por id: mapa, pecuária, suplementação por lote, medicamento, sanidade, manejo técnico, tarefas;
  - `lote_destino_id` ou id do lote em `observacoes` (snapshots de junção);
  - nome só para registro legado sem id;
  - em transferência, qualquer movimento posterior nas áreas de origem ou destino;
  - cancelados não contam.
  - Consequência: cancela-se do mais recente para o mais antigo.
- **Efeito:**
  - delta nos lotes participantes; `quantidade_entrada`, `area_entrada_id` e `categoria_entrada` nunca mudam;
  - transferência conserva a soma de cabeças (checado);
  - derivado zerado fica Inativo, não é apagado.
- **Original:** `situacao: 'cancelado'`, `cancelamento: {em, por_usuario_id, por_login, motivo, operation_id, modo, efeitos}`. Data e tipo intactos. Recancelar → `CANCELAMENTO_JA_REALIZADO`.
- **Leitura:**
  - o histórico por área/lote (R1) mostra Ativo/Cancelado com motivo, ator e horário;
  - o cache de efeito atual (`mapaCacheService.movimentacoes`) e `filterMovimentacoes` (ordem temporal do lote) ignoram cancelados;
  - as listas de referência (`listTodasMovimentacoes`) os mantêm, então lote com histórico continua protegido.
- **Offline:** só leitura. O botão fica desabilitado sem conexão, não existe fila offline de cancelamento, e o histórico de cache não exibe cancelados (só o efeito atual).
- **Compatibilidade:**
  - frontend antigo que tentar `DELETE`/`PATCH` recebe 409 estável (nunca 500);
  - movimentos antigos são lidos como antes;
  - os campos novos de transferência (`modo_transferencia`, `lote_destino_id`) são aditivos.

## 5. Testes e evidências reais

| Comando | Resultado |
|---|---|
| `node --test backend/tests/movimentacaoCancelamentoR2A.test.mjs` (PostgreSQL 16 local) | **22/22**. P0 nas 5 rotas, com spoof, outro tenant (404), sem token (401), estoque com nome válido e inválido. P1: Morte, Abate, replay, conflito, recancelamento, comum 403, dependências (mapa e sanidade), efeito não comprovado, legado sem id, tipo sem suporte, transferências (no lugar, parcial nova, parcial unificada, legado ambíguo, saldo insuficiente), concorrência (3 paralelas, mesma chave), rollback por trigger + retry, cancelamento × PATCH de lote, dois tenants com o mesmo nome |
| `node --test …documentoJsonEmpresaContrato… …movimentacaoMapaNomesArea… …movimentacaoMapaHistoricoPaginado…` | 27/27 (testes da R1 ajustados ao PATCH fechado) |
| `vitest tests/smoke/cancelamentoMovimentacao.test.jsx` | **8/8**. Admin envia só `operation_id`+`motivo`; resultado desconhecido reenvia a **mesma** chave; recusa definitiva usa chave nova; não elegível não confirma; comum/offline/tipo sem suporte; curral sem Excluir; renomear seguro; varredura sem `DELETE`/`PATCH` de movimento fora da camada de API |
| `vitest` (smoke completo) | 98 arquivos, **1132** testes |
| E2E Chromium (Vite + backend local + `maike_demo` sintético; semente por HTTP no fluxo legado) | **44 PASS / 0 FAIL** em 1440, 768, 412 e 390 (11 cada): histórico com Ativo e ação; diálogo com efeito do servidor (450 → 500); cancelado com ator e motivo; **saldo 500 conferido na API**; legado bloqueado; curral sem Excluir e abate cancelado; **nenhum `DELETE`/`PATCH` operacional no navegador**; 2 POST de cancelamento; sem rolagem horizontal; sem erro de página |
| E2E usuário comum (1440) | PASS: lê o histórico e não vê "Cancelar movimentação" |
| E2E regressão da R1.1 (1440) | 15/15: área vazia, curral, cocho e depósito suspensos, seleção de tarefa |
| `npm run gate:types` / `typecheck:backend` | passaram (1240 diagnósticos ≤ teto 1746; nenhum novo) |
| `npm run verify:all` (variáveis da CI) | resultado colado na resposta ao proprietário |

Evidências: `docs/engineering/evidencias/r2a-cancelamento/`
- capturas `01`–`05` por largura e `06` (usuário comum);
- logs `e2e-*.txt`;
- roteiro e semente sintética.

## 6. Riscos abertos

1. **Criação ainda no navegador:** Morte, Abate, Transferência etc. continuam em várias chamadas sem transação (`DetalhesLote`).
   - O cancelamento se protege com a prova do AuditLog, mas a criação pode deixar estado parcial.
   - Próximo slice: comandos de criação server-side.
2. **`PATCH /lotes` não compartilha a trava:** um PATCH concorrente espera o `FOR UPDATE` e depois grava o valor absoluto que calculou antes do cancelamento. O resultado é serial, mas pode sobrescrever o delta. Testado sem 500. Não há serialização completa com o fluxo legado.
3. **Tipos adiados:** Nascimento, Pesagem, Mudança de Categoria, Junção, Renomear, Entrada/Saída.
4. **Legado parcial ou unificado** fica sem cancelamento (sem lote de destino gravado). Não há heurística por nome, por decisão.
5. **Prova por AuditLog** depende de auditoria existente (P3+). Movimentos anteriores a ela ficam bloqueados.
6. **Cocho e depósito:** cancelamento continua suspenso (D-PROD-94a), aguardando o slice de estoque. As rotas genéricas de estoque e suplementação agora recusam.
7. **Códigos `*_NOT_FOUND` não declarados** em outros módulos (bebedouros, aplicações, eventos sanitários, manejo técnico, fornecedor, ponto de suplementação) ainda viram 500. Fora do escopo; registrado aqui.
8. **`PATCH` genérico** das demais rotas JSON sem saldo (bebedouros, sanidade, medicamento, manejo técnico) continua aberto. Não afeta saldo de animais nem de estoque.

## 7. Rollback

Reverter os commits da PR. Não há migration nem dado a desfazer. Movimentos já cancelados continuam legíveis: `situacao` e `cancelamento` são campos do JSON.

## 8. Próximos slices (não iniciados)

- R2B: cancelamento de Nascimento, Pesagem e Mudança de Categoria com snapshot.
- R2C: estorno de cocho e depósito (estoque) transacional.
- Comandos de criação server-side para os manejos do `DetalhesLote`.
