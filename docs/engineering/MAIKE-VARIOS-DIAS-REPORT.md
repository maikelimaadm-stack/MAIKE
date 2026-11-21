MAIKE-VARIOS-DIAS (D-PROD-267) · `claude/tipo-tarefa-drop-colunas-1aznvv` · PR #352

# MAIKE — Serviço de vários dias e a Situação da lista

Decisão: [D-PROD-267](./DECISIONS.md) · Proposta aprovada (Partes 2 e 3):
[`MAIKE-PROPOSTA-REFORMA-E-VARIOS-DIAS.md`](./MAIKE-PROPOSTA-REFORMA-E-VARIOS-DIAS.md) · Pesquisa:
[`MAIKE-PESQUISA-OPERACOES-CAMPO.md`](./MAIKE-PESQUISA-OPERACOES-CAMPO.md) · Fatia anterior:
[Nova realização (D-PROD-265)](./MAIKE-NOVA-REALIZACAO-REPORT.md).

**Sem migration.** Merge e deploy normais.

## 1. O que mudou no servidor

**`POST /atividades/registrar`**

- **Sem a regra do mês.** O registro entra na atividade ABERTA da mesma operação que tem a área PLANEJADA ou
  EM_ANDAMENTO, em qualquer mês. A roçada de 28/11 a 07/12 é uma atividade só. O nome da atividade nova continua
  com o mês do início (`… · nov/26`). A trava consultiva é uma por área, sem o mês, em ordem de `area_id`.
- **Serviço parado (30 dias).** Último dia lançado na atividade achada (nas áreas do registro; o maior entre o dia
  e o término dos lançamentos confirmados) mais de 30 dias antes do dia do registro, sem decisão no corpo:
  **409 `ATIVIDADE_SERVICO_PARADO`** com `atividade_id`, `atividade_nome`, `ultimo_dia`, `area_id`, `dias_parado`
  e `limite_dias`. Nada é gravado, nem o recibo. O reenvio com a mesma `operation_id` traz `nova_atividade`:
  `false` continua; `true` conclui as áreas do registro na antiga (cada uma no último dia lançado nela; a
  atividade também, se todas ficam concluídas) e abre uma nova. O limite é a constante `DIAS_PARADO_MAXIMO`.
- **`concluir: true`.** Depois de gravar o(s) dia(s), as áreas do registro concluem em `data_termino ?? data_operacional`;
  com todas as áreas concluídas, a atividade conclui. A resposta traz `registro.areas_concluidas`,
  `registro.atividade_concluida` e `registro.atividade_anterior` (o que o "serviço novo" fez com a parada).
- **Idempotência.** Sem `concluir` e `nova_atividade`, o fingerprint é byte a byte o de antes (prova no teste,
  com a fórmula antiga reconstruída). Com eles, as chaves entram (a mesma chave com outro valor → 409).
- **Guarda.** `GUARDAS.atividadeApontamentos.registrar`: lançar sempre; com `concluir` ou `nova_atividade` `true`,
  também editar|salvar da tela (a permissão do "Concluir"). Os booleanos não aceitam coerção (`"true"`, `1`,
  `null` → 400).

**Concluir**

- **Todas as áreas concluídas ⇒ atividade concluída**, também no `POST …/areas/:areaId/concluir` (a resposta ganha
  `atividade_concluida`). A data da atividade é a da área que concluiu por último; a conclusão é auditada
  (`atividade.concluir` com `conclusao_automatica`). Tipo que exige produção sem produção > 0: a atividade fica
  ABERTA (o "Concluir atividade" explica). Reabrir a atividade continua desfazendo só as áreas concluídas no dia dela.
- **Nunca antes do último dia lançado** (área e atividade): 422 `ATIVIDADE_DATA_INVALIDA` `antes_do_ultimo_dia`
  com `ultimo_dia`.
- **O "Concluir" da lista** usa a rota que já existia, `POST /atividades/:id/concluir`: ela conclui as áreas em
  andamento e a atividade numa transação, com a data não futura, não antes do início e (agora) não antes do último
  dia lançado, e com a permissão de sempre (editar). Não foi criada rota nova.

**Leituras**

