# MAIKE-MUDANCA-CATEGORIA-MANEJO — relatório (D-PROD-199)

**Data:** 2026-11-14 · **Decisão:** [D-PROD-199](./DECISIONS.md) · **Branch:** `claude/kind-knuth-tztu1v`

## 1. Entrega

- **Mudança de Categoria:** depois da categoria nova, a tela mostra a categoria de manejo que o lote vai receber.
  - Com mais de uma possível, exige a escolha (select sem pré-escolha) e não envia sem ela.
  - Sem nenhuma, avisa que o lote fica sem curva de ganho e sem peso objetivo.
  - O id da categoria de manejo é resolvido no envio, a partir das ativas lidas do servidor.
- **Cadastro de Categoria de Manejo:** aviso, que não bloqueia, quando outra categoria ativa da fazenda tem o mesmo sexo e a mesma faixa de idade.
- **Funções puras novas** em `src/domain/lotes/categoriaOficialDerivada.js`: `categoriasManejoParaMudanca` e `categoriasManejoDuplicadas`.
- **Fora do escopo:** sem migration; sem mudança no servidor, que já valida o id e recusa a escolha ambígua.

## 2. Arquivos

- `src/components/lotes/FormularioMudancaCategoria.jsx`: `categoriaManejoDaLinha`, `CategoriaManejoDestino` e a validação no envio.
- `src/components/categorias-manejo/FormularioCategoriaManejo.jsx`: prop `categoriasDaFazenda` e o aviso sob a Faixa de idade.
- `src/pages/CategoriasManejo.jsx`: a lista da fazenda, pela mesma chave da grade.
- `src/domain/lotes/categoriaOficialDerivada.js`: as duas funções puras.
- `tests/smoke/mudancaCategoriaManejoDestino.test.jsx`: 7 testes.
  - Funções puras.
  - Mudança com uma, duas e nenhuma categoria de manejo possível.
  - Aviso no cadastro, nos modos edição e leitura, e com faixa diferente da mesma oficial.
  - Os 3 testes da Mudança falham com o formulário antigo (conferido).

## 3. Dados de produção observados (só leitura)

Fazenda com 10 categorias de manejo. Repetidas:
- "TESTE" e "BEZERRO MAMANDO" (Macho 0 a 8);
- "VACA LEITERA" e "GARROTE 13 A 24 MESES" Fêmea, que está com faixa 37+.

Também faltam as fêmeas de 13 a 24 e de 25 a 36 meses. A correção fica com o proprietário, no cadastro.

## 4. Verificação completa e revisão

**`npm run verify:all` local** (Postgres 16, `maike_verify`), primeira rodada: 3 etapas vermelhas.
- `gate:types`: 2 diagnósticos novos (TS2339) no JSDoc de `categoriaManejoDaLinha`. Corrigido; o `gate:types` passa (549 de dívida, teto 625).
- `test:backend`: o Postgres local parou no meio da rodada (`P1001`). Rodou de novo e passou: 899 + 1.978 testes, 0 falhas.
- `test:smoke`: 2.874 de 2.875 passam. A falha é `detalhesCochoNiveis.test.jsx` DC-1, que **não é desta missão**.
  - A falha é igual na `main` limpa (`02ea10b5`); no `2b211d7b` o arquivo passa 9/9.
  - O PR #284 trocou "Dias desde o lançamento" por "Dias desde o abastecimento" em `DetalhesPontoSuplementacao.jsx` e não atualizou o teste.
  - A correção, uma linha no teste, fica numa missão própria (R7).

**GitHub Actions** (voltaram a rodar) no head `b34b9606`: 8 de 10 jobs verdes, incluindo o backend com PostgreSQL efêmero. O vermelho é o mesmo DC-1, no `verify:full (smoke 1/2)`, e o agregador `verify:all`, que reprova por causa dele.

**Testes da missão:** os 7 de `mudancaCategoriaManejoDestino.test.jsx` passam; os 3 da Mudança falham com o formulário antigo.
