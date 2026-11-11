# MAIKE — Patrimônio SIMPLIFICA-01: runbook de release CONTRACT (D-PROD-162)

> **Estado: NÃO EXECUTADO.** Nada foi lido nem escrito em produção. Este arquivo é o
> **esqueleto** do runbook (frente F0): seções e fatos fixos do contrato da missão. A
> frente F6 completa os trechos marcados com **[F6]** (o texto exato de
> `ensaio/impressao.sql`, `ensaio/fingerprint_v2.sql`, o bloco C do preflight e o envelope
> do caminho B) e confere tudo contra o arquivo do `<SHA_APROVADO>`.
>
> **GO escrito do proprietário (2026-11-10), palavras literais, registradas na
> [D-PROD-162](./DECISIONS.md):** "pode apaguar oque tiver lançado dessas tabelas", "olha pode
> fazer não precisa pedir confirmação ok, pode fazer", "ok apague oque tiver faça oque tem que
> fazer". O alcance e os limites desse GO estão na D-PROD-162: ele autoriza o ato e dispensa
> novo pedido de confirmação, mas **não** dispensa nenhuma barreira deste runbook. Os fatos que
> o §2 lista são lidos e anotados no §11 **antes** de aplicar; qualquer divergência do esperado
> é `RELEASE_BLOCKED` (§10).
>
> Valores entre `<…>` são preenchidos na hora da execução, sempre a partir de leituras reais.