- `GET /atividades`: cada item ganha `andamento` — `tipo_fixo`, `situacao` (Concluída; Em andamento = ABERTA com
  dia lançado; Planejada = ABERTA sem dia; Cancelada), `situacao_rotulo`, `hectares_feitos` (Σ do dia dos
  lançamentos confirmados), `hectares_area` (Σ das planejadas das áreas; sem planejada, o tamanho), `percentual`,
  `primeiro_dia`, `ultimo_dia`, `lancamentos` e o mesmo por área. Três consultas por página (custo, andamento
  agrupado e categorias), nunca uma por linha. Filtros novos `situacao` e `tipo_fixo`.
- `GET /atividades-por-area/:areaId/resumo`: cada atividade ganha `ultimo_dia` (a prévia do Planejamento e do parado).

## 2. O que mudou na tela

- **Lista (o modelo do dono, img02 e V1).** "+ Nova realização" é o botão principal da barra e "Planejar" abre o
  formulário de planejar (a "Nova atividade" de antes). Pílulas **Tipo** (os 7 tipos e, dentro de cada um, as
  operações, inclusive inativas), **Situação** (as 4 e "Abertas", que é o status ABERTA de antes), **Área** e
  **Início**. Colunas **Nº · Tipo · Operação · Área · Data · Situação · Custo**; Área "Pasto da Aroeira +1"; Data
  "28/11 –" em aberto e "01/11 a 10/11" concluída. Em andamento: "12 de 40 ha (30%) · último dia 02/12", a barra
  fina e **"+ Lançar dia"** e **"Concluir"**; aos 100% sem concluir, **"100%, falta concluir"** em negrito e só
  "Concluir". No celular, cada card é o bloco do V1 (opt-in `cardsBody` do motor), com o ⚡ da linha.
- **"+ Lançar dia" (V2).** A Nova realização abre no formulário do tipo do serviço, sem "Trocar tipo": a operação,
  as áreas em aberto com os hectares de hoje vazios, a máquina e o implemento do último dia (um editor por vez; a
  inicial é a leitura de agora, com a nota "inicial = final do último dia"), a equipe do último dia (quantidade
  vazia) e a data de hoje. Insumos não vêm. O Planejamento diz "Entra em <nome> (em andamento, 8 de 40 ha)" e,
  parada há mais de 30 dias, avisa que o salvar vai perguntar.
