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
| Cocho › Lançar (`FormularioLancamentoSuplementacao`) | Aviso com áreas, depósito, lotes e peso. Formulação no `B1Select`. Kg ou sacos em `LancLoteSegmento`. Consumo por lote em `LancLoteItens`. O progresso do salvamento fica no topo, com os campos travados e o ✕ desligado. Depois da sobra herdada, o foco volta ao lançamento. |
| Cocho › Leitura | O cocho entra no subtítulo. O formulário já era do manejo (D-PROD-205). |
| Depósito › Entrada e Saída (`FormularioTransferenciaDeposito`) | Títulos "Entrada no Depósito" e "Saída do Depósito". Produto e Unidade no `B1Select`. Origem · destino · saldo num aviso neutro. No celular, as folhas abrem dentro do diálogo de cima (D-PROD-161). |
| Bebedouro › Lançar (`FormularioLancamentoBebedouro`) | Título "Lançamento no Bebedouro", por cima do detalhe (antes era tela empilhada). Data, Hora, Tipo e Status em grade. Tipo, Status e Qualidade da água no `B1Select`. Os campos aparecem pelo Tipo, como antes. |

### 2.4 Esc com uma lista aberta

No celular, quando há uma folha de lista aberta dentro do `LancLoteDialogo`, o Esc é da folha: o primeiro Esc fecha só a folha e o segundo fecha o diálogo. A regra agora vale para todos os lançamentos, inclusive os do lote. Antes só a Entrada e a Saída do depósito tinham essa guarda, no próprio formulário.

### 2.5 Com a `main` mesclada (D-PROD-221)

O farol do pasto no painel Forragem entrou no desenho v12 da D-PROD-220 como a primeira linha do cartão:

- o rótulo da situação ou "Sem medição recente";
- a cor na bolinha;
- "há N dias" e "vencida (mais de 15 dias)".

## 3. Mudanças de comportamento (de propósito)

Estas mudanças vêm do padrão dos manejos (D-PROD-115/125):

- **Desktop:** o popup não fecha por Esc nem por clique fora, só pelo ✕.
- **Teclado:** Enter num campo envia o formulário.
- **Celular:** o lançamento abre em tela cheia. No depósito, isso substitui o cartão centralizado.
- **Bebedouro:**
  - o Esc da tela cheia fecha o Lançar; antes era ignorado, porque o formulário era empilhado;
  - o recurso `escVolta` continua no `LancLoteDialogo` e na `CascaDetalhe`, com teste próprio.
- **Foco ao abrir:** vai para o ✕ (o primeiro focável), e não para a data.
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
  - `LancamentoLoteUi` (o Esc com a folha aberta);
  - `CascaDetalhe` e `src/Layout.jsx` (só comentários).
- **CSS:** `mk-dp-bebedouro.css` (saiu a regra morta do formulário empilhado).
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
  - Todas foram pegas.
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

(preenchido ao fim da revisão)
