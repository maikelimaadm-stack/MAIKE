# UX-MOBILE-V2 — celular e chrome Base1 conforme o protótipo "MAIKE App v2"

**Decisão:** D-PROD-86 · **Branch:** `claude/mobile-shell-base1-v2`
**Fonte:** handoff do Claude Design (`MAIKE App v2.dc.html` + conversa de 29–30/10/2026).

## O que mudou

| Área | Arquivos |
|---|---|
| Shell do celular: cabeçalho, barra de vidro, Módulos, Trocar empresa | `src/Layout.jsx`, `src/components/navigation/MobileModulesView.jsx`, `src/lib/mobileShellContext.jsx`, `src/styles/maike-mobile-shell.css` |
| Folha de baixo única (62/92%, alça, fundo preto) | `src/components/common/MobileSheet.jsx` |
| Ações só com ícone; raio na faixa; Filtros; pesquisa recolhível sem fechar sozinha; navegação de registro; resumo oculto na edição; carga automática de 200 | `CadastroListaChrome.jsx`, `CadastroBase1Screen.jsx` |
| Filtrar por campo | `FiltroPorCampo.jsx`, `filtroPorCampoBus.js`, `CadastroBase1Grade.jsx` |
| Filtro de coluna: condição ao vivo, bloqueio de zero, folha no celular | `CadastroColunaFiltro.jsx`, `cadastroColunaFiltroLogic.js` |
| Menu da coluna na folha (celular) | `Base1Grid.jsx` |
| Seletor na folha com pesquisa e teto de 100 | `MgSelect.jsx` |
| Toque: multisseleção e toque duplo | `selectClick.js`, `Base1Grid.jsx`, `Base1Cards.jsx` |
| Cards se alinham sozinhos abaixo do desktop | `Base1Cards.jsx`, CSS |
| Avisos no topo, centralizados | `MaikeSonnerToaster.jsx` |

Removido: `src/components/common/BackButton.jsx` (só o Layout usava).

## Diferenças em relação ao protótipo

- **Tablet:** continua com o cabeçalho e o menu de módulos do desktop. O rail lateral do protótipo não foi feito.
- **Mapas:** Mapa Geral e Cadastro do Mapa do protótipo são simulações. Os mapas reais (MapLibre) não foram tocados.
- **Menu do usuário (Configurações, Sair):** continua acessível no celular, pelo avatar à direita do cabeçalho. No protótipo ele não aparece.
- **Botão Filtros:** não mostra a quantidade de filtros. Ele fica verde quando há filtro ativo, porque o chrome só sabe se há filtro, não quantos.
- **Editar/Duplicar:** somem quando não há exatamente 1 selecionado (comportamento do protótipo). No desktop, continuam apagados, como no sistema.
- **Voltar do registro:** volta para a grade de tabela, como antes (`exitRecordView`).

## Verificação

- `npm run test:smoke`: 1003 testes passam, incluindo os 13 novos de `tests/smoke/mobileShellV2.test.jsx`. `tests/smoke/appShell.test.jsx` foi ajustado: o gatilho agora é "Módulos", e é preciso escolher o módulo antes da tela.
- `npm run verify:all`: todas as etapas passam, exceto `test:backend`, que exige `DATABASE_URL` com PostgreSQL. O ambiente da sessão não tem banco, e esse teste roda no CI.
- **Conferência visual a 390×844** (Chromium com toque e dados sintéticos; não é o app autenticado): `docs/engineering/evidencias/ux-mobile-v2/`.
  - Cards com multisseleção, Mais opções, registro com navegação, edição.
  - Filtrar por campo, filtro de coluna, Módulos, telas do módulo, Trocar empresa.
- **Não conferido na tela:**
  - seletor (`MgSelect`) na folha: a tela usada não tem select;
  - tablet;
  - aparelho real.

## Checklist manual (aparelho real)

- [ ] Pesquisa abre e não fecha sozinha; fecha ao tocar fora.
- [ ] Puxar a alça de uma folha: sobe para 92%, desce para 62%, fecha.
- [ ] Toque duplo abre o registro; toque simples marca vários.
- [ ] Rolar até o fim carrega mais 200 (lista grande).
- [ ] Campos de 16px não dão zoom no iPhone.

## Paridade 2 (D-PROD-88)

