# PROMPT PARA CURSOR — MAIKE — CORREÇÃO REAL DE RESPONSIVIDADE MOBILE (PILOTO MARCAS)

## IDENTIDADE E MISSÃO

Repositório: `maikelimaadm-stack/MAIKE`.
Tela piloto: **Marcas**.
Base de evidência: auditoria aprofundada de 27/10/2026 e captura mobile enviada pelo proprietário (anexar também a imagem ao chat do Cursor).
Skill global: **`resposividade`**. Consultar também as demais skills de UI/UX, React, acessibilidade e diagnóstico instaladas no Cursor quando aplicáveis.

**EXECUTE CORREÇÕES REAIS NESTA MISSÃO.** Não entregue somente uma nova auditoria. Faça inspeção breve e direcionada do estado atual, confirme as causas no código, corrija de maneira incremental, rode testes e documente evidências. Não invente testes de navegador, screenshots, branches, arquivos ou gates executados.

**META:** reorganizar e corrigir a interface mobile/tablet da tela Marcas, sem redesenhar o MakGestão, sem alterar sua identidade visual nem suas regras de negócio. O resultado deve ser suficientemente consistente para que Marcas possa, FUTURAMENTE, servir de padrão às demais telas; **não propague ainda** a outras páginas.

## REGRAS DE GOVERNANÇA OBRIGATÓRIAS

1. Leia primeiro `AGENTS.md`, `CLAUDE.md`, `README_AI.md`, regras e documentação de engenharia que EXISTIREM; obedeça às instruções reais do repositório. Preserve contratos, SSOT, autenticação, tenant, permissões, APIs, migrations e regras de domínio.
2. Antes de editar, identifique `branch`, `HEAD`, estado da working tree, PR vinculada e `origin/main` sem sobrescrever trabalho em andamento. **Se houver PR aberta para esta correção, trabalhe na MESMA branch/PR; nunca crie outra PR enquanto a atual estiver aberta.** Nunca execute merge, feche PR ou marque como ready. O proprietário faz isso manualmente.
3. Não rebase/force-push, não apague mudanças pré-existentes e não altere branches de terceiros. Se houver conflito impeditivo, relate o bloqueio, sem apagar trabalho.
4. Preserve cores, tipografia, sombras, bordas, tokens `--mg-*`, linguagem Base1, skin Portal de Compras e estilo de ícones. Uma substituição pontual de símbolo ambíguo (raio usado como "Mais opções") é permitida, desde que justificada e visualmente coerente; sem reforma visual geral.
5. Não mude lógica financeira, dados, CRUD, contratos de API, Prisma, autenticação, permissões, módulos nem estrutura global fora das correções estritamente necessárias. Não adicione biblioteca sem necessidade comprovada.
6. Prefira ajustes em componentes compartilhados e estilos existentes, **mas considere regressões** em todas as telas consumidoras. Nada de `!important` em cascata como remendo sem investigar especificidade/ordem CSS; não duplique CSS por página.
7. Não passe para rollout geral. Primeiro implemente e valide o piloto Marcas. Qualquer defeito descoberto fora desse escopo deve ir para uma lista de follow-up, salvo correção imprescindível e de baixo risco para o piloto.
8. Em caso de descompasso entre estas hipóteses e o código atual, o código real prevalece. Apresente rapidamente a divergência e adapte a implementação sem inventar causa.

## EVIDÊNCIAS DA AUDITORIA A VERIFICAR NO HEAD ATUAL

Arquivos/candidatos (podem ter sido movidos; localize pelos símbolos se necessário):

- `src/pages/Marcas.jsx`
- `src/components/cadastro/base1/CadastroListaChrome.jsx`
- `src/components/cadastro/base1/Base1Ui.jsx`
- `src/components/cadastro/base1/CadastroBase1Grade.jsx`
- `src/components/cadastro/base1/CadastroColunaFiltro.jsx`
- `src/components/cadastro/base1/cadastroColunaFiltroCamada.js`
- `src/components/cadastro/CadastroWorkspace.jsx`
- `src/styles/cadastro-base1.css`
- `src/styles/cadastro-b1-portal.css`
- `src/styles/cadastro-b1-controls.css`
- `src/Layout.jsx`
- `docs/engineering/PLAN-RESPONSIVIDADE-MAIKE.md` e documentação UX-54, se existentes.

Problemas visíveis na captura: toolbar fragmentada em várias linhas; quatro ações no topo com proporções inconsistentes; limpar filtro isolado; clipe de anexo isolado; campo de busca; grupo de visualização e raio; tabela larga com scroll; estado vazio alto; summary e seletor de tamanho de página competindo com a bottom navigation.

Causas técnicas apontadas pela auditoria anterior **a confirmar**:

