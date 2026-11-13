# MAIKE — Estoque P1-03 (índices M7): runbook de release

> Decisão: [D-PROD-185](./DECISIONS.md). Relatório: [`MAIKE-ESTOQUE-P1-03-REPORT.md`](./MAIKE-ESTOQUE-P1-03-REPORT.md).
> Contrato: [`MAIKE-ESTOQUE-P1-CONTRATO.md`](./MAIKE-ESTOQUE-P1-CONTRATO.md) §2 M7, §6.5 e §7 (ordem com DDL: runbook → GO → ensaio local → runner oficial → postcheck → **só depois** o merge).

**Nada deste runbook foi executado em produção.** Cada passo remoto exige o GO correspondente do proprietário, escrito no chat. O merge **não** substitui GO nenhum.

## 0. O que muda no banco

Migration `20261113300000_estoque_p1_03_indices`, modo **EXPAND**, SHA-256 `5d91e751e4e924f94154ddaad603203e0d21ebc0e84fd242c6a2108ea6d28565`, pinada em `MIGRATIONS_APROVADAS`. São duas instruções, ambas `CREATE INDEX` comum, não-único, sem predicado:

| Índice | Tabela | Colunas | Para quê |
|---|---|---|---|
| `OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx` | `OperacaoIdempotente` | `cliente_id, tipo_operacao, createdAt` | LC-2: recibos de estoque por tipo dentro do intervalo (reconciliação) |
| `MovimentacaoEstoque_keyset_empresa_idx` | `MovimentacaoEstoque` | `cliente_id, empresa_id, data_movimentacao DESC, id DESC` | keyset da futura central de movimentos (P1-04) |

- **Sem** tabela, coluna, constraint, dado, função, gatilho, RLS, GRANT ou DROP.
- **Sem `CONCURRENTLY`.** O classificador não aceita.
- **Escopo transacional — PROVADO (R1).** O ensaio real é `scripts/dev/ensaio-p1-03-transacao-migration.mjs`, com o teste `backend/tests/estoqueP1M7TransacaoMigration.test.mjs`. Usou `prisma migrate deploy` 6.19.3 (a versão do package-lock), PostgreSQL 17 local e o PG16 da CI.
  - **Mecanismo:** o log do servidor (`log_statement = all`) mostra o `migration.sql` **inteiro** numa **única** mensagem Query do protocolo simples. O PostgreSQL executa essa mensagem como **uma transação implícita**. O arquivo não tem `BEGIN`/`COMMIT`, nem precisa.
  - O registro em `_prisma_migrations` (`applied_steps_count`, `finished_at`) vem **depois**, em instruções separadas.
  - **Falha no 2º `CREATE INDEX` (TX-F):** o 1º índice **não** persiste. A migration fica `failed` em `_prisma_migrations` (sem `finished_at`, sem `rolled_back_at`, 0 passos).
  - O deploy que falha sai com **P3018**. **Qualquer deploy seguinte recusa com P3009** (há migration falhada) até um `migrate resolve` com GO próprio.
  - **Prova com a migration real** (PF): o 2º nome foi ocupado à força num sandbox. O deploy falhou, nenhum dos dois índices ficou, e o ledger ficou `failed`.
- **Trava — PROVADA (TX-T).** Enquanto o 2º `CREATE INDEX` espera a trava de `MovimentacaoEstoque`, o backend do deploy **segura** `ShareLock` em `OperacaoIdempotente` (concedido) e **espera** `ShareLock` em `MovimentacaoEstoque`. `xact_start = query_start`, ou seja, uma transação desde o início do script.
  - O 1º índice só fica visível no COMMIT.
  - Um INSERT em `OperacaoIdempotente` de outra sessão é **bloqueado**. SELECT segue.
  - Consequência: **escritas nas duas tabelas** esperam até o COMMIT da migration inteira.
  - A pior janela para os recibos é a soma de quatro trechos:
    1. a **espera pela trava de `OperacaoIdempotente`**, já que um pedido de `ShareLock` ainda não concedido entra na fila e novas escritas nessa tabela ficam atrás dele;
    2. o build 1;
    3. a espera pela trava de `MovimentacaoEstoque`;
    4. o build 2.
    - Em `OperacaoIdempotente`, isso é **todo** comando idempotente do sistema, de qualquer módulo, porque cada um grava o recibo.
    - Em `MovimentacaoEstoque`, são os lançamentos com estoque, abastecimentos, transferências, suplementação e saída do depósito.
