# MAIKE — Diário da máquina: ajustes finais (relatório, D-PROD-324)

**Branch:** `feat/diario-ajustes-finais` (a partir da `main`, com o Diário da máquina da PR #406 já integrado).
**Decisão:** [D-PROD-324](./DECISIONS.md). **Migration:** nenhuma. **Banco remoto:** nada aplicado. **Commit/push:** não feitos.

## 1. O que mudou, por item

| # | Pedido | O que ficou | Onde |
|---|---|---|---|
| 1 | Abastecer dentro do diário | "Abastecer" em "Mais" abre a seção própria `SecaoAbastecer` (litros ou kg, horímetro; máquina do contexto; produto, tanque e local só quando há escolha). Grava pelo caminho da tela Abastecimentos: `previaDoAbastecimento` + `confirmarAbastecimento`, ligado ao lançamento de hoje. Rota ausente (404/405/501 sem `code`) cai no formulário antigo. | `DiarioSecoes.jsx` (`SecaoAbastecer`), `DiarioDaMaquina.jsx` (`gravarAbastecimento`), `src/apis/_core/nativeHttpClient.js` (marca `rotaAusente`), `src/lib/implementoRegras.js` (`ehFalhaDeRota`), `POST /atividades/:id/diario-dia` |
| 2 | Horímetro sempre salvo | Com transferência: no movimento da sobra. Sem transferência: trajeto novo `POST /atividades/:id/trajetos` (movimento TRANSFERENCIA de volume zero, só horímetros, sem estoque e sem mudar o pasto da mistura). O endpoint de sobra também guarda horímetro em DEVOLUCAO e PERDA. | `atividadeMisturaService.js` (`registrarTrajeto`, `registrarSobra`), `atividadeMisturaRoutes.js`, `DiarioDaMaquina.jsx` (`trocarPasto`) |
| 3 | Passo 2 sem lançamento do dia | `POST /atividades/:id/misturas/:misturaId/aplicar` acha ou cria o lançamento CONFIRMADO de hoje da área, na mesma transação (`lancarNaTransacao`, sem linhas). Idempotente. A PERDA sem `apontamento_id` usa o mesmo lançamento. A rota antiga com `apontamentoId` continua. | `atividadeMisturaService.js` (`garantirApontamentoDoDia`, `aplicarMisturaNoDia`, `executarAplicacao`), rotas, `DiarioSecoes.jsx` (`SecaoPasso2` sem o bloqueio "lance o dia") |
| 4 | Resumo na unidade certa | `volumes_aplicados: [{unidade, volume}]` por pasto e no total, em L e kg separados. Sai `volume_aplicado` (somava L com kg). A sobra mostra a unidade de cada mistura. | `atividadeMisturaService.js` (`resumoDoDia`, `volumesDoMapa`), `DiarioSecoes.jsx` (`SecaoResumo`) |

## 2. Defeitos achados e corrigidos no caminho

Os três abaixo já estavam na `main` (PR #406). Os smoke antigos não pegavam porque os fixtures tinham o formato errado.

1. **O diário nunca ligava com o servidor no ar.** `GET /misturas` respondia `{ misturas }`, mas a porta e o service liam `items`. Corrigido: o servidor responde `{ items }`.
2. **Nome do produto em branco no Passo 2 e no resumo.** A tela lia `produto.nome` e `p.nome`; o servidor manda `produto_nome`/`produto_unidade`. Corrigido em `implementoRegras.js` (helper único) e em `SecaoResumo`.
3. **Sobra sem horímetro era descartada em silêncio** em DEVOLUCAO e PERDA. Corrigido no backend.

## 3. Limites (o que não fica resolvido)

- **Trajeto sem nenhuma mistura na atividade é recusado** (`sem_mistura`). O movimento pede uma mistura (`mistura_id` NOT NULL). Guardar sem mistura exigiria migration; não foi feito.
- **Abastecimento sem a rota nova no servidor** cai no formulário antigo (a janela de sempre). Não há leitura de horímetro nova além da que o bem já dá.
- **Nada foi aplicado em produção.** A migration da D-PROD-323 já está lá; esta missão não cria schema novo. As rotas novas (`/trajetos`, `/diario-dia`, `/misturas/:id/aplicar`) só existem quando o servidor com esta branch for publicado.

## 4. Testes e verificações

- Backend `diarioMaquina.test.mjs` (PostgreSQL local de teste): **29/29** (eram 24; 5 novos: Passo 2 sem lançamento, idempotência, perda sem lançamento, trajeto e as três recusas, resumo L e kg com lista `items`). Os asserts de resumo passaram ao formato novo.
- Smoke do diário (`diarioMaquina`, `diarioMaquinaService`, `diarioFase2`, `implementoRegras`): verde. Novos: trajeto sem sobra (2 cenários), abastecer (caminho, validação, rota ausente, sem máquina), resumo L e kg, regras de trajeto e de falha de rota, `rotaAusente` no cliente HTTP.
- Gates (`npm run test:gates`): 1097/1097. Gates individuais que tocam o escopo, imports, segredos, Base44, tenancy, índices e tipos: verdes.
- `typecheck:backend`: sem erros. `typecheck:raw` (front): 369 erros na base atual, nenhum em arquivo desta missão (o baseline da `main` não foi medido isoladamente).
- Lint nos arquivos alterados: limpo.
- Suíte completa do smoke (`vitest run`): **367 arquivos, 4472/4472** (antes da missão: 4435/4435, sem os testes novos).

## 5. Como reverter

Nenhum passo destrutivo. Reverter é desfazer o commit desta branch. Nenhuma linha de schema, nenhuma migration e nenhum dado mudou.
