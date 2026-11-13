# FIX-FLAKY-LANC1-ACT — aviso "not wrapped in act" intermitente no LANC-1

**Data:** 2026-11-13
**Branch:** `claude/epic-maxwell-g91pd0`
**Escopo:** só o teste `tests/smoke/gestaoLancamentos.test.jsx`. Nenhum arquivo de `src/` muda.

## Sintoma

O caso "LANC-1 — lista, filtros, perfil e fuso > lista mostra nº, situação, parceiro e total formatado no
locale do perfil; filtros vão ao servidor" falhava de forma intermitente no shard
`verify:full (smoke 2/2)`. Um exemplo é a run 43488911213, no commit `7e866054` da PR #263, que não tocava
o frontend.

O guarda de `console.error` em `tests/smoke/setup.js:93` capturava:

```
Warning: An update to LancamentosFinanceirosTela inside a test was not wrapped in act(...)
    at LancamentosFinanceirosTela (src/components/financeiroGestao/LancamentosFinanceirosTela.jsx:61:45)
```

A linha 61 (predicado `ehConsultaDeEstoque`) não tem relação com a causa: é só a coluna que o source map
atribui ao componente. O stack aponta o componente dono do estado, não a origem da atualização.

Isolado, o arquivo passava 8 de 8 vezes localmente.

## Correção anterior insuficiente

O commit `5d56e65` criou `listaAplicada`, que espera `isFetching() === 0` e um `setTimeout 0` dentro do
`act`, mas só no **fim** do teste. Ele já estava no commit `7e866054` que falhou, portanto não cobria a causa.

## Causa raiz

1. `LancamentosFinanceirosTela` dispara **em paralelo** a consulta do perfil financeiro
   (`[QUERY_RAIZ, "perfil", empresaId]`) e a da lista (`[QUERY_RAIZ, "page", …]`). As duas são habilitadas no
   mesmo render (`acoes.ver`).
2. O teste esperava só a linha da lista (`findByTestId`). A linha pode aparecer **antes** do perfil chegar.
   A asserção `R$ 1.000,00` passa mesmo assim, porque o padrão `PERFIL_SEM_CONFIGURACAO` também é pt-BR/BRL.
3. Logo depois vinha `await import('./fixtures/gestaoBackendFake.js')`. Por causa do `vi.resetModules()` no
   `beforeEach`, esse import reavalia o módulo: é um `await` de verdade, uma macrotarefa **fora de `act` e
   fora de `waitFor`**, com `IS_REACT_ACT_ENVIRONMENT` ligado.
4. Se a resposta do perfil caísse nessa janela, o react-query entregava o resultado (`setTimeout 0` do
   `notifyManager`) ao `useQuery` de `LancamentosFinanceirosTela` fora de `act`. O React acusava o aviso e o
   guarda reprovava o teste.

Sob a carga da CI, a ordem "lista antes do perfil" combinada com o tempo do import dinâmico acontece com
frequência. Sem carga, o perfil quase sempre chega antes. A mesma janela (`await import` no meio do teste)
existia no LANC-2 ("A PAGAR · com produtos…").

O componente não tem atualização depois de desmontar. A atualização do perfil é legítima: só caía fora do
`act`. Por isso a correção fica no teste.

## Correção

Em `tests/smoke/gestaoLancamentos.test.jsx`:

- `escolherOpcao` passa a ser importado **estaticamente**, junto de `API_FAKE` e `instalarBackendFake`. Os dois
  `await import(...)` no meio dos testes (LANC-1 e LANC-2) saem, e com eles as janelas fora de `act`.
- `listaAplicada` passa a se chamar `consultasAssentadas`, com o mesmo corpo: espera
  `queryClient.isFetching() === 0` e entrega o `setTimeout 0` do react-query dentro do `act`. O LANC-1 agora o
  chama **também logo depois de a linha aparecer**, o que garante que o perfil entrou na tela antes de
  qualquer interação. A chamada no fim do teste continua.
- A linha é relida depois de assentar (`getByTestId`), em vez de guardar o nó do primeiro `findBy`.

O guarda de `console.error` não foi silenciado, nenhum teste foi pulado e nada foi para quarentena.

## Prova

### Reprodução determinística

Uma cópia temporária do arquivo (não versionada) atrasava **só** o `GET /perfis-financeiros-empresa` no
backend falso. Com 20 ms de atraso, o aviso saiu com o mesmo stack da CI
(`LancamentosFinanceirosTela.jsx:61:45`).

| Matriz de atraso fixo do perfil (1, 5, 10, 15, 20, 25, 30, 40, 60, 100, 150 ms) | Falhas |
|---|---|
| Teste anterior | 4/11 (1, 25, 30 e 100 ms) |
| Teste corrigido | **0/11** |

O resultado depende da janela em que a resposta cai, e por isso a falha é intermitente: com 60 ou 150 ms ela
cai dentro de um `waitFor` posterior e passa por acaso.

### Atraso aleatório em todas as requisições

A mesma cópia temporária, agora com atraso aleatório de 0 a 40 ms em **toda** resposta do backend falso.
O LANC-1 rodou 40 vezes por versão, 4 processos simultâneos:

| Versão | OK | Falhas |
|---|---|---|
| Teste anterior | 26 | **14** |
| Teste corrigido | 40 | **0** |

### Arquivo real com CPU limitada

O arquivo inteiro, sem modificação (45 testes), rodou 24 vezes com `--pool=forks`. Eram 4 execuções
simultâneas presas a 2 CPUs (`taskset -c 0,1`): **24/24 verdes, 45/45 em cada uma**.

### Gates

`npm run verify:all` local verde: **TODAS AS ETAPAS PASSARAM**, incluindo `test:backend` contra PostgreSQL 16 efêmero, `test:smoke`, `build` e `build:admin`.

## Fora do escopo

- Nenhuma mudança em `src/`, em `tests/smoke/setup.js` ou nas fixtures.
- Não há decisão de produto, portanto nenhuma entrada nova em `DECISIONS.md`. A contagem de testes não muda.
