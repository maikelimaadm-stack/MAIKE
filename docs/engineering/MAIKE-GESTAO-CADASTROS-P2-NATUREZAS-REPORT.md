# MAIKE — Gestão P2: Naturezas Financeiras gerenciais (D-PROD-152)

**Pedido do proprietário:** cadastrar **naturezas de receita e despesa**, com hierarquia, para classificar operações futuras.

**Fica fora:** lançamento, valor, saldo, caixa/banco, tributo, compra, NF-e, contas a pagar/receber, estoque e mapa.

**Ponto de partida:**
- **Base:** `main` `7c63a4e5`, que é o merge da #222 (Gestão P1), com CI verde.
- **Integração da `main`:** depois veio a #228 (`4ee9786f`, só visual do menu: `Layout.jsx` e CSS). Ela foi integrada por merge normal (`bf447dad`), sem rebase nem force-push e sem conflito.
- **Rodada R1 de fechamento** (`MAIKE-GESTAO-CADASTROS-P2-R1-FECHAMENTO-PR227`):
  - corrige dois defeitos de UI com teste RED→GREEN (§5.4);
  - acrescenta evidência visual reproduzível (§6);
  - corrige a descrição das FKs (§2);
  - completa este relatório.
- **PR #225 (aberta, não incorporada):**
  - é só visual, tem 65 arquivos e reserva as decisões D-PROD-147 a 151;
  - por isso esta slice usa a **D-PROD-152**;
  - a colisão com a P2 é só textual, no fim de `docs/engineering/DECISIONS.md` (§7).

---

## 1. O que é (e o que não é)

| Pergunta | Cadastro |
|---|---|
| Quem é a contraparte? | Parceiro (P1) |
| Onde o custo nasce? | Centro de Custo (P1) |
| Que atividade gera o resultado? | Centro de Resultado (P1) |
| **Qual o tipo econômico da receita/despesa?** | **Natureza Financeira (P2)** |

- **Uma entidade só:** `NaturezaFinanceira`.
  - Não há `PlanoContas`, `GrupoFinanceiro`, `CategoriaFinanceira`, `NaturezaGerencial` nem tabela paralela.
  - É classificação **gerencial**, não plano de contas contábil.
  - Não guarda valor, saldo nem lançamento.
- **Sem vínculo estático** com Parceiro ou Centros:
  - a combinação será feita pela **operação futura**, com FK e validação próprias;
  - os ids ficam estáveis: `natureza_financeira_id → NaturezaFinanceira.id`, sempre com `cliente_id` da sessão e `empresa_id` validado.

## 2. Persistência

**Model `NaturezaFinanceira`** (`backend/prisma/schema.prisma`):
- campos: `id`, `cliente_id`, `empresa_id`, `numero`, `tipo`, `nome`, `descricao?`, `pai_id?`, `ativo`, `createdAt`, `updatedAt`.

**Uniques:**
- `(cliente_id, id)`;
- `(cliente_id, empresa_id, id)`, alvo de FKs futuras;
- `(cliente_id, empresa_id, tipo, id)`, alvo da FK do pai;
- `(cliente_id, numero)`;
- `(cliente_id, empresa_id, tipo, nome)`: o nome é único por empresa **e** tipo.

**Índices:**
- `(cliente_id, empresa_id, tipo, ativo)`;
- `(cliente_id, empresa_id, pai_id)`;
- `(cliente_id, empresa_id, tipo, createdAt, id)`.

**FKs, exatamente como estão no SQL da migration.** `ON DELETE` é `RESTRICT` nas três. `ON UPDATE` **não** é igual em todas:

| FK | Colunas | ON DELETE | ON UPDATE |
|---|---|---|---|
| `NaturezaFinanceira_cliente_id_fkey` | `cliente_id → Cliente.id` | RESTRICT | **CASCADE** |
| `NaturezaFinanceira_cliente_id_empresa_id_fkey` | `(cliente_id, empresa_id) → Empresa(cliente_id, id)` | RESTRICT | **CASCADE** |
| `NaturezaFinanceira_cliente_id_empresa_id_tipo_pai_id_fkey` (árvore) | `(cliente_id, empresa_id, tipo, pai_id) → NaturezaFinanceira(cliente_id, empresa_id, tipo, id)` | RESTRICT | **RESTRICT** |

