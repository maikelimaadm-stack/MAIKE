# MAIKE — Mapa Geral: barra v12 e Detalhes do Lote v12 (D-PROD-217)

## 1. Pedido

O proprietário pediu para implementar o design "Detalhes do Lote v12" (canvas aprovado) com os componentes e as convenções do sistema: os botões do mapa, os campos de cima (Tarefas, Lote…) e o Detalhes do Lote, "tudo igual".

No meio do trabalho ele fixou o escopo: **"os filtros deixe do jeito que está atualmente, filtros de mapa etc., só ajuste o restante"**. Na escolha que se seguiu ficou a barra do v12 com o painel de Filtros de hoje.

A fonte da verdade é `docs/design/detalhes-do-lote/detalhes-do-lote-v12.dc.html`, versionado nesta PR como evidência (roda com o `support.js` da mesma pasta).

## 2. O que mudou

### 2.1 Mapa Geral

- **Barra do topo:** a barra escura **⚙ · Lotes · Pastos · Tarefas** (`MapaControlesMobile`, `.mk-mapa-barra`) substitui os botões de canto Tarefas e Filtros.
  - O ⚙ (nome acessível "Filtros") abre o painel de Filtros de hoje, sem mudança.
  - Tarefas abre também a Gestão de Tarefas que já existe.
- **Foco** (`src/lib/mapaFoco.js`, não salvo; abre sempre em Lotes):

  | Foco | Lotes | Cochos e depósitos | Tarefas | Rótulo da área |
  |---|---|---|---|---|
  | Lotes | como antes | como antes | como antes | como antes |
  | Pastos | escondidos | visíveis | escondidas | "x,x UA (y,yy/ha)" ou "Descanso Nd" |
  | Tarefas | escondidos | escondidos | visíveis | como antes |

  - Só mudam os argumentos dos `renderer.sync*`; o renderer não mudou.
  - Pastos exige `visualizar_areas`; Tarefas exige a permissão das tarefas do mapa.
  - Quem perde a permissão do foco atual volta para Lotes.
- **Sem mudança:** coluna da direita (Visualização, Atualizar, Localizar, Mover), legenda, resumo e todos os filtros e listas.
- **Celular:** a barra termina antes da coluna da direita.
- **Aviso do satélite:** desce para baixo da barra, só no Mapa Geral.

### 2.2 Detalhes do Lote v12 (raiz CSS `.mk-dp`)

- **Janela:**
  - Abre em popup de 880 px a partir de 768 px (computador e tablet) e em tela cheia no celular.
  - O título é a área e o subtítulo é o setor.
  - O `LancLoteDialogo` ganhou a prop aditiva `popupDesde="tablet"` e o contexto `setCabecalho({ titulo, sub, voltar })`.
  - Telas empilhadas na mesma janela: tela do lote, "Manejos e históricos" e "Configurar tabela". Todas têm **‹ Voltar**, e o Esc volta um nível.
- **Abas:** Detalhes · Lotes · Histórico · Suplementação. Abertas pelo marcador, começam em Lotes.
  - **Detalhes:** cartão da área (setor, hectares, área pastejada, pastagem, status, dias de pastejo), aviso de capacidade, Lotação e Categorias.
  - **Lotes:** três vistas.
    - **Resumo:** KPIs e lista com caixa de marcar.
    - **Lote:** ‹ ›, todos os alertas e as seções Lotação, Pesagem e Identificação abertas.
    - **Lista:** colunas por usuário em `colunasLote` (padrão Alertas + Lotação + Pesagem), ordenação, colunas fixas e "Total da área".
  - **Configurar tabela:** grupos, busca, Redefinir e Aplicar.
  - **Histórico:** linha do tempo da área, com filtro "Mostrar", "Carregar mais" e aviso offline.
  - **Suplementação:** cochos da área, KPIs, Fornecimento, Consumo esperado / real e lista "Cochos do pasto".
- **Rodapé:**
  - Padrão: **Mover lotes · Pesar · Manejos**. O alvo é o lote da tela do lote; senão, os lotes marcados; senão, todos.
  - Aba Suplementação com cocho: **Lançar · Leitura · Histórico**, os mesmos formulários do detalhe do cocho.
- **Manejos e históricos:** quadros em 3 colunas. Formulários e históricos completos continuam abrindo como diálogos por cima.
- **Regras de manejo:** a orquestração dos manejos continua no `DetalhesLote.jsx`, com os mesmos comandos do ledger, a recusa do cutover e as mesmas permissões.

## 3. Arquivos

- **Novos:**
  - `detalhes-lote/`: `PainelPasto`, `pastoContexto`, `blocos`, `RodapePasto`, `TelaManejos`, `TelaLote`, `TelaConfigurarTabela`, `AbaDetalhes`, `BlocosLote`, `AbaHistorico`, `LinhaDoTempo`, `historicoDoPasto`, `useHistoricoDoPasto`, `AbaSuplementacao`, `AcoesCochoPasto`, `suplementacaoDoPasto`.
  - `src/components/lotes/usePaginasDoHistorico.js`, `src/lib/mapaFoco.js`.
  - CSS: `mk-detalhes-pasto.css`, `mk-dp-lotes.css`, `mk-dp-historico.css`.
