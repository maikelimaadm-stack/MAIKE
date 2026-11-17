# MAIKE — Mapa Geral: detalhes do cocho, depósito, bebedouro, tarefa e área no desenho v12 (D-PROD-220)

## 1. Pedido

Depois do Detalhes do Lote v12 (D-PROD-218), o proprietário pediu: "agora todos os detalhes de cocho, depósitos etc., os detalhes que abrem no meu mapa, você vai deixar igual de lotes — o estilo visual, o modelo de dados, as informações".

- **Fonte do desenho:** a mesma da D-PROD-218, `docs/design/detalhes-do-lote/detalhes-do-lote-v12.dc.html`, com as telas `telaCocho`, `telaDeposito`, `telaBebedouro` e `telaTarefa`.
- **O que continua igual:**
  - todos os dados e regras de hoje;
  - as permissões;
  - os formulários e os históricos completos;
  - as listas de escolha, no padrão do sistema;
  - os filtros do mapa.

## 2. O que mudou

### 2.1 Base comum

- **`CascaDetalhe`** (`src/components/mapa/detalhes-lote/CascaDetalhe.jsx`): é a casca v12 de uma tela.
  - A raiz `.mk-dp` fica dentro do `.mk-ll` do `LancLoteDialogo`. O popup a partir de 768 px depende disso.
  - O título, o subtítulo e o ‹ Voltar vão para o cabeçalho do diálogo; o Esc volta.
  - Num formulário empilhado, `escVolta={false}`: o ‹ Voltar fica e o Esc é ignorado, para um Esc sem querer não apagar o que foi digitado.
  - O corpo é de cartões, com o rodapé de pílulas embaixo.
  - Fora do diálogo, a casca desenha o próprio cabeçalho, ou nenhum com `semCabecalho`.
  - `cabecalhoDoCorpo` e `propsDoCorpo` servem para as abas do curral.
- **Peças em `blocos.jsx`:**
  - `Nivel`, o bloco "RESTANTE DO CICLO 65%" / "NÍVEL DO DEPÓSITO 70%".
  - `Acao`, o "Excluir" em texto.
  - As peças passaram a repassar `id`, `data-*` e `aria-*`.
- **`MedidorLimiteOperacional estilo="v12"`:** vira uma célula da grade, com a mesma semântica de `meter`.
- **`LinhaDoTempo`:** aceita um ícone próprio e um pé de ação no cartão (`acoes`), usado pelo "Excluir" do histórico completo do bebedouro.
- **`useModoPasto`:** passou para o `pastoContexto`.
- **No Mapa Geral:**
  - Área, ponto de suplementação, bebedouro e tarefa abrem em popup a partir de 768 px (`popupDesde="tablet"`).
  - O cocho e o depósito recebem o subtítulo "áreas · setor".
  - A tarefa recebe o `hoje` da fazenda.

### 2.2 Cocho (`DetalhesPontoSuplementacao`)

- **Cabeçalho e rodapé:**
  - Título = cocho; subtítulo = "Pasto 07 · Retiro".
  - Rodapé **Lançar · Leitura · Histórico**, com as permissões de hoje. Sem nenhuma, não há rodapé.
- **Seções, na ordem do v12:**
  1. **Nível do cocho:** região acessível. O percentual aparece uma vez, grande, com as linhas do SSOT (D-PROD-178). Embaixo vem o cartão com o uso do limite (medidor v12), o saldo ou a sobra, a duração, a próxima reposição e a linha "No lançamento".
  2. **Leitura do cocho** (D-PROD-205): farol com quem leu, avisos de acesso e de estrutura, e as 5 últimas leituras com Excluir.
  3. **Último período fechado** (D-PROD-206/212): Produto, Lançamento, %PV real × esperado com a bolinha do farol e Custo por cab/dia. Depois, o resto do resumo do fechamento: g/cab/dia, % do esperado, peso médio, custo do período e sobra antiga.
  4. **Total fornecido por produto.**
  5. **Último registro:** o v12 não tem. Vem do cartão do Histórico pela função pura `metricasDoEvento`, que é a mesma que o Histórico usa.
  6. **Informações do cocho**, mais a linha Observações.
