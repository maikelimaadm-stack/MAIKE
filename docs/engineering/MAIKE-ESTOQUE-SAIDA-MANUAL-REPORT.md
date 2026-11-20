# MAIKE-ESTOQUE-SAIDA-MANUAL — Relatório: saída manual no "Novo movimento" (D-PROD-263)

**Data:** 2026-11-20 · **Branch:** `claude/new-session-26kpxu` (a partir da `main` `d8fa5ced`) · **Migration:** `20261120100000_estoque_saidas` (**EXPAND**, 4 tabelas novas, **aplicada em produção** em 2026-11-20) · **Decisão:** [D-PROD-263](./DECISIONS.md) · **Runbook:** [`MAIKE-ESTOQUE-SAIDA-MANUAL-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-SAIDA-MANUAL-RUNBOOK-RELEASE.md)

## 1. Pedido e escolhas do proprietário

Próximo passo do Estoque: **saída manual**. Escolhas (2026-11-20):

| Pergunta | Escolha |
|---|---|
| Motivos prontos | Perda, Consumo interno, Doação e Vencimento; o resto o usuário cria |
| Valor da saída | Custo médio automático do depósito (não se digita) |
| Excluir uma saída lançada | Sim, só se nada mexeu depois naquele produto e depósito |
| Quem lança | Permissão própria `saida`, separada de `entrada`; ninguém recebe por padrão |

## 2. O que esta PR faz

- **Tela:** o "Novo movimento" (Estoque → Movimentos) ganha o tipo **Saída**:
  - cabeçalho: data, motivo, centros e observação;
  - várias linhas: produto, depósito, unidade e quantidade;
  - "Motivos…" abre o cadastro de motivos de saída na mesma janela;
  - o detalhe de um movimento de saída manual (e do estorno dela) abre a saída (editar a observação, excluir);
  - com um tipo só permitido (só `saida`), a janela já abre na Saída; o cadastro de motivos virou um componente comum à entrada e à saída.
- **Backend:** módulo `estoqueSaidas`:
  - cadastro de motivos de saída;
  - saída com idempotência por `operation_id`;
  - edição só da observação;
  - exclusão com estorno.
- **Motor de estoque:**
  - origem nova `saida_estoque`;
  - dois invólucros: `aplicarSaidaDocumentada` (custo médio, fatias no próprio movimento) e `estornarSaidaDocumentada` (devolve cada fatia e o valor exato);
  - a reconciliação conhece a origem nova.
- **Permissão:** ação extra `saida` da tela `sup-estoque`, no servidor e no navegador. Os seletores do formulário (produtos, depósitos, centros) aceitam `entrada` ou `saida`.

## 3. Regras que o servidor garante

- Baixa só pelo motor, a **custo médio** do depósito; o valor nunca vem da tela.
- Saldo insuficiente no depósito: 422 `ESTOQUE_SALDO_INSUFICIENTE`, e **nada** é gravado.
- Unidade compatível com o produto (L só para produto em L; SACO usa o peso do saco).
- Um par produto × depósito por saída.
- Data não futura; motivo e centros ativos e da fazenda.
- **Excluir** só sem movimento posterior do produto no depósito. Senão, 409 `SAIDA_ESTOQUE_MOVIMENTO_POSTERIOR` com o número do movimento que impede. "Depois" é fail-closed: pelo número sequencial do movimento, dado sob a trava do produto, ou pelo instante de criação.
- A saída não cria título, conta a receber nem receita.

## 4. Constituição: emenda APROVADA

O texto ratificado só autorizava a baixa de estoque pelos fluxos listados (venda da Central, suplementação, abastecimento, apontamento, transferência). A saída manual é um escritor novo. A emenda da D-PROD-263 foi **aprovada pelo proprietário em 2026-11-20** ("Aprovo as duas") e está aplicada como parágrafo próprio em `00-CONSTITUICAO.md` §1 e nota própria em `07-DO-NOT-DO.md`, depois das da D-PROD-261.

## 5. Migration e ensaio

- **EXPAND puro** (`classificarMigrations`: ok, 4 tabelas novas, nenhuma coluna em tabela antiga, nenhum CONTRACT). SHA-256 `3cc70cdd…14e0` pinado em `MIGRATIONS_APROVADAS`; bloco RLS `c0806122…ffe3` em `DO_RLS_APROVADOS`.
- `prisma migrate diff` (banco migrado × `schema.prisma`): vazio.
- **Ensaio do envelope do caminho B** (PostgreSQL 17 local, base com as 70 migrations de produção):

  | Passo | Resultado |
  |---|---|
  | `system_identifier` de produção | recusou (`RELEASE_BLOCKED: alvo divergente`), nada aplicado (70) |
  | `system_identifier` local | aplicou: 71 concluídas, 105 tabelas, checksum pinado |
  | 2ª execução | recusou (`RELEASE_BLOCKED: migration já registrada`) |
  | `migrate status` | up to date |
  | `migrate diff --exit-code` | 0 |

- **Aplicada em produção** em 2026-11-20 01:15:39 UTC, pelo caminho B, com o GO do proprietário ("Aprovo as duas"). Envelope idêntico ao ensaiado.

  | Conferência | Resultado |
  |---|---|
  | Preflight | sid confere; 70 concluídas, 0 ruins; a anterior com o checksum certo; as 4 tabelas ausentes; 101 tabelas |
  | Postcheck | 71 concluídas, 0 ruins; a nova com o checksum pinado e 1 passo; 105 tabelas |
  | Tabelas novas | RLS ligado sem FORCE; política só para `maike_vercel`; 0 GRANT público; constraints e índices válidos; 0 linhas |
  | Supabase advisors (security) | nenhum alerta |

## 6. Testes

| Arquivo | Resultado |
|---|---|
| `backend/tests/estoqueSaidas.test.mjs` (novo, Postgres real) | 15/15 |
| `backend/tests/estoqueEntradas.test.mjs` (paridade da ação `saida`) | 47/47 |
| `estoqueDocumentoDedupe`, `estoqueP0*` (motor, reconciliação), `estoqueP1M2/M4`, `estoqueConsulta`, `estoquePecuarioLedgerContrato`, `g2PontosLigacoes` | verdes |
| `estoqueConsulta` (o detalhe do movimento aponta a saída: `documento.tipo = SAIDA_ESTOQUE`) | 23/23 |
| provas da release (`run-gate-tests`, com B38a/B38b/B38k novos) | 1048/0 |
| testes de migration (`estoqueEntradasMotivosMigration`, `patrimonioSimplificaMigration`, `categoriaManejoCadcategoriaMigration`, `abastecimentoAtividadeMigration`, `sqlEditorBootstrap` e os demais `*Migration`) | verdes |
| `tests/smoke/estoqueNovoMovimento.test.jsx` (14 testes novos da Saída) + `estoqueTela` | 26 + 13 |
| `tests/smoke` inteiro | 300 arquivos, 3753 testes, todos verdes |
| `npm run verify:all` (banco novo) | ver o corpo da PR |

## 7. Fora de escopo

Ajuste de inventário, devolução a fornecedor, edição física da saída (exclui e lança outra), cor por tipo.
