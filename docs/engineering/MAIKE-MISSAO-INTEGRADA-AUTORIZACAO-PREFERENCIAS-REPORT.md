# MAIKE — Missão integrada: autorização real e preferências do Mapa Geral (D-PROD-137)

## 1. Pedido do proprietário

Uma missão só, com quatro frentes de código e uma de documentação:

- corrigir as **permissões reais**: o que o servidor deixa gravar e ler, e não só o que a tela mostra;
- corrigir as **preferências do mapa** e estabilizar o Mapa Geral;
- provar cada correção com **RED → GREEN**:
  - backend em PostgreSQL 16, lendo o banco depois da requisição;
  - frontend em RTL, com o `MapaGeral` montado de verdade;
- entregar a **matriz atualizada**, inclusive dos GET;
- manter as preferências por **tenant + login + empresa** e preservar Visualização, `estiloPasto` e `mapType`.

Restrições seguidas por todas as frentes:
- sem migration;
- sem `schema.prisma` e sem `prisma generate`;
- sem `npm install`;
- sem rede externa, Supabase, Vercel ou produção.

## 2. Base, branch e commits

Branch: `claude/autorizacao-preferencias-integradas`.

| Parte | Frente | Commit | Merge |
|---|---|---|---|
| 1 | M1 — escrita aninhada (F1–F3, F5, F7) | `6b231236` + trava estática `67eb76dd` | `main` pela PR #205 (`5d0df0d9`) |
| 2 | M3 — leituras administrativas e cadastros por tela cruzada | `278a231b` | `41650060` |
| 2 | M4b — preferência × permissão no mapa, cache de ícones por tenant | `71887a77` | `4936ece5` |
| 2 | M2 — `/referencias/sincronizar` | `c257cdab` | `81180ab5` |
| 2 | M4a — bebedouro e suplementação | `05d08839` | `1e2b9fc5` |
| 2 | M5 — documentação (este relatório) | — | — |

Cada frente partiu de `6b231236`. Os arquivos compartilhados (`guardasRotas.js`, `MapaGeral.jsx` e `Layout.jsx`) receberam mudanças mínimas, listadas por frente na §6.

