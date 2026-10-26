# Plano de execução — Paridade Base1 / Portal Compras (cadastros MAIKE)

**Tipo:** plano de implementação (formato tasks-plan)  
**Criado em:** 2026-10-26  
**Owner:** engenharia UX/Base1  
**Regra de missão:** **1 cadastro = 1 PR** (R7); motor compartilhado em PRs dedicados quando o escopo for transversal.

---

## Overview

Executar a **paridade visual e comportamental completa** do MODELO BASE1 do Agro ERP (referência **Portal de Compras** + frota/equipamentos) em **todos os cadastros** do manifesto `config/mapa-manejo-scope.json`, usando o motor SSOT em `src/components/cadastro/base1/` e CSS em `src/styles/cadastro-*.css`.

O **piloto Marcas** concentra o checklist §11 de [`PROMPT-MODELO-VISUAL-AGRO-ERP.md`](./PROMPT-MODELO-VISUAL-AGRO-ERP.md) e as fatias **UX-34–UX-42** em [`UX-FROTA-PILOT-MARCAS-REPORT.md`](./UX-FROTA-PILOT-MARCAS-REPORT.md). As demais páginas já passaram por migração Frota/Base1 (UX-06–UX-17), mas **só Marcas** hoje liga `pageLayout="base1-list"`, `joinTableToolbar` e `portalComprasSkin` — ou seja, a paridade “tela inteira = portal compras” ainda não foi propagada.

Abordagem: **estabilizar Marcas na linha da PR #51 → sign-off → replicar o pacote de props/contratos por cadastro**, sem mega-PR e sem copiar domínio do CDE.

---

## Specification links

| Recurso | Caminho / referência |
|---------|----------------------|
| Checklist e anatomia Base1 | [`docs/engineering/PROMPT-MODELO-VISUAL-AGRO-ERP.md`](./PROMPT-MODELO-VISUAL-AGRO-ERP.md) (§11) |
| Plano portal compras (fatia UX-39) | [`docs/engineering/PLAN-PORTAL-COMPRAS-PARIDADE-BASE1.md`](./PLAN-PORTAL-COMPRAS-PARIDADE-BASE1.md) |
| Histórico piloto Marcas | [`docs/engineering/UX-FROTA-PILOT-MARCAS-REPORT.md`](./UX-FROTA-PILOT-MARCAS-REPORT.md) (UX-34–42) |
| Decisão SSOT visual | **D-PROD-39** em [`docs/engineering/DECISIONS.md`](./DECISIONS.md) |
| Repositório referência (CDE) | **CONTROLE-DE-ESTOQUE** — clone sugerido `/tmp/controle-de-estoque` (`apps/web/src/features/compras/`, `features/base1/`, `app/globals.css`, `b1ref.css`) |
| Auditoria aprofundada (2026-10-26) | Cópia de trabalho do agente: `uploads/deep-research-report_190f.md` (raiz do workspace Cursor); espelho recomendado no repo: `docs/engineering/audits/deep-research-ui-ux-base1-2026-10-26.md` quando arquivado |
| PR em aberto (piloto) | **PR #51** — branch `cursor/ux-base1-cards-colunas-878d` (“UX-29: paridade cards e popover de colunas (Base1)” + UX-30…42) |
| Escopo executável | [`config/mapa-manejo-scope.json`](../../config/mapa-manejo-scope.json) |
| Estado do programa | [`docs/engineering/CURRENT-STATE.md`](./CURRENT-STATE.md), [`docs/engineering/ROADMAP.md`](./ROADMAP.md) |

---

## Technical approach

