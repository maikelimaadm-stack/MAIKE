# MAIKE — Várias áreas por atividade (relatório, D-PROD-249)

> **fatia:** várias áreas por atividade · **branch:** `feat/atividade-varias-areas` · **PR:** a abrir
> Decisão **D-PROD-249** (nasceu D-PROD-238; a `main` deu da 238 à 248 aos detalhes do mapa, PR #326) · a partir da `main` `e260a305` (PR #325, D-PROD-237) · contrato
> [`MAIKE-ATIVIDADE-AREAS-CONTRATO.md`](./MAIKE-ATIVIDADE-AREAS-CONTRATO.md) · runbook
> [`MAIKE-ATIVIDADE-AREAS-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-AREAS-RUNBOOK-RELEASE.md)

O proprietário: "Eu tenho uma atividade que é combate contra cigarrinha, e nessa atividade são vários pastos que vou
fazendo ao decorrer do tempo, alguns são rápidos outros lentos, porém cada custo e lançamento é feito para aquela
área. Eu não preciso ficar fazendo resumo de todo dia; os lançamentos vão de acordo com os dias." Ele recusou uma
atividade por área: é **uma** atividade com **várias** áreas, e cada lançamento datado é de uma área.

## 1. O que entra

| Camada | Entrega |
|---|---|
| Banco | Migration **CONTRACT** `20261118100000_atividade_areas` (CONVERSÃO, sem `DROP`; SHA-256 `098f0d06d45922886f64cb4e2f4bd00644dac26b833e8020feeed2632d31ec06`): tabela **`AtividadeArea`** (ciclo PLANEJADA → EM_ANDAMENTO → CONCLUIDA com CHECK das datas, 3 UNIQUE e 2 índices por `cliente_id`, 6 FKs RESTRICT, RLS), coluna **`AtividadeApontamento.atividade_area_id`** com FK composta de 4 colunas (a área é da mesma atividade) e índice; backfill da área nº 1 de cada atividade com área e dos lançamentos dela. Produção 67 → 68, 96 → 97 tabelas |
| Servidor | `atividadeAreaRepository.js`, `atividadeAreaService.js`, `atividadeAreaRoutes.js` (novos): adicionar, planejada, iniciar, concluir, reabrir, remover, com CAS por `versao`; `POST /atividades` com `areas[]` (e o `area_id` legado); cabeçalho sincronizado (1ª área, Σ planejadas); lançamento e linhas só em área EM_ANDAMENTO (implícita quando a atividade tem uma); concluir/reabrir a atividade levam as áreas; `por_area` nos totais (duas consultas agrupadas); `areas` e `areas_count` na lista; filtro `area_id` por qualquer área; 2 códigos de erro novos |
| Tela | "Abrir atividade" com **Áreas** (busca, marcar, lista das marcadas com a planejada editável e o total); card **"Áreas da atividade"** (Em andamento / A iniciar / Concluídas, contadores, Iniciar área com a data, ⚡ por área); janela do tipo com a área (seletor só das em andamento, ou fixa) e a lista daquele tipo na área em todos os dias, com a Data; coluna **Área** da lista ("2 de 5 em andamento"); Concluir atividade mostra o destino de cada área |
| Ops / gates | `MIGRATIONS_APROVADAS`, `DO_RLS_APROVADOS`, `MIGRATIONS_CONTRACT_APROVADAS` (D-PROD-249); preflight de schema do deploy exige `AtividadeArea.status` e `AtividadeApontamento.atividade_area_id`; runbook acoplado em `DOCS_ACOPLADOS`; ensaios e testes do runner com a 68ª pasta; scripts 01–04 do SQL Editor com a `AtividadeArea` (82 tabelas de tenant, 97 em `public`; sai depois do apontamento e antes da atividade) |

Não muda: o lançamento datado (o UNIQUE do dia é o mesmo), as linhas de custo, o abastecimento ligado, os totais da
atividade (a soma de tudo), a lista keyset e os filtros do servidor. Nada é apagado fisicamente, exceto a área
PLANEJADA sem nenhum lançamento (que não tem custo).

## 2. Escolhas registradas (onde o pedido deixava espaço)

1. **Atividade CANCELADA no backfill → área EM_ANDAMENTO.** A cancelada é só leitura; concluir a área exigiria
   inventar uma data de conclusão. Como a atividade não aceita escrita, a área "em andamento" nunca recebe lançamento.
2. **Reabrir a atividade reabre só as áreas concluídas na data de conclusão dela** (as que o "Concluir atividade"
   fechou). A área que o usuário concluiu antes, à mão, continua concluída.
3. **Remover área recusa qualquer lançamento, inclusive cancelado** (`ATIVIDADE_AREA_COM_LANCAMENTOS`, com as duas
   contagens): o lançamento cancelado continua apontando para a área (FK RESTRICT), e é histórico.
4. **`area_id` legado vira uma área já EM_ANDAMENTO** (início = início da atividade): o cliente antigo, que não
   conhece o "Iniciar área", continua lançando. Pelo formulário novo, toda área nasce PLANEJADA.
5. **Com uma área só, o lançamento não precisa dizer qual** (é implícita); com várias, `atividade_area_id` é
   obrigatório.
6. **`por_area` não inclui lançamento antigo sem área** (de atividade sem área): ele continua na soma da atividade.
7. **Abastecimento avulso** (sem lançamento) não tem área; o ligado segue o lançamento, que já é de uma área.
8. **Janela do tipo:** o subtítulo diz "Área:" (era "Talhão:"); a lista de todos os dias com a coluna Data só aparece
   na atividade **com** áreas — a atividade sem área mantém a lista do dia da D-PROD-233.
9. **`Atividade.area_id` continua preenchido** com a 1ª área (por `ordem`), e não nulo com várias: leitores antigos
   (filtros, relatórios, o ⚡ da lista) seguem funcionando.

## 3. Validação local (PostgreSQL 16 local; produção não foi tocada)

| Verificação | Resultado |
|---|---|
| `prisma validate` / `migrate deploy` das 68 / `migrate diff --exit-code` | válido / 68 / 0, sem drift |
| Classificador (`premergeMigrateLib`) | `CONTRACT`, `violacoes: []`, D-PROD-249, conversões `INSERT INTO AtividadeArea`, `UPDATE AtividadeApontamento`, `ADD CONSTRAINT AtividadeApontamento.AtividadeApontamento_atividade_area_fkey` |
| `atividadeAreasMigration` (runbook de ponta a ponta: partida 67, portão, guarda, concorrência, runner, backfill, FK, envelope com o SID, postcheck) | 13/13 |
| `atividadeAreas` (servidor: abertura, legado, ciclo, lançamento, FK, remover, PATCH antigo, concluir/reabrir, `por_area`, tenant) | 13/13 |
| Migrations antigas (12 arquivos `*Migration.test.mjs`: 10 rodam no "dia" da D-PROD-223 via `backend/tests/diaDaD223.mjs` — espelho do runner e o schema sem as áreas, igual ao da `main` a menos de uma linha em branco; categoria de manejo e patrimônio contam a 68ª) | 12/12 arquivos, 0 falhas |
| `scripts/tests/deploy` (premerge-migrate, migrations, alvo-banco, preflight-schema) | 310/310 |
| suíte backend inteira (`npm run test:backend`, 175 arquivos, 68 migrations) | **2355 testes: 2349 passaram, 0 falhas, 6 `todo`** |
| `test:smoke` (inclui `atividadeAreas.test.jsx`, 10 novos) | **293 arquivos, 3656 testes, 0 falhas** |
| `verify-all --pular=test:backend` | **TODAS AS ETAPAS PASSARAM** (gates, `gate:types`, `typecheck:backend`, lint, smoke, build, build:admin) |
| Runbook local (banco de 67 com o SID trocado) | preflight **PRONTO** → envelope → postcheck **APLICADA E CONFERIDA** |

### 3.1 O que a 1ª rodada da suíte inteira pegou (corrigido)

A 1ª rodada da suíte backend teve 21 falhas em 3 arquivos, todas de registro, nenhuma de regra: o "Repetir" da tela
agora herda a área do lançamento base (`atividadeIntegracaoTela`, a expectativa ganhou `atividade_area_id`) e os
scripts 01–04 do SQL Editor não conheciam a `AtividadeArea` (`sqlEditorBootstrap`, `sqlEditorPreservaMaike`). Depois
da correção, os 3 arquivos passam (13, 15 e 7) e a 2ª rodada inteira é a da tabela acima.

A renumeração D-PROD-238 → D-PROD-249 (depois das rodadas) só troca o identificador em comentários, mensagens de teste
e na `decisao` da entrada CONTRACT; o `migration.sql` e os hashes não mudam. Depois dela rodaram de novo: os testes do
runner (`scripts/tests/deploy`, 310/310), `verify-all --pular=test:backend` (todas as etapas; smoke 3656/3656) e os
arquivos backend que citam o número ou o dia da D-PROD-223 (`atividadeAreasMigration`, `atividadeAreas`,
`atividadeNativo`, `atividadeIntegracaoTela`, `sqlEditorBootstrap` e os 12 `*Migration.test.mjs`), todos sem falha.

## 4. Telas (1440×900 e 390×844, DPR 2, harness local com respostas falsas)

Lista com a coluna Área ("2 de 5 em andamento"); a atividade aberta com o card "Áreas da atividade"; Concluídas
abertas; o ⚡ de uma área; a janela "Trabalho de máquinas" presa na área, nos Dados e na lista com a Data; o diálogo
Iniciar área; "Abrir atividade" com 3 áreas marcadas e a lista; as mesmas no celular.

## 5. Release

**Não aplicada. `SCHEMA_APPLIED_PROD: NÃO`.** Só com o GO explícito e escrito do proprietário para esta migration,
pelo runbook (migration antes do merge, D-PROD-72): preflight com veredito (SID `7692130048193495360`, 67/0, a
anterior com o checksum `c391e4b0…`, tabela e coluna ausentes, 96 tabelas), envelope do caminho B e postcheck (68/0,
97 tabelas, áreas = atividades com área, por status, lançamentos com área = lançamentos dessas atividades). Esperado
em produção: 4 áreas criadas (5 atividades, 1 sem área).

## 6. Em aberto

- Nenhum bloqueio. As escolhas do §2 podem ser revistas pelo proprietário sem migration nova (são regras do servidor),
  exceto o item 1 (o backfill), que só vale no momento da aplicação.
