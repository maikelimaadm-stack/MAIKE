# Relatório — mapa abre na fazenda e localização que acompanha (D-PROD-302)

**Data:** 2026-11-25 · **Branch:** `claude/nifty-feynman-rh0kdn`

## O que o proprietário relatou

- Ao abrir, o mapa às vezes aparece em Vila Bela da Santíssima Trindade e só depois vai para a fazenda.
- A localização "puxa totalmente errado".
- Andando no mapa, o ponto não acompanha.

## Causas

| Relato | Causa |
|---|---|
| Abre em Vila Bela | `createEditorMap` nascia sempre em `CENTRO_PADRAO` (basemap.js); a vista salva ou o enquadramento das áreas vinham depois. |
| Posição errada | "Localizar" chamava `getCurrentPosition` uma vez, sem `enableHighAccuracy`: o celular pode responder com a posição da rede (centenas de metros). |
| Não acompanha | Nenhum `watchPosition`: o ponto ficava onde foi lido. Círculo fixo em 20 m. |

## O que mudou

- `src/pages/MapaGeral.jsx`: o mapa nasce na vista salva da fazenda; sem ela, fica escondido (`visibility: hidden`) até enquadrar as áreas, no máximo 4 s. "Localizar" usa o hook novo e mantém a regra de escopo (a resposta só vale na fazenda e com a permissão do pedido).
- `src/components/mapa/useLocalizacaoNoMapa.js` (novo): `watchPosition` em alta precisão enquanto a camada "Minha localização" está ligada; filtro de leitura ruim (`leituraEntra`); acompanhar depois de "Localizar" (`easeTo` a cada leitura); `dragstart` para de acompanhar; avisos de permissão e GPS desligado.
- `src/components/mapa/useMapRenderer.jsx`: o círculo usa a precisão da leitura (3 a 500 m).
- Android: `ACCESS_FINE_LOCATION` já estava no manifesto (D-PROD-288).

## Testes

- `tests/smoke/localizacaoNoMapa.test.jsx` — LM-01 (leitura ruim não substitui boa recente), LM-02 (mensagens), LM-03 (alta precisão, acompanhar, arrastar para, limpar o GPS ao sair), LM-04 (resposta recusada pela tela: não pula), LM-05 (aviso uma vez).
- `tests/smoke/mapaPreferenciasIntegrada.test.jsx` — MO-01 (nasce na vista salva, sem enquadrar por cima), MO-02 (sem vista: aparece ao enquadrar); PREF-02 e PREF-07 continuam passando.

## Para conferir no celular

Ligar "Minha localização", tocar em Localizar, andar alguns metros (o mapa acompanha); arrastar o mapa (para de acompanhar); fechar e abrir o app (abre direto na fazenda).
