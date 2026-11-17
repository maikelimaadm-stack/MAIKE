# MAIKE-MEDICAO-FORRAGEM — Relatório

**Branch `claude/kind-knuth-tztu1v`** · Decisão: [D-PROD-219](./DECISIONS.md) ·
Runbook: [`MAIKE-MEDICAO-FORRAGEM-RUNBOOK-RELEASE.md`](./MAIKE-MEDICAO-FORRAGEM-RUNBOOK-RELEASE.md)

Terceiro passo do Manejo de Pastagens, depois do Cadastro de Culturas (D-PROD-215) e
da Área ligada à Cultura (D-PROD-216): a medição do pasto pela régua, no olho e com a
amostra de corte (matéria verde e matéria seca), lançada pelo botão no pasto do Mapa
Geral. O farol no mapa, a lotação pela massa seca e a produtividade ficam para depois
(pedido do proprietário).

## 1. Entrega

| Camada | O que entrou |
|---|---|
| Banco | Tabela nova `MEDICAOFORRAGEM` (model `MedicaoForragem`): método `REGUA`/`OLHO`, leituras (JSON), quantidade, média, situação, o retrato das alturas da cultura, a amostra (quadrado, quantas amostras, pesos verde e seco, MS%) e os derivados (matéria verde e massa seca por ha). FKs compostas pelo tenant (Cliente, Empresa, AreaPastagem e CADCULTURAS pela fazenda), `RESTRICT`; 4 CHECKs; RLS pinado. Migration **EXPAND** `20261117200000_medicao_forragem` (SHA-256 `66f5fb51…7b62f`, RLS `b2d54fa5…2718`) |
| Contas | `medicaoForragemCalculo.js` (servidor) e `src/domain/pastagem/medicaoForragem.js` (prévia na tela), iguais e comparadas por teste: leituras pt-BR, média 1 casa, situação RAPADO < saída ≤ DESCANSO < entrada ≤ PRONTO ≤ entrada × 1,2 < PASSOU, matéria verde = peso verde ÷ quadrado × 10, MS% = seco ÷ verde × 100 (ou digitada), massa seca = verde × MS% |
| Backend | `/medicoes-forragem`: GET autenticado (filtros `empresa_id`, `area_id`), POST e DELETE com a chave nova do mapa `medir_forragem` (gravadora). Corpo fechado; pasto desta fazenda e fora da infraestrutura; data não futura no fuso da fazenda; quem registrou vem da conta; auditoria; `MEDICAO_FORRAGEM_NOT_FOUND` |
| Permissão | Chave do mapa **`medir_forragem`** ("Lançar medição de forragem", grupo **Pastos**), na lista de gravadoras do servidor e do navegador. Administrador sempre; operador só com a chave gravada `true` |
| Frontend | Clique no pasto (com a chave) abre o detalhe com o painel **Forragem**: botão **"Medição de Forragem"** → formulário no padrão dos lançamentos do mapa (modelo aprovado pelo proprietário), última medição e as últimas 5 com excluir. Fila offline (`MedicaoForragem`) e cache do mapa `medicoesForragem` |
| Docs | D-PROD-219, CURRENT-STATE, runbook, cobertura de permissões (3 rotas) |

## 2. Validação local (PostgreSQL 16)

| Etapa | Resultado |
|---|---|
| Testes novos | `backend/tests/medicaoForragemNativo.test.mjs` 10/10; `tests/smoke/medicaoForragem.test.jsx` 6/6 |
| Permissões | `permissoesR2Rotas.test.mjs` verde (POST/DELETE sem a chave → 403) |
| Detalhe da área | `tests/smoke/detalhesAreaHistorico.test.jsx` verde (sem a chave, nada muda) |
| Ferramental de deploy | `premerge-migrate.test.mjs` (B33a/b/k, contagens 65) e `preflight-schema.test.mjs` verdes |
| SQL Editor 01–04 | `sqlEditorBootstrap` e `sqlEditorPreservaMaike` verdes (a MEDICAOFORRAGEM antes da AreaPastagem, da CADCULTURAS e da Empresa; 96 tabelas, 81 de tenant) |
| Testes de migration | ver o PR |
| Ensaio do caminho B | §3 do runbook: recusa com o alvo de produção, aplica 64 → 65, `migrate diff` vazio, repetição recusada |

## 3. Pendências e notas

- GO escrito do proprietário para a migration (EXPAND D-PROD-219), antes do merge.
- PR #303 (outra sessão, prefixo `20261117100000`) continua independente; se for aplicada antes, a guarda desta passa a 65.
- Próximo passo combinado: o farol de forragem no mapa (cor do pasto pela última medição).
