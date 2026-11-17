# MAIKE — Mapa Geral: detalhes do cocho, depósito, bebedouro, tarefa e área no desenho v12 (D-PROD-220)

> **Situação:** em andamento na PR #308 (rascunho). Este relatório é completado ao fim da integração das quatro telas.

## 1. Pedido

Depois do Detalhes do Lote v12 (D-PROD-218), o proprietário pediu: "agora todos os detalhes de cocho, depósitos etc., os detalhes que abrem no meu mapa, você vai deixar igual de lotes — o estilo visual, o modelo de dados, as informações".

A fonte da verdade do desenho é a mesma da D-PROD-218: `docs/design/detalhes-do-lote/detalhes-do-lote-v12.dc.html`, com as telas `telaCocho`, `telaDeposito`, `telaBebedouro` e `telaTarefa`.

## 2. Base comum (pronta)

- `src/components/mapa/detalhes-lote/CascaDetalhe.jsx`: a casca v12 de uma tela.
  - A raiz `.mk-dp` é filha direta do `.mk-ll` do `LancLoteDialogo`, e o popup a partir de 768 px depende disso.
  - Publica título, subtítulo e ‹ Voltar no cabeçalho do diálogo; o Esc volta.
  - Desenha o corpo de cartões e o rodapé.
  - Fora do diálogo, desenha o cabeçalho próprio.
  - `cabecalhoDoCorpo` e `propsDoCorpo` servem para abas (curral).
- Em `blocos.jsx`:
  - Peças novas: `Nivel` (bloco do nível do cocho e do depósito) e `Acao` (ação curta em texto).
  - As peças repassam `id`, `data-*` e `aria-*`; o `id` do `TituloBloco` vai para o h3.
- `MedidorLimiteOperacional estilo="v12"`: célula da grade com a mesma semântica de `meter`.
- `LinhaDoTempo` aceita um ícone próprio por cartão.
- `useModoPasto` passa para o `pastoContexto`.
- Teste: `tests/smoke/detalhesV12CascaDetalhe.test.jsx`.

## 3. Mapa Geral e área (prontos)

- **Popup a partir de 768 px** (`popupDesde="tablet"`): Histórico da Área, Ponto/Depósito de Suplementação, Bebedouro e Detalhes da tarefa.
- **Subtítulos:**
  - Cocho e depósito: `subtitulo` = áreas vinculadas · setor (o depósito sem área mostra só o setor).
  - Área: subtítulo = setor.
- **Histórico da Área** (`DetalhesArea`):
  - Usa a mesma linha do tempo da aba Histórico do pasto (`AbaHistorico`): filtro Mostrar, Carregar mais, aviso offline, só leitura, com os textos "nesta área".
  - Com a chave `medir_forragem` (D-PROD-219), o painel Forragem vem em cima, na variante `estilo="v12"` do `PainelForragemArea`, com os mesmos testids e nomes.
  - O curral ganha as abas Abate · Histórico da Área.

## 4. Telas (em integração)

- Cocho: `DetalhesPontoSuplementacao`.
- Depósito: `DetalhesDepositoSuplementacao`, com a tela empilhada depósito › cocho.
- Bebedouro: `DetalhesBebedouro`.
- Tarefa: `DetalhesTarefaMapa`.

## 5. Testes e gates

Completado ao fim da integração.
