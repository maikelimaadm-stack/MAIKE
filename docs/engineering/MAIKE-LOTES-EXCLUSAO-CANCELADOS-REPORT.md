# MAIKE-LOTES-R1 — Exclusão do Cadastro de Lotes depois de cancelamento seguro

**Data:** 2026-11-01 · **Decisão:** D-PROD-100 · **Base:** `main` 60667be (merge da #162)
**Branch:** `claude/new-session-26kpxu` (recriada a partir de `main`; a #162 já estava mergeada)
- Antes de começar: nenhuma PR aberta e nenhuma branch com trabalho de R2B em andamento. Não havia trabalho paralelo para colidir.
- Uma migration expand-only. Nenhuma escrita em produção.

## 1. Diagnóstico

| Ponto | O que acontecia |
|---|---|
| `loteRepository.motivoBloqueioExclusaoLote` | `findFirst` em `MovimentacaoMapa` por `lote_id` contava movimento **cancelado** como vínculo. Também não olhava `lote_destino_id`, `efeito_servidor` nem sanidade/medicamento |
| `loteService.motivoDeHistoricoDoLote` (excluir) | O mesmo vínculo bruto. Um lote com saldo de volta à entrada por PATCH manual, sem nenhum movimento, era **apagado fisicamente** |
| Frontend (`loteCadastroService`, `CadastroLotes`) | Bloqueava antes de chamar o servidor, com listas limitadas que contavam cancelados. `deleteLote` passava pela fila offline |

**RED no HEAD 60667be** (`evidencias/lotes-r1-exclusao/red-antes.txt`):
- compra 500 → morte 50 → cancelamento 200 → saldo 500 → `DELETE /lotes` = **409 movimentacoes_mapa**;
- PATCH manual 500→450→500 sem movimento → `DELETE` = **204 e a linha é apagada**;
- `backend/tests/loteExclusaoCancelados.test.mjs`: **23/23 vermelhos**.

## 2. Solução

A exclusão lógica é o único caminho que mantém a identidade do lote disponível para os movimentos cancelados e para a auditoria. Hard delete continua só para lote sem nenhum histórico.

### Matriz de exclusão

| Situação do lote (relida no banco, lote travado) | Resultado |
|---|---|
| Sem vínculo, sem alteração operacional, sem anexo | **Física** (como antes); auditoria `delete` |
| Só movimentos do mapa **cancelados com prova** + estado de entrada + auditoria explicada | **Lógica**: `excluido_em`, auditoria `exclusao_logica`, movimentos e cancelamentos intactos |
| Sem histórico, mas com anexo | **Lógica** (o anexo não fica órfão) |
| Já excluído logicamente | 204 idempotente, sem novo efeito nem nova auditoria |
| Movimento do mapa ativo (por `lote_id`, `lote_destino_id`, efeito ou id em observações) | Bloqueado: `movimentacao_ativa` |
| Pecuária, suplementação, sanidade, medicamento, manejo técnico, tarefa | Bloqueado com o motivo da fonte |
| Registro legado só por nome (sem id), com o mesmo nome, na mesma empresa | Bloqueado: `vinculo_legado_por_nome` |
| Movimento "cancelado" sem prova (sem operação idempotente confirmada, ou sem comando) | Bloqueado: `cancelamento_nao_comprovado` |
| Saldo, área, categoria ou situação diferentes da entrada | Bloqueado: `estado_divergente_da_entrada` |
| Alteração operacional na auditoria sem comando cancelado que a explique (inclusive ida e volta) | Bloqueado: `alteracao_sem_comprovacao` |
| Lote gerado por manejo (derivado) | Bloqueado: `lote_gerado_por_manejo` (nunca vira entrada excluível) |

`details.vinculo` mantém os nomes do contrato anterior (`movimentacoes_mapa`, `lote_com_manejo`). O código novo e mais preciso vai em `details.motivo`.

### Proteção histórica

- O movimento cancelado não é tocado: `situacao`, `cancelamento` (motivo, autor, horário, efeitos), `efeito_servidor` e AuditLog continuam iguais.
- O lote excluído logicamente continua existindo:
  - `GET /lotes/:id` resolve nome, número e retrato;
  - o histórico mostra "Lote excluído do Cadastro — registro mantido para auditoria", sem erro de "não encontrado".
- `quantidade_entrada`, número do lote, origem e área de entrada não mudam. O derivado de uma transferência parcial fica 0/Inativo, com origem `MOVIMENTAÇÃO`.

### Concorrência (TOCTOU)

- A exclusão trava o lote com `FOR UPDATE` e só então avalia.
- Todo escritor que grava `lote_id`/`lote_destino_id` toma `FOR SHARE` nos lotes citados (helper `shared/lotes/loteVivo.js`) e recusa lote excluído com 409 `LOTE_EXCLUIDO`. São eles:
  - mapa (POST e bulk) e pecuária;
  - suplementação avulsa, bulk e comando de evento;
  - sanidade, medicamento e manejo técnico (criar e alterar);
  - tarefa e anexo.
- O comando de manejo do mapa trata lote excluído como inexistente (404). `PATCH /lotes` dá 404.

Provas com trava segurada em transação à parte, repetidas 3 vezes (4/4 em cada rodada):

| Ordem | Resultado |
|---|---|
| exclusão → manejo | 204; o manejo dá 404; nenhum movimento ativo novo; saldo 500 |
| manejo → exclusão | manejo 201; a exclusão dá 409; `excluido_em` nulo |
| sanidade → exclusão | sanidade 201; a exclusão dá 409 |
| exclusão → sanidade | 204; a sanidade dá 409 `LOTE_EXCLUIDO` |

## 3. Migration

`backend/prisma/migrations/20261101100000_lote_exclusao_logica`:
- `ALTER TABLE "Lote" ADD COLUMN "excluido_em" TIMESTAMP(3), ADD COLUMN "excluido_por_usuario_id" VARCHAR(64)`;
- expand-only: NULL, sem default, sem backfill, sem índice;
- lote existente fica com `excluido_em` NULL e nada muda.

Ordem de deploy (D-PROD-28): migration antes do código.
- O código antigo ignora as colunas, então funciona com o banco migrado.
- O código novo exige a coluna, e o preflight (`scripts/deploy/preflightSchemaLib.mjs`) agora exige `Lote.excluido_em`.

Rollback:
1. conferir `SELECT count(*) FROM "Lote" WHERE excluido_em IS NOT NULL` (precisa ser 0);
2. `ALTER TABLE "Lote" DROP COLUMN "excluido_em", DROP COLUMN "excluido_por_usuario_id"`.

Teste em banco descartável: UP, rollback e re-UP funcionaram; `prisma migrate diff` = 0.

## 4. Consultas e cache

- `GET /lotes` filtra `excluido_em IS NULL`. Por consequência, ficam de fora do Cadastro, do mapa, dos saldos e totais por área, da seleção de lote e do cache operacional offline.
- `GET /lotes/:id` lê inclusive excluído.
- A exclusão do Cadastro invalida a lista do Cadastro e força o refresh do cache `lotes` do mapa.
- O cache de histórico (`movimentacoesHistorico`) continua com os cancelados.
- O cache operacional de movimentos continua só com ativos.

## 5. Interface

- **Excluir** consulta a elegibilidade no servidor:
  - bloqueado → aviso com o motivo e sem confirmação;
  - lógica → a confirmação diz "A entrada sairá do Cadastro e dos saldos atuais; movimentos cancelados ficarão preservados para auditoria";
  - física → confirmação padrão.
- Offline: aviso, nada enviado e nada enfileirado.
- Exclusão em massa com resultado por item; quem falhou continua selecionado.
- Editar a entrada continua travado quando há histórico. Liberar edição histórica exigiria outra decisão.

## 6. Testes e evidências

| Comando | Resultado |
|---|---|
| `node --test backend/tests/loteExclusaoCancelados.test.mjs` | RED 23/23 → GREEN **23/23** (casos 1–10 da missão; abaixo) |
| `npm run test:backend` (PostgreSQL 16) | resultado na seção 7 (inclui R2A, R1, R2, R3, `loteDerivadoIntegridade`, `loteNativo`) |
| `vitest` smoke | **1173/1173** (Cadastro: ativo bloqueado, confirmação lógica, offline; serviço: servidor decide, offline sem envio, derivado; histórico com indicador) |
| E2E Chromium (backend e Vite locais; `maike_demo` sintético) em 1440, 768, 412 e 390 | **56/56** (14 por largura) |
| E2E de regressão R2 (cancelamento, recusa após correção direta, legado, transferência, curral, offline) em 1440 e 390 | **32/32** |
| `npm run verify:all` com o ambiente da CI no HEAD final | ver seção 7 |

Os 23 testes de backend cobrem:
- só cancelado → lógica, com idempotência, `GET` por id e histórico paginado;
- duas mortes, uma ativa;
- transferência total no lugar;
- parcial com lote novo, em que o derivado fica bloqueado;
- unificação, com o destino citado só por `lote_destino_id`/efeitos;
- homônimo com id (não bloqueia) e legado por nome (bloqueia);
- 5 fontes ativas e tarefa;
- movimento ativo antigo atrás de 600 registros;
- PATCH manual ida e volta;
- legado sem prova;
- "cancelado" forjado;
- exclusão física;
- anexo;
- escritores recusando lote excluído;
- outro tenant (404/401);
- 3 ordens de concorrência.

Os 56 testes E2E cobrem, em cada largura:
- ativo bloqueado com motivo e sem DELETE;
- confirmação lógica;
- o lote sai de `GET /lotes` e mantém `excluido_em` por id;
- o movimento continua cancelado com motivo e autor;
- exclusão física (404);
- offline sem DELETE;
- histórico da área com o cancelado e o indicador;
- DELETE só nos lotes confirmados;
- nenhum DELETE/PATCH de movimento;
- sem erro de página e sem rolagem horizontal.

Em 390, o primeiro pasto escolhido ficava ao lado de um marcador de lote, e o toque no rótulo caiu nele. A repetição em outro pasto passou 14/14. O mesmo aconteceu na regressão R2 em 390 (16/16 em outro par de pastos).

Evidências: `docs/engineering/evidencias/lotes-r1-exclusao/`
- `red-antes.txt` e `green-depois.txt`;
- `e2e-*.txt` e `regressao-r2/`;
- capturas 1440 e 390;
- roteiro e script de limpeza da demonstração.

## 7. Gates

Ver a resposta final da missão. `verify:all` e a CI `quality` são rodados no HEAD final.

## 8. Riscos residuais

1. **Sem "restaurar":** um lote excluído logicamente não volta pelo app. Fazer isso exigiria decisão e tela próprias.
2. **Escritor que cita lote inexistente** segue o contrato anterior (não é validado). Só lote existente e excluído é recusado.
3. **Bloqueio por legado só por nome** pode bloquear um lote que não tem relação real com o registro antigo homônimo. É deliberado (fail-closed).
4. **Correção de saldo pela tela de lote**, sem manejo, deixa o lote como `alteracao_sem_comprovacao`, e ele não pode mais ser excluído pelo Cadastro. Antes, um lote assim era apagado fisicamente.
5. **Ledger L1 (desativado)** não filtra `excluido_em`. Precisa ser revisto quando for ativado.
6. **Ordem de deploy:** migration antes do código, como já exige a D-PROD-28 e agora também o preflight.

## 9. Próximo slice (não iniciado)

- R2B: nascimento, pesagem e mudança de categoria, já planejada em outra missão.
- "Restaurar lote excluído" e conciliação assistida, se o proprietário quiser.
