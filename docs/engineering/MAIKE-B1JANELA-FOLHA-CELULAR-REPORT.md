# Conserto — listas da `B1Janela` no celular abrem DENTRO da janela

**Data:** 2026-11-19 · **Branch:** `claude/practical-fermi-imbelc` · **Tipo:** conserto, sem decisão nova
(aplica o padrão já usado na `JanelaAbastecimentoDaArea` e no `GerenciarTiposDialog`, o alvo das folhas da
D-PROD-116) · **Migration:** nenhuma · **Backend:** sem mudança

## Defeito

No celular (< 640 px) as listas (`B1Select`, `CampoSelect`) abrem uma folha de baixo (`MobileSheet`). Sem o
`MobileSheetPortalCtx`, a folha nasce no `document.body`, fora da `B1Janela` (Radix Dialog modal). A janela fica
por cima e engole o toque: as opções não podem ser escolhidas. O Escape, com a folha aberta, fechava a janela inteira.

## Correção (o mesmo padrão nas duas janelas)

- `const [alvoFolha, setAlvoFolha] = useState(null)`;
- na `B1Janela`: `fora={<div ref={setAlvoFolha} className="contents" />}` e
  `aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}` (com a folha aberta, fecha só a folha);
- o conteúdo dentro de `<MobileSheetPortalCtx.Provider value={alvoFolha}>`.

| Arquivo | Lista afetada |
|---|---|
| `src/components/mapa/cadastro/AcoesEmLoteAreas.jsx` | "Definir setor" das ações em lote do Cadastro de Áreas |
| `src/components/financeiroGestao/DialogosLancamento.jsx` (`DialogoAcao`, ramo `janelaBase1`) | o `conteudo` dos chamadores; hoje o `CampoSelect` "Área" do `DialogoAreaDaAtividade` ("Adicionar área" e "Iniciar/Concluir área" quando há escolha) |

## Varredura das outras `B1Janela`

| Janela | Situação |
|---|---|
| `JanelaAbastecimentoDaArea`, `JanelaLancamentoPorTipo`, `LinhasDoApontamento`, `FormularioApontamento`, `JanelasDaLinha`, `RegistroDeCampo`, `GerenciarTiposDialog` | já tinham o alvo das folhas |
| `JanelaNovoMovimentoEstoque` | **tem o defeito na `main`**; o conserto está no commit `ac53709` da branch `claude/new-session-26kpxu` (PR do "Novo movimento"), ainda não mergeada. Não mexido aqui para não conflitar |
| `JanelaEntradaEstoque`, `JanelaMovimentoEstoque`, `DialogosAbastecimento` (2 janelas), `PainelConsumoBem` | sem lista (só leitura, texto e botões): nada a fazer |

Fora do escopo: o `DialogoAcao` sem `janelaBase1` (caixa do shadcn) não foi revisado.

## Provas

`tests/smoke/b1JanelaFolhaCelular.test.jsx` (`window.matchMedia` simulando `max-width: 639px`):

- **AL1/AL2** — "Definir setor": a folha nasce dentro do diálogo, fora de `aria-hidden`, sem `pointer-events: none`
  herdado; tocar na opção escolhe e o diálogo continua aberto. **AL3** — Escape fecha só a folha.
- **DA1/DA2** — o mesmo para o `CampoSelect` no `conteudo` do `DialogoAcao` em janela Base1.

Antes da correção os quatro casos falhavam (folha fora do diálogo; Escape chamava `onFechar`); depois passam.

| Verificação | Resultado |
|---|---|
| `npx vitest run tests/smoke/b1JanelaFolhaCelular.test.jsx` + 25 arquivos de tela que usam as janelas mexidas | 25 arquivos, 539 testes, todos passando |
| `npm run lint` | 0 erros (2 avisos antigos em `CategoriasManejo.jsx` e `Produtos.jsx`) |
| `npm run gate:types` | PASSOU, sem regressão |