Feita depois de o proprietário apontar diferenças em "campos de lançamento, cabeçalhos de filtros e mais algumas coisas".

**Método:**
- protótipo `MAIKE App v2.dc.html` aberto no Chromium a 390×844, lado a lado com o sistema, nas mesmas telas: Produtos em lista, tabela, registro, edição, Filtrar por campo e filtro de coluna;
- formulários de lançamento renderizados direto com dados sintéticos.

| Diferença encontrada | Correção |
|---|---|
| Lançamentos (pesagem, morte, nascimento, abate, movimentação, tarefa, ponto, linha, bebedouro…) com rótulo em cima e borda slate | `LancField` (`.mg-field` Base1) no lugar dos 12 `FL` locais; botões em pílula Base1 |
| `Select` shadcn abria lista flutuante no celular | Folha de baixo (CSS sobre o wrapper do Radix, `ui/select.jsx`) |
| Campos ligados a cadastro (`AutocompleteGenerico`) com lista flutuante | Folha de baixo com pesquisa, total e teto de 100 |
| `<select>` nativo (Tipo de Uso, Tipo, Status…) abria o seletor do sistema | `B1Select`: nativo no desktop, folha no celular |
| Cards com todos os campos, código ao lado do nome e bolinha de marcar | 3 campos no celular, código embaixo do título, seleção por toque e selo ✓ |
| Grade com linhas de 26px no toque | 40px (linhas e cabeçalho) e texto de 13px até 1023px |
| Resumo começando por Selecionados | Listados · Filtrados · Totais · Selecionados |
| Filtro de coluna com título repetido na folha | Título removido |

**Não alterado (fora desta rodada):**
- o formulário de Lotes, que usa o `DynamicFormRenderer` com layout próprio configurável;
- as seções recolhíveis "Dados gerais / Estoque e preço", que o protótipo inventou a partir de dados fictícios e não existem nos formulários reais;
- os números alinhados à direita nos campos de preço (padrão atual do sistema).

**Testes:** `tests/smoke/mobileParidadeV2.test.jsx` (PAR1–PAR6).

## V3 — tablet e correções relatadas (D-PROD-91)

| Relato | Causa | Correção |
|---|---|---|
| Seleções do desktop "às vezes aparecem, às vezes não" | `AutocompleteGenerico` sem painel com a lista vazia ou carregando, e sem reabrir no clique depois de uma escolha (o campo continuava focado) | Painel com aviso; abre no clique; visual Base1 |
| Cadastro de Lotes "travado" / sobreposição | "Sistema Produtivo" num `.mg-field` de altura fixa, transbordando sobre os vizinhos | Campo de altura livre e pílulas de marcar |
| Datas fora do campo no celular | Safari do iPhone centraliza a data nativa e ignora o espaçamento | Alinhamento à esquerda via `::-webkit-date-and-time-value` |
| Campos de Lotes menores no celular | `.cadastro-b1` interna redefinia `--mg-field-h` para 38px | 48px também nas `.cadastro-b1` internas |
| Botões diferentes no desktop | O tema do portal impunha 72px de largura ao verde | Círculos em todos os tamanhos; sombra verde em toda a barra; pílulas nos botões genéricos |
| Tablet | — | Cabeçalho, barra lateral de 84px, toolbar em uma linha com 36px, Trocar empresa centralizado |

Medição no harness (Cadastro de Lotes, desktop): digitar 28 caracteres levou cerca de 300ms, sem mutações em repouso. Não houve travamento de render; o "travado" vinha do campo sobreposto e da seleção que não abria.

**Não conferido:**
- aparelho real: a correção das datas é específica do Safari do iPhone e não aparece no Chromium;
- Lotes com dados reais de setores e áreas.

**Testes:** `tests/smoke/mobileV3TabletBugs.test.jsx` (V3-1 a V3-6).

## V4 — padrão iOS / app do Claude (D-PROD-95)

Pedido do proprietário com prints do app do Claude no iPhone. Conferido no Chromium a 390×844 com toque (CDP) e a 1366×800. Capturas em `evidencias/ux-mobile-v2/v4-*.png`.