- **Ordem dos dois índices: recibos → movimentos, de propósito.** É a mesma ordem dos comandos, que gravam o recibo (1ª escrita) antes dos movimentos.
  - Na ordem inversa, um comando que já gravou o recibo e espera `MovimentacaoEstoque` fecharia um ciclo com a migration (deadlock).
  - Nesta ordem, um comando em curso só faz a migration esperar.
- **`lock_timeout`: PROVADO em conexão DIRETA (TX-L); NÃO provado via pooler.** Não cabe dentro da migration, porque o classificador não aceita `SET`.
  - **O que foi provado.** Nas `options` da URL de conexão da migration, que o runner repassa sem alteração ao `prisma migrate deploy` (`run-migrations.mjs:188`), `-c lock_timeout=…` faz o deploy **desistir** com 55P03 sem deixar índice, e o ledger fica `failed`. A prova foi feita com **conexão direta** ao PostgreSQL.
  - **O que não foi provado.** Em produção, a conexão de migration é o **session pooler** do Supabase, Supavisor na porta 5432 (`DEPLOY-MIGRATION-01B-BARRIER-ACTIVATION-REPORT.md`). Não está provado que ele repassa `options`. O runbook da D-PROD-183 já registrava essa dúvida, e o caminho A dele nunca rodou em produção.
  - **Sem `lock_timeout` efetivo, o deploy espera sem limite segurando os recibos.** Por isso o GO-2 exige uma das duas condições do §4.2.

## 1. Caminho

O caminho é o oficial da D-PROD-74, numa máquina protegida do operador:

```bash
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                    # análise local: EXPAND, 1 migration nova
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo   # alvo, só leitura (GO-1)
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar          # aplica pelo runner oficial (GO-2)
```

- **Sem `--contract`**: a release é EXPAND.
- **Isolamento da D-PROD-183 (CONTRACT do `TipoTarefa`):**
  - já aplicada em produção (CURRENT-STATE, runbook da D-PROD-183 §11);
  - se o preflight mostrar que **não** está, PARAR. O runner recusaria (`CONTRACT_INESPERADO` / `DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED`), e esta release não pode levar a CONTRACT junto.
- **Proibido:**
  - `npm run deploy:migrate` à mão;
  - `release-migrate.yml`;
  - SQL Editor com o DDL;
  - qualquer mudança de segredo ou variável de release.

## 2. GOs

| GO | O quê | Estado |
|---|---|---|
| GO-1 | Rodar em produção o preflight **só leitura** (§3) e o `--verificar-alvo` | **não concedido** |
| GO-2 | Aplicar a migration pelo runner oficial (§4), na janela escolhida, e depois mergear | **não concedido** |

## 3. Preflight (GO-1, somente leitura)

Arquivo: `scripts/ops/sql-editor/estoque-p1-03-preflight-indices-somente-leitura.sql`.
- É um único SELECT sobre catálogos, sem dado de negócio nem pessoal.
- Foi validado localmente numa transação READ ONLY pelo teste X5 de `backend/tests/estoqueP1M7Indices.test.mjs`.
- Também foi testado com as migrations **reais** em cada estado (teste PF de `estoqueP1M7TransacaoMigration.test.mjs`):
  - antes → `SEGUIR`;
  - índice parcial criado à mão → `PARAR`;
  - migration falhada → `PARAR`;
  - revertida (`resolve --rolled-back`) com a causa removida → `SEGUIR`;
  - aplicada → `JA_APLICADA`;
  - nome ocupado por outra relação → `PARAR`;
  - índice de mesmo nome com definição diferente → `PARAR`.
