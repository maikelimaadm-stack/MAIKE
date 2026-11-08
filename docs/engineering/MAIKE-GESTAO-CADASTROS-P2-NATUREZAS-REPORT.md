# MAIKE — Gestão P2: Naturezas Financeiras gerenciais (D-PROD-152)

**Pedido do proprietário:** cadastrar **naturezas de receita e despesa**, com hierarquia, para classificar futuras operações. Ficam fora lançamento, valor, saldo, caixa/banco, tributo, compra, NF-e, contas a pagar/receber, estoque e mapa.

**Base:** `main` `7c63a4e5`, merge da #222 (Gestão P1), com CI verde. A PR #225, aberta e só visual, reserva as decisões D-PROD-147 a 151; por isso esta slice usa a **D-PROD-152**. A colisão com a #225 é só textual, em `DECISIONS.md`.

## 1. O que é (e o que não é)

| Pergunta | Cadastro |
|---|---|
| Quem é a contraparte? | Parceiro (P1) |
| Onde o custo nasce? | Centro de Custo (P1) |
| Que atividade gera o resultado? | Centro de Resultado (P1) |
| **Qual o tipo econômico da receita/despesa?** | **Natureza Financeira (P2)** |

- **Uma entidade só:** `NaturezaFinanceira`, sem `PlanoContas`, `GrupoFinanceiro` ou tabela paralela. É classificação **gerencial**, não plano de contas contábil, e não guarda valores.
- **Sem vínculo estático** com Parceiro ou Centros. A combinação será da **operação futura**, com FK e validação próprias. Os ids ficam estáveis: `natureza_financeira_id → NaturezaFinanceira.id`, sempre com `cliente_id` da sessão e `empresa_id` validado.

## 2. Persistência

- **Model:** `NaturezaFinanceira` com id, `cliente_id`, `empresa_id`, `numero`, `tipo`, `nome`, `descricao?`, `pai_id?`, `ativo` e timestamps.
- **Uniques:**
  - `(cliente_id, id)`;
  - `(cliente_id, empresa_id, id)` — alvo de FKs futuras;
  - `(cliente_id, empresa_id, tipo, id)` — alvo da FK do pai;
  - `(cliente_id, numero)`;
  - `(cliente_id, empresa_id, tipo, nome)` — o nome é único por empresa **e tipo**.
- **Índices:** `(cliente_id, empresa_id, tipo, ativo)`, `(cliente_id, empresa_id, pai_id)` e `(cliente_id, empresa_id, tipo, createdAt, id)`.
- **FKs** (todas `RESTRICT`):
  - Cliente;
  - Empresa, composta;
  - pai, `(cliente_id, empresa_id, tipo, pai_id) → (cliente_id, empresa_id, tipo, id)`, com `ON DELETE RESTRICT ON UPDATE RESTRICT`. O pai é do mesmo tenant, empresa **e tipo**, e o tipo de um nó com filhos não muda. Com `pai_id` nulo, a FK não se aplica (MATCH SIMPLE).
- **CHECKs:** `tipo IN ('RECEITA','DESPESA')` e `pai_id IS NULL OR pai_id <> id`.
- **Migration** `20261108100000_gestao_p2_naturezas_financeiras`, expand-only:
  - SHA-256 `db299e1d3543769ed46f07ee174521d3ea75b2990b94181012eecdafb9462f04`, pinado em `MIGRATIONS_APROVADAS`;
  - corpo DO `a532c9847a550d4b19015b8b3c2914b79fffdb6ae0e259438d5133c738e416a1`, pinado em `DO_RLS_APROVADOS`;
  - classificador: `expand: true`, `tabelas_novas: [NaturezaFinanceira]`, sem violações;
  - aplicada só em PostgreSQL 16 local descartável; `prisma migrate diff --exit-code` = 0 (sem drift).
- **Nada alterado:** nenhuma tabela existente nem migration anterior. O checksum da P1, `e29855b2…cecf5`, está intacto.
- **Scripts de operação:** `inicializar-tenant-maike` (genérico, por FK anulável) e SQL editor 01–04 conhecem a tabela (61 → 62), zerando `pai_id` antes da limpeza.

## 3. API e permissões

