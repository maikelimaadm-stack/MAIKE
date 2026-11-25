# Relatório — aviso de versão do app e app mais leve (D-PROD-304)

**Data:** 2026-11-25 · **Branch:** `claude/nifty-feynman-rh0kdn`

## O que o proprietário pediu

- "Eu não consigo ver quando atualiza a nova versão, não mostra nada."
- "Se você conseguir deixar mais leve ainda, seria bom."

## Aviso de versão

| Momento | O que aparece |
|---|---|
| Versão nova baixada (por baixo, com internet) | "Versão nova do app pronta" — tocar atualiza na hora; senão entra na próxima abertura |
| Abriu com a versão nova | "App atualizado" (uma vez) |
| Menu do usuário | "Versão do app 1.0.4 · abc1234" |

Código: `src/lib/app/atualizacaoAutomatica.js` (eventos `EVENTO_VERSAO_BAIXADA` / `EVENTO_APP_ATUALIZADO`,
`aplicarVersaoBaixada`, `versaoDoApp`, versão baixada guardada para não baixar de novo),
`src/components/offline/AvisoDeVersao.jsx`, `src/Layout.jsx` (linha da versão no menu).

## Mais leve

| | Antes | Depois |
|---|---|---|
| Pacote inicial (`index-*.js`) | 5,4 MB | 2,35 MB |
| Comprimido (gzip) | 1,55 MB | 677 KB |

- `src/pages.config.js`: só o Mapa Geral vem no pacote inicial; as outras telas carregam quando abertas
  (`src/lib/paginaSobDemanda.jsx`). O gate `product-scope` continua lendo a lista de páginas.
- `src/pages/MapaGeral.jsx`: detalhes (lote, área, cocho/depósito, bebedouro, tarefa), painel de tarefas,
  insights e resumo do rebanho carregam no primeiro toque.
- O que ainda pesa no inicial: `maplibre-gl` (~1 MB de fonte), o próprio mapa e `react-router`.
- Sem internet: no app os pedaços ficam no pacote; `baixarDadosParaOffline` carrega todas as portas antes
  de baixar entidades e leituras (`carregarTodasAsPortas`).

## Testes

- `tests/smoke/atualizacaoAutomaticaApp.test.js` — AV-01 (aviso e não baixar de novo), AV-02 (atualizar
  agora), AV-03 ("App atualizado" uma vez), AV-04 (versão para o menu).
- `tests/smoke/avisoDeVersao.test.jsx` — VS-01, VS-02.
- Suíte de smoke completa e gates.