- **R2 — histórico contra a base da release.** O preflight carrega a lista fixa `base_release` com os **nomes** das 44 migrations da main `cf07309c`. Elas incluem a CADESTACOES (D-PROD-188) e a CADCURVAGANHO (D-PROD-189), as duas aplicadas em produção antes do próprio merge. Teste PH de `estoqueP1M7TransacaoMigration.test.mjs`:
  - estado de produção antes do GO-2 (44, a CADCURVAGANHO por último) → `SEGUIR`;
  - CADESTACOES ausente (43, a mesma contagem de antes) → `PARAR`;
  - migration concluída fora da base → `PARAR`, também depois da aplicação;
  - mesmo nome concluído duas vezes → `PARAR`;
  - migration falhada → `PARAR`;
  - depois do GO-2 (45, a P1-03 por último) → `JA_APLICADA`.
  - O teste PB confere a lista:
    - só nomes reais da pasta, sem repetição e sem a P1-03;
    - todas as migrations mais antigas que a P1-03;
    - a D-PROD-183, a CADESTACOES e a CADCURVAGANHO;
    - 44 no total.
  - Teste PS: objeto homônimo fora do schema `public` não conta. Uma cópia do índice em outro schema não derruba nem completa o `JA_APLICADA`; um índice inválido numa tabela homônima de outro schema não derruba o `SEGUIR`.
  - Os estados "antes" e "depois" dos testes saem da própria `base_release`, não da pasta: uma migration que entre na main depois do merge não quebra a CI.
  - **Defeito corrigido:** no GO-1 de 2026-11-13, o preflight antigo deu `SEGUIR` com 43 concluídas e uma migration fora do repositório. Reproduzido localmente: com a CADESTACOES ausente, com uma desconhecida a mais e com a CADESTACOES trocada por uma desconhecida, o SQL antigo dava `SEGUIR` nos três casos.
  - **Checksum não é conferido aqui.** Essa conferência é do `premerge-migrate --verificar-alvo`. O preflight não é um segundo sistema de migrations.
- **A linha que decide é `veredito.estado`.** `JA_APLICADA` exige as 2 definições **exatas**, válidas e na tabela certa, com a migration concluída. As demais explicam o porquê.

| Linha | Esperado | Se não for |
|---|---|---|
| `indice.novos_ja_existem` | `0` | PARAR: alguém criou à mão; investigar antes de qualquer GO-2 |
| `indice.nomes_ocupados_qualquer_tipo` | `0` | PARAR: outra relação (tabela, view, sequência…) com um dos 2 nomes faria o `CREATE INDEX` falhar (42P07) |
| `indice.definicoes_exatas_validas` | `0` (postcheck: `2`) | No postcheck, qualquer valor ≠ 2 é PARAR |
| `indice.invalidos_nas_2_tabelas` | `0` | PARAR |
| `migration.concluidas` | `44` (postcheck: `45`) | PARAR e conferir com `--verificar-alvo` |
| `migration.base_ausentes` | `0` | PARAR: falta migration da base da release em produção |
| `migration.desconhecidas` / `desconhecidas_nomes` | `0` / `-` | PARAR: migration fora da base desta release (outra release aplicada antes). A PR precisa integrar a main e refazer a lista |
| `migration.duplicadas` | `0` | PARAR: mesmo nome concluído mais de uma vez |
| `migration.cadestacoes_aplicada` | `SIM` | PARAR |
| `migration.ultima` | — | Informativo: `20261113600000_cadcurvaganho_cadastro` antes; `20261113300000_estoque_p1_03_indices` no postcheck (ordem de aplicação, não de nome; §3.2) |
| `migration.falhadas_pendentes` | `0` | PARAR (migration falhada trava o deploy; §6) |
| `migration.revertidas_historico` | — | Informativo: reversões antigas já resolvidas não bloqueiam |
| `migration.contract_d_prod_183_aplicada` | `SIM` | PARAR (isolamento, §1) |
| `migration.p1_03_registrada` | `0` | PARAR (ou `JA_APLICADA` no postcheck) |
| **`veredito.estado`** | **`SEGUIR`** | **Qualquer outro valor: PARAR** e investigar (§6). `JA_APLICADA` só é esperado no postcheck |
| `tabela.*.linhas_estimadas`, `tamanho_*` | — | Dimensiona o build (§3.1) |
| `atividade.*` | baixo / `0` | Escolher outra janela |

### 3.1 Duração esperada

A medida é **local** e não é estimativa de produção: PostgreSQL 17, 1 worker de manutenção, 1.000.000 de linhas sintéticas.

| Índice | Build local |
|---|---|
| keyset | 3,6 s |
| LC-2 | 1,7 s |

