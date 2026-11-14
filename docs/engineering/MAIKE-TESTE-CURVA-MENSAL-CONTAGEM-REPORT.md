# MAIKE — teste da CONTRACT D-PROD-194: contagem de migrations pela pasta

**Data:** 2026-11-14 · **Tipo:** correção só de teste · **Produção:** intocada

## Origem

O GitHub Actions do proprietário está sem runner. Por isso as PRs #269, #271, #274 e
#273 entraram na `main` sem CI. Para compensar, fiz duas coisas na `main` `a65ea468`:

- rodei o `verify:all` local completo, em banco novo;
- fiz uma revisão adversarial do diff `00a06096..a65ea468`, em 4 frentes, com
  verificação cética de cada achado.

O `verify:all` passou em todas as etapas (backend 1876 testes, 0 falhas; smoke 2805).
A revisão confirmou um único achado, e ele está nos testes, não no código de produção.

## Achado

`backend/tests/cadCurvaGanhoMensalMigration.test.mjs` (PR #273, D-PROD-194):

- O teste monta a partida com **todas** as pastas de migration menos esta CONTRACT.
- Mesmo assim, conferia o histórico contra números fixos: 48 na partida e 49 depois.
- Qualquer migration nova na pasta quebraria os 10 casos, mesmo sem nada a ver com a
  Curva de Ganho. A próxima a entrar é a da PR #276.
- Os outros testes de CONTRACT já tiram a contagem da pasta: D-PROD-162, D-PROD-183,
  D-PROD-187 e o Estoque P1-03.

## Correção

- `TOTAL_MIGRATIONS` vem da pasta.
- `MIGRATIONS_PARTIDA = TOTAL_MIGRATIONS - 1`.
- As 6 asserções de histórico e os textos dos testes passam a usar essas constantes.
- Nada mais muda. A contagem de tabelas (85) continua fixa, como no teste da D-PROD-187:
  uma migration que cria tabela atualiza os dois testes juntos.

## Prova (PostgreSQL 17 local, banco descartável)

| Rodada | Resultado |
|---|---|
| Teste da `main` + a migration da PR #276 na pasta (RED) | 0/10: os 10 casos falham na contagem |
| Teste corrigido na árvore inteira da PR #276 (schema e migration) | **10/10** |
| Teste corrigido na `main` `a65ea468` | **10/10** |

Houve também uma rodada só com o `migration.sql` da #276, sem o schema dela. Nela o CM-03
falhou no `migrate diff`, porque faltavam as colunas no `schema.prisma`. A falha veio da
montagem da prova, não da correção: na árvore completa o teste passa.

## Fora do escopo

- A PR #275 e a PR #276 citam as duas a **D-PROD-195**. Uma delas precisa renumerar
  antes do merge.
- A migration da PR #276 (`20261114200000_tipo_atividade_defaults`, CONTRACT) **não foi
  aplicada** em nenhum banco remoto.
