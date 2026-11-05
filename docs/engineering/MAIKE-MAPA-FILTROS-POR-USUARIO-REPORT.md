# MAIKE — Mapa Geral: filtros e camadas salvos por usuário (D-PROD-132)

## Pedido do proprietário
"Sempre no meu primeiro acesso o mapa já tem que carregar filtrado: lotes, detalhes de áreas e áreas. Cada usuário tem suas preferências de filtro. Sempre que ele filtrar, tem que deixar filtrado; se não, toda hora que eu entro fica limpo."

## Causa (reproduzida)
1. `MapaGeral` lê a permissão da conta de forma assíncrona. Enquanto ela carrega, o mapa considera "nada liberado".
2. O efeito `if (!mapaGeralPermissions.visualizar_areas) setShowAreas(false)` (e o mesmo para Detalhes Áreas, Lotes, Pontos, Linhas, Cochos, Alertas, Localização e arrastar lotes) desligava as camadas nesse instante.
3. O efeito de gravação salvava esse "desligado" por cima da preferência. Quando a permissão chegava, nada religava as camadas.
4. A chave salva era só por empresa (`mapa_geral_filtros_<empresa>`), então usuários no mesmo aparelho compartilhavam preferências.

RED, com o código da `main` e o `MapaGeral` real em jsdom: a preferência salva com Áreas e Lotes ligados ficou `showAreas:false`, `showLotes:false` só por abrir o mapa.

## Correção
- `src/pages/MapaGeral.jsx`:
  - o estado das camadas virou a **preferência** do usuário (`prefShow*`, `prefDragLotesEnabled`);
  - o que aparece é `preferência && permissão` (`showAreas = prefShowAreas && mapaGeralPermissions.visualizar_areas`, etc.);
  - os `setShow*(false)` por permissão foram removidos;
  - a leitura e a gravação usam o escopo **fazenda + conta + empresa**;
  - a gravação só acontece depois de a preferência desse escopo ter sido aplicada (`filtrosCarregados`).
- `src/lib/mapaGeralFiltrosStorage.js`:
  - chave `mapa_geral_filtros_u:<cliente>:<login>:<empresa>`;
  - a leitura herda a chave antiga por empresa e a legada no primeiro acesso, sem perder o que o aparelho já tinha.
- Painéis (filtros, insights e tarefas) continuam fechando sem permissão. Eles não fazem parte da preferência salva.

## O que fica salvo
- Camadas:
  - Mapa de Áreas;
  - Detalhes Áreas (nomes);
  - Hectares;
  - Pontos de referência;
  - Lotes;
  - Linhas;
  - Cochos;
  - Depósitos;
  - Alertas;
  - Minha localização;
  - Ícones de tarefa;
  - Arrastar lotes.
- Filtros:
  - Categoria;
  - Identificador;
  - Status;
  - Sistema;
  - Tipo de alerta;
  - Tipo de cultura;
  - Tipo de pastagem;
  - Setor;
  - Peso mínimo e máximo;
  - Coloração.

## Limites
- **Armazenamento local:** a preferência fica neste aparelho (localStorage). Em outro aparelho, ou depois de limpar os dados do navegador, o usuário começa do padrão.
- **Sincronização:** sincronizar entre aparelhos exigiria uma tabela de preferências no servidor (migration). Não foi feito.
- **Camada sem permissão:** não aparece, mas a preferência fica guardada. Se a permissão voltar, a camada volta como o usuário deixou.

## Testes
- `tests/smoke/mapaFiltrosPorUsuario.test.jsx` (4): preferência mantida ao reabrir, herança no primeiro acesso, isolamento entre usuários e tenants, e "permissão não reescreve a preferência".
- `tests/smoke/r3PostPr96Bugfix.test.jsx`: leitura tolerante a JSON inválido, no novo escopo.
- Smoke completo: 1447/1447.
