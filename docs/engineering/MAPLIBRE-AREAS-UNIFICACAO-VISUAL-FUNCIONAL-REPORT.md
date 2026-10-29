# MAPLIBRE-AREAS-UNIFICACAO-VISUAL-FUNCIONAL-01 — Relatório

**Decisão:** D-PROD-65\
**Base:** `origin/main` = `5c8b48521732debedb7709e0702658667789bf82` (merge #136). CI da `main`: run `40857107158` success.\
**Branch:** `claude/new-session-26kpxu`, recomeçada de `origin/main`; a PR #134 anterior já foi mergeada.\
**PRs abertas no preflight:** 0.\
**Referência read-only:** `maikelimaadm-stack/controle-de-estoque@6aef845e` (`apps/web/src/features/mapa-de-manejo/*`). Nenhum arquivo foi copiado; o comportamento foi portado para os contratos do MAIKE.

## Entregas

### A — Editor (`MapaDesenho`)
- Máquina de estados pura em `src/lib/maplibre/editorModos.js`, com os modos **Navegar / Desenhar / Editar / Mover**:
  - barra de modos com `aria-pressed` e botões de 44px;
  - cursor muda conforme o modo.
- Só **Desenhar** com desenho aberto cria vértice. Arrasto, pinça, zoom, clique em botão e modo Navegar não criam vértice.
- Fechar no 1º vértice deixa a área fechada e passa para **Editar**. A área pode ser navegada e editada de novo sem recriar o desenho; trocar de modo ou de base não reinicia nada.
- **Editar:**
  - arrastar vértice; acima de 4px é arrasto, abaixo é toque;
  - tocar no ponto médio insere vértice;
  - tocar num vértice seleciona; **Remover ponto** (ou Delete/Backspace) respeita o mínimo de 3 vértices para área e 2 para linha;
  - alvo de toque ampliado (14px em toque, 8px com mouse).
- **Mover (mão):** arrastar o interior translada todos os vértices; vai para o undo/redo.
- **Shift** trava o segmento em 45°, no clique e na guia. **Alt** suspende o ímã. O ímã continua tolerante em pixels e só usa áreas e linhas da empresa atual.
- **Régua:** comprimento geodésico de cada segmento (`comprimentoMetros`). O painel mostra a área em ha e, com a área fechada, o perímetro.
- **Sair** com desenho alterado pede confirmação ("Voltar ao desenho" / "Descartar").
- Correções de bugs que já existiam antes desta PR:
  - o `pointerup` da janela cancelava **todo** arrasto de vértice com mouse;
  - clicar exatamente no 1º vértice não fechava a área (o teste de vértice vinha antes do teste de fechamento).

### B — Visualização das áreas cadastradas e Mapa Geral
- `src/pages/MapaGeral.jsx` + `src/components/mapa/useMapRenderer.jsx` **saíram do Google Maps JS** e passaram para MapLibre.
  - O renderer tem o **mesmo contrato público**: `syncAreas`, `syncLabels`, `syncPontos`, `syncLinhas`, `syncPontosSuplementacao`, `syncLotes`, `syncTarefas`, `syncUserLocation`, `clearAll`; e ganhou `ensureLayers`/`hitArea`.
  - Filtros, permissões, painéis e diálogos ficaram como estavam.
  - Persistência da visão por empresa: `moveend` → `localStorage`.
  - Long-press e menu de contexto para tarefa, seleção de local de tarefa e arrasto de lotes para movimentação continuam funcionando.
- Áreas, linhas e localização viram GeoJSON. Marcadores (lotes com contagem e identificador, cochos/depósitos, pontos, tarefas) continuam DOM com os **mesmos ícones/URLs** de `ConfiguracaoIcone`, sem achatar, sempre com `textContent` e cleanup explícito.
- **SSOT de pintura** em `estiloAreas.js` (`paintAreaFill`, `paintAreaDivisa`, `paintAreaDestaque`), compartilhado pelo editor e pelo Mapa Geral: cor salva +5% de branco, divisa branca fina interpolada por zoom, destaque por feature-state no hover.
- Rótulos: nome + ha (+ texto extra UA/ha ou situação do pasto), branco com sombra e fonte por faixa de zoom. O rótulo fica logo abaixo do centroide e o ícone de lotes 30px acima, sem sobreposição.
- O Mapa Geral não depende mais da chave Google para abrir. Sem WebGL, mostra estado honesto e "Tentar novamente".

### C — Satélite real (Google Map Tiles API)
- `src/lib/maplibre/googleMapTiles.js`:
  - `createSession` (POST) → tiles `2dtiles` raster;
  - `expiry` respeitado, sessão só em memória;
  - endpoint de viewport fornece o `copyright`;
  - erros 400/401/403/429/5xx/rede classificados.
- `src/lib/maplibre/basemapController.js` + `useBasemap` + `BasemapAtribuicao`:
  - a camada raster entra **abaixo** das camadas de negócio;
  - Mapa↔Satélite só alterna visibilidade: polígonos, desenho, histórico, centro e zoom são preservados, sem `setStyle`;
  - atribuição "Google Maps · <copyright>";
  - em falha, volta para Mapa com aviso e "Tentar novamente", sem deixar "Satélite" ativo sem imagem.
- O estilo licenciado `VITE_MAP_SATELLITE_STYLE_URL` continua como alternativa.

## Contratos preservados
- `FormularioArea`/`FormularioLinha`/`FormularioPonto` recebem `coordenadas` como antes; a persistência continua `[[lat,lng],…]`; não há migração.
- `ModalCadastroLotePontos` continua no Google; `src/lib/googleMaps.js` e `VITE_GOOGLE_MAPS_API_KEY` foram mantidos.
- Não houve mudança em backend, schema, migrations, RLS, catálogo global, manifests, workflows ou baselines.

## Testes

| Suite | Resultado |
|---|---|
| `tests/smoke/maplibreAreasUnificacao.test.jsx` (novo, 20 casos D/V/S) | PASS |
| `npm run test:smoke` | 862/862 PASS |
| E2E **WebGL real** (`tests/e2e/harness`, Chromium + SwiftShader, dados sintéticos, sem banco/rede de dados) | PASS — ver `evidencias/maplibre-areas/resultado-webgl.json` |
| `npm run verify:all` (PostgreSQL 16 efêmero local) | ver seção "Gates" |

### Matriz (evidência E2E WebGL real + unit)
- **D01** — o pan com a área vazia não cria ponto: PASS (E2E).
- **D02** — 4 pontos + fechar no 1º vértice: 1,82 ha, perímetro 440 m, modo Editar. PASS (E2E).
- **D03** — modo Navegar, pan e clique não alteram a área: PASS (E2E).
- **D04** — arrastar um vértice após navegar: a área foi de 1,82 para 2,27 ha. PASS (E2E).
- **D05** — selecionar vértice → Remover ponto: 2,27 → 1,12 ha. O mínimo de 3 está coberto no unit. PASS.
- **D06** — Shift 45° e Alt sem ímã: PASS (unit + código). O snap de vértice/aresta é o mesmo de antes. Não houve E2E com teclado.
- **D07** — mover com a mão preserva a área (2,27 ha) e desloca o polígono (screenshot `editor-movido.png`): PASS.
- **D08** — desfazer volta a 1,82 ha; refazer volta a 2,27 ha: PASS (E2E).
- **D09** — sair com alterações pede confirmação; cancelar não persiste: PASS (E2E).
- **D10** — editar área existente abre em modo Editar com 10,75 ha / 978 m; sair sem alteração não pede confirmação: PASS (E2E). Salvar e recarregar depende do backend: NOT_RUN no harness.
- **D11** — zero e coordenadas negativas: PASS (unit). As queries são por empresa, como antes.
- **V01** — cor, divisa e rótulo: PASS (unit + E2E `geral-desktop.png`).
- **V02** — trocar a base mantém as 3 áreas: PASS (E2E). Filtro ocultando pontos remove só aquele grupo: PASS (unit).
- **V03** — lotes (42/17 com identificador "LA"), cochos/depósitos e tarefas, com clique e arrasto: PASS (unit DOM + E2E).
- **V04** — troca de empresa: queries por empresa e `clearAll` no teardown. Não houve E2E multi-tenant: PARCIAL.
- **V05** — sem WebGL, falha de estilo e retry: PASS (smoke render).
- **V06** — sem overflow em 390, 412 e 1440 px; botões de modo com 44 px: PASS (E2E).
- **S01/S02** — sessão + raster abaixo do negócio; alternar 3 vezes faz 1 único `createSession` e nenhum `setStyle`: PASS (unit).
  - Com **imagem real**: BLOCKED_SATELLITE_PROVIDER_SETUP. Não há chave neste ambiente; ver seção abaixo.
- **S03** — 403 na sessão e 429 no tile caem para Mapa com aviso; retry cria nova sessão: PASS (unit).
- **S04** — atribuição dinâmica do viewport; nada persistido nem logado: PASS (unit).
- **S05** — sem chave: aviso honesto e o desenho continua intacto: PASS (E2E).

## Satélite — habilitação pelo proprietário
O código está pronto. Para imagem real é preciso:
1. No Google Cloud do projeto da chave `VITE_GOOGLE_MAPS_API_KEY`, habilitar a **Map Tiles API**; ela exige faturamento ativo.
2. Na restrição da chave, permitir a Map Tiles API e os HTTP referrers do domínio de produção e dos previews Vercel.
3. Redeploy (variável de build `VITE_*`). No app: Satélite → imagem aérea + "Google Maps · <copyright>" no canto inferior direito.
Custo: cobrança por tile e por sessão conforme a tabela da Map Tiles API. Não há pré-cache e a sessão é reaproveitada até o `expiry`.

## Riscos / limitações
- O E2E roda num harness com stubs de dados, não com o backend real nem sessão autenticada. O preview Vercel serve de validação manual.
- Ícones remotos de `ConfiguracaoIcone` não foram exercitados no harness (sem URLs); o caminho de fallback com círculo foi exercitado.
- `ModalCadastroLotePontos` continua no Google (fora do escopo, M4).

## Arquivos
Ver `git diff origin/main --name-status` na PR.
