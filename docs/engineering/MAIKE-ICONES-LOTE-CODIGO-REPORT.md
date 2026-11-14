# MAIKE-ICONES-LOTE-CODIGO — Relatório

FATIA: MAIKE-ICONES-LOTE-CODIGO
BRANCH: feat/icones-lote-codigo
PR: #271

**Decisão:** [D-PROD-191](./DECISIONS.md) · **Base:** `origin/main` `776befe9` na criação; `cf07309c` (PR #270) e `00a06096` (PRs #268, #267 e #263) integradas por merge; a PR #272 (D-PROD-192) entrou nesta branch antes do segundo merge · **Banco:** nenhuma migration · **Data:** 2026-11-13 a 2026-11-14

## 1. Entrega

| Área | O que mudou |
| --- | --- |
| Assets | `src/assets/icones/lotes/`: `quadradinho.js` (moldura, geometria do card e `LARGURA_MARCADOR_PX`), `animais.js` (10 animais, `COR_FEMEA`, `COR_MACHO`, `BORDA_PADRAO`, `TAMANHO_POR_FAIXA`), `mistos.js` (4 mistos, `COR_MISTO`, `BORDA_VACA_MISTO`, `TAMANHO_MISTO`, `SOBREPOSICAO_COMPOSICAO`, `ROTULO_MISTO`, `TABELA_MISTOS`), `index.js` (resolução e composição) e `README.md`. Os 15 SVGs do zip entram como vieram, como texto literal, iguais byte a byte aos arquivos do zip (conferido de novo na árvore final, §6; SHA-256 no anexo) |
| Motor | `resolverFiguraDoPasto` (cascata de 5 níveis, sempre sai figura), `desenhosDoMarcador` / `svgMarcadorLote` / `urlMarcadorLote` (moldura + animal ou animais, borda compensada, faixa da contagem livre), `figuraDaPosicao` / `figuraDoGrupo` / `svgSubiconeLote` / `urlSubiconeLote` (subícone na cor do sexo, nunca misto) |
| Mapa | `resolverIconeLote` (`mapaGeralRender.js`) chama a cascata e sempre devolve `iconUrl`. `syncLotes` recebe as Categorias de Manejo, usa `LARGURA_MARCADOR_PX`, põe a contagem em `CONTAGEM_TOPO_PCT`, guarda a chave do desenho no diff e em `data-icone-lote` e só troca o `<img>` quando o desenho muda. O `MapaGeral` carrega `categoriasManejo` do cache, relê no "Atualizar" e não pré-carrega as imagens de Lote órfãs |
| Detalhes e manejo | `DetalhesLote` lê as Categorias de Manejo do mesmo cache do mapa (`['mapa-cache', 'categoriasManejo', empresa, 'default']`) e as entrega aos seis formulários de manejo. `catalogo.js` põe em cada lote e na composição da área a figura da categoria (`figuraDaPosicao` / `figuraDoGrupo`), nunca misto; `IconeCategoria` (`pecas.jsx`) desenha `urlSubiconeLote(figura, tamanho)`; `AbaArea`, `CartaoLote`, `CartoesLoteTudo` e `LinhaLote` passam a figura. `ListaCompactaLotes`, `VistaLote` e `VistaResumo` desenham por esses componentes e não mudam; `VistaLista` não tem ícone. Os formulários de Pesagem, Morte, Abate, Mudança de Categoria, Movimentação e Nascimento, que liam `sub_icone_url` de Lote, passam a usar o subícone do código (22 px) e não consultam mais `ConfiguracaoIcone` |
| Configurações | `GerenciadorIcones`: "Lote de Gado" sai dos tipos oferecidos; `CATEGORIAS_SUGERIDAS.Lote` e o bloco "Categorias que formam o MISTO" foram apagados; `categorias_misto` saiu do estado do formulário; linha órfã de Lote vinda do servidor não aparece na lista. Ponto, Área, Cocho, Depósito e Prioridade Tarefa seguem como estavam, com os dois uploads. A correção da categoria digitada (PR #272, D-PROD-192) entrou nesta branch pelo proprietário |
| Formulário de Lote | Prévia local em `src/components/lotes/IconeLotePreview.jsx`: o animal da Categoria de Manejo escolhida, na cor do sexo, montado no navegador (sem catálogo, sem rede, sem o cache de 60 s). Categoria sem sexo ou sem faixa mostra o aviso "Sem ícone". `IconeOficialLotePreview.jsx` saiu (a #268 também o apagou, por isso ele não aparece no diff contra a `main`) |
| Cache offline | `mapaCacheService`: capacidade nova `categoriasManejo` (a faixa vem da Categoria de Manejo; inclui as inativas) |
| Docs | D-PROD-191, `CURRENT-STATE.md`, este relatório, `docs/design/GUIA-MAPA-E-ICONES.md`, `src/assets/icones/README.md` e `src/assets/icones/lotes/README.md` |

## 2. Por que assim

- **Borda em % da largura do card, atrás do animal.** A primeira versão media a borda em pixels do marcador (3 px e 5 px num card de 44 px). Renderizado, o contorno da vaca (2,5 px visíveis) apagava o boi atrás dela no misto1 e no misto2. Em % do card (3 = 3%), o filete branco fica fino e separa os animais como nos desenhos do proprietário. O traço fica atrás do animal (`paint-order: stroke`): metade aparece em volta e nenhuma perna afina. Para a grossura ser a mesma na tela, o traço de cada desenho é a borda dividida pela escala dele, e o bezerro a 70% sai igual ao boi a 100%. Os valores 3 e 5 do proprietário ficaram como estão.
- **Largura útil calculada.** O pedido fixa os tamanhos como fração da "largura útil do card", sem dar o número. Com a largura útil igual à largura do card, os animais altos não caberiam acima da contagem. A largura útil é a maior em que os 14 desenhos de ícone único (10 animais e 4 mistos) cabem na área livre, com folgas de 5% nas laterais e 4% no topo. Assim os tamanhos 0,70 … 1,00 valem exatamente, e mudar um tamanho nunca faz um animal entrar na contagem.
- **Linha de chão comum e contagem no centro da faixa.** Os animais ficam apoiados numa linha logo acima dos 34% de baixo do card, descontada meia borda para nem o branco entrar. O número de cabeças sai de `top:69%`, que raspava as patas, para o centro da faixa reservada (≈ 73,46% da altura do marcador).
- **Faixa pela Categoria de Manejo, com reserva.** A posição do rebanho não guarda a faixa: ela vem da Categoria de Manejo (`categoria_manejo_id`). Sem categoria conhecida, valem o sexo da posição e a categoria oficial gravada ("Bezerro 0 a 12 meses" → macho 0–8). As categorias entram no cache offline do mapa.
- **Nível 5 para dado incompleto.** Pasto com posição de sexo desconhecido, ou sem nenhuma faixa conhecida, vai ao nível 5 (vermelho): de longe, a cor avisa que o pasto não está classificado.
- **Subícone por tamanho.** O subícone recebe o tamanho em que a tela o mostra, para a borda ter a mesma grossura do mapa em 22, 32 ou 36 px.
- **Prévia local com nomes novos.** A PR #268 prova que `IconeOficialLotePreview`, `data-testid="icone-oficial-lote"` e o alt "Ícone oficial do lote" sumiram do Formulário de Lote. A prévia local usa outro componente, outro `data-testid` (`icone-lote-categoria`) e outro texto, e as provas da #268 continuam valendo com as duas no ar.
- **`catalogoGlobalService.js` não foi tocado.** As duas funções de Lote ficaram sem uso, mas a #268 apagava o arquivo inteiro; mexer nele criaria conflito modify/delete. A #268 entrou antes e o arquivo saiu com ela.

## 3. Arquivos

42 arquivos contra a `main` `00a06096`. Nenhum em `backend/`, `prisma`, migrations, `scripts/` ou `config/`.

| Grupo | Arquivos |
| --- | --- |
| Desenhos e motor (novos) | `src/assets/icones/lotes/quadradinho.js`, `animais.js`, `mistos.js`, `index.js`, `README.md` |
| Mapa | `src/components/mapa/useMapRenderer.jsx`, `src/lib/maplibre/mapaGeralRender.js`, `src/lib/maplibre/contagemLote.js` (comentário), `src/pages/MapaGeral.jsx`, `src/services/mapaCacheService.js` |
| Detalhes | `src/components/mapa/DetalhesLote.jsx` e, em `src/components/mapa/detalhes-lote/`, `AbaArea.jsx`, `CartaoLote.jsx`, `CartoesLoteTudo.jsx`, `LinhaLote.jsx`, `catalogo.js`, `pecas.jsx` |
| Formulários de manejo | `src/components/lotes/FormularioPesagem.jsx`, `FormularioMorte.jsx`, `FormularioAbate.jsx`, `FormularioMudancaCategoria.jsx`, `FormularioMovimentacaoLote.jsx`, `FormularioNascimento.jsx` |
| Configurações e Formulário de Lote | `src/components/configuracoes/GerenciadorIcones.jsx`, `src/components/lotes/FormularioLote.jsx`, `src/components/lotes/IconeLotePreview.jsx` (novo) |
| Testes novos | `tests/smoke/iconesLoteMotor.test.js` (33 casos), `iconeLoteMapa.test.jsx` (17), `subiconeLote.test.jsx` (15), `iconeLoteFormulario.test.jsx` (8), `gerenciadorIconesSemLote.test.jsx` (4); `gerenciadorIconesCategoriaDigitada.test.jsx` (5, da PR #272) |
| Testes ajustados | `tests/smoke/contagemLote.test.js`, `detalhesLoteV8Preferencias.test.jsx`, `mapaCache.test.js`, `maplibreAreasUnificacao.test.jsx` |
| Docs | `docs/engineering/DECISIONS.md` (D-PROD-191 e, da #272, D-PROD-192), `docs/engineering/CURRENT-STATE.md`, este relatório, `docs/engineering/MAIKE-ICONES-CATEGORIA-DIGITADA-REPORT.md` (da #272), `docs/design/GUIA-MAPA-E-ICONES.md`, `src/assets/icones/README.md` |

## 4. Critérios de aceite

| Critério | Evidência |
| --- | --- |
| Nenhum marcador de lote sem figura, em nenhuma combinação; teste dos 5 níveis | `iconesLoteMotor.test.js` ICL-D (níveis 1–5) e ICL-E (5.000 pastos aleatórios com lixo: sempre sai figura e os 5 níveis aparecem); `iconeLoteMapa.test.jsx` (17 casos: figura com lista vazia, sem categoria, categoria desconhecida e sexo "Misto"; marcador com a data URL, `data-icone-lote`, contagem no centro da faixa, 44 px; troca de categoria atualiza o mesmo marcador; contagem nova não troca o `<img>`) |
| Cores exatas | ICL-B; ICL-F (a cor vai no desenho, nunca `currentColor`) |
| Borda uniforme nos 14 ícones; vaca no misto com 5 | ICL-F "borda uniforme NA TELA": traço × escala = 30 unidades (3%) em todos; caminhos `data-vaca` em ícone com mais de um animal = 50 (5%); fêmea 37+ sozinha = 30 |
| Tamanho cresce com a faixa 70/78/86/94/100 | ICL-F "tamanho cresce com a faixa" (largura ÷ largura útil = tamanho, 9 casas) |
| Nenhum animal invade a faixa de 34% | ICL-F: base de cada desenho + meia borda ≤ 0,66 × altura do card, nos 14 ícones únicos e nas composições do nível 4 |
| Subícone nunca vermelho/misto | ICL-G; `subiconeLote.test.jsx` (15 casos): cada combinação vira a figura certa; na tela (Tudo 36 px, Área 22 px, Lotes › Resumo 22 px, Lotes › Lote 32 px) só aparecem animais na cor do sexo, nada vermelho, num pasto cujo marcador é um misto vermelho; ícone de Lote por upload com `sub_icone_url` não muda nada; Morte e Pesagem mostram o animal da categoria |
| Mesmo sexo com várias faixas = 1 ícone, o de mais cabeças | ICL-D nível 2 (exemplo do proprietário: macho 13–24, contagem 345) |
| Configurações sem cadastro de ícone de Lote; outros tipos seguem | `gerenciadorIconesSemLote.test.jsx` (4 casos: a lista não tem "Lote de Gado" e os outros tipos seguem; linha órfã de Lote vinda do servidor não aparece; o formulário não oferece Lote nem o bloco do MISTO, e Ponto segue com o modelo de cocho e os dois uploads; o código não guarda mais Lote, MISTO nem `categorias_misto`) e os 5 casos da #272 nos tipos que ficaram |
| Ícone do lote sem rede (sem cache de 60 s) | Desenho embutido no pacote; data URL montada no navegador; Categorias de Manejo no cache offline do mapa; `iconeLoteFormulario.test.jsx` "a prévia sozinha aparece offline: sem QueryClient e sem rede" e "nenhuma API de catálogo nem rede; nenhuma query de ícone" |
| Nenhuma migration; `prisma migrate diff` limpo | Nenhum arquivo em `backend/`; as 46 migrations são as da `main`; `prisma migrate diff` do schema da `main` para o desta branch: `-- This is an empty migration.` (§6) |
| `npm run verify:all` verde | 38 de 38 etapas na árvore final, com `gate:import-integrity` e `gate:product-scope`; `test:backend` no CI (§6) |
| Relatório | este arquivo |
| Decisão nova | D-PROD-191 |

## 5. PRs abertas e conflitos

Conferido em 2026-11-14 com merges de ensaio (`git merge-tree`) da árvore final desta branch contra o head de cada PR aberta, separando o que já conflita com a `main` do que esta PR acrescenta.

| PR | Situação | Conflito com esta PR |
| --- | --- | --- |
| #268 (Fatia D, D-PROD-187) | mergeada na `main` (`810a312a`) antes desta | Os previstos, resolvidos no merge da `main` `00a06096`. No `FormularioLote.jsx`, na linha do campo `categoria_manejo_id`, ficou a linha da #268 com a dica da prévia local. No `catalogoGlobalLote.test.jsx` ficou a versão da #268, que exige que o componente, o `data-testid` e o alt antigos tenham sumido (a prévia local usa outros). Em `DECISIONS.md` e `CURRENT-STATE.md` ficaram as entradas das duas. O que a D-PROD-191 deixava "de propósito" para a #268 (`catalogoGlobalService.js` e a porta do catálogo) saiu com ela |
| #267 | mergeada na `main` (`b46bb184`) | nenhum |
| #263 (Estoque P1-03, D-PROD-185) | mergeada na `main` (`00a06096`) | nenhum; a branch dela não foi tocada |
| #270 | mergeada na `main` (`cf07309c`), integrada no primeiro merge | nenhum |
| #272 (D-PROD-192) | mergeada nesta branch pelo proprietário (`b4b5040e`) | nenhum |
| #269 (Apontamento de Atividade, D-PROD-190) | aberta; head `be322ab8`, já com a `main` `00a06096` | Só docs: `CURRENT-STATE.md` e `DECISIONS.md`, porque as duas PRs acrescentam entradas no mesmo ponto. Nenhum conflito de código |
| #273 (Curva de ganho, D-PROD-190) | aberta; base `cf07309c` | Nenhum a mais: os 11 arquivos que conflitam com esta branch já conflitam com a `main` de hoje (vêm das PRs #268 e #263) |
| #229 (Produtividade-00, rascunho) | aberta | nenhum; a branch dela não foi tocada |

As PRs #269 e #273 usam ambas a D-PROD-190. Isso não é desta fatia; fica registrado para quem integrar a segunda.

## 6. Verificação

Árvore final (merge da `main` `00a06096` nesta branch, antes do commit deste relatório):

```bash
node scripts/gates/verify-all.mjs --pular=test:backend
```

```text
  ETAPA                RESULTADO   EXIT    DURAÇÃO  COMANDO
  test:gates           PASS           0      64.6s  npm run test:gates
  governance-paths     PASS           0      147ms  npm run gate:governance-paths
  package-sync         PASS           0      133ms  npm run gate:package-sync
  product-scope        PASS           0      474ms  npm run gate:product-scope
  api-boundary         PASS           0       1.9s  npm run gate:api-boundary
  native-api           PASS           0      221ms  npm run gate:native-api
  setor-native         PASS           0      232ms  npm run gate:setor-native
  marca-native         PASS           0      166ms  npm run gate:marca-native
  unidade-medida-native PASS           0      168ms  npm run gate:unidade-medida-native
  tarefa-cadastro-native PASS           0      172ms  npm run gate:tarefa-cadastro-native
  lote-native          PASS           0      178ms  npm run gate:lote-native
  lancamento-tarefa-native PASS           0      252ms  npm run gate:lancamento-tarefa-native
  p52-cadastros-estoque-native PASS           0      270ms  npm run gate:p52-cadastros-estoque-native
  p54-base44-exit      PASS           0      153ms  npm run gate:p54-base44-exit
  p55-base44-exit-final PASS           0      155ms  npm run gate:p55-base44-exit-final
  area-pastagem-native PASS           0      197ms  npm run gate:area-pastagem-native
  map-geography-native PASS           0      215ms  npm run gate:map-geography-native
  usuario-admin        PASS           0      139ms  npm run gate:usuario-admin
  source-closure       PASS           0      209ms  npm run gate:source-closure
  import-integrity     PASS           0      184ms  npm run gate:import-integrity
  admin-isolation      PASS           0      711ms  npm run gate:admin-isolation
  no-secrets           PASS           0       2.7s  npm run gate:no-secrets
  base44               PASS           0      168ms  npm run gate:base44
  modelobase1-pecuario PASS           0      134ms  npm run gate:modelobase1-pecuario
  motorbase1-independence PASS           0      665ms  npm run gate:motorbase1-independence
  tenancy              PASS           0      186ms  npm run gate:tenancy
  rebanho-ssot         PASS           0      157ms  npm run gate:rebanho-ssot
  indices              PASS           0      131ms  npm run gate:indices
  deploy-migrations    PASS           0      173ms  npm run gate:deploy-migrations
  supabase-public-grants PASS           0      128ms  npm run gate:supabase-public-grants
  prisma:generate      PASS           0       6.8s  npm run prisma:generate
  types                PASS           0      14.2s  npm run gate:types
  typecheck:backend    PASS           0      11.1s  npm run typecheck:backend
  lint                 PASS           0      22.1s  npm run lint
  test:smoke           PASS           0     176.2s  npm run test:smoke
  build                PASS           0      18.4s  npm run build
  build:admin          PASS           0       1.2s  npm run build:admin
  admin-isolation:bundles PASS           0      186ms  npm run gate:admin-isolation

  Total: 325.6s
  Puladas (rodam em outro job): test:backend

TODAS AS ETAPAS PASSARAM
```

- `test:gates`: 825 testes, 0 falhas.
- `test:smoke`: 225 arquivos, 2.743 testes, todos passando.
- `gate:types`: 614 diagnósticos contra 625 do baseline. São 11 a menos, em 7 entradas, todas de `GerenciadorIcones.jsx`. O baseline não foi regravado aqui.
- `build`: pacote principal com 4.509,02 kB (1.276,44 kB com gzip).
- `test:backend`: não rodou localmente, porque o Postgres local parou com o reinício do contêiner. Esta PR não muda nenhum arquivo em `backend/`, e o `test:backend` roda no CI (`verify:full`) no head da PR. Na rodada completa anterior (`950907fc`, antes deste merge) houve 1 falha no IT-10 de `inicializarTenantMaikeCli` ("inventário mudou"). Sozinho, o mesmo arquivo passou 11/11: é interferência entre testes que dividem o banco, fora desta fatia.
- `prisma migrate diff` (Prisma 6.19.3), sem banco:

  ```bash
  npx prisma migrate diff --from-schema-datamodel <schema.prisma da main> --to-schema-datamodel backend/prisma/schema.prisma --script --exit-code
  ```

  Saída `-- This is an empty migration.`, código 0. As 46 pastas de migration são as da `main`.
- Desenhos: os 15 textos de `ANIMAIS_SVG`, `MISTOS_SVG` e `QUADRADINHO_SVG` na árvore final são iguais, byte a byte, aos arquivos do zip (15 de 15; SHA-256 no anexo). Os 6.010 SVGs montados na conferência (6.000 pastos aleatórios, com os 5 níveis, e os 10 subícones) são todos ASCII puro.
- CI: o check `verify:all` da PR roda no head final, com o `test:backend`. O merge só acontece com ele verde.

## 7. Divergências do molde, pendências e riscos

1. **Pacote maior.** Os desenhos entram como texto literal, sem reprocessar, como o proprietário pediu. Os três arquivos de desenho somam 303 kB (84 kB com gzip), e o pacote principal cresce perto disso (≈ +300 kB, ≈ +83 kB com gzip). Uma saída que não mexe nos desenhos é carregar `src/assets/icones/lotes/` num pedaço separado (import dinâmico).
2. **Categoria editada demora a chegar no mapa.** O mapa lê as Categorias de Manejo do cache offline, que vale 5 minutos (`createMapaQuery`). Depois de mudar o sexo ou a faixa de uma categoria, o marcador só troca no "Atualizar" do mapa ou quando o cache vence. Os detalhes usam a mesma leitura.
3. **A chave do desenho inclui o nível.** A chave é `n<nível>:<desenho>`: quando o pasto muda de nível e o desenho continua o mesmo, o `<img>` é trocado sem necessidade. Só custa uma troca; nada aparece errado.
4. **`btoa` só aceita Latin-1.** A data URL usa `btoa(svg)`. Hoje todos os SVGs montados são ASCII (§6), mas um desenho colado com caractere fora do Latin-1 (um `<title>` com acento, por exemplo) faria a montagem lançar erro. A troca por codificação UTF-8 é pequena.
5. **`LARGURA_MARCADOR_PX` não é a única medida do marcador.** `OFFSET_LOTE_PX` (`[0, -26]`) e as alturas fixas da D-PROD-128 (ícone 44 + 2 + nome 26 = 72 px) em `useMapRenderer.jsx` seguem calibrados para 44. Mudar a constante pede recalcular esses números.
6. **O README dos lotes promete mais que o teste.** `src/assets/icones/lotes/README.md` diz que o teste "confere que os arquivos são os do proprietário". O `iconesLoteMotor.test.js` confere altura, número de caminhos e marca da vaca (`MEDIDAS`), não o conteúdo. A conferência byte a byte (§6) foi feita contra o zip, que não está no repositório.
7. **Testes a reforçar.** A capacidade `categoriasManejo` do `mapaCacheService` não tem teste próprio, só o mock em `mapaCache.test.js`. O caso "Morte: categoria sem sexo nem faixa conhecidos fica sem ícone (nada de upload)" não oferece upload para a categoria e passaria também com o caminho antigo; quem prova que o upload saiu é a varredura da fonte no mesmo arquivo. Alguns testes antigos ainda mockam `ConfiguracaoIcone` de Lote sem precisar.
8. **CSS sem uso.** `src/styles/base1-design.css:91` ainda tem `:has([data-testid="icone-oficial-lote"])`, que punha o campo na linha inteira na densidade "rótulo à frente". Esse `data-testid` não existe mais, e a prévia local fica na largura normal do campo. É só aparência.
9. **Melhorias da revisão fora desta PR.** Depois da revisão ficaram prontas, mas fora da PR porque o proprietário pediu para parar as mudanças: chave sem o nível (item 3), data URL em UTF-8 (item 4) e releitura das categorias no mapa ao salvar uma categoria (item 2, ainda incompleta). Entram numa PR própria, se aprovadas.
10. **Linhas órfãs de `ConfiguracaoIcone`.** As linhas `tipo_entidade = 'Lote'` ficam no banco sem uso: o mapa, os detalhes e a tela de Configurações as ignoram. A limpeza é CONTRACT e depende de GO próprio.

## 8. Decisões que precisam do proprietário

1. **misto3 (macho 37+ com macho 0–8) só aparece com fêmea junto.** A cascata do pedido manda pasto de um sexo só para o nível 2 (um animal, o de mais cabeças), antes de olhar a tabela de mistos. Assim, touro com bezerros machos e nenhuma fêmea desenha o touro, ou o bezerro se este tiver mais cabeças, na cor do macho. O misto3 só vale quando há também alguma fêmea fora da faixa 37+ (com fêmea 37+, ganha o misto1). A fatia seguiu a ordem da cascata. Se o misto3 deve valer para pasto só de machos, a mudança é olhar a tabela antes do nível 2, com decisão própria.
2. **Nome de exibição dos mistos.** `ROTULO_MISTO` (`mistos.js`) ainda usa a chave (misto1 … misto4). Trocar é uma linha por misto.
3. **Pasto com sexo conhecido e sem nenhuma faixa.** Hoje vai ao nível 5: o adulto do sexo com mais cabeças, em vermelho, para avisar que o pasto não está classificado. A alternativa é desenhar esse adulto na cor do sexo.
4. **Limpeza das linhas de Lote em `ConfiguracaoIcone`.** CONTRACT, com GO próprio.
5. **Tamanho do pacote.** Aceitar os ≈ 83 kB a mais com gzip ou separar os desenhos num pedaço carregado sob demanda.
6. **As melhorias do item 9 de §7.** Abrir ou não a PR própria.

## Anexo — SHA-256 dos arquivos do zip `icones-lote-limpos.zip`

| Arquivo | SHA-256 |
| --- | --- |
| `femea-0-8.svg` | `fdf22897ad2e16d4eecd4dbd7279d89e83d4bb5be012b510c1b3773302469ff3` |
| `femea-13-24.svg` | `1be90a7a97844d8bbd361b62f53a5adc5fc6dfc5a3a96bea1eb2e75839d6e485` |
| `femea-25-36.svg` | `158ada68271b5ea96c1f3349702927498c2deff80d256ace49666e5cb84d2beb` |
| `femea-37-mais.svg` | `ae4493367af934ecc0b8a95c95d5334c4ecc1eb62970f64801f00709656fd2e8` |
| `femea-9-12.svg` | `c5a30316ef3b1872dd4c5bdc0d10799953d218eba4f1a57827b55a2effe2eacb` |
| `macho-0-8.svg` | `242d5c2852f5ad986f6cc98ba88f84f36f7eabd810026e21414de8f463651d36` |
| `macho-13-24.svg` | `384070360de48c4dedaffc7af728202b4d620f5db248290116b28c872116031d` |
| `macho-25-36.svg` | `0ce8557987f7400e35822a56730d9248f7227f2fa7df2fcbc7c3043c5523f59f` |
| `macho-37-mais.svg` | `1590547aceb5fc9f398deabd75bc0ec4d4862e498c07c36e82a41910edbf9af8` |
| `macho-9-12.svg` | `3d51aad831dabc6a97b14fa736b09d8780709317ab78eee0a1e4b7b68e5a5f1f` |
| `misto1.svg` | `05d23cc99bd930b1e99d0f7a1188017a41d7e89fb1f296c19176cc3f68060a43` |
| `misto2.svg` | `430608bd6c32fb281e24a7cde25a0ff2ce7b3b00837a2eeaf74d4f58b568e076` |
| `misto3.svg` | `733446a530aab9ca6044b8c17d7c405c0d753908c6a276ef6c63b869c8f42c09` |
| `misto4.svg` | `8282e15e9beb140a97589efc0e84662076c9a27c221d00cb6c979d5c79fd7c30` |
| `quadradinho.svg` | `308b140f4fca38c59038a82a995f9930a0991146ed30e06d700a92fdd33b3362` |
| `_medidas.json` | `c7f1fc2eeb73d3ba88a61e6e6b95e73ec1f9bee04676d351e6a9d5c755887412` |
