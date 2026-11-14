# MAIKE-APONTAMENTO-ITENS — Relatório (Fatia D do apontamento)

**fatia D · `feat/apontamento-itens` · PR #274 (rascunho)** · Decisão: [D-PROD-193](./DECISIONS.md)

Contrato do arquiteto: [`MAIKE-APONTAMENTO-ITENS-CONTRATO.md`](./MAIKE-APONTAMENTO-ITENS-CONTRATO.md). Branch empilhada sobre `feat/apontamento-atividade` (PR #269, D-PROD-190, migration `20261113700000_apontamento_atividade` já aplicada em produção) e atualizada por merge com ela em `be322ab8`, que já traz a `main` `00a06096` (PRs #263, #267, #268 e #270).

## 1. Entrega

O apontamento de atividade confirmado passa a receber **itens de custo**. O item **PRODUTO** (ex.: herbicida aplicado numa roçada) baixa o estoque como o abastecimento: escolhe produto e local, sai pelo motor único (FIFO por lote), o custo vem do lote real e cancelar estorna exato. Os itens **SERVIÇO** e **OUTRO** (ex.: mão de obra terceirizada, frete) têm descrição livre, quantidade, valor unitário e total calculado, sem cadastro de serviço e sem efeito de estoque.

| Camada | O que entrou |
|---|---|
| Banco | models `ApontamentoAtividadeItem` e `ApontamentoAtividadeItemConsumoLote` (fatias FIFO por lote), FKs compostas por `cliente_id` todas `RESTRICT`, uniques e índices começando por `cliente_id`, 7 CHECKs; relações inversas só no Prisma. Migration EXPAND `20261113800000_apontamento_atividade_item` com RLS/REVOKE. **Aplicada em produção em 2026-11-14 12:51:06 UTC, antes do merge** (§7) |
| Release | manifesto (sha256 `866dc994…533c`) e hash do DO (`7aaa176c…f710`) pinados no `premergeMigrateLib.mjs`; B17a/B17b no `premerge-migrate`; SQL editor 01–04 (70 tabelas de tenant, 85 no total, as 2 novas antes do `ApontamentoAtividade` na ordem de exclusão e no `LOCK TABLE`); testes e ensaios das três CONTRACT (D-PROD-162, D-PROD-183 e D-PROD-187) contando as migrations pela pasta; S8 |
| Backend | A1 adicionar item, A2 cancelar item, A3 cancelar apontamento com itens (`operation_id` obrigatório), A4 detalhe com `itens` e `custo_itens`, A6 opções de produto, A7 locais com saldo; origem nova `apontamento_atividade` no motor; reconciliação e guarda do lote (X1) conhecendo as fatias; 6 erros novos |
| Frontend | seção "Itens" no formulário existente (4 estados), rascunho de um item por vez, cancelar item, detalhe no lugar da linha da lista, idempotência no cliente com pendência por escopo, mensagens dos códigos novos. Só componentes existentes; nenhum `.jsx` nem CSS novo |
| Testes | `apontamentoAtividadeItensNativo` (21) e `apontamentoAtividadeItensConcorrencia` (7) em Postgres real; `apontamentoAtividadeNativo` e `permissoesR2Rotas` ajustados; `premerge-migrate` B1/B17a/B17b (e o B15k da D-PROD-187 com as pastas do dia da CONTRACT); `sqlEditorBootstrap` com itens na semente; S8 e testes de contagem; smoke `apontamentosAtividade.test.jsx` (41) |
| Documentos | D-PROD-193 com as palavras do proprietário; este relatório; `CURRENT-STATE`; texto constitucional proposto no `00 §1` e no `07` (vale só com a aprovação do proprietário no merge manual) |

## 2. Como foi feito

1. **D1, schema e migration**, sozinha primeiro: fixa os campos. O DDL saiu do `prisma migrate diff` sobre um banco já migrado (igual ao esboço do contrato); os CHECKs e o DO entraram à mão, o DO copiado da migration da Fatia C trocando só a lista. `migrate diff` vazio nos dois sentidos.
2. **Construção em paralelo**, cada frente com arquivos exclusivos (§8 do contrato):
   - **D2 backend:** rotas no plugin existente, serviço novo dos itens, estorno compartilhado entre A2 e A3, origem nova no motor (só as 3 linhas permitidas), reconciliação, X1, erros;
   - **D3 frontend:** porta, API, serviço, regras puras, formulário e página;
   - **D4 testes de backend:** escritos contra o contrato, não contra a implementação; ajuste dos testes que mudaram por D-2 e pelo detalhe com itens;
   - **D5 (por último):** portão de migrations, SQL editor, contagens, ensaios e documentos.
3. **Mutações** (D4): cada mutação do contrato aplicada numa cópia espelhada do backend, fora do repositório, e desfeita; o código das outras frentes conferido por sha256 antes e depois.
4. **Contagens recalculadas do estado real**, depois do merge da base nova: 48 pastas de migration e um banco recém-migrado (`maike_dm`, limpo): 48 concluídas e 0 com falha, **85** tabelas em `public` (contando `_prisma_migrations`), `cliente_id` em 71 (as **70** de tenant + `OperadorProdutoMaike`), `prisma validate` ok e `migrate diff` vazio nos dois sentidos.
5. **Merge da base nova (2026-11-14).** `git merge origin/feat/apontamento-atividade` (`be322ab8`), sem rebase. A `main` ainda não tinha a PR #269. Conflitos só em testes, scripts e documentos; nenhum nos arquivos de código da Fatia D. Como cada um foi resolvido:
   - testes e ensaios das CONTRACT (`patrimonioSimplificaMigration`, `tipoTarefaDropColunasMigration` e os ensaios deles): ficou a contagem pela pasta da base (`TOTAL_MIGRATIONS`, `MIGRATIONS_PARTIDA`), com a migration desta fatia em `MIGRATIONS_DEPOIS_DO_CONTRACT` no ensaio da D-PROD-162 (a partida passa a `TOTAL_MIGRATIONS - 3`) e o GREEN com **85** tabelas;
   - SQL editor 01, 02 e 04 e `sqlEditorBootstrap`: as listas da base (com `CADCATEGORIA` e `CADCURVAGANHO`) com as 2 tabelas novas antes do `ApontamentoAtividade`, inclusive no `LOCK TABLE`; contagens 85 e 70;
   - `premerge-migrate.test.mjs`: o B1 com as listas das duas; os testes desta fatia, que se chamavam B15a/B15b, viraram **B17a/B17b** (a base já usa B15a–B15k na D-PROD-187 e B16 em `migrations.test.mjs`);
   - `DECISIONS.md` e `CURRENT-STATE.md`: as entradas da base mantidas e as desta fatia acrescentadas, com a numeração nova.

   Testes da base que passaram a falhar só por causa da migration nova (de nome posterior às da base), ajustados sem mudar o que provam:
   - `B15k` (D-PROD-187): o retrato de produção no dia da CONTRACT usa só as pastas até a última de nome posterior que já existia (o ApontamentoAtividade);
   - `categoriaManejoCadcategoriaMigration` e o ensaio dele: tabelas 83 → 85, e as de nome posterior à CONTRACT na partida passam a vir da pasta (`NOMES_POSTERIORES_NA_PARTIDA`). Os itens do apontamento sobem nela antes da CONTRACT, pela ordem dos nomes (em produção entram depois; não se tocam, como a P1-03).

## 3. Regras implementadas

| Regra | Comportamento |
|---|---|
| Tipos fechados | `PRODUTO`, `SERVICO`, `OUTRO` (schema e CHECK) |
| Só em CONFIRMADO | apontamento CANCELADO recusa item: 409 `APONTAMENTO_ATIVIDADE_STATUS_INVALIDO`. Conferência: existe → status → `versao` |
| Serialização | adicionar item, cancelar item e cancelar apontamento travam a linha do apontamento (`FOR UPDATE`) antes de ler itens, locais e produtos; o PATCH continua sem trava e perde o CAS se um item entrou |
| CAS | `versao` do apontamento; adicionar e cancelar item incrementam a `versao` uma vez |
| Idempotência | recibo por `operation_id` + fingerprint; replay = 200 com `replay: true` e nenhum efeito novo; mesma chave com conteúdo diferente = 409 `IDEMPOTENCY_CONFLICT`. Antes do INSERT, o lançamento confere se a chave já tem item (mesmo 409): em produção, com RLS, o P2002 do unique chega sem `target` e viraria `CONCURRENCY_CONFLICT`; o unique fica como última rede |
| PRODUTO — cadastro | produto do tenant, da mesma empresa, ativo, unidade efetiva `L` ou `KG` (SACO guarda kg); local existe e está ativo; senão 422 `_ITEM_INVALIDO` por `field`/`reason` |
| PRODUTO — baixa | só `aplicarSaidaFifo`, origem `apontamento_atividade`, na `data_operacional`; quantidade na unidade efetiva, sem conversão; custo FIFO do motor (um arredondamento, 4 casas); fatias gravadas na ordem FIFO; saldo insuficiente = 422 `ESTOQUE_SALDO_INSUFICIENTE`, nada gravado |
| PRODUTO — estorno | `estornarEmLote`: cada fatia volta ao SEU lote, Entrada `estorno_apontamento_atividade` com o mesmo valor, original `Estornada`, `estoque_atual` restaurado, data = hoje da fazenda; conferências antes do motor; recusa = 409 `_ESTORNO_BLOQUEADO`, nada muda |
| SERVICO / OUTRO | descrição 1..255, quantidade > 0, valor unitário ≥ 0; total = `ROUND_HALF_UP(q × vu, 4)` em Decimal no servidor, > 0 e dentro do limite; sem efeito de estoque nem financeiro |
| Imutável | sem PATCH e sem DELETE de item (404 de rota); corrigir = cancelar e lançar de novo |
| Cancelar apontamento | cancela e estorna todos os itens CONFIRMADO na mesma transação (`cancelamento_origem = 'APONTAMENTO'`); uma recusa em qualquer item desfaz tudo |
| Ordem | `MAX(ordem) + 1` sob a trava; nunca reaproveitada; colisão no unique = 409 `CONCURRENCY_CONFLICT` |
| Centro de custo | sem centro no item; vale o centro (snapshot) do cabeçalho (D-4) |
| Tenant | só do `auth_context`; item ou apontamento de outro tenant = 404 com o mesmo corpo do inexistente |
| Sem saldo direto | o serviço não escreve `Produto`, `EstoqueLoteNota` nem `MovimentacaoEstoque`; não altera `preco_custo` |
| Auditoria | `apontamento_atividade.item_adicionar` / `item_cancelar` na mesma transação; o cancelamento do apontamento grava o evento dele + um `item_cancelar` por item; nunca AuditLog de lote ou Produto |
| Lote imutável (X1) | lote consumido por item (confirmado ou cancelado) recusa PATCH/DELETE: 409 `REGISTRO_OPERACIONAL_IMUTAVEL`, `vinculo = 'apontamento_atividade'` |
| Reconciliação | a origem nova está em `ORIGENS_PROTOCOLO` e `ORIGENS_COM_FK`; as fatias dos itens CONFIRMADO entram como consumo do lote e como `soma_fk` do movimento |
| Código antes da migration | a guarda do lote e a reconciliação conferem `to_regclass` antes de citar as tabelas novas (lição do hotfix #259); o módulo do apontamento assume as tabelas (por isso a migration vai antes do deploy) |
| Sem financeiro | nenhum `OperacaoFinanceira`, título, conta a pagar, natureza ou rateio |

## 4. Decisões D-1 a D-9 (interpretação registrada na D-PROD-193; o proprietário revisa na PR)

| # | Ponto | Como ficou |
|---|---|---|
| D-1 | PATCH da data com itens | recusado: mudar `data_operacional` com item PRODUTO CONFIRMADO → 409 `APONTAMENTO_ATIVIDADE_DATA_COM_ITENS`. A tela trava a data na edição, com uma nota |
| D-2 | Cancelar apontamento | `operation_id` **obrigatório** em `POST /:id/cancelar`. Uma aba aberta com a versão antiga recebe 400 até recarregar |
| D-3 | Permissões | adicionar item = `editar|salvar`; cancelar item = `excluir`; opções de produto = `visualizar`; locais com saldo = `editar|salvar`. Nenhuma ação nova; nenhum perfil recebe acesso por padrão |
| D-4 | Centro de custo | sem centro no item; vale o do cabeçalho; trocar o do cabeçalho leva os itens junto |
| D-5 | Prévia de custo | não há; o custo FIFO aparece depois de lançar; a tela mostra o saldo por local |
| D-6 | SERVIÇO × OUTRO | mesmos campos e regras; só o rótulo muda; sem unidade |
| D-7 | Arredondamento | total de SERVIÇO/OUTRO em 4 casas, `ROUND_HALF_UP`; a tela exibe em R$ |
| D-8 | Combustível como item | recusado: produto com aceite de tanque que vale (`TanqueBemProduto` ativo, em tanque ativo de bem ativo: o mesmo critério do `aceiteQueVale`) → 422 `_ITEM_INVALIDO`, `reason: 'combustivel_no_abastecimento'`. Evita dupla contagem com a Fatia E |
| D-9 | Limite | 200 itens por apontamento, contando os cancelados → 422 `APONTAMENTO_ATIVIDADE_ITENS_EXCEDIDOS` |

**Divergência do contrato corrigida no registro:** o resumo do §10 dizia "409 ao exceder" na D-9, mas a tabela de erros do próprio contrato (§3.5) diz 422, e o código, os testes e a tela seguem o 422. A D-PROD-193 registra 422, e o §10 do contrato ganhou uma errata.

## 5. Validação

A verificação de registro desta fatia é o **CI da PR #274**: o `verify:all` completo, dividido em 7 partes (estático, backend 1/4 a 4/4, smoke 1/2 e 2/2).

- **CI da PR #274 (verificação de registro):** commit `ce651a68`, execução `quality` nº 1111 (43547787274). **Todas as partes verdes**, e o job `verify:all` com `success`.
- **Checagens locais de apoio**, no mesmo estado:
  - os gates passaram: governance-paths, product-scope (28 páginas), tenancy (84 models, 70 de tenant), indices, native-api, deploy-migrations, import-integrity, no-secrets, base44 e api-boundary;
  - `typecheck:backend` ok; `lint` com 0 erros;
  - `node --test scripts/tests/deploy/*.test.mjs` 117/117; `test:gates` 829/829;
  - smoke `apontamentosAtividade` + `scope` + `vercelSpaRoutes` 79/79; o `test:smoke` inteiro passou na frente de tela (2712 testes);
  - banco limpo migrado: 48 migrations e 85 tabelas, `migrate diff` vazio;
  - backend da Fatia D (itens nativo, itens concorrência, `apontamentoAtividadeNativo`, `permissoesR2Rotas`) 81/81.
- **Revisão:** 12 revisores independentes, um por lente: FIFO e custo, estorno, cancelamento, concorrência e travas, idempotência, reconciliação, tenancy, regras, migration e portão, tela, documentação e força dos testes.
  - Nenhum defeito grave em estoque, dinheiro, concorrência ou segurança.
  - 13 corridas e deadlocks forçados em Postgres; cancelar 200 itens levou cerca de 0,2 s.
  - Os achados (baixos ou médios: tela, texto e testes que passavam sem provar) foram corrigidos.
- **Mutações das correções:** 27 no backend e 28 no frontend, **todas pegas**. Entre elas:
  - ordem de travas (C6a/C6b);
  - cada item com o seu estorno (IT9/R5);
  - arredondamento único (IT3);
  - estorno no dia da fazenda (IT6b);
  - fingerprints campo a campo (IT7b);
  - D-8 com tanque e bem ativos (IT4e);
  - pré-conferência do `operation_id`, inclusive sob papel não dono com RLS (IT4f/IT4g);
  - na tela: cancelamento antes do detalhe, data travada, botões sem fuso e releitura no replay.

### Provas por mutação (D4, todas pegas)

Cada mutação foi aplicada numa cópia espelhada do backend e desfeita; o repositório nunca foi mutado.

| Mutação | Teste que pegou |
|---|---|
| M1 origem `abastecimento_patrimonio` | IT1 |
| M2 custo = `preco_custo` do Produto | IT1, IT1b |
| M3 arredondar por fatia | IT1b (6,0618 e não 6,0619) |
| M4 sem fatias / ordem das fatias trocada | IT1, IT6, IT12 |
| M5 estorno sem respeitar as fatias gravadas | IT6 |
| M6 estorno na data operacional | IT6, IT9 |
| M7 sem `versao + 1` | IT1, IT5, IT6 |
| M8 cancelar o apontamento sem os itens | IT9, IT9b, C3, R5 |
| M9 cancelamento parcial com um estorno bloqueado | IT9b |
| M10 item em apontamento CANCELADO | IT5 |
| M11 sem conferir empresa/ativo do produto | IT4a |
| M12 sem `travarProdutosEstoque` | C1 |
| M13 `estoque_atual -=` no serviço | IT1 |
| M14 total em `Number` | IT3 |
| M15 origem fora de `ORIGENS_PROTOCOLO`/`ORIGENS_COM_FK`, sem o CTE das fatias ou sem o ramo do `fk` | IT12 |
| M16 sem a contagem do X1 | IT13 |
| M17 CTE das fatias ignorando o status | IT12 |
| Extras: sem D-8, sem D-1, sem `FOR UPDATE` do apontamento, sem o limite de 200 | IT4a/C5, IT5, C3, IT4d |

Também nesta frente (D5): trocar a ordem das 2 tabelas novas no `c_tenant` do 02 faz o `sqlEditorBootstrap` (SE-09) parar com "ordem de FK inválida (ApontamentoAtividadeItemConsumoLote → ApontamentoAtividadeItem)".

## 6. Release (GO separado; migration ANTES do merge)

1. A migration é **EXPAND** pura: só cria as 2 tabelas novas. **Aplicada em produção em 2026-11-14 às 12:51:06 UTC, antes do merge**, com GO separado e específico do proprietário (§7).
2. **Ordem obrigatória: migration → merge → deploy.** O detalhe do apontamento lê a tabela nova; com o código no ar antes da migration, a tela de apontamentos dá 500 (risco R3). Os módulos antigos (guarda do lote e reconciliação) ficam protegidos por `to_regclass`.
3. **Caminho A** (`premerge-migrate --aplicar`, o oficial), se a sessão tiver a URL direta do banco. Ele **só funciona a partir desta branch já com a base nova** (o merge de `be322ab8`): antes dele, produção tinha migrations que a branch não conhecia (a `…300000` da PR #263, a CONTRACT `…500000` da PR #268 e a `…600000` da PR #270), e a conferência do histórico recusava. Senão, **caminho B** (conector Supabase, uma transação com guardas, `migration.sql` íntegro e `INSERT` em `_prisma_migrations` com o checksum pinado), **registrado como desvio da D-PROD-74**, como nas Estações e na Fatia C. No caminho B, a guarda do envelope usa **`n_ok = 47`** e 0 com falha. `apply_migration` nunca.
4. **Preflight esperado em produção** (recontar no dia): `system_identifier` 7692130048193495360; **47** concluídas e 0 com falha (as 47 da base); **83** tabelas em `public`; `to_regclass` nulo para as 2 tabelas novas; as tabelas referenciadas existem (`Cliente`, `ApontamentoAtividade`, `Produto`, `LocalEstoque`, `MovimentacaoEstoque`, `Usuario`, `EstoqueLoteNota`). Depois de aplicar: **48 concluídas e 85 tabelas**, RLS ligado sem FORCE nas 2, política `maike_backend_all` só para `maike_vercel`, `anon`/`authenticated` sem acesso, 11 FKs `RESTRICT`, 7 CHECKs, `get_advisors` sem alerta.
5. **D-2 no deploy:** depois do deploy, uma aba com a versão antiga recebe 400 ao cancelar um apontamento até recarregar a página.
6. **Permissões:** nenhuma ação nova. Quem já tem `editar` na tela `op-apontamentos-atividade` passa a lançar item; quem tem `excluir` passa a cancelar item.
7. **Smoke depois do merge e do deploy (proprietário):** num apontamento CONFIRMADO de teste, lançar um item de Produto (conferir o custo e o saldo do local), um de Serviço e um de Outro custo; cancelar o item de Produto e conferir o saldo de volta; cancelar o apontamento e conferir que os itens ficaram cancelados; tentar lançar um combustível como item e ver a recusa.
8. **Rollback:** as 2 tabelas são novas e nada as referencia. Antes de qualquer item real, reverter é `DROP TABLE "ApontamentoAtividadeItemConsumoLote", "ApontamentoAtividadeItem";` mais a remoção da linha em `_prisma_migrations`, **só com GO próprio** (é CONTRACT). Com itens PRODUTO gravados, o rollback do schema apagaria fatias de movimentos reais: não fazer sem decisão. Se o código já estiver no ar, reverter o código primeiro.
9. **Fila (R4):** a CONTRACT da PR #268 (`20261113500000`) **já está aplicada** em produção, como todas as 47 da base. `20261113800000` não colide com nenhuma. A CONTRACT da PR #273 (`20261114100000_cadcurvaganho_mensal`) exige release isolada: **nunca na mesma release desta**. As contagens (48 migrations, 85 tabelas, 70 de tenant) mudam se outra migration entrar antes: recontar no merge.

## 7. Registro da aplicação em produção

**2026-11-14, caminho B (conector Supabase, uma `execute_sql`, uma transação).**

- **GO:** o proprietário pediu para encerrar as PRs ("A gente precisa encerrar essas prs"). Na pergunta de como seguir, escolheu **"Mergeie a #269 e aplique (Recomendado)"**: "Eu faço o merge da #269 agora e aplico a migration da #274 em produção (caminho B, uma transação, com ensaio antes). Depois ajusto a #274 sobre a main e te chamo só para o merge final dela, que também aprova o texto da constituição." Em seguida escreveu **"Faça a migração e já faça o merge da pr 274"** e, para a confirmação do conector, **"me envie por favor a solicitação"**.
  - Esta sessão não tem a URL direta do banco que o caminho A exige. Por isso a aplicação foi pelo caminho B, **registrado como desvio da D-PROD-74**, como nas Estações e na Fatia C.
  - A primeira tentativa expirou na confirmação do conector, que ficou sem resposta em 60 s. Nada foi aplicado. O preflight foi refeito antes do reenvio.
- **Preflight, só leitura, projeto `uuemcasqcdjucflulkne`:**
  - `system_identifier` 7692130048193495360, banco `postgres`;
  - `_prisma_migrations` com **47** concluídas e 0 com falha; a última é `20261113700000_apontamento_atividade`;
  - `to_regclass` nulo para `ApontamentoAtividadeItem` e `ApontamentoAtividadeItemConsumoLote`; **83** tabelas em `public`;
  - as tabelas referenciadas existem: `Cliente`, `ApontamentoAtividade`, `Produto`, `LocalEstoque`, `MovimentacaoEstoque`, `EstoqueLoteNota` e `Usuario`;
  - nenhuma sessão ativa e nenhuma trava forte nelas.
- **Ensaio local** do mesmo envelope, num banco novo com as 47 migrations da `main` `f4802558`, trocando só o `system_identifier`:
  - a 1ª execução aplicou: 48 no histórico, RLS ligado sem FORCE nas 2 tabelas, 85 tabelas;
  - a 2ª execução parou na guarda (`RELEASE_BLOCKED: migration já registrada`);
  - `prisma migrate status` deu "Database schema is up to date!" e o `migrate diff` contra o `schema.prisma` ficou vazio.
- **Envelope aplicado:**
  1. `BEGIN`; `SET LOCAL lock_timeout = '5s'`; `pg_advisory_xact_lock(72707369)`;
  2. guarda `DO`: alvo 7692130048193495360, migration ainda não registrada, `n_ok = 47` e 0 com falha, as 2 tabelas inexistentes, `ApontamentoAtividade` presente;
  3. o `migration.sql` íntegro (sha256 `866dc9944772afb08ee851dd653d62db73dccfa5e152f611f2205c3eb594533c`);
  4. `INSERT` em `_prisma_migrations` com esse checksum e `applied_steps_count` 1;
  5. `COMMIT`.
- **Conferência, só leitura:**
  - linha `20261113800000_apontamento_atividade_item` com o checksum pinado, 1 passo, `finished_at` **2026-11-14 12:51:06 UTC**;
  - **48** concluídas e 0 com falha;
  - RLS ligado sem FORCE nas 2 tabelas;
  - política `maike_backend_all` só para `maike_vercel` nas 2; `anon` e `authenticated` sem SELECT;
  - 11 FKs, todas `RESTRICT`; 7 CHECKs; 14 índices (12 + 2 pkeys);
  - 0 linhas; **85** tabelas em `public`;
  - `get_advisors` (segurança): nenhum alerta.
- **Depois:** merge da PR #274 (pedido explícito do proprietário, que também aprova o texto constitucional da D-PROD-193), deploy e o smoke da seção 6; rollback como na seção 6.

## 8. Riscos

| # | Risco | Tratamento |
|---|---|---|
| R1 | Cancelamento travado: lote de origem estornado (compra cancelada) ou unidade do Produto mudada impedem o estorno exato | 409 fail-closed, como o abastecimento. O usuário fica sem saída até existir comando de ajuste (fora do escopo) |
| R2 | Baixa retroativa: a saída fica na data operacional (pode ser antiga) e consome os lotes de hoje (FIFO atual) | Como o abastecimento; só data futura é recusada. A razão por data pode mostrar consumo antes da entrada do lote |
| R3 | Ordem de deploy (#259): código antes da migration = 500 na tela | Migration ANTES do merge/deploy, com GO; módulos antigos protegidos por `to_regclass` (teste T14) |
| R4 | Fila de migrations em produção | A CONTRACT da #268 já está aplicada (produção tem as 47 da base); `…800000` não colide. A CONTRACT da PR #273 (`20261114100000_cadcurvaganho_mensal`) vai em release isolada, nunca junto desta; recontar no merge |
| R5 | Transação curta (9 s): cancelar apontamento com muitos itens PRODUTO | O `estornarEmLote` faz um número fixo de idas ao banco; o `travarProdutosEstoque` faz um advisory lock por produto distinto (mais um `FOR UPDATE` de todos). Cancelar 200 itens mediu cerca de 0,2 s localmente; limite de 200 itens |
| R6 | Motor compartilhado: a origem nova e a reconciliação tocam abastecimento, Central e suplementação | Só as 3 linhas do motor; suítes `estoqueP0*`, `estoqueP1*`, `patrimonioP1Abastecimentos*` e Gestão P3 inteiras passaram |
| R7 | Proveniência da compra (Gestão P3): consumo por item bloqueia retificar/excluir a compra do lote, mesmo depois do estorno | Regra existente, agora com teste (T13). Avisar o usuário: uma compra cujo lote foi usado num item não se retifica |
| R8 | A `versao` do apontamento muda com itens: quem edita o cabeçalho enquanto outro lança item leva 409 | Comportamento esperado do CAS; a tela relê o detalhe |

## 9. Fora do escopo

**Achado fora do escopo, para outra missão:** em produção o runtime não é dono das tabelas e há RLS. Nesse cenário o P2002 de unique chega com `meta.target` nulo. Esta fatia se protege com a pré-conferência do `operation_id` (IT4g prova). Os módulos antigos que traduzem P2002 pelo `meta.target` passam a responder `CONCURRENCY_CONFLICT` em vez do código certo:
- `backend/src/shared/prisma/transacaoConcorrente.js:105-108` (os mapas `unicos`);
- `backend/src/modules/patrimonio/abastecimentoService.js:427` (`operation_id` do abastecimento);
- `patrimonio/patrimonioComum.js:68`;
- `empresas/empresaUniqueViolation.js:17`;
- `adminMaike/adminClientesGestaoService.js:108`.

A correção pede decisão e PR próprias.

- abastecimento ligado ao apontamento (Fatia E): `AbastecimentoBem*` não foi tocado;
- flags `exige_area`/`pode_ter_*`: não voltaram em lugar nenhum;
- edição e exclusão de item; devolução de sobra ao estoque;
- cadastro de serviços e fornecedor no item; unidade no item de SERVIÇO/OUTRO;
- lançamento financeiro, título, conta a pagar, natureza ou rateio a partir do item (`OperacaoFinanceira*` não foi tocado);
- prévia de custo (D-5); custo/hora, manutenção, peças e relatórios de custo;
- motor de estoque além da origem nova; escrita direta de saldo, lote ou movimento;
- trabalho visual: nenhum componente, CSS ou layout novo; nenhuma página nova em `config/mapa-manejo-scope.json`.