- **"Como fica depois de salvar?"** logo antes do rodapé: [Em andamento] [Concluída], padrão pelo término (vazio =
  Em andamento) até a pessoa escolher, e o resumo numa frase ("… no PASTO DA AROEIRA, hoje, 4 ha, TR-02 — TRATOR
  MF 4275, JOÃO 1 diária. **Vai ficar EM ANDAMENTO (16 de 40 ha).**"). Só "Concluída" manda `concluir: true`.
  Vale também na janela aberta pelos Detalhes da área.
- **Parado.** O 409 vira a pergunta "Este serviço está parado desde dd/mm. É continuação?" com
  [Continuar este serviço] [É um serviço novo]; o reenvio leva `nova_atividade` `false`/`true`.
- **"Concluir" (V3).** "Concluir <operação> · <área>", "Qual foi o último dia?" com o último dia lançado
  ("sugerido: último dia lançado"), "40 de 40 ha (100%)" com a barra, Cancelar e Concluir; a regra do último dia
  é conferida antes da rede.

## 3. O que a lista antiga tinha e para onde foi

| Antes | Agora |
|---|---|
| Colunas Nome, Área executada / planejada, Início | Opcionais (Mais opções → colunas); a ordenação por elas continua |
| Selo de status (Aberta, Concluída, Cancelada) | Situação em texto (Planejada, Em andamento, Concluída, Cancelada), do servidor |
| Pílula "Status" | "Situação" (com "Abertas" = o status ABERTA) |
| Pílula "Tipo de atividade" (a operação) | "Tipo": o tipo fixo e, dentro dele, cada operação |
| "Nova atividade" (botão principal) | "Planejar" (o mesmo formulário) |
| "Nova realização" (botão secundário) | "+ Nova realização" (o principal) |
| Cards do celular (selo, nome, campos) | O bloco V1; o selo e os campos saíram do card (a configuração de campos do card fica sem efeito nesta tela) |
| ⚡ da linha, Mais opções, Editar, abrir, concluir/reabrir/cancelar/duplicar, busca, exportar, colunas | Iguais |

## 4. Testes

- **Backend** (Postgres real): `backend/tests/atividadeVariosDias.test.mjs` (novo, 17 testes): continuação 28/05 →
  07/06 numa atividade; trava sem o mês (dois registros paralelos em meses diferentes → uma atividade); parado
  (409 sem recibo, reenvio com a mesma chave e `false`; `true` conclui a antiga no último dia e abre outra; o
  limite conta o término; a planejada sem dia não está parada); `concluir` (área e atividade; várias áreas; antes
  do último dia → 422; a guarda; o fingerprint igual ao de antes); "Concluir área" conclui a atividade com a
  última; tipo que exige produção fica aberto; o "Concluir" da lista (futura, antes do início, antes do último
  dia, ok, 403 só com lançar); o `andamento` e os filtros da lista; o `ultimo_dia` do resumo.
- **Mudaram de propósito** (a regra do mês saiu): em `atividadeRegistro.test.mjs`, "não casam" — o registro de
  maio agora **continua** a aberta de junho (antes criava `… · mai/27`) — e o teste do resumo, que fazia a
  vistoria cancelada nascer em maio depois da de junho (agora ela nasce antes, senão o registro de maio entraria
  na de junho). Em `atividadeNativo.test.mjs`, as chaves do item da lista ganham `andamento`.
- Rodados e verdes: `atividadeVariosDias`, `atividadeRegistro`, `atividadeRegistroVariasAreas`,
  `atividadeRegistroDataTermino`, `atividadeAreas`, `atividadeNativo`, `atividadeIntegracaoTela`,
  `atividadeAbastecimento`, `atividadeApontamentoNativo` (156 testes).
- **Smoke:** `tests/smoke/servicoVariosDias.test.jsx` (novo, 18 testes: regras puras, a célula e o bloco, o
  diálogo Concluir, "+ Lançar dia" preenchido de verdade, "Como fica depois de salvar?" e o corpo, a pergunta do
  parado e o reenvio) e `LA-VARIOS-DIAS-1/2` em `lancamentoAtividades.test.jsx` (a lista abre o "+ Lançar dia" e o
  "Concluir" manda `{ empresa_id, versao, data_conclusao }`). Atualizados com asserções iguais ou mais fortes:
  LA-LISTA-1..5/7, LA-CABECALHO-1, LA-ERRO-1 (17 códigos), LA-FILTROS-1..3/5..9, LA-REGISTRAR-1/2; em
  `registroDeCampoNovaRealizacao.test.jsx`, a ordem das seções e o botão da barra; em `detalhesAreaHistorico.test.jsx`,
  a última seção ("Como fica depois de salvar?") e o destino com o andamento ("(em andamento, 12 de 22 ha)").

## 5. Telas (harness com os componentes reais e backend falso)

`out-varios-dias/` no scratchpad da sessão: lista no computador e no celular, "+ Lançar dia" (aberto e
preenchido), "Concluir" e a pergunta do parado, no celular. Comparadas com V1, V2, V3 e img02.

## 6. Pontos em aberto

- **Celular:** as pílulas continuam atrás do funil da barra (regra do motor, D-PROD-164), não visíveis como no V1;
  e cada serviço é um card separado (o V1 desenha uma lista contínua com divisórias).
- **Várias máquinas/pessoas no último dia:** abrem uma por vez no editor (a próxima depois de incluir ou cancelar
  a anterior), não todas de uma vez na tabela como no V2.
- **"Escolher outro"** do Planejamento (V2) não foi feito: o servidor ainda decide sozinho onde o registro entra.
- **"Planejada"** aparece também para a atividade aberta pelo "Planejar" sem nenhum dia lançado (a proposta dizia
  que só existiria com o "Planejar de serviços"); ela não tem "+ Lançar dia" na linha.
- **Tipo que exige produção:** com todas as áreas concluídas e sem produção, a atividade fica aberta ("Em andamento"
  na lista) até o "Concluir atividade" com a produção.
- **`nova_atividade: true` sem estar parada** é ignorado (continua na aberta), para nunca fechar um serviço ativo.
