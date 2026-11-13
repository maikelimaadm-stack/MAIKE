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
  - **Falha no 2º `CREATE INDEX` (TX-F):** o 1º índice **não** persiste. A migration fica `failed` em `_prisma_migrations` (sem `finished_at`, sem `rolled_back_at`, 0 passos), e o `migrate deploy` seguinte recusa com P3018.
  - **Prova com a migration real** (PF): o 2º nome foi ocupado à força num sandbox. O deploy falhou, nenhum dos dois índices ficou, e o ledger ficou `failed`.
- **Trava — PROVADA (TX-T).** Enquanto o 2º `CREATE INDEX` espera a trava de `MovimentacaoEstoque`, o backend do deploy **segura** `ShareLock` em `OperacaoIdempotente` (concedido) e **espera** `ShareLock` em `MovimentacaoEstoque`. `xact_start = query_start`, ou seja, uma transação desde o início do script.
  - O 1º índice só fica visível no COMMIT.
  - Um INSERT em `OperacaoIdempotente` de outra sessão é **bloqueado**. SELECT segue.
  - Consequência: **escritas nas duas tabelas** esperam até o COMMIT da migration inteira, isto é, os **dois builds somados** mais qualquer espera pela trava da 2ª tabela.
    - Em `OperacaoIdempotente`, isso é **todo** comando idempotente do sistema, de qualquer módulo, porque cada um grava o recibo.
    - Em `MovimentacaoEstoque`, são os lançamentos com estoque, abastecimentos, transferências, suplementação e saída do depósito.
- **Ordem dos dois índices: recibos → movimentos, de propósito.** É a mesma ordem dos comandos, que gravam o recibo (1ª escrita) antes dos movimentos.
  - Na ordem inversa, um comando que já gravou o recibo e espera `MovimentacaoEstoque` fecharia um ciclo com a migration (deadlock).
  - Nesta ordem, um comando em curso só faz a migration esperar.
- **`lock_timeout` — PROVADO (TX-L).** Não cabe dentro da migration, porque o classificador não aceita `SET`. Funciona nas `options` da URL de conexão da migration, que o runner repassa sem alteração ao `prisma migrate deploy` (`run-migrations.mjs:188`; mesmo recurso do runbook da D-PROD-183).
  - Com `-c lock_timeout=…`, uma transação longa faz o deploy **desistir** com 55P03.
  - Desistindo, **nenhum** índice fica e o ledger fica `failed`.
  - Sem esse `lock_timeout`, o deploy espera **sem limite** segurando os recibos.

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
  - aplicada → `JA_APLICADA`.
- **A linha que decide é `veredito.estado`.** As demais explicam o porquê.

| Linha | Esperado | Se não for |
|---|---|---|
| `indice.novos_ja_existem` | `0` | PARAR: alguém criou à mão; investigar antes de qualquer GO-2 |
| `indice.invalidos_nas_2_tabelas` | `0` | PARAR |
| `migration.concluidas` | `42` | PARAR e conferir com `--verificar-alvo` |
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

A conta do operador fica proporcional ao `linhas_estimadas` do preflight. Com dezenas de milhares de linhas, o build é de frações de segundo. A janela em que as escritas esperam é a **soma** dos dois builds, mais a espera pela trava de `MovimentacaoEstoque` (§0).

**Não se inventa cardinalidade de produção.** O número vem do preflight.

## 4. Aplicação (GO-2)

1. **Janela:** pouca escrita. Repetir o preflight imediatamente antes. Só seguir com `veredito.estado = SEGUIR`.
   - `transacao_aberta_mais_antiga_s` alta ou `idle_in_transaction` > 0 significam que a migration vai esperar segurando os recibos.
2. **`lock_timeout` na URL da migration** (recomendado; precisa constar do GO-2):
   - acrescentar `options=-c lock_timeout=5s` (codificado: `options=-c%20lock_timeout%3D5s`) à conexão de migration;
   - efeito provado no TX-L: com trava presa, o deploy desiste em ~5 s sem deixar índice;
   - o custo é ficar com a migration `failed`, que exige o §6.
3. `--verificar-alvo` e, sem pendência inesperada, `--aplicar` (§1).
4. **Se o runner falhar: PARAR.**
   - Não repetir `--aplicar`: o deploy recusa com P3018 enquanto houver migration `failed`.
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
| `falhadas_pendentes = 1`, nenhum índice novo | Qualquer erro no script: 55P03 do `lock_timeout`, nome ocupado, falta de espaço, sessão cancelada. **Provado: nada fica pela metade** | **PARAR.** Corrigir a causa só com GO e plano próprios. Depois, `prisma migrate resolve --rolled-back 20261113300000_estoque_p1_03_indices` (GO próprio) e nova aplicação (novo GO-2). No sandbox, isso volta a `SEGUIR` e depois `JA_APLICADA` (PF) |
| Os 2 índices existem e a migration está sem `finished_at` | O processo morre **depois** do COMMIT do script e **antes** do `UPDATE finished_at`. O log mostra que são instruções separadas; o caso **não foi provocado** em teste | **PARAR.** Conferir as definições com o §5. Se exatas, `migrate resolve --applied` com GO próprio. Nunca `DROP` + reaplicar sem decisão |
| 1 índice novo sem a migration registrada | Criação à mão, fora do runner | **PARAR.** Investigar quem criou. Remoção só por decisão CONTRACT |
| `contract_d_prod_183_aplicada = NAO` | A CONTRACT D-PROD-183 está pendente | **PARAR** (isolamento, §1) |

- **Nada é automático.** O runner não tenta de novo nem resolve sozinho. Quem executa `migrate resolve` ou qualquer correção é o operador, com GO escrito do proprietário para aquele passo.
- **Reversão dos índices já aplicados:** `DROP INDEX` dos dois. É DDL **destrutivo** (CONTRACT, fora do EXPAND) e exige decisão e GO próprios. Índice não muda dado.
- **Rollback de código:** este PR só acrescenta índices. O código anterior funciona com eles e sem eles.

## 7. Registro da execução

| Campo | Valor |
|---|---|
| GO-1 (texto literal, data) | — |
| Preflight (linhas) | — |
| GO-2 (texto literal, data, janela) | — |
| `--aplicar` (saída) | — |
| Postcheck | — |
| Merge | — |