**Numeração.** As frentes escreveram "D-PROD-136" nos comentários e nos testes, mas a D-PROD-136 do registro já é a tela de entrada ("Manter conectado", PR #204).
- Esta missão é a **D-PROD-137**.
- Corrigido no código: as linhas com "D-PROD-136" introduzidas pelos commits da missão (6b231236, 278a231b, 71887a77, c257cdab, 05d08839; atribuição por `git blame`) passaram a dizer D-PROD-137, em 64 arquivos.
- Os arquivos restantes com "D-PROD-136" são da tela de entrada e não mudaram: `AGENTS.md`, `README_AI.md`, `.env.example`, `authRoutes.js`, `authService.js`, `env.js`, `foundation.test.mjs`, os gates `native-api`, `nativeSessionApi.js`, `NativeLoginForm.jsx`, `nativeTokenStorage.js`, `loginTela.test.jsx`, `sessaoNativa.test.js` e os documentos de deploy e UX.

## 3. A regra, em cinco linhas

1. O corpo só grava **colunas do próprio registro**. Relação aninhada do Prisma, `cliente` e `cliente_id` → 400.
2. Valores derivados de outra entidade são **relidos no banco** e casados por **id**, nunca pelo que o corpo diz.
3. Cada leitura entrega **o que a tela de quem pede usa**. Mapa: só por tenant. Administração e dados pessoais: guarda ou projeção.
4. A interface mostra um botão **só quando o servidor aceita** a ação, e a recusa do servidor vira mensagem.
5. A permissão decide **o que aparece**, nunca reescreve **o que o usuário escolheu**.

## 4. Achados × status

Severidade: a do diagnóstico; entre parênteses, a do verificador quando diferente.

| Id | Severidade | Status | Contrato novo | Teste que prova | RED → GREEN |
|---|---|---|---|---|---|
| F1 | bloqueador | corrigido (M1) | corpo só com colunas escalares do model (allowlist de `Prisma.dmmf`); relação → 400, nada gravado | `backend/tests/autorizacaoIntegradaBloqueadores.test.mjs` › F1 | RED: 200, conta promovida a administrador → GREEN: 400, papel intacto |
| F2 | bloqueador | corrigido (M1) | idem; `catalogoCategoriaVisual` não é gravável pelo tenant | › F2 | RED → GREEN: 400, catálogo intacto |
| F3 | bloqueador | corrigido (M1) | `cliente`/`cliente_id` recusados no `preValidation` global (no topo e em item de lista) | › F3 | RED → GREEN: 400; fazenda ativa e no tenant |
| F4 / REF-01 | alto (bloqueador) / bloqueador | corrigido (M2) | o corpo só identifica a origem (`event.entity_name` e `data.id`); a origem é relida (`FOR SHARE`); dependentes só por id; origem inexistente → 404 | `backend/tests/referenciasSincronizarIntegrada.test.mjs` › REF-01/F4 (8 testes) | todos RED → GREEN |
| F5 | médio (bloqueador) | corrigido (M1) | lote de nota: saldo, custo e as demais colunas só do administrador real, relido na transação; `is_admin` → 403 `TENANT_ADMIN_REQUIRED` | › F5/F7 | RED → GREEN (os 2 controles passam nos dois lados) |
| F6 | médio (alto) | corrigido (M3), com resíduo (§9) | `PATCH /locais-estoque` pelo Mapa Cadastro: só `nome`/`descricao`, e só no local de um DEPÓSITO do banco; `DELETE` só pela tela Locais | `backend/tests/leiturasCadastrosIntegrada.test.mjs` › F6 (L-01..L-04) | L-01..L-03 RED → GREEN; L-04 é controle |
| F7 | baixo | corrigido (M1) | `local_estoque_nome` conferido com o `LocalEstoque` vinculado → 422 `NOME_LOCAL_DIVERGENTE` | › F5/F7 | RED → GREEN |
| F8 | baixo | corrigido (M3) | sem acesso total: anexo só em `Lote` existente no tenant (404 `ATTACHMENT_OWNER_INVALID`); exclusão só de anexo de Lote | › F8 (A-01, A-02) | A-01 RED → GREEN; A-02 é controle |
| REF-02 | médio | corrigido (M2) | uma transação, um evento `propagar_referencias` no `AuditLog`, merge JSON atômico; idempotente | › REF-02 e "Setor: caches defasados…" | RED → GREEN |
| REF-03 | médio | corrigido (M2) | renomear setor só alcança tarefas cuja área é do setor; nenhum casamento por nome | › REF-03 | RED → GREEN |
| EMP-01 | médio | corrigido (M3), com resíduo (§9) | `DELETE /empresas/:id` com qualquer dependente → 409 `EMPRESA_COM_VINCULOS` + `details.vinculos`; nada apagado | › EMP-01 (D-01..D-03); `tests/smoke/leiturasCadastrosM3.test.js` | D-01, D-02 RED → GREEN; D-03 é controle |
| TAR-01 | baixo | corrigido (M3) | histórico de tarefa: empresa, título e status da tarefa relida | › TAR-01 (T-01) | RED → GREEN |
| USR-01 | baixo | corrigido (M3) | `GET /permissoes` sem acesso total → só a própria linha | › U-01; U-10 ajustado | RED → GREEN |
| GET-01 | alto | corrigido (M3) | `GET /empresas` sem a tela Empresa → resumo, sem CPF, RG, IE, contato, endereço, CEP e observações | › GET-01 (E-01..E-03) | E-01, E-03 RED → GREEN; E-02 é controle |
| GET-02 | alto (médio) | corrigido (M3) | `GET /usuarios/page` só do administrador real; `GET /usuarios` com projeção conforme quem pede | › U-01..U-03 | RED → GREEN |
| GET-03 | médio | **refutado** | o login e o nome já vinham de `/usuarios` por desenho; a exposição foi fechada pelo USR-01 | — | — |
| GET-04 | médio | corrigido (M3) | `GET /fornecedores` só com Cadastro de Lotes `visualizar` ou acesso total; CPF mascarado | › GET-04 (F-01..F-03) | F-01, F-02 RED → GREEN; F-03 é controle |
| GET-05 | baixo (médio) | corrigido (M3) | `responsavel_elegivel` calculado no servidor (`telaPermite`), só para quem tem acesso total | › U-02; `leiturasCadastrosM3.test.js` | RED → GREEN |
| GET-06 | baixo | corrigido (M4b), com resíduo (§9) | ícones e permissões do mapa no cache `cli:<tenant>`; sem tenant, nada é lido nem gravado; o logout apaga o cache do tenant e o legado | `tests/smoke/mapaCacheIconesTenant.test.js` | 5 RED → GREEN; 1 controle |
| BEB-01 | alto | corrigido (M4a) | "Lançar"/"Excluir" só com a concessão que o servidor aceita (`src/lib/bebedouroPermissions.js`); recusa → mensagem | `tests/smoke/bebedouroMapaPermissoes.test.jsx` (MapaGeral real); matriz HTTP em `backend/tests/bebedouroHistoricoIntegrado.test.mjs` | RED → GREEN |
| BEB-02 | baixo | corrigido (M4a) | `DELETE` só do lançamento mais recente do bebedouro (409 `BEBEDOUROHISTORICO_SOMENTE_ULTIMO`), só com Bebedouros `excluir` | › BEB-02 (8 testes) | 5 RED → GREEN; 3 passam nos dois lados (outro bebedouro, controle positivo, órfão legado) |
| BEB-03 | baixo (médio) | corrigido (M4a) | `POST` exige `bebedouro_id` do tenant e da empresa (400/404); o nome vem do cadastro | › BEB-03 (5 testes); UI em `bebedouroMapaPermissoes.test.jsx` | 4 RED → GREEN; 1 controle |
| BEB-04 | baixo | corrigido (M4a) | na tela Bebedouros, os botões do histórico seguem a regra do servidor e saem da heurística do Layout (`data-permissao-explicita`) | `tests/smoke/bebedourosTelaParidade.test.jsx` (Layout real) | 3/3 RED → 3/3 GREEN |
| SUP-01 | médio | corrigido no navegador (M4a); **não atômico no servidor** (§9) | o passo do consumo só calcula; o fechamento é gravado depois da transferência confirmada; se falhar depois → `toast.warning` | `tests/smoke/movimentacaoFechamentoAposTransferencia.test.jsx` | 7 RED → 7/7 GREEN |
| SUP-02 | baixo | corrigido (M4a) | "Aproveitar sobra" só preenche o formulário: `toast.info`, sem sucesso falso | `tests/smoke/sobraHerdadaSemFalsoSucesso.test.jsx` | RED (`toast.success` 1×) → GREEN |
| PREF-01 | médio | **refutado** (já resolvido na PR #201, D-PROD-135) | `estiloPasto` na preferência do escopo | — | — |
| PREF-02 | médio | corrigido (M4b) | sem "Ver filtros e camadas", os campos do painel usam o PADRÃO; sem colorir, a cor é a padrão; a preferência fica intacta | `tests/smoke/mapaPreferenciasIntegrada.test.jsx` › PREF-02 | 4 RED → GREEN; 2 controles |
| PREF-03 | baixo | **intencional** (commit `9baa30f7`) | o mapa abre em Satélite | — | — |
| PREF-04 | baixo | corrigido (M4b) | Mover, Localizar e a chave Tarefas só com a permissão que os faz funcionar | › PREF-04 | 1 RED → GREEN; 2 controles |
| PREF-05 | baixo | **refutado** | a vista salva por empresa é o desenho documentado | — | — |
| PREF-06 | baixo | corrigido (M4b) | a vista só é gravada depois de enquadrar a empresa atual | › PREF-06 | RED → GREEN |
| PREF-07 | baixo | corrigido (M4b) | a resposta do GPS só liga a localização no escopo em que foi pedida | › PREF-07 | 1 RED → GREEN; 1 controle |
| PREF-08 | baixo | resolvido (renumeração da D-PROD-135) | — | — | — |

Achado adjacente (M4a, fora da lista):
- **O que acontecia:** `initialData: []` com `staleTime` em `useBebedouros` e `useBebedouroHistorico` fazia a tela Bebedouros e o histórico do mapa abrirem vazios no primeiro minuto. Sem isso, o "Excluir" do mais recente nem aparecia.
- **Correção:** `placeholderData: []`, duas linhas.
- **Reversível:** dá para separar numa missão própria, mas os testes de BEB-01 "Excluir" e de BEB-04 deixariam de alcançar o botão.

## 5. Contratos alterados de propósito e testes ajustados

Cada quebra é deliberada. Os testes existentes afetados foram ajustados com um comentário explicando o contrato novo. Nenhum teste foi pulado, apagado ou afrouxado.

| Contrato | Antes | Agora | Teste existente ajustado |
|---|---|---|---|
| `GET /usuarios` e `GET /permissoes` | qualquer conta via login e nome de todos os colegas | sem acesso total, só a própria conta e linha; `is_admin` vê só contas ativas, sem papel, e das outras linhas só id e nome | `backend/tests/usuariosAutorizacaoTenant.test.mjs` U-10: a prova de que a matriz alheia nunca é exposta passou para a concessão `is_admin` |
| `GET /usuarios/page` | qualquer conta | só o administrador real | — (contrato novo: U-01..U-03) |
| Mapa Geral "excluir" no histórico de bebedouro | excluía qualquer lançamento | **não exclui mais**; só Bebedouros `excluir`, e só o último | — (o teste de rotas não cobria o caso; contrato novo em BEB-02) |
| `/referencias/sincronizar` | gravava os valores de `data`/`old_data` | ignora `data`, `old_data` e `changed_fields`. A resposta perdeu `halted_due_to_rate_limit`, `pending_count` e `results`, que ninguém lia (conferido com grep em `src/` e `tests/`) | — (`permissoesR3` continua verde sem mudança) |
| `GET /empresas` | registro completo a qualquer conta | resumo sem dados pessoais, para quem não tem a tela Empresa | — |
| `GET /fornecedores` | qualquer conta, com dados pessoais | Cadastro de Lotes `visualizar` ou acesso total; CPF mascarado | — |
| `DELETE /empresas/:id` | 204 deixando órfãos, ou 403 `TENANT_SCOPE_VIOLATION` com fato do rebanho | 409 `EMPRESA_COM_VINCULOS`, nada apagado | — |
| `POST /bebedouros-historico` | aceitava documento sem `bebedouro_id` (órfão) | exige `bebedouro_id` do tenant e da empresa | `backend/tests/documentoJsonEmpresaContrato.test.mjs`: cria um Bebedouro e o envia só para essa rota (`extrasDaRota`) |
| `DELETE /bebedouros-historico/:id` | qualquer lançamento | só o mais recente do bebedouro | — |
| `DELETE /locais-estoque/:id` pelo Mapa Cadastro | 409 `deposito_do_mapa`, que a cascata já contava como "ignorado" | 403, contado igual | — |
| Cache dos ícones e permissões do mapa | `__GLOBAL__`, sem dono e não limpo no logout | `cli:<tenant>`, limpo no logout | `tests/smoke/mapaCache.test.js` C11 e C13; `tests/smoke/mapaGeral.test.js` MG5/MG6; `tests/smoke/permissoesPontaAPonta.test.jsx` (o mock ganhou `esquecerCacheDoTenant`, sem mudar nenhuma asserção) |
| Códigos de bebedouro fora do catálogo | `BEBEDOURO_NOT_FOUND` e `BEBEDOUROHISTORICO_NOT_FOUND` viravam 500 | 404 | — |

Preferências (pedido do proprietário):
- **Chave:** continua `mapa_geral_filtros_u:<cliente>:<login>:<empresa>` (D-PROD-135). Nenhuma frente mudou a chave.
- **Gravação:** grava só a escolha do usuário (`pref*`), nunca o valor aplicado.
- **Mantidos como estavam:**
  - **Visualização** e `estiloPasto`, que seguem na preferência do escopo;
  - `mapType`, que abre em Satélite por decisão do commit `9baa30f7`;
  - `showUserLocation` e `dragLotesEnabled`, que têm botão e permissão próprios.

## 6. Arquivos tocados por frente

**M1 (parte 1, PR #205)**
- `backend/src/shared/prisma/colunasGravaveis.js` (novo)
- `backend/src/app.js`
- services:
  - `backend/src/modules/pontosSuplementacao/pontoSuplementacaoService.js`
  - `backend/src/modules/bebedouros/bebedouroService.js`
  - `backend/src/modules/categoriasManejo/categoriaManejoService.js`
  - `backend/src/modules/estoqueLotesNota/estoqueLoteNotaService.js`
  - `backend/src/modules/fornecedores/fornecedorService.js`
  - `backend/src/modules/permissoes/permissaoService.js`
  - `backend/src/modules/movimentacoesEstoque/movimentacaoEstoqueService.js`
- `backend/tests/autorizacaoIntegradaBloqueadores.test.mjs` (novo)

**M2**
- `backend/src/modules/referencias/syncEntityReferencesService.js` (reescrito)
- `backend/src/modules/referencias/propagationRules.js` (reescrito)
- `backend/src/modules/referencias/referenciasRoutes.js`
- `backend/src/modules/referencias/propagacaoPorChaveUnica.js` (novo)
- `backend/src/modules/produtos/produtoService.js`
- `backend/src/modules/setores/setorService.js`
- `backend/src/modules/lancamentosTarefa/lancamentoTarefaRepository.js`
- `backend/tests/referenciasSincronizarIntegrada.test.mjs` (novo)

**M3**
- Backend:
  - `backend/src/modules/empresas/empresaService.js`
  - `backend/src/modules/usuarios/usuarioRoutes.js`, `usuarioService.js` e `usuarioRepository.js`
  - `backend/src/modules/permissoes/permissaoService.js`
  - `backend/src/modules/fornecedores/fornecedorRoutes.js` e `fornecedorService.js`
  - `backend/src/modules/registrosAnexo/registroAnexoService.js`
  - `backend/src/modules/lancamentosTarefa/lancamentoTarefaService.js`
  - `backend/src/shared/errors/errorCodes.js`
  - `backend/src/shared/auth/guardasRotas.js` (compartilhado: só `localEstoqueEditar` e a linha `localEstoque`)
- Testes do backend:
  - `backend/tests/leiturasCadastrosIntegrada.test.mjs` (novo)
  - `backend/tests/usuariosAutorizacaoTenant.test.mjs` (U-10)
- Frontend:
  - `src/apis/_core/ApiError.js` e `src/apis/_core/nativeHttpClient.js`
  - `src/services/empresaService.js` e `src/pages/Empresa.jsx`
  - `src/apis/usuarios/usuarioNativePort.js`
  - `src/components/mapa/FormularioTarefaMapa.jsx`
  - `src/components/mapa/FormularioPonto.jsx`
- Smoke: `tests/smoke/leiturasCadastrosM3.test.js` (novo)

**M4a**
- Backend:
  - `backend/src/modules/bebedourosHistorico/bebedouroHistoricoService.js` e `bebedouroHistoricoRepository.js`
  - `backend/src/shared/errors/errorCodes.js`
  - `backend/src/shared/auth/guardasRotas.js` (compartilhado: só `bebedouroHistorico.excluir` e comentários)
- Testes do backend:
  - `backend/tests/bebedouroHistoricoIntegrado.test.mjs` (novo)
  - `backend/tests/documentoJsonEmpresaContrato.test.mjs`
- Frontend:
  - `src/lib/bebedouroPermissions.js` (novo)
  - `src/pages/MapaGeral.jsx` (compartilhado: import, dois memos e props do `DetalhesBebedouro`)
  - `src/pages/Bebedouros.jsx`
  - `src/Layout.jsx` (compartilhado: uma linha e um comentário)
  - `src/components/bebedouros/DetalhesBebedouro.jsx`, `BebedouroTimeline.jsx` e `FormularioLancamentoBebedouro.jsx`
  - `src/hooks/useBebedouros.js` e `src/hooks/useBebedouroHistorico.js`
  - `src/services/suplementacaoService.js`
  - `src/components/lotes/FormularioMovimentacaoLote.jsx`
  - `src/components/mapa/DetalhesLote.jsx`
  - `src/components/suplementacao/FormularioLancamentoSuplementacao.jsx` e `SobraHerdadaDialog.jsx`
- Smoke (novos):
  - `tests/smoke/bebedouroMapaPermissoes.test.jsx`
  - `tests/smoke/bebedourosTelaParidade.test.jsx`
  - `tests/smoke/movimentacaoFechamentoAposTransferencia.test.jsx`
  - `tests/smoke/sobraHerdadaSemFalsoSucesso.test.jsx`

**M4b**
- Frontend:
  - `src/pages/MapaGeral.jsx` (compartilhado: derivação, gravação, vista, Localizar e props)
  - `src/lib/mapaGeralFiltrosStorage.js`
  - `src/components/mapa/MapaControlesMobile.jsx`
  - `src/services/mapaCacheService.js` e `src/services/sessionService.js`
  - `src/components/offline/IndexedDBManager.jsx`
  - `src/components/mapa/DetalhesTarefaMapa.jsx` e `DetalhesPontoSuplementacao.jsx`
- Smoke novos: `tests/smoke/mapaPreferenciasIntegrada.test.jsx` e `tests/smoke/mapaCacheIconesTenant.test.js`
- Smoke ajustados: `tests/smoke/mapaCache.test.js`, `tests/smoke/mapaGeral.test.js` e `tests/smoke/permissoesPontaAPonta.test.jsx`

**M5 (esta frente, só documentação)**
- `docs/engineering/DECISIONS.md`: D-PROD-137, mais notas na D-PROD-49, D-PROD-71 (§3 e §4) e D-PROD-135.
- `docs/engineering/MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md`: leituras, matriz e tabela rota → guarda.
- `docs/engineering/MAIKE-PERMISSOES-PONTA-A-PONTA-REPORT.md`: notas na §7, §9.3, §9.4, §10.3 e §11.2.
- `docs/engineering/CURRENT-STATE.md`.
- Este relatório.

## 7. Verificação (números das saídas de cada frente)

**Backend:** PostgreSQL 16 local e descartável, um banco por frente, com `node --test --test-concurrency=1`.

| Frente | Teste novo | RED (código sem a correção) | GREEN | Suíte backend completa da frente |
|---|---|---|---|---|
| M1 | `autorizacaoIntegradaBloqueadores` | na `main` `7434e29b`: 11 de 13 falham (os 2 que passam são controles do F5); trava estática: 1 de 1 falha | 14/14 | 944 testes, 939 passam, 0 falhas, 5 `todo` (ledger, já existentes) |
| M2 | `referenciasSincronizarIntegrada` | 14 de 17 falham. Os 3 que passam são controles de não regressão: Lote (UI), TipoTarefa (UI) e o produto com falha fechada | 17/17 | 961 testes, 956 passam, 0 falhas, 5 `todo` |
| M3 | `leiturasCadastrosIntegrada` | 15 de 20 falham. Os 5 que passam são controles: E-02, F-03, L-04, A-02 e D-03 | 20/20 | 80 arquivos, 959 passam, 0 falhas |
| M4a | `bebedouroHistoricoIntegrado` | 10 de 14 falham | 14/14 | Não houve rodada completa. Relacionados: 97/97; extras: 114/114 |

**Rodada integrada do orquestrador** no HEAD `1e2b9fc5`, suíte backend completa: 998 testes, 993 passam, 0 falhas, 5 `todo`.

**Frontend** (vitest, jsdom):

| Frente | Testes novos | RED | GREEN | Smoke completo da frente |
|---|---|---|---|---|
| M3 | `leiturasCadastrosM3` (4) | estrutural: as funções não existiam e o campo era descartado | 4/4 | 128 arquivos, 1466 testes (antes do teste novo) |
| M4a | 4 arquivos (§4) | cada arquivo falha no código original (blocos de RED em `m4a-red*.txt`) | todos verdes (`movimentacaoFechamento…` 7/7, `bebedourosTelaParidade` 3/3) | 132 arquivos, 1484 testes |
| M4b | `mapaPreferenciasIntegrada` + `mapaCacheIconesTenant` (18) | 12 falham; 6 controles passam | 18/18; com os smokes de mapa, sessão e permissões: 41 arquivos, 538 testes | 130 arquivos, 1484 testes |

Gates rodados pelas frentes, todos aprovados:
- `gate:types`: sem regressão (893 ≤ teto);
- tenancy, indices, import-integrity, no-secrets, base44, product-scope, governance-paths, native-api, api-boundary, source-closure;
- `test:gates`: 686/686 (M4a).

Não rodados:
- `npm run test:backend`, porque o runner faz `prisma generate` e `migrate deploy`, proibidos nesta missão;
- o `verify:all` completo;
- a suíte smoke integrada no HEAD `1e2b9fc5`: não há saída dela anexada a este relatório.

## 8. Matriz atualizada

A matriz permissão → efeito → condição, a classificação dos GET e a tabela rota → guarda do HEAD `1e2b9fc5` estão em `MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md`, com "(D-PROD-137)" no que mudou.
- Contagem: 201 rotas · a 77 · b 2 · c 66 · d 54 · públicas 2 · e 0.
- Diferença da administração real para a concessão `is_admin`:
  - só o administrador real grava saldo e custo do lote de nota e lê `GET /usuarios/page`;
  - só ele vê contas inativas, papéis e a matriz das outras linhas;
  - `is_admin` continua com todas as telas, as tarefas do mapa e as leituras completas de `/empresas` e `/fornecedores`.

## 9. O que ainda não está pronto

Nada aqui é "100% protegido". É o que se sabe que falta, com o motivo de não ter sido feito.

### Autorização e leituras
1. **Leitura por URL dos GET MAPA_NECESSARIO.** Quem não tem a tela de um cadastro que o mapa usa (lotes, produtos, setores, estoque, movimentações…) ainda lê os registros da própria fazenda por chamada direta. É dado operacional. Fechar exige separar as consultas do mapa das leituras do cadastro.
2. **GET de cadastro, de tarefas e administrativos sem consumidor continuam só por tenant.**
   - Cadastro: `/categorias`, `/marcas`, `/unidades-medida`, `/locais-estoque`, `/produtos/page`, `/setores/page`, `/registros-anexo`, as elegibilidades do lote e `/bebedouros-sanidade`.
   - Tarefas: `/lancamentos-tarefa`, `/historicos-lancamento-tarefa`, `/tipos-tarefa` e `/grupos-atividade`.
   - Administrativos: `/rebanho/verificacao`, `/rebanho/saldos` e `/bebedouros-alertas`.
   - Atenção: se `GET /locais-estoque` ganhar guarda, o fallback legado do Mapa Cadastro (`listarTodosLocais`) precisa ser revisto.
3. **Caches offline são por tenant, não por login.**
   - A lista de empresas fica no IndexedDB por tenant. Num aparelho compartilhado, a lista completa que um administrador deixou pode ser lida offline por outra conta do mesmo tenant, até a próxima listagem online.
   - Ícones e permissões do mapa passaram para `cli:<tenant>` e saem no logout. Ainda assim ficam no aparelho quando a sessão termina sem logout (token vencido, aba fechada).
4. **F6: local forjado via ponto.** Quem tem Mapa Cadastro `editar` ainda pode apontar o `local_estoque_id` de um DEPÓSITO para qualquer local (a escrita é auditada) e depois renomear ou descrever esse local.
   - Alcança só nome e descrição: nunca ativo, capacidade ou exclusão.
   - Travar o vínculo quebraria o fluxo legado de reaproveitar local por nome e mexeria na guarda do ponto. Fica pendente de decisão.
5. **Login do tenant sem limitador de tentativas** (`POST /auth/login`).
6. **Revogação em voo fora da transação.** Uma requisição já em andamento quando a permissão é revogada pode concluir. Só as ações administrativas revalidam o papel dentro da transação (ver R2 §9.2).
7. **GET-04:** quem só tem `pec-lotes` não acha o fornecedor pelo CPF inteiro, só pelos 6 dígitos do meio. Foi decisão consciente.
8. **F8:**
   - Anexo em outras entidades fica só para o acesso total, sem conferir se o registro existe, porque não há mapa entidade → model.
   - Fora do escopo: o diálogo de anexos do Cadastro de Lotes envia `entity_name`/`record_id`/`file_url`, e o backend lê `entidade`/`entidade_id`/`storage_key`. O diálogo não funciona contra a API nativa.
9. **TAR-01:** `responsavel`, `evento`, `data_evento` e `descricao` do histórico de tarefa continuam vindo do corpo.
10. **EMP-01: corrida na criação concorrente.** Quem cria setor, área etc. não lê a Empresa com `FOR SHARE`. Um dependente inserido no mesmo instante da exclusão ainda pode escapar. A trava e a contagem cobrem o fluxo real da interface. `src/domain/deleteRules.js` (sem chamador) não foi mexido.

### Referências
11. **Registros legados só com `setor_nome`** não acompanham mais a renomeação do setor: lote ou cocho sem `setor_id`, movimento sem `setor_*_id`, `transferencia_origem/destino`. Não há vínculo verificável, e o nome não é único. Corrigir exige backfill de id, uma **migration** de dado.
12. **Tarefas sem área** também não acompanham a renomeação do setor, porque `LancamentoTarefa` não tem `setor_id`. A saída é coluna nova + backfill pela área, também uma **migration**.
13. **Propagação por id numa segunda requisição.** O front faz o PATCH e depois a sincronização. Se a segunda falhar, os caches ficam defasados até a próxima chamada, que é idempotente e converge.
    - O passo seguinte seria propagar dentro de cada PATCH (Lote, Setor, TipoTarefa, GrupoAtividade).
    - O "Renomear Lote" do Mapa Geral não chama a sincronização (já era assim antes).
14. **Produto por nome.** `PontoSuplementacao.produto_padrao` e o produto do manejo técnico não têm `produto_id`. Eles são propagados na transação do PATCH do produto, pela chave única (empresa, nome antigo).
    - A falha é fechada: se outro produto ainda responde pelo nome antigo, ou se o produto trocou de empresa, nada é propagado.
15. **Comportamento novo:** uma sincronização sem renomeação também corrige caches defasados por id. São as mesmas linhas e campos que a renomeação já reescrevia.
16. **`FOR SHARE` na origem:** um deadlock é improvável. Se ocorrer, vira erro 500 numa das transações, sem escrita parcial.

### Bebedouro e suplementação
17. **SUP-01 não é atômico no servidor.** Se a transferência é gravada e a rede cai antes do fechamento, o período continua aberto, com aviso explícito.
    - A correção definitiva é um comando de servidor que feche o período na mesma transação de `/rebanho/comandos/transferencia`.
    - A troca da área de saída descarta o fechamento calculado, mas não tem teste dedicado.
18. **`REBANHO_DATA_FUTURA` sem mensagem.** A recusa aparece como "Resultado desconhecido…": não está em `MENSAGENS_MANEJO_REBANHO`/`RECUSAS_DEFINITIVAS`, e `src/` não cita o código.
19. **`toast.warn` inexistente**, ainda no HEAD, em `src/components/suplementacao/FormularioLancamentoSuplementacao.jsx:523` e `:527`. O sonner só tem `toast.warning`.
    - Efeito: com o lançamento gravado e um problema no fechamento anterior, sai um TypeError, e a tela diz "Não foi possível registrar a suplementação" com o evento já gravado. É um falso fracasso.
20. **Quebra deliberada (BEB-02):** quem só tinha Mapa Geral `excluir` perde a exclusão de lançamento de bebedouro. A interface já esconde o botão. Para devolver, o administrador marca Bebedouros `excluir`.
21. **Lançar com Mapa Geral `salvar`** continua aceito (risco residual 9.4-2 da R2, mantido de propósito).
22. **BEB-02 sem lock:** a checagem e a exclusão estão na mesma transação. As corridas possíveis viram serializações válidas.
23. No Mapa Geral, o `DetalhesBebedouro` não tem "Voltar ao resumo" na aba Histórico. É questão de UX e já era assim.
24. Fora dos botões do histórico de bebedouro, a heurística de clique do Layout continua só como conveniência visual. Quem decide é o 403 do servidor.

### Preferências do mapa
25. **`estiloPasto` sem `podeColorir`:** o último estilo escolhido continua aplicado e o seletor fica oculto. Foi mantido por instrução, porque é só pintura.
26. **`showUserLocation` salvo como ligado** continua valendo sem o painel, mas o marcador só aparece depois de um "Minha localização".
    - Um `dragLotesEnabled: true` antigo não é apagado. Sem `mover_lotes`, não tem efeito.
27. **Vista não gravada sem coordenadas:** empresa com áreas, mas nenhuma com coordenadas, nunca é marcada como enquadrada, e a vista dela não é gravada.
    - "Tentar novamente" (`retryMapa`) não zera `firstFitDoneRef` (já era assim).
28. **GPS antes do escopo:** um pedido feito sem escopo pode ser respondido antes de o escopo hidratar. A hidratação repõe a preferência, e o marcador pode sumir até o próximo toque.
29. **Refresh de ícones em voo no logout:** um refresh de A em andamento termina depois e regrava em `cli:A`. São dados de A, e a chave é por tenant.
30. **Preferências só no aparelho** (localStorage, D-PROD-135). Sincronizar entre aparelhos exigiria gravar no servidor.

## 10. Revisão adversarial

PENDENTE — preenchido pelo orquestrador