A. Skin Portal de Compras define botões normais da toolbar por volta de 25px, enquanto regra mobile aumenta somente `.tb-btn-green` e `.tb-btn-red` para aproximadamente 44px. `Novo`/`Excluir` ficam altos; `Editar`/`Duplicar`, baixos. A regra deve ser coerente para TODOS os botões equivalentes, mantendo proporção visual.

B. `.mg-toolbar__list-tools { width: 100%; ... }` no mobile permite ao pequeno botão `FilterX` monopolizar uma linha. Ele aparece até quando não há filtros ativos, caso o callback exista, mas fica desabilitado.

C. `Marcas.jsx` passa `attachDisabledReason` sem `onAttach`. Em `CadastroListaChrome`, a presença da explicação pode tornar `showAttachControl` verdadeiro, exibindo clipe desabilitado sem ação real. Não deve ocupar uma linha mobile.

D. A pesquisa com largura total no mobile é adequada, mas a **ordem dos controles ao redor** gera linhas soltas. Preserve pesquisa acessível e utilizável.

E. `.view-seg button` apresenta ~21px e `IconBtn` ~25px visuais. Ampliar a **área efetiva de toque** para alvo confortável (referência prática ~44×44 CSS px), sem necessariamente ampliar o desenho/ícone; evitar alvos invisíveis sobrepostos e verificar foco por teclado. Aplicar critério consistentemente.

F. O `IconeRaio` representa “Mais opções”, o que não é semanticamente claro. Avaliar trocar apenas esse ícone para elipse/reticências já disponível em `lucide-react`, preservando o estilo Base1.

G. **Hipótese de bug de popup que PRECISA de reprodução:** `cadastroColunaFiltroCamada.js` detecta camada aninhada pelo seletor `.b1-dp-filtro`, enquanto `CadastroColunaFiltro.jsx` renderiza este contêiner mesmo com o calendário fechado. Isso pode levar `haCamadaAninhadaDoFiltroAberta()` a bloquear indevidamente o clique externo. Investigue sem afirmar que já está comprovado. Não quebre interação legítima em selects, calendários e portais filhos.