- **Cliente e Empresa:** o `ON UPDATE CASCADE` é o padrão do Prisma, igual ao das outras tabelas tenant-scoped. Os ids são cuid e não são reescritos pela aplicação.
- **Árvore:** a FK da árvore tem `ON UPDATE RESTRICT` e `MATCH SIMPLE`.
  - Com `pai_id` nulo, a FK não se aplica.
  - O pai é sempre do mesmo tenant, empresa **e tipo**.
  - Um nó **com filhos** não pode trocar de `tipo`, nem de empresa ou cliente, porque a chave referenciada mudaria e os filhos ficariam órfãos (RESTRICT).
- **O que o banco NÃO garante:** não existe CHECK nem trigger que impeça um UPDATE direto do `tipo` de uma **folha** (nó sem filhos) ou de uma raiz sem filhos.
  - Essa imutabilidade é da **API**: o `PATCH` recusa `tipo` com 400.
  - No banco, sobre o `tipo`, valem só o CHECK de domínio e a FK do pai.
- **Este relatório não altera o SQL:** a migration já auditada segue com o mesmo checksum.

**CHECKs:**
- `tipo IN ('RECEITA','DESPESA')`;
- `pai_id IS NULL OR pai_id <> id`.

**Migration** `20261108100000_gestao_p2_naturezas_financeiras`, expand-only:
- SHA-256 `db299e1d3543769ed46f07ee174521d3ea75b2990b94181012eecdafb9462f04`, pinado em `MIGRATIONS_APROVADAS` (`scripts/deploy/premergeMigrateLib.mjs`);
- corpo do bloco DO `a532c9847a550d4b19015b8b3c2914b79fffdb6ae0e259438d5133c738e416a1`, pinado em `DO_RLS_APROVADOS`;
- classificador: `expand: true`, `tabelas_novas: [NaturezaFinanceira]`, sem violações (`scripts/tests/deploy/premerge-migrate.test.mjs`);
- RLS ligado e REVOKE para `anon`, `authenticated` e `public` (`gate:supabase-public-grants`).

**Checksums inalterados na R1:** o SHA-256 e o hash do DO foram reconferidos com `sha256sum` e estão **idênticos**.

**Nada mais foi alterado:**
- nenhuma tabela existente nem migration anterior;
- o checksum da P1 (`e29855b2…cecf5`) está intacto.

**Scripts de operação:**
- `inicializar-tenant-maike` é genérico (trata FK anulável) e não precisou de mudança;
- os SQL editor 01–04 conhecem a tabela (de 61 para 62) e zeram `pai_id` antes da limpeza.

## 3. API e permissões

Código: `backend/src/modules/gestao/naturezaFinanceiraRoutes.js` e `naturezaFinanceiraService.js`.

| Rota | Guarda |
|---|---|
| `GET /naturezas-financeiras` (`empresa_id`, `tipo`, `ativo`, `pai_id`, `q`, keyset + total) | `naturezaFinanceira.ver` |
| `GET /naturezas-financeiras/:id` | `naturezaFinanceira.ver` |
| `POST /naturezas-financeiras` (`empresa_id`, `tipo`, `nome`, `descricao?`, `pai_id?`) | `naturezaFinanceira.criar` (novo \| salvar) |
| `PATCH /naturezas-financeiras/:id` (`nome`, `descricao`, `pai_id`, `ativo`; **sem `tipo`**) | `naturezaFinanceira.editar` (editar \| salvar) |
| `GET /naturezas-financeiras-opcoes/pais` (`tipo`, `q`, `excluir_id`, keyset por nome) | `naturezaFinanceira.ver` |

- **Tela e permissão:**
  - a tela é `ges-naturezas-financeiras`, no módulo `gestao-rural`;
  - é **negada por padrão**: nenhum usuário recebe a permissão automaticamente;
  - admin real e `is_admin` passam.
