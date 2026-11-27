# Guia de edição do mapa e dos ícones

Este documento é um índice dos arquivos reais do sistema. As tabelas indicam **onde procurar e o que alterar**. Valores são os do código nesta revisão; procure pelo nome da função ou classe, pois números de linha mudam.

## 1. Comece por aqui

| Quero mudar | Arquivo e ponto de edição |
| --- | --- |
| Ícone do lote (gado): cores, bordas, tamanho por faixa, mistos, desenhos | `src/assets/icones/lotes/` → constantes no topo de `animais.js`, `mistos.js` e `quadradinho.js` (guia: `src/assets/icones/lotes/README.md`) |
| Cor, espessura e preenchimento do cocho | `src/assets/icones/cocho-descoberto.js` → `COCHO_APARENCIA` |
| Desenho do cocho | Mesmo arquivo → `COCHO_DESCOBERTO_FORMA` |
| Desenho do depósito | `src/assets/icones/deposito-sal.js` → `MODELO`, `CORPO`, `desenhoAjustado` |
| Bolinha branca e ponteira de cocho/depósito | `cocho-descoberto.js` → `envolverMarcadorSvg` |
| Tamanho dos bois no mapa | `src/assets/icones/lotes/quadradinho.js` → `LARGURA_MARCADOR_PX` (44) |
| Tamanho dos cochos, depósitos, pontos e tarefas no mapa | `src/lib/maplibre/pontosNoMapa.js` → `TAMANHO_SUPL_PX` (36), `TAMANHO_PONTO_PX` (40), `TAMANHO_TAREFA_PX` (40); sem figura, `RAIO_CIRCULO_PX` (D-PROD-353: desenhados pelo próprio mapa) |
| Selo "?"/"!" e farol do cocho; indicador da tarefa | `src/lib/maplibre/pontosNoMapa.js` → `SELO_SUPL`, `CORES_SELO_SUPLEMENTACAO`, `FAROL_SUPL`, `INDICADOR_TAREFA` (pintados na imagem por `desenharImagemPonto`) |
| Número de cabeças: tamanho da letra | `src/lib/maplibre/contagemLote.js` → `FONTE_CONTAGEM_PX` |
| Número de cabeças: posição e cor | Altura: centro da faixa reservada à contagem, `CONTAGEM_TOPO_PCT` (`src/assets/icones/lotes/index.js`, calculado de `CARD_FRAC` e `FAIXA_CONTAGEM`). Cor (`#6b7280`), halo e centro na horizontal: `desenharImagemLote` em `src/lib/maplibre/lotesNoMapa.js` (a contagem é escrita na imagem do lote, D-PROD-349) |
| Avisos dos bois no canto superior direito | `src/lib/maplibre/lotesNoMapa.js` → `desenharImagemIdent`, `DIAMETRO_IDENT_PX`, `DESLOC_IDENT_PX`; piscar: `PISCAR_MS`, `OPACIDADE_PISCAR` |
| Nomes dos pastos e hectares: tamanho | `src/lib/maplibre/nomesNoMapa.js` → `fontesRotuloPorZoom` (letra 10 → 12 px por zoom) e `escalaRotulo` (encaixe no pasto, mínimo 60%); viram o `icon-size` da camada (`tamanhosPorZoom`, `expressaoTamanhoNome`) — D-PROD-354: desenhados pelo próprio mapa |
| Nomes dos pastos: letra, cores e posição | `src/lib/maplibre/nomesNoMapa.js` → `FAMILIA_NOME`, `COR_NOME`, `OPACIDADE_HA`, `COR_EXTRA`, `ALTURA_LINHA`, `estiloDaLinha`, `desenharImagemNome`; com lote, `DESLOC_NOME_COM_LOTE_PX` ([0, 10]); camadas em `camadasNomes` |
| Nomes dos pastos: nível (nome + ha, só o nome, sigla) | `useMapRenderer.jsx` → `arrumarNomes` (com `escolherModoRotulos` e `siglaDaArea` de `mapaGeralRender.js`) |
| Cores e linhas das áreas/cercas | `src/lib/maplibre/estiloAreas.js` e funções `paint*` em `mapaGeralRender.js` |
| Posição da barra do topo, dos botões e do resumo do mapa | `src/styles/mapa-geral.css` → `.mk-mapa-barra` (barra ⚙ · Lotes · Pastos · Tarefas), `.mk-mapa-dir`, `.mk-mapa-resumo` |
| Estilo final dos botões e painéis | `src/styles/mk-mapa-superficie.css` (sobrescreve parte dos estilos anteriores) |
| Ordem e ícones dos botões | `src/components/mapa/MapaControlesMobile.jsx` |
| O que cada foco (Lotes, Pastos, Tarefas) mostra no mapa | `src/lib/mapaFoco.js` → `camadasDoFoco` (D-PROD-218) |
| Opções e ordem dos filtros | `src/components/mapa/MapaFiltrosAvancados.jsx` |
| Lado em que abre o painel | `src/components/mapa/MapaFiltrosPainel.jsx` → `side` e chamadas desse componente |
| Imagens pré-cadastradas e origem de cada ícone | Seção 2 abaixo |