- **Ícone:** o desenho do marcador do mapa (`CochoNivel marcador`). Depois, a D-PROD-223 trocou pelo subícone do sistema (§8).

### 2.3 Depósito (`DetalhesDepositoSuplementacao`)

- **Cabeçalho e rodapé:**
  - Título = depósito; subtítulo = setor.
  - Rodapé **Entrada · Saída · Histórico**. A transferência (D-PROD-161) não muda.
- **Seções:**
  1. **Nível do depósito** (SSOT):
     - bloco do nível com o desenho do marcador do mapa (pino + silo), como o v12, e o percentual bruto. Depois, a D-PROD-223 trocou o desenho pelo subícone do sistema (§8);
     - avisos: abaixo do mínimo, unidade não confirmada e produtos em litros;
     - grade com o medidor, o Estoque mínimo, o saldo em kg e em sacos e a necessidade de reposição.
  2. **Saldo por produto:** produtos em litros num grupo à parte (D-PROD-162).
  3. **Pastos atendidos:**
     - cada cocho vinculado com o ícone do marcador e o farol da última leitura. Depois, a D-PROD-223 trocou o ícone pelo subícone (§8);
     - tocar num cocho abre o detalhe dele empilhado, com ‹ Voltar, se o usuário tiver `visualizar_detalhes_cochos`.
  4. **Informações do depósito:** os 7 campos, mais "Cochos vinculados" com os nomes e "Observações".
  5. **Histórico do depósito:** com `visualizar_historico_cocho`, as 5 últimas movimentações, com a mesma regra do histórico completo (função pura `movimentacoesDoHistoricoDeposito`). Substitui o "Último Registro". Enquanto carrega, mostra "Carregando histórico..."; se a consulta falha, o aviso de erro. Sem a permissão, o bloco continua "Último registro", com uma movimentação só, mas pela mesma regra (§3), e não mais a de data mais recente.

### 2.4 Bebedouro (`DetalhesBebedouro`)

- **Cabeçalho e rodapé:**
  - Título = bebedouro; subtítulo = "Bebedouro".
  - Rodapé **Lançar · Histórico**. Lançar só aparece com `podeLancar` e cadastro real (D-PROD-137).
- **Seções, na ordem do v12:**
  - cartão com o subícone configurado (ou a gota) e o status;
  - Resumo operacional, com o custo acumulado;
  - Último registro;
  - Informações e Observações;
  - Histórico com os 5 últimos e "Ver tudo".
- **Telas empilhadas** (‹ Voltar):
  - o lançamento, com o formulário de hoje. Ali o Esc é ignorado, para não apagar o que foi digitado;
  - o histórico completo, na linha do tempo v12. Usa os mesmos cartões do resumo, mais a hora, na ordem do servidor, com "Lançamentos (N)". O Excluir fica no pé do cartão e só liga no último lançado no sistema (o primeiro da lista, mesmo que seja um retroativo), conforme `podeExcluir`. A confirmação, a mensagem do 409 e as invalidações não mudam. O Esc volta.
- **Carregando ou com erro:** o "Último registro" diz "Carregando..." ou o erro, o custo fica "—", e a seção Histórico mostra "Carregando histórico..." ou "Não foi possível carregar o histórico.". Com a lista já lida, um erro não a apaga.
- **Página Bebedouros:** a casca fica sem o cabeçalho próprio, e a barra "Voltar ao resumo" da página continua.

### 2.5 Tarefa (`DetalhesTarefaMapa`)

- **Cabeçalho:** título = tarefa; subtítulo = "Detalhes da tarefa".
- **Seções:**
  - cartão com o status nas cores do v12;
  - Informações da tarefa: prioridade com bolinha e prazo vencido em vermelho pelo dia da fazenda; "Tipo base" e "Coordenadas" entram quando existem;
  - Descrição e Fotos;
  - Últimos eventos: os 5 últimos na linha do tempo, com "Ver histórico".
