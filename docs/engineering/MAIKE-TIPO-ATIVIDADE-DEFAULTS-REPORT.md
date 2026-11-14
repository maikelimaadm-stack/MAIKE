# MAIKE-TIPO-ATIVIDADE-DEFAULTS — relatório da Fatia 1 do Lançamento de Atividades

> **fatia 1 · `feat/tipo-atividade-defaults` · PR #276**
>
> Decisão **D-PROD-196** · contrato [`MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md`](./MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md) ·
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
| Portão | Entrada `D-PROD-196` em `MIGRATIONS_CONTRACT_APROVADAS`; descritor com `colunas_adicionadas`/`constraints_adicionadas` (o rótulo não fala mais em "CHECKs alargados" para constraint nova); `premerge-migrate` passa a citar as 13 colunas e as 5 constraints |
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
   `exige_maquina`. Acrescentar antes de aplicar a migration custa só re-pinar.
3. **Caixas de marcar.** As 8 flags usam a caixa de marcar existente (`MgCheck`) dentro do campo do Base1, como foi
   pedido; "Ativo" continua como estava.
4. **Leitura do tipo.** `GET /tipos-atividade` só exige login (como antes) e agora devolve o número e o nome dos centros
   padrão. Quem usa o tipo vê os centros que ele carrega; listar os centros da fazenda continua exigindo a permissão
   do formulário de tipo (criar ou editar).
5. **Constituição.** A nota D-PROD-196 no `07-DO-NOT-DO.md` foi redigida pelo agente; vale só com a aprovação
   explícita do proprietário no merge (§4 da constituição).

## 5. Validação (local; o GitHub Actions da conta não roda)

(preencher no fechamento)

## 6. Revisão independente

(preencher no fechamento)

## 7. Release

**A migration NÃO foi aplicada em nenhum banco remoto.** Ela precisa de autorização explícita do proprietário e entra
**antes do merge** (o código novo lê as colunas; o código antigo convive com elas), fora de pico (trava a tabela de
tipos por menos de 1 s), pelo runbook: caminho A com `--contract D-PROD-196`, ou caminho B (conector) com GO escrito e
específico desta migration. Produção hoje: 50 migrations concluídas (a última é a `20261114200000_cadcategoria_curva_ganho`, D-PROD-195, aplicada às 14:51:56 UTC), 85 tabelas; depois desta, 51.

## 8. Fora do escopo

- O achado do Codex na PR #274 (rascunho de item de Produto em resultado incerto) continua aberto; a Fatia 3 refaz os
  itens, mas até lá a correção pequena proposta segue valendo se o proprietário quiser.
- A tela de Unidades de Medida mostra a mensagem genérica de vínculo ao bloquear a exclusão; citar o tipo de atividade
  exigiria mexer naquela tela.
