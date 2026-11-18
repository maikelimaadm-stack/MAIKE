# MAIKE — Várias áreas por atividade (contrato, D-PROD-249)

> Branch `feat/atividade-varias-areas`, a partir da `main` `e260a305` (merge da PR #325, D-PROD-237).
> Pedido do proprietário: "Eu tenho uma atividade que é combate contra cigarrinha, e nessa atividade são vários pastos
> que vou fazendo ao decorrer do tempo, alguns são rápidos outros lentos, porém cada custo e lançamento é feito para
> aquela área. Eu não preciso ficar fazendo resumo de todo dia; os lançamentos vão de acordo com os dias."
> O protótipo HTML dele abria **uma atividade por área**; ele recusou isso: quer **uma** atividade com **várias** áreas.
> O fluxo de referência (escolher quantas áreas a atividade tem; a lista das escolhidas aparece à medida que marca) é
> só a lógica: os textos, o visual e os nomes são do MAIKE ("Várias áreas").
>
> Relatório: [`MAIKE-ATIVIDADE-AREAS-REPORT.md`](./MAIKE-ATIVIDADE-AREAS-REPORT.md) · Runbook:
> [`MAIKE-ATIVIDADE-AREAS-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-AREAS-RUNBOOK-RELEASE.md) · Decisão:
> [D-PROD-249](./DECISIONS.md).

## 0. Estado de partida (produção, fatos de só leitura passados pela coordenação)

- 67 migrations, 0 em aberto; 96 tabelas. Última: `20261117300000_descanso_e_alturas_por_area` (D-PROD-223,
  checksum `c391e4b0c28dbefdafa8d0819d948efde952bf8ee5adc20ff58aa930239b477e`).
- `Atividade`: 5 linhas (1 com `area_id` nulo). `AtividadeApontamento`: 5 linhas.
- `Atividade` tem **uma** área opcional (`area_id`, o setor em snapshot, `area_planejada`); a área executada é a soma
  das `area_executada_dia` dos lançamentos confirmados. O lançamento (`AtividadeApontamento`) é datado
  (`data_operacional`, `turno`, `sequencia`) e as linhas de custo (produto, máquina, mão de obra, serviço) e os
  abastecimentos ligados (D-PROD-211/217) são dele.

## 1. Ciclo da área

```
PLANEJADA ──Iniciar área (data_inicio)──▶ EM_ANDAMENTO ──Concluir área (data_conclusao)──▶ CONCLUIDA
                                               ▲                                               │
                                               └──────────────── Reabrir área ─────────────────┘
```

| Status | Na tela | Recebe lançamento | Datas (CHECK no banco) |
|---|---|---|---|
| `PLANEJADA` | **A iniciar** | não | `data_inicio` e `data_conclusao` nulas |
| `EM_ANDAMENTO` | **Em andamento** | **sim** | `data_inicio` preenchida, `data_conclusao` nula |
| `CONCLUIDA` | **Concluída** | não | as duas preenchidas, `data_conclusao ≥ data_inicio` |

- **Iniciar**: `data_inicio` padrão = hoje no fuso da fazenda; nunca no futuro; nunca antes do início da atividade.
- **Concluir**: `data_conclusao` padrão = hoje; nunca no futuro; nunca antes do início da área.
- **Reabrir**: CONCLUIDA → EM_ANDAMENTO (o início fica, a conclusão sai).
- **Remover**: só PLANEJADA **e** sem nenhum lançamento (nem cancelado). É o único DELETE físico, e não tem custo.
- Toda escrita de área exige a **atividade ABERTA** e a `versao` da área (CAS; conflito = 409 com a versão atual).

**Com a atividade:**
- **Abrir atividade** (formulário): as áreas marcadas entram **PLANEJADA** ("a iniciar"); a planejada de cada uma
  vem do tamanho da área (editável).
- **Concluir atividade**: as áreas EM_ANDAMENTO são concluídas **na mesma data**; as PLANEJADA ficam como estão
  ("não iniciadas"), e o diálogo de conclusão mostra o que acontece com cada uma.
- **Reabrir atividade**: as áreas concluídas **na data de conclusão da atividade** voltam a EM_ANDAMENTO (as que o
  usuário concluiu antes, à mão, continuam concluídas).
- **Cancelar atividade**: as áreas ficam como estão (a atividade cancelada é só leitura).

## 2. Banco (uma migration, `20261118100000_atividade_areas`)

### 2.1 Tabela nova `AtividadeArea` (tenant-scoped, R9)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `VarChar(64)` (cuid) | PK |
| `cliente_id`, `empresa_id` | `VarChar(64)` NOT NULL | tenant e fazenda |
| `atividade_id` | `VarChar(64)` NOT NULL | FK (`cliente_id`, `empresa_id`, `atividade_id`) → `Atividade`, RESTRICT |
| `area_id` | `VarChar(64)` NOT NULL | FK (`cliente_id`, `area_id`) → `AreaPastagem`, RESTRICT |
| `setor_id`, `setor_nome` | NULL | **snapshot** do setor da área, como a `Atividade` faz |
| `area_planejada` | `Decimal(14,4)` NULL | ≥ 0 (CHECK) |
| `status` | `VarChar(16)` NOT NULL default `'PLANEJADA'` | o ciclo do §1 (CHECK com as datas) |
| `data_inicio`, `data_conclusao` | `Date` NULL | coerência no CHECK do §1 |
| `ordem` | `Int` NOT NULL | ≥ 1; a 1ª é a "principal" (cabeçalho) |
| `criado_por_usuario_id` | NULL | FK → `Usuario`, RESTRICT |
| `versao` | `Int` NOT NULL default 1 | ≥ 1 (CAS) |
| `createdAt`, `updatedAt` | | |

- UNIQUE (`cliente_id`, `id`), UNIQUE (`cliente_id`, `empresa_id`, `atividade_id`, `area_id`) — **a mesma área não
  entra duas vezes na atividade** — e UNIQUE (`cliente_id`, `empresa_id`, `atividade_id`, `id`), alvo da FK composta.
- Índices (`cliente_id`, `area_id`) e (`cliente_id`, `setor_id`). Tudo começa por `cliente_id` (R10).
- RLS habilitado como as demais tabelas (`DO` pinado em `DO_RLS_APROVADOS`).

### 2.2 `AtividadeApontamento.atividade_area_id`

- `VarChar(64)` **NULL**, sem default.
- FK **`AtividadeApontamento_atividade_area_fkey`** (`cliente_id`, `empresa_id`, `atividade_id`, `atividade_area_id`)
  → `AtividadeArea`(`cliente_id`, `empresa_id`, `atividade_id`, `id`), `ON DELETE RESTRICT ON UPDATE CASCADE`:
  **o banco prova que a área do lançamento é da mesma atividade** (como a D-PROD-217 fez com o abastecimento).
  `MATCH SIMPLE`: lançamento com área nula continua válido (atividade sem áreas).
- Índice `AtividadeApontamento_atividade_area_idx` (`cliente_id`, `empresa_id`, `atividade_id`, `atividade_area_id`).
- O UNIQUE do dia (`cliente_id`, `atividade_id`, `data_operacional`, `turno`, `sequencia`) **não muda**: a
  sequência continua por atividade, dia e turno; duas áreas no mesmo dia são dois lançamentos com sequências
  diferentes.

### 2.3 Backfill (na mesma migration)

- Cada `Atividade` **com** `area_id` ganha a área nº 1: `id` = `'ara_' || atividade.id`; `area_planejada`, setor e
  autor da atividade; `createdAt` da atividade.
- A área já tinha começado: `data_inicio` = `data_inicio` da atividade, senão o dia do 1º lançamento, senão o dia da
  criação — e nunca depois da conclusão.
- `CONCLUIDA` (com a `data_conclusao` da atividade) se a atividade está concluída; senão **`EM_ANDAMENTO`** — a
  **CANCELADA também**: ela é só leitura, e concluir a área exigiria inventar uma data de conclusão.
- Os lançamentos dessas atividades recebem `atividade_area_id` dessa área.
- Atividade **sem** área: nada muda (lançamentos com área nula). Nenhuma linha é apagada; nenhum valor existente muda.
- Produção esperada: 4 áreas criadas (5 atividades, 1 sem área); os lançamentos das 4 ganham a área.

### 2.4 Classe e guarda

- **CONTRACT** no formato **CONVERSÃO**, **sem `DROP`**: a allowlist EXPAND recusa DML (o backfill) e a FK de tabela
  antiga para a tabela nova. Entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS` (`decisao: 'D-PROD-249'`, `drop: []`,
  `alter_antigas`: o `ADD COLUMN`; `conversao`: o `INSERT`, o `UPDATE` e o `ADD CONSTRAINT` da FK).
- Guarda pinada (`guarda_sha256`): `lock_timeout` 5 s, `statement_timeout` 120 s, trava 72707369; confere as 3 tabelas
  antigas, a ausência de `AtividadeArea` e da coluna, a presença do UNIQUE (`cliente_id`, `empresa_id`, `id`) da
  `Atividade`; trava `AreaPastagem` em `SHARE ROW EXCLUSIVE` e `Atividade`/`AtividadeApontamento` em
  `ACCESS EXCLUSIVE` (as referenciadas primeiro, na ordem do código); recusa atividade CONCLUIDA com área e sem
  `data_conclusao` (o CHECK da área recusaria no meio).
- Produção 67 → 68 migrations; 96 → 97 tabelas. Hashes e o classificador no runbook §0.

## 3. Servidor

### 3.1 Abertura e cabeçalho (`POST /atividades`, `atividadeService.js`)

- Corpo novo: `areas: [{ area_id, area_planejada? }]`, 1 a 100, sem repetição; cada área da mesma fazenda e ativa.
  Atômico com a atividade. Todas entram **PLANEJADA**; a planejada padrão é o tamanho da área.
- `areas` junto com `area_id` ou `area_planejada` → 400 (`areas_e_area_id`): uma forma só por pedido.
- **Legado** `area_id` (uma área) continua aceito: vira **uma** área já **EM_ANDAMENTO** com `data_inicio` = início
  da atividade (o cliente antigo continua lançando sem passo novo).
- **Cabeçalho sincronizado** a cada mudança de área: `Atividade.area_id` = a área de menor `ordem` (e o setor dela);
  `Atividade.area_planejada` = Σ das planejadas (nula se nenhuma tem). Assim leitores antigos de `area_id` (filtros,
  relatórios) continuam funcionando.
- `PATCH /atividades/:id` (compatibilidade): com **várias** áreas, mudar `area_id`/`area_planejada` → 422
  (`varias_areas`, use as rotas da área); com **uma**, troca a área se ela não tem lançamento (senão 409
  `com_lancamentos`); com **nenhuma**, cria a área já EM_ANDAMENTO.
- **Duplicar** copia as áreas como PLANEJADA.
- **Concluir / reabrir** atividade: §1.
- **Lista** (`GET /atividades`): cada item traz `areas` (resumo) e `areas_count`; o filtro `area_id` passa a casar
  com **qualquer** área da atividade.

### 3.2 Rotas da área (`atividadeAreaRoutes.js`, guarda `GUARDAS.atividades.editar`)

Corpo fechado (`additionalProperties: false`), tenant só do `auth_context` (R11), `empresa_id` e `versao` no corpo.

| Rota | Corpo | Efeito |
|---|---|---|
| `POST /atividades/:id/areas` | `area_id`, `area_planejada?` | adiciona área PLANEJADA (repetida → 422 `ja_na_atividade`) |
| `PATCH /atividades/:id/areas/:areaId` | `versao`, `area_planejada` | planejada (em qualquer status) |
| `POST …/:areaId/iniciar` | `versao`, `data_inicio?` | PLANEJADA → EM_ANDAMENTO |
| `POST …/:areaId/concluir` | `versao`, `data_conclusao?` | EM_ANDAMENTO → CONCLUIDA |
| `POST …/:areaId/reabrir` | `versao` | CONCLUIDA → EM_ANDAMENTO |
| `POST …/:areaId/remover` | `versao` | apaga a PLANEJADA sem lançamento |

Respostas: `{ area, atividade }` (`{ removida, atividade }` no remover), para a tela trocar as duas sem reler.
Erros novos: `ATIVIDADE_AREA_NOT_FOUND` (404) e `ATIVIDADE_AREA_COM_LANCAMENTOS` (409, com `confirmados` e
`cancelados`). Status errado → 409 `ATIVIDADE_STATUS_INVALIDO` com a ação (`iniciar_area`, `lancar_na_area`…).
Remover a última área de um tipo que exige área → 422 `ATIVIDADE_EXIGIDA_PELO_TIPO`.

### 3.3 Lançamento

- `atividade_area_id` no corpo do lançamento (criar, duplicar, editar) e lido nas linhas por linha (que criam o dia
  implicitamente, D-PROD-233).
- Atividade **com** áreas: com **uma** área, ela é implícita; com **várias**, `atividade_area_id` é obrigatório
  (422 `obrigatorio`). A área tem de ser da atividade e **EM_ANDAMENTO** (PLANEJADA ou CONCLUIDA → 409
  `lancar_na_area`). Atividade **sem** áreas: como hoje (e `atividade_area_id` → 422 `sem_areas`).
- Lançar linha (produto, máquina, mão de obra, serviço) num lançamento cuja área não está EM_ANDAMENTO → 409.
- A data do lançamento é a de sempre (`data_operacional`); nada exige "resumo do dia".

### 3.4 Totais (`GET /atividades/:id/totais`)

- Os totais da atividade não mudam (a soma de tudo).
- Novo `por_area: [{ atividade_area_id, area, status, data_inicio, data_conclusao, area_planejada, area_executada,
  percentual, custo_total, custo_por_tipo, custo_por_ha, combustivel, ultimo_lancamento, lancamentos_confirmados,
  lancamentos_cancelados }]`, em **duas consultas agrupadas** (lançamentos por área; custos por área com `UNION ALL`
  das linhas e dos abastecimentos ligados), tenant do `auth_context`, só CONFIRMADOS. Lançamento antigo sem área não
  entra em nenhuma área (entra na soma da atividade).

## 4. Tela

- **Abrir atividade**: o campo Área vira **"Áreas"** com busca e caixas de marcar; as marcadas aparecem embaixo:
  Área · Setor · Tamanho (ha) · Área planejada (ha, editável, padrão o tamanho) · ✕, e a linha de total. Na edição,
  as áreas aparecem só leitura (mudam pelo card).
- **Atividade aberta**: card principal **"Áreas da atividade"** com os contadores ("2 em andamento · 3 a iniciar ·
  0 concluídas") e três grupos: **Em andamento** (Planejada, Feita, %, Custo, Custo/ha, Iniciada em, Último
  lançamento), **A iniciar** (Setor, Planejada e o botão **Iniciar área**, com a data) e **Concluídas** (recolhido;
  Reabrir). ⚡ por área: os quatro tipos de lançamento (abrem a janela do tipo **presa na área**), Ver lançamentos da
  área, Concluir / Reabrir / Iniciar, Área planejada, Remover (só a iniciar sem lançamento). **+ Adicionar área**.
  O Resumo de custo da atividade continua (a soma); "Dias lançados" continua acessível, secundário.
- **Janela do tipo** (D-PROD-233): seletor de **Área** (só as EM_ANDAMENTO) ou a área fixa quando aberta do ⚡ da área;
  o dia do lançamento continua; a lista mostra **os lançamentos daquele tipo naquela área em todos os dias**, com a
  coluna **Data**. Sem área em andamento: "Nenhuma área em andamento — inicie uma área para lançar", com o botão.
- **Lista**: coluna **Área** = o nome da única área, ou "2 de 5 em andamento" quando há várias.
- **Concluir atividade**: o diálogo lista as áreas ainda não concluídas: as em andamento "concluem junto" (na data
  escolhida) e as a iniciar "ficam não iniciadas".

## 5. Fora do escopo

- Uma atividade por área (recusado pelo proprietário).
- Resumo diário obrigatório (não existe; o lançamento datado basta).
- Área do abastecimento avulso (o abastecimento ligado segue o lançamento, que já é de uma área).
- Mover um lançamento de uma área para outra (cancelar e lançar de novo).
