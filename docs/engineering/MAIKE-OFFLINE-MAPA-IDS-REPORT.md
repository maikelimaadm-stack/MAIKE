# MAIKE-OFFLINE-MAPA-IDS — relatório (D-PROD-204)

**Data:** 2026-11-14 · **Decisão:** [D-PROD-204](./DECISIONS.md) · **Branch:** `claude/relaxed-bardeen-jlgbp7` (PR #280), base `main`

> **Numeração:** nasceu D-PROD-198. Antes do merge, a `main` deu a D-PROD-198 ao peso projetado do lote, e a PR #290 já usa a D-PROD-203; esta decisão é a **D-PROD-204**. A branch nasceu empilhada sobre a PR #279 (emenda R2 da D-PROD-195); depois do merge da #279 foi atualizada por merge com a `main` (sem rebase) e passou a mirar a `main`.

## 1. Problema

`syncOfflineEntityQueue` (`src/lib/offline/offlineEntityRuntime.js`) monta o mapa
`mapaDeIds` (`offline_… → id do servidor`) a cada passada do replay, e o laço para
no primeiro erro. Uma passada podia criar a área A, que saía da fila, e parar
antes de enviar o lote B que cita A. A parada vinha de uma falha transitória (503,
timeout) em B ou em qualquer item entre os dois. Na passada seguinte o mapa estava
vazio e B ia ao servidor com o id `offline_…` de A:

- **com FK**, o servidor recusava, e a fila travava nesse item para sempre;
- **sem FK** (`Lote.area_atual_id`, `Lote.categoria_manejo_id`), a referência era gravada solta;
- a **edição** ou a **exclusão** do próprio A deixada para a passada seguinte tinha
  `record_id = offline_…`. O replay não a enviava, porque o alvo ainda era id
  offline, e a tirava da fila: a edição se perdia, e a exclusão não chegava ao servidor.

O defeito é anterior à D-PROD-195. Estava registrado como pendência na emenda R2.

## 2. Correção

| Ponto | O que mudou |
|---|---|
| `gravarIdDoServidorNaFila` (novo) | Depois do `create` confirmado e **antes** de `removerDaFila`, relê a fila e, com `atualizarNaFila`, troca o id offline pelo do servidor no `record_id` e em `data` de todo outro item que o cita. Inclui itens retidos, em quarentena, de outro dono e os que chegaram durante a passada |
| Ordem | criar no servidor → reescrever dependentes → cache → tirar da fila. Falha na reescrita propaga e o `create` fica na fila |
| `substituirIdsMapeados` | Troca só id `offline_…`, por chave própria (`Object.create(null)`). Troca também dentro de listas e não casa mais com o protótipo (`"constructor"`) |
| Retenção | Nenhuma nova. Só `criacoesRetidas` (R2) segura item, e esses ids nunca são criados nem reescritos |

Alternativa descartada: persistir o mapa à parte. Exigiria store e versão nova no
IndexedDB, e o mapa teria de ser aplicado em todo leitor da fila (listas,
pendências do registro, liberação da quarentena). Com a reescrita, a fila fica
sempre coerente sozinha.

**Resíduos aceitos.**
1. Sem idempotência no `create`, uma falha entre a criação no servidor e a saída
   da fila faz a passada seguinte criar de novo (duplicata). O risco é anterior a
   esta decisão. Os dependentes já reescritos apontam para o primeiro registro,
   que existe.
2. O cache de outra entidade com a cópia offline do dependente não é reescrito.
   A lista usa a criação pendente da fila, que já tem o id do servidor, e a cópia
   é trocada quando o dependente sincroniza.

## 3. Provas

Novo `tests/smoke/offlineMapaDeIdsEntrePassadas.test.js`, no molde de
`categoriaManejoCriacaoOnline` (porta em memória), com 6 testes, de (a) a (f), descritos na
D-PROD-204. Com o runtime anterior (`git stash` só do runtime), **os 6
reprovam**; com a correção, os 6 passam.

| Verificação | Resultado |
|---|---|
| `offlineMapaDeIdsEntrePassadas` + `offlineRuntime` + `estoqueP0FilaOfflineLegada` + `loteDeleteOfflineBloqueado` + `loteExclusaoCacheOffline` + `categoriaManejoCriacaoOnline` | 69/69 |
| `npm run verify:all` | antes do merge com a `main`: todas as etapas passaram. Na árvore mergeada, só falham 4 testes de `detalhesLoteCutoverPendente`, regressão que veio da `main` e não desta PR (ver §4) |

## 4. `verify:all`

Rodado localmente no commit `f8d6e4ca`, com um PostgreSQL 16 local e o banco dedicado `maike_verify`. A CI do GitHub não rodou: os jobs `classify` e `verify:all` terminam em 2 s sem runner, e o mesmo acontece na base (PR #279), porque o GitHub Actions do proprietário está pausado.

| Etapa | Resultado |
|---|---|
| gates (`test:gates` e os `gate:*`) | PASS (863/863 no `test:gates`) |
| `prisma:generate`, `gate:types`, `typecheck:backend`, `lint` | PASS |
| `test:smoke` | PASS: 230 arquivos, 2.835/2.835 |
| `build`, `build:admin`, `admin-isolation:bundles` | PASS |
| `test:backend` | PASS: 1.900 testes, 1.895 passaram, 0 falhas, 5 `todo` |

Na primeira rodada do `verify:all`, o `test:backend` teve 4 falhas, todas do ambiente local e não desta mudança, que é só de frontend:
- `transporteNativo` (P4B, CORS): faltava `FRONTEND_ORIGINS=http://localhost:5173` (o valor de `.env.example`), que o backend lê ao carregar o módulo;
- `usuariosBenchEscopo` (BE-04, "credencial no log"): a senha do banco local era a palavra `postgres`, que aparece dentro de `postgresql://` no log.

Com `FRONTEND_ORIGINS` definido e uma senha aleatória, o `test:backend` passou inteiro (0 falhas). As demais etapas não dependem dessas duas variáveis e já tinham passado na primeira rodada.

### 4.1 Depois do merge com a `main` (`26153f2c`, base `main` `8d4b36a1`)

| Etapa | Resultado |
|---|---|
| `test:gates` e os `gate:*` | PASS (921/921 no `test:gates`) |
| `prisma:generate`, `gate:types`, `typecheck:backend`, `lint` | PASS |
| `test:backend` | PASS: 2.053 testes, 2.048 passaram, 0 falhas, 5 `todo` |
| `test:smoke` | **FAIL**: 238 arquivos, 2.893 de 2.897 testes passaram. As 4 falhas são todas em `tests/smoke/detalhesLoteCutoverPendente.test.jsx` ("Juntar Lotes permanece visível quando indisponível": o formulário abre quando deveria ficar fechado) |
| `build`, `build:admin`, `admin-isolation:bundles` | PASS |

**As 4 falhas não são desta PR.** Elas se repetem iguais com o `offlineEntityRuntime.js` da `main` no lugar do desta branch, e o resto do diff é documentação e um teste novo. Um `git bisect` na `main` (de `890eaff6`, verde, até `8d4b36a1`) aponta como primeiro commit vermelho o `71dde7d3` ("Unifica abertura em grade e amplia ícones e nomes em todas as telas", da PR #291, já mergeada). A correção é da missão dessa tela e fica fora desta PR (R7).
