# MOTORBASE1 — Matriz de paridade Marcas ↔ Unidades (D1–D9)

Referência: Marcas na main pós PR #111. Destino: `useCadastroBase1Controller` + `CadastroBase1Screen`.

| ID | Recurso | Marcas (ref.) | Unidades (antes #112) | Destino motor | Exceção domínio | Testes | Status |
|---|---|---|---|---|---|---|---|
| D1 | Shell / toolbar / segmentos | Base1 lista integrada | Preset visual só | `CadastroBase1Screen` + preset | Títulos/labels por adapter | smoke rollout, parity | PASS |
| D2 | Grade seleção | ~~`colunaSelecao={false}`~~ **PR #120:** checkbox global via `BASE1_GRADE_REFERENCE_HEADERS` | Checkbox coluna implícita | Preset SSOT + adapters sem override | — | `motorbase1GlobalSelectionTitle` | PASS |
| D3 | Busca / sugestões / pick | searchPickId + clear completo | Filtro local + clear parcial | Controller compartilhado | Campos haystack no adapter | controller unit | PASS |
| D4 | Registro read/edit | Toolbar Salvar/Cancelar | Form inline + sempre edit | Controller + Form Base1 | — | controller unit | PASS |
| D5 | Formulário | `FormularioMarca` B1 | Card/Input legado | `FormularioUnidadeMedida` | sigla/descrição/ativo | parity test | PASS |
| D6 | Cards | prefs + código/título | prefs ok | Mesmas props grade | título=descricao código=sigla | rollout | PASS |
| D7 | Paginação | keyset `/marcas` | full fetch array | `GET /unidades-medida/page` + infinite list | GET array legado intacto | backend BE-P45-04+ | PASS |
| D8 | Export / delete | aviso janela + falhas parciais | export full list | Controller export + guards adapter | bloqueio sigla só Unidades | service existente | PASS |
| D9 | Tenant / keys | empresa_id JWT | tenant JWT | queryKey inalterados storage keys | — | backend tenant tests | PASS |

Storage keys congelados: `colunas_marcas_v1`, `colunas_unidades_medida`, droppable `colunas-unidades-medida`.

Homologação visual produção: **PENDING** (sem deploy autenticado neste ambiente).