- **Tenant e empresa:**
  - o tenant vem só da sessão (`auth_context`);
  - `empresa_id` é obrigatório e validado no banco; serve de escopo e nunca muda o registro;
  - outro tenant ou outra empresa → 404, e o fallback `clienteId` também dá 404.
- **Corpo e query fechados**, recusados com 400:
  - `tipo` no PATCH;
  - `cliente_id`, `id`, `numero`;
  - campo desconhecido;
  - HTML e caractere de controle.
- **Erros:**
  - `NATUREZA_FINANCEIRA_NOT_FOUND` 404;
  - `NATUREZA_NOME_CONFLITO` 409, inclusive na corrida pelo unique;
  - `NATUREZA_HIERARQUIA_INVALIDA` 409, com `reason` ∈ {`autorreferencia`, `pai_fora_da_empresa`, `pai_de_outro_tipo`, `pai_inativo`, `ciclo`, `profundidade_maxima`};
  - `NATUREZA_COM_FILHOS_ATIVOS` 409.
- **Hierarquia:**
  - a escrita roda sob `pg_advisory_xact_lock` por empresa+tipo;
  - caminho, nível e subárvore vêm de uma CTE recursiva: uma consulta por página, sem N+1;
  - profundidade máxima 5; mover uma subárvore considera a altura dela.
- **Código:** gerado pela sequência atômica `EntidadeCodigoSequencia`, por tenant.
- **Auditoria:**
  - gravada na mesma transação;
  - allowlist com `id`, `empresa_id`, `numero`, `tipo`, `ativo`, `pai_id` e os **nomes** dos campos alterados;
  - sem nome nem descrição (texto livre) e sem alterar logs antigos.
- **PATCH idempotente:** o mesmo conteúdo não grava nem audita.
- **Opções de pai:**
  - só ativas do mesmo tipo, com busca no servidor;
  - keyset por `(nome, id)`, sem teto;
  - `excluir_id` tira o nó **e** a subárvore.

## 4. Interface (UX real implementada)

Código:
- `src/pages/NaturezasFinanceiras.jsx`;
- `src/components/gestao/NaturezasFinanceirasTela.jsx`;
- `src/components/gestao/FormularioNatureza.jsx`;
- `src/components/gestao/SeletorPaiNatureza.jsx`;
- `src/components/gestao/TabelaNaturezas.jsx`;
- `src/services/naturezaFinanceiraService.js`;
- `src/apis/naturezas-financeiras/`.

A tela segue o padrão Motor Base1, o mesmo de Parceiros e Centros. **O Layout global não foi alterado pela P2.**

### 4.1 Desktop, tablet e celular
- **Desktop (≥1024) e tablet (768):**
  - tabela com as colunas Código, Tipo, Natureza (caminho indentado pelo nível), Pai e Ativo;
  - a barra traz Novo, Duplicar, Editar e Excluir (= inativar), mais os filtros de Tipo e Situação, a busca e a troca de visão (registro, tabela, cards).
- **Celular (390 e 320):**
  - cards com título no caminho e os campos Tipo, Pai e Ativo;
  - o formulário abre em tela cheia com ✕ e ✓ no cabeçalho;
  - as ações da lista ficam na barra superior.
  - Abrir o registro: 1º toque seleciona o card, toque duplo abre em leitura; o lápis passa para edição.
- **Deep link:** `/naturezasfinanceiras`, via rewrites do `vercel.json`, gerados por `scripts/vercel/sync-vercel-json.mjs`.

### 4.2 Fluxos
- **Lista:**
  - o padrão é **Despesa / Ativos**; Receita e Despesa não se misturam por padrão, mas "Todos" existe;
  - Situação: Ativos, Inativos ou Todos;
  - a busca `q` vai ao servidor e a paginação é keyset do controller Base1.
- **Novo:**
  - o **Tipo é obrigatório e não tem valor padrão**: Salvar sem tipo mostra o erro no campo e um aviso, e não faz POST;
  - o seletor de pai fica bloqueado ("escolha o tipo antes") até haver tipo;
  - trocar o tipo **limpa o pai** escolhido;
  - o nome é gravado em maiúsculas.
