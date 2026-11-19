# MAIKE-ESTOQUE-E1-E2 — Relatório: tela Estoque com Saldo e Movimentos (D-PROD-255)

**Data:** 2026-11-19 · **Branch:** `cursor/estoque-saldo-movimentos` (a partir da `main` `9d791735`) · **Migration:** nenhuma · **Decisão:** [D-PROD-255](./DECISIONS.md)

## O que entrou

Uma página **Estoque** (menu **Suporte do Mapa → Estoque**, `/estoque`) com duas abas, só consulta:

- **Saldo:** produto × depósito, derivado das **camadas** disponíveis (única fonte de saldo do motor). Quantidade na unidade do produto (L ou kg), **Custo** (média ponderada das camadas que restam, informativo; o motor segue FIFO) e **Valor**.
- **Movimentos:** o kardex da fazenda, paginado por keyset, com filtros de produto, depósito, origem, tipo e data e busca. Uma linha abre o detalhe numa `B1Janela` (680px; tela cheia no celular), somente leitura: saldo antes e depois, custo, camadas consumidas, documento de origem (link) e o par original ↔ estorno.
- Do Saldo para os Movimentos: abrir a linha (duplo clique, Enter ou **⚡ › Ver movimentos**) filtra por produto e depósito.
- Entradas e Inventário **não existem** (nem aba desabilitada).

## Servidor

| Rota | O que faz |
|---|---|
| `GET /estoque/saldo` | `empresa_id`; `produto_id`, `local_estoque_id`, `q`, `somente_com_saldo` (padrão `true`), `limit` (padrão 100, máx. 500), `cursor`. Item: `chave, produto_id, produto_nome, produto_codigo, local_estoque_id, local_estoque_nome, unidade, quantidade, custo_medio, valor, camadas` |
| `GET /estoque/movimentos` | `empresa_id`; `produto_id`, `local_estoque_id` (origem **ou** destino), `origem_sistema`, `tipo_movimentacao` (`Entrada`\|`Saída`), `data_de`, `data_ate`, `q`, `limit`, `cursor`. Ordem `(data_movimentacao DESC, id DESC)` |
| `GET /estoque/movimentos/:id` | `empresa_id`. Resumo + `custo_medio_antes/depois`, `motivo`, `observacoes`, `responsavel`, nota/fornecedor, `vinculos`, `documento {tipo,id,numero,rotulo,pagina}`, `camadas_consumidas[]`, `pai`, `filho`, `criado_em` |
| `GET /estoque/opcoes/produtos`, `/estoque/opcoes/locais` | opções dos filtros (por nome, keyset) |

Envelope das listas: `{ items, next_cursor, has_more, total, limit }`. Decimais sempre como texto. O cursor é **assinado** (HMAC, rótulo `maike-estoque-consulta-cursor:v1`) e amarrado a tenant, empresa, filtros e limite. Querystring fechada; o tenant vem só do `auth_context`.

## Permissão

Tela nova **`sup-estoque`** (módulo `suporte-mapa`), ação `visualizar` → `GUARDAS.estoque.ver` nas cinco rotas. Sem linha = negado; administrador real e `is_admin` têm tudo. **Reservada, não criada:** a permissão de entrada e ajuste será ação extra (`entrada`, `ajuste`) da mesma linha, separada de `visualizar`.

## Testes

- Backend (PostgreSQL real, `backend/tests/estoqueConsulta.test.mjs`): soma e custo ponderado das camadas, unidade, filtros, paginação keyset estável (inclusive empate de data e inserção no meio), cursor adulterado/de outro filtro/de outro tenant, isolamento por tenant e empresa, 401/403 em todas as rotas, querystring fechada, detalhe, par de estorno e a transferência pelo motor real.
- Navegador (`tests/smoke/estoqueTela.test.jsx`): abas só Saldo e Movimentos, colunas e formatos (R$, kg, DD/MM/AAAA), filtro por clique, ⚡, janela de detalhe (um diálogo, sem gravar), celular em tela cheia, sem permissão nada é lido e o item de menu só com `visualizar`.
- Registro: `config/mapa-manejo-scope.json`, `vercel.json` (pelo gerador), `pages.config.js`, `menuConfig.js`, ícone do menu do celular, testes de escopo e de rotas SPA.
- Prévia da Vercel: `ignoreCommand` também deixa passar a branch exata `cursor/estoque-saldo-movimentos` (padrão D-PROD-251). A exceção sai quando a branch não for mais necessária.

## Fica para depois (decisões do proprietário)

Entradas (saldo inicial, doação, outra causa), Inventário (saldo inicial **e** contagem periódica com ajuste e motivo), saída manual com motivos fixos, **custo médio** no lugar do FIFO, estorno de transferência e de suplementação. Regras já valendo: movimento imutável (estorno), saldo nunca negativo, permissão de entrada/ajuste separada da de consulta.