A conta do operador fica proporcional ao `linhas_estimadas` do preflight. Com dezenas de milhares de linhas, o build é de frações de segundo.

A janela em que as escritas esperam vai além dos builds. É a soma de:
- espera pela trava de `OperacaoIdempotente`;
- build 1;
- espera pela trava de `MovimentacaoEstoque`;
- build 2.

Com `lock_timeout` efetivo de 5 s, cada espera fica limitada a cerca de 5 s (§0).

**Não se inventa cardinalidade de produção.** O número vem do preflight.

### 3.2 Ordem das migrations (R2)

A P1-03 (`20261113300000`) tem carimbo **anterior** ao da CADESTACOES (`20261113400000`) e ao da CADCURVAGANHO (`20261113600000`), que já estão aplicadas em produção. Teste OR, em PostgreSQL 17 descartável, com o `prisma migrate deploy` real:
- **Banco novo:** o Prisma aplica pela ordem do nome, `…` → P1-03 → CADESTACOES → CADCURVAGANHO.
- **Produção:** as 44 da base e, num segundo `migrate deploy`, a P1-03, que vira a última por `finished_at`.
- **Nas duas:**
  - 45 concluídas e 0 falhadas;
  - `prisma migrate diff` entre os dois bancos vazio, e de cada um contra o `schema.prisma` também;
  - os 2 índices com a mesma definição;
  - a CADESTACOES com as mesmas colunas, constraints e RLS.
- **O runner aceita esse histórico.**
  - `conferirHistoricoRemoto` dá `ok` com `pendentes = [P1-03]` antes e `[]` depois; o runner não exige ordem.
  - O `premerge-migrate --verificar-alvo` real, contra um banco local com o estado de produção, confirma isso (relatório §10).
- **Decisão: o nome e o SHA-256 da P1-03 ficam como estão.** As migrations são independentes: a CADESTACOES e a CADCURVAGANHO criam tabelas novas; a P1-03 cria índices em duas tabelas antigas que nenhuma delas toca.

## 4. Aplicação (GO-2)

1. **Janela:** pouca escrita. Repetir o preflight imediatamente antes. Só seguir com `veredito.estado = SEGUIR`.
   - `transacao_aberta_mais_antiga_s` alta ou `idle_in_transaction` > 0 significam que a migration vai esperar segurando os recibos.
2. **`lock_timeout` efetivo**, obrigatório no GO-2. Valem uma das duas formas abaixo; sem nenhuma delas, **não aplicar**:
   - **(a) Conexão DIRETA** (`db.<ref>.supabase.co:5432`, não o pooler) com `options=-c lock_timeout=5s` (codificado: `options=-c%20lock_timeout%3D5s`). É o caminho provado no TX-L.
   - **(b) Prova somente leitura de que o parâmetro chega pela MESMA URL** que o runner vai usar. Rodar imediatamente antes do `--aplicar`; o comando não altera nada e não imprime a URL:
     ```bash
     node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient({datasourceUrl:process.env.MIGRATION_DATABASE_URL});p.\$queryRawUnsafe('SHOW lock_timeout').then(r=>console.log('lock_timeout =',r[0].lock_timeout)).finally(()=>p.\$disconnect())"
     ```
     O esperado é `lock_timeout = 5s`. Com `0` ou outro valor, o pooler descartou o parâmetro: PARAR e usar (a).
   - **Custo:** com trava presa, o deploy desiste em cerca de 5 s sem índice, mas a migration fica `failed` e exige o §6.
3. `--verificar-alvo` e, sem pendência inesperada, `--aplicar` (§1).
4. **Se o runner falhar: PARAR.**
   - Não repetir `--aplicar`: com migration `failed` pendente, todo deploy seguinte recusa com **P3009**. O deploy que falhou terá saído com P3018.
   - Não rodar `migrate resolve`, `DROP INDEX` nem SQL de correção.
   - Rodar o preflight (só leitura) e levar a saída ao proprietário (§6).

## 5. Postcheck (só leitura, antes do merge)

