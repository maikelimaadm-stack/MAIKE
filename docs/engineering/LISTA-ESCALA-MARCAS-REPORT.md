# Relatório — Piloto de escala Marcas (D-PROD-54)

**Data:** 2026-10-27 (America/Cuiaba)  
**Branch:** `cursor/lista-escala-marcas-26e2`  
**Base:** `cursor/alteracoes-visuais-26e2`

---

## Objetivo

Permitir que a listagem Base1 de Marcas suporte **milhões/bilhões de linhas no
banco** sem materializar o tenant no browser nem no payload HTTP.

---

## O que entrou

| Camada | Mudança |
|---|---|
| Backend | `GET /marcas?limit&cursor&empresa_id&q&ativo` → envelope paginado keyset |
| Prisma | Índices `(cliente_id, empresa_id, createdAt, id)` e `(cliente_id, createdAt, id)` |
| FE API | `listMarcasPage` (porta nativa); `list` offline unwrap cap 500 |
| FE página | `useMarcasInfiniteList` + rodapé “Carregar mais” = próxima página do cursor |
| Grade | Virtualização (`@tanstack/react-virtual`) a partir de 80 linhas |
| Limites | `limit` ≤ 500; janela cliente ≤ 2.000; page sizes UI 100–500 |

---

## Contrato HTTP

```json
{
  "items": [ /* MarcaPublica */ ],
  "next_cursor": "…"|null,
  "has_more": true,
  "total": 1234567890,
  "limit": 100
}
```

Tenant continua **só** do JWT (`cliente_id` nunca na query).

---

## Como se comporta em escala

| Escala | Comportamento |
|---|---|
| Centenas | Igual UX Base1; 1–N páginas |
| Milhões | DB serve páginas keyset; UI só carrega o pedido; DOM virtualizado |
| Bilhões | Mesmo caminho; usuário **precisa** refinar `q` / empresa; janela FE para em 2k |

O que **ainda** não é “bilhões perfeitos”:

- `COUNT(*)` exato em `total` pode ficar lento em tabelas enormes sem filtro
- Export não é streaming (só janela carregada)
- Delete em massa ainda é N× DELETE
- Outros cadastros Base1 ainda full-fetch

---

## Testes

- `backend/tests/keysetCursor.test.mjs`
- `backend/tests/marcaNativo.test.mjs` — BE-P54-01/02/03 + BE-P44-04 atualizado
- `gate:marca-native`, `gate:indices`, `typecheck:backend`

---

## Refino D-PROD-55 (mesma PR)

Motor extraído de Marcas → Base1 compartilhado:

- `useCadastroInfiniteList` (genérico)
- `cadastroListaScale.js` (tetos + envelope)
- `montarEnvelopeKeyset` no backend shared
- Doc: `MOTOR-BASE1-LISTA.md`

Marcas só consome (`fetchPage` + `queryKey`).

## Próximas missões (não nesta PR)

1. Plugar Produto / Lançamentos / etc. no **mesmo** motor  
2. `total` aproximado ou `include_total=0`  
3. Bulk delete + export job  
4. Typeahead de sugestões via endpoint dedicado (não só janela local)