| Pedido | Feito | Evidência |
|---|---|---|
| Folha embaixo com margem; no alto encosta nas bordas | Média = cartão flutuante; grande = borda a borda até o topo | v4-05, v4-06 |
| Subir e descer sem mirar no botão de cima | Arrasta pela alça, pelo cabeçalho e pela lista no topo | v4-06 |
| Mais opções e outros menus no estilo do app | Vidro claro com desfoque e itens grandes; o ⚡ ficou no lugar | v4-02 |
| Botões grandes demais no celular | 44 → 38 px na barra | v4-01 |
| Opções com linha divisória, não um cartão por opção | Lista agrupada num cartão branco | v4-05 |
| + à direita para cadastrar novo (como o "i" do app) | + no título da folha; abre o formulário da entidade sem perder o atual | v4-05, v4-07 |
| + verde e ✓ verde, sobre fundo cinza | Novo e Salvar em todos os tamanhos | v4-01, v4-09 |
| Salvar à direita, descartar à esquerda | Barra e cabeçalho do registro no celular | v4-03, v4-09 |
| Abertura do registro novo como a folha | ✕ · título · ✓ no cabeçalho; o formulário entra de baixo | v4-03 |
| Arrastar do lado para voltar | Borda esquerda → mesmo voltar do cabeçalho | verificado (Novo lote → Lotes) |
| Teclado numérico nos números | `inputmode="decimal"` | teste V4-2 |
| Enter vai ao próximo; no último salva | `tecladoFormulario.js` | testes V4-1 e V4-3 |
| Chave Ativo como a do iPhone (Modo Avião), sem Sim/Não | Trilho largo, bolinha em cápsula que estica ao pressionar, chave na ponta direita; texto removido | v4-03 |
| Mais efeitos e transições | Folha, menu e registro com curva do iOS; botões encolhem ao toque | — |
| Anexos no padrão do sistema; nos Lotes em Mais opções | Folha padrão; item "Anexos" no ⚡ (também na edição) | v4-08 |
| Valores alinhados e ícone do tipo à direita | ▾ seleção/lista, calendário, relógio; texto e número sem ícone | v4-04 |

**Verificação:** `npm run verify:all` passa em tudo menos `test:backend`, que exige PostgreSQL (`DATABASE_URL`) e não roda neste ambiente.

**Não testado em aparelho real:**
- gesto de voltar no Safari: o iOS também tem o gesto nativo do navegador e, em aba comum, os dois podem competir. Instalado como app (tela inicial), só o nosso vale;
- `enterkeyhint` e `inputmode` no teclado do iPhone.

## V5 — ajustes depois do uso no aparelho (D-PROD-96)

| Pedido | Feito | Evidência |
|---|---|---|
| Anexo ao lado do Salvar; remover a linha do anexo | 📎 antes do ✓ no cabeçalho (celular) e na barra (desktop); a barra some na edição do celular | v5-03, v5-04 |
| Mais ações iguais nas telas | Menu do shadcn com o mesmo vidro do Mais opções no desktop | — |
| Piscada ao ir para a visualização de registro | Animação de montagem removida; quadros de 0 a 500 ms estáveis | — |
| Atrasos ao subir e descer a folha | Arraste só com `transform` + `requestAnimationFrame` | teste V5-8 |
| Cards só com os cards | Fundo da página atrás dos cards | v5-01 |
| Botões do mesmo tamanho, sem sombra, cinza; ícone na mesma cor | Regra única para todos os botões | v5-01, v5-04, v5-05 |
| Configurar colunas no celular | Lista com chave do iOS, ↑↓, pesquisa e Restaurar | v5-02 |
| Filtros: descartar à esquerda, filtrar à direita | ✕ Cancelar · aviso · ✓ Aplicar | teste V5-3 |

**Verificação:** `npm run verify:all` passa em tudo menos `test:backend`, que precisa de PostgreSQL e não roda aqui.

## V7 — chave do iOS (D-PROD-98)

| Pedido | Feito | Evidência |
|---|---|---|
| Todas as chaves do tamanho da de Configurar colunas, um pouco mais compridas | 56×26 em todas (B1Switch, ToggleSwitch, Switch do shadcn) | teste V7-1; medido 56×26 |
| Pulinho do iPhone | A cápsula passa ~3 px do ponto e volta; estica ao pressionar | teste V7-2; posição medida quadro a quadro |
| Nos formulários, ao lado do rótulo | A chave fica colada ao rótulo | v7-01 |

