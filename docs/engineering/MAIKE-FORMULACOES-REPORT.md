# MAIKE-FORMULACOES — Relatório

**Branch `claude/kind-knuth-tztu1v`** · Decisão: [D-PROD-202](./DECISIONS.md) ·
Runbook: [`MAIKE-FORMULACOES-RUNBOOK-RELEASE.md`](./MAIKE-FORMULACOES-RUNBOOK-RELEASE.md)

## 1. Entrega

| Camada | O que entrou |
|---|---|
| Banco | `CADFORMULACAO` (`Formulacao`), `CADFORMULACAOINGREDIENTE` (`FormulacaoIngrediente`) e `CADFORMULACAOREGRA` (`FormulacaoRegraCategoria`), por fazenda; migration **EXPAND** `20261114600000_cadformulacao` (SHA-256 `96f3f364…`), 5 CHECKs, FKs compostas pelo tenant, filhas da mesma fazenda com `CASCADE`, RLS/REVOKE |
| Release | manifesto e bloco RLS pinados; preflight de schema exige as 3 tabelas; runbook com caminhos A e B, ensaiado em banco local; testes do ferramental (B22a/b/k) e contagens 53 → 54 migrations e 84 → 87 tabelas (premerge, SQL Editor 01–04 e os ensaios das CONTRACT anteriores) |
| Backend | módulo `backend/src/modules/formulacoes/` (rotas, serviço, repositório): CRUD por fazenda, PATCH com troca das listas, DELETE recusado com 409 `FORMULACAO_EM_USO` quando um lançamento cita a formulação, `GET /formulacoes/opcoes-lancamento` (ativas) também pela chave do mapa `lancar_suplementacao`; códigos `FORMULACAO_NOT_FOUND`, `FORMULACAO_NAME_CONFLICT`, `FORMULACAO_EM_USO`; tela de permissão `pec-formulacoes` |
| Frontend | tela `Formulacoes` (menu Manejo; grade e formulário Base1 com regras por categoria e ingredientes em kg por batida, total e %); porta/API/service; lançamento do cocho com a **Formulação obrigatória** e o consumo esperado lote a lote (`consumoEsperadoPorFormulacao`) |
| Docs | D-PROD-202, este relatório, runbook, `CURRENT-STATE`, cobertura de endpoints da R2 |

## 2. Como a conta do lançamento funciona

- **%PV do lote:** a regra da Categoria de Manejo do lote na formulação, quando houver (não consome → 0; consome → o %PV da regra); senão o %PV padrão da formulação.
- **Esperado do lote (kg/dia)** = peso × %PV / 100 × cabeças. O peso é o da D-PROD-201: o projetado de hoje, senão o último peso. Lote **sem peso** usa a média ponderada dos lotes **com** peso, com o %PV da própria categoria.
- **Esperado do grupo** = Σ dos lotes. Exemplo do teste SF-2: 10 vacas × 450 kg × 0,15% = 6,75; 8 bezerros mamando = 0 (contados em `cabecas_nao_consomem`); 20 bois × 400 kg × 0,1% (padrão) = 8; 5 vacas sem peso × média 354,2 kg × 0,15% ≈ 2,66 → ≈ 17,41 kg/dia.
- O lançamento não lê mais `Produto.percentual_consumo_pv`. A baixa, os sacos e o nome exibido são os do produto da formulação.

## 3. Validação local

| Comando | Resultado |
|---|---|
| `node --test backend/tests/formulacaoNativo.test.mjs` (CRUD, formato, validações, forma pronto × batelada, referências da mesma fazenda, isolamento por tenant, exclusão bloqueada por lançamento, permissão da tela e das opções, CHECK e RLS) junto com `permissoesR2Rotas`, `sqlEditorBootstrap` e `curvaGanhoNativo` | 59/59 |
| ensaios das CONTRACT com a migration nova fora da partida e aplicada por último: `categoriaManejoCadcategoriaMigration` (20/20), `patrimonioSimplificaMigration` + `cadCurvaGanhoMensalMigration` (24/24), `cadCategoriaCurvaGanhoMigration` + `atividadeCabecalhoMigration` (38/38), `tipoAtividadeDefaultsMigration` (25/25) | todos verdes |
| `node --test scripts/tests/deploy/*.test.mjs` (premerge 108, preflight 10, migrations 56, alvo 6, bench 13) | 193/193 |
| `npx vitest run` dos smoke novos e alterados (`formulacoes` 14, `suplementacaoLancamentoBase` 10, `scope`/`vercelSpaRoutes` 25) e dos vizinhos (menu, permissões, suplementação, cocho: 17 arquivos, 280) | todos verdes |
| `npm run test:gates` | 921/921 |
| `gate:tenancy`, `gate:indices`, `gate:modelobase1-pecuario`, `gate:supabase-public-grants`, `gate:deploy-migrations`, `gate:native-api`, `gate:product-scope`, `gate:import-integrity`, `gate:base44`, `gate:source-closure`, `gate:api-boundary`, `gate:no-secrets`, `gate:types`, `typecheck:backend`, `lint` | PASSOU (lint: 0 erros; 2 avisos anteriores a esta missão) |
| ensaio do caminho B (§3 do runbook) em banco local com as 53 migrations | recusa com o sid de produção; aplica com o local (54 / 0, 87 tabelas, `migrate status` em dia, `migrate diff` vazio); 2ª execução recusada |

## 4. Verificação completa e revisão

_(preenchido ao fim da missão.)_
