# MAIKE-CADCURVAGANHO-CADASTRO — Relatório

**Branch `claude/kind-knuth-tztu1v` · PR em rascunho** · Decisão: [D-PROD-189](./DECISIONS.md) ·
Runbook: [`MAIKE-CADCURVAGANHO-RUNBOOK-RELEASE.md`](./MAIKE-CADCURVAGANHO-RUNBOOK-RELEASE.md)

## 1. Entrega

Cadastro de **Curvas de Ganho de Peso** da fazenda: quanto o animal ganha por dia
(GMD, kg/dia) em cada tipo de estação, **Águas**, **Transição** e **Seca**. Tabela
física **`"CADCURVAGANHO"`**, nome escolhido pelo proprietário. Primeira fatia,
**sem vínculo** com categoria, lote ou estação: só o cadastro.

| Camada | O que entrou |
|---|---|
| Banco | model `CadCurvaGanho` com `@@map("CADCURVAGANHO")`, relações inversas em `Cliente` e `Empresa`, migration EXPAND `20261113600000_cadcurvaganho_cadastro`: tabela, 2 FKs de escopo (`Restrict`), CHECK da faixa dos 3 GMD (-2 a 3), 2 uniques, 1 índice, RLS/REVOKE |
| Release | manifesto e hash do DO pinados (classificador: `EXPAND`, sem violação); SQL editor 01–04 (67 tabelas de tenant, 82 no total); contagens nos testes e ensaios (44 migrations); runbook com caminhos A e B |
| Backend | módulo `curvasGanho`: lista e detalhe por fazenda, criação, `PATCH` parcial, exclusão física; GMD validado (faixa, 3 casas) e gravado como decimal exato; corpo bruto conferido antes da coerção do AJV; tela `pec-curvas-ganho`; erros `CURVA_GANHO_NOT_FOUND` (404) e `CURVA_GANHO_NAME_CONFLICT` (409) |
| Frontend | API `src/apis/curvas-ganho`, serviço (leitura e formato do GMD com vírgula), formulário (Nome, 3 GMD com dica "≈ kg/mês", Ativo, Observações), tabela, página `CurvasGanho`, menu Manejo → Curvas de Ganho, ícone `TrendingUp`, `vercel.json`, catálogo de erros, rótulo do vínculo na exclusão de empresa |
| Docs | D-PROD-189, este relatório, runbook, `CURRENT-STATE`, cobertura de endpoints (+5 rotas classe a) |

## 2. Por que assim

- **GMD por estação, não por mês** (escolha do proprietário). Com as Estações já
  cadastradas por data (D-PROD-188), o GMD do dia sai da estação daquele dia: se a
  seca de um ano começar mais cedo, a projeção acompanha sem editar a curva.
- **Negativo permitido (até -2 kg/dia).** Na seca o animal pode perder peso; a
  curva precisa conseguir dizer isso.
- **Decimal exato.** O GMD vai para o banco como texto com 3 casas (`"0.650"`),
  sem ruído de ponto flutuante; a API devolve número.
- **Coerção do AJV.** A configuração do app converte `null` em 0 e `true` em 1
  num campo numérico. Para não gravar um GMD que ninguém digitou, a rota recusa
  (400 `gmd_invalido`) qualquer GMD que não chegue como número no corpo bruto. A
  configuração global do app não foi mexida.

## 3. Validação local

| Comando | Resultado |
|---|---|
| `backend/tests/curvaGanhoNativo.test.mjs` + `permissoesR2Rotas` | 21/21 |
| `scripts/tests/deploy/premerge-migrate.test.mjs` | 41/41 |
| smoke `curvasGanho`, `estacoes`, `scope`, `vercelSpaRoutes` | 45/45 |
| gates estáticos, `gate:types` (625/625), `typecheck:backend`, `eslint` | passaram |
| `prisma migrate diff` (banco migrado × schema) | sem diferença |
| `npm run verify:all` | ver §5 |

## 4. Release

1. A migration é EXPAND e **não foi aplicada em nenhum banco remoto**.
2. Ordem obrigatória: CI verde → GO do proprietário → preflight → aplicação
   (caminho A, ou B só com GO escrito e específico desta migration) →
   conferência → **merge** → deploy → smoke. Ver o runbook.
3. A aplicação vem **antes** do merge: sem a tabela, o código novo daria 500 nas
   rotas `/curvas-ganho` e em `DELETE /empresas/:id`.
4. A Fatia D (PR #268) também tem migration pendente; a que for aplicada depois
   recalcula a contagem da guarda.

## 5. Verificação completa e revisão

_(preenchido ao fim da missão.)_
