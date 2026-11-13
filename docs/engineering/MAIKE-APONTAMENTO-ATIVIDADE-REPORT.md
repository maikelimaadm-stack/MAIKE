# MAIKE-APONTAMENTO-ATIVIDADE — Relatório (Fatia C do apontamento)

**fatia C · `feat/apontamento-atividade` · PR #__PR__ (rascunho)** · Decisão: [D-PROD-188](./DECISIONS.md)

## 1. Entrega

O apontamento de atividade é a **execução** de um Tipo de Atividade: a tarefa é a demanda, a atividade é a operação feita, com máquina, implemento, operador, área, horas e produção. Esta fatia é a base enxuta, sem itens de custo; o abastecimento se pendura nela depois (Fatia E).

| Camada | O que entrou |
|---|---|
| Banco | model `ApontamentoAtividade` com os campos da especificação, FKs compostas tenant-aware `Restrict`, 3 únicos e 5 índices; relações inversas só no Prisma; migration EXPAND `20261113300000_apontamento_atividade` com RLS/REVOKE. **Não aplicada** |
| Release | manifesto (sha256 `a9735833…5e`) e hash do DO (`5da2c547…67`) pinados no `premergeMigrateLib.mjs`; SQL editor 01–04 (66 tabelas de tenant, 81 no total); contagens das duas migrations CONTRACT (42 → 43) |
| Backend | módulo `apontamentosAtividade` (lista keyset com filtros, detalhe, criar, editar com CAS por `versao`, cancelar com motivo; **sem DELETE**), opções do formulário (bens, operadores, centros de custo e de resultado), tela `op-apontamentos-atividade`, 9 erros `APONTAMENTO_ATIVIDADE_*` e `TIPO_ATIVIDADE_DELETE_BLOCKED`; exclusões de cadastros com apontamento viram 409 |
| Frontend | porta com allowlist, serviço, regras puras, página `ApontamentosAtividade`, formulário na ordem pedida, tabela, rota, menu abaixo de "Tipos de Atividade", ícone mobile, `vercel.json` regenerado. Só componentes existentes |
| Testes | `apontamentoAtividadeNativo.test.mjs` (Postgres real), `permissoesR2Rotas`, `premerge-migrate` B14a/B14b, `sqlEditorBootstrap`, contagens; smoke `apontamentosAtividade.test.jsx` |

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
| O número da decisão (D-PROD-184) já era do Estoque P1-02 na `main` | Renumerada para **D-PROD-188** em todo o diff; o `migration.sql` deixou de citar número de decisão e o sha256 foi re-pinado |
| Faltavam a decisão, este relatório e o `CURRENT-STATE` (R8) | Escritos nesta PR |

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

__VALIDACAO__

O `verify:all` também roda no CI da PR.

## 5. Release

1. A migration é **EXPAND** (só cria a tabela nova) e **não foi aplicada** em nenhum banco remoto. Aplicar exige GO expresso do proprietário.
2. **Aplicar antes do merge** (lição da Fatia LIMPEZA): com a PR pronta e o GO, `node scripts/deploy/premerge-migrate.mjs --sha <SHA da PR> --verificar-alvo` e depois `--aplicar` pelo caminho oficial. Depois do merge, o premerge não vê mais a migration como nova.
3. A ordem inversa também é segura para o código antigo: nenhum módulo antigo consulta a tabela nova, e a exclusão de empresa só conta dependentes em tabelas que existem. Mas a tela nova dá erro até a migration subir, então a ordem recomendada continua sendo migration → merge → deploy.
4. Até a tela `op-apontamentos-atividade` ser liberada num perfil, só o administrador a vê.
5. **Atenção à fila:** a Fatia D da Categoria de Manejo (D-PROD-187) também vai trazer migration (CONTRACT). Quem entrar depois atualiza as contagens fixas (43) dos testes das migrations CONTRACT e do SQL editor, se mudarem.

## 6. Fora do escopo

- itens do apontamento (Fatia D do apontamento);
- abastecimento ligado à atividade (Fatia E): `AbastecimentoBem` não foi tocado;
- `LancamentoTarefa`, além da relação inversa;
- flags de exigência (`exige_area`, `pode_ter_*`): não voltaram em lugar nenhum;
- trabalho visual: nenhum componente, CSS ou layout novo;
- horas trabalhadas, safra e tarefa de origem no formulário (a API e a porta já aceitam; o formulário segue a lista de 8 campos pedida).