| Camada | SSOT | Notas |
|--------|------|--------|
| Shell lista | `CadastroWorkspace` + `pageLayout="base1-list"` | Sem header mg-card duplicado (UX-20) |
| Chrome lista/registro/cards | `CadastroListaChrome` | `joinTableToolbar`, `recordMode`, `recordEditing`, `portalComprasSkin` opcional |
| Grade | `CadastroBase1Grade` → `Base1Grid` | `referenceHeaders`, `referenceExtendedColumnMenu`, prefs `cadastroBase1ColumnPrefs.js` |
| Filtro coluna | `CadastroColunaFiltro` + `cadastroColunaFiltroCamada.js` | `fpop`, camadas 357–360 |
| Colunas | `ConfiguracaoColunasB1Dialog` | Duas listas, rascunho até ✓ (UX-38) |
| Cards | `Base1Cards`, `useCadastroCardsPrefs` | Popovers via menu ⚡ (UX-33+) |
| Skin portal | `cadastro-b1-portal.css` + `portalComprasSkinContext` | Só quando `portalComprasSkin={true}` |
| Formulário | `B1Field`, `B1ChaveRow`, `Formulario*` embedded | `readOnly` em leitura (11.14) |

**Padrão de rollout por cadastro (checklist extraído de Marcas):**

1. Página: `pageLayout="base1-list"` no `CadastroWorkspace`.
2. `CadastroListaChrome`: `joinTableToolbar`, `portalComprasSkin`, `showFilterRail={false}` (cadastro sem rail de chips — alinhado a Marcas; exceções documentadas).
3. Tabela/grade: `referenceHeaders` + storage key estável; `colunaSelecao` conforme produto (Marcas: sem checkbox — UX-40).
4. `recordEditing` + formulário `readOnly` em leitura.
5. Teste manual §11 + matriz viewport da auditoria (360/390/768/1280).
6. `npm run verify:all` verde.

**Fora do rollout Base1 lista (por desenho):** `MapaGeral`, `MapaCadastro`, formulários de manejo no mapa, `ConfiguracoesGerais` (sem lista Frota).

---

## Current state

### Marcas (piloto) — DONE / PARTIAL / TODO

| Área | Status | Evidência |
|------|--------|-----------|
| Checklist §11.1–11.14, 11.4 N/A | **DONE** | UX-36, UX-37, PROMPT §11 |
| Portal compras skin + join (§11.2 visual CDE) | **DONE** | UX-39, `PLAN-PORTAL-COMPRAS-PARIDADE-BASE1.md` |
| Grade fpop, resize, freeze, autoFit, sort numérico | **DONE** | UX-35, UX-40, UX-42 |
| Cards + colunas SSOT | **DONE** | UX-29, UX-38 |
| §11.15 Pesquisa dropdown avançada / favoritos | **DEFER** | Fora de escopo produto (manter deferido) |
| §11.16 Anexos nativos | **TODO (P8)** | Ícone/toolbar até auditoria P8 |
| Cards modo `p-4` / padding paridade CDE | **DONE** | UX-29 + UX-43 (`Base1Cards` `p-4`; viewport `p-2.5` = CDE `list.tsx`) |
| Toolbar mobile (`height` fixa + `flex-wrap`) | **DONE** | UX-43: join `height: auto` ≤1023px; toque 44px em pílulas primárias ≤639px |
| `TopNoticeDialog` / `RegistroAnexosDialog` (Escape/clique fora) | **TODO** | UX-A, UX-B — PR Dialog/Popover transversal |
| Tenancy / `empresa_selecionada_id` + filtro cliente | **RISCO / backend futuro** | SEC-A/B — PR separada segurança/dados, não misturar com UI |
| `max+1` número de marca | **RISCO / backend** | DATA-A — quando Marca for nativa (P6+) |
| PR #51 merge + preview sign-off | **DONE** | merge `e63aa297` (2026-10-26) |

### Demais cadastros (`allowedPages` — rollout)

Páginas de **cadastro** no manifesto (excluindo mapa e config ícones):

| Página | Base1 motor (UX-14+) | Portal join + skin (como Marcas) |
|--------|----------------------|----------------------------------|
| `Marcas` | Sim | **Sim (piloto)** |
| `CadastroSetores` | Sim | Não |
| `Categorias` | Sim | Não |
| `Produtos` | Sim | Não |
| `CadastroLotes` | Sim | Não |
| `UnidadesMedida` | Sim | Não |
| `LocaisEstoque` | Sim | Não |
| `CategoriasManejo` | Sim | Não |
| `GruposAtividades` | Sim | Não |
| `TiposTarefa` | Sim | Não |
| `Empresa` | Sim | Não |
| `Usuarios` | Sim (dupla lista) | Não |
| `Bebedouros` | Sim (subviews lançamento) | Não |
| `ConfiguracoesGerais` | Shell apenas | N/A |
| `MapaGeral` / `MapaCadastro` | Fora | Fora |