## 2. Onde estão os ícones pré-cadastrados?

Há três fontes. Não existe um único arquivo com todas as imagens.

### A. Desenhos embutidos no código

| Ícone | Onde editar |
| --- | --- |
| Lote (gado), por sexo + faixa de idade, e os mistos | `src/assets/icones/lotes/` (D-PROD-191) |
| Cocho com nível | `src/assets/icones/cocho-descoberto.js` |
| Depósito com nível | `src/assets/icones/deposito-sal.js` |
| Manejos: pesar, nascimento, saída, morte, juntar/mover lotes, mudar categoria e históricos | `src/components/mapa/IconesManejoEnviados.jsx` (SVGs em componentes React) |
| Entrada dos ícones de manejo | `src/components/mapa/IconesManejo.jsx` (reexporta os componentes acima) |
| Ícones de botões: ⚙ (filtros), localização, atualizar etc. | Imports de `lucide-react` em `MapaControlesMobile.jsx` e nos componentes que desenham os botões |

Nos SVGs de manejo, `path d` muda a forma; `strokeWidth` muda a grossura; `style.color`, `color` e `currentColor` definem a cor. Vários usam `#5ACBE9`. O tamanho visual também pode ser limitado pela classe `.mk-al__img` em `src/styles/lancamento-lote.css`, pelas regras de `src/styles/mk-mapa-superficie.css` e pelo botão que contém o ícone.

Existem imagens em `public/icons/`. Antes de substituir uma delas, procure quem usa seu caminho: os botões de manejo atuais são reexportados de `IconesManejoEnviados.jsx`; mudar somente um PNG antigo pode não afetar esses botões.

### B. Imagens cadastradas no gerenciador

Tela: `src/pages/ConfiguracoesGerais.jsx`; componente: `src/components/configuracoes/GerenciadorIcones.jsx`.

Campos principais: `tipo_entidade`, `categoria`, `icone_url`, `sub_icone_url` e `cor_padrao`. A imagem é enviada e a URL fica no cadastro; não é necessariamente um SVG dentro do repositório. O campo `categorias_misto` só servia ao Lote e saiu da tela.

**Lote não é mais cadastrado aqui (D-PROD-191).** O gerenciador oferece Ponto, Área, Linha, Prioridade de Tarefa e Ícone do Menu Mobile. As linhas antigas de `tipo_entidade = 'Lote'` continuam no banco, órfãs e sem uso; a limpeza é outra fatia.

Para trocar uma imagem cadastrada, use o gerenciador e salve o registro. Não coloque uma URL nova em uma lista aleatória do código: o mapa escolhe o cadastro pelas funções de resolução.

**Categoria: sugestão ou texto livre (D-PROD-192).** A categoria é escolhida no Select (as sugestões do tipo, em `CATEGORIAS_SUGERIDAS`) ou digitada em "OU DIGITE UMA NOVA CATEGORIA", e é salva em maiúsculas. O Select só recebe valor que é uma das sugestões (`sugestaoDaCategoria`, sem diferença de maiúsculas): o `<select>` nativo oculto do Radix responde `""` para valor fora das opções, e isso apagava o texto digitado.

Quem escolhe a imagem no mapa: `src/lib/maplibre/mapaGeralRender.js`:

- `resolverIconeLote`: não lê mais o cadastro. Chama a cascata do código (`resolverFiguraDoPasto`, em `src/assets/icones/lotes/index.js`) e sempre devolve um desenho.
- `resolverIconePonto`: usa o vínculo do ponto com a configuração ou sua categoria/tipo.
- `resolverIconeTarefa`: mantém o upload de `Prioridade Tarefa` quando cadastrado; sem upload, usa os quatro SVGs locais de `src/assets/icones/tarefas.js`. O gerenciador oferece **Usar modelo de tarefa SVG** para trocar um upload antigo pelo desenho padrão.
- `resolverIconeSuplementacao`: cochos e depósitos usam os SVGs dinâmicos embutidos. Enviar outro ícone pelo gerenciador não substitui essa geometria dinâmica.

