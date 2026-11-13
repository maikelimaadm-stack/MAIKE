# MAIKE-CADESTACOES-CADASTRO — Relatório

**Branch `claude/kind-knuth-tztu1v` · PR em rascunho** · Decisão: [D-PROD-188](./DECISIONS.md) ·
Runbook: [`MAIKE-CADESTACOES-RUNBOOK-RELEASE.md`](./MAIKE-CADESTACOES-RUNBOOK-RELEASE.md)

## 1. Entrega

Cadastro de **Estações da fazenda**: períodos de ÁGUAS, TRANSIÇÃO ou SECA, com
data de início e de fim, por fazenda. Tabela física **`"CADESTACOES"`**, nome
pedido pelo proprietário. Primeira fatia, **sem vínculo** com lote, categoria,
curva ou qualquer outro cadastro: o objetivo é começar a guardar o histórico dos
períodos de cada fazenda.

| Camada | O que entrou |
|---|---|
| Banco | model `CadEstacao` com `@@map("CADESTACOES")` (primeiro `@@map` do schema), relações inversas em `Cliente` e `Empresa`, migration EXPAND `20261113400000_cadestacoes_cadastro`: tabela, 2 FKs de escopo (`Restrict`), 2 CHECKs (`tipo`, `data_fim >= data_inicio`), 2 uniques, 2 índices, RLS/REVOKE |
| Release | manifesto e hash do DO pinados no `premergeMigrateLib.mjs` (classificador: `EXPAND`, sem violação); SQL editor 01–04 (66 tabelas de tenant, 81 no total); contagens nos testes e ensaios (43 migrations); runbook com caminho A e B |
| Backend | módulo `estacoes` (repositório, serviço, rotas): lista e detalhe por fazenda, criação, `PATCH`, exclusão física; regra de **não sobreposição** entre estações ativas da mesma fazenda, sob trava de escopo; tela `pec-estacoes` (leitura também pela tela); erros `ESTACAO_NOT_FOUND` (404), `ESTACAO_NAME_CONFLICT` (409), `ESTACAO_PERIODO_SOBREPOSTO` (409) |
| Frontend | API `src/apis/estacoes`, serviço, formulário (Nome, Tipo, Data de início, Data de fim, Ativo, Observações), tabela com coluna calculada **Dias**, página `Estacoes`, menu Manejo → Estações, ícone mobile `CloudSun`, `vercel.json` regenerado, catálogo de erros, rótulo do vínculo na exclusão de empresa |
| Docs | D-PROD-188, este relatório, runbook, `CURRENT-STATE`, cobertura de endpoints (+5 rotas classe a) |

## 2. Por que assim

- **Por fazenda (`empresa_id`).** Águas e seca dependem do lugar; duas fazendas
  do mesmo cliente podem ter calendários diferentes. A FK com a Empresa é o
  escopo, não vínculo de negócio.
- **Datas (dia civil), não meses.** Guardar o dia real em que cada período
  começou e terminou é o que permite, no futuro, saber "a seca de 2027 começou
  em 12/05". O calendário mês a mês pode ser derivado depois.
- **Sem sobreposição entre ativas.** Cada dia da fazenda pertence a no máximo uma
  estação ativa. É a condição para a futura curva de ganho por estação não ter
  ambiguidade. A estação **inativa** fica fora da regra: dá para guardar um
  período previsto ao lado do real.
- **Nome físico `CADESTACOES` via `@@map`.** O código continua com o nome Prisma
  (`CadEstacao`, delegate `cadEstacao`), no mesmo padrão `CAD…` que a D-PROD-187
  prevê para `CADCATEGORIA`. Em SQL cru o nome precisa de aspas: `"CADESTACOES"`.

## 3. Validação local (PostgreSQL 16 descartável)

| Comando | Resultado |
|---|---|
| `backend/tests/estacaoNativo.test.mjs` | 22/22 |
| `permissoesR2Rotas`, `patrimonioSimplificaMigration`, `tipoTarefaDropColunasMigration`, `sqlEditorBootstrap` | todos passaram |
| `scripts/tests/deploy/premerge-migrate.test.mjs` | 41/41 |
| smoke `estacoes`, `scope`, `vercelSpaRoutes`, `tiposAtividade` | 42/42 |
| gates estáticos (escopo, API, imports, closure, segredos, tenancy, índices, base44, governança, grants, deploy, ledger, motor, admin) | todos passaram |
| `gate:types` (625/625), `typecheck:backend`, `eslint` dos arquivos novos | passaram |
| `prisma migrate diff` (banco migrado × schema) | sem diferença |
| `npm run verify:all` | ver §6 |

## 4. Release

1. A migration é EXPAND e foi **aplicada em produção em 2026-11-13 às 19:48:14 UTC**, antes do merge, pelo caminho B (conector Supabase, uma transação com guardas), com GO escrito do proprietário e desvio da D-PROD-74 registrado. Conferência do §4 do runbook ok (43 migrations, 81 tabelas, RLS, constraints, advisors sem alerta). Registro no §7 do runbook.
2. Ordem obrigatória: CI verde → GO do proprietário → preflight → aplicação
   (caminho A, ou B só com GO escrito e específico desta migration) →
   conferência → **merge** → deploy → smoke. Ver o runbook.
3. A aplicação vem **antes** do merge: o runtime novo sem a tabela daria 500
   nas rotas `/estacoes` e em `DELETE /empresas/:id` (a exclusão de empresa
   conta todo model com `cliente_id` e `empresa_id`).
4. Até a tela `pec-estacoes` ser liberada num perfil, só o administrador a vê.

## 5. Fora do escopo

- curva de ganho de peso por estação e peso projetado;
- objetivos por categoria e produção (@);
- calendário mês a mês e sugestão automática pelo estado;
- reconciliação com `AreaPastagem.periodo_estacao` (outro vocabulário);
- qualquer leitura das estações por outro módulo.

## 6. Verificação completa e revisão

_(preenchido ao fim da missão.)_