### Achados da auditoria aprofundada (prioridade para o programa)

| ID | Prioridade | Fase sugerida |
|----|------------|---------------|
| PROC-A | Alta | 0 — não duplicar trabalho da PR #51 |
| UX-C (toolbar mobile) | Alta | 1 ou 3 (foundations CSS) |
| UX-A, UX-B (dialogs) | Alta | 3 |
| UX-D (anexos grid 210px) | Média | 3 (+ P8 funcional) |
| A11Y-A, UX-E | Média | 3 |
| SEC-A/B, DATA-A | Alta (dados) | PR backend separada; não bloquear rollout visual |
| UX-F, UX-G (scroll/dvh) | Média | 3 — validar com evidências |

---

## Phases

### Fase 0 — Integração piloto (PR #51)

**Objetivo:** linha `main` (ou branch de integração) contém Marcas estável como referência.

- [ ] Revisar diff PR #51 vs `main`; matriz **ACHADO | MAIN | PR #51 | AINDA NECESSÁRIO?** (auditoria §PROC-A).
- [ ] `npm run verify:all` na branch PR #51 (aceitar falha só `test:backend` sem Postgres local, documentado).
- [ ] Merge **PR #51** após review humano; tag anotada opcional `ux-base1-marcas-ref`.
- [ ] Preview Vercel / ambiente com `VITE_MAIKE_API_URL` + Maps: sign-off manual Marcas (checklist UX-39, UX-40, UX-42).
- [ ] Atualizar corpo do PR #51 / relatório UX-39 item “commit push” em `PLAN-PORTAL-COMPRAS-PARIDADE-BASE1.md`.

**Aceite Fase 0**

- [ ] Marcas reproduz checklist §11 exceto 11.15 defer e 11.16 P8.
- [ ] Gates obrigatórios verdes no commit mergeado.
- [ ] Evidências preview (capturas 360/1280) anexadas ao PR ou pasta `docs/audit-ui-ux/2026-10-26/` (opcional).

---

### Fase 1 — Lacunas restantes Marcas

**Objetivo:** referência **estável** antes de clonar para outros cadastros.

- [x] **Cards:** paridade padding/layout (`p-4` / viewport CDE) — comparar `Base1Cards` × `cards.tsx`; uma PR pequena se diff confirmado.
- [x] **Toolbar mobile:** `min-height` + `height: auto` em `.mg-toolbar` onde aplicável; touch 44px só em controles primários mobile (auditoria UX-C).
- [x] **Sign-off visual** pós UX-41/42: ViewSwitch, `mg-summary` 4 colunas, `fpop` z-index, page-size 4.5rem.
- [x] Documentar explicitamente **11.15** como permanece fora de escopo (sem implementar) — **D-PROD-40**.
- [x] **Anexos:** manter desabilitado/placeholder até P8; registrar em DECISIONS se comportamento da toolbar mudar — **D-PROD-40**.
- [x] Itens deep research ainda abertos **somente em Marcas** que não exijam backend (dialogs → adiar para Fase 3 se escopo transversal).

**Aceite Fase 1**

- [x] Teste manual PROMPT §11 + UX-40/41/42 repetido em 360, 390, 768, 1280 (sign-off UX-43).
- [x] `npm run verify:all` verde.
- [x] `UX-FROTA-PILOT-MARCAS-REPORT.md` seção **UX-43+** ou entrada “Marcas sign-off” com data.

---

### Fase 2 — Rollout por cadastro (portal join + paridade Marcas)

**Objetivo:** cada página de cadastro herda o **mesmo pacote** que Marcas (props + grade + registro leitura/edição).

**Ordem sugerida (dependência de produto e complexidade):**