- **Rodapé Editar · Registrar evento · Concluir:**
  - Concluir abre o mesmo "Registrar evento" já em "Concluída".
  - Os dois ficam desligados quando o tipo não é permitido.
- **O que não muda:** as mutações, as invalidações, o upload de fotos e os tipos de evento permitidos (D-PROD-118).

### 2.6 Área (clique no contorno, D-PROD-94a)

- **Histórico da Área:** usa a mesma linha do tempo da aba Histórico do pasto: filtro Mostrar, Carregar mais, aviso offline e só leitura, com os textos "nesta área" e a lista "Registros da área". O cabeçalho é "Histórico da Área" com "Pasto 07 · Retiro".
- **Histórico completo:** com a permissão de histórico, o rodapé tem a pílula "Histórico completo".
  - Ela abre por cima o Histórico de Movimentação da área de hoje (`HistoricoMovimentacoes`, sem lotes), como o "Manejos e históricos" do pasto.
  - Ali continuam o "Excluir movimentação" do administrador (D-PROD-110) e os dados de auditoria que os cartões resumidos não trazem: registrado em, observações, cancelado em … por …, vínculo pelo nome, lote excluído, matrizes e nutrição.
- **Nome da outra área:** registro antigo com o nome vazio mostra o nome das áreas do mapa, e não "Área …123456". Vale também para a aba Histórico do pasto: o `PainelPasto` repassa as `areas` do `DetalhesLote` à aba.
- **Fechar o histórico completo:** o conteúdo fica até o fim da animação de saída, sem a barra vazia. Fechado, nada monta nem consulta.
- **Chave `medir_forragem`** (D-PROD-219): o painel Forragem vem em cima, no desenho v12 do `PainelForragemArea`, com os mesmos nomes e testids. O cabeçalho passa a ser a área e o setor. O desenho antigo do painel saiu: o detalhe da área era o único uso.
- **Curral:** abas **Abate · Histórico da Área**. O abate continua o histórico de hoje, agora sem a rolagem própria de 500 px.

## 3. Mudanças de comportamento (de propósito)

- **Tarefa:**
  - Os "Últimos eventos" abriam vazios na primeira vez, porque o `useQuery` tinha `initialData: []` com `staleTime`. É a mesma causa da Gestão de Tarefas na D-PROD-218. Corrigido, com teste.
  - As datas de dia (pedido, prazo, conclusão) apareciam um dia antes no fuso do Brasil. Agora usam `formatarDia`.
  - Registrar evento e Concluir ficam desligados quando nenhum tipo é permitido. Antes, o diálogo abria com o segmento vazio.
- **Depósito:**
  - O primeiro cartão do histórico é o último lançado, com ou sem `visualizar_historico_cocho`, sem reversões nem o lado errado de uma transferência. O antigo "Último Registro" usava a data mais recente.
  - Reversões e o lado errado de uma transferência não aparecem mais.
  - O kg segue o formato do SSOT: "600 kg" em vez de "600,00 kg".
  - Enquanto as movimentações carregam, o histórico diz "Carregando histórico..." em vez de "Nenhum registro ainda.".
- **Cocho:** a lista de leituras mostra também a mais recente, como antes, para o Excluir dela. O v12 mostra só as anteriores.
- **Depósito › cocho:** é uma navegação nova e exige `visualizar_detalhes_cochos`.
- **Bebedouro:**
  - O Esc no formulário de lançamento é ignorado. No desktop já era assim; no tablet e no celular o Esc fechava o diálogo inteiro e perdia o que foi digitado.
  - O carregando e o erro do histórico aparecem como tal. Antes diziam "Nenhum lançamento ainda." e R$ 0,00.
  - O histórico completo passou para a linha do tempo v12, com "Lançamentos (N)" no lugar de "Histórico do Bebedouro (N)".
  - O Excluir desligado explica a regra no `title`: "Só o primeiro da lista (o último lançado no sistema) pode ser excluído.". A regra é a ordem de cadastro, então um retroativo lançado por último é o único excluível, mesmo que o "Último registro" do resumo (pela data) seja outro.
