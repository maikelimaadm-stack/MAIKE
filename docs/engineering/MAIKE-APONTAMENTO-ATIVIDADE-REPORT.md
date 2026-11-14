# MAIKE-APONTAMENTO-ATIVIDADE — Relatório (Fatia C do apontamento)

**fatia C · `feat/apontamento-atividade` · PR #269 (rascunho)** · Decisão: [D-PROD-190](./DECISIONS.md)

## 1. Entrega

O apontamento de atividade é a **execução** de um Tipo de Atividade: a tarefa é a demanda, a atividade é a operação feita, com máquina, implemento, operador, área, horas e produção. Esta fatia é a base enxuta, sem itens de custo; o abastecimento se pendura nela depois (Fatia E).

| Camada | O que entrou |
|---|---|
| Banco | model `ApontamentoAtividade` com os campos da especificação, FKs compostas tenant-aware `Restrict`, 3 únicos e 5 índices; relações inversas só no Prisma; migration EXPAND `20261113700000_apontamento_atividade` com RLS/REVOKE. **Aplicada em produção antes do merge** (seção 7) |
| Release | manifesto (sha256 `a9735833…5e`) e hash do DO (`5da2c547…67`) pinados no `premergeMigrateLib.mjs`; SQL editor 01–04 (68 tabelas de tenant, 83 no total, depois do merge da `main` `00a06096`); testes e ensaios das três migrations CONTRACT (D-PROD-162, D-PROD-183 e D-PROD-187), que contam as migrations pela pasta: GREEN com as 47 concluídas e 83 tabelas |
| Backend | módulo `apontamentosAtividade` (lista keyset com filtros, detalhe, criar, editar com CAS por `versao`, cancelar com motivo; **sem DELETE**), opções do formulário (bens, operadores, centros de custo e de resultado), tela `op-apontamentos-atividade`, 9 erros `APONTAMENTO_ATIVIDADE_*` e `TIPO_ATIVIDADE_DELETE_BLOCKED`; exclusões de cadastros com apontamento viram 409 |
| Frontend | porta com allowlist, serviço, regras puras, página `ApontamentosAtividade`, formulário na ordem pedida, tabela, rota, menu abaixo de "Tipos de Atividade", ícone mobile, `vercel.json` regenerado. Só componentes existentes |
| Testes | `apontamentoAtividadeNativo.test.mjs` (Postgres real), `permissoesR2Rotas`, `premerge-migrate` B14a/B14b (e o B15k da D-PROD-187 com as duas EXPAND de nome posterior), `sqlEditorBootstrap`, contagens; smoke `apontamentosAtividade.test.jsx` |

### Regras implementadas

| Regra | Comportamento |
|---|---|
| R-a tipo inativo | recusa criar; editar mantendo o tipo pode; trocar para outro inativo, não. Vínculo novo com bem, implemento, operador, área ou centro inativo também é recusado |
| R-b horas | `hora_fim` antes de `hora_inicio` é recusada (iguais pode) |
| R-c data futura | data operacional depois de "hoje" no fuso da fazenda é recusada; sem fuso, falha fechada. **Ampliada:** nenhuma hora no futuro; `hora_inicio` e `hora_fim` no dia operacional (fuso da fazenda). Sem turno que vira o dia (ver seção 3) |
| R-d implemento | exige bem e não pode ser o próprio bem |
| R-e centros | ver a seção 3 (decisão do proprietário) |
| R-f produção | quantidade e unidade juntas; quantidade e horas > 0; unidade HA, CAB, TON ou KM |
| R-g cancelado | não aceita edição nem novo cancelamento |
| R-h snapshots | nomes do tipo e do grupo gravados na criação e na troca do tipo; renomear depois não propaga |
| R-i mesma fazenda | bem, implemento, área, tarefa e centros da mesma empresa |
| R-j sem DELETE | cancelar grava status, quem, quando, motivo e `versao` + 1 |
| R-k número | sequência do tenant |
| R-l exclusões | tipo, grupo, bem, área, centro, tarefa, usuário e empresa com apontamento dão 409; os módulos antigos não consultam a tabela nova |

## 2. Como foi feito