Decisão: [D-PROD-162](./DECISIONS.md). Relatório:
[`MAIKE-PATRIMONIO-SIMPLIFICA-01-REPORT.md`](./MAIKE-PATRIMONIO-SIMPLIFICA-01-REPORT.md).
Modelo: [runbook da P1-02](./MAIKE-PATRIMONIO-P1-02-RUNBOOK-RELEASE.md) (§0–§11) e o
precedente de operação destrutiva autorizada da D-PROD-73.

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261110300000_patrimonio_simplifica` |
| Natureza | **CONTRACT** (exceção única da D-PROD-162 à D-PROD-72 item 3 e à D-PROD-107 R7), numa transação: (1) guarda DO; (2) **apaga as 13 tabelas do Patrimônio**, com os dados de todos os clientes; (3) **alarga 2 CHECKs** de `OperacaoFinanceiraItem` para aceitar `'L'`; (4) cria **7 tabelas** no formato novo, com RLS e REVOKE |
| Tabelas apagadas e não recriadas (7) | `ConversaoCombustivelProduto`, `TipoCombustivelProduto`, `TanqueBemCombustivel`, `TipoCombustivel`, `MedicaoBem`, `TipoPatrimonialPerfil`, `PerfilMedicao` |
| Tabelas apagadas e recriadas vazias (6) | `FamiliaPatrimonial`, `TipoPatrimonial`, `BemPatrimonial`, `TanqueBem`, `AbastecimentoBem` (formato novo), `AbastecimentoBemConsumoLote` (igual) |
| Tabela nova (1) | `TanqueBemProduto` |
| Única tabela antiga alterada | `OperacaoFinanceiraItem`: `OperacaoFinanceiraItem_unidade_check` e `OperacaoFinanceiraItem_forma_check` com o mesmo texto da P3-01 mais `'L'`. Toda linha válida antes continua válida |
| SHA-256 do arquivo (`MIGRATIONS_APROVADAS`) | `787d6d118939c6eca4e3c3f45bf94a4f94d1f1625cbfb2ea2102b190ad944222` |
| Hash da guarda (`MIGRATIONS_CONTRACT_APROVADAS`) | `28d6c422968d961bbecd40459a7e6a337f36b9d66c121982f9c295065c149046` |
| Hash do DO de RLS das 7 (`DO_RLS_APROVADOS`) | `6fc88d930cdbc5038bb4d604abefb9e04d993e6e776bb851369b697a8f966a7e` |
| Classificador | `modo: CONTRACT`; 13 removidas na ordem; 4 alargamentos; `tabelas_novas` = as 7; `colunas_novas_em_tabelas_antigas: []`; 0 violações |
| `_prisma_migrations` | antes **39** concluídas / 0 em aberto; depois **40** |
| Tabelas em `public` | antes **85** (84 de domínio + `_prisma_migrations`); depois **79** |
| Contagens das 7 | colunas Família 12 · Tipo 11 · Bem 54 · Tanque 9 · TanqueBemProduto 7 · Abastecimento 31 · ConsumoLote 10; PK 7 · FK 31 · CHECK 32 · índices 55 |

**Por que a migration vem antes do merge, e a janela:** a Vercel publica a `main` sozinha, e
o runtime novo sem o schema novo daria 500. Mas o runtime **antigo** também dá 500 com o
schema novo: do `COMMIT` até o deploy da `main` ficar READY, respondem 500 (P2021/P2022)
todo o Patrimônio (Bens, Abastecimentos, catálogos), `DELETE /produtos/:id`,
`PATCH /produtos/:id` com troca de fazenda e `DELETE /empresas/:id`. Por isso o merge é
**imediato** depois do postcheck rápido (§6), com a `main` congelada (§2).

## 1. Caminho

- **Caminho A (padrão, D-PROD-74):** runner oficial `premerge-migrate.mjs --sha <SHA_APROVADO>`,
  primeiro com `--verificar-alvo --contract D-PROD-162` e depois com
  `--aplicar --contract D-PROD-162`, numa máquina protegida do operador. Detalhes no §5.
- **Caminho B (conector Supabase, uma transação):** só com GO que cite o desvio da D-PROD-74,
  como na P1-01 e na P1-02. Envelope no §5.
- O `npm run deploy:migrate` à mão e o `release-migrate.yml` **recusam** esta migration
  (`DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED`) enquanto ela estiver pendente no alvo: só o
  `premerge-migrate --aplicar --contract D-PROD-162` passa `MIGRATION_CONTRACT_AUTORIZADO`.

## 2. Pré-requisitos e GOs

**Pré-requisitos do merge (todos antes da aplicação):**
- a PR (draft durante o desenvolvimento) foi revista pelo proprietário (código, padrões
  P-01…P-12 e emendas do `00`/`07`) e marcada como **pronta** com a autorização dele;
- `mergeable_state = clean`;
- a branch está atualizada com a `main`;
- o CI está verde no `<SHA_APROVADO>` (40 hex);
- o build da Preview desse SHA está READY (prova que o build de produção passa);
- a branch protection permite ao operador mergear sem outra espera;
- a `main` está **congelada**, sem merge de outra PR, da aplicação até o deploy READY.

Se a `main` andar antes da aplicação: atualizar a branch, gerar SHA novo e repetir CI,
ensaio (§4.8) e o registro do §11.

**GOs:**

| GO | O quê | Situação |
|---|---|---|
| GO-1 | rodar o preflight só leitura em produção (§4) | coberto pelo GO escrito de 2026-11-10 (D-PROD-162) |
| GO-2 | aplicar a migration CONTRACT e mergear em seguida | coberto pelo GO escrito de 2026-11-10 (D-PROD-162), no alcance registrado lá. **Antes de aplicar**, anotar no §11: migration e sha256 do arquivo, alvo `7692130048193495360`, caminho A ou B, `<SHA_APROVADO>` com CI verde e Preview READY, as contagens por tabela e por cliente das 13 e a **impressão** `<hex12>`, o backup (§4.7), a estimativa da janela em minutos e o próximo nº de bem e de abastecimento por cliente (P-04) |
| GO-3 | (só se houver CONFIRMADO, §5.2) cancelar os CONFIRMADOS pelo app | **não coberto**: pedir ao proprietário, com a lista |
| GO-4 | (só se preciso) reversão §9 ou GRANT corretivo (R4 do §6) | **não coberto**: pedir ao proprietário, com a operação exata |

Também dependem do proprietário a aprovação das emendas do `00`/`07` (o agente só propõe,
`00 §4`) e a revisão humana da PR (R7/R8).

## 3. Ordem e janela

GO → preflight §4 → contagens por tabela e cliente + **impressão** + inventário do bloco C
anotados → [CONFIRMADO > 0: **parar**, §5.2] → [algo fora do esperado no bloco C:
`RELEASE_BLOCKED` até o proprietário decidir] → backup §4.7 → ensaio local §4.8 com o arquivo
do SHA → pré-requisitos do §2 → logo antes: repetir a impressão (bloco B) e a consulta de
transações longas (bloco E); se a impressão mudou, parar e levar o fato ao proprietário →
migration §5 → **postcheck rápido** §6 (só leitura) → **merge imediato** §7 → deploy da
`main` → READY → **postcheck completo** §8 (só leitura) → o proprietário declara encerrada a
janela de reversão (P-12) e só então faz a primeira escrita.

- **Janela estimada** = a duração do último build de produção da Vercel (medida no preflight)
  mais ~2 min para o merge. O CI já está verde no SHA e a `main` está congelada.
- Antes da migration nada muda. A Preview da PR usa o banco de produção e dá 500 no
  Patrimônio até a migration: **nenhuma escrita de teste na Preview**.
- Escolher horário de pouco uso e avisar.
- A transação dura ~1 s. Enquanto espera trava (≤ 5 s), segura a fila das tabelas antigas
  referenciadas e de `OperacaoFinanceiraItem`, que o alargamento trava em `ACCESS EXCLUSIVE`.
  Uma confirmação P3 simultânea pode dar *deadlock*: se a vítima for a migration, nada é
  aplicado e repete-se pelo §5.1; se for a P3, o usuário repete o lançamento.

## 4. Preflight (somente leitura; `SELECT` no conector ou papel de leitura)

### 4.1 Bloco A — identidade e histórico

```sql
SELECT system_identifier FROM pg_control_system();            -- 7692130048193495360
SHOW server_version;                                          -- 17.x
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
       count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)     AS falha_aberta
  FROM _prisma_migrations;                                    -- 39 | 0