- **Área:** o "Histórico completo" é o mesmo Histórico da Área de antes, agora atrás de uma pílula. O resumo em cima é a linha do tempo.
- **Campos de lançamento (`LancField`):** um Select do Radix que já monta com valor mostra o rótulo em cima desde o primeiro desenho. Antes, o rótulo ficava por cima do valor até a primeira digitação.
  - Só dois formulários com `LancField` têm Select do Radix: o lançamento do bebedouro e **Permissões › editar usuário**.
  - Neste, o campo "Usuário" (travado na edição) passa a mostrar o nome do usuário desde o primeiro desenho; antes o nome ficava invisível.
  - Os outros usam `B1Select` ou `SelectDoMotor` e não mudam.

## 4. Arquivos

- **Novos:**
  - `src/components/mapa/detalhes-lote/CascaDetalhe.jsx`;
  - `src/components/bebedouros/cartoesDoBebedouro.js`: os cartões do bebedouro, compartilhados pelo resumo e pelo histórico completo;
  - CSS: `src/styles/mk-dp-cocho.css`, `mk-dp-deposito.css`, `mk-dp-bebedouro.css` e `mk-dp-tarefa.css`;
  - testes: `tests/smoke/detalhesV12CascaDetalhe.test.jsx`, `detalhesV12Cocho`, `detalhesV12Deposito`, `detalhesV12Bebedouro`, `detalhesV12Tarefa`, `bebedouroHistoricoCarregando` (o carregando com o hook real) e `detalhesLoteHistoricoAreas` (o nome da outra área na aba Histórico do pasto, de ponta a ponta).
- **Reescritos:** `DetalhesPontoSuplementacao`, `DetalhesDepositoSuplementacao`, `DepositoNivel`, `DetalhesBebedouro`, `BebedouroTimeline` (mesma regra de exclusão), `DetalhesTarefaMapa` e `DetalhesArea`.
- **Ajustados:**
  - `blocos.jsx`, `LinhaDoTempo`, `pastoContexto`, `PainelPasto`, `AbaHistorico`, `useHistoricoDoPasto` e `DetalhesLote` (as áreas do mapa no histórico);
  - `CascaDetalhe` e `LancLoteDialogo` (`escVolta`), `LancField` e `HistoricoAbateCurral` (sem a rolagem própria);
  - `MedidorLimiteOperacional`, `CochoNivel` (prop `marcador`), `CardMetricaEvento` (função extraída, mesmo desenho), `FarolConsumo` (só exports) e `HistoricoDepositoSuplementacao` (função extraída, mesmo desenho);
  - `PainelForragemArea` (só o desenho v12), `MapaGeral.jsx`, `mk-detalhes-pasto.css` e `mk-dp-historico.css`.
- **Apagado:** `src/components/ui/tabs.jsx`, que ficou sem uso.
- **CSS sem uso removido:** `.mk-tar__*` de `lancamento-lote.css` e `.mk-map-details`.
- **Roteiros E2E de dev ajustados ao v12:** `scripts/dev/e2e-mapa-niveis.mjs` e `e2e-estoque-p0.mjs`.

## 5. Testes e gates

- **Testes adaptados** (mesmas verificações de regra, sem `.skip`):
  - `detalhesCochoNiveis`, `leituraCocho`;
  - `detalhesDepositoNiveis`, `mapaDepositoLitros`, `mapaNiveisFonteUnica`, `depositoNivel`;
  - `bebedouroHistoricoPorData`, `bebedouroMapaPermissoes`, `bebedourosTelaParidade`;
  - `detalhesAreaHistorico`, `mobileParidadeV2` (`LancField`);
  - `detalhesLoteVisualGesto`: a conferência do Esc do `LancLoteDialogo` agora inclui o formulário empilhado (`escVolta === false`);
  - `g3MapaGeralIntegrado`: caso novo G3-INT-7, em que o contorno abre o `DetalhesArea` com as áreas do mapa (o `DetalhesArea` vira um dublê que guarda as props).
  - Os rótulos com dois-pontos viraram `dt`/`dd`, com os mesmos valores.
  - "Histórico do Bebedouro (N)" virou "Lançamentos (N)", com a mesma contagem e os mesmos Excluir.
