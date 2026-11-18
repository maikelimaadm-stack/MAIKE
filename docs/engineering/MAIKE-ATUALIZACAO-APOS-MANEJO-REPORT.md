# MAIKE — Saldo do rebanho na tela logo depois de cada manejo (D-PROD-250)

## Relato
2026-11-18: transferências KM - 06 → KM - 17 (46 cab) e KM - 06 → KM - P. 01 (2 cab), pesagem, mudança de categoria e junção. Conferido no banco, só leitura: tudo gravado na hora (KM - 06 262, KM - 17 114 cab a 370,1 kg, KM - P. 01 22 = lote 75 × 20 + 2 do lote 73). O Detalhes do P. 01 mostrou números antigos por alguns minutos.

## Causas
| # | Onde | O que acontecia |
|---|---|---|
| 1 | `src/components/mapa/DetalhesLote.jsx` (consultas `mapa-areas` staleTime 5 min e `mapa-lotes` 60 s; manejos disparando só `atualizar-mapa` com `lotes`/`movimentacoes`) | Área (ocupação/saldo derivados do rebanho) e as consultas próprias do Detalhes não eram invalidadas; ao reabrir, voltava a memória. |
| 2 | `src/services/mapaCacheService.js` (`refreshMapaCacheEntry`, deduplicação) | Leitura forçada se juntava a uma comum que saiu antes da gravação: dado velho + `lastRefreshAt` marcado, travando a cópia velha por 60 s. |
| 3 | (nenhum mecanismo) | Gravação em outra aba não chegava às outras. |

Servidor: os GETs nativos não enviam `Cache-Control` de cache público (a Vercel não guarda resposta de função sem `s-maxage`) e vão com `Authorization`; o atraso era só no navegador.

## Correção
- `aposEscritaNoRebanho` em `src/components/mapa/invalidarCachesMapa.js`: força `lotes`, `areas`, `movimentacoes`, `movimentacoesHistorico`, `descansoPastos`, depois invalida `CONSULTAS_DO_REBANHO` e dispara `atualizar-mapa` com `jaBuscado` (o Mapa Geral só reaplica, sem repetir GETs). Usado em todos os manejos do Detalhes, na exclusão de movimento e no Cadastro de Lotes.
- Resultado real da leitura: `refreshMapaCacheEntryDetalhado` → `{ dados, origem: 'rede'|'cache', erro }` (`refreshMapaCacheEntry` continua devolvendo só `dados`). O helper só conta `origem: 'rede'`; o resto fica marcado para forçar de novo e o aviso sai sem `jaBuscado`.
- `refreshMapaCacheEntry`: mapa separado de leituras forçadas; a forçada espera a comum em andamento e busca de novo.
- `escutarRebanhoEntreAbas` em `src/App.jsx` (BroadcastChannel `maike-rebanho`). O aviso leva o `clienteId`; a aba ignora aviso de outro tenant ou sem sessão. A leitura que volta depois de a sessão trocar não grava no IndexedDB (`TENANT_TROCOU`).
- `staleTime` 15 s e `refetchOnWindowFocus` para posições/áreas do Detalhes e posições do Mapa Geral.

## Testes
- `tests/smoke/atualizacaoAposManejo.test.jsx`: ordem (força antes de invalidar), consultas invalidadas, falha de rede com o mock resolvendo a cópia (como o serviço real) marca a chave e tira o `jaBuscado`, aviso entre abas com `clienteId` e sem eco, aviso de outro tenant / sem token / sem `clienteId` ignorado, sem sessão não avisa, todos os caminhos de manejo usam o helper.
- `tests/smoke/atualizacaoAposManejoDetalhes.test.jsx`: Detalhes real reaberto logo depois da transferência mostra 22 cab.
- `tests/smoke/mapaCache.test.js` C-F1/C-F2: forçada depois de comum em andamento busca de novo; comum durante forçada espera a forçada; C-F3 origem `rede`/`cache` com código do erro; C-F4 sessão trocada durante a leitura não grava.
- `tests/smoke/editarInformacaoPosicao.test.jsx`: o mock agora diferencia leitura comum (IndexedDB) e forçada (servidor).
