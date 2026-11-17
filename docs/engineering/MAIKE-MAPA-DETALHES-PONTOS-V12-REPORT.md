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
  - O corpo é de cartões, com o rodapé de pílulas embaixo.
  - Fora do diálogo, a casca desenha o próprio cabeçalho, ou nenhum com `semCabecalho`.
  - `cabecalhoDoCorpo` e `propsDoCorpo` servem para as abas do curral.
- **Peças em `blocos.jsx`:**
  - `Nivel`, o bloco "RESTANTE DO CICLO 65%" / "NÍVEL DO DEPÓSITO 70%".
  - `Acao`, o "Excluir" em texto.
  - As peças passaram a repassar `id`, `data-*` e `aria-*`.
- **`MedidorLimiteOperacional estilo="v12"`:** vira uma célula da grade, com a mesma semântica de `meter`.
- **`LinhaDoTempo`:** aceita um ícone próprio.
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
- **Ícone:** o desenho do marcador do mapa (`CochoNivel marcador`).

### 2.3 Depósito (`DetalhesDepositoSuplementacao`)

- **Cabeçalho e rodapé:**
  - Título = depósito; subtítulo = setor.
  - Rodapé **Entrada · Saída · Histórico**. A transferência (D-PROD-161) não muda.
- **Seções:**
  1. **Nível do depósito** (SSOT):
     - bloco do nível com o ícone de hoje e o percentual bruto;
     - avisos: abaixo do mínimo, unidade não confirmada e produtos em litros;
     - grade com o medidor, o Estoque mínimo, o saldo em kg e em sacos e a necessidade de reposição.
  2. **Saldo por produto:** produtos em litros num grupo à parte (D-PROD-162).
  3. **Pastos atendidos:**
     - cada cocho vinculado com o ícone do marcador e o farol da última leitura;
     - tocar num cocho abre o detalhe dele empilhado, com ‹ Voltar, se o usuário tiver `visualizar_detalhes_cochos`.
  4. **Informações do depósito:** os 7 campos, mais "Cochos vinculados" com os nomes e "Observações".
  5. **Histórico do depósito:** as 5 últimas movimentações, com a mesma regra do histórico completo (função pura `movimentacoesDoHistoricoDeposito`). Substitui o "Último Registro".

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
- **Telas empilhadas** (‹ Voltar e Esc): o lançamento, com o formulário de hoje, e o histórico completo, com Excluir conforme `podeExcluir`.
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

- **Histórico da Área:** usa a mesma linha do tempo da aba Histórico do pasto: filtro Mostrar, Carregar mais, aviso offline e só leitura, com os textos "nesta área". O cabeçalho é "Histórico da Área" com "Pasto 07 · Retiro".
- **Chave `medir_forragem`** (D-PROD-219): o painel Forragem vem em cima, na variante v12 do `PainelForragemArea`, com os mesmos nomes e testids. O cabeçalho passa a ser a área e o setor.
- **Curral:** abas **Abate · Histórico da Área**.

## 3. Mudanças de comportamento (de propósito)

- **Tarefa:**
  - Os "Últimos eventos" abriam vazios na primeira vez, porque o `useQuery` tinha `initialData: []` com `staleTime`. É a mesma causa da Gestão de Tarefas na D-PROD-218. Corrigido, com teste.
  - As datas de dia (pedido, prazo, conclusão) apareciam um dia antes no fuso do Brasil. Agora usam `formatarDia`.
  - Registrar evento e Concluir ficam desligados quando nenhum tipo é permitido. Antes, o diálogo abria com o segmento vazio.
- **Depósito:**
  - O primeiro cartão do histórico é o último lançado. O antigo "Último Registro" usava a data mais recente.
  - Reversões e o lado errado de uma transferência não aparecem mais.
  - O kg segue o formato do SSOT: "600 kg" em vez de "600,00 kg".
- **Cocho:** a lista de leituras mostra também a mais recente, como antes, para o Excluir dela. O v12 mostra só as anteriores.
- **Depósito › cocho:** é uma navegação nova e exige `visualizar_detalhes_cochos`.

## 4. Arquivos

- **Novos:**
  - `src/components/mapa/detalhes-lote/CascaDetalhe.jsx`;
  - CSS: `src/styles/mk-dp-cocho.css`, `mk-dp-deposito.css`, `mk-dp-bebedouro.css` e `mk-dp-tarefa.css`;
  - testes: `tests/smoke/detalhesV12CascaDetalhe.test.jsx`, `detalhesV12Cocho`, `detalhesV12Deposito`, `detalhesV12Bebedouro` e `detalhesV12Tarefa`.
- **Reescritos:** `DetalhesPontoSuplementacao`, `DetalhesDepositoSuplementacao`, `DepositoNivel`, `DetalhesBebedouro`, `DetalhesTarefaMapa` e `DetalhesArea`.
- **Ajustados:**
  - `blocos.jsx`, `LinhaDoTempo`, `pastoContexto`, `PainelPasto` e `AbaHistorico`;
  - `MedidorLimiteOperacional`, `CochoNivel` (prop `marcador`), `CardMetricaEvento` (função extraída, mesmo desenho), `FarolConsumo` (só exports) e `HistoricoDepositoSuplementacao` (função extraída, mesmo desenho);
  - `PainelForragemArea` (variante v12), `MapaGeral.jsx` e `mk-detalhes-pasto.css`.
- **Apagado:** `src/components/ui/tabs.jsx`, que ficou sem uso.
- **CSS sem uso removido:** `.mk-tar__*` de `lancamento-lote.css` e `.mk-map-details`.
- **Roteiros E2E de dev ajustados ao v12:** `scripts/dev/e2e-mapa-niveis.mjs` e `e2e-estoque-p0.mjs`.

## 5. Testes e gates

- **Testes adaptados** (mesmas verificações de regra, sem `.skip`):
  - `detalhesCochoNiveis`, `leituraCocho`;
  - `detalhesDepositoNiveis`, `mapaDepositoLitros`, `mapaNiveisFonteUnica`, `depositoNivel`;
  - `bebedouroHistoricoPorData`, `bebedouroMapaPermissoes`, `bebedourosTelaParidade`;
  - `detalhesAreaHistorico`.
  - Os rótulos com dois-pontos viraram `dt`/`dd`, com os mesmos valores.
- **Testes de mutação:** os implementadores tiraram regras de propósito (permissão, filtro de litros, limite de 5, farol, chevron, `data-permissao-explicita`, cadastro real). Os testes novos pegaram todas.
- **Suíte inteira e gates:** ver §7.

## 6. Conferência visual

- **Método:**
  - Harness local, não versionado, com os componentes reais e dados iguais aos do v12: Cocho 07, Depósito Sede, Bebedouro 01 e "Consertar cerca".
  - Capturas com Playwright em 1280×900, 820×1180 e 390×844, comparadas lado a lado com as capturas do v12 das mesmas telas.
- **O que bate com o v12:** estrutura, ordem, tipografia, espaços, cores, cabeçalho e rodapé.
- **O que fica diferente de propósito:** as informações que o MAIKE tem e o v12 não mostra. Exemplos: o "Último registro" do cocho, a grade extra do depósito, e "Tipo base" e "Coordenadas" da tarefa.

## 7. Revisão independente e resultado

Completado na integração final: as revisões adversariais por tela, a suíte inteira e os gates.