- **Testes de mutação:** os implementadores tiraram regras de propósito (permissão, filtro de litros, limite de 5, farol, chevron, `data-permissao-explicita`, cadastro real). Os testes novos pegaram todas.
- **Mutações da 2ª revisão**, todas pegas pelos testes novos:
  - tirar as `areas` do `PainelPasto`, do `DetalhesLote` ou do `<DetalhesArea>` no `MapaGeral`;
  - tirar o `placeholderData: []` do hook do bebedouro;
  - trocar `isLoading` por `isPending` no depósito;
  - mostrar a pílula "Histórico completo" sem a permissão de histórico.
- **Mutações da 3ª revisão**, todas pegas:
  - montar o histórico completo escondido com o diálogo fechado;
  - voltar a montagem condicional do histórico completo (o conteúdo sumia antes da animação de saída);
  - no depósito sem `visualizar_historico_cocho`, voltar o cartão único ao de data mais recente, com reversões.
- **Suíte inteira e gates:** ver §7.3.

## 6. Conferência visual

- **Método:**
  - Harness local, não versionado, com os componentes reais e dados iguais aos do v12: Cocho 07, Depósito Sede, Bebedouro 01 e "Consertar cerca".
  - Capturas com Playwright em 1280×900, 820×1180 e 390×844, comparadas lado a lado com as capturas do v12 das mesmas telas.
- **O que bate com o v12:** estrutura, ordem, tipografia, espaços, cores, cabeçalho e rodapé.
- **O que fica diferente de propósito:** as informações que o MAIKE tem e o v12 não mostra. Exemplos: o "Último registro" do cocho, a grade extra do depósito, e "Tipo base" e "Coordenadas" da tarefa.

## 7. Revisão independente e resultado

- **Método:** cada tela teve um revisor independente de código, dados, permissões, testes e desenho, com o harness e o v12 lado a lado. Cada achado passou por um verificador que tentou refutá-lo: reproduziu o caso e comparou com o código anterior à missão (62819a7).
- **Resultado:** 28 achados, 16 confirmados e corrigidos com teste, 12 refutados.

