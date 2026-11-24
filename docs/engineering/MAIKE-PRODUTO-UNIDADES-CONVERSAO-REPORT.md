# MAIKE — Produto: unidades de conversão — relatório (D-PROD-288)

Decisão: [D-PROD-288](./DECISIONS.md) · SPEC: [`MAIKE-PRODUTO-UNIDADES-CONVERSAO-SPEC.md`](./MAIKE-PRODUTO-UNIDADES-CONVERSAO-SPEC.md) ·
Runbook: [`MAIKE-PRODUTO-UNIDADES-CONVERSAO-RUNBOOK-RELEASE.md`](./MAIKE-PRODUTO-UNIDADES-CONVERSAO-RUNBOOK-RELEASE.md)

Branch `claude/produto-unidades-conversao`, criada da `main` `4e9b4445` e integrada por merge (sem rebase) com a `main`
das PRs #370/#371 (`19ca524e`…) e da #372. A decisão nasceu D-PROD-284 e foi renumerada duas vezes pelo
`proxima-decisao.mjs` (a #371 levou a 284; a #372 levou a 285): é a **D-PROD-288**, marcador D-PROD-287.

## 1. O que foi feito

- **Modelo:** `ProdutoUnidadeConversao` (sigla até 8, MULTIPLICA|DIVIDE, fator > 0 com DIVIDE ≤ 10.000, `uso_compra` e
  `uso_venda` com CHECK de um dos dois, `codigo_barras`, `ativa`, `ordem`, `excluido_em`), tenant-first, FK composta
  para o produto, único parcial (`cliente_id`, `produto_id`, `sigla`) entre as não excluídas, RLS. KG, L e UN nunca são
  conversão (CHECK) e a unidade de estoque também não (serviço + teste).
- **Motor da conversão** (`backend/src/modules/produtos/produtoUnidadesConversao.js`): conta exata em 4 casas, fator
  efetivo gravado em `fator_kg`, custo por unidade de estoque na entrada, recusas `unidade_inativa`, `unidade_sem_uso`,
  `unidade_nao_cadastrada`, `unidade_incompativel` (KG ↔ L continua proibido).
- **Cadastro:** `unidades_conversao` no POST/PATCH `/produtos` (substitui a lista; usada → desativa; não usada →
  exclusão lógica; sigla usada não muda); GET com `unidade_estoque` e `unidades_conversao` (com a equivalência).
  Preço de custo, preço de venda, local e código interno ignorados no corpo; código interno = `numero_produto`.
- **Lançamentos:** entrada documentada (uso compra), saída manual (uso saída), ajuste (qualquer ativa), compra (PAGAR)
  e venda (RECEBER) do financeiro. Na retificação do financeiro, a linha numa unidade de conversão mantém o fator gravado.
  O SACO sem conversão segue o caminho antigo (o hash U1 do plano do financeiro continua o mesmo).
- **Formulação:** `consumo_minimo_pv`/`consumo_maximo_pv` (API e tela), copiados do produto pela migration.
- **Telas:** aba "Unidades" no produto (lista + prévia "1 SACO = 25 KG"); sem preços, local, consumo e peso por saco;
  código interno e estoque atual só leitura; KG/L (SACO só no legado). Entrada/saída/ajuste e financeiro com as
  conversões no seletor e "10 SACO = 250 kg". Formulações com %PV mínimo e máximo. Layout em cartões/células com
  quebra em 12 colunas (390 px: `col-span-6`/`col-span-12`); não houve conferência visual em navegador.

## 2. Migration

| Item | Valor |
|---|---|
| Nome | `20261125200000_produto_unidades_conversao` (renomeada de `20261124300000_…` no merge, para vir depois de `20261125100000_insumo_por_jato`) |
| Natureza | CONTRACT condicionado, formato CONVERSÃO sem DROP (`--contract D-PROD-288`) |
| sha256 | `779347bf9780ecb391dc76e64048601e6adcad449b5b868a44811def12be863b` (o nome e o número da decisão não estão no arquivo) |
| Guarda | `86df7d20db22e4ae2596dba4c29788fa60537d41e6e4cfa35d68171266fd0ff8` |
| RLS | `6518df2877f62ef12dac0f111dbe514254272d7086e8c3d252be96fd66a683af` |
| DML | só a cauda pinada: `INSERT … SELECT` (SACO multiplica pelo peso, produtos não-L) e `UPDATE` do consumo da formulação |
| Produção | **não aplicada** (o coordenador aplica) |

**Envelope:** `/tmp/claude-0/-home-user-MAIKE/27578f93-c0bb-5a9e-bc93-81a4694dbf4f/scratchpad/aplicar-unidades-conversao.sql`,
sha256 `c81690992d80636310eb7bb04177fb39e7eaedfed4f33b5a7f205d65be8241aa`; o trecho entre os marcadores tem o sha256 da
migration. Espera 78 concluídas e 0 com falha, anterior `20261125100000_insumo_por_jato` com checksum
`725a8c5ac873ad19d0c191cd7c2f303dc84ef97170b74c0bb2133479c76d3551`, `system_identifier` 7692130048193495360.

## 5. Ensaio local

Postgres 17 (5433), banco `maike_unid_ens`: `migrate deploy` com as 78 pastas anteriores; semeados 1 cliente, 1 empresa,
produtos SACO com peso 25 e consumo 0,05/0,2, um de litros com peso 5, e uma formulação. Envelope de produção →
`RELEASE_BLOCKED: alvo divergente`; a cópia com **só o `system_identifier` trocado** aplicou: 79 concluídas, 112
tabelas, 1 conversão (`p1:SACO:25`, o de litros fora), formulação `0.05/0.20`, RLS ativo, `prisma migrate diff`
"No difference detected". Segunda execução → `RELEASE_BLOCKED: migration já registrada`.

## 6. Números

- **Rodada única de backend** (banco `maike_unid` novo com `migrate deploy`, depois do 1º merge): `estoque*`, `produto*`
  (inclui o novo `produtoUnidadesConversao`), `gestaoP3*`, `suplementacao*`, `atividade*` (inclui os de migration),
  `patrimonioP1Abastec*`, `formulacao*`, `depositoCancelar*`, `motorEstornoCochoTransferencia`, `insumoPorJato` e
  `scripts/tests/deploy/*`: **1570 testes, 1565 pass, 0 fail, 5 todo**.
- Deploy (`scripts/tests/deploy`): 356/356. Smoke: 4121 testes; os 13 que fixavam os campos removidos foram atualizados
  e passam (47/47 nos 5 arquivos); smoke novo `produtoUnidadesConversao` 5/5. Gate tests 1084/1084. eslint: 0 erros
  (2 avisos antigos). `typecheck:backend` limpo. `typecheck`: 374 (= base). Gates: product-scope, import-integrity,
  no-secrets, base44, tenancy, indices, deploy-migrations, supabase-public-grants, modelobase1-pecuario OK.
- `verify:all`: ver §9.

## 7. Fora do escopo

Conversão na linha de produto da atividade, no abastecimento, no cocho e na transferência (a Constituição manda baixar
"exatamente a quantidade digitada, na unidade de estoque"; emenda **proposta** na SPEC §7, não aplicada); UN como
unidade de estoque; cocho e farol ainda leem o consumo do produto (legado).

## 8. Dúvidas e observações

1. **Teste vermelho antes do verde:** os testes novos foram escritos junto com o código, não antes; não houve um commit
   só com o teste vermelho.
2. **DML além do peso por saco:** a cópia do consumo para a Formulação também é DML (pedida no item 3), além da do saco.
3. **DIVIDE:** `fator_kg` guarda 1/fator em 4 casas (÷3 → 0,3333); a quantidade de estoque vem da conta exata. Por isso
   o DIVIDE está limitado a 10.000.
4. **Respostas 422** (não 400) para unidade inativa/sem uso/incompatível nas origens de estoque, pelo padrão de erro delas.
5. **Ambiente:** o `node_modules` desta worktree era um link para o de `/home/user/MAIKE`, onde outra sessão regenerava o
   Prisma Client no meio da rodada (45 falhas falsas). Troquei o link por um diretório local com links por pacote e uma
   cópia de `@prisma/client`, para o client gerado ser só desta worktree. Nenhum `npm install`.

## 9. verify:all

Preenchido no fim da missão (ver o relatório de entrega da PR).