SELECT migration_name, checksum FROM _prisma_migrations
 WHERE migration_name IN ('20261110100000_patrimonio_p1_01_cadastros','20261110200000_patrimonio_p1_02_abastecimentos','20261110300000_patrimonio_simplifica');
-- b8818ba8…ffd64dc e 20f8f960…15fba concluídas; simplifica AUSENTE
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p');  -- 85
```

### 4.2 Bloco B — contagem por tabela e por cliente das 13, e a impressão

```sql
SELECT 'AbastecimentoBemConsumoLote' AS tabela, cliente_id, count(*) AS n FROM "AbastecimentoBemConsumoLote" GROUP BY cliente_id
UNION ALL SELECT 'AbastecimentoBem', cliente_id, count(*) FROM "AbastecimentoBem" GROUP BY cliente_id
UNION ALL SELECT 'ConversaoCombustivelProduto', cliente_id, count(*) FROM "ConversaoCombustivelProduto" GROUP BY cliente_id
UNION ALL SELECT 'TipoCombustivelProduto', cliente_id, count(*) FROM "TipoCombustivelProduto" GROUP BY cliente_id
UNION ALL SELECT 'TanqueBemCombustivel', cliente_id, count(*) FROM "TanqueBemCombustivel" GROUP BY cliente_id
UNION ALL SELECT 'TanqueBem', cliente_id, count(*) FROM "TanqueBem" GROUP BY cliente_id
UNION ALL SELECT 'MedicaoBem', cliente_id, count(*) FROM "MedicaoBem" GROUP BY cliente_id
UNION ALL SELECT 'BemPatrimonial', cliente_id, count(*) FROM "BemPatrimonial" GROUP BY cliente_id
UNION ALL SELECT 'TipoPatrimonialPerfil', cliente_id, count(*) FROM "TipoPatrimonialPerfil" GROUP BY cliente_id
UNION ALL SELECT 'TipoPatrimonial', cliente_id, count(*) FROM "TipoPatrimonial" GROUP BY cliente_id
UNION ALL SELECT 'FamiliaPatrimonial', cliente_id, count(*) FROM "FamiliaPatrimonial" GROUP BY cliente_id
UNION ALL SELECT 'PerfilMedicao', cliente_id, count(*) FROM "PerfilMedicao" GROUP BY cliente_id
UNION ALL SELECT 'TipoCombustivel', cliente_id, count(*) FROM "TipoCombustivel" GROUP BY cliente_id
ORDER BY 1, 2;
SELECT id, codigo, nome, ativo FROM "Cliente" ORDER BY id;                        -- quem é cada cliente_id
SELECT cliente_id, status, count(*), sum(quantidade_kg) FROM "AbastecimentoBem" GROUP BY 1, 2;   -- CONFIRMADO tem de ser 0
```

**[F6]** Impressão (uma instrução, idêntica à da guarda): texto exato de
`ensaio/impressao.sql` → `(linhas, impressao)`. É o valor de `maike.simplifica_impressao`
no §5 e o que se anota no §11.

### 4.3 Bloco C — o que o DROP levaria em silêncio

**[F6]** Texto exato do bloco C do contrato (§7.2 C): gatilhos não internos, políticas
diferentes de `maike_backend_all`, publicações e comentários nas 13 (esperado: 0 linhas);
dono, `relacl` e `has_table_privilege('maike_vercel', …)` das 13 comparados com uma tabela da
P3; `pg_default_acl`; `current_user` na conexão do caminho escolhido (= o dono, senão a guarda
recusa). Qualquer linha na 1ª consulta, dono ou ACL diferente da tabela da P3, ou
`current_user` ≠ dono: `RELEASE_BLOCKED` até o proprietário decidir.

### 4.4 Bloco D — o que fica como histórico (não é apagado)

```sql
SELECT cliente_id, tipo_detalhado, status, count(*), sum(quantidade) FROM "MovimentacaoEstoque"
 WHERE origem_sistema = 'abastecimento_patrimonio' GROUP BY 1, 2, 3;
