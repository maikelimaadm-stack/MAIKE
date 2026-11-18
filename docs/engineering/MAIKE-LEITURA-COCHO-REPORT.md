# MAIKE-LEITURA-COCHO — Relatório

**Branch `claude/kind-knuth-tztu1v`** · Decisão: [D-PROD-205](./DECISIONS.md) ·
Runbook: [`MAIKE-LEITURA-COCHO-RUNBOOK-RELEASE.md`](./MAIKE-LEITURA-COCHO-RUNBOOK-RELEASE.md)

Etapa 3 de 4 da suplementação: a leitura de cocho feita no campo e o farol do cocho no mapa.

## 1. Entrega

| Camada | O que entrou |
|---|---|
| Banco | `LEITURACOCHO` (`LeituraCocho`), por fazenda: escore, acesso, estrutura (3 CHECKs), observação e quem registrou; FKs pelo tenant (Empresa Restrict, PontoSuplementacao **CASCADE**); migration **EXPAND** `20261115100000_leitura_cocho` (SHA-256 `f31cb0b8…`), RLS/REVOKE |
| Release | manifesto e bloco RLS pinados; preflight de schema exige `LEITURACOCHO.escore`; runbook com caminhos A e B, ensaiado em banco local (SQL pronto fora do repositório); testes do ferramental B24a/b/k (B23k passa a representar o dia das Formulações, sem a pasta nova) e contagens 55 → 56 migrations, 90 → 91 tabelas, 76 de tenant (premerge, SQL Editor 01–04 e os ensaios das migrations anteriores, onde a nova fica fora da partida e sobe por último) |
| Backend | módulo `backend/src/modules/leiturasCocho/` (rotas, serviço, repositório): `GET /leituras-cocho` autenticado, `POST` e `DELETE /:id` com a chave do mapa `lancar_suplementacao`; validação de fazenda, cocho (mesma fazenda, não depósito), data (não futura no fuso da fazenda) e valores; `registrado_por_nome` da conta; auditoria; código `LEITURA_COCHO_NOT_FOUND` |
| Frontend | porta/API/service `leituras-cocho` com fila offline; capacidade `leiturasCocho` no cache do mapa; domínio puro `leituraCocho.js` (farol e avisos); `FormularioLeituraCocho` (Base1: data, escore obrigatório em botões, acesso Bom/Ruim, estrutura Boa/Precisa de reparo/Quebrada, observação); no detalhe do cocho, botão **Leitura** e a seção "Leitura do cocho" (farol, quem leu, avisos, últimas 5 leituras com excluir); no marcador, ponto do farol e o texto no `aria-label` |
| Docs | D-PROD-205, este relatório, runbook, `CURRENT-STATE`, cobertura de endpoints da R2 |

## 2. Como o farol funciona

| Última leitura | Farol |
|---|---|
| Vazio | 🔴 vermelho — "Cocho vazio" (abastecer) |
| Adequado | 🟢 verde — "Cocho adequado" |
| Cheio | 🔵 azul — "Cocho cheio" (sobrando) |
| nenhuma, ou com mais de 2 dias | ⚪ cinza — "Sem leitura recente" |

- "Última" = a do dia mais recente; no mesmo dia, a registrada depois.
- Hoje, ontem e anteontem valem; a de 3 dias atrás já é cinza. O "hoje" é o da fazenda (`useDiaCivil`).
- Acesso ruim e estrutura "precisa de reparo"/"quebrada" viram aviso no detalhe e no texto do marcador, **sempre** pela última leitura, mesmo vencida, com a data.
- A leitura não mexe no estoque e não muda o nível estimado do cocho (D-PROD-178): o marcador continua mostrando o nível; o farol é o ponto colorido no canto de baixo.
- Depósito não tem leitura nem farol.

## 3. Validação local

| Comando | Resultado |
|---|---|
| `node --test backend/tests/leituraCochoNativo.test.mjs` (padrões, formato público, os 3 escores, filtros e ordem, validação, fuso da fazenda e reserva, cocho de outra fazenda/tenant/depósito, tenancy, exclusão e auditoria, permissão, sem estoque, CASCADE, CHECK) | 10/10 |
| `permissoesR2Rotas` (as 2 rotas de escrita novas sem concessão → 403) | 11/11 |
| ensaios das migrations anteriores com a nova fora da partida e aplicada por último: `atividadeLinhasMigration` 11, `atividadeCabecalhoMigration` 28, `cadCategoriaCurvaGanhoMigration` 10, `cadCurvaGanhoMensalMigration` 10, `categoriaManejoCadcategoriaMigration` 20, `patrimonioSimplificaMigration` 14, `tipoAtividadeDefaultsMigration` 25; `sqlEditorBootstrap`, `sqlEditorPreservaMaike`, `alvoMigrationDuplaConexao`, `estoqueP1M7TransacaoMigration`, `tipoTarefaDropColunasMigration` 47 | todos verdes |
| `node --test scripts/tests/deploy/*.test.mjs` | 199/199 |
| `npx vitest run tests/smoke/leituraCocho.test.jsx` (farol puro, formulário, porta, detalhe) e `mapaMarcadorNivelSuplementacao` (farol no marcador) | 12/12 e 9/9 |
| `npx vitest run` dos 64 arquivos de smoke do mapa/cache/cocho | todos verdes |
| Ensaio do caminho B (banco à parte com as 55 da `main`) | alvo divergente recusado; aplicou 55 → 56, 91 tabelas, RLS sem FORCE; `migrate status` em dia; `migrate diff` vazio; reexecução recusada |
| `npm run verify:all` | ver §5 |
| Produção | migration aplicada em 2026-11-15 15:20:55 UTC (caminho B, runbook §7): 56 / 0, 91 tabelas |

## 4. Limites conhecidos

- A leitura offline entra na fila como as outras criações offline: se a rede cair depois de o servidor gravar e antes da resposta, o replay pode criar a leitura de novo (o mesmo comportamento das outras entidades da fila). Excluir a repetida resolve.
- Sem fuso configurado na fazenda, o servidor usa `America/Sao_Paulo` para decidir "hoje" (a leitura não é fato do rebanho, então não bloqueia como os manejos).
- A lista do mapa traz todas as leituras do tenant (como os eventos de suplementação); com o tempo, vale paginar por período.
- A etapa 4 (fechamento de consumo em %PV com faixa configurável e custo por cab/dia) não usa a leitura ainda.

## 5. verify:all

Local, PostgreSQL 16, com `DATABASE_URL` e `AUTH_SECRET` exportados. O `verify:all` inteiro passou de 30 min com a suíte de backend completa num processo só (o CI a divide em 4 shards); as etapas foram então conferidas assim:

| Etapa | Resultado |
|---|---|
| `test:gates` (927 testes) e todos os gates estáticos, `prisma:generate`, `types` (547 ≤ teto 625), `lint` (0 erros) | PASSOU no `verify:all` |
| `typecheck:backend` | falhou no 1º `verify:all` (tipo JSDoc do `contexto` no serviço novo); corrigido e PASSOU |
| `test:backend` | PASSOU: 2082 testes, 2077 aprovados, 0 falhas |
| `test:smoke` | PASSOU: 240 arquivos, 2929 testes |
| `build`, `build:admin`, `admin-isolation:bundles` | PASSOU |
