# MAIKE-TIPO-ATIVIDADE-CADASTRO — Relatório (Fatia B)

**fatia B · `feat/tipo-atividade-cadastro` · PR em rascunho (base `feat/tipo-tarefa-sem-flags`)** · Decisão: [D-PROD-181](./DECISIONS.md)

## 1. Entrega

O cadastro de Tipo de Atividade espelha o Tipo de Tarefa: mesmo grupo, mesma FK composta tenant-aware com `Restrict`, mesmo cache do nome do grupo, mesma unicidade de nome e mesma exclusão física. Não há flags de exigência.

| Camada | O que entrou |
|---|---|
| Banco | model `TipoAtividade`, relações inversas em `Cliente` e `GrupoAtividade`, migration EXPAND `20261113100000_tipo_atividade_cadastro` com RLS/REVOKE |
| Release | manifesto e hash do DO pinados no `premergeMigrateLib.mjs`; SQL editor 01–04 (65 tabelas de tenant, 80 no total); testes de contagem |
| Backend | módulo `tiposAtividade`, com lista, `GET /:id`, criação, `PATCH` (inclui ativo) e exclusão; tela `sup-tipos-atividade`; erros `TIPO_ATIVIDADE_*` |
| Grupo | a exclusão é bloqueada (409) quando há tipo de atividade; a renomeação propaga o cache, tanto no serviço quanto em `/referencias/sincronizar` |
| Frontend | porta `src/apis/atividades/tipoAtividadePort.js`, API pública, serviço, formulário de 4 campos (grupo ativo, nome, descrição, ativo), tabela, página, rota, menu, ícone mobile, `vercel.json` regenerado, códigos de erro, regra de exclusão do grupo |
| Gates | `gate-tarefa-cadastro-native` também confere o TipoAtividade, sem flags |

## 2. Como foi feito

1. **Mapeamento.** Quatro leitores em paralelo, um para cada área (banco, backend, frontend, testes), mais um crítico de completude.
2. **Construção.** Agentes com arquivos próprios, sem sobreposição:
   - B1: schema e migration;
   - B2: backend;
   - B3: frontend;
   - B4: testes.
3. **Integração.** Um agente integrador rodou as verificações sobre o resultado.
4. **Revisão.** Três revisores adversariais independentes: segurança e tenancy, correção e paridade, release e CI.

Achados da revisão e o que foi feito:
- **O formulário escondia o grupo atual quando ele estava inativo.** O campo aparecia como "SELECIONE", embora o registro continuasse gravado naquele grupo. Corrigido: o grupo atual continua na lista, marcado "(INATIVO)". Teste TA-FORM-2b: falha antes da correção e passa depois.
- **Faltava um teste de tela corrigido na Fatia A.** A Fatia B não tinha o commit `77d5fc9b` da Fatia A. Feito o merge da Fatia A.
- **`GET /:id` não existe no Tipo de Tarefa.** Fica, porque foi pedido pelo proprietário. Exige só autenticação, igual à lista, e é isolado por cliente. Registrado na D-PROD-181, item 3.

## 3. Validação local (PostgreSQL 16 descartável)

| Comando | Resultado |
|---|---|
| 10 arquivos de backend (tipoAtividadeNativo, tarefaCadastroNativo, lancamentoTarefaNativo, permissoesR2Rotas, permissoesR3, referenciasSincronizarIntegrada, patrimonioSimplificaMigration, sqlEditorBootstrap, sqlEditorPreservaMaike, leiturasCadastrosIntegrada) | 109/109 |
| `test:gates` | 739/739 |
| `test:smoke` | 2620/2621 antes do merge da Fatia A; o teste que faltava passa depois do merge |
| 29 gates do `verify:all`, um por um | todos passaram |
| `lint`, `gate:types` (625/625), `typecheck:backend` | passaram |
| `prisma migrate diff` (banco migrado × schema) | sem diferença |

O `verify:all` completo roda no CI da PR.

## 4. Release

1. A migration é EXPAND e não foi aplicada em nenhum banco remoto.
2. Ordem: merge da Fatia A (#254), depois desta.
3. Em seguida, `deploy:migrate` pelo caminho oficial e o deploy.
4. Até a tela `sup-tipos-atividade` ser liberada num perfil, só o administrador a vê.

## 5. Fora do escopo

- `ApontamentoAtividade`;
- `AbastecimentoBem` e `LancamentoTarefa`;
- flags de exigência;
- trabalho visual;
- o `DROP COLUMN` das 4 colunas dormentes do TipoTarefa, que fica numa fatia própria (`feat/tipo-tarefa-drop-colunas`) depois do deploy da #254.