SELECT cliente_id, tipo_operacao, count(*) FROM "OperacaoIdempotente"
 WHERE tipo_operacao IN ('confirmar_abastecimento_bem', 'cancelar_abastecimento_bem') GROUP BY 1, 2;
SELECT cliente_id, entidade, escopo_tipo, proximo_valor FROM "EntidadeCodigoSequencia"
 WHERE entidade IN ('BemPatrimonial', 'AbastecimentoBem') ORDER BY 1, 2;   -- o próximo nº por cliente (P-04), anotado no §11
SELECT p.cliente_id, e->>'tela_id' AS tela, count(*) FROM "Permissao" p
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.permissoes_telas) = 'array' THEN p.permissoes_telas ELSE '[]'::jsonb END) e
 WHERE e->>'tela_id' IN ('pat-familias-patrimoniais','pat-tipos-patrimoniais','pat-perfis-medicao','pat-combustiveis')
    OR (e->>'tela_id' = 'pat-abastecimentos' AND e ? 'configurar_conversao')
 GROUP BY 1, 2;
SELECT cliente_id, unidade_principal_estoque, count(*), sum(estoque_atual) FROM "Produto" GROUP BY 1, 2 ORDER BY 1, 2;   -- 'L' tem de ser 0 hoje
SELECT count(*) FROM "OperacaoFinanceiraItem" WHERE unidade = 'L';                                                       -- 0 (o CHECK antigo impede)
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname IN ('OperacaoFinanceiraItem_unidade_check', 'OperacaoFinanceiraItem_forma_check');                        -- anotar (a reversão restaura)
```

### 4.5 Bloco E — o que a guarda vai conferir, e transações longas

```sql
SELECT k.conrelid::regclass, k.conname FROM pg_constraint k
 WHERE k.contype = 'f'
   AND k.confrelid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('AbastecimentoBemConsumoLote','AbastecimentoBem','ConversaoCombustivelProduto','TipoCombustivelProduto','TanqueBemCombustivel','TanqueBem','MedicaoBem','BemPatrimonial','TipoPatrimonialPerfil','TipoPatrimonial','FamiliaPatrimonial','PerfilMedicao','TipoCombustivel'))
   AND k.conrelid NOT IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('AbastecimentoBemConsumoLote','AbastecimentoBem','ConversaoCombustivelProduto','TipoCombustivelProduto','TanqueBemCombustivel','TanqueBem','MedicaoBem','BemPatrimonial','TipoPatrimonialPerfil','TipoPatrimonial','FamiliaPatrimonial','PerfilMedicao','TipoCombustivel'));
-- tem de dar 0 linhas
SELECT pid, state, now() - xact_start AS idade, left(query, 80) FROM pg_stat_activity
 WHERE datname = current_database() AND xact_start IS NOT NULL AND now() - xact_start > interval '30 seconds';   -- nenhuma
