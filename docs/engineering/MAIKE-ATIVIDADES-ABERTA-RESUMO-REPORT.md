# MAIKE-ATIVIDADES-ABERTA-RESUMO — Relatório

> **fatia:** 3 (atividade aberta) · **branch:** `feat/atividades-aberta-resumo` · **PR:** a abrir

Decisão: [D-PROD-234](./DECISIONS.md) · a partir da `main` `0facca65` (PR #322). Fatias anteriores:
[D-PROD-232](./MAIKE-ATIVIDADES-MENU-RAIO-REPORT.md) (menu ⚡ e Concluir) e
[D-PROD-233](./MAIKE-ATIVIDADES-JANELAS-TIPO-REPORT.md) (janelas por tipo).

Terceira fatia do redesenho do **Lançamento de Atividades** pelo protótipo HTML do proprietário: a **atividade aberta**
com as abas **Lançamentos** e **Resumo da atividade**, o card **Resumo de custo**, a tabela dos **tipos de lançamento**
(com o ⚡ que abre a janela da fatia 2) e, no celular, a cabeça com ✕ / Concluir e os tipos em cartões. O modelo visual
continua o do sistema: as abas do motor no modo "abas fora", os cartões `b1-aba-cartao`, a tabela `b1-tipo-tabela`, o
⚡ (`B1MenuAcoesDaLinha`) e a navegação do registro (`NavegacaoDoRegistro`).

## 1. Entrega

| Camada | O que entrou |
|---|---|
| `AtividadeAberta.jsx` (novo) | Abas **Lançamentos** / **Resumo da atividade** (as duas montadas; a escondida com `hidden`) com ‹‹ ‹ n/N › ›› na mesma linha (a navegação do motor, na ordem da lista; no celular, no rodapé). **Lançamentos:** "Resumo de custo · ÁREA" (12 células), "Lançamentos" (uma linha por tipo, Total, ⚡ Inserir / Ver lançamentos, "+ Lançar", clicar no tipo abre a janela) e "Dias lançados" (recolhível, a `ListaApontamentos` de sempre). **Resumo da atividade:** `TotalizadorAtividade` (por item) e o cabeçalho só leitura. **Celular:** cabeça ✕ / nome / status / "Nº · área" / Concluir; tipos em cartões |
| `LancamentoAtividades.jsx` | O registro aberto usa `AtividadeAberta`; os avisos de status (cancelada, concluída, reaberta) saem do cabeçalho e ficam acima das abas; `lancarDoMenu(atividade, tipo, aba)` abre a janela do tipo também pela atividade aberta; o Concluir da barra some no celular (vai para a cabeça). Lista: coluna **Valor total** (padrão, ordenável pelo canônico, no CSV) e o **R$ total** no cabeçalho do ⚡ |
| `JanelaLancamentoPorTipo.jsx` | `abaInicial` (`lista` \| `dados`): "Inserir" e "+ Lançar" abrem nos Dados (sem poder lançar, a lista) |
| `TotalizadorAtividade.jsx` | `fixo` (padrão `true`): na aba Resumo não fica preso ao topo |
| `ListaApontamentos.jsx` | `titulo` (padrão "Lançamentos"): "Lançamentos por dia" dentro de "Dias lançados" |
| Regras puras (`atividadeLinhasRegras.js`) | `linhasConfirmadasDaAtividade`, `resumoDoTipoNaAtividade`, `valorDoTipoNaAtividade`, `resumoDeCustoParaExibir`, `formatarMoedaAtividade` |
| CSS (`cadastro-base1.css`) | `.b1-aberta*`, `.b1-resumo-custo*`, a tabela dos tipos, `.b1-tipo-card*`; e os botões com texto dos dias (`tb-btn-sm`, que no motor é o botão só de ícone de 24 px — o texto vazava por cima dos vizinhos, já na `main`) com a largura do texto, só dentro de "Dias lançados" |
| Backend (só leitura) | `GET /atividades/:id/totais` + `custo_por_tipo` e `litros_combustivel_por_ha` (`atividadeService.obterTotais`); `GET /atividades` + `custo_total` por item (`atividadeService.listar` → `atividadeRepository.custosTotaisDasAtividades`) |
| Contratos | `MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md` (o `custo_total` da lista) e `MAIKE-ATIVIDADE-LINHAS-CONTRATO.md` (os campos novos dos totais) |

## 2. De onde vem cada número (nada inventado)

| Na tela | Fonte |
|---|---|
| Área (ha) / planejada, % feito | `/totais` (`area_executada`, `area_planejada`); sem ele, o cabeçalho. % = executada ÷ planejada (`percentualDe`), "—" sem planejada |
| Custo total, Custo por hectare | `/totais` (`custo_total`, `custo_por_ha`) |
| Trabalho de máquinas | `custo_por_tipo.maquinas` **+** `custo_por_tipo.combustivel` (no protótipo, o diesel é da máquina; assim a soma dos tipos é o custo total) |
| Aplicação de insumos / Mão de obra / Custos extras | `custo_por_tipo.produtos` / `.mao_obra` / `.servicos` |
| Combustível (L), Combustível por ha | `combustivel.quantidade_l` (e kg à parte) e `litros_combustivel_por_ha` (servidor: litros ÷ área executada) |
| Data, Safra | `data_inicio` e `safra_ciclo` do cabeçalho |
| Itens, Resumo dos tipos | as linhas CONFIRMADAS de lançamentos CONFIRMADOS (`GET /atividades/:id/apontamentos`, já carregado; a mesma regra dos totais); os litros do resumo da máquina, de `/totais` |
| Valor total da lista / do ⚡ | `custo_total` do item da lista (o mesmo do `/totais`) |

Sem o valor, "—" (lendo, "…"). Os rótulos "Diesel" do protótipo ficam **"Combustível"**: o abastecimento ligado pode ser
de qualquer combustível (D-PROD-211).

## 3. Backend: por que no servidor

- **Parcelas por tipo:** o serviço do `/totais` já calculava cada parcela para somar o `custo_total`; devolvê-las é
  exato e evita um segundo cálculo de custo na tela. Somar no cliente as linhas dos lançamentos daria o mesmo número
  hoje, mas seria uma segunda regra para manter igual.
- **Valor total da lista:** a lista não tinha custo. Uma consulta só por página (`UNION ALL` das quatro linhas e dos
  abastecimentos ligados, `GROUP BY atividade_id`, `atividade_id = ANY(ids da página)`), com `cliente_id` e
  `empresa_id` do `auth_context` / da fazenda conferida — sem N+1, sem tocar no keyset, no `total` nem no `has_more`.
  As parcelas são as mesmas do `/totais` (testado: o valor da lista é igual ao `custo_total` dos totais, com e sem
  combustível, com linha e lançamento cancelados).
- Sem migration, sem schema, sem mudança de rota, corpo de escrita ou regra.

## 4. Fora do escopo e ressalvas

- Diesel dentro da janela da máquina, operador por máquina, "Múltiplos talhões", a limitação da primeira linha do dia,
  os cartões da lista no celular (fatia 4).
- **Resumo de "Custos extras":** "N itens", como pedido (o nome do serviço aparece na aba Resumo da atividade).
- **Abas no celular:** ficam como abas (o protótipo também), não viram seções empilhadas como nos formulários do motor.
- **Dias lançados** começa recolhido (o protótipo não tem a lista por dia); tudo o que se fazia nela continua lá.

## 5. Testes e gates

| Item | Resultado |
|---|---|
| `tests/smoke/lancamentoAtividadesLinhas.test.jsx` | 11 novos (**LL-ABERTA-1 a 11**): abas e o Resumo de custo dos totais; combustível no Trabalho de máquinas, L e L/ha; os tipos (itens só confirmadas, resumo, valor, total, "+ Lançar", tipos pelas flags); o ⚡ do tipo (Inserir nos Dados, Ver lançamentos na lista, clicar no tipo) sem gravar nada; só leitura (concluída); "Dias lançados" com Novo, Repetir, Editar e Cancelar; aba Resumo (totais por item, não fixo; cabeçalho só leitura; ← → no teclado); navegação 2/4 → 3/4 → 4/4; coluna Valor total e o R$ no cabeçalho do ⚡; celular (cabeça, Concluir, cartões, ✕); regras puras. O backend falso dos totais devolve `custo_por_tipo` |
| `tests/smoke/lancamentoAtividades.test.jsx` | LA-LISTA-1 com a coluna "Valor total" entre as padrão |
| `npm run test:smoke` | 269 arquivos, **3.276 testes**, todos passando |
| Backend (PostgreSQL 16 local) | `atividadeIntegracaoTela` (13), `atividadeAbastecimento` (16), `atividadeNativo` (34), `atividadeLinhaMaoObra` (23), `atividadeLinhaProduto` (20), `atividadeLinhaMaquina` (20), `atividadeLinhaServico` (12), `atividadeApontamentoNativo` (20): todos passando. Ajustados/novos: chaves dos totais, `custo_por_tipo` e `litros_combustivel_por_ha` (com e sem combustível, kg fora dos litros, sem área), `custo_total` da lista igual ao dos totais |
| `node scripts/gates/verify-all.mjs --pular=test:backend` | todas as etapas passam; `gate:types` sem regressão (479 de 625) |

## 6. Imagens para o proprietário

Harness local (Vite + Playwright, a página real com sessão, fazenda, tipos e áreas e um backend falso; sem o menu do
topo do app), 1440×900 e 390×844, `deviceScaleFactor` 2, na pasta de rascunho da sessão (`scratchpad/fatia3-shots/`):
`d1-lista-valor-total.png`, `d2-menu-raio-valor.png` (R$ no cabeçalho do ⚡), `d3-aberta-lancamentos.png`,
`d4-aberta-raio-tipo.png` (⚡ do tipo), `d5-aberta-dias.png` (Dias lançados aberto), `d6-aberta-resumo.png`,
`d7-lancar-custos-extras.png` ("+ Lançar" abre a janela nos Dados), `c1-aberta-topo.png`, `c2-aberta-tipos.png`,
`c3-aberta-resumo.png`. O campo de data aparece como `mm/dd/yyyy` porque o Chrome sem interface usa o idioma inglês no
seletor nativo.
