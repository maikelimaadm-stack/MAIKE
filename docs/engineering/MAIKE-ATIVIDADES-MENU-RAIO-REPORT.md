# MAIKE-ATIVIDADES-MENU-RAIO — Relatório

> **fatia:** 1 (menu ⚡ e concluir) · **branch:** `feat/atividades-menu-raio` · **PR:** #316

Decisão: [D-PROD-232](./DECISIONS.md) · a partir da `main` `64310bd4` (PR #313).

Primeira fatia do redesenho do **Lançamento de Atividades** pelo protótipo HTML do proprietário. A regra dele: seguir
a lógica e o estilo do protótipo, **mantendo o modelo visual do sistema** — a grade Base1, os tokens, os diálogos, a
`MobileSheet` e os botões de sempre; do protótipo veio só o botão ⚡ da linha (CSS pequeno e escopado, `.b1-raio`).

> **Numeração:** a missão foi pedida como D-PROD-224 (o marcador da `main`), mas as branches abertas de outras sessões
> já usam da D-PROD-224 à D-PROD-231 (`claude/design-filters-implementation-agzxk8` e `claude/kind-knuth-tztu1v`).
> Esta é a **D-PROD-232**; o marcador passa a `D-PROD-233`.

## 1. Plano em 4 fatias

| Fatia | O quê |
|---|---|
| **1 (esta)** | Menu ⚡ por linha (lista e cards) e "Concluir atividade" com resumo; "Concluir" à vista na atividade aberta |
| 2 | Janelas por tipo (Trabalho de máquinas, Aplicação de insumos, Mão de obra, Custos extras) com a lista, **Inserir**, **Dados**, **Salvar** e **Salvar e fechar**; dia do lançamento com **hoje por padrão** e setas; o **dia criado sozinho ao salvar o primeiro item** (proprietário: "pode ser") |
| 3 | Atividade aberta no desenho do protótipo: **Resumo de custo**, a tabela dos 4 tipos e a aba **Resumo da atividade** |
| 4 | Celular: cards e atividade aberta no desenho do protótipo |

## 2. Entrega

| Camada | O que entrou |
|---|---|
| Motor Base1 (opt-in) | `renderAcoesDaLinha(linha)` em `CadastroBase1Grade` → `Base1Grid` (o ⚡ na célula de seleção, ao lado da caixa; largura 84 px, `SELECT_COLUMN_WIDTH_ACOES`, também nas colunas congeladas; cabeçalho "Ações" ao lado do "selecionar todos") e `Base1Cards` (o ⚡ no topo do card; no celular, onde a caixa já é escondida, só o ⚡). **Sem a prop, nada muda** em nenhuma outra tela (teste LA-RAIO-GRADE-1) |
| `B1AcoesDaLinha.jsx` (novo, base1) | `B1BotaoAcoesDaLinha` (lucide `Zap` 13 px + `ChevronDown` 11 px) e `B1MenuAcoesDaLinha` (cabeçalho opcional e grupos com divisória): no computador, `B1Popover` preso ao botão; no celular, `MobileSheet` com o título da linha no título da folha. `aria-expanded`, Esc fecha, ↑ ↓ / Home / End entre os itens, foco volta ao ⚡. Clique no ⚡ não seleciona nem abre a linha (e Enter/Espaço no ⚡ não abre o card) |
| Menu da atividade | Cabeçalho "Nº 7 · NOME" + "TIPO · ÁREA". Grupos: **Trabalho de máquinas** (sempre), **Aplicação de insumos** (`permite_produto`), **Mão de obra** (`permite_mao_obra`), **Custos extras** (`permite_servico`) — só ABERTA + ação de lançar + fuso; **Abrir atividade**; **Alterar**, **Concluir** / **Reabrir**, **Duplicar**, **Cancelar** (vermelho) pela mesma regra do Mais opções (`acoesDaAtividade`, fuso, `versao`). Ícones lucide: Tractor, FlaskConical, User, ReceiptText, List, Pencil, CircleCheck, RotateCcw, Copy, Ban |
| Lançar pelo ⚡ | Abre o `FormularioApontamento` (novo, **hoje no fuso da fazenda**) da atividade da linha, sem abrir a atividade; título "Novo lançamento · <tipo>" e nota do próximo passo (`lancamentoDoTipo`). Ao **Lançar**: lista, totais e lançamentos relidos; aviso de sucesso ("Agora informe a máquina…") e o alerta fora do período como aviso; a atividade abre e a **janela de adicionar daquele tipo abre sozinha no dia gravado** (`ListaApontamentos.abrirLinha` → `LinhasDoApontamento.abrirAoMontar`, uma vez; some ao sair da atividade) |
| Concluir | `DialogoConcluirAtividade.jsx` (novo) no `DialogoAcao` do sistema, que ganhou `icone` e `iconeBotao` **opcionais** (sem eles, igual a antes). Resumo Período / Área feita + barra / Custo total / Custo por hectare / Combustível; Data de conclusão com `erroDaDataDeConclusao`; aviso "Faltam X ha dos Y planejados…"; nota "Concluída, a atividade fica só para consulta. Dá para reabrir depois."; Voltar / Concluir atividade. Números: `GET /atividades/:id/totais` (o do totalizador) e `totais.dias_com_apontamento` do detalhe; regra pura `resumoParaConcluir` em `atividadeLinhasRegras.js`. **Nada inventado:** sem o valor, "—" (lendo, "…"); sem `/totais`, a área do cabeçalho e uma nota |
| Atividade aberta | Botão **Concluir** (contorno, ícone + texto) na barra, ao lado de Abrir atividade e Editar; o Mais opções da atividade aberta deixa de listar "Concluir atividade" (na lista continua) |
| CSS | `cadastro-base1.css` (célula de seleção com ações, `.b1-raio`, menu), `maike-mobile-shell.css` (o ⚡ no card do celular), `base1-design.css` (item de perigo vermelho no menu, contra a regra geral do `body.b1-tela`) |

Sem backend, sem banco, sem migration; nenhuma rota, corpo ou regra do servidor mudou.

## 3. Fora do escopo e ressalvas

- **Janelas por tipo** (Fatia 2): nesta fatia o lançamento passa pelo formulário do dia e, gravado o dia, pela janela
  de linha que já existia (máquina, produto, mão de obra, serviço). O diesel continua no bloco Abastecimentos do dia.
  Comentado em `LANCAMENTOS_DO_MENU` (`src/pages/LancamentoAtividades.jsx`).
- **Valor total no cabeçalho do menu:** a linha da lista (`GET /atividades`) não traz custo; o valor fica de fora para
  não inventar número (o protótipo mostra "R$ 4.262,47"). Volta quando a lista ou a atividade aberta o tiverem (Fatia 3).
- **Reabrir e Cancelar** continuam com os diálogos de sempre.
- Fora: atividade aberta redesenhada (Fatia 3), cards do celular além do ⚡ (Fatia 4), "Múltiplos talhões".

## 4. Testes e gates

| Item | Resultado |
|---|---|
| `tests/smoke/lancamentoAtividades.test.jsx` | 51 testes (41 + 10 novos). Novos: **LA-RAIO-1** (⚡ em cada linha, "Ações" no cabeçalho, clique no ⚡ não seleciona, cabeçalho e grupos do menu, Esc e foco; itens da concluída e da cancelada), **LA-RAIO-2** (itens de lançar pelas flags do tipo, a flag da atividade vale sobre a da lista), **LA-RAIO-3** (por permissão e sem fuso), **LA-RAIO-4** (Abrir e Alterar), **LA-RAIO-5** (Trabalho de máquinas abre o dia com hoje; ao lançar, POST do dia, a atividade abre e a janela da máquina abre), **LA-RAIO-6** (Concluir pelo ⚡: período, área e barra, custos, combustível, aviso da área que falta, a data muda o período, POST do concluir), **LA-RAIO-7** (sem `/totais`: "—" e a nota), **LA-RAIO-8** (celular: ⚡ no card e o menu na `MobileSheet`), **LA-RAIO-GRADE-1** (grade e cards sem a prop não mudam), **LA-RAIO-GRADE-2** (`resumoParaConcluir`). LA-ACOES-1 e LA-ERRO-3 passam a concluir pelo botão da barra |
| `npm run test:smoke` | 261 arquivos, **3.220 testes**, todos passando |
| `node scripts/gates/verify-all.mjs --pular=test:backend` | todas as etapas passam (`test:backend` roda no CI, precisa de PostgreSQL); `gate:types` sem regressão (479 de 625) |

## 5. Imagens para o proprietário

Geradas num harness local (Vite + Playwright, a página real com os serviços de sessão, fazenda, tipos e áreas
simulados e um backend falso; sem o menu do topo do app), 1440×900 e 390×844, `deviceScaleFactor` 2, na pasta de
rascunho da sessão (`scratchpad/fatia1-shots/`): `d1-lista-raio.png` (lista com o ⚡), `d2-menu-raio.png` (menu no
computador), `d3-concluir.png` (Concluir com resumo), `d4-aberta-concluir.png` (Concluir na atividade aberta),
`c1-lista-raio.png` (cards com o ⚡), `c2-menu-raio-folha.png` (menu na folha do celular), `c3-concluir.png`.
O campo de data aparece como `mm/dd/yyyy` porque o Chrome sem interface usa o idioma inglês no seletor nativo.