| Ordem | PR / missão | Página | Motivo |
|-------|-------------|--------|--------|
| 1 | `ux-base1-paridade-setores-*` | `CadastroSetores` | Mapa/manejo depende de setor |
| 2 | `ux-base1-paridade-categorias-*` | `Categorias` | Produtos referenciam categoria |
| 3 | `ux-base1-paridade-unidades-*` | `UnidadesMedida` | Produtos |
| 4 | `ux-base1-paridade-produtos-*` | `Produtos` | Maior formulário; valida `extraToolbar` |
| 5 | `ux-base1-paridade-locais-*` | `LocaisEstoque` | Estoque |
| 6 | `ux-base1-paridade-lotes-*` | `CadastroLotes` | `DynamicFormRenderer` + grade |
| 7 | `ux-base1-paridade-manejo-meta-*` | `CategoriasManejo`, `GruposAtividades`, `TiposTarefa` | 1 PR por página (R7) |
| 8 | `ux-base1-paridade-empresa-*` | `Empresa` | Admin |
| 9 | `ux-base1-paridade-usuarios-*` | `Usuarios` | Dupla grade — último admin |
| 10 | `ux-base1-paridade-bebedouros-*` | `Bebedouros` | Subviews lançamento; não copiar literal Marcas |

**Checklist por PR (copiar de Marcas):**

- [ ] `pageLayout="base1-list"`.
- [ ] `joinTableToolbar` + `portalComprasSkin` (salvo decisão explícita de skin off).
- [ ] `showFilterRail={false}` ou justificativa em DECISIONS.
- [ ] Grade `referenceHeaders`; prefs `{storageKey}_prefs`.
- [ ] `recordEditing` + form `readOnly`.
- [ ] Export CSV / Duplicar / Imprimir se já existiam na página.
- [ ] `gate:product-scope` inalterado ou manifesto atualizado com decisão.
- [ ] Relatório `docs/engineering/UX-FROTA-PILOT-MARCAS-REPORT.md` ou `UX-PARIDADE-<PAGINA>-REPORT.md` (1 página).
- [ ] `npm run verify:all`.

**Aceite Fase 2**

- [ ] Todas as linhas da tabela “Demais cadastros” com portal join + skin = Sim.
- [ ] Nenhuma regressão reportada em Mapa Geral (smoke).

---

### Fase 3 — Hardening transversal Base1

**Objetivo:** corrigir débitos que afetam **todos** os cadastros de uma vez.

- [ ] **Política Dialog/Popover:** `AppDialog` / contrato dirty-state; corrigir `TopNoticeDialog`, `RegistroAnexosDialog` (UX-A/B).
- [ ] **Anexos layout responsivo** (grid 1 col mobile) — preparar P8.
- [ ] **Tokens touch / icon buttons** — `AppIconButton` ou evolução `IconBtn` (A11Y-A).
- [ ] **Testes smoke** adicionais: dismiss filtro, freeze prefs (padrão UX-42).
- [ ] **Prefs API futura:** stub documentado; hoje `localStorage` only (D-PROD-39).
- [ ] **Gate opcional (discutir):** ex. `gate:base1-cadastro-layout` que exige `joinTableToolbar` nas páginas listadas — só após Fase 2 completa; registrar em `GATE-REGISTRY.md` se aprovado.
- [ ] **Performance:** filtragem client-side em services — inventário; não resolver tudo na Fase 3 UI.

**Aceite Fase 3**

- [ ] Matriz viewport auditoria sem itens **Alta** abertos em Marcas + 2 cadastros amostra (Produtos, Bebedouros).
- [ ] `npm run verify:all` + smoke novos testes verdes.

---

### Fase 4 — Documentação e decisões

- [ ] Atualizar **D-PROD-39** ou adicionar **D-PROD-40** se rollout alterar escopo (ex. rail chips por cadastro).
- [ ] Encerrar `PLAN-PORTAL-COMPRAS-PARIDADE-BASE1.md` (checkbox Fase 5 commit).
- [ ] `CURRENT-STATE.md`: track UX Base1 concluído ou % rollout.
- [ ] `ROADMAP.md`: link para este plano (feito na criação do plano).
- [ ] Arquivar auditoria em `docs/engineering/audits/deep-research-ui-ux-base1-2026-10-26.md` (opcional).
- [ ] Relatório final `docs/engineering/UX-BASE1-ROLLOUT-CLOSURE-REPORT.md`.