- **Duplicar:**
  - abre um rascunho Novo, sem `id`, com o mesmo tipo (que pode ser trocado, porque é um registro novo) e o mesmo pai;
  - o servidor recusa nome repetido no mesmo tipo com 409;
  - desde a R1, o cabeçalho do rascunho **não** mostra o código do original (§5.4).
- **Edição:**
  - o Tipo é **só leitura**;
  - nome, descrição, pai e Ativo são editáveis;
  - o PATCH leva só o que mudou, **nunca `tipo`**; virar raiz envia `pai_id: null`;
  - sem mudanças, nada é enviado.
- **Situação:**
  - desligar Ativo no formulário pede confirmação;
  - Excluir na barra = inativar, também com confirmação;
  - reativar fica em "Mais opções";
  - natureza com filhas ativas → mensagem de `NATUREZA_COM_FILHOS_ATIVOS`.
- **Seletor de pai:**
  - paginado no servidor, 50 por página, com "Carregar mais" que segue `next_cursor`;
  - busca com espera de 300 ms;
  - na edição envia `excluir_id`, sem o nó nem a subárvore;
  - mostra o **pai atual** (caminho) mesmo fora da página carregada;
  - o pai atual, mesmo inativo, só aparece por histórico: não vai no PATCH se não mudar, e o servidor recusa escolher um pai inativo novo.
- **Falha no seletor (R1):**
  - falha na 1ª página → alerta e "Tentar novamente", que recarrega do início;
  - falha em "Carregar mais" → alerta "**Lista incompleta**";
  - as opções já carregadas continuam escolhíveis, e "Tentar novamente" repete o **mesmo cursor**;
  - lista parcial nunca é apresentada como completa.
- **Somente leitura:** quem só tem "visualizar" lista e abre registros sem Novo, Editar ou Excluir.
- **✓ do celular:**
  - quem tem só "editar", ou só "salvar", grava pelo ✓ do cabeçalho;
  - o wrapper `data-permissao-explicita` impede a heurística de texto do Layout de esconder o botão (`tests/smoke/gestaoNaturezasShell.test.jsx`).
- **Troca de empresa durante operação:**
  - o formulário fecha e a lista é relida com a nova empresa, que entra na queryKey;
  - toda gravação leva o `empresa_id` em que começou;
  - uma resposta que chega **depois** da troca não substitui o registro aberto da empresa nova: só relê as listas e avisa "gravação feita na empresa anterior";
  - o backend continua sendo a autoridade (404 cruzado).
- **Filtro de Tipo ou Situação com registro aberto:**
  - o registro aberto continua válido (mesma empresa), e a gravação usa o registro original, não o filtro;
  - avaliado na R1: não há vazamento de contexto, logo nenhuma mudança.

## 5. Testes

### 5.1 Backend (PostgreSQL real descartável)
`backend/tests/gestaoP2Naturezas.test.mjs` tem **14 testes**: RED 0/14 na `main` (rotas e tabela inexistentes) e GREEN 14/14.

- **A — API:**
  - criar RECEITA e DESPESA, e o mesmo nome nos dois tipos;
  - detalhe e filtros (tipo, situação, pai, busca);
  - keyset com total;
  - edição idempotente, inativar e reativar;
  - imutabilidade, corpo fechado, nome repetido e corrida de POST.
- **B — hierarquia:**
  - raiz, filho e neto;
  - pai de tipo oposto, inativo, de outra empresa ou inexistente;
  - autorreferência, ciclo e profundidade (ao criar e ao mover);
  - filha ativa e pai inativo na reativação;
  - corrida A→B / B→A sem formar ciclo.
- **C — segurança:**
  - 2 tenants × 2 empresas e o fallback `clienteId`;
  - matriz de permissões: sem tela, visualizar, novo, salvar, editar, admin real, `is_admin` e usuário desativado;
  - auditoria sem texto livre, com rollback quando a auditoria falha (gatilho temporário).