1. **C1, schema e migration**, sozinho primeiro, porque fixa os campos.
2. **Construção em paralelo**, cada agente com arquivos próprios: C2 backend, C3 frontend, C4 testes de backend, C5 portão de migrations, SQL editor e contagens.
3. **Integração**: `verify:all` completo num banco limpo. Achou e corrigiu o único vermelho: o teste S8 do Patrimônio apagava as tabelas do Patrimônio supondo que nada de fora as referencia; agora confere que a única referência externa é exatamente `ApontamentoAtividade` e a apaga antes.
4. **Revisão adversarial**, três lentes independentes: tenancy e segurança (nenhum problema), regras de negócio, frontend e release.
5. **Rodada de correção**, com agentes de backend e frontend em paralelo, `verify:all` completo de novo e uma revisão do que mudou.

### Achados da revisão e o que foi feito

| Achado | O que foi feito |
|---|---|
| A primeira rodada implementou "nada vem do bem" também para o centro de **custo**, diferente do combinado com o proprietário | Restaurada a cópia do centro de custo do bem na criação (só centro ativo; o informado vence; nunca relido) e o preenchimento no formulário; centro de resultado continua só escolha do usuário. Seção 3 |
| O teste do snapshot do centro passava mesmo com o serviço relendo o centro do bem na edição | Testes refeitos para editar com o bem **com** centro; provados contra mutação |
| A proteção por `versao`/status contra corrida (editar × cancelar) só era exercida por um teste não determinístico | Teste direto da atualização com versão: versão velha e status CANCELADO não gravam nada |
| Horas no futuro ou fora do dia operacional passavam pela API | R-c ampliada (tabela acima) |
| O número da decisão (D-PROD-184) já era do Estoque P1-02 na `main` | Renumerada para **D-PROD-190** em todo o diff; o `migration.sql` deixou de citar número de decisão e o sha256 foi re-pinado |
| Faltavam a decisão, este relatório e o `CURRENT-STATE` (R8) | Escritos nesta PR |
| a main recebeu a PR #265 (Estações, D-PROD-188, migration já aplicada em produção) durante a fatia | merge da main, migration renomeada para 20261113700000 e decisão renumerada para D-PROD-190 |
| a main recebeu as PRs #263, #267, #268 e #270 depois da aplicação | merge da main e contagens refeitas |

Achados da revisão da rodada de correção e o que foi feito:

| Achado | O que foi feito |
|---|---|
| Num apontamento novo, limpar o centro de custo que veio do bem deixava o campo vazio na tela, mas o servidor gravava o centro do bem | Limpar o campo num apontamento novo com máquina de centro ativo traz de volta o centro do bem; sem máquina, limpa; na edição, limpa de verdade. Teste AP-FORM-15, provado por mutação |
| A API aceitava `hora_fim` no dia seguinte (turno noturno), mas o formulário não conseguia enviar isso. Ao editar um registro assim, a hora de fim recuava 24 h sem aviso | A API passou a exigir também o fim no dia da atividade. Assim, API e tela têm a mesma regra, e o caso que recuava a hora deixa de existir. Testes de meia-noite e do dia seguinte, provados por mutação |
| A tela mostrava "fim antes do início" para qualquer horário recusado | Frase por `reason` (hora futura, fora do dia, fim antes do início), com o campo certo destacado (AP-REGRAS-3, AP-PAGE-6) |

## 3. Centros de custo e de resultado (decisão do proprietário)

- **Pedido original:** "se vierem nulos, copiar do bem na criação. Depois nunca reler do bem — é snapshot."
- **Esclarecimento durante a fatia:** "centro de resultado eu que devo escolher do centro de resultado entendeu, o do bem é apenas para cadastro."
- **Como ficou:**
  - **Centro de resultado:** o usuário escolhe numa lista normal dos centros de resultado ativos da fazenda. Nunca vem do bem (o cadastro do bem nem tem esse campo).
  - **Centro de custo:** ao escolher a máquina num apontamento novo, o formulário preenche o centro de custo do bem, e o usuário pode trocar antes de salvar. Se ele escolheu à mão, trocar a máquina não sobrescreve. No servidor, apontamento novo sem centro de custo e com bem copia o centro do bem (só se estiver ativo). Depois de gravado é snapshot: nunca é relido do bem.
  - Na tela, isso aparece assim: num apontamento novo com máquina de centro ativo, limpar o campo traz de volta o centro do bem, porque a tela não pode mostrar vazio o que o servidor vai gravar. Na edição, limpar limpa.
- **Se o proprietário quis dizer que o centro de custo do bem também não entra no apontamento**, a mudança é pequena e localizada: tirar a cópia em `criar()` (`apontamentoAtividadeService.js`) e o preenchimento no formulário.

### Horas: sem turno que vira o dia

A especificação diz "hora_fim < hora_inicio → recusa", e a tela recebe HH:MM no dia da atividade. Por isso, um trabalho das 22:00 às 05:30 não cabe num apontamento só: vira dois (22:00–23:59 no primeiro dia e 00:00–05:30 no seguinte). A API segue a mesma regra. Se o proprietário quiser turno noturno num apontamento só, isso pede uma decisão: a tela teria de entender "fim menor que início" como dia seguinte.

## 4. Validação local (PostgreSQL 16 descartável)

Rodada desta atualização, sobre a árvore do merge com a `main` `00a06096` (PRs #270, #268, #267 e #263). A pedido do proprietário, para acelerar, rodaram localmente só as checagens rápidas abaixo; o `verify:all` completo roda no CI da PR (7 partes), que é a verificação de registro desta rodada.

| Checagem | Resultado |
|---|---|
| `node --test scripts/tests/deploy/*.test.mjs` | 115/115 |
| `test:gates` | 827/827 |
| gates `governance-paths`, `product-scope` (28 páginas), `tenancy` (68 models tenant-scoped), `indices`, `deploy-migrations`, `import-integrity`, `native-api` | passaram |
| `typecheck:backend`; `lint` (0 erros; 2 avisos antigos em arquivos que esta fatia não toca) | passaram |
| vitest `scope`, `vercelSpaRoutes` e `apontamentosAtividade` | 3 arquivos, 52 testes, 0 falhas |
| backend num banco limpo (`maike_cm`, migrado pelo `deploy:migrate`, 47/0, apagado no fim): `sqlEditorBootstrap`, `sqlEditorPreservaMaike`, `patrimonioP1Seguranca`, `apontamentoAtividadeNativo`, `categoriaManejoEnxuto`, `permissoesR2Rotas`, `estoqueP1M7Indices`, `estoqueP1M7TransacaoMigration` e os testes das três CONTRACT (`patrimonioSimplificaMigration`, `tipoTarefaDropColunasMigration`, `categoriaManejoCadcategoriaMigration`) | 151 testes em 37 suítes, 0 falhas, 202 s |

Também nesta rodada:
- num banco limpo, as 47 migrations dão 47/0, `prisma migrate diff` vazio, 83 tabelas em `public` (contando `_prisma_migrations`) e `cliente_id` em 69 (as 68 de tenant + `OperadorProdutoMaike`); o `vercel.json` regenerado não mudou (114 rewrites = 2 + 4 × 28);
- a release com **só** a migration nova sobre a `main` `00a06096` (46 migrations na `main`, 47 no merge, nenhuma migration da `main` alterada), classificada por `classificarMigrations`: `ok`, `EXPAND`, `tabelas_novas = ["ApontamentoAtividade"]`, nenhuma coluna em tabela antiga, nenhuma violação; sem `--contract` passa, e `--contract D-PROD-190` é `CONTRACT_INESPERADO`.

Rodadas anteriores:
- depois do merge da `main` `776befe` (PR #265), `verify:all` completo: **39 de 39**, em 1487,0 s (`test:gates` 810/810; os 29 gates; `prisma:generate`, `types` com dívida 625 = teto, `typecheck:backend`, `lint` sem erros; `test:backend` 1790 testes, 1785 passaram e 5 são `todo` antigos do ledger; `test:smoke` 219 arquivos e 2685 testes; `build`, `build:admin` e `admin-isolation:bundles`). Depois desse merge: `scripts/tests/deploy` 98/98 e a release só com a migration nova classificada como `EXPAND`;
- antes do merge da `main`, sobre o commit `a39ec01`: 39 de 39, `test:backend` 1767 testes (1762 passaram, 5 `todo`), `test:smoke` 218 arquivos e 2673 testes.

Provas por mutação, cada uma aplicada e desfeita, derrubando ao menos um teste:
- **cópia do centro:** feita na edição, ao trocar o bem e em toda edição; sem checar ativo; desligada; com o informado perdendo para o do bem; com o implemento como fonte;
- **atualização com versão:** sem `versao` e sem `status` no `WHERE`;
- **horas:** sem a regra de hora futura; com o dia em UTC; sem reaplicar na edição; com o fim no dia seguinte;
- **formulário:** sobrescrevendo a escolha manual; preenchendo na edição; nunca preenchendo; sem restaurar o centro do bem ao limpar.

O `verify:all` também roda no CI da PR.

## 5. Release

1. A migration é **EXPAND** (só cria a tabela nova). **Aplicada em produção em 2026-11-13 às 23:23:18 UTC, antes do merge**, com GO do proprietário (registro na seção 7).
2. Aplicada antes do merge (lição da Fatia LIMPEZA). Falta: merge da PR #269, deploy (Vercel) e o smoke da seção 7.
3. A ordem inversa também é segura para o código antigo: nenhum módulo antigo consulta a tabela nova, e a exclusão de empresa só conta dependentes em tabelas que existem. Mas a tela nova dá erro até a migration subir, então a ordem recomendada continua sendo migration → merge → deploy.
4. Até a tela `op-apontamentos-atividade` ser liberada num perfil, só o administrador a vê.
5. **Atenção à fila:** a migration desta fatia tem data (`20261113700000`) depois de todas as outras do repositório. Depois da aplicação dela, a `main` recebeu, por merge:
   - a **PR #270** (Curvas de Ganho, D-PROD-189, `…600000`), aplicada em produção às 23:18 UTC, antes desta;
   - a **PR #268** (Categoria de Manejo, Fatia D, D-PROD-187, CONTRACT `…500000`), **mergeada** e aplicada em produção **depois** da `…600000` e desta `…700000`, fora da ordem dos nomes, sem renomear a pasta;
   - a **PR #267** (só testes);
   - a **PR #263** (Estoque P1-03, D-PROD-185, EXPAND de índices `…300000`), aplicada em produção depois de todas (postcheck com 47).

   Esta branch fez merge da `main` `00a06096` (sem rebase) e refez as contagens fixas a partir de um banco limpo migrado: **47 migrations, 83 tabelas em `public` (com `_prisma_migrations`), 68 de tenant, 28 páginas e 114 rewrites** (SQL editor 01–04, `sqlEditorBootstrap`, ensaios e testes das CONTRACT, `scope` e `vercelSpaRoutes`). Os ensaios e testes das CONTRACT contam as migrations pela pasta, no padrão novo da `main`; no da D-PROD-162 esta migration fica fora da partida (depende do formato novo de `BemPatrimonial`), e no da D-PROD-187 ela é a segunda EXPAND de nome posterior já concluída antes da CONTRACT, como em produção. Quem entrar depois só atualiza as contagens de tabelas, páginas e do SQL editor, se mudarem.

## 6. Fora do escopo

- itens do apontamento (Fatia D do apontamento);
- abastecimento ligado à atividade (Fatia E): `AbastecimentoBem` não foi tocado;
- `LancamentoTarefa`, além da relação inversa;
- flags de exigência (`exige_area`, `pode_ter_*`): não voltaram em lugar nenhum;
- trabalho visual: nenhum componente, CSS ou layout novo;
- horas trabalhadas, safra e tarefa de origem no formulário (a API e a porta já aceitam; o formulário segue a lista de 8 campos pedida).

## 7. Registro da aplicação em produção

**2026-11-13, caminho B (conector Supabase, uma `execute_sql`, uma transação).**

- **GO:** o proprietário respondeu "go liberado". Perguntei a que isso se aplicava, e ele escolheu "As duas, nessa ordem": primeiro aplicar esta migration, depois começar a Fatia D. Esta sessão não tem a URL direta do banco que o caminho A (`premerge-migrate --aplicar`) exige. Por isso o GO vale como autorização específica para o caminho B, **registrado como desvio da D-PROD-74**, como nas Estações (runbook `MAIKE-CADESTACOES-RUNBOOK-RELEASE.md` §1).
- **Preflight, só leitura, projeto `uuemcasqcdjucflulkne`:**
  - `system_identifier` 7692130048193495360, banco `postgres`;
  - `_prisma_migrations` com **44** concluídas e 0 com falha. A última é `20261113600000_cadcurvaganho_cadastro`, a migration da PR #270, **já aplicada em produção** embora a PR seguisse aberta naquela hora (foi mergeada depois, em `cf07309`);
  - `to_regclass('public."ApontamentoAtividade"')` nulo e 82 tabelas em `public`;
  - as 10 tabelas referenciadas existem;
  - nenhuma sessão ativa e nenhuma trava forte nelas.
  - Repeti o preflight logo antes de aplicar, depois de um reinício da sessão. Resultado idêntico, sem a migration registrada.
- **Ensaio local** do mesmo envelope num banco novo com as 43 migrations da `main`, trocando só o `system_identifier` e o total esperado:
  - a 1ª execução aplicou: 44 no histórico, RLS ligado sem FORCE, 82 tabelas;
  - a 2ª execução parou na guarda (`RELEASE_BLOCKED: migration já registrada`);
  - `prisma migrate status` deu "Database schema is up to date!" e o `migrate diff` contra o `schema.prisma` ficou vazio.
- **Envelope aplicado** (o mesmo das Estações):
  1. `BEGIN`; `SET LOCAL lock_timeout = '5s'`; `pg_advisory_xact_lock(72707369)`;
  2. guarda `DO`: alvo 7692130048193495360, migration ainda não registrada, 44 concluídas e 0 com falha, tabela inexistente;
  3. o `migration.sql` íntegro (sha256 `a9735833…5e`);
  4. `INSERT` em `_prisma_migrations` com esse checksum e `applied_steps_count` 1;
  5. `COMMIT`.
- **Conferência, só leitura:**
  - linha `20261113700000_apontamento_atividade` com o checksum pinado, 1 passo, `finished_at` 2026-11-13 23:23:18 UTC;
  - **45** concluídas e 0 com falha;
  - RLS ligado, sem FORCE; política `maike_backend_all` só para `maike_vercel`; `anon` e `authenticated` sem SELECT;
  - 13 FKs, todas `RESTRICT`; 9 índices (8 + pkey);
  - 0 linhas; **83** tabelas em `public`;
  - `get_advisors` (segurança): nenhum alerta.
- **Fila em produção (depois desta aplicação):**
  - a PR #270 (Curvas de Ganho, `…600000`) foi **mergeada** na `main` (`cf07309`);
  - a migration da PR #268 (`20261113500000_categoria_manejo_cadcategoria`, CONTRACT), que naquela hora ainda não tinha sido aplicada e tinha data **anterior** a duas já aplicadas (`…600000` e `…700000`), foi aplicada **depois** delas, fora da ordem dos nomes, sem renomear a pasta; a PR #268 foi **mergeada** (`810a312a`);
  - a PR #263 (Estoque P1-03, `…300000`) foi aplicada por último (preflight `SEGUIR` com 46, postcheck `JA_APLICADA` com 47) e **mergeada** (`00a06096`); a PR #267 (só testes) também foi mergeada;
  - produção tem hoje as 47 migrations do repositório; esta branch fez merge da `main` `00a06096` e refez as contagens (seção 5).
- **Smoke depois do merge e do deploy (proprietário):**
  - abrir Atividades → Apontamentos de Atividade numa fazenda com fuso configurado;
  - criar um apontamento de teste com máquina e conferir o centro de custo vindo do bem;
  - editar e cancelar com motivo;
  - conferir que excluir o tipo de atividade usado dá a mensagem de bloqueio, e não um erro 500.
- **Rollback:** a tabela é nova e nada a referencia. Antes de qualquer escrita real, reverter é `DROP TABLE "ApontamentoAtividade";` mais a remoção da linha em `_prisma_migrations`, **só com GO próprio**, porque é CONTRACT. Se o código já estiver no ar, reverter o código primeiro.