O serviço desse cadastro é `src/services/configuracaoIconeService.js`.

### C. Ícones oficiais de gado do catálogo global

Há também um catálogo oficial, separado dos desenhos embutidos e do gerenciador de configurações.

- Administração das imagens oficiais: `apps/admin/src/telas/Icones.jsx`.
- O aplicativo não lê mais o catálogo: a Fatia D (D-PROD-187) apagou o vínculo `catalogo_categoria_visual_id` da Categoria de Manejo, o seletor do cadastro e o leitor do catálogo no aplicativo.
- O backend desse catálogo fica em `backend/src/modules/catalogoGlobal/`.

As imagens publicadas são assets com URLs versionadas. Para trocar a imagem oficial, use a administração do catálogo e seu fluxo de publicação. Não edite migrations antigas ou URLs históricas para trocar uma imagem.

**O ícone do lote não vem deste catálogo (D-PROD-191).** O marcador do mapa, o subícone dos detalhes e a prévia no cadastro do lote (`src/components/lotes/IconeLotePreview.jsx`) usam os desenhos do código, em `src/assets/icones/lotes/`, sem rede nem cache.

## 3. Tamanhos e posições dos marcadores

Arquivo: `src/components/mapa/useMapRenderer.jsx`; os lotes (desenhados pelo próprio mapa desde a D-PROD-349), em `src/lib/maplibre/lotesNoMapa.js`; cochos, depósitos, pontos de referência e tarefas (desenhados pelo próprio mapa desde a D-PROD-353), em `src/lib/maplibre/pontosNoMapa.js`; os nomes dos pastos (desenhados pelo próprio mapa desde a D-PROD-354), em `src/lib/maplibre/nomesNoMapa.js`.

| Elemento | Referência no código |
| --- | --- |
| Gado/lotes | `LARGURA_MARCADOR_PX` (44), em `src/assets/icones/lotes/quadradinho.js`, usado por `desenharImagemLote` (`lotesNoMapa.js`) |
| Cochos e depósitos | `TAMANHO_SUPL_PX` (36), em `pontosNoMapa.js` (usado por `syncPontosSuplementacao`) |
| Pontos de referência | `TAMANHO_PONTO_PX` (40), em `pontosNoMapa.js` (usado por `syncPontos`) |
| Tarefas | `TAMANHO_TAREFA_PX` (40), em `pontosNoMapa.js` (usado por `syncTarefas`); indicador de 22 px (`INDICADOR_TAREFA`) independente do desenho |
| Ordem entre eles | `ORDEM_CLICAVEIS` em `pontosNoMapa.js` e `ensureMgLayers` em `mapaGeralRender.js`: cocho < ponto < lote < tarefa (Urgente por cima pelo `symbol-sort-key`) < nomes dos pastos (D-PROD-354, sem clique) |
| Deslocamento do gado em relação ao ponto | `OFFSET_LOTE_PX = [0, -26]`; com o nome do pasto embaixo, `OFFSET_LOTE_COM_NOME_PX = [0, -14]` (`lotesNoMapa.js`, `icon-offset` da camada `mg-lotes`) |
| Contagem dentro do ícone do gado | no meio da largura, a `CONTAGEM_TOPO_PCT` da altura (centro da faixa reservada, ≈ 73,46%), escrita no canvas em `desenharImagemLote` |
| Avisos no alto à direita do gado | `DESLOC_IDENT_PX = [22, -24]` a partir do centro do ícone (camada `mg-lotes-ident`) |
| Selo neutro/excesso de suplementação | `SELO_SUPL` e `CORES_SELO_SUPLEMENTACAO` em `pontosNoMapa.js`; farol: `FAROL_SUPL` |

Os pontos são imagens no cache: a chave inclui o tamanho, então mudar a constante gera imagens novas sozinho. A função `iconeSemAchatar` em `mapaGeralRender.js` preserva a proporção: `baseSize` é o tamanho de referência, não uma ordem para esticar a imagem em um quadrado.

`left` positivo move para a direita; `top` positivo move para baixo. Em um offset `[x, y]`, `y` negativo sobe. Ao mudar a posição dos avisos ou do número de cabeças, confira ícones de proporções diferentes e números como 9, 120 e 5.000.

### Bolinha branca

Para cocho/depósito, a bolinha está desenhada no próprio SVG de `envolverMarcadorSvg`. Fundo `#fff`, borda `#bbb7b7`, espessura 1. O `path d` inclui a ponteira.

