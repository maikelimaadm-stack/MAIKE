# MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO — relatório do ajuste da Fatia 4 do Lançamento de Atividades

> **fatia 4 (ajuste) · `feat/atividade-mao-obra-parceiro` · PR #298**
>
> Decisão **D-PROD-208** · contrato [`MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-CONTRATO.md`](./MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-CONTRATO.md) ·
> runbook [`MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-RUNBOOK-RELEASE.md)

## 1. O que é

O ajuste que o proprietário pediu logo depois da Fatia 4 entrar em produção: "o cadastro de funcionários deveria ser lá
em parceiros, outra coisa, eu também tenho mão de obra com terceiros não apenas com funcionários […]". O **funcionário**
deixa de ser cadastro próprio e passa a ser **papel do parceiro** (tela Parceiros), com tipo, cargo e custos; a **mão de
obra** do apontamento passa a ser de um parceiro: **funcionário** (custo da hora e da diária copiado do papel) ou
**terceiro** (prestador de serviço, custo digitado). A tabela e a tela Funcionário saem; em produção estão vazias.

## 2. O que entrou

| Camada | Entrega |
|---|---|
| Banco | `Fornecedor` + 4 colunas anuláveis `funcionario_*` e o CHECK do papel; `AtividadeApontamentoMaoObra` sem `funcionario_id`, com `parceiro_id` e `origem` `NOT NULL`, o CHECK da origem, a FK composta para `Fornecedor` (`RESTRICT`) e o índice `(cliente_id, parceiro_id)`; `Funcionario` fora. Tabelas 95 → 94 (de tenant, 80 → 79) |
| Migration | `20261116000000_mao_obra_parceiro`, **CONTRACT condicionado a tabelas vazias** (`drop_no_fim`, zero violações no portão). SHA `65a8a4eb…`, guarda `9ec960b5…`. Aplicar antes do merge e mergear logo em seguida |
| Parceiros | Papel `funcionario` com tipo, cargo e custos (sem o papel → `PARCEIRO_FUNCIONARIO_SEM_PAPEL`); tirar o papel limpa os 4; auditoria com o tipo e os custos como valor e o cargo como `tem_funcionario_cargo` |
| Mão de obra | `parceiro_id` no corpo; `origem` decidida pelo servidor; funcionário com snapshot (hora/diária) e tarefa digitada; terceiro com custo sempre digitado; edição mantém a origem gravada; seletor `GET /atividades-opcoes/mao-obra` |
| Tela | Papel Funcionário com os campos em Parceiros; seletor de mão de obra com funcionários e terceiros; tela Funcionários fora |
| Portão e operação | Entrada CONTRACT pinada e pin do arquivo em `premergeMigrateLib.mjs` (cauda `drop_no_fim` sem conversão); colunas exigidas no preflight de schema; scripts do SQL Editor sem a `Funcionario` (lista e `LOCK`; 79 de tenant, 94 em `public`); contagens 59 / 94 nos testes das migrations anteriores; o runner "no dia" (`backend/tests/espelhoDoRunner.mjs`) para os GREEN das migrations antigas; teste da migration e runbook com os blocos SQL executados |

## 3. Agentes

| Agente | Entrega |
|---|---|
| E (orquestrador) | Schema e rascunho da migration |
| E1 | Backend (parceiro com o papel, linha de mão de obra pelo parceiro, seletor, totais) |
| E2 | Telas (Parceiros, mão de obra do apontamento) |
| E3 | Portão da migration (forma CONTRACT, pins), contagens 58 → 59 / 95 → 94, teste da migration, runbook, SQL Editor, governança e este relatório |

## 4. Decisões e pontos para o proprietário

1. **A migration apaga a tabela `Funcionario` e a coluna `funcionario_id`.** Só roda com as duas tabelas vazias (a
   guarda trava e confere); com qualquer linha, nada é aplicado e é preciso decisão nova.
2. **Janela curta entre a aplicação e o deploy:** a tela Funcionários e a mão de obra do código de hoje dão 500 até o
   merge. O Instant Rollback deixa de ser seguro depois da aplicação (§9 do runbook).
3. **Travas:** por menos de 1 s, `Cliente`, `Empresa`, `Fornecedor`, `Funcionario` e `AtividadeApontamentoMaoObra`
   ficam em `ACCESS EXCLUSIVE` (inclusive o login espera): aplicar fora de pico.
4. **Sem financeiro e sem folha**, como na D-PROD-207.
5. **Constituição:** a nota "Ajuste (D-PROD-208)" no `00` e no `07` foi redigida pelo agente e **vale só com a sua
   aprovação no merge**.

## 5. Validação (local; o GitHub Actions está pausado)

Tudo local, com o GitHub Actions pausado pelo proprietário (commit `7315dc00`):

- **Backend completo** (PostgreSQL 16): 2169 testes, 2164 passaram, **0 falhas** (5 `todo`).
- **`verify-all` sem backend:** TODAS AS ETAPAS PASSARAM (inclui o smoke completo).
- **`test:gates`:** 951/951; typecheck sem regressão; lint sem erro; `scripts/tests/deploy`: 223/223.
- **Da fatia:** migration 13/13, mão de obra 23/23, serviço 12/12, integração real tela ↔ servidor 13/13, smoke das linhas 38/38, Parceiros 23/23.
- **Revisão independente (E4):** sem achado grave nem de segurança; os 3 baixos (Repetir pela origem atual, chave do totalizador, voltar ao parceiro gravado) corrigidos com teste.
- Uma rodada anterior do backend falhou só em `inicializarTenantMaikeCli` IT-10 enquanto outros agentes criavam e apagavam bancos no mesmo Postgres; o arquivo passa sozinho (11/11) e a rodada limpa acima passou inteira.

Do E3, até aqui: `node --test scripts/tests/deploy/*.mjs` 223/223 (premerge-migrate com B27a–B27m e migrations com B20);
`npm run -s test:gates` 951/951; `atividadeMaoObraParceiroMigration` 13/13; nos testes das migrations anteriores, com a
D-PROD-208: `atividadeMaoObraMigration` 12/12, `atividadeLinhasMigration` 11/11, `atividadeCabecalhoMigration` 28/28,
`tipoAtividadeDefaultsMigration` 25/25, `cadCategoriaCurvaGanhoMigration` 10/10, `cadCurvaGanhoMensalMigration`
10/10, `categoriaManejoCadcategoriaMigration` 20/20, `patrimonioSimplificaMigration` 14/14, `sqlEditorBootstrap`
14/14, `patrimonioP1Seguranca` 12/12, `tipoTarefaDropColunasMigration` 15/15, `estoqueP1M7TransacaoMigration` 8/8,
`alvoMigrationDuplaConexao` 4/4.

## 6. Release

`<placeholder: não aplicada — só com o GO explícito e escrito do proprietário, pelo runbook; preencher horário, caminho, checksum e postcheck>`

## 7. Fora do escopo

- Folha de pagamento, salário, encargos, ponto, pagamento, lançamento financeiro, título, rateio e contrato de serviço.
- Abastecimento ligado à atividade: Fatia 5.
