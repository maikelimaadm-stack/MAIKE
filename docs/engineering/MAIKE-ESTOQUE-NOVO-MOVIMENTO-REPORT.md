# MAIKE-ESTOQUE-NOVO-MOVIMENTO — Relatório: "Novo movimento" em Movimentos, motivos de entrada por cadastro (D-PROD-259)

**Data:** 2026-11-19 · **Branch:** `claude/new-session-26kpxu` (a partir da `main` `c2991afd`) · **Migration:** `20261119200000_estoque_entradas_motivos` (**CONTRACT**) · **Decisão:** [D-PROD-259](./DECISIONS.md) · **Runbook:** [`MAIKE-ESTOQUE-NOVO-MOVIMENTO-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-NOVO-MOVIMENTO-RUNBOOK-RELEASE.md)

## 1. Antes desta PR: a migration das Entradas foi aplicada em produção

As PRs #335, #337 e #340 entraram na `main` sem a `20261119100000_estoque_entradas` aplicada, e a aba Entradas dava erro no ar. Com o GO escrito do proprietário ("Conferir e aplicar", depois "pode sim"), ela foi aplicada pelo **caminho B**:
- uma transação pelo `execute_sql` do Supabase;
- guardas: `system_identifier`, trava 72707369, histórico exato de 68 migrations, tabelas ausentes;
- o `migration.sql` integral;
- o registro em `_prisma_migrations`.

| Item | Valor |
|---|---|
| Registrada | 2026-11-19 17:54:41 UTC, checksum `1bcac655…22d0`, 1 passo |
| Envelope | SHA-256 `6014414a532013394e0595770a55920da1f3af1376506c36f18383781b69afe6` |
| Histórico | 69 concluídas, nenhuma com falha |
| Tabelas | as 3 novas existem e estão vazias; 100 em `public` |
| Proteção | RLS ligado sem FORCE; política só para `maike_vercel`; sem acesso de `anon`/`authenticated`; 11 FKs, 10 CHECKs, 19 índices válidos |
| Supabase advisors (security) | nenhum alerta |
| Site | health ok; `/estoque/entradas` sem login → 401 |

## 2. O que esta PR faz

Pedido do proprietário: escolher o **tipo de movimento** num lugar só, em vez de uma aba separada.

- **Tela.** A aba **Entradas** sai. **Movimentos** ganha **"Novo movimento"**:
  - uma janela com Tipo **Entrada | Transferência**;
  - a Entrada tem cabeçalho (data, motivo, fornecedor, documento, centro de resultado, centro de custo, observação) e linhas de produto (produto, unidade, local, quantidade, valor unitário ↔ total, "Sem custo", lote, validade), com o total;
  - "Saldo de implantação" esconde fornecedor e documento;
  - "Motivos…" abre o cadastro de motivos **na mesma janela**;
  - o detalhe de um movimento de entrada abre o detalhe da entrada (editar observação, excluir).
- **Motivos por cadastro** (`MotivoEntradaEstoque`, por cliente):
  - padrões Compra, Doação e Saldo de implantação, criados na primeira leitura;
  - o usuário cria, renomeia e desativa os de natureza ENTRADA;
  - o de implantação é fixo;
  - sem cor nesta versão.
- **Backend:**
  - `GET/POST/PATCH /estoque/motivos-entrada`;
  - `POST /estoque/entradas` com `motivo_id`, `fornecedor_id`, centros, lote e validade;
  - seletores `/estoque/entradas/opcoes/{fornecedores,centros-custo,centros-resultado}`;
  - a natureza vem do motivo;
  - sem justificativa obrigatória; custo zero só com "Sem custo".
- **Transferência:** usa o comando que já existe. A guarda `transferenciaLocais` passa a aceitar também a ação `entrada` de `sup-estoque`.
- **Kardex:** um movimento de entrada mostra "Entrada nº X — Motivo".

## 3. Migration (CONTRACT) — o que roda e quando

O que ela faz está na D-PROD-259 e no runbook §0. Ela só aplica com as 3 tabelas das Entradas **vazias**, que é o estado de produção hoje.

**Aplicada em produção** em 2026-11-19, com o GO escrito do proprietário e a emenda aprovada ("Aprovo as duas"), pelo caminho B do runbook:

| Item | Valor |
|---|---|
| Preflight (só leitura) | sid confere; 69 concluídas, 0 ruins; a 20261119100000 concluída; a nova não registrada; `MotivoEntradaEstoque` ausente; Entradas, itens e eventos = 0 |
| Envelope | SHA-256 `9b3de9a8874a06d6177fd198000e48a85ff871fdd17f46ac4918c892debb40be` (idêntico ao ensaiado, exceto o `system_identifier`) |
| Registrada | 2026-11-19 19:33:14 UTC, checksum `ebb37b68…1c25`, 1 passo |
| Histórico | 70 concluídas, nenhuma com falha |
| Tabelas | 101 em `public` |
| `MotivoEntradaEstoque` | RLS ligado sem FORCE; política `maike_backend_all` só para `maike_vercel`; 0 GRANT para `anon`/`authenticated`; 2 CHECKs, 1 FK, 4 índices válidos; 0 linhas |
| `EntradaEstoque` / `EntradaEstoqueItem` | 5 CHECKs, 6 FKs, 10 índices / 4 CHECKs, 7 FKs, 10 índices, todos válidos; 0 linhas |
| Supabase advisors (security) | nenhum alerta |
| Site | `/api/native/health` ok, banco up, release `c2991afd`; `/api/native/estoque/entradas` sem login → 401 |

**Até o merge:** o código da `main` ainda grava os motivos antigos; a entrada por doação ou "outra causa" falha no CHECK novo (o saldo de implantação passa). Só o administrador tem `entrada`. O merge resolve.

Ensaio local do envelope (PostgreSQL 17, base de 69):
- aplica;
- a segunda execução recusa;
- `migrate status` up to date;
- `migrate diff` vazio.

## 4. Testes

| Arquivo | Resultado |
|---|---|
| `backend/tests/estoqueEntradas.test.mjs` (reescrito, Postgres real) | 46/46 |
| `backend/tests/estoqueEntradasMotivosMigration.test.mjs` (novo) | 5/5 |
| `tests/smoke/estoqueNovoMovimento.test.jsx` (novo, no lugar de `estoqueEntradas.test.jsx`) | 10/10 |
| `tests/smoke/estoqueTela.test.jsx` | 13/13 |
| `scripts/tests/deploy/premerge-migrate.test.mjs` (B37a/B37b/B37k), `migrations.test.mjs` (B27), `alvo-banco.test.mjs` | verdes |
| `npm run verify:all` (banco local novo) | ver §6 |

## 5. Pontos abertos (não escondidos)

1. **Emenda constitucional aprovada.** O cadastro de motivos com "Compra" e o fim da justificativa obrigatória contrariavam o texto da D-PROD-177. O proprietário aprovou a emenda em 2026-11-19; ela está em `00-CONSTITUICAO.md` §1 e em `07-DO-NOT-DO.md`, como parágrafo e nota próprios da D-PROD-259.
2. **Compra em dobro.** Uma compra pode entrar no estoque pela Central e pela entrada manual. A consulta recíproca na Central (R-DEDUPE) continua pendente. Por isso nenhum perfil recebe `entrada` por padrão.
3. Fora de escopo: saída manual, ajuste de inventário, cor por tipo, edição física por revisão, estorno de transferência.

## 6. Verificação

`npm run verify:all`, rodado num banco PostgreSQL 17 local novo: resultado registrado no corpo da PR.

## 7. A `main` vermelha depois da PR #339 (consertada nesta PR, a pedido do proprietário)

A PR #339 (campos sublinhados, guias laterais com busca, grade de 4 colunas) entrou na `main` com 65 testes de tela falhando em 13 arquivos (Patrimônio, Lançamentos Financeiros, Parceiros, Lote, Produto, Serviço e outros). A `main` foi integrada aqui sem conflito, e os testes foram consertados nesta PR, em commits separados:

- **Testes que esperavam o layout antigo** (campos agora em outra guia, o "Ativo" também no novo, a busca dentro do próprio campo): passam a abrir a guia certa antes de procurar o campo; as conferências (corpo do envio, totais, validações) são as mesmas.
- **Três coisas que a #339 apagou sem decisão, recolocadas:**
  - no Lote, a prévia do ícone da categoria (D-PROD-191);
  - no Lote, o aviso da correção de entrada e o motivo obrigatório (R1);
  - no Bem, o aviso "Escolha o tipo de bem".
- **Fica para o proprietário:** o "Nº patrimonial" do Bem agora só aparece ao consultar um bem gravado (antes aparecia também no novo e na edição); pode ter sido intencional e não foi mexido.

Resultado: `test:smoke` local 3733/3733.