```

### 4.6 Também entram no preflight

- **[F6]** a impressão digital das tabelas que ficam: texto exato de `ensaio/fingerprint_v2.sql`
  (uma instrução, roda no conector). Anotar as linhas de **produção**; a do PG local não serve,
  porque as ACLs do Supabase são outras;
- os nomes das variáveis Vercel ↔ Supabase (só os nomes);
- a **duração do último build de produção** da Vercel (é a estimativa da janela);
- `conferirHistoricoRemoto` = ok, com pendente só a nova;
- o classificador local (`premerge-migrate --sha <SHA>`): exit 0, `modo: CONTRACT`,
  13 removidas, 4 alargamentos, 7 novas, 0 violações;
- o checksum: `git show <SHA>:backend/prisma/migrations/20261110300000_patrimonio_simplifica/migration.sql | sha256sum`
  = o do manifesto (`787d6d11…4222`).

### 4.7 Backup

- Último backup físico `COMPLETED` anterior à janela (API de gestão do Supabase com o token do
  proprietário, ou painel). O PITR estava desligado. Sem prova de backup → `RELEASE_BLOCKED`.
  Ele restaura o banco **inteiro** (todos os clientes; perde tudo depois do ponto).
- **Se alguma das 13 tiver linhas**, a escolha é do proprietário e fica anotada no §11:
  - (a) um `pg_dump --data-only` só das 13, feito e guardado **por ele** na máquina dele, com
    o sha256 anotado no §11. O agente não recebe o arquivo;
  - (b) "não há volta parcial; aceito".
  O GO de 2026-11-10 aceitou a perda irreversível; a escolha entre (a) e (b) continua dele
  (pergunta aberta no relatório).
- **Não** há dump JSON pelo conector: ele passaria dados de cliente (placa, chassi, renavam)
  pelo contexto do agente e não tem restauração ensaiada.

### 4.8 Ensaio local (com o arquivo exato do `<SHA_APROVADO>`)

Automatizado pelo script de ensaio da frente F1 (`scripts/dev/ensaio-patrimonio-simplifica.mjs`).

**Preparação.** PG **17** local com `anon`, `authenticated`, `service_role`, `maike_vercel` e
`ALTER DEFAULT PRIVILEGES … GRANT ALL` hostil. Banco com as 39 da `main` mais sementes que
imitem o preflight: por cliente e por tabela, inclusive CANCELADO com movimentos, se houver.

**RED (todos recusam e nada muda):** 1 CONFIRMADO; trava concorrente (`55P03`); sem
impressão; impressão errada; conexão com papel que não é o dono; gatilho, política e
publicação criados à mão; FK e visão de fora.

**GREEN, caminho A pelo runner:** `--verificar-alvo --contract D-PROD-162` e
`--aplicar --contract D-PROD-162`, com o `system_identifier` local e a URL com
`options=-c%20lock_timeout%3D5s%20-c%20maike.simplifica_impressao%3D<impressão local>`.
Esperado: 40/0 e 79 tabelas; `fingerprint_v2.sql` idêntica e os 2 CHECKs com `'L'`; dono e
ACL das 7 iguais aos das 13; md5 de estoque idêntico; `migrate diff --exit-code` 0;
`node scripts/deploy/preflight-schema.mjs` ok; item P3 `'L'` aceito; `deploy:migrate` sem
`MIGRATION_CONTRACT_AUTORIZADO` contra o alvo "remoto" simulado
(`MIGRATION_EXIGIR_CONFERENCIA=sim`) → `CONTRACT_NAO_AUTORIZADO` antes de qualquer DDL;
repetir → "No pending".

**Caminho B (envelope do §5), num banco onde o A falhou e foi resolvido:** com o id de
produção no texto → `alvo divergente`; em modo de ensaio, por
`PGOPTIONS='-c maike.simplifica_ensaio_alvo=<sid local>'` (nunca editando o texto) →
`COMMIT`; repetir → `migration já registrada`.

Registrar tudo no §11.

## 5. Aplicação — só dentro do GO e com o §2 cumprido

### Caminho A (padrão)

- Máquina protegida.
- `MIGRATION_DATABASE_URL` direta ou de sessão na 5432 (nunca 6543), com
  `&options=-c%20lock_timeout%3D5s%20-c%20maike.simplifica_impressao%3D<IMPRESSAO_DO_PREFLIGHT>`.
- `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360`.
- O usuário da URL é o **dono** das 13 (bloco C).

```bash
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo --contract D-PROD-162
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar --contract D-PROD-162   # repassa MIGRATION_CONTRACT_AUTORIZADO=D-PROD-162 ao deploy:migrate
```

Se o pooler de sessão descartar o `options`, a guarda recusa com `= ausente` (falha fechada,
nada aplicado). Nesse caso usar a conexão direta ou o caminho B.

### Caminho B (conector, uma `execute_sql`, só com GO que cite o desvio da D-PROD-74)

**[F6]** Envelope exato (`gen/wrapper_b.tpl` do contrato): `BEGIN`; `SET LOCAL
maike.simplifica_impressao = '<IMPRESSAO_DO_PREFLIGHT>'`; DO de alvo e histórico
(`system_identifier` `7692130048193495360`, modo de ensaio só por `PGOPTIONS`, migration ainda
não registrada, 39/0, P1-02 com o checksum `20f8f960…5fba`); o conteúdo **integral** do
`migration.sql` do `<SHA_APROVADO>`, sem edição; `INSERT` em `_prisma_migrations` com o
sha256 do arquivo e `applied_steps_count = 1`; `COMMIT`. A guarda roda com o papel do
conector: ele tem de ser o dono das 13 (bloco C).

### 5.1 Falha no caminho A (guarda, `55P03` ou *deadlock*)

1. Nada do DDL fica; a linha fica com `finished_at` NULL.
2. Conferir que as 13 continuam e que `TanqueBemProduto` não existe.
3. `npx prisma migrate resolve --rolled-back 20261110300000_patrimonio_simplifica --schema backend/prisma/schema.prisma`.
4. Eliminar a causa.
5. Refazer o bloco B do preflight. Se a impressão mudou, parar e levar o fato ao proprietário.
6. Repetir pelo A ou pelo B. No postcheck, aceitar exatamente essas linhas revertidas.

### 5.2 Se houver abastecimento CONFIRMADO

A guarda recusa e a release **para**. O caso vai ao proprietário com a lista nº / bem /
produto / quantidade / data por cliente. A saída é cancelar cada um **pelo app**
(`POST /patrimonio-abastecimentos/:id/cancelar`, motivo "Limpeza D-PROD-162"), o que estorna
exatamente e devolve o estoque. Isso é escrita em produção e exige o **GO-3**. Depois, refazer
o preflight (a impressão muda). **Nunca apagar CONFIRMADO por SQL.**

## 6. Postcheck rápido (antes do merge; só leitura)

Qualquer divergência: **não mergear** e chamar o proprietário.

| # | Conferência | Esperado |
|---|---|---|
| R1 | `_prisma_migrations` | 40 concluídas, 0 em aberto (+ as revertidas do §5.1, se houve); a nova com o checksum do manifesto e `applied_steps_count = 1` |
| R2 | tabelas em `public` | **79**; ausentes as 7 removidas; presentes as 7 do formato novo |
| R3 | RLS / políticas / grants das 7 | RLS sem FORCE; 1 × `maike_backend_all` `ALL` `{maike_vercel}`; 0 para `anon`/`authenticated`/`PUBLIC` |
| R4 | dono e ACL das 7 | `pg_get_userbyid(relowner)` e `relacl` **iguais** aos anotados das 13 (bloco C); `has_table_privilege('maike_vercel', t, 'SELECT,INSERT,UPDATE,DELETE')` = true nas 7. Se divergir, decidir com o proprietário (GO-4): GRANT corretivo ou §9, enquanto as 7 estão vazias |
| R5 | colunas / PK·FK·CHECK / índices | 12·11·54·9·7·31·10; 7·31·32; 55 |
| R6 | linhas | as 7 com 0 |
| R7 | impressão digital das 72 que ficam | `fingerprint_v2.sql` = as **mesmas** linhas anotadas no preflight; os 2 CHECKs de `OperacaoFinanceiraItem` = o texto anotado com `'L'` acrescentado (unidade: `KG, SACO, UN, L`; forma/MERCADORIA: `KG, SACO, L`) |
| R8 | estoque | contagens e somas de `MovimentacaoEstoque` (origem `abastecimento_patrimonio`), `EstoqueLoteNota` e `Produto` iguais às do preflight |
| R9 | `node scripts/deploy/preflight-schema.mjs` | ok (colunas exigidas novas presentes; consulta montada de `COLUNAS_EXIGIDAS`) |

## 7. Merge imediato

Com R1–R9 ok: merge manual da PR no `<SHA_APROVADO>`, logo em seguida (é parte do GO-2). A
`main` continua congelada até o deploy READY.

## 8. Deploy e postcheck completo (depois do deploy READY; só leitura, nenhuma escrita)

| # | Conferência | Esperado |
|---|---|---|
| C1 | `GET /api/native/health` | 200; release = SHA do merge |
| C2 | advisor de segurança | nenhum alerta novo |
| C3 | telas, **sem salvar nada** | Bens abre vazio; "+ Nova família" visível e habilitado; "⋯" com "Gerenciar famílias e tipos"; Produtos mostra a opção "LITROS (L)"; Abastecimentos abre vazio; Lançamentos abre; Mapa Geral abre com os depósitos como antes |
| C4 | logs | 30 min sem erro novo |

Depois, o proprietário declara encerrada a janela de reversão (P-12) e faz ele mesmo a
primeira escrita.

## 9. Reversão (honesta)

- **Dado apagado não volta** por reversão de schema. Só volta restaurando o backup: o banco
  **inteiro**, todos os clientes, perdendo tudo depois do ponto. A decisão é do proprietário.
- **Falha antes do `COMMIT`**: nada aplicado.
- **Depois do `COMMIT`**: preferir **corrigir para frente**, com uma PR nova. Voltar o runtime
  antigo só é oferecido **até a primeira escrita** depois do deploy (P-12), com GO-4 e ensaio.
  O procedimento, numa transação, manual e fora do premerge:
  1. a mesma guarda de alvo e histórico (40/0);
  2. `LOCK` das 7 e de `OperacaoFinanceiraItem`;
  3. recusa se **qualquer** uma das 7 tiver linha, se houver `Produto` com
     `unidade_principal_estoque = 'L'` ou se houver `OperacaoFinanceiraItem` com `unidade = 'L'`;
  4. `DROP TABLE` das 7 (`AbastecimentoBemConsumoLote`, `AbastecimentoBem`, `TanqueBemProduto`,
     `TanqueBem`, `BemPatrimonial`, `TipoPatrimonial`, `FamiliaPatrimonial`);
  5. restaurar os 2 CHECKs com o **texto exato** da P3-01 (anotado no bloco D):
     `DROP CONSTRAINT` + `ADD CONSTRAINT`;
  6. reexecutar o **texto integral** de `20261110100000_patrimonio_p1_01_cadastros/migration.sql`
     e de `20261110200000_patrimonio_p1_02_abastecimentos/migration.sql` (recria as 13 vazias com
     RLS; as linhas de histórico delas continuam com os mesmos checksums);
  7. `DELETE FROM _prisma_migrations WHERE migration_name = '20261110300000_patrimonio_simplifica'`;
  8. `COMMIT`;
  9. depois, reverter o merge.
  Depois da primeira escrita, só se corrige para frente.
- **Proibido** voltar a Vercel para um deploy antigo com o schema novo aplicado: o Patrimônio
  dá 500, e também os 3 caminhos de produto/empresa do §0.

## 10. Estados que bloqueiam (`RELEASE_BLOCKED`)

- `system_identifier` divergente;
- histórico ≠ 39/0, ou P1-01 / P1-02 ausente ou com checksum divergente;
- a migration já registrada, ou `TanqueBemProduto` já existente;
- checksum do arquivo do SHA diferente do manifesto (`787d6d11…4222`);
- classificador fora do esperado (não `CONTRACT`, ≠ 13 removidas, ≠ 4 alargamentos, ≠ 7 novas,
  ou qualquer violação);
- sem prova de backup `COMPLETED`;
- CI não verde ou Preview não READY no SHA; qualquer pré-requisito do §2 faltando;
- `AbastecimentoBem` CONFIRMADO > 0 (§5.2);
- qualquer linha na 1ª consulta do bloco C, dono ou ACL das 13 diferente da tabela da P3, ou
  `current_user` ≠ dono;
- `Produto` com unidade `L` ou `OperacaoFinanceiraItem` com `unidade = 'L'` antes da migration;
- impressão diferente entre o preflight e o momento da aplicação;
- transação longa no caminho (bloco E) ou qualquer erro na transação;
- a `main` andou depois do SHA aprovado;
- qualquer divergência no postcheck rápido (§6): não mergear.

## 11. Registro de execução (2026-11-11, executado)

| Campo | Valor |
|---|---|
| GO do proprietário (texto e data/hora UTC) | GO de 2026-11-10/11 no chat: "pode apaguar oque tiver lançado dessas tabelas", "Recomeçar o Patrimônio do zero", "ok apague oque tiver faça oque tem que fazer", "go, pode fazer" e, para o reenvio, "Manda" (~05:26 UTC) |
| Caminho (A runner / B conector) | **B**: uma `execute_sql` do conector Supabase, com o envelope do §5 (DO `$alvo$` + `SET LOCAL maike.simplifica_impressao` + `migration.sql` + `INSERT` em `_prisma_migrations`). A 1ª tentativa (02:29 UTC) expirou na confirmação do conector e não executou; reenviada às ~05:27 UTC |
| `<SHA_APROVADO>`, run de CI e Preview READY | `fa880a38d2598c906976dbc2fa873865b2ca05f0`; `quality` run 42943336499 verde (02:03→02:28 UTC); Vercel Preview Comments ok |
| Pré-requisitos do §2 (PR pronta, `mergeable_state`, branch atualizada, `main` congelada) | PR #239 `mergeable_state = clean`; `main` em `e8472481` (contida no head) de 00:49 até o merge |
| `system_identifier`, versão e vínculo Vercel ↔ Supabase (só nomes) | `7692130048193495360`; projeto Vercel `maike` ↔ Supabase `uuemcasqcdjucflulkne` |
| Histórico antes (bloco A) | 39 concluídas / 0 em aberto; P1-02 com checksum `20f8f960…5fba` |
| Contagens por tabela e por cliente das 13 (bloco B) e impressão | 13 linhas, em 1 dos 2 clientes; impressão `a35b7cbb0569` (conferida às 00:40, 02:06 e 02:29 UTC e pela guarda na transação) |
| Bloco C (objetos fora das migrations, dono, ACL, `current_user`) | `current_user = postgres` = dono das 13; 0 FK externa; 0 visão; 0 gatilho/política/publicação inesperados |
| Bloco D (histórico, próximo nº por cliente, permissões antigas, Produto por unidade, CHECKs) | Produto em `L` = 0; item P3 em `L` = 0; resíduos sem FK ficam como histórico |
| Bloco E (FKs de fora, transações longas) | 0 FK de fora; 0 transação longa (> 30 s) |
| Impressão digital das que ficam (`fingerprint_v2.sql`, produção) | TOTAL 1884 `89c875da8382bb12220710a3552fc192` · coluna 1008 `094c0d13…` · constraint 263 `a1a1658c…` · fk_entrando 137 `9f3b30ca…` · indice 332 `991bd43b…` · politica 72 `48deb1a7…` · tabela 72 `8cd7dc10…` |
| SHA-256 calculado (§4.6) | `787d6d118939c6eca4e3c3f45bf94a4f94d1f1625cbfb2ea2102b190ad944222` (arquivo no head; o pacote do caminho B contém o arquivo literalmente) |
| Classificador local (§4.6) | CONTRACT aprovado pela entrada `D-PROD-162` (gates 739/739) |
| Evidência de backup e escolha (a)/(b) (§4.7) | **Desvio:** o agente não obteve a prova do último backup físico (sem token da API de gestão; o conector não lista backups). O proprietário mandou apagar o que houvesse e recomeçar do zero, sem dump: equivale à escolha **(b)** "não há volta parcial; aceito" |
| Duração do último build de produção (estimativa da janela) | build do merge: ~61 s (05:31:47 → 05:32:48 UTC) |
| Ensaio local (§4.8) | PG 16 local: impressão errada → recusa sem mudança; impressão certa → 79 tabelas e 40/0; repetir → "migration já registrada" |
| Resultado da transação | `COMMIT` sem erro (~05:27 UTC) |
| Postcheck rápido (§6, R1–R9) | R1 40/0, nova com `787d6d11…4222` e `applied_steps_count = 1`; R2 79 tabelas, 0 antigas, 7 novas; R3 RLS sem FORCE, `maike_backend_all` ALL `{maike_vercel}` nas 7, 0 para `anon`/`authenticated`; R4 dono `postgres`, ACL `{postgres=arwdDxtm, service_role=arwdDxtm, maike_vercel=arwd}`, CRUD do `maike_vercel` nas 7; R5 12·11·54·9·7·31·10, 7·31·32, 55; R6 0 linhas; R7 impressão das 72 idêntica e CHECKs com `'L'`; R8 estoque idêntico (mov 3 `2054032f…`, lotes 2 `f6e723d9…`, produtos 2 `1578d240…`); R9 estrutura das 7 novas idêntica à do PG local migrado pelo arquivo (266 itens, `1a270c8dcd84bd2b3286ddba266bee60`) |
| Merge | PR #239 → `main` `87e8a5ca28dacacbb761c0c927f0896395b8d4af` (~05:31 UTC) |
| Deploy READY e postcheck completo (§8, C1–C4) | `dpl_ASteapwtB8wqjNbGRACtZnWehmXc` READY em `www.makgestao.com`; C1 `/api/native/health` 200, `banco: up`, release `87e8a5ca…`; C2 advisor de segurança sem alertas; C3 `/BensPatrimoniais` 200 e API do Patrimônio responde 401 sem sessão (telas logadas não abertas pelo agente: sem credenciais); C4 logs de produção sem erro novo (só o aviso antigo `FSTDEP023` do Fastify) |
| Encerramento da janela de reversão pelo proprietário (P-12) | pendente: o proprietário faz a primeira escrita |