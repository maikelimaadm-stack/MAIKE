# MAIKE-TIPO-ATIVIDADE-DEFAULTS — relatório da Fatia 1 do Lançamento de Atividades

> **fatia 1 · `feat/tipo-atividade-defaults` · PR #276**
>
> Decisão **D-PROD-197** · contrato [`MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md`](./MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md) ·
> runbook [`MAIKE-TIPO-ATIVIDADE-DEFAULTS-RUNBOOK-RELEASE.md`](./MAIKE-TIPO-ATIVIDADE-DEFAULTS-RUNBOOK-RELEASE.md)

## 1. O que é

O Tipo de Atividade guarda os **padrões** que a atividade vai herdar (categoria, centro de custo, centro de resultado,
unidade de produção de `UnidadeMedida` e coeficiente) e as **8 flags** de como ela funciona (`exige_area`,
`exige_safra`, `exige_maquina`, `permite_implemento`, `permite_produto`, `permite_servico`, `permite_mao_obra`,
`exige_producao`). É a base das Fatias 2 a 4. Nada aqui cria a Atividade nem muda o Apontamento de Atividade de hoje.

## 2. O que entrou

| Camada | Entrega |
|---|---|
| Banco | 13 colunas novas em `"TipoAtividade"` (5 padrões anuláveis; 8 flags `BOOLEAN NOT NULL DEFAULT false`), 3 FKs compostas pelo tenant `RESTRICT` (centro de custo, centro de resultado, unidade), 2 CHECKs (categoria em lista fechada; coeficiente > 0), 3 índices começando por `cliente_id`. Linhas existentes leem `false`/`null`. Tabelas não mudam (85) |
| Migration | `20261114300000_tipo_atividade_defaults`, **CONTRACT** aditiva (sexta entrada fechada, depois das D-PROD-162, 183, 187, 194 e 195): a allowlist EXPAND não aceita, em tabela antiga, flag `NOT NULL DEFAULT`, FK para tabela antiga nem CHECK. Guarda pinada `e1578019…b3b0`; arquivo `b65d4f08…5dbf`; 18 instruções pinadas + 3 `CREATE INDEX`. Repositório 50 → 51 |
| Portão | Entrada `D-PROD-197` em `MIGRATIONS_CONTRACT_APROVADAS`; descritor com `colunas_adicionadas`/`constraints_adicionadas` (o rótulo não fala mais em "CHECKs alargados" para constraint nova); `premerge-migrate` passa a citar as 13 colunas e as 5 constraints |
| Gate | `gate:tarefa-cadastro-native`: TipoAtividade exige as 8 flags e proíbe só `pode_ter_*`; TipoTarefa proíbe as 4 antigas e as 8 novas (nenhuma flag volta ao TipoTarefa) |
| API | `/tipos-atividade` com os 13 campos (flags e coeficiente sem coerção do AJV), resposta com os objetos do centro de custo, do centro de resultado e da unidade, 422 `TIPO_ATIVIDADE_PADRAO_INVALIDO` (`nao_encontrado`, `inativo`, `empresas_diferentes`, `nao_positivo`); rotas novas `GET /tipos-atividade/opcoes/centros-custo` e `/centros-resultado` (`?empresa_id=`, só ativos, ordem numérica, para quem cria ou edita tipo); apagar unidade usada como padrão → 409 `UNIDADE_MEDIDA_DELETE_BLOCKED` |
| Terreno da Fatia 2 | `tipoAtividadePadroes.js` (puro): `padroesParaAtividade(tipo, { empresaId })` e `regrasDoTipo(tipo)` |
| Tela | Tipos de Atividade: formulário em 3 seções (Identificação; Apropriação; Como funciona), 8 caixas de marcar, centros da fazenda selecionada, coluna Categoria na lista (chave de colunas `_v2`). Só componentes que já existem |
| Operação | Scripts do SQL Editor 01–04 com `TipoAtividade` reposicionado na ordem de exclusão (agora é filha dos centros e da unidade) |

## 3. Agentes

| Agente | Entrega |
|---|---|
| A0 | Mapa dos consumidores, testes que fixam forma, contagens, guardas, peças do Base1 e riscos (preferência de colunas, transporte de erros, testes de tela) |
| A1 | Portão (entrada CONTRACT, descritor), testes do portão e do runner, teste da migration em PostgreSQL real, gate, SQL Editor, runbook |
| A2 | Backend (rotas, serviço, repository, helper puro, erros, exclusão da unidade, guarda das opções) |
| A3 | Porta, serviço, formulário, tabela, página, mensagens de erro, transporte, testes de tela |
| A4 | Testes de backend (40 + 12 + 10) |
| A5/A6 | Revisão independente (correção e segurança/tenant) do backend, da tela e da release, com 2 céticos por achado |
| Orquestrador | Schema, migration, contrato, decisão, nota constitucional proposta, limpeza dos testes (`helpers.mjs`), rótulo do `premerge-migrate`, este relatório |

## 4. Decisões e pontos para o proprietário

1. **Tipo é do cliente; centro é da fazenda.** A FK prende o tenant. Os dois centros padrão são da mesma fazenda e
   precisam estar ativos quando escolhidos. Na Fatia 2, o padrão só será herdado por atividade da mesma fazenda do
   centro. Com mais de uma fazenda, padrão por fazenda seria uma tabela filha — decidir na Fatia 2.
2. **`permite_maquina` não está na lista de flags.** A Fatia 3 fala em "tipo que permite máquina"; hoje só existe
   `exige_maquina`. **Decidido pelo proprietário:** "Não, segue só com Exige máquina (Recomendado)".
3. **Caixas de marcar.** As 8 flags usam a caixa de marcar existente (`MgCheck`) dentro do campo do Base1, como foi
   pedido; "Ativo" continua como estava.
4. **Leitura do tipo.** `GET /tipos-atividade` só exige login (como antes) e agora devolve o número e o nome dos centros
   padrão. Quem usa o tipo vê os centros que ele carrega; listar os centros da fazenda continua exigindo a permissão
   do formulário de tipo (criar ou editar).
5. **Constituição.** A nota D-PROD-197 no `07-DO-NOT-DO.md` foi redigida pelo agente; o proprietário a aprovou junto
   com o merge (§4 da constituição), na resposta citada no §7.

## 5. Validação (local; o GitHub Actions da conta não roda)

| Etapa | Resultado |
|---|---|
| Backend completo, antes do merge com a `main` | 1944 testes: **1938 ok**, 5 `todo`, **1 falha intermitente anterior à fatia** — IT-06 do `inicializar-tenant-maike` (`LOCK … NOWAIT` colide com o autovacuum em `TituloFinanceiro`, 6 autovacuums na rodada); o arquivo sozinho dá 11/11 duas vezes e o script não está no diff |
| `verify:all` sem `test:backend`, antes do merge | todas as etapas PASS depois da correção do QP-G1 (`test:gates` 879/879; tipos 614 ≤ 625; lint; smoke; build; build:admin) |
| Depois do merge com a `main` (D-PROD-195) | 51 migrations num banco vazio, `migrate diff` vazio; testes de deploy 168/168; `gate:deploy-migrations` PASS; curva mensal 10/10; migration desta fatia 25/25; demais: ver §5.1 |
| Navegador (componentes reais, backend falso) | 1366 e 390 px sem rolagem lateral nem erro de console; 3 seções na ordem, 17 rótulos do contrato, 8 caixas de marcar com rótulos inteiros (2 por linha) |

### 5.1 Rodada final, sobre o estado mesclado

| Etapa | Resultado |
|---|---|
| `verify:all --pular=test:backend` | **todas as etapas PASS** (exit 0): `test:gates`, os gates, tipos, `typecheck:backend`, lint, smoke **2848/2848** (229 arquivos), build e build:admin |
| Backend, 22 arquivos das duas fatias (tipo, unidade, permissões, apontamento, tarefa, SQL Editor, categoria e curva, migrations CONTRACT, ledger) | 388 testes: **384 ok**; as 4 falhas eram todas do teste da CONTRACT D-PROD-195 da `main`, que ainda supunha ser a migration mais recente — corrigido (a D-PROD-197 entra na partida) e reexecutado: **10/10** |
| Portão e runner (`scripts/tests/deploy/*`) | **168/168**; `gate:deploy-migrations` PASS |
| Banco vazio | 51 migrations aplicadas; `prisma migrate diff` banco × schema vazio |

## 6. Revisão independente

Três revisões (backend, tela, migration/portão), cada achado conferido por 2 céticos que tentam refutá-lo; uma
conferência no navegador.

| Achado | Veredito | Resolução |
|---|---|---|
| A5-1/A6-1 — dois PATCH simultâneos, cada um mudando um centro, gravavam centros de fazendas diferentes | confirmado e reproduzido (4/4) | **corrigido**: `SELECT … FOR UPDATE` antes de ler o anterior; teste de corrida que falha sem a trava |
| A6-2 — `GET /tipos-atividade` (só login) mostra número e nome dos centros padrão | refutado (2/2): o contrato pede | ponto para o proprietário (§4.4) |
| F1-1 — cancelar a edição não descartava o rascunho (defeito antigo do motor, agora com padrões e flags) | confirmado (2/2) | **corrigido**: a chave do formulário leva o modo, como no Apontamento; teste TA-PAGE-4 |
| F2-1 — trocar de fazenda com o PATCH em voo deixava a leitura fora do gravado | confirmado (2/2) | **corrigido** pela mesma chave (depois de salvar, o formulário remonta do gravado) |
| F2-3 — unidade criada sem rede (id `offline_…`) era oferecida como unidade de produção | confirmado (2/2) | **corrigido**: fica fora das opções |
| F1-3 — duplicar tipo cujo padrão ficou inativo dá 422 | dividido (1/2) | sem mudança: o servidor recusa padrão inativo por regra |
| M1-01/M2-01 — a `main` já tinha dado a D-PROD-195 e o prefixo `20261114200000` à curva na Categoria de Manejo (aplicada em produção) | confirmado e reproduzido (4/4) | **corrigido**: D-PROD-197, migration `20261114300000_…` (mesmo SHA), merge da `main`, teste de decisão única por CONTRACT |
| M1-02/M2-02 — runbook contando 49 → 50 com produção já em 50 | real; a guarda falharia fechada | **corrigido**: 50 → 51 em runbook, testes e documentos |
| M2-03 — o descritor mais estreito mudava a saída da CONTRACT da `main` | falha fechada | ajustado no merge (a D-PROD-195 também lista colunas/constraints adicionadas) |
| M1-04 — os 3 índices novos aparecem como "unused_index" nos advisors | confirmado (2/2) | **corrigido** no runbook (esperado, não é motivo para parar) |
| M2-04 — o gate lê só o 1º `ADD COLUMN` de cada `ALTER` e ignora `@map` | confirmado | pendente (melhoria do gate; não afeta esta release) |
| M2-05 — o classificador corta `--`/`/* */` também dentro de literal (anterior) | — | pendente, fora do escopo |
| M1-03 — o GO precisa da resposta sobre `permite_maquina` e da nota do `07` | refutado (2/2) | incluído no pedido de GO |
| Navegador — rótulos das flags cortados entre 768 e 1200 px | — | **corrigido**: 2 por linha |
| Navegador — só a caixa (14 px) clica, o rótulo não | — | pendente: mudar isso é trabalho visual no componente |

## 7. Release

**Aplicada em produção em 2026-11-14 às 17:05:05 UTC** (`finished_at`), com GO escrito do proprietário para esta
migration (resposta: "Sim: aplique e faça o merge (Recomendado)" à pergunta que citava `20261114300000_tipo_atividade_defaults` com o número D-PROD-196, renumerada depois para D-PROD-197),
pelo **caminho B** do runbook (uma `execute_sql`, transação única: `lock_timeout` 5 s, trava consultiva 72707369,
guarda `$alvo$` com o `system_identifier` e 50/0, o `migration.sql` literal e o registro em `_prisma_migrations` com o
checksum do arquivo `b65d4f08…5dbf` e `applied_steps_count` 1).

| Etapa | Resultado |
|---|---|
| Preflight (§4, 17:04 UTC) | `PRONTO PARA APLICAR`: alvo certo, 50 / 0, esta não registrada, D-PROD-182 e D-PROD-194 com o checksum do repositório, nenhuma coluna, constraint ou índice novo já presente, os 3 alvos das FKs com único em `(cliente_id, id)`, 85 tabelas, RLS `true` / FORCE `false` / política `maike_backend_all`, 2 linhas em `TipoAtividade`, 0 travas, 0 transações longas |
| Aplicação (17:05:05 UTC) | transação concluída; `_prisma_migrations` com checksum `b65d4f08de5f587cd69b893bcb2626df5cc775e1f4ca5b68fdaac863aab55dbf` |
| Postcheck (§6, 17:05 UTC) | `APLICADA E CONFERIDA`: 51 / 0; 13 colunas; 5 constraints; 4 índices; 85 tabelas; RLS, FORCE e política iguais ao preflight; nenhum privilégio novo; 2 linhas, nenhum padrão preenchido |
| Alertas do Supabase (17:06 UTC) | segurança: nenhum. Performance: só `unused_index` (INFO) para os 3 índices novos, esperado; nenhuma FK nova sem índice |

O merge da PR #276 vem depois desta aplicação, como o runbook manda. A mesma resposta do proprietário aprova a nota
D-PROD-197 do `07-DO-NOT-DO.md`. Sobre `permite_maquina`, o proprietário respondeu "Não, segue só com Exige máquina
(Recomendado)": a lista de flags fica como está.

## 8. Fora do escopo

- O achado do Codex na PR #274 (rascunho de item de Produto em resultado incerto) continua aberto; a Fatia 3 refaz os
  itens, mas até lá a correção pequena proposta segue valendo se o proprietário quiser.
- A tela de Unidades de Medida mostra a mensagem genérica de vínculo ao bloquear a exclusão; citar o tipo de atividade
  exigiria mexer naquela tela.
