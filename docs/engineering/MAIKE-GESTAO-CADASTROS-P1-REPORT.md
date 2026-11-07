# MAIKE — Gestão P1: Parceiros, Centros de Custo/Resultado e vínculos (D-PROD-145)

Pedido do proprietário (`PROMPT_CLAUDE_MAIKE_GESTAO_CADASTROS_P1_VINCULACOES_2026-11-07.md`):
- **Cadastrar antes de lançar:** Parceiros, Centros de Custo e Centros de Resultado, com o vínculo entre os centros.
- **Sem financeiro:** nada de Naturezas Financeiras, lançamentos, compras, NF-e/XML ou contas a pagar.
- **Sem efeito em estoque ou mapa.**

Base: `main` `f7651772` (merge da PR #217), depois integrada com `main` `05dda652` (merge da PR #221, S04-P2). Ver §5.

## 1. O que existe agora

| Cadastro | Persistência | Rotas |
|---|---|---|
| Parceiros | model **`Fornecedor`** (mesma tabela, id e `numero_cadastro`) | `GET/POST /parceiros`, `GET/PATCH /parceiros/:id` |
| Centros de Custo | model novo `CentroCusto` | `GET/POST /centros-custo`, `GET/PATCH /centros-custo/:id`, `GET /centros-custo-opcoes/pais` |
| Centros de Resultado | model novo `CentroResultado` | `GET/POST /centros-resultado`, `GET/PATCH /centros-resultado/:id`, `GET /centros-resultado-opcoes/pais` |
| Vínculo N:N | model novo `CentroCustoResultado` | `GET/PUT /centros-custo/:id/centros-resultado`, `GET /centros-resultado/:id/centros-custo`, `GET /centros-custo-opcoes/centros-resultado` |

Código: `backend/src/modules/gestao/` (`gestaoComum.js`, `parceiroService.js`, `parceiroRoutes.js`, `centroService.js`, `centroRoutes.js`).

## 2. Parceiros sobre `Fornecedor`

- **Uma pessoa, um registro:** sem tabela `Parceiro`, então nada a sincronizar.
  - `Lote.fornecedor_id`, `EstoqueLoteNota.fornecedor_id` e `MovimentacaoEstoque.fornecedor_id` seguem válidos sem migration nessas tabelas.
  - A sequência de código é a mesma do Fornecedor.
- **Papéis (`tipos`):** `fornecedor`, `cliente`, `prestador_servico`, `transportador`, `outros`.
  - Aliases antigos (`Fornecedor`, `Transportadora`, `Prestador de serviço`...) são normalizados.
  - Valores antigos desconhecidos são **preservados** e devolvidos em `tipos_legados`.
  - Registro antigo com `tipos=[]` continua aparecendo no seletor de Lotes, e o filtro `papel=fornecedor` o inclui.
- **Documentos:**
  - Dígitos verificadores validados quando o CPF/CNPJ é novo ou muda. São gravados só com dígitos.
  - Documento novo duplicado na mesma empresa → 409 `PARCEIRO_DOCUMENTO_DUPLICADO`, sob trava (`pg_advisory_xact_lock`).
  - **Política de unicidade:** um documento por empresa, só para gravações novas. Duplicatas históricas não são alteradas nem recusadas na leitura.
  - Não há unique de banco: uma base real com duplicata histórica não o satisfaria.
- **Sem exclusão:** "Excluir" na tela = inativar, com confirmação. O registro e os vínculos históricos continuam resolvendo nomes.
- **PII:**
  - `GET /fornecedores` (Cadastro de Lotes) não muda: CPF mascarado e projeção restrita.
  - `/parceiros` exige a tela Parceiros.
  - A auditoria grava CPF mascarado, sem RG e sem data de nascimento.
- **Rotas antigas de escrita** de `/fornecedores` continuam só do administrador real, e a tela Parceiros não as abre.

## 3. Centros e vínculo

- **Árvore opcional:** FK composta `(cliente_id, empresa_id, pai_id)` → `(cliente_id, empresa_id, id)`. O pai é do mesmo tipo, tenant e empresa **pelo banco**, e um `CHECK` barra a autorreferência.
- **Regras no serviço**, sob trava por empresa:
  - sem ciclo;
  - pai ativo;
  - profundidade máxima 5;
  - nome único por empresa, em maiúsculas, com o unique do banco como última barreira (corrida → 409);
  - código pela `EntidadeCodigoSequencia`.
- **Sem exclusão física:**
  - inativar com filho ativo → 409 `CENTRO_COM_FILHOS_ATIVOS`;
  - reativar com pai inativo → 409.
- **Vínculo:**
  - FKs compostas nos dois lados e unique do par.
  - `PUT` substitui o conjunto e é idempotente: o mesmo conjunto não grava nem audita. Roda em transação, com AuditLog `definir_vinculos`.
  - Par novo exige os dois centros ativos (409 `CENTRO_INATIVO`). Pares existentes ficam se um lado for inativado.
  - Não gera lançamento nem atribui custo.

## 4. Autorização e tenancy

- **Telas:** `ges-parceiros`, `ges-centros-custo` e `ges-centros-resultado`, no módulo `gestao-rural`, independentes.
  - Sem linha de Permissão → negado; admin real e `is_admin` passam, como nas demais telas.
  - visualizar = ler; novo/salvar = criar; editar/salvar = editar, inativar, reativar e vincular.
  - Nenhuma rota nova usa `semTela` ou só autenticação.
- **Tenant e empresa:**
  - O tenant vem só da sessão.
  - `empresa_id` é obrigatório em toda leitura e escrita e validado no banco.
  - O fallback do navegador (`clienteId` no lugar da empresa) recebe 404 `EMPRESA_NOT_FOUND`.
  - No PATCH, `empresa_id` é escopo, não muda o registro. Outro tenant ou outra empresa → 404, sem revelar existência.
- **Corpo e query fechados** (`additionalProperties: false`), com DTO explícito.
  - Recusados: `id`, `cliente_id`, `numero_cadastro`, `tipos` direto, relação aninhada e campo desconhecido.
  - Também recusados: HTML, caractere de controle e texto mal formado.

## 5. Migration

- **Arquivo:** `20261107300000_gestao_p1_centros_custo_resultado`, **expand-only**: 3 `CREATE TABLE`, índices e uniques, FKs compostas `ON DELETE RESTRICT`, 2 `CHECK` e bloco de RLS/REVOKE no padrão.
- **Nenhuma tabela existente é alterada.**
- **Pré-merge:** o classificador de `scripts/deploy/premergeMigrateLib.mjs` dá `expand: true`, sem violações.
  - SHA `e29855b2…cecf5` pinado em `MIGRATIONS_APROVADAS`.
  - Corpo do DO `62795ad4…2aa3` em `DO_RLS_APROVADOS`.
- **Validação local:** aplicada só em PostgreSQL 16 local descartável; `prisma migrate diff` banco × schema dá vazio.
- **Integração com #221 (já na `main`):** os conflitos ficaram em `DECISIONS.md`, `MIGRATIONS_APROVADAS` e no teste B1 do pré-merge, e foram resolvidos mantendo as duas entradas. Agora B1 espera as três tabelas novas e `Usuario.troca_senha_pendente`. Não há mudança de schema em comum.
- **Reversão operacional:** as três tabelas são novas e nada as referencia. Não há DROP a executar em produção.

## 6. Contrato para vínculos futuros (nada criado agora)

Operações futuras (mapa, estoque, financeiro) podem **referenciar** estes ids estáveis, sempre com `cliente_id` da sessão e `empresa_id` validado:
- `parceiro_id` → `Fornecedor.id`
- `centro_custo_id` → `CentroCusto.id`
- `centro_resultado_id` → `CentroResultado.id`

Para registrar a origem de um fato futuro, a convenção é `origem_tipo` (ex.: `'movimentacao_estoque'`) + `origem_id`.

Esta PR não cria:
- tabela de lançamentos;
- eventos;
- preenchimento de `MovimentacaoEstoque.centro_custo_id`;
- validação retroativa.

Um centro de custo não tem centro de resultado fixo, e um parceiro não tem centro fixo. A imputação é da operação futura, e o vínculo N:N é só um catálogo de combinações possíveis.

## 7. Testes

- **Backend:** `backend/tests/gestaoP1Cadastros.test.mjs` (PostgreSQL 16, HTTP real, prova por persistência).
  - RED na `main`: 17 de 17 falham, porque as rotas e tabelas não existem.
  - GREEN: 17/17.
- **Cobertura:**
  - T1 Parceiro PF/PJ: papéis, documento, corrida, keyset, filtros, inativação e corpo fechado.
  - T2 legado: `tipos=[]`, aliases, valor desconhecido preservado, `Lote.fornecedor_id` intacto, seletor mascarado, rotas antigas.
  - T3: 2 tenants × 2 empresas.
  - T4: permissões.
  - T5: hierarquia (ciclo, autorreferência, pai inativo, profundidade, corridas).
  - T6: N:N (inclui idempotência e auditoria).
  - T7: o banco recusa par e pai de outra empresa e a autorreferência, e RESTRICT na empresa.
- **Tabelas proibidas:** fotografia antes/depois de Lote, notas, movimentações, produto e rebanho mostra tudo intacto.
- **Gates:** `test:gates` 693/693. O teste B1 do pré-merge passou a listar as três tabelas novas aprovadas.
- **Scripts de operação:** `inicializar-tenant-maike` e os SQLs do editor (01–04) agora conhecem as três tabelas (58 → 61 tabelas tenant). A FK composta autorreferente (MATCH SIMPLE) é anulada só por `pai_id` antes da limpeza.
- **Suíte backend completa:** 1088 testes, 1083 pass, 0 fail, 0 skip. Os 5 `todo` já existiam e são do roteiro do ledger.
- **Frontend (`tests/smoke/`):** 49 testes novos em 5 arquivos, com componentes reais e `fetch` falso.
  - `gestaoParceiros` 17;
  - `gestaoCentrosCusto` 16;
  - `gestaoCentrosResultado` 4;
  - `gestaoMenuPermissoes` 9, com o Layout real;
  - `gestaoLoteFornecedorInativo` 3.

## 7.1 Interface

- **Menu e escopo:**
  - O grupo **Gestão Rural** traz as telas Parceiros, Centros de Custo e Centros de Resultado.
  - Em `config/mapa-manejo-scope.json`, `allowedPages` ganhou exatamente `Parceiros`, `CentrosCusto` e `CentrosResultado`. Só `CentrosCusto` saiu de `forbiddenDomains`, e `CentroCusto` continua em `forbiddenBase44Entities`.
  - O `vercel.json` foi regenerado pelo script de sincronização, então o link direto funciona.
- **Telas:** seguem o padrão Motor Base1 (`CadastroBase1Screen`). As props novas têm padrão igual ao comportamento atual, então as demais telas não mudam.
  - Parceiros: pessoa física e jurídica, papéis múltiplos, papéis antigos só para leitura, PATCH só com o que mudou.
  - Centros: caminho e indentação da árvore. As opções de pai excluem o próprio nó e os descendentes. Filtro ativos/inativos/todos.
  - Vínculo: o Centro de Custo edita com seleção múltipla e relê do banco depois do PUT. O Centro de Resultado só lê.
- **Exclusão:** "Excluir" inativa, com confirmação. Desligar "Ativo" também pede confirmação.
- **Empresa:** o fallback `clienteId` é tratado como "sem empresa". A tela mostra "Selecione uma empresa", sem listar nem gravar. A troca de empresa limpa o estado.
- **Gravações só online:** sem fila offline, porque o servidor pode recusar depois (documento duplicado, hierarquia).
- **Permissões no cliente:** `gestaoPermissions.js` espelha os guardas do servidor, e o não-admin começa sem acesso. A tela Permissões lista as três telas a partir do menu.
- **Cadastro de Lotes:** o seletor de fornecedor não oferece inativos, mas mantém o fornecedor atual do lote. `GET /fornecedores` não mudou.
- **Capturas:** desktop 1280 e celular 390, lista e registro, das três telas. Foram feitas com backend falso e não estão versionadas.

## 8. Riscos residuais — tratamento (rodada de organização, 07/11)

| # | Risco | Tratamento | Prova |
|---|---|---|---|
| R1 | As rotas antigas de escrita de `/fornecedores` (só admin real) não passavam pela regra de documento. O `DELETE` antigo apagava fornecedor com histórico, porque `fornecedor_id` não tem FK e o nome deixaria de resolver. | **Fechado.** POST e PATCH antigos usam a mesma regra das Parceiros: dígitos válidos e documento único por empresa, sob a mesma trava, quando o CPF/CNPJ é novo ou muda. O `DELETE` antigo recusa (409 `PARCEIRO_EM_USO`) fornecedor citado em Lote, nota ou movimentação; sem histórico, segue apagando. | `gestaoP1Cadastros` "R1" |
| R2 | Revogação em voo: a permissão é conferida no preHandler. | **Aceito, igual a todo o produto** (R2 §9.2). A próxima requisição já é negada. Mudar isso é uma missão transversal, não deste cadastro. | — |
| R3 | As opções de pai e de vínculo cortavam em 1000 centros ativos sem avisar. | **Fechado.** O teto vira regra de escrita: no máximo 1000 centros ativos por tipo e empresa (409 `CENTRO_LIMITE_ATIVOS` ao criar ou reativar além disso, sob a trava da árvore). Com isso, a lista do seletor está sempre completa. | `gestaoP1Cadastros` "R3", smoke |
| R4 | No celular, o ✓ Salvar fica no cabeçalho do Layout, fora do wrapper `data-permissao-explicita`. Quem só tinha "editar" era barrado no cliente, embora o servidor aceite. | **Fechado.** A tela declara `permissaoExplicita` (prop nova do `CadastroBase1Screen`, padrão desligado). O chrome publica isso no shell do celular, e o ✓ do Layout recebe `data-permissao-explicita` só nesse caso. As demais telas não mudam. Em `Layout.jsx`, a mudança é um único atributo. | `gestaoRiscosResiduais` R4, com o Layout real |
| R5 | O grupo Gestão Rural usava o ícone padrão no celular. | **Fechado.** O grupo usa `Briefcase`; as telas usam `Users`, `Coins` e `PieChart`. | smoke R5 |

**Ativo Sim/Não (padrão Motor Base1):**
- Os três cadastros têm o campo **Ativo** no formulário, no mesmo componente das demais telas Base1 (`B1ChaveRow`), e a coluna **Ativo** (Sim/Não) na tabela.
- A lista abre em "Ativos".
- No celular, o card mostra **Ativo** entre os 3 campos padrão.
- Todo seletor puxa só ativos:
  - opções de pai e de vínculo (servidor);
  - seletor de fornecedor do Cadastro de Lotes (o fornecedor atual de um lote antigo continua exibido).
- Inativar não apaga: o histórico continua resolvendo nomes.

**Rodadas locais revisadas:**
- As duas rodadas vermelhas depois do merge da `main` tiveram duas causas:
  - duas execuções simultâneas no mesmo banco;
  - a reciclagem do container da sessão, que derruba o PostgreSQL local entre turnos (log: "not properly shut down").
- Nenhuma veio de defeito de código. A rodada isolada em banco novo deu verde, assim como a CI do head.

## 9. Migration aplicada na produção (07/11/2026) — registro operacional

O proprietário autorizou por escrito, em 07/11/2026:

> "Você pode fazer as migrações, porque é apenas cadastro."

**Caminho:** conector Supabase (`execute_sql`), no mesmo formato da S04-P1 (§13) e da S04-P2 (§11), e **não** pelo `premerge-migrate --aplicar`.

**Alvo:** Supabase MAIKE `uuemcasqcdjucflulkne`, database `postgres`, `system_identifier` 7692130048193495360.

**Antes** (só leitura)
- 32 migrations concluídas, 0 com falha; a última era `20261107200000_s04_p2_troca_senha_inicial`.
- A migration Gestão P1 não estava registrada e as 3 tabelas não existiam.
- 2 clientes, 5 usuários, 2 empresas, 59 lotes, 0 fornecedores.

**Execução: uma transação**
- `lock_timeout` de 5 s.
- Guardas que abortariam se:
  - o `system_identifier` não fosse o esperado;
  - a migration já estivesse registrada;
  - o histórico não tivesse exatamente 32 migrations concluídas;
  - houvesse migration com falha.
- O `migration.sql` integral, cujo único `DROP` é `DROP POLICY IF EXISTS` nas próprias tabelas novas.
- INSERT em `_prisma_migrations` com o checksum `e29855b2…cecf5` e `applied_steps_count = 1`.
- Nenhum DROP de dado, DELETE, TRUNCATE ou UPDATE. Nenhuma tabela existente alterada.

**Depois** (só leitura)
- 33 migrations, 0 com falha. Checksum e passos conferem.
- As 3 tabelas existem, com RLS ligado, 3 políticas `maike_backend_all` e 0 grants para `anon`/`authenticated`.
- Constraints e índices: 10 FKs, 2 CHECKs, 20 índices.
- Contagens preservadas: 2 clientes, 5 usuários, 2 empresas, 59 lotes, 0 fornecedores.
- Produção no ar (main `05dda652`, que ignora as tabelas novas): `/api/native/health` = 200.

**Desvios em relação ao runbook:** os mesmos aceitos nas S04 (sem backup lógico novo e sem `conferir-alvo-banco.mjs`), por decisão do proprietário.

**Rollback:** não é necessário para o runtime antigo. Se um dia for preciso, consiste em remover as 3 tabelas novas, vazias, **somente com nova autorização**.

| Item | Estado |
|---|---|
| `SCHEMA_APPLIED_PRODUCTION` | **SIM** (07/11/2026) |
| `MERGE_READY` | **CANDIDATO**, sujeito à auditoria do proprietário |
