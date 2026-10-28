# MOTORBASE1 — Status badge SSOT + paridade Marcas ↔ Unidades (PR #113)

**Data:** 2026-10-28  
**Base:** `origin/main` @ `096f056f` (merge PR #112)  
**Branch:** `cursor/status-badge-ssot-paridade-motorbase1-516d`

## ANTES / DEPOIS — coluna Ativo

| Aspecto | Marcas (antes) | Unidades (antes) | Depois (ambas) |
|---|---|---|---|
| Célula tabela/cards | Texto `Sim` / `Não` | `<Badge>` local verde/cinza | `CadastroAtivoBadge` via `cellKind: 'ativo-badge'` |
| Filtro / sort / export | `Sim`/`Não` vs `Ativo`/`Inativo` | `Ativo`/`Inativo` | `Ativo`/`Inativo` (`cadastroAtivoStatus.js`) |
| Onde vive o JSX | `TabelaMarcas.jsx` | `TabelaUnidadesMedida.jsx` | Motor: `cadastroBase1CellKind.jsx` + grade |

## Implementação SSOT

- `src/lib/cadastroAtivoStatus.js` — política `ativo !== false`, labels `Ativo`/`Inativo`.
- `src/components/cadastro/base1/CadastroAtivoBadge.jsx` — pílula read-only (referência visual Unidades).
- `src/components/cadastro/base1/cadastroBase1CellKind.jsx` — `CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE`, `composeCadastroBase1RenderCell`.
- `CadastroBase1Grade` compõe motor + adapter antes de `Base1Grid` / `Base1Cards`.

Adapters declaram `cellKind` na coluna `ativo` e removem branch JSX de status. `B1ChaveRow` do formulário **não** alterado.

## Matriz D1–D9 (pós #112 + este slice)

| ID | Item | Status técnico | Notas |
|---|---|---|---|
| D1 | Controlador + screen compartilhados | PASS | PR #112 |
| D2 | Paginação keyset | PASS | Marcas + Unidades |
| D3 | Toolbar / chrome / prefs colunas | PASS | Sem mudança estrutural |
| D4 | Badge status idêntico | **PASS (código + teste grade real)** | Este PR |
| D5 | Cards + campos configuráveis | PASS | Badge via `composedRenderCell` |
| D6 | Busca / sugestões / seleção | PASS | Sem alteração de handlers |
| D7 | Form registro (B1Field / B1ChaveRow) | PASS | Fora do escopo badge |
| D8 | Export CSV labels status | PASS | `Ativo`/`Inativo` em ambas |
| D9 | Homologação visual produção Vercel | **MANUAL PENDING** | Sem credencial produção neste ambiente |

## Invariantes preservados

- `colunas_marcas_v1`, `colunas_unidades_medida`, `storageKey`, URLs.
- Marcas filtrada por `empresaId`; Unidades tenant-scoped.
- Sem migrations / Prisma / deploy.

## Riscos

- Usuários que filtravam Marcas por facet `Sim`/`Não` passam a ver `Ativo`/`Inativo` (alinhado ao pedido; prefs de coluna intactas).
- `sessionStorage` / XSS — inalterado (P8).

## Veredito

**GO técnico** — badge único no motor, adapters sem duplicação, testes smoke + gates locais (ver PR CI). **Homologação visual produção: PENDING.**
