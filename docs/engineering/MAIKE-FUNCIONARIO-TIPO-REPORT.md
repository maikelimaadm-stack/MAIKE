# MAIKE-FUNCIONARIO-TIPO — relatório do ajuste do tipo do funcionário

> **ajuste · `feat/funcionario-tipo-terceirizado` · PR (a abrir)**
>
> Decisão **D-PROD-209** · runbook [`MAIKE-FUNCIONARIO-TIPO-RUNBOOK-RELEASE.md`](./MAIKE-FUNCIONARIO-TIPO-RUNBOOK-RELEASE.md)

## 1. O que é

Pedido do proprietário: "por enquanto deixe a escolha assim, mensalista, diárias, terceirzado". O tipo do funcionário
(papel `funcionario` do parceiro, D-PROD-208) passa a ser **Mensalista, Diarista ou Terceirizado**: o valor
`TERCEIRIZADO` entra no lugar de `TAREFEIRO`. Em produção nenhum parceiro tem `funcionario_tipo` preenchido.

## 2. O que entrou

| Camada | Entrega |
|---|---|
| Banco | migration CONTRACT `20261116100000_funcionario_tipo_terceirizado`: guarda (CHECK ainda com `TAREFEIRO`; `Fornecedor` travada em `ACCESS EXCLUSIVE`; aborta com qualquer parceiro `TAREFEIRO`), `DROP CONSTRAINT "Fornecedor_funcionario_check"` e o `ADD CONSTRAINT` igual com `TERCEIRIZADO`. SHA-256 `44dd42d800de7b5db034af1c42e0b0425f18666b5e73d260ed599d95d73adab6`, guarda `93612d85d6cc9ec3c39b9586619deedb8db72e5198d1ab64fa3ee9d8e911cca9`. 59 → 60 migrations, 94 tabelas. `schema.prisma`: só o comentário |
| Portão | `MIGRATIONS_APROVADAS` + a 9ª entrada de `MIGRATIONS_CONTRACT_APROVADAS` (D-PROD-209, formato de sempre: `drop: []`, 2 `alter_antigas`, literais `Fornecedor` e `TAREFEIRO`); o descritor declara `constraints_alargadas: ["Fornecedor.Fornecedor_funcionario_check"]` (mesmo nome, recriado; rótulo do runner "1 CHECKs alargados") |
| Servidor | `TIPOS_FUNCIONARIO = MENSALISTA, DIARISTA, TERCEIRIZADO` (`fornecedorDominio.js`; o schema da rota de Parceiros e a validação do legado `/fornecedores` leem dele): `TAREFEIRO` → 400 |
| Tela | Parceiros: "Mensalista", "Diarista", "Terceirizado" (o tipo continua obrigatório com o papel Funcionário). Mão de obra: medida sugerida Mensalista → hora, Diarista → diária, **Terceirizado → hora**; a medida `TAREFA` continua, escolhida na linha |
| Testes | `funcionarioTipoTerceirizadoMigration.test.mjs` (novo, roda os blocos do runbook); `premerge-migrate` B28a–B28m e `migrations.test.mjs` B21 (barreira do runner); os testes de migration que contavam as pastas ou aplicavam as CONTRACT posteriores pelo runner com a conferência passaram a 60 e a subir a D-PROD-208 pelo espelho do dia dela (`espelhoDoRunner.mjs`) e a D-PROD-209 pelo repositório com a decisão dela; Parceiros, mão de obra e integração tela↔servidor com `TERCEIRIZADO` |

## 3. Release

Só com o GO do proprietário, **antes do merge**, pelo runbook (caminho A `--contract D-PROD-209` ou o envelope do
caminho B, guardas `n_ok <> 59`, a anterior `20261116000000_mao_obra_parceiro` com o checksum `65a8a4eb…` e nenhum
parceiro `TAREFEIRO`). A janela não põe dado em jogo: código de hoje + migration só não grava Tarefeiro; código novo sem
a migration só não grava Terceirizado. O Instant Rollback continua seguro.

**Aplicada em produção em 2026-11-16** com o GO escrito do proprietário ("pode aplicar"), pelo caminho B: preflight
todo OK (59/0, nenhum `TAREFEIRO`, CHECK antigo presente, 94 tabelas), envelope com a migration integral (SHA
`44dd42d8…`) e postcheck **APLICADA E CONFERIDA** (60/0, CHECK novo com `TERCEIRIZADO` validado, 94 tabelas).
Registro no §9 do runbook.

## 4. Validação local (GitHub Actions pausado)

PostgreSQL 16 local, banco `maike_f5_f1`: `prisma migrate deploy` das 60 e `migrate diff --exit-code` sem drift.
Resultados no §5.

## 5. Resultados

| Verificação | Resultado |
|---|---|
| `prisma migrate deploy` das 60 / `migrate diff --exit-code` | 60 / 0, sem drift (exit 0) |
| `funcionarioTipoTerceirizadoMigration` (novo) | 12/12 |
| `atividadeMaoObraParceiroMigration` (D-PROD-208, no dia dela + MP-08 ordem de produção) | 14/14 |
| `atividadeMaoObraMigration` | 12/12 |
| `atividadeLinhaMaoObra` · `gestaoP1Cadastros` · `atividadeIntegracaoTela` | 23/23 · 23/23 · 13/13 |
| testes de migration ajustados à 60ª pasta (`atividadeCabecalho`, `atividadeLinhas`, `cadCategoriaCurvaGanho`, `cadCurvaGanhoMensal`, `categoriaManejoCadcategoria`, `patrimonioSimplifica`, `tipoAtividadeDefaults`, `tipoTarefaDropColunas`) | 28/28 · 11/11 · 10/10 · 10/10 · 20/20 · 14/14 · 25/25 · 15/15 |
| suíte backend inteira (antes dos ajustes acima) | 2152/2183: as falhas eram só nesses testes de migration, depois corrigidos e rodados de novo, cada um sozinho (tabela acima) |
| `node --test scripts/tests/deploy/*.mjs` | 240/240 |
| `npm run test:gates` | 968/968 |
| `npm run typecheck` · `npm run lint` | passa (sem regressão) · 0 erros |
| `verify-all --pular=test:backend` | todas as etapas passaram (smoke 2978/2978, build) |
