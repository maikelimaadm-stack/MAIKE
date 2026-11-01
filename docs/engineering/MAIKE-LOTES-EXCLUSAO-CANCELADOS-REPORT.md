# MAIKE-LOTES-R1 — Exclusão do Cadastro de Lotes depois de cancelamento seguro

**Data:** 2026-11-01 · **Decisão:** D-PROD-100 · **Base:** `main` 60667be (merge da #162)
**Branch:** `claude/new-session-26kpxu` (recriada a partir de `main`; a #162 já estava mergeada)
- Antes de começar: nenhuma PR aberta e nenhuma branch com trabalho de R2B em andamento. Não havia trabalho paralelo para colidir.
- Uma migration expand-only. Nenhuma escrita em produção.

> **Complemento PR167-R1 (cache offline + gate de release):** ver a seção 10. Estado de deploy: **`DEPLOY_BLOCKED`** até a migration ser aplicada e verificada no banco real, conforme `MAIKE-LOTES-EXCLUSAO-CANCELADOS-RELEASE.md`.

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

## 10. PR167-R1 — cache offline da entidade Lote e gate de release

**Missão:** MAIKE-LOTES-PR167-R1-CACHE-OFFLINE-E-RELEASE-GATE-SEGURO, na mesma PR #167 (HEAD de entrada 75946e5). Sem nova migration e sem acesso a produção.

### 10.1 P0-A — cache offline

| Item | Conteúdo |
|---|---|
| Bug | A exclusão vai direto ao servidor (fora da fila). O cache offline da entidade Lote (IndexedDB, chave `Lote::tenant::fazenda`, uma cópia com TODOS os lotes do tenant por fazenda já aberta) não era tocado. Um lote excluído voltava em qualquer leitura offline |
| RED (unitário, runtime real + porta em memória com o contrato do IndexedDB) | 5 de 10 vermelhos no HEAD 75946e5: o lote reaparece offline em todas as fazendas, também depois de recarregar; o mapa não é atualizado; com edição offline pendente, a exclusão é enviada assim mesmo (`evidencias/lotes-r1-exclusao/r1-cache-release/red-cache-offline-antes.txt`) |
| RED (E2E, Chromium com IndexedDB real, frontend 75946e5) | depois do 204, as duas entradas de cache do tenant (`__GLOBAL__` e a da fazenda) **continuam com os lotes excluídos**, também depois de recarregar (`e2e-red-frontend-75946e5/`) |
| Correção | Runtime offline (sem segundo motor): `removerRegistroDosCachesOffline` varre todas as entradas de cache da entidade do **tenant da sessão** (porta IndexedDB ganha `listarCaches`); `temPendenciaOfflineDoRegistro` olha a fila. Exposto em `apis/lotes`. Em `excluirLotes`: pendência offline → recusa `pendencia_offline`; só depois de 204, tira o lote dos caches offline e do cache do mapa (`lotes`) da fazenda dele |
| GREEN | unitário 10/10; E2E 64/64 (16 por largura, 1440/768/412/390) |

No E2E com IndexedDB real, por largura:
- cache limpo logo após o 204 nas duas chaves do tenant;
- fila sem DELETE;
- offline na sessão (sai do Cadastro e volta, sem leitura online): excluídos não aparecem e o lote restante continua;
- excluir offline avisa, sem DELETE e sem fila;
- recarga com a API inacessível: o IndexedDB persistido continua sem os excluídos;
- online de novo: lista correta e movimento cancelado intacto;
- sem DELETE/PATCH de movimento, sem erro, sem overflow.

**Observado:** recarregado sem servidor, o app não abre dado nenhum ("Não foi possível validar sua sessão"). Por esse caminho não há ressurreição; o risco era a leitura offline dentro da sessão, agora coberta.

**Regressão do fluxo da #167** (bloqueio ativo, lógica, física, offline, histórico com indicador): 1440 14/14 e 390 14/14.

### 10.2 P0-B — migration e deploy

- **Validado localmente** (bancos descartáveis, `migration-preflight-local.txt`):
  - preflight real em banco sem a migration: exit 1, nomeando a migration pendente e as duas colunas ausentes;
  - preflight em banco migrado: exit 0;
  - a consulta do `GET /lotes` novo dá P2022 sem a coluna;
  - a suíte de lotes da `main` 60667be passa 53/53 sobre banco migrado (expand-only: migrar antes do merge não quebra a produção atual);
  - o preflight exige `Lote.excluido_em` **e** `Lote.excluido_por_usuario_id` (teste de contrato).
- **Não validado (fora do alcance desta PR):**
  - o schema do banco real;
  - nenhum pipeline versionado aplica migration no banco real (só `quality.yml`, CI);
  - o build do Vercel não migra.
- **`DEPLOY_BLOCKED`** até o operador seguir `MAIKE-LOTES-EXCLUSAO-CANCELADOS-RELEASE.md`. Ordem: congelar, backup, conferir o alvo, `deploy:migrate` com aprovação explícita, SELECTs, preflight OK, só então merge, smoke.

### 10.3 Riscos residuais (acrescentados)

1. Cache offline de **outro aparelho** do mesmo tenant continua com o lote até a próxima leitura online naquele aparelho. A remoção vale para o aparelho que excluiu. Não há canal de invalidação entre aparelhos. É o mesmo limite de qualquer cache offline do produto.
2. Se a remoção do cache falhar (erro do IndexedDB) depois do 204, a exclusão vale e a próxima leitura online corrige. A falha é engolida de propósito.
3. Uma pendência offline do lote bloqueia a exclusão até ser sincronizada. É o comportamento desejado (sem descarte silencioso).

