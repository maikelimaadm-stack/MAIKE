# Relatório — Mapa Geral vivo entre menus e "App atualizado" (D-PROD-305)

**Data:** 2026-11-25 · **Branch:** `claude/nifty-feynman-rh0kdn`

## O que o proprietário relatou

- "Toda hora eu entro e ele carrega de tudo; uma vez já carregado não precisa. Mudo de menu e entro de novo, ele faz todo o carregamento."
- "Essa versão deveria aparecer um popup automático de atualização."

## Mapa vivo

- Antes (#94): o Mapa Geral desmontava ao sair da rota; ao voltar recriava o MapLibre, o satélite e as camadas.
- Por que a #94 tirou o mapa persistente: com o Google Maps, o mapa escondido seguia sincronizando e, com o
  `cancelQueries` em `useLayoutEffect` a cada troca de rota, travava a navegação (`ROOT-CAUSE-MENU-FREEZE-2026-10-27.md`).
- Agora (`src/components/navigation/AppRouteContent.jsx`): depois da primeira abertura o mapa fica montado;
  fora da rota, `display: none` e `ativo={false}`. Em `MapaGeral.jsx`: GPS só com `ativo`; ao sair, fecha
  janelas e painéis (portais); ao voltar, `map.resize()` + redesenho. Continua sem `cancelQueries` e sem
  `useLayoutEffect` na troca de rota.
- Abrir o app direto em outro menu não monta o mapa até a pessoa ir até ele.

## "App atualizado"

- Faltava registro da versão anterior na primeira versão com o aviso: agora avisa também sem registro.
- O evento da abertura (2,5 s) podia chegar antes da tela montar: fica guardado (`pegarAvisoDeAtualizacao`) e
  o `AvisoDeVersao` mostra ao montar; 8 s na tela.
- A versão baixada esperando a próxima abertura é lembrada ao abrir.

## Testes

- `tests/smoke/mapaVivo.test.jsx` — MV-01 (mapa → lotes → mapa: monta uma vez; escondido e inerte fora),
  MV-02 (abrir em outro menu não monta o mapa).
- `tests/smoke/menuNavFreeze.test.jsx` — contrato atualizado (sem `cancelQueries`/`useLayoutEffect`; mapa inerte).
- `tests/smoke/avisoDeVersao.test.jsx` — VS-03, VS-04; `tests/smoke/atualizacaoAutomaticaApp.test.js` — AV-05.

## Para conferir no celular

Abrir o mapa, ir a outro menu e voltar: o mapa aparece na hora, como estava. Navegar entre menus sem travar.
