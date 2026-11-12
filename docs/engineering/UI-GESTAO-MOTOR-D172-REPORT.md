# UI-GESTAO-MOTOR-D172 — relatório

**Fatia:** telas de Gestão, Patrimônio e Financeiro no padrão do motor Base1 (D-PROD-172).
**Tipo:** visual (UI) e comportamento de tela. Sem migration, rota, página, config de escopo, dependência nova ou mudança no que é gravado.
**Pedido do proprietário (2026-11-11):** em Bens e Patrimônio, tirar os filtros de cima, do lado do "+ Novo", e deixar campos, listagem e escolha iguais ao motor Base1; no financeiro, ajustar campos e formatação ("botão até tá, mas é o restante não tá").
**Branch:** `claude/design-implementation-optimize-7wr2qh`, sobre a `main` com a PR #243 (D-PROD-171).

## O que mudou

| Peça | Antes | Depois | Onde |
|---|---|---|---|
| Filtros de cada tela | pílulas próprias na barra, ao lado do "+ Novo" | pílulas da faixa do motor, logo depois de Ordenar, com a janela do motor (✓), ✕ e "Limpar filtros" voltando ao padrão; no celular, linhas da folha "Filtros" | `FiltrosRapidos.jsx` (`FiltrosDaTelaContext`), `GestaoFormParts.jsx` (`filtroSituacaoDaTela`) e as 6 telas abaixo |
| Campo de escolha dos formulários de Gestão | lista com a opção vazia ("— Escolha —", "— Nenhum —"), pesquisa só com mais de 8 opções | sempre com "Pesquisar…", opções em MAIÚSCULAS, sem opção vazia; o ✕ no campo limpa o que não é obrigatório | `B1Select.jsx` (props `pesquisa`, `semOpcaoVazia`, `maiusculas`), `CampoSelect` |
| Seletor de servidor (produto, parceiro, natureza, centro, bem, responsável) | lista aberta dentro do formulário, "— Nenhum —", "Buscar por nome ou código…", "Fechar seleção" | janela das listas do motor presa ao campo (folha de baixo no celular), "Pesquisar…", código + nome + detalhe, ✓, "+ Novo …", "Carregar mais"; ✕ no campo para limpar; Esc ou clique fora fecham | `SeletorPaginadoGestao.jsx` |
| Perfil financeiro da empresa (Lançamentos) | rótulos em cima, caixas cinza, botão verde largo | cartão de campos do motor, nota azul, campos de escolha do motor, botões verde/cinza do rodapé | `PerfilFinanceiroPainel.jsx` |

Telas com filtros na faixa: Centros de custo e Centros de resultado (`CentrosCadastroTela.jsx`), Parceiros (`pages/Parceiros.jsx`), Naturezas financeiras, Bens patrimoniais, Abastecimentos e Lançamentos financeiros.

**Continua como estava:** regras, permissões, envios ao servidor (mesmos parâmetros de filtro e mesmos corpos), textos de aviso, ids de teste e os botões de escolha segmentada (A pagar/A receber, Sem/Com produtos, Sim/Não…), que o proprietário disse estarem certos. A janela "Gerenciar tipos" (D-PROD-170) já seguia o motor.

**Detalhe de foco.** Ao escolher no seletor de servidor, o foco volta na hora ao campo, como numa lista nativa. Deixado para a devolução atrasada do Radix (um `setTimeout` no fim da janela), ele podia cair depois de o usuário abrir a lista seguinte e fechá-la ("Unidade do item" logo depois do Produto). O `id` do `<label for>` passa a ficar no botão do campo, não na caixa em volta.

## Como foi verificado

- `npm run test:smoke`: 199 arquivos, 2.443 testes, todos passando (antes do último ajuste do painel de perfil; depois dele, `gestaoLancamentos.test.jsx` 45/45).
- Testes adaptados ao desenho novo, sem afrouxar o que conferem:
  - as opções das listas estão no portal (`screen` em vez de `within(form)`);
  - campo vazio = atributo `data-placeholder` (não há mais "— Escolha … —");
  - Esc no lugar do botão "Fechar seleção"; "Limpar" no lugar da opção "— Nenhum —";
  - `seletorPaginadoCriarNovo.test.jsx`: os snapshots em linha, guarda de não regressão da D-PROD-162, foram regravados uma vez, de propósito, e agora cobrem também a janela aberta.
- Navegador (Chromium, backend falso só de leitura, nenhuma escrita em banco), desktop 1366 px e celular 390 px: Bens (lista, novo, seletor e campo de escolha), Abastecimentos (lista e novo), Lançamentos (perfil, lista e formulário inteiro), Parceiros, Naturezas, Centros de custo e de resultado. Nenhuma barra com filtro; nenhum `<select>` nativo, caixa solta ou `b1-multi` nos formulários; nenhum erro de página.

## Evidências

`docs/engineering/evidencias/gestao-motor-d172/`:

- `bens-lista-filtros-antes-depois.png` — barra e faixa de Bens: os filtros saem do lado do "+ Novo" e entram na faixa;
- `bens-seletor-antes-depois.png` — "Responsável": a lista dentro do formulário vira a janela do motor;
- `lancamentos-perfil-antes-depois.png` — perfil financeiro e filtros de Lançamentos;
- `celular-perfil-seletor-select-lancamento.png` — celular: perfil, seletor de servidor e campo de escolha na mesma folha, formulário de lançamento.

## Fora desta fatia

- Cadastro de Áreas, Pontos e Linhas: tela própria, ainda fora do motor (barra, abas e grade antigas).
- Fontes do Mapa Geral (Detalhes do lote e painéis) iguais às do motor.

As duas vão juntas na próxima missão, do Mapa.
