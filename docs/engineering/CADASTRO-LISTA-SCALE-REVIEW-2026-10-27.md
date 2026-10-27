# Revisão de escala — lista/tabela Base1 (referência Marcas)

**Data:** 2026-10-27 (America/Cuiaba)  
**Escopo:** como o chrome de cadastro (tabela/cards/registro) se comporta com
milhares → milhões → bilhões de registros.  
**Referência de código:** `src/pages/Marcas.jsx` + stack compartilhada Base1.  
**Tipo:** revisão (sem implementação de paginação de servidor nesta missão UX).

---

## Veredito

A arquitetura atual é **lista completa em memória + filtro/ordem no browser +
“Carregar mais” só no DOM**. Serve cadastros pequenos (centenas a baixo milhar).
**Não escala para milhões/bilhões** sem redesign FE+BE.

O rodapé “100 / 200 / … / Carregar mais” é **paridade visual Base1**, não
estratégia de escala.

---

## Como funciona hoje

| Camada | Comportamento |
|---|---|
| `GET /marcas` | `findMany` por `cliente_id`, **sem** `take` / `skip` / cursor |
| Service FE | `listMarcas()` e depois `filter(empresa_id)` **no cliente** |
| React Query | Guarda o array inteiro do tenant/empresa |
| Busca / filtro / sort | 100% browser (`CadastroBase1Grade`) |
| “Paginação” | `displayLimit` = `slice(0, N)` das linhas já filtradas |
| Render | `rows.map` → `<tr>` / cards — **sem virtualização** |
| Export CSV | Materializa o array completo no browser |
| Delete em massa | Loop sequencial `DELETE /marcas/:id` |
| Offline adapter | Espelha a lista completa no IndexedDB |

Arquivos-chave:

- `backend/src/modules/marcas/marcaRepository.js`
- `src/services/marcaService.js`
- `src/hooks/useCadastroListaPagination.js`
- `src/components/cadastro/base1/CadastroBase1Grade.jsx`
- `src/components/cadastro/base1/Base1Grid.jsx`

---

## Tetos práticos

| Escala | Viabilidade |
|---|---|
| Centenas | Ok — desenho atual |
| ~1–5 mil | Degrada (JSON, sort, facetas, heap) |
| Dezenas de mil | Inviável na prática |
| Milhões / bilhões | Bloqueado — redesign obrigatório |

Marcas de pecuária raramente chegam a milhões; o risco sistêmico é o **chrome
Base1 compartilhado** (produtos, movimentações, lançamentos densos).

---

## Achados

| # | Achado | Severidade |
|---|---|---|
| F1 | `GET` + `findMany` sem limite — payload = conjunto grande do tenant | Bloqueia milhões |
| F2 | `empresa_id` filtrado só no FE | Degrada / agrava F1 |
| F3 | Busca/filtro/sort 100% browser | Bloqueia milhões |
| F4 | Facetas de filtro derivadas de todas as linhas | Bloqueia milhões |
| F5 | Sem virtualização; só `displayLimit` | Degrada DOM; não salva rede |
| F6 | Export CSV materializa N em memória | Bloqueia milhões |
| F7 | Delete 1:1 sequencial; sem bulk API | Degrada |
| F8 | Select-all sobre conjunto filtrado completo (quando coluna ligada) | Bloqueia se N enorme |
| F9 | Offline espelha lista completa | Degrada |
| F10 | Índices tenant-aware ok para CRUD pontual | Ok curto prazo |
| F11 | pageSize 100–1000 + load more | Ok UX para centenas |
| F12 | Docs/roadmap sem decisão de cursor/paginação de cadastros | Dívida explícita |

---

## O que precisaria mudar (milhões+)

### Backend

1. `GET` com **keyset/cursor** + `limit` hard-capped  
2. Filtro `empresa_id` (e busca/sort) no SQL  
3. Contagens baratas (`total` / `filtrados`) ou aproximadas  
4. Export streaming / job assíncrono  
5. Delete/bulk em lote com auditoria  
6. Nunca serializar o tenant inteiro numa resposta

### Frontend

1. React Query por página/cursor (parar full-list)  
2. Grade/cards **virtualizados**  
3. Facetas/filtros via API  
4. Export sem materializar N  
5. Offline incremental  
6. `displayLimit` deixa de ser a “paginação” real

---

## Relação com a missão UX atual

Esta branch (`cursor/alteracoes-visuais-26e2`) trata de paridade visual Base1
(Marcas). A revisão de escala **não altera** o contrato de “Carregar mais” nesta
missão — só documenta o teto e a dívida.

Plano UX já reconhecia filtragem client-side como inventário futuro
(`PLAN-EXECUCAO-PARIDADE-BASE1.md`, Fase 3). Esta nota eleva isso a risco de
plataforma quando entidades densas usarem o mesmo chrome.

---

## Próximo passo sugerido (missão separada)

~~1 missão = 1 PR. Candidata: paginação cursor no `GET /marcas` + FE.~~  
**Feito no piloto D-PROD-54** — ver `LISTA-ESCALA-MARCAS-REPORT.md`
(`cursor/lista-escala-marcas-26e2`). Restante: generalizar o chrome Base1,
`COUNT` aproximado, export streaming, bulk delete.
