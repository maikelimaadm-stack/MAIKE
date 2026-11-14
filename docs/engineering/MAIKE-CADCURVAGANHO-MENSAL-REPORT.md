# MAIKE-CADCURVAGANHO-MENSAL — Relatório

**Branch `claude/kind-knuth-tztu1v` · PR em rascunho** · Decisão: [D-PROD-194](./DECISIONS.md) ·
Runbook: [`MAIKE-CADCURVAGANHO-MENSAL-RUNBOOK-RELEASE.md`](./MAIKE-CADCURVAGANHO-MENSAL-RUNBOOK-RELEASE.md)

## 1. Entrega

A **Curva de Ganho de Peso** passa a ter um GMD (kg/dia) para **cada mês do
calendário**, de janeiro a dezembro, no lugar dos 3 GMD por estação da
D-PROD-189. A curva deixa de depender das **Estações**, que continuam como
cadastro próprio. Mesma tabela física, `"CADCURVAGANHO"`, vazia em produção.

| Camada | O que entrou |
|---|---|
| Banco | `CadCurvaGanho` com `gmd_jan` … `gmd_dez` (`DECIMAL(6,3)`, -2 a 3, CHECK nos 12); saem `gmd_aguas`, `gmd_transicao`, `gmd_seca`. Migration **CONTRACT** `20261114100000_cadcurvaganho_mensal`: guarda pinada (tabela vazia, estrutura por estação, sem dependências externas) → `DROP TABLE "CADCURVAGANHO"` → tabela recriada com o mesmo escopo, FKs, índices e RLS |
| Release | manifesto, contrato fechado (`D-PROD-194`, `drop: ['CADCURVAGANHO']`) e DO de RLS já aprovado; runbook com caminho A (`--contract D-PROD-194`) e B; testes do ferramental (classificador, barreira do runner, alvo) e contagens (45 migrations) |
| Backend | módulo `curvasGanho` com os 12 campos (`curvaGanhoCampos.js`, lista única para serviço, rotas e repositório); 12 obrigatórios no `POST`, qualquer subconjunto no `PATCH`; campos por estação viram chave fora do schema (400); recusa de GMD não numérico antes da coerção do AJV para os 12 |
| Frontend | formulário com o bloco "GMD por mês (kg/dia)" (6 por linha no computador, 3 no celular); embaixo de cada mês o ganho do mês com os dias reais; atalho "repetir →" até dezembro; resumo com ganho no ano, média por dia ponderada e gráfico de barras em SVG; lista com Média e Ganho no ano (12 meses opcionais na configuração de colunas) |
| Docs | D-PROD-194 (e nota de revisão na D-PROD-189), este relatório, runbook, `CURRENT-STATE` |

## 2. Por que assim

- **Mês do calendário como unidade.** É como o pecuarista pensa e confere a
  curva, e evita duas fontes para o mesmo período: com a Estação definindo o GMD,
  uma estação com outra data entraria em conflito com o mês. Pedido do
  proprietário depois de ver a D-PROD-189 em produção.
- **Dias reais do mês.** O ganho de janeiro usa 31 dias e o de fevereiro 28, não
  30 fixos. O ganho no ano é a soma mês a mês (365 dias) e a média por dia é
  ponderada pelos dias.
- **Contas em gramas inteiros.** O GMD tem até 3 casas, então GMD × dias vira
  inteiro em gramas; o arredondamento é simétrico (-1,55 → -1,6, como
  1,55 → 1,6), sem ruído de ponto flutuante.
- **CONTRACT com tabela vazia, e não colunas novas ao lado das antigas.** Deixar
  as 3 colunas por estação no banco, sem leitor, seria lixo. A tabela estava vazia
  em produção; a guarda **exige** que continue vazia na hora de aplicar, então
  nenhum dado pode ser perdido. A estrutura final é exatamente a do schema
  (`migrate diff` vazio).
- **Ligação futura pela Categoria de Manejo**, não dentro da curva: a curva
  segue reaproveitável, e a categoria escolhe qual usa (fatia seguinte).

## 3. Validação local

| Comando | Resultado |
|---|---|
| ensaio manual da migration (PG 16, banco novo com as 44 migrations de então; reensaiado depois da mescla com a `main`, ver §5) | as 7 recusas da guarda (curva cadastrada, gatilho, política, função, FK externa, tabela ausente, já aplicada) desfazem tudo; a aplicação dá 45/0, RLS ligado sem FORCE, 4 constraints, `migrate diff` vazio; nova rodada: "No pending migrations" |
| `backend/tests/curvaGanhoNativo.test.mjs` + `permissoesR2Rotas` | 21/21 |
| smoke `tests/smoke/curvasGanho.test.jsx` | 14/14 |
| `gate:types` (625/625), `typecheck:backend`, `eslint` dos arquivos tocados | passaram |
| tela num navegador real (1280 px e iPhone 13) | 12 meses, dicas, "repetir →", resumo e gráfico; sem rolagem lateral e sem erro no console |
| testes do ferramental, migração em PG real e `verify:all` | ver §5 |

## 4. Release

1. A migration é **CONTRACT** e **não foi aplicada em nenhum banco remoto**.
2. Ordem obrigatória: CI verde → GO do proprietário → preflight (tabela vazia,
   48/0 em 2026-11-14 13:02 UTC) → aplicação (caminho A com `--contract D-PROD-194`, ou B só com GO
   escrito e específico desta migration) → conferência → **merge imediato** →
   deploy → smoke. Ver o runbook.
3. Entre o `COMMIT` e o deploy, só as rotas `/curvas-ganho` respondem 500 (o
   runtime antigo lê as colunas por estação). A tela é nova e está sem uso.
   Durante a própria transação (menos de 1 s), o `DROP TABLE` trava `Cliente` e
   `Empresa` em `ACCESS EXCLUSIVE`, que bloqueia leitura: aplicar **fora de pico**.
4. A Fatia D (PR #268) também é CONTRACT: foi aplicada antes (2026-11-14
   00:37 UTC) e já está na `main`, mesclada nesta branch. O Apontamento (PR #269)
   o Estoque P1-03 e os itens do apontamento (PR #274) também já estão
   aplicados em produção e na `main`. Por isso a guarda do caminho B conta 48.
5. **Numeração:** a decisão nasceu como D-PROD-190 e depois foi D-PROD-191;
   a `main` deu esses números às PRs #269 e #271 e pediu a renumeração. Esta é a
   **D-PROD-194**. O número não está no `migration.sql`, então o checksum não mudou.

## 5. Verificação completa e revisão

_(preenchido ao fim da missão.)_