| Tela | Confirmados e corrigidos | Refutados |
|---|---|---|
| Cocho | o percentual uma vez só sem proteção de teste; o subtítulo do cocho aberto pelo depósito; a animação de volta ao depósito | 1 |
| Depósito | o histórico de 5 sem `visualizar_historico_cocho` (agora um cartão só, como antes, pela regra nova); o ícone do nível (o do marcador, como o v12); a célula do Estoque mínimo como grupo dentro da grade | 4 |
| Tarefa | o vermelho do prazo vencido (#b91c1c, o do v12); testes do fuso do Brasil e do erro do histórico | 4 |
| Bebedouro | o Esc que apagava o formulário; o histórico completo com rolagem própria e no desenho antigo | 2 |
| Área | o "Excluir movimentação" e os dados de auditoria do histórico completo (pílula "Histórico completo"); o nome da outra área; o rótulo da lista; o teste do acesso total; o desenho antigo da Forragem sem uso | 1 |

- **Refutados que viraram melhoria mesmo assim:**
  - o `LancField`, corrigido na raiz;
  - o carregando e o erro dos históricos do bebedouro e do depósito;
  - a rolagem de 500 px do abate do curral.
- **Refutados que ficam como estão**, porque já eram assim antes da missão ou são escolha de desenho:
  - a Gestão de Tarefas em tela cheia a 820 px;
  - a tarefa sem rede pausando a consulta;
  - a data do evento gravada pelo fuso do aparelho. Isso fica para uma missão própria;
  - a célula "Data de conclusão" sozinha na última fileira, como no v12;
  - o abate do curral no desenho do histórico de hoje;
  - no cocho, a leitura mais recente também na lista, para o Excluir dela;
  - no depósito: as observações dos cartões sem formatar o kg, "Origem: —" e "Destino: —" na compra e na venda (o motor não grava esses locais) e os dias na ordem de cadastro, a mesma do histórico completo.

### 7.1 Segunda revisão (da última leva de correções da 1ª)

- **Método:** o mesmo, em 4 frentes: as peças compartilhadas, o bebedouro, a área, e o depósito com os testes e os docs. A comparação foi com 9eb6a58, antes dessa leva (bf9c178 e d9a11ab), e com o estado antes da missão (62819a7). As correções do cocho, do depósito e da tarefa da tabela do §7 (cad9489 a 9eb6a58) já estavam nessa base.
- **Resultado:** 17 achados: 15 confirmados e 2 refutados. Os confirmados se resumem aos 12 problemas da tabela, porque alguns apareceram para mais de um revisor.

| Problema confirmado | Correção |
|---|---|
| As `areas` não chegavam à aba Histórico do pasto: o `PainelPasto` refazia o contexto sem elas. Os docs diziam que sim. | O `PainelPasto` repassa as `areas`; teste de ponta a ponta (`detalhesLoteHistoricoAreas`). |
| O fio `MapaGeral` → `DetalhesArea` das `areas` sem teste | G3-INT-7 no `g3MapaGeralIntegrado` |
| O `title` do Excluir do bebedouro dizia "só o mais recente", e com um retroativo isso contradizia o "Último registro" do resumo | "Só o primeiro da lista (o último lançado no sistema) pode ser excluído."; teste com o retroativo no topo |
| Ao fechar o histórico completo da área, o conteúdo sumia antes da animação de saída: uma barra vazia no popup e uma tela branca no celular | O `HistoricoMovimentacoes` sem condição dentro do diálogo. Testes: fechado, nada monta nem consulta; ao fechar, o histórico fica até o fim da animação de saída (simulada no jsdom). No harness o texto fica até o fim, nos 3 tamanhos |
| A permissão da pílula "Histórico completo" sem teste | Teste com só a Forragem: sem pílula, sem rodapé e sem linha da área |
| O depósito sem local de estoque (consulta desligada) sem teste | Teste: "Nenhum registro ainda.", nunca "Carregando histórico..." para sempre |
| O carregando do bebedouro provado só com o hook trocado por dublê | `bebedouroHistoricoCarregando`, com o hook real |
| O efeito do `LancField` fora do mapa sem registro | D-PROD-220 §7 e §3 deste relatório: Permissões › editar usuário |
| O JSDoc da `LinhaDoTempo` citava o abate do curral, que não usa o pé de ação | Comentário corrigido |
| O CSS citava a prop `estilo` do `PainelForragemArea`, que saiu | Comentário corrigido |
| No relatório, o ícone do nível do depósito (§2.3) | Texto corrigido: o desenho do marcador do mapa |
| No relatório, o `detalhesLoteVisualGesto` fora da lista do §5 | Acrescentado à lista |

- **Refutados:**
  - **O depósito sem rede, que diz "Nenhum registro ainda.":** era igual antes da missão. A consulta pausada não é nem carregando nem erro. Sem rede e sem cópia no aparelho, o detalhe inteiro do depósito mostra vazios. Quando a rede volta, o histórico chega.
  - **A frase "substitui o Último Registro" sem a permissão:** era texto incompleto, não contradição. A permissão foi acrescentada à frase mesmo assim (D-PROD-220 §3 e §2.3).

### 7.2 Terceira revisão (das correções da 2ª)

- **Método:** o mesmo, em 2 frentes: o código com os testes, e os documentos. A base foi d9a11ab, e os commits revistos foram 5d75aa1 e 3c57abf.
- **Resultado:** 5 achados, 5 confirmados, nenhum refutado. O código estava certo. Os problemas estavam em testes e textos, e foram todos corrigidos:

| Problema confirmado | Correção |
|---|---|
| O teste "fechado, nada monta nem consulta" não via o que prometia: a linha do tempo e o histórico completo usam a mesma chave do React Query, então a contagem de chamadas não muda | O teste confere o texto do histórico completo e uma fonte que só ele lê (`suplementacaoLote`), fechado e aberto |
| A saída do histórico completo sem teste: voltar a montagem condicional não derrubava nada | Teste que simula a animação de saída no jsdom: o histórico e o título com a contagem ficam até o `animationend` |
| D-PROD-220 §3 e §2.3: sem `visualizar_historico_cocho`, o cartão único não é "o de antes"; ele segue a regra nova (o último lançado, sem reversões) | Texto corrigido aqui, no §3 e na tabela do §7; teste novo que prende a regra sem a permissão |
| §2.4 ainda dizia que o Excluir do bebedouro "só liga no mais recente" | Texto corrigido, também no JSDoc do `DetalhesBebedouro` |
| §7.1 dizia que 9eb6a58 era "o estado antes das correções" | Texto corrigido: 9eb6a58 já tinha as correções do cocho, do depósito e da tarefa |

### 7.3 Suíte inteira e gates (estado final)

- **`test:smoke`:** 277 arquivos e 3.462 testes, todos passaram.
- **`gate:types`:** 422 diagnósticos contra o teto de 625.
- **Lint do repositório:** 0 erros. Ficam os 2 avisos antigos, de antes da missão (`CategoriasManejo.jsx` e `Produtos.jsx`).
- **Build e demais gates do `verify:all`:** passaram.
- **`test:backend`:** precisa de PostgreSQL e roda no CI; a branch não mexe no backend.
- **CI do GitHub:** roda a cada envio; o resultado do commit final fica no PR.

## 8. Ajuste depois da prévia: subícone nos detalhes (D-PROD-223)

- **Pedido do proprietário:** "no cocho e depósito, [o que está] mostrando nos detalhes tem que ser apenas o sub ícone, com as configurações que já estavam no meu sistema".
- **O que mudou:** os detalhes deixaram de desenhar o cocho e o depósito como o marcador do mapa (bolinha, pino) e voltaram ao subícone do sistema (`COCHO_APARENCIA.subicone`; o guia de `src/assets/icones/cocho-descoberto.js` já diz "subicone = desenho sem bolinha, usado nos detalhes"):
  - o nível do cocho (`CochoNivel`, que voltou a ser o da `main`; o modo marcador saiu, sem uso);
  - o nível do depósito (`urlIconeDeposito` sem o pino);
  - os cochos dos Pastos atendidos (depósito) e dos Cochos do pasto (aba Suplementação do Detalhes do Lote).
- **Arquivos:**
  - `CochoNivel`, `DetalhesPontoSuplementacao`, `DepositoNivel`, `DetalhesDepositoSuplementacao` e `AbaSuplementacao`;
  - `mk-dp-cocho.css`: o subícone ocupa a largura da caixa de 76 px, na proporção dele.
- **Testes:** CV-3, `depositoNivel`, DV-5 e AS-1 exigem o subícone. Quatro mutações, uma por lugar, voltaram o marcador ou as cores dele, e todas foram pegas.
- **Conferência visual:** harness local a 1280 px e a 390 px. O cocho e o depósito aparecem no bloco do nível com 76 × 56 px. Nas listas, o subícone tem 34 px.
- **Observação:** o subícone é cinza-claro (`#e2e6e9`). Nas listas, um cocho sem lançamento mostra só o contorno, discreto no fundo branco. É a configuração do sistema. Escurecer a cor é uma linha no `COCHO_APARENCIA.subicone`, se o proprietário quiser.
