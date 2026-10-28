# Motor Base1 — lista em escala

**Decisão:** D-PROD-55 (extrai o motor do piloto Marcas / D-PROD-54)

O cadastro de **Marcas não é o motor**. O motor é a stack Base1 abaixo; Marcas
(e qualquer outra tela de cadastro) só **consome**.

Alterar o motor = alterar o comportamento de **todas** as telas que o plugaram.

---

## Peças do motor

| Camada | Peça | Caminho | Responsabilidade |
|---|---|---|---|
| **Dados / paginação** | Envelope + tetos FE | `src/lib/cadastroListaScale.js` | `limit` max 500, janela 2000, `normalizarEnvelopePagina` |
| | Infinite list | `src/hooks/useCadastroInfiniteList.js` | React Query keyset, load more, janela |
| | Cursor + envelope BE | `backend/src/shared/pagination/keysetCursor.js` | encode/decode, `montarEnvelopeKeyset` |
| **Visual / preset** | Preset Base1 lista | `src/components/cadastro/base1/base1VisualPreset.js` | SSOT de flags de apresentação (`pageLayout`, chrome portal, `referenceHeaders`) — **sem entidade** |
| | Grade + prefs | `CadastroBase1Grade`, `cadastroBase1ColumnPrefs.js` | Filtro/sort/prefs, `Base1Grid` / cards |
| | Badge `ativo` (SSOT) | `CadastroAtivoBadge.jsx`, `cadastroBase1CellKind.jsx`, `cadastroAtivoStatus.js` | Coluna com `cellKind: 'ativo-badge'` — leitura tabela/cards; export/filtro via `Ativo`/`Inativo` |
| | Chrome / page size | `cadastroBase1List.js`, `CadastroListaChrome` | seletor 100–500 + Carregar mais |
| **Orquestração** | Controlador + screen | `useCadastroBase1Controller.js`, `CadastroBase1Screen.jsx` | busca/registro/toolbar/paginação/export compartilhados (D-PROD-55 COMPLETE-01) |
| **Adapter por cadastro** | Página + tabela + form | ex.: `Marcas.jsx`, `UnidadesMedida.jsx`, `CadastroSetores.jsx` | colunas, `storageKey`, fetch, CRUD, mensagens — **sem** duplicar handlers genéricos |

**Dependência permitida (uma direção):** Tela → Motor Base1 → primitivos genéricos (`ui/`, `common/`, `lib/utils`). O gate `gate:motorbase1-independence` impede import inverso (Mapa, Marcas, `pages/`, `services/`, `apis/`).

---

## Preset visual (consumo)

Perfil lista integrada (portal compras; piloto Marcas), congelado em `BASE1_LISTA_INTEGRADA_VISUAL`:

```js
import { BASE1_LISTA_INTEGRADA_VISUAL } from '@/components/cadastro/base1/base1VisualPreset';

<CadastroWorkspace {...BASE1_LISTA_INTEGRADA_VISUAL.workspace} />
<CadastroListaChrome {...BASE1_LISTA_INTEGRADA_VISUAL.chrome} />
<CadastroBase1Grade {...BASE1_LISTA_INTEGRADA_VISUAL.grade} /* + colunas, storageKey, fetch */ />
```

Rollout por cadastro: `MOTORBASE1-ROLLOUT-01-UNIDADES-REPORT.md` (Unidades), `MOTORBASE1-ROLLOUT-02-SETORES-SEARCH-REPORT.md` (Setores + busca integrada fechada ao entrar).

Overrides típicos **na tela** (não no preset global): `colunaSelecao`, `selecaoSticky`, `initialViewMode` cards ≤639px, `cardFields`, actions, formulário.

Harness de prova sem Marca: `tests/smoke/motorBase1FictitiousEntity.test.jsx`.

---

## Como uma tela de cadastro pluga

1. Backend da entidade: `listar` com `limit`/`cursor`/`q` → `montarEnvelopeKeyset(...)`
2. API FE: `listXxxPage` → `normalizarEnvelopePagina`
3. Página:

```js
const lista = useCadastroInfiniteList({
  queryKey: ["produtos", "page", empresaId, q],
  enabled: Boolean(empresaId),
  pageSize,
  fetchPage: ({ limit, cursor }) => listarProdutosPagina(empresaId, { limit, cursor, q }),
});
// lista.items · lista.total · lista.hasMore · lista.loadMore
```

4. Rodapé do chrome: `hasMore` / `onLoadMore` / `listados` / `totais` vindos de `lista`

Não criar `useProdutosInfiniteList`, `useLotesInfiniteList`, etc. — isso quebra o motor.

---

## Estado da migração

| Tela | Consome o motor? |
|---|---|
| Marcas | **Sim** (piloto) |
| Unidades de medida | **Sim** (preset visual, ROLLOUT-01) |
| Setores | **Sim** (keyset + busca, ROLLOUT-02) |
| Categorias produto | **Sim** (hierárquico full-list, ROLLOUT-03) |
| Produtos | **Sim** (keyset + CSV, ROLLOUT-04) |
| Demais cadastros Base1 | Ainda full-fetch — migrar um a um |