**Aceite Fase 4**

- [ ] Links internos passam `npm run gate:governance-paths`.
- [ ] Nenhum SSOT duplicado na raiz do repo (R6).

---

## Dependencies

| Dependência | Impacto |
|-------------|---------|
| Merge **PR #51** | Bloqueia Fase 1–2 (motor e Marcas referência) |
| `VITE_MAIKE_API_URL` / preview Vercel | Sign-off manual; build-time |
| `FRONTEND_ORIGINS` / CORS | Preview com backend |
| `config/mapa-manejo-scope.json` | Nova página exige decisão + gate `product-scope` |
| PostgreSQL local | `test:backend` em CI/agente |
| **P8** | Anexos nativos §11.16 |
| **P6+** persistência nativa Marca | Concorrência numeração (DATA-A) |
| Clone CDE atualizado | Diffs visuais |

---

## Risks

| Risco | Mitigação |
|-------|-----------|
| Regressão visual em 12+ cadastros | 1 cadastro = 1 PR; skin atrás de `portalComprasSkin`; screenshots before/after |
| Conflito com PRs UX paralelas | Fase 0 matriz MAIN vs #51; rebase frequente |
| Dívida `gate:types` (2.318) | Código novo zero diagnóstico; não inflar baseline |
| Backend N/A para cadastros Base44 | Rollout é **UI**; não misturar migration tenancy com UX |
| Toolbar/dialog “conserto global” quebra mapa | Escopo `.cadastro-b1`; não alterar `MapaGeral` sem missão |
| `localStorage` prefs vs multi-dispositivo | Documentar limitação até API prefs |
| CSV / Excel formula injection | Nota UX-30; correção opcional P8 |

---

## Acceptance criteria (resumo por fase)

| Fase | Verificável |
|------|-------------|
| 0 | PR #51 mergeada; verify:all; checklist §11 em Marcas exceto 11.15/11.16 |
| 1 | Marcas sign-off mobile + cards; relatório UX atualizado |
| 2 | Cada cadastro: join + skin + §11 aplicável; verify:all por PR |
| 3 | Política dialogs; testes smoke; amostra 3 telas viewport OK |
| 4 | DECISIONS + governance gates verdes |

Alinhamento explícito com **PROMPT §11**: itens 11.1–11.14 devem constar como **Feito** em cada cadastro ao fechar sua PR; 11.15 permanece **Fora**; 11.16 **P8**.

---

## Mission sizing (R7)

| Tipo de PR | Exemplo |
|------------|---------|
| **1 cadastro** | `cursor/ux-base1-paridade-produtos-516d` |
| **Motor transversal** | dialogs, toolbar CSS, prefs — PR única com escopo estreito |
| **Docs/evidências** | `cursor/plan-paridade-base1-516d`, auditoria sem código |
| **Segurança/dados** | tenancy Marca, `max+1` — **separado** de UI |

**Proibido:** uma PR com Produtos + Lotes + Usuários.

---

## Próximos três PRs recomendados

1. **Merge + estabilização:** integrar **PR #51** (`cursor/ux-base1-cards-colunas-878d`) — Fase 0.  
2. **Marcas sign-off:** `cursor/ux-base1-marcas-gaps-516d` — Fase 1 (cards `p-4`, toolbar mobile, evidências).  
3. **Primeiro rollout:** `cursor/ux-base1-paridade-setores-516d` — Fase 2 (replicar pacote Marcas em `CadastroSetores`).

---

## Referências cruzadas

- Plano portal (escopo UX-39): [`PLAN-PORTAL-COMPRAS-PARIDADE-BASE1.md`](./PLAN-PORTAL-COMPRAS-PARIDADE-BASE1.md)  
- Prompt checklist: [`PROMPT-MODELO-VISUAL-AGRO-ERP.md`](./PROMPT-MODELO-VISUAL-AGRO-ERP.md) §11  
- Comandos: [`AGENTS.md`](../../AGENTS.md) — `npm run verify:all`
