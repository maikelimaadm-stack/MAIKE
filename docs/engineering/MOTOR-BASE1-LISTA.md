# Motor Base1 — lista em escala

**Decisão:** D-PROD-55 (extrai o motor do piloto Marcas / D-PROD-54)

O cadastro de **Marcas não é o motor**. O motor é a stack Base1 abaixo; Marcas
(e qualquer outra tela de cadastro) só **consome**.

Alterar o motor = alterar o comportamento de **todas** as telas que o plugaram.

---

## Peças do motor

| Peça | Caminho | Responsabilidade |
|---|---|---|
| Envelope + tetos FE | `src/lib/cadastroListaScale.js` | `limit` max 500, janela 2000, `normalizarEnvelopePagina` |
| Infinite list | `src/hooks/useCadastroInfiniteList.js` | React Query keyset, load more, janela |
| Grade virtual | `src/components/cadastro/base1/Base1Grid.jsx` | DOM só das linhas visíveis |
| Chrome / page size | `cadastroBase1List.js`, `CadastroListaChrome` | seletor 100–500 + Carregar mais |
| Cursor + envelope BE | `backend/src/shared/pagination/keysetCursor.js` | encode/decode, `montarEnvelopeKeyset` |

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
| Demais cadastros Base1 | Ainda full-fetch — migrar um a um |