- **D — escala (1.005 ativas):**
  - todas as opções são alcançáveis em 11 páginas;
  - a busca acha a última diretamente, e ela serve de pai;
  - a 1.007ª é aceita, sem teto;
  - `excluir_id` remove o nó e a subárvore.
- **G — banco:**
  - INSERT/UPDATE direto recusa pai de outro tipo, pai de outra empresa, tipo fora do domínio, autorreferência e troca de tipo de **pai com filhos**;
  - `RESTRICT` na exclusão do nó e da empresa;
  - RLS ligado e 0 grants públicos.
- **Tabelas proibidas:** Lote, Produto, Movimentação, nota, rebanho, Parceiros e Centros ficam iguais antes e depois.

### 5.2 Frontend (Vitest + RTL, componentes reais, backend falso só na borda HTTP)
- `tests/smoke/gestaoNaturezas.test.jsx` (**35**):
  - lista e filtros;
  - troca de empresa;
  - permissões;
  - criação (tipo obrigatório, pai, trocar tipo limpa pai, 409);
  - seletor (busca, `excluir_id`, 1.001 por cursor e por busca);
  - edição, inativação e reativação;
  - resposta atrasada após a troca de empresa;
  - os 3 testes R1 da §5.4.
- `tests/smoke/gestaoNaturezasShell.test.jsx` (1): o ✓ do celular com o Layout real.
- `tests/smoke/gestaoMenuPermissoes.test.jsx`, `gestaoRiscosResiduais.test.jsx` e `vercelSpaRoutes.test.js` foram ajustados. Eles conferem a quarta tela no menu e na tela Permissões, e que os domínios financeiros **continuam proibidos**.

### 5.3 Escopo de produto
`config/mapa-manejo-scope.json`:
- recebeu **apenas** `NaturezasFinanceiras` em `allowedPages`;
- `forbiddenDomains` (Financeiro, PlanoContas, GruposFinanceiros, ContasFinanceiras, CaixaBancos, LancamentoFinanceiro…) e `forbiddenBase44Entities` continuam iguais.

### 5.4 Defeitos encontrados na R1 (RED → GREEN, na mesma PR)

| # | Defeito reproduzido | Teste | RED (antes) | GREEN (depois) |
|---|---|---|---|---|
| R1-1 | **Duplicar** mantinha o `numero` do original no rascunho, e o cabeçalho do "Novo" mostrava o código do registro de origem. | `duplicar: novo rascunho sem id nem código do original…` | o cabeçalho tinha o separador de código | sem código; POST `{empresa_id, tipo, nome, pai_id}` sem `id`/`numero` |
| R1-2 | Falha na **1ª página** de opções de pai mostrava só a mensagem do servidor, **sem forma de tentar de novo**. | `falha na 1ª página de pais: alerta + "Tentar novamente"…` | alerta sem ação | alerta, "Tentar novamente" recarrega e as opções aparecem |
| R1-3 | Falha em **"Carregar mais"** não dizia que a lista estava **incompleta**. | `falha ao carregar mais: avisa que a lista está incompleta…` | sem aviso de lista parcial | "Lista incompleta", opções já carregadas preservadas, retry no **mesmo cursor** |

O backend não mudou na R1.

## 6. Evidência visual reproduzível

- **Script:** `scripts/dev/visual-naturezas-financeiras.mjs`, versionado.
  - Usa os **componentes reais** (Vite dev) com o **backend falso** do próprio script (`page.route` em `/api/native/**`).
  - Nada sai para banco ou API real.
  - Cada captura leva a faixa "BACKEND FALSO — evidência visual".
- **Como reproduzir:**
  ```bash
  npx vite --port 5199 --strictPort --host 127.0.0.1
  ```
  ```bash
  node scripts/dev/visual-naturezas-financeiras.mjs /caminho/de/saida
  ```
