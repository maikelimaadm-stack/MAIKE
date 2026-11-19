# MAIKE-ESTOQUE-ENTRADAS — Relatório: aba Entradas do Estoque (D-PROD-257)

**Data:** 2026-11-19 · **Branch:** `cursor/estoque-entradas` (empilhada em `cursor/estoque-custo-medio`, PR #337) · **Migration:** `20261119100000_estoque_entradas` (**EXPAND**) · **Decisão:** [D-PROD-257](./DECISIONS.md) · **PR 2 de 2**

## O que foi feito

Aba **Entradas** na tela única Estoque (menu Suporte do Mapa → Estoque, `/estoque`), com lista Base1, formulário único em janela, detalhe, **Editar observação** e **Excluir**. O inventário inicial é o motivo `SALDO_IMPLANTACAO`; não há aba "Inventário" (contagem periódica e ajuste ficam para depois).

- **Backend** (`backend/src/modules/estoqueEntradas/`): `POST/GET /estoque/entradas`, `GET /estoque/entradas/:id`, `PATCH /estoque/entradas/:id` (só observação e justificativa), `POST /estoque/entradas/:id/excluir`, seletores do formulário. Toda mudança de estoque passa pelo motor (`aplicarEntradaDocumentada`/`estornarEntradaDocumentada`, os únicos pontos que citam a origem; P7 preservado).
- **Motivos fechados:** `SALDO_IMPLANTACAO`, `DOACAO`, `OUTRA_COM_JUSTIFICATIVA` (20+ caracteres). Motivo imutável.
- **Custo:** negativo recusado; **zero só com `custo_zero` declarado** e, fora da doação, com justificativa.
- **Implantação:** uma ativa por produto/empresa e só para produto sem histórico físico; reimplantação depois de exclusão segura.
- **Excluir:** exclusão lógica com estorno integral e prova fail-closed (camada intocada, custo inalterado, sem fatia nem citação em baixa).
- **Permissão:** ação extra `entrada` de `sup-estoque` (back e front em paridade); ninguém a recebe por padrão; 403 no servidor. `ajuste` segue reservada.
- **Reconciliação:** a origem entra em `ORIGENS_PROTOCOLO` e a camada estornada é explicada pela FK do estorno.

## Migration (o que faz e o que roda no merge)

Cria **3 tabelas novas** (`EntradaEstoque`, `EntradaEstoqueItem`, `EntradaEstoqueEvento`) com `cliente_id`, FKs compostas, uniques e índices por `cliente_id`, CHECKs, um índice único parcial (par vigente) e RLS pinada. Não altera tabela existente nem migra dados. `classificarMigrations`: **EXPAND**; sem GO e sem `MIGRATIONS_CONTRACT_APROVADAS`.

**No merge:** código + essa migration EXPAND, pelo **caminho normal de deploy**, **só depois do merge manual desta PR e depois da #337**. **Nada foi aplicado em produção.** `deploy:migrate` foi rodado só no `maike_dev` local (recriado). A migration das áreas da atividade (D-PROD-249, CONTRACT) precisa estar concluída antes.

## Testes (Postgres real; banco local recriado antes de cada arquivo)

| Arquivo | Resultado |
|---|---|
| `backend/tests/estoqueEntradas.test.mjs` (novo, 34) | 34/34 |
| `estoqueP1M2MotorParametros` (P7 atualizado) | 8/8 |
| `estoqueP0Reconciliacao`, `...Cobertura`, `...R2` | 18/18, 10/10, 16/16 |
| `tests/smoke/estoqueEntradas.test.jsx` (novo, 9) + `estoqueTela` + permissões/menus | verdes |
| `scripts/tests/deploy/premerge-migrate.test.mjs` | 188/188 (69 pastas) |
| gates `types`, `governance-paths`, `tenancy`, `indices`, `product-scope`, `import-integrity`, `no-secrets`, `base44`, `api-boundary`, `native-api` | passam |

Não rodei `verify:all` (banco local sujo). Veja a seção seguinte para os testes de migration que contam pastas e tabelas.

## Pontos abertos (não escondidos)

1. **Consulta recíproca da P3** (compra/venda → entrada, nos três caminhos): **não feita**; é bloqueio de liberação do contrato (A5). A entrada → compra/venda e entrada → entrada estão feitas. Por isso, nenhum perfil recebe `entrada` por padrão.
2. **Edição física por revisão** (P1-05b), janela FIFO / R-DATA, aviso "registre a implantação antes" na prévia da primeira compra, parceiro no documento: fora desta PR.
3. **Constituição:** a emenda do custo médio (D-PROD-256) segue pendente de ratificação no merge da #337; esta PR não a aprova.
4. A exclusão é **mais estrita** que a do contrato original: com o custo médio, a camada precisa ter o **custo inalterado** (nenhuma baixa posterior no poço).
5. O reenvio do formulário reaproveita a `operation_id` só enquanto a janela está aberta (sem pendência persistida em storage, como a do abastecimento).