- **Reescritos/adaptados:** `DetalhesLote.jsx`, `AbaLotes`, `VistaResumo`, `VistaLote`, `VistaLista`, `useEstadoLotes`, `catalogo.js`, `preferencias.js`, `AcoesDoLote.jsx`, `LancamentoLoteUi.jsx`, `HistoricoMovimentacoes.jsx` (paginação extraída, mesmo comportamento), `MapaControlesMobile.jsx`, `MapaGeral.jsx`, `mapa-geral.css`, `acoes-lote-modulos.css`.
- **Apagados** (v8, sem uso): `PainelDetalhesLote`, `AbaArea`, `InformacoesArea`, `CartoesLoteTudo`, `ListaCompactaLotes`, `ControlesLotes`, `CartaoLote`, `LinhaLote`, `ResumoSuplementacao`.
- **Mantidos:** a casca v8 `.mk-dl8`, o `pecas.jsx` e o `mk-detalhes-lote.css` continuam para o Resumo do Rebanho (D-PROD-213), sem mudança.

## 4. Testes e gates

- **Testes novos:** `mapaFocoBarraV12`, `detalhesPastoBlocos`, `detalhesLoteV12Casca`, `detalhesLoteV12Lotes`, `detalhesLoteV12Catalogo`, `historicoDoPasto`, `abaHistoricoPasto`, `suplementacaoDoPasto`, `abaSuplementacaoPasto`.
- **Testes reescritos para o v12:** `detalhesLoteV8Preferencias`, `subiconeLote`, `detalhesLoteQuadros`, `detalhesLoteVisualGesto`, `detalhesLoteCutoverPendente`, `editarInformacaoPosicao`, `detalhesLoteV8Pesagem`, `pesoProjetadoMapa`, `iconesManejo`, `suporteBoundary`, `mapaV2Visualizacao`.
- **Testes que continuam iguais:** as proteções do ledger (`r2dBaixasMultilotes`, `r2eLedgerRebanho`, `movimentacaoSemLancarSuplementacao`, `loteManejo`), os testes dos filtros (`mapaFiltroMultiplo`, `base1FiltrosCelularCaixas`, `mapaFiltrosEscopo`, `mapaFiltrosPorUsuario`) e o `resumoRebanho`.
- **Resultado no conjunto integrado:** `test:smoke` com 265 arquivos e 3.315 testes, todos verdes.
- **Gates:** `source-closure`, `import-integrity`, `types` (465 diagnósticos contra o teto de 625; arquivos novos com 0), `product-scope`, `base44`, `no-secrets`, `api-boundary` e `governance-paths` passaram.
- **Antes do merge:** a conferência final roda o `verify:all` sem o `test:backend`, que exige PostgreSQL.

## 5. Conferência visual

- **Método:** harness local não versionado com os componentes reais e dados iguais aos do v12 (Pasto 07, 6 lotes, 314 cab). As capturas foram feitas com Playwright em 1280×900, 820×1180 e 390×844 e comparadas lado a lado com as 57 capturas do v12.
- **Ciclo:** cada parte foi implementada, revisada por dois revisores independentes (visual e código) e corrigida. Depois, o conjunto integrado passou por uma verificação única.

## 6. Diferenças conscientes em relação ao v12

- **Mapa:**
  - Não entram o painel "Opções do mapa", o botão olho, os botões de zoom e a localização em botão redondo, porque o dono manteve os filtros, a Visualização e os botões da direita de hoje.
  - A barra fica na camada dos antigos botões de canto. No celular, ela se alinha à coluna da direita, com 8 px de margem.
- **Alvo dos manejos e Juntar Lotes:** "Juntar Lotes" é avaliado sobre o alvo (lote da tela ou lotes marcados), e não sobre o pasto inteiro.
- **Depois de salvar um manejo:** o Detalhes fecha como antes, em vez de voltar ao pasto. O diálogo recebe um retrato das posições.
- **Históricos completos** (Excluir, Carregar mais, Nutrição/Medicamento/Sanidade) continuam nos diálogos de "Manejos e históricos".
- **Aba Histórico:**
  - "Registrado por" e o peso da transferência não aparecem, porque o dado não existe.
  - A lista "Mostrar" é a do sistema, sem restilo.
  - Os registros cancelados aparecem com o chip "Cancelado".
- **Aba Suplementação:** os números vêm do primeiro cocho por nome, e a tolerância é a real do fechamento (padrão 15%, não 20%).
- **Textos e comportamentos da aba Lotes:**
  - O título usa "1 lote" no singular.
  - Sair do "Configurar tabela" sem Aplicar descarta o rascunho.
  - A busca do "Configurar tabela" ignora acentos.
  - Ordenar por uma coluna que saiu da tabela volta a ordenar por Nome ▲.
- **Pequenas diferenças da casca:**
  - No celular, o título do cabeçalho não desliza na troca de tela.
  - Com uma folha aberta numa tela empilhada, um Esc de teclado físico fecha a folha e volta um nível.

## 7. Fora do escopo e achados

- **Fora do escopo:** formulários de manejo, detalhe do cocho/depósito/bebedouro/tarefa, painel de tarefas, cabeçalho/menu do sistema, e o clique no contorno da área (continua no "Histórico da Área").
- **Bug que já existia, achado no harness e não corrigido aqui:** a Gestão de Tarefas abre vazia na primeira vez.
  - Causa: o `useQuery` de `TarefasMapaPanel.jsx` tem `initialData: []` com `staleTime`.
  - Correção sugerida: `placeholderData`.
- **Harness E2E versionado desatualizado:** o `tests/e2e/harness` (cena `geral`) quebra sem `AuthProvider`. O harness local desta missão contorna com um stub.