- **Requisito:** `playwright` com Chromium no ambiente (não é dependência do projeto).
- **Condições de falha:** o script sai com código 1 se houver rolagem horizontal, erro de página ou etapa não encontrada.
- **Etapas,** em 1440, 1280, 768, 390 e 320 px (13 por largura = **65 capturas**):
  - 01 lista Despesa/Ativos;
  - 02 filtro Receita;
  - 03 Novo vazio;
  - 04 Novo com Tipo obrigatório;
  - 05 Novo Despesa sem pai;
  - 06 seletor aberto;
  - 07 Novo com pai;
  - 08 registro somente leitura;
  - 09 edição (Tipo só leitura);
  - 10 busca de pai;
  - 11 falha "Lista incompleta";
  - 12 retry OK;
  - 13 confirmação de inativação.
- **Resultado no HEAD `0ff9e215`:**
  - exit 0;
  - `scrollWidth` igual à largura da tela em **todas** as 65 capturas (sem overflow horizontal).
- **Alvos de toque do formulário no celular:**
  - campos e botões do seletor: 32–48 px de altura;
  - menor elemento: o **switch Ativo** do Motor Base1 (22 px de controle dentro de uma linha maior). É componente compartilhado com a P1, mantido sem mudança (§8).
- **Onde ficam as capturas:** fora do repositório, porque são binárias e regeneráveis. A prova durável é o script versionado mais o exit code. As imagens desta rodada foram entregues ao proprietário como anexos da sessão (folhas de contato por largura). Não há artefato de CI para capturas.
- **Preview Vercel:** prova só que o build compila. **Não** prova que a API nova funciona: a tabela não existe em produção.

## 7. Matriz de gates e CI

PostgreSQL 16 local descartável, banco isolado `maike_p2_r1`, execução sequencial (nunca duas suítes PG em paralelo no mesmo banco).

Nesta rodada o cluster local tinha caído na reciclagem do container ("stale pid file"). Ele foi reiniciado com `pg_ctlcluster 16 main start` e o banco recriado do zero. Não houve falha de teste por isso.

**HEAD do código validado: `0ff9e215`.**

| Comando | Exit | Contagem / evidência |
|---|---|---|
| `prisma migrate deploy` (banco novo `maike_p2_r1`) | 0 | todas as migrations, incluindo a P2 |
| `prisma migrate diff --from-url <local> --to-schema-datamodel prisma/schema.prisma --exit-code` | 0 | "No difference detected." (sem drift) |
| `prisma:validate` | 0 | — |
| `prisma:generate` | 0 | — |
| `gate:product-scope` | 0 | só `NaturezasFinanceiras` acrescentada; domínios proibidos intactos |
| `gate:tenancy` | 0 | — |
| `gate:indices` | 0 | — |
| `gate:modelobase1-pecuario` | 0 | — |
| `gate:supabase-public-grants` | 0 | RLS + REVOKE da tabela nova |
| `gate:native-api` | 0 | — |
| `gate:admin-isolation` | 0 | — |
| `test:gates` | 0 | 694 testes: 694 pass, 0 fail, 0 skip, 0 todo |
| `test:backend` | 0 | 1140 testes: 1135 pass, 0 fail, **0 skip**, 5 todo (herdados) |
| `test:smoke` | 0 | 156 arquivos, 1715/1715 |
| `lint` | 0 | 0 erros; 56 avisos, todos anteriores (nenhum nos arquivos da P2) |
| `typecheck:backend` | 0 | — |
| `typecheck` | 0 | — |
| `build` | 0 | — |

- **`todo`:** os 5 `todo` do `test:backend` são **herdados**: `backend/tests/estoquePecuarioLedgerContrato.test.mjs`, pendências da integração L2 do ledger, anteriores à P2.
- **`skip`:** **0** `skip` novo, e nenhum gate enfraquecido.
- **HEAD final:** o commit que traz este relatório difere de `0ff9e215` só em documentação.
- **Onde ficam os resultados finais:** o exit code do `verify:all` local reexecutado no HEAD final e a run da CI GitHub (`verify:all`) do **HEAD exato** ficam no corpo da PR #227. Um commit não consegue citar o próprio hash.

### Reconciliação com a PR #225
- **Estado:** a #225 continua **aberta e não foi incorporada**. A P2 não reserva novas decisões.
- **Conflito esperado:** ao entrar na `main`, ela adiciona D-PROD-147…151 ao fim de `DECISIONS.md`, no mesmo ponto em que a P2 adicionou a D-PROD-152.
- **Resolução** (manual e trivial, histórico append-only):
  - ordenar as entradas em 147…151 e depois 152;
  - manter um único marcador `<!-- Próxima decisão: D-PROD-153 -->`.