```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND indexname IN ('OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx', 'MovimentacaoEstoque_keyset_empresa_idx');
SELECT x.indisvalid, x.indisready, c.relname FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid
WHERE c.relname IN ('OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx', 'MovimentacaoEstoque_keyset_empresa_idx');
SELECT migration_name, finished_at FROM public._prisma_migrations WHERE migration_name = '20261113300000_estoque_p1_03_indices';
```

Esperado:
- o preflight inteiro com `veredito.estado = JA_APLICADA`;
- as duas definições iguais às do teste X1;
- `indisvalid` e `indisready` verdadeiros;
- a migration com `finished_at`.

Depois disso, o proprietário faz o merge manual.

## 6. Falha, estado parcial e recuperação (sempre com GO próprio)

| Estado no preflight | Como acontece | O que fazer |
|---|---|---|
| `falhadas_pendentes = 1`, nenhum índice novo | Qualquer erro no script: 55P03 do `lock_timeout`, nome ocupado, falta de espaço, sessão cancelada. **Provado: nada fica pela metade.** O deploy que falha sai com P3018; os seguintes saem com P3009 | **PARAR.** Corrigir a causa só com GO e plano próprios. Depois, `prisma migrate resolve --rolled-back 20261113300000_estoque_p1_03_indices` (GO próprio) e nova aplicação (novo GO-2). No sandbox, isso volta a `SEGUIR` e depois `JA_APLICADA` (PF) |
| Os 2 índices existem e a migration está sem `finished_at` | O processo morre **depois** do COMMIT do script e **antes** do `UPDATE finished_at`. O log mostra que são instruções separadas; o caso **não foi provocado** em teste | **PARAR.** Conferir as definições com o §5. Se exatas, `migrate resolve --applied` com GO próprio. Nunca `DROP` + reaplicar sem decisão |
| `base_ausentes > 0`, `desconhecidas > 0` ou `duplicadas > 0` | O histórico de produção não é a base desta release. Foi o que o GO-1 de 2026-11-13 achou, e repete-se sempre que outra PR aplica a migration dela antes do merge (CADESTACOES, depois CADCURVAGANHO) | **PARAR.** Não aplicar. A PR integra a main que tem essa migration, refaz a lista `base_release` com teste e pede **novo GO-1** |
| 1 índice novo, ou nome ocupado por outra relação, sem a migration registrada | Criação à mão, fora do runner | **PARAR.** Investigar quem criou. Remoção só por decisão CONTRACT |
| `contract_d_prod_183_aplicada = NAO` | A CONTRACT D-PROD-183 está pendente | **PARAR** (isolamento, §1) |

- **Nada é automático.** O runner não tenta de novo nem resolve sozinho. Quem executa `migrate resolve` ou qualquer correção é o operador, com GO escrito do proprietário para aquele passo.
- **Reversão dos índices já aplicados:** `DROP INDEX` dos dois. É DDL **destrutivo** (CONTRACT, fora do EXPAND) e exige decisão e GO próprios. Índice não muda dado.
- **Rollback de código:** este PR só acrescenta índices. O código anterior funciona com eles e sem eles.

## 7. Registro da execução

| Campo | Valor |
|---|---|
| GO-1 #1 (2026-11-13) | Autorização expressa do proprietário "somente o GO-1". Preflight do SQL anterior à R2, em `SET TRANSACTION READ ONLY` pelo conector, projeto `uuemcasqcdjucflulkne`: `veredito = SEGUIR`, porém `concluidas = 43` (esperado 42) e `ultima = 20261113400000_cadestacoes_cadastro`, que não estava na main nem na PR. Índices: 0 novos, 0 nomes ocupados, 0 inválidos, 0 exatos; 0 falhadas; D-PROD-183 `SIM`; P1-03 `0`; travas, transação antiga e idle in transaction `0`; `lock_timeout 0`, `statement_timeout 2min`, `maintenance_work_mem 64MB`. **Interrompido** pela divergência; `--verificar-alvo` não rodou (também faltava `MIGRATION_DATABASE_URL` no ambiente). Origem: PR #265, mergeada depois. Esse GO-1 está encerrado |
| GO-1 #2 (texto literal, data) | — (precisa de nova autorização, com o preflight da R2) |
| Preflight (linhas) | — |
| GO-2 (texto literal, data, janela) | — |
| `--aplicar` (saída) | — |
| Postcheck | — |
| Merge | — |