H. O relatório anterior indica que a correção UX-54 (PR #64, já incorporada conforme auditoria de 27/10) tratou parte do overflow, mas deixou a ergonomia dos ícones e `Layout.jsx` global fora de escopo. Confirme no estado atual: não reverta correções úteis já presentes.

## EXECUÇÃO — SLICES PEQUENOS E VERIFICÁVEIS

### Slice 1 — Composição da toolbar mobile

- Corrigir a composição real do JSX + CSS compartilhado para telas pequenas (não somente ajustar margin em um seletor).
- Reorganizar semanticamente em grupos previsíveis:
  - **Linha de ações:** `Novo` em destaque + ações contextuais de seleção + acesso a `Mais`.
  - **Linha de busca:** `Buscar marcas...` em largura total, sem corte.
  - **Linha de visualização/filtros:** `Registro | Tabela | Cards` e ferramentas contextuais apenas quando fizer sentido.
- Em 320px, permitir **priorização progressiva**: ações secundárias como `Duplicar` podem ir para menu `Mais`, e também `Editar`/`Excluir` se for necessário; não force quatro botões enormes a caber artificialmente. Todas as ações disponíveis e seus estados devem permanecer acessíveis.
- Preservar comportamento do botão `Novo`; `Editar`, `Duplicar` e `Excluir` devem respeitar seleção e autorizações existentes. Não habilitar ação desabilitada apenas para melhorar aparência.
- Ocultar ou deslocar `Limpar filtros` desabilitado sem filtros ativos somente no mobile, sem perder a função quando filtros estiverem ativos.
- Não exibir clipe sem ação funcional como destaque mobile. Se informar indisponibilidade no menu, fazer sem sugerir que a ação funciona.
- Padronizar alinhamento vertical, espaçamentos e áreas de toque; rótulos acessíveis para controles icon-only.
- Preservar aparência e comportamento desktop, com variações apenas onde necessárias.

### Slice 2 — Popups, menus, calendários e foco

- Inventariar os elementos realmente usados em Marcas: Mais opções, filtros de coluna, datepicker, selects, configurações de coluna, modos/cards, dropdowns e diálogos.
- Corrigir bugs REPRODUZIDOS de dismiss/outside-click no local da causa; não instalar listeners globais duplicados indiscriminadamente.
- Contrato: clique/tap no trigger abre; clique interno não fecha; clique realmente fora fecha quando o controle permitir; `Escape` fecha a camada superior; layers filhas funcionam sem fechar pai indevidamente; foco retorna corretamente; posicionamento não excede viewport.
- Criar teste para filtro de data **renderizado mas calendário fechado**: clique fora e Escape devem fechar filtro pai. Criar também teste com calendário aberto e interações internas.
- Conferir o comportamento touch/pointer no celular, não apenas `mousedown` de mouse desktop.

### Slice 3 — Tabela, vazio, summary, bottom navigation

- Manter tabela com scroll **horizontal interno**, sem scroll lateral da página toda.
- Não comprimir colunas até ficarem ilegíveis; modo Cards deve continuar como alternativa e preferências devem ser preservadas.
- Melhorar o estado vazio com ocupação de espaço coerente, sem mexer em dados/filtros.
- Organizar summary (`Selecionados`, `Listados`, `Filtrados`, `Totais`), seletor de paginação e controle inferior em mobile, reduzindo confusão sem eliminar dados existentes.
- Garantir que footer, scroll, menus, telas de formulário e ações não sejam cobertos pela bottom navigation ou safe areas.
- Em `Layout.jsx`, **não reformular navegação global**: corrigir apenas se houver bug reprodutível diretamente impeditivo; documentar restante para outro slice.

## MATRIZ DE TESTES OBRIGATÓRIA

Viewports: **320, 360, 375, 390, 414, 768, 1024, 1280, 1440 e 1920 px**. Testar alturas realistas, portrait/landscape nos tamanhos pertinentes.

Em cada breakpoint crítico, verificar e registrar:

- Página sem overflow horizontal; tabela pode rolar horizontalmente SOMENTE no contêiner.
- Botões alinhados e operáveis; nenhuma ação desaparece sem alternativa acessível.
- Busca, filtros, alternador Registro/Tabela/Cards, seleção e ações funcionando.
- Menus/popups não ultrapassam viewport, não ficam atrás da bottom navigation, nem travam o scroll.
- Outside-click/tap, `Escape` e foco; camada filha ativa vs inativa.
- Estados vazio, carregando, com registros, 0/1/múltiplas linhas selecionadas.
- Criar, editar, duplicar, excluir conforme permissões e confirmações atuais, sem alterar persistência.
- Formulários e tabelas continuam bons em desktop/tablet.
- Ícones visualmente consistentes, labels acessíveis, hit areas sem colisão.
- Navegação inferior não encobre controles importantes.

Se disponível, executar browser E2E real (Playwright ou ferramentas do projeto) e salvar screenshots ANTES/DEPOIS em pelo menos 375px, 768px, 1440px. Se execução do navegador for impossível, registrar **NÃO TESTADO**, os comandos tentados e um checklist manual exato — nunca simular evidência.

Gates: confirme scripts no `package.json` e execute os que realmente existirem, priorizando `npm run test:smoke`, `npm run build` e `npm run verify:all` **quando definidos**. Acrescente testes unitários/integrados focados nas regressões de toolbar e popup. Não desligar gates nem modificar testes para esconder falhas. Se a suíte exigir ambiente externo indisponível, documentar bloqueio, escopo e resultado parcial.

## CRITÉRIOS DE ACEITE / DEFINITION OF DONE

- Marcas mobile **não tem mais** ícones solitários ocupando linhas vazias.
- Controles do mesmo grupo ficam harmonizados; área de toque confortável sem alterar estética.
- Busca e visualizações funcionam; ações secundárias são encontráveis e não desaparecem.
- Filtros e popups fecham corretamente, sem quebrar layers aninhadas.
- Tabela, cards, footer e bottom navigation funcionam em celular e tablet.
- Desktop permanece visualmente estável; nenhuma regressão funcional nas telas que reutilizam o componente compartilhado.
- Evidências reais (caminhos/arquivos, testes e screenshots quando possível); não considerar “build verde” equivalente a “UX homologada”.
- **Não propagar** a UX do piloto a todas as telas até o proprietário aprovar a homologação visual de Marcas.

## RELATÓRIO FINAL — EM UM ÚNICO BLOCO DE TEXTO

Responder dentro de um único bloco Markdown `text`, incluindo:

1. Repositório, branch, HEAD, PR existente, base e arquivos alterados.
2. Lista de defeitos confirmados vs hipóteses descartadas/pendentes, com caminhos e causa raiz.
3. Correções concretas feitas em cada slice e seus impactos em componentes compartilhados.
4. Matriz com viewports testadas e EVIDÊNCIA (screenshots/execução, ou “não testado”).
5. Testes automatizados/gates executados: comando, resultado e limitações.
6. Comparativo antes/depois da toolbar e do filtro de data.
7. Riscos de regressão e plano de rollback.
8. Status: **APROVÁVEL PARA HOMOLOGAÇÃO VISUAL** ou **BLOCKED** (com motivos). Nunca declarar automaticamente aprovado/mergeado.

**Não abra PR paralela; não faça merge. Não termine com sugestões genéricas se as correções dentro do escopo forem possíveis: implemente, teste e traga evidências.**