O gado tem moldura própria: o "quadradinho" branco com ponteira, em `src/assets/icones/lotes/quadradinho.js` (`QUADRADINHO_SVG`, com `CARD_FRAC` e `FAIXA_CONTAGEM`). Alterar a bolinha do cocho não altera o ícone do boi.

## 4. Letras, nomes e números

- Cabeças: `FONTE_CONTAGEM_PX = 9.5` em `src/lib/maplibre/contagemLote.js`. A formatação dos milhares também está nesse arquivo.
- Cor, peso, família e halo da contagem: `desenharImagemLote` em `src/lib/maplibre/lotesNoMapa.js` (não há `text-field` do mapa: o estilo sem internet não tem fonte de letras).
- Tamanho de nomes/hectares por zoom: `fontesRotuloPorZoom` em `nomesNoMapa.js` (também exportada por `mapaGeralRender.js`). A imagem do nome é desenhada em 12 px; o mapa reduz pelo `icon-size` (paradas `s8`…`s22` de cada pasto na fonte `mg-nomes`); os hectares ficam 1 px menores.
- Cor, peso e família dos nomes das áreas (sem sombra): `estiloDaLinha` e `desenharImagemNome` em `nomesNoMapa.js` (não há `text-field`: o estilo sem internet não tem fonte de letras; a Inter é esperada com `document.fonts.load`, sem ela Arial).
- Organização/escala dos nomes: `escalaRotulo` (encaixe no pasto) em `nomesNoMapa.js`; nível único para todos em `arrumarNomes` (`useMapRenderer.jsx`) com `escolherModoRotulos` (`mapaGeralRender.js`).
- Texto do painel de detalhes: `src/styles/mk-mapa-superficie.css` e classes `.mk-map-details`; os componentes `DetalhesLote.jsx`, `DetalhesPontoSuplementacao.jsx` e `DetalhesDepositoSuplementacao.jsx` organizam o conteúdo.
- Fonte do sistema: `index.html`, `src/index.css` e os estilos compartilhados do motor. Os marcadores DOM podem declarar sua própria `font-family`, como Inter/Arial; mudar a fonte global não necessariamente muda esses marcadores.

Para mudar só o mapa, prefira os seletores do mapa. Mudar a escala global do Tailwind ou uma regra genérica de `button`, `input` ou `body` afeta outras telas.

## 5. Cores das áreas, linhas e pontos de edição

Em `src/lib/maplibre/estiloAreas.js`:

- `PALETA_AREAS_CADASTRO`: cores disponíveis no cadastro.
- `COR_LINHA_AREA`: cor das divisas.
- `OPACIDADE_FILL_AREA`: opacidade do preenchimento.
- `COR_DESENHO`, `COR_VERTICE_FILL`, `COR_VERTICE_STROKE`: desenho e pontos.
- `EDITOR_VISUAL`: raios, grossuras e tolerâncias do editor.
- `paintAreaFill`, `paintAreaDivisa` e demais funções `paint*`: pintura efetiva das camadas.

Em `src/lib/maplibre/mapaGeralRender.js`, confira `paintEstiloPasto` e `buildMgLinhasCollection` para o estilo efetivo do Mapa Geral. O estilo pode variar entre cheio, suave e só contorno, e também conforme o zoom.

Uma cor salva na área pode prevalecer sobre a cor padrão. Mudar a paleta não recolore automaticamente todos os registros já salvos.

## 6. Posição das configurações, filtros e painéis

- `src/pages/MapaGeral.jsx`: montagem da tela, dados, quais painéis estão abertos e ligação entre filtros, controles e renderização.
- `src/components/mapa/MapaControlesMobile.jsx`: barra do topo ⚙ · Lotes · Pastos · Tarefas (D-PROD-218: o ⚙ abre o painel de Filtros; os segmentos trocam o foco do mapa e Tarefas abre a Gestão de Tarefas); Visualização e ações à direita; imports de ícones e ordem dos botões.
- `src/lib/mapaFoco.js`: focos permitidos por permissão e o que cada foco mostra (lotes, cochos/depósitos, tarefas, lotação no rótulo).
- `src/styles/mapa-geral.css`: posição dos grupos, resumo, margens, dimensões, espaçamento e regras responsivas. Procure `.mk-mapa-barra`, `.mk-mapa-dir`, `.mk-mapa-resumo` e `@media`.
- `src/styles/mk-mapa-superficie.css`: aparência final de botões, painéis e detalhes. Regras de maior especificidade e `!important` podem sobrescrever o CSS anterior.
- `src/components/mapa/MapaFiltrosAvancados.jsx`: grupos/opções e função `camadasDoMapa`, inclusive o que exibir.
- `src/components/mapa/MapaFiltrosPainel.jsx`: estrutura do painel; prop `side` (`left`/`right`). Confira as chamadas que passam essa prop.
- `src/lib/mapaGeralFiltrosStorage.js`: persistência das preferências. Uma preferência já salva pode fazer o mapa abrir diferente do valor inicial do componente.
- `src/components/common/MobileSheet.jsx`: infraestrutura compartilhada das folhas; mudanças aqui também podem afetar outras telas.