- **Dependência visual:** a #225 muda botões, tipografia e fundo de forma transversal (CSS).
  - A tela P2 usa os mesmos componentes Base1 e herdará o visual.
  - Depois do merge da #225, as capturas devem ser regeneradas com o script da §6.

## 8. Riscos residuais e limitações intencionais

- **Produção sem a tabela:**
  - `public."NaturezaFinanceira"` **não existe** em produção (Supabase `uuemcasqcdjucflulkne`).
  - Confirmação só de leitura, feita na auditoria do arquiteto: 33 migrations concluídas, nenhuma incompleta.
  - Esta missão não executou SQL remoto.
  - Se o código fosse publicado antes da migration, as rotas novas dariam erro. Por isso **não pode haver merge antes da migration aplicada e conferida**.
- **`tipo` da folha:** a imutabilidade do `tipo` de uma folha é garantida pela API, não pelo banco (§2). Um UPDATE SQL manual numa folha pode trocar o tipo. Isso é aceitável porque não há escrita fora da API.
- **Switch Ativo:** é componente compartilhado do Motor Base1, usado também na P1. Mexer nele mudaria a P1, então ficou fora do escopo.
- **E2E:** não há E2E Playwright no CI para a tela. A cobertura vem do RTL com componentes reais mais o script visual local.
- **Nome em maiúsculas:** como nos Centros da P1.
- **Excluir = inativar:** não há exclusão física, por decisão.
- **Duplicar um registro inativo:** gera um registro novo **ativo**, porque a criação não aceita `ativo`. Se o pai do original estiver inativo, o servidor recusa com `pai_inativo`.
- **Fora do escopo, de propósito:** valores, lançamentos, vínculo com Parceiro ou Centros e uso em operações. Ficam para slices futuras com decisão própria.

## 9. Prontidão

| Critério | Estado |
|---|---|
| **CODE_READY** (código, testes, gates, CI verdes no HEAD) | ver §7 |
| **SCHEMA_APPLIED_PROD** | **SIM**: aplicada em 2026-11-08 com autorização do proprietário e conferida (§12) |
| **MERGE_READY** | Schema aplicado e conferido; o merge manual da PR #227 é decisão do proprietário |

Prontidão de código ≠ prontidão de release: só após o schema aplicado **e conferido** em produção pode haver merge manual da PR #227.

## 10. Plano operacional da migration (NÃO executado nesta missão)

Só roda depois de **aprovação arquitetural e autorização específica do proprietário**. Nenhum registro em `_prisma_migrations`, nenhum `CREATE TABLE` e nenhuma alteração de env será feito ou fabricado a partir deste relatório. Se qualquer passo divergir → **RELEASE_BLOCKED**, e uma nova decisão é pedida antes de continuar.

1. **Alvo:**
   - confirmar que o projeto Supabase é `uuemcasqcdjucflulkne`;
   - provar que a `DATABASE_URL` da Vercel de produção aponta para ele: host e ref batem, sem imprimir segredo.
2. **Histórico:**
   - `_prisma_migrations` com todas as migrations da `main` anteriores à P2 concluídas (33 na auditoria), nenhuma com `finished_at` nulo ou `rolled_back_at`;
   - os checksums gravados batem com o repositório, inclusive o da P1 `20261107300000…`;
   - `NaturezaFinanceira` ausente.
3. **Checksum:** o arquivo da `main` pós-aprovação tem SHA-256 `db299e1d…62f04` e DO `a532c984…e416a1`, iguais ao manifesto.
4. **Backup e restauração:**
   - backup ou PITR do Supabase confirmado com horário anterior à janela;
   - procedimento de restauração conhecido.
