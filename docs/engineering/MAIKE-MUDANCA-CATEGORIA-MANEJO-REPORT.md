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

_(preenchido ao fim da missão.)_