**CSS:** `position`, `top`, `right`, `bottom`, `left` definem o encaixe; `gap` define espaçamento; `width`/`height` e variáveis como `--mk-mapa-gap` e `--mk-mapa-alto` definem dimensões; `z-index` define sobreposição. Teste desktop e celular antes de publicar.

## 7. Mapa-base, satélite e centro/zoom

- `src/lib/maplibre/basemap.js`: provedores e estilo-base.
- `src/lib/maplibre/basemapController.js`: troca entre mapa e satélite.
- `src/lib/maplibre/googleMapTiles.js`: integração do satélite Google.
- `src/config/runtimeConfig.js`: leitura centralizada das configurações públicas de build.
- `src/pages/MapaGeral.jsx`: inicialização do mapa e restauração da visão.
- `lerVisaoSalva`, em `mapaGeralRender.js`: validação de centro/zoom salvos.

Configurações `VITE_*` precisam de novo build para mudar. Não coloque credenciais privadas em arquivos do frontend ou neste guia.

## 8. O que ainda era somente uma proposta visual

As imagens de relógio/chave/bandeira com contador de dias e os exemplos de bebedouro com calendário de limpeza foram propostas no chat. Não trate essas imagens como prova de código implantado. Para tarefas, o comportamento real é o de `syncTarefas` e `resolverIconeTarefa`; para bebedouros, confira `src/components/bebedouros/DetalhesBebedouro.jsx` e seus consumidores.

## 9. Publicação e conferência

1. Crie uma branch e altere os arquivos correspondentes.
2. Rode as verificações pertinentes e abra um PR para `main`.
3. Confira a nova URL de prévia da Vercel, nos tamanhos de desktop e celular.
4. Faça o merge e espere a publicação de produção ficar `Ready`. Uma URL antiga de prévia não se atualiza com o novo deploy.

Imagens trocadas por cadastro/catálogo seguem o fluxo de salvamento/publicação desses dados; não precisam de deploy só por mudar um asset. Alterações no código, CSS ou configurações de build precisam de nova publicação.

Confira: números grandes no gado, mistura de categorias, zoom alto/baixo, áreas pequenas, painéis abertos, filtros salvos, níveis cheio/intermediário/vazio e marcadores clicáveis.

Guia específico do cocho/depósito: [src/assets/icones/README.md](../../src/assets/icones/README.md).

Guia específico do ícone do lote: [src/assets/icones/lotes/README.md](../../src/assets/icones/lotes/README.md).


## Marcadores de tarefas por prioridade e prazo

- `src/lib/tarefas/prioridade.js`: nomes e cores compartilhados por formulário, detalhes, resumo e mapa.
  **Baixa** (cinza, um sinal), **Média** (azul, dois sinais), **Alta** (âmbar, três sinais) e **Urgente**
  (vermelho, exclamação). O nome legado **Normal** vira **Média**; Urgente não vira Alta.
- `src/assets/icones/tarefas.js`: moldura quadrada arredondada com ponteira e fundo branco, SVG nativo.
  São só quatro URLs locais em cache. Não dependem de upload, API ou imagem externa.
- `src/lib/tarefas/marcador.js`: selo separado do ícone (inclusive quando o desenho é um upload).
  Dias até o prazo; no dia, `0d`; depois dele, dias de atraso. Acima de 99, `99+` e o valor completo na descrição.
  Pendente: cinza; em andamento: azul; atrasada: vermelho. Sem prazo: `…` ou `▶`, respectivamente.
  Encerradas: `✓` verde ou `×` cinza, sem contador de atraso. O filtro do mapa continua mostrando só abertas.
- O dia vem do `useDiaCivil` da fazenda. A virada do dia, mudança de prazo ou status atualiza o selo no mesmo
  marcador; título/`aria-label` informam prioridade, andamento e prazo completo. O toque abre os detalhes.
- Tanto o mapa geral quanto o seletor de localização usam o mesmo resolver e o mesmo indicador.
- Backend: `backend/src/modules/lancamentosTarefa/lancamentoTarefaService.js` aceita Urgente no contrato HTTP.
  A coluna já é texto de 32 caracteres: não há migration nem alteração de registros existentes.