| Rota | Guarda |
|---|---|
| `GET /naturezas-financeiras` (`tipo`, `ativo`, `pai_id`, `q`, keyset + total) | `naturezaFinanceira.ver` |
| `GET /naturezas-financeiras/:id` | `naturezaFinanceira.ver` |
| `POST /naturezas-financeiras` (`empresa_id`, `tipo`, `nome`, `descricao?`, `pai_id?`) | `naturezaFinanceira.criar` (novo \| salvar) |
| `PATCH /naturezas-financeiras/:id` (`nome`, `descricao`, `pai_id`, `ativo`; **sem `tipo`**) | `naturezaFinanceira.editar` (editar \| salvar) |
| `GET /naturezas-financeiras-opcoes/pais` (`tipo`, `q`, `excluir_id`, keyset por nome) | `naturezaFinanceira.ver` |

- **Tela:** `ges-naturezas-financeiras`, no módulo `gestao-rural`, negada por padrão.
- **Tenant e empresa:** o tenant vem só da sessão. `empresa_id` é obrigatório, validado no banco e funciona como escopo, nunca muda o registro. Outro tenant ou empresa → 404, e o fallback `clienteId` também dá 404.
- **Corpo e query fechados:** recusados com 400 — `tipo` no PATCH, `cliente_id`, `id`, `numero`, campo desconhecido, HTML e caractere de controle.
- **Erros:**
  - `NATUREZA_FINANCEIRA_NOT_FOUND` 404;
  - `NATUREZA_NOME_CONFLITO` 409 (corrida no unique → 409);
  - `NATUREZA_HIERARQUIA_INVALIDA` 409, com `reason` ∈ {`autorreferencia`, `pai_fora_da_empresa`, `pai_de_outro_tipo`, `pai_inativo`, `ciclo`, `profundidade_maxima`};
  - `NATUREZA_COM_FILHOS_ATIVOS` 409.
- **Hierarquia:**
  - escrita sob trava `pg_advisory_xact_lock` por empresa+tipo;
  - caminho, nível e subárvore por CTE recursiva — uma consulta por página, sem N+1;
  - profundidade máxima 5;
  - mover uma subárvore considera a altura dela.
- **Auditoria:** na mesma transação, com `id`, `empresa_id`, `numero`, `tipo`, `ativo` e `pai_id`, mais os NOMES dos campos alterados. Sem nome nem descrição (texto livre).
- **PATCH idempotente:** o mesmo conteúdo não grava nem audita.
- **Sem teto:** opções de pai paginadas por (nome, id), com busca no servidor e sem o nó nem a subárvore em edição.

## 4. Testes de backend (PostgreSQL real)

`backend/tests/gestaoP2Naturezas.test.mjs` tem **14 testes**: RED 0/14 na `main` (rotas e tabela inexistentes) e **GREEN 14/14**.

- **A — API:** criar RECEITA e DESPESA, mesmo nome nos dois tipos, detalhe, filtros (tipo, situação, pai, busca), keyset com total, edição idempotente, inativar/reativar, imutabilidade, corpo fechado, nome repetido e corrida de POST.
- **B — hierarquia:** raiz/filho/neto, tipo oposto, pai inativo, outra empresa, inexistente, autorreferência, ciclo, profundidade (criar e mover), filha ativa, pai inativo na reativação, corrida A→B/B→A sem ciclo.
- **C — segurança:**
  - 2 tenants × 2 empresas e o fallback `clienteId`;
  - matriz de permissões: sem tela, visualizar, novo, salvar, editar, admin real, `is_admin` e usuário desativado;
  - auditoria sem texto livre, com rollback quando a auditoria falha (gatilho temporário).
- **D — escala:** 1.005 ativas. Todas as opções são alcançáveis em 11 páginas; a busca acha a última direto; ela serve de pai; a 1.007ª é aceita (sem teto); `excluir_id` remove o nó e a subárvore.
- **G — banco:** INSERT/UPDATE direto recusa pai de outro tipo, pai de outra empresa, tipo fora do domínio, autorreferência e troca de tipo de pai com filhos. `RESTRICT` na exclusão do nó e da empresa. RLS ligado e 0 grants públicos.
- **Tabelas proibidas:** Lote, Produto, Movimentação, nota, rebanho, Parceiros e Centros ficam iguais antes e depois.
