# MAIKE-AREA-CULTURA — Relatório

**Branch `claude/kind-knuth-tztu1v`** · Decisão: [D-PROD-216](./DECISIONS.md) ·
Runbook: [`MAIKE-AREA-CULTURA-RUNBOOK-RELEASE.md`](./MAIKE-AREA-CULTURA-RUNBOOK-RELEASE.md)

Segundo passo do Manejo de Pastagens: a Área do mapa aponta para a Cultura do cadastro
(D-PROD-215), e as pastagens atuais da fazenda passam a ser a cultura 001 (Marandu), uso
Pastagem. Alturas no pasto e no lote ficam para depois (pedido do proprietário).

## 1. Entrega

| Camada | O que entrou |
|---|---|
| Banco | `AreaPastagem.cultura_id` (VARCHAR(64), anulável), FK composta `(cliente_id, empresa_id, cultura_id) → CADCULTURAS(cliente_id, empresa_id, id)` `RESTRICT`, UNIQUE `CADCULTURAS(cliente_id, empresa_id, id)` e índice `(cliente_id, empresa_id, cultura_id)`. Migration **CONTRACT aditiva** `20261117000000_area_cultura` (SHA-256 `e7fd7ee6…8bdc`, guarda `e60b6bdc…3da6`). Nenhuma linha muda; nenhuma tabela nova |
| Por que CONTRACT | a allowlist EXPAND (D-PROD-107 R7) recusa UNIQUE em tabela antiga e FK de tabela antiga para tabela antiga (a CADCULTURAS já existe). Mesmo caminho da D-PROD-195 e da D-PROD-197: entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS` com a guarda e as 3 instruções pinadas; o índice passa pelo resto EXPAND. Nada é apagado |
| Release | manifesto e contrato pinados; preflight de schema exige `AreaPastagem.cultura_id`; testes do ferramental B32a/b/k (o B31k passa a ser "no dia da D-PROD-215"), B24 na barreira do runner, contagens 63 → 64; testes das migrations anteriores no padrão "no dia dela" (a D-PROD-216 sobe por último, com a decisão dela; onde uma CONTRACT antiga subia pelo runner do repositório, agora sobe pelo espelho até a D-PROD-215); ensaios D-PROD-162/187 e a impressão digital da D-PROD-162 sem os objetos novos; SQL Editor 01–04: AreaPastagem → CADCULTURAS → … → Empresa no fim (a conferência real das FKs) |
| Backend | áreas: `cultura_id` no POST/PATCH (corpo fechado), validado pelo tenant da sessão, pela fazenda da área, ativa na troca e o uso (Reserva/APP/Infraestrutura não têm cultura; mudar para esses desliga); `tipo_pastagem` derivado do nome da cultura (o enviado é ignorado enquanto ligada); leituras com `cultura_id` e `cultura {id, codigo, nome, tipo}`. Culturas: renomear reescreve a cópia nas áreas ligadas (evento de propagação); excluir ligada → 409 `CULTURA_EM_USO` |
| Frontend | formulário da Área: campo **Cultura** com "001 · NOME" (ativas por código; a da área mesmo inativa); dica "Cultura anterior: …" na área antiga; sem a lista (sem `pec-culturas`/erro/vazia) a lista fixa de antes, e área ligada fica travada; grade do Cadastro de Áreas com o rótulo; lote de "tipo de cultura" ignora áreas ligadas; `pendenciasDaArea` aceita o nome da cultura quando há `cultura_id` |
| Dados | §4b do runbook: as 107 áreas não-infraestrutura → cultura 001, `Pastagem`, nome da cultura; DML guardado em uma transação, evento `backfill_cultura_area` na auditoria |

## 2. Validação local (PostgreSQL 16)

| Etapa | Resultado |
|---|---|
| Gates (`gate:*`, 30) e `lint` | todos ok (inclui `gate:tenancy`, `gate:indices`, `gate:types`, `gate:deploy-migrations`, `gate:product-scope`) |
| Testes novos | `backend/tests/areaCulturaNativa.test.mjs` 11/11; `tests/smoke/formularioAreaCultura.test.jsx` 8/8 |
| Testes de área/cultura existentes | áreas, importação, G4, culturas: verdes; smoke do formulário e do cadastro de áreas: verdes |
| Testes de migration (12 arquivos) | verdes depois do ajuste "no dia dela" |
| Ferramental de deploy (`scripts/tests/deploy`) | premerge 168/168, barreira do runner 83/83, preflight e alvo verdes |
| `test:backend` completo | ver o PR |
| Ensaio do caminho B e do vínculo | §3 e §4b do runbook: recusas certas, 63 → 64, `migrate diff` vazio, 107 ligadas, repetição recusada |

## 3. Pendências e notas

- GO escrito do proprietário para a migration (CONTRACT D-PROD-216) e para o vínculo, antes do merge.
- PR #303 (outra sessão, D-PROD-214) continua independente; se for aplicada antes, a guarda desta passa a 64.
- A importação de áreas por arquivo continua só com o texto (sem `cultura_id`).