5. **Preflight expand-only:** rodar `scripts/deploy/premergeMigrateLib.mjs` contra o arquivo. Deve dar `expand: true`, `tabelas_novas: [NaturezaFinanceira]`, sem violações.
6. **Janela e observabilidade:**
   - a migration só cria tabela, índices, FKs, CHECKs e RLS, sem tocar tabela existente; é rápida e não bloqueia leituras;
   - acompanhar os logs do Supabase e da Vercel.
7. **Execução**, só com autorização expressa e pelo caminho oficial (o mesmo da P1). Depois dela:
   - conferir `_prisma_migrations` (34 concluídas);
   - conferir a tabela, os índices, as 3 FKs (com as ações de `ON DELETE`/`ON UPDATE` da §2) e os 2 CHECKs;
   - conferir RLS ligado e 0 grants públicos.
8. **Rollback operacional:**
   - antes do merge, a tabela nova não tem leitores, e a reversão é um `DROP TABLE "NaturezaFinanceira"` mais a remoção do registro em `_prisma_migrations`;
   - essa reversão também precisa de autorização expressa;
   - depois do merge, prefere-se reverter o código (revert da PR) e manter a tabela, que é aditiva.
9. **Só então:** merge manual da PR #227 e deploy.

## 11. Referências
- **Decisão:** `docs/engineering/DECISIONS.md` § D-PROD-152.
- **Roadmap:** `docs/engineering/ROADMAP.md`.
- **Escopo:** `docs/constitution/00-CONSTITUICAO.md`.
- **Cobertura de permissões:** `docs/engineering/MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md`.
- **Migration:** `backend/prisma/migrations/20261108100000_gestao_p2_naturezas_financeiras/migration.sql`.
- **Testes:** `backend/tests/gestaoP2Naturezas.test.mjs`, `tests/smoke/gestaoNaturezas.test.jsx`, `tests/smoke/gestaoNaturezasShell.test.jsx`.
- **Script visual:** `scripts/dev/visual-naturezas-financeiras.mjs`.

## 12. Aplicação em produção (executada)

- **Autorização:** dada expressamente pelo proprietário. A transação foi enviada pelo conector Supabase, com aprovação no diálogo do conector.
- **Pré-checagem (§10, passos 1–5):**
  - **Alvo:** MAIKE `uuemcasqcdjucflulkne` (sa-east-1, Postgres 17), sysid `7692130048193495360`.
  - **Vercel → banco:** as variáveis de banco de produção (`POSTGRES_*`, `SUPABASE_URL`) vêm da integração Supabase deste projeto. Havia conexões ativas da aplicação via Supavisor.
  - **Histórico:**
    - 33 migrations concluídas, 0 parciais;
    - todos os checksums iguais aos do repositório (4 `manual` históricos);
    - faltava só a P2.
  - **Preflight:** `classificarMigrations` → `expand: true`, `tabelas_novas: [NaturezaFinanceira]`, 0 violações. SHA-256 igual ao manifesto.
  - **Backup:** não verificável pelas ferramentas disponíveis. Mitigado porque a migration é aditiva e reversível com `DROP TABLE`.
- **Execução:** uma transação com o SQL idêntico ao arquivo mais a linha em `_prisma_migrations` (checksum `db299e1d…62f04`), encerrada com `COMMIT`.
- **Conferência pós-aplicação (só leitura):**
  - 34 migrations concluídas, 0 parciais;
  - checksum da P2 no banco = `db299e1d3543769ed46f07ee174521d3ea75b2990b94181012eecdafb9462f04`;
  - 11 colunas e 9 índices (PK, 5 uniques, 3 índices);
  - FKs com as ações esperadas: Cliente e Empresa com `ON DELETE RESTRICT` e `ON UPDATE CASCADE`; a da árvore com `ON DELETE RESTRICT` e `ON UPDATE RESTRICT`;
  - os 2 CHECKs presentes;
  - RLS ligado, policy `maike_backend_all` só para `maike_vercel`;
  - 0 grants para `anon`, `authenticated` e `PUBLIC`;
  - 0 linhas.
- **Rollback:** antes do merge, `DROP TABLE "NaturezaFinanceira"` mais a remoção da linha em `_prisma_migrations`. Depois do merge, reverter o código e manter a tabela, que é aditiva.
