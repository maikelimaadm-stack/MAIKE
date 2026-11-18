# MAIKE — Mapa Geral: lançamentos e históricos dos detalhes no desenho do lançamento de manejo (D-PROD-222)

## 1. Pedido

Depois da D-PROD-220 (os detalhes do mapa no desenho do Detalhes do Lote v12), o proprietário pediu: "os campos de lançamentos [e] históricos [no] estilo do lançamento de manejo têm que ser a mesma coisa".

- **Referência:** os lançamentos do lote (ex.: Registrar Pesagem, `FormularioPesagem` no `LancLoteDialogo` do `DetalhesLote`) e o Histórico de Movimentação (`HistoricoMovimentacoes`).
- **O que continua igual:**
  - dados, consultas, validações e mensagens;
  - permissões (D-PROD-137) e a política de estorno (D-PROD-94a);
  - invalidações, cache do mapa e envio ao servidor;
  - as listas de escolha, no padrão do sistema (`B1Select`), e os filtros do mapa.
- **Numeração:** nasceu D-PROD-221 nesta branch. A `main` deu a D-PROD-221 ao Farol de forragem (PR #311), e esta passou a **D-PROD-222**. Os commits já enviados citam "D-PROD-221"; o código, os testes e os documentos dizem D-PROD-222.

## 2. O que mudou

### 2.1 Cartão comum dos históricos

`src/components/lotes/CartaoHistorico.jsx` reúne as peças do cartão do Histórico de Movimentação, com as mesmas classes:

- `CartaoHistorico`: selos (a data primeiro), título em negrito, linhas "Rótulo: valor" e o rodapé de ações separado por um traço. Com `cancelado`, usa o fundo dos cancelados.
- `SeloHistorico`: os tons `data`, `neutro`, `verde`, `vermelho` e `ambar`.
- `LinhaHistorico` e `AcaoHistorico`. `AcaoHistorico` é o botão do "Excluir movimentação": contorno, 32 px, vermelho quando ligado.
- `MolduraHistorico`: sem cartão em volta e sem rolagem própria (quem rola é o diálogo). `antes` recebe os avisos e `estado` substitui a lista.
- `EstadoHistorico`: carregando (`role="status"`), erro (`role="alert"`) e vazio, com os textos do manejo.
- `useTituloDoHistorico`: dentro do `LancLoteDialogo`, o título com a contagem vai para o cabeçalho. Com contagem 0 ou nula, mostra só o título.

### 2.2 Históricos

| Histórico | Selos | Título em negrito | Linhas | Rodapé |
|---|---|---|---|---|
| Cocho ("Histórico do Cocho (N)") | data · Fechado/Em aberto · desvio | produto | Áreas, Cabeças, Peso médio, Unidade, métricas por seção (`CardMetricaEvento`), Observações | sem "Excluir" enquanto o estorno estiver suspenso (aviso no topo) |
| Depósito ("Histórico do Depósito (N)") | data · tipo | produto | Quantidade, Unidade, Origem, Destino, Saldo antes/depois, Valor total, Custo médio, Observações | idem, com os avisos de antes |
| Bebedouro ("Histórico do Bebedouro (N)") | data · tipo · status fora do normal | bebedouro | Hora (quando gravada), Descrição, Registrado por, Custo, Produto, Quantidade, Qualidade e Escore da água | "Excluir" (D-PROD-137: índice 0, `podeExcluir`, `data-permissao-explicita`, confirmação, 409) |
| Tarefa ("Histórico da Tarefa (N)") | data · status | tarefa | Evento, Responsável, Descrição, Hora | "Excluir", só o mais recente ligado |
| Abate do curral | data · Abate · Ativo/Cancelado | lote | Quantidade, Data, Peso médio, Destino, Detalhes | "Excluir movimentação" |

O histórico do bebedouro deixou de ser uma tela empilhada no detalhe. Agora abre num `LancLoteDialogo` por cima dele, que é largo e só de leitura. O "Ver tudo" do resumo abre o mesmo diálogo.

### 2.3 Lançamentos

Todos abrem no `LancLoteDialogo` dos manejos:

- O título é a ação e o subtítulo é o nome do cocho, do depósito ou do bebedouro.
- No desktop abrem em popup, com ✕ e ✓ no cabeçalho. No celular abrem em tela cheia, com ✕ à esquerda, título no meio e ✓ à direita.
- Cada campo fica num `LancField`, com o rótulo dentro da caixa e * nos obrigatórios. As escolhas usam `B1Select`, e os avisos, `LancLoteAviso`.
- O ✓ do cabeçalho envia o formulário (`type="submit"` com `form` = id do `LancLoteForm`).

| Lançamento | O que mudou |
|---|---|
| Cocho › Lançar (`FormularioLancamentoSuplementacao`) | Aviso com áreas, depósito, lotes e peso. Formulação no `B1Select`. Kg ou sacos em `LancLoteSegmento`. Consumo por lote em `LancLoteItens`. O progresso do salvamento fica no topo, com os campos travados e o ✕ desligado. O ✓ é um botão comum: Enter num campo não grava, como antes. A prévia do fechamento usa as células sem borda do aviso. A sobra do ciclo anterior virou um `LancLoteDialogo` com as opções do manejo (foco na primeira escolha). Depois da sobra herdada, o foco volta ao lançamento. |
| Cocho › Leitura | O cocho entra no subtítulo. O formulário já era do manejo (D-PROD-205). |
| Depósito › Entrada e Saída (`FormularioTransferenciaDeposito`) | Títulos "Entrada no Depósito" e "Saída do Depósito". Produto e Unidade no `B1Select` (escolher de novo o mesmo produto não mexe na unidade nem na quantidade). Origem · destino · saldo num aviso neutro. No celular, as folhas abrem dentro do diálogo de cima (D-PROD-161). O Local continua no `AutocompleteGenerico`, a lista padrão de locais (instrução do proprietário). |
| Bebedouro › Lançar (`FormularioLancamentoBebedouro`) | Título "Lançamento no Bebedouro", por cima do detalhe (antes era tela empilhada). Data, Hora, Tipo e Status em grade. Tipo, Status e Qualidade da água no `B1Select`. Os campos aparecem pelo Tipo, como antes. |

### 2.4 Teclado e foco (nas peças comuns, valem também para os manejos do lote)

- **Esc com uma lista aberta:** no celular, quando há uma folha de lista aberta dentro do `LancLoteDialogo`, o primeiro Esc fecha só a folha e o segundo fecha o diálogo. Antes só a Entrada e a Saída do depósito tinham essa guarda, no próprio formulário.
- **`B1Select` pelo teclado:** no desktop e no tablet, com até 8 opções (sem a caixa de pesquisa), ↑/↓ andam pela lista aberta e Enter escolhe, com o foco no campo — o campo repassa as teclas ao painel, como o `AutocompleteGenerico`. Antes, com a lista aberta, as teclas não faziam nada.
- **Foco do `LancLoteDialogo`:**
  - só leitura (históricos e detalhes): ao abrir, o foco vai para o próprio diálogo, sem acender o ✕;
  - `focoInicial="corpo"`: o primeiro controle do conteúdo (a escolha da sobra);
  - ao fechar, o foco volta à pílula que abriu o diálogo.

### 2.5 Com a `main` mesclada (D-PROD-221)

O farol do pasto no painel Forragem entrou no desenho v12 da D-PROD-220 como a primeira linha do cartão:

- o rótulo da situação ou "Sem medição recente";
- a cor na bolinha;
- "há N dias" e "vencida (mais de 15 dias)".

### 2.6 Estados dos históricos

Como no Histórico de Movimentação: com a consulta falhando e nada guardado, "Não foi possível carregar o histórico.", o motivo e o "Tentar novamente" (cocho, depósito, abate, tarefa e bebedouro). Antes eles diziam "Nenhum … encontrado". A tarefa também mostra o carregando, e o abate só monta o rodapé do "Excluir movimentação" quando o abate tem exclusão.

## 3. Mudanças de comportamento (de propósito)

Estas mudanças vêm do padrão dos manejos (D-PROD-115/125):

- **Desktop:** o popup não fecha por Esc nem por clique fora, só pelo ✕.
- **Teclado:** no depósito e no bebedouro, Enter num campo envia, como já enviava (eram `<form>` com botão de enviar). No cocho, não envia, como antes: só o ✓ grava.
- **Celular:** o lançamento abre em tela cheia. No depósito, isso substitui o cartão centralizado.
- **Bebedouro:**
  - o Esc da tela cheia fecha o Lançar; antes era ignorado, porque o formulário era empilhado;
  - era o único formulário empilhado: o recurso `escVolta` da D-PROD-220 ficou sem uso e saiu do `LancLoteDialogo` e da `CascaDetalhe`.
- **Foco:**
  - ao abrir um lançamento, vai para o ✕ (o primeiro focável), e não para a data;
  - ao abrir um histórico ou um detalhe, vai para o próprio diálogo;
  - ao fechar, volta à pílula que abriu o diálogo.
- **Placeholders:** "Selecione a formulação" e "Não medida" saíram. O rótulo dentro da caixa faz esse papel, como nos manejos.

## 4. Arquivos

- **Novos:**
  - `src/components/lotes/CartaoHistorico.jsx`;
  - testes `cartaoHistoricoIgualManejo`, `historicosMapaEstiloManejo`, `lancamentoSuplementacaoEstiloManejo` e `transferenciaDepositoEstiloManejo`.
- **Históricos:**
  - `HistoricoSuplementacaoPonto`, `HistoricoDepositoSuplementacao` e `CardMetricaEvento`;
  - `HistoricoTarefaPanel` e `HistoricoAbateCurral`;
  - `BebedouroTimeline` e `cartoesDoBebedouro`.
- **Lançamentos:**
  - `FormularioLancamentoSuplementacao`, `FormularioTransferenciaDeposito` e `FormularioLancamentoBebedouro`;
  - os detalhes que os abrem: `DetalhesPontoSuplementacao`, `AcoesCochoPasto`, `DetalhesDepositoSuplementacao` e `DetalhesBebedouro`.
- **Peças comuns:**
  - `LancamentoLoteUi` (o Esc com a folha aberta; o foco ao abrir e ao fechar, com o diálogo de cima quando quem tinha o foco ficou escondido; `focoInicial`; saiu o `escVolta`);
  - `B1Select` (↑ ↓ Enter repassados ao painel aberto);
  - `CartaoHistorico` (`EstadoHistorico` com o motivo e o "Tentar novamente"; sem as props que ninguém usava);
  - `FarolConsumo` (`desenho` "linhas" e "kpis" do resumo do fechamento);
  - `CascaDetalhe` (saiu o `escVolta`), `LinhaDoTempo` (saiu o ramo das ações, sem uso), `LancField` e `src/Layout.jsx` (só comentários).
- **Sobra do ciclo anterior:** `SobraHerdadaDialog` (agora `LancLoteDialogo`).
- **Detalhe da tarefa:** `DetalhesTarefaMapa` passa carregando, erro e o "Tentar novamente" ao histórico.
- **Tela Bebedouros:** `src/pages/Bebedouros.jsx` passa `semCabecalho` ao detalhe; saiu a barra do registro, que ficou sempre vazia.
- **CSS:**
  - `mk-dp-bebedouro.css` (saiu a regra morta do formulário empilhado);
  - `lancamento-lote.css` (`mk-ll__opcao--coluna`, a opção com explicação longa);
  - regras sem uso que saíram: `.mk-launch-action.tb-btn-green` (`lancamento-lote.css` e `mk-unificado.css`), `.mk-map-dialog` (`mk-mapa-superficie.css`) e `.mk-dp-tl__acoes` (`mk-dp-historico.css`).
- **Teste novo da revisão:** `b1SelectTeclado`. Reforçados: `cartaoHistoricoIgualManejo`, `detalhesV12Bebedouro` e `bebedourosTelaParidade`.
- **Mescla com a `main`:**
  - `PainelForragemArea` (farol no v12);
  - `MapaGeral` (as medições de forragem ao lado das movimentações da D-PROD-218).
- **Roteiro de dev:** `scripts/dev/e2e-estoque-p0.mjs` (o "Salvar" virou o ✓ "Registrar Saída").

## 5. Testes e gates

- **Formas de prova:** cada frente tem testes com os componentes reais (só a rede é falsa). Eles provam:
  - o desenho: classes do cartão iguais às do Histórico de Movimentação, título e subtítulo do diálogo, ✕/✓ no cabeçalho, `LancField`, `B1Select` e a folha dentro do diálogo;
  - as regras de antes: o mesmo envio, as mesmas mensagens, as mesmas invalidações e as mesmas permissões.
- **Mutações:** aplicadas por script e restauradas.
  - Cocho Lançar: 14.
  - Depósito: 19.
  - Bebedouro: 26 mais 2.
  - Integração: 7. São elas: bebedouro sem `B1Select`; Leitura sem subtítulo no detalhe e no pasto; "Excluir" sem `destrutiva`; Esc sem a guarda da folha (bebedouro, FT2, TM-8); farol sem a marca de vencida e sem a cor.
  - Correções da revisão: 23, uma ou mais por correção (ver §7).
  - Lente dos testes: 9. O cartão cancelado, os selos vermelho e âmbar e o "Excluir" (4); o selo de data do bebedouro (4); o cabeçalho da tela Bebedouros (1).
  - Todas foram pegas. Duas sobreviveram no começo e passaram a ser pegas com testes novos: a data da sobra (os testes rodam em UTC; o teste novo usa um horário em que UTC muda o dia) e a ligação do carregando no detalhe da tarefa.
- **Resultado:** os números da suíte inteira e dos gates estão no §7.

## 6. Conferência visual

O harness local (`harness-v12.local`, fora do git) roda os componentes reais com dados de exemplo. Telas comparadas com o Registrar Pesagem e o Histórico de Movimentação, a 1280 px e a 390 px:

- Cocho: Lançar e Leitura.
- Depósito: Saída.
- Bebedouro: Lançar, a lista de Tipo no celular e o Histórico.

O que se vê:

- o mesmo cabeçalho (título, subtítulo, ✕/✓);
- as mesmas caixas com o rótulo dentro e a mesma folha de lista no celular;
- os mesmos cartões de histórico: selos, título em negrito, linhas "Rótulo: valor" e o "Excluir" no rodapé.

## 7. Revisão independente e resultado

### 7.1 Revisão

Quatro revisores, cada um com uma lente, leram o intervalo `465fe6d..HEAD`. Cada achado passou por um verificador que tentou refutá-lo contra o código atual e o de antes.

| Lente | Achado | Resultado |
|---|---|---|
| Regras | Depósito: escolher de novo o mesmo produto voltava a unidade para KG e apagava a quantidade (o `B1Select` chama o `onChange` com o mesmo valor; o Select de antes não) | Corrigido, com teste (TM-3) |
| Igualdade | Cocho: Enter num campo gravava o lançamento (o ✓ era o submit do `<form>`); antes, Enter não fazia nada | Corrigido: o ✓ é botão comum (LM-1, LM-10) |
| Igualdade | Cocho: o aviso da sobra mandava clicar em "Salvar novo ciclo", que não é mais um botão com texto | Corrigido: aponta para o ✓ (LM-9) |
| Igualdade | "Fechamento do consumo" em caixinhas com borda dentro do cartão do histórico e do aviso do Lançar | Corrigido: em linhas no histórico, em células sem borda no aviso (LM-11) |
| Igualdade | Local de Origem/Destino do depósito no `AutocompleteGenerico`, não no `B1Select` | Mantido: é a lista padrão de locais, e o proprietário pediu a lista no padrão do sistema |
| Igualdade (já era assim) | Sobra do ciclo anterior no diálogo antigo, com o texto cortado à direita | Corrigido: `LancLoteDialogo` com as opções do manejo (LM-9, LM-12, LM-13) |
| Igualdade (já era assim) | Históricos sem estado de erro ("Nenhum … encontrado" na falha); tarefa sem carregando | Corrigido em cocho, depósito, abate, tarefa e bebedouro |
| Igualdade (já era assim) | Abate: faixa vazia no pé do cartão do abate antigo; cancelado sem data e hora | Corrigido (regra do Histórico de Movimentação) |
| Interação | `B1Select` com até 8 opções não se escolhia pelo teclado (desktop e tablet) | Corrigido na peça comum (`b1SelectTeclado`) |
| Interação | Sobra do ciclo anterior: o foco ficava no ✕ do lançamento, escondido; Enter cancelava o lançamento | Corrigido: foco na primeira escolha (LM-9) |
| Interação | Bebedouro: fechar o Lançar mandava o foco para o `<body>`; o Histórico abria com o foco na pílula escondida | Corrigido no `LancLoteDialogo`: foco no diálogo ao abrir e de volta à pílula ao fechar |
| Testes | A comparação do cartão com o do manejo não cobria o cancelado, os selos vermelho e âmbar nem o "Excluir" | Corrigido: `cartaoHistoricoIgualManejo` compara os quatro com a referência |
| Testes | Selo de data do bebedouro sem teste para "Sem data" nem para data fora do padrão | Corrigido, com teste |
| Testes | Código que a missão deixou sem uso: `escVolta`, as ações da `LinhaDoTempo`, a barra do registro da tela Bebedouros, as props `descricao`, `detalhe` e `acao` do cartão, classes CSS | Removido; a tela Bebedouros ganhou teste do cabeçalho |
| Testes | Comentários com o comportamento antigo (foco depois da sobra, depósito, bebedouro, `LancField`) e o polyfill do Select do Radix em dois testes que não usam mais esse Select (as escolhas são `B1Select`) | Corrigidos; o polyfill saiu |

Os verificadores conferiram os achados contra o HEAD: os corrigidos durante a revisão saíram como "já corrigido", com o commit que corrigiu.

**Ficam para depois (já eram assim, fora do desenho):**
- Depósito: a Quantidade é `type="number"` e passa pelo `parseNumber` pt-BR, que lê o ponto como milhar: 10,5 kg vira 105 kg. Correção de uma linha, para uma missão própria (R7).
- Bebedouro: a data padrão do Lançar sai em UTC (depois das 21h no Brasil, o dia seguinte).
- Cocho: quantidade, sacos e sobra digitados com ponto ("10.5") também passam pelo `parseNumber` pt-BR.
- Bebedouro: o "Excluir" desligado explica a regra só no `title`, que o teclado e o leitor de tela não alcançam.

### 7.2 Revisão da limpeza (commit 2124d68)

Três revisores (remoções, testes e documentação) leram o commit da limpeza, e cada achado passou por um verificador que tentou refutá-lo. Foram 6 achados: 5 confirmados e corrigidos, 1 refutado.

| Achado confirmado | Correção |
|---|---|
| Cocho: com o último lançamento já em cache, a confirmação da sobra abre junto com o lançamento. Decidida a sobra, o foco voltava à pílula "Lançar", escondida por baixo do lançamento: o efeito que devia levá-lo ao lançamento perdia a corrida com a devolução do foco do Radix. Nenhum teste cobria esse caminho | No `LancLoteDialogo`: se quem tinha o foco ficou escondido por outro diálogo aberto, o foco vai para o diálogo de cima, no primeiro controle. O efeito do formulário saiu. Teste novo, LM-9b, com o cache quente; duas mutações pegas |
| FT5: o nome e o comentário ainda diziam que a folha ocupa a tela, contra o cabeçalho corrigido (ela ocupa o diálogo) | Texto corrigido, também no roteiro E2E de dev |
| `detalhesV12Bebedouro`: o cabeçalho e um teste ainda falavam da "barra do registro", que saiu | Texto corrigido |
| §4 sem o `LancField`, que a limpeza tocou (comentário) | Acrescentado |

Refutado: a frase "props do cartão" para as props da `MolduraHistorico` e do `EstadoHistorico`. Os dois são parte do módulo do cartão (`CartaoHistorico.jsx`), como o §2.1 o descreve.

### 7.3 Suíte inteira e gates (estado final)

- `test:smoke`: 283 arquivos e 3.530 testes, todos passaram.
- `gate:types`: 374 diagnósticos contra o teto de 625.
- `gate:source-closure`, `gate:import-integrity`, `gate:product-scope`, `gate:base44`, `gate:no-secrets` e `gate:governance-paths`: passaram.
- Lint dos arquivos tocados: sem erros.
- `test:backend`: no CI (precisa de PostgreSQL); esta missão não mexe no backend.
