FATIA: MAIKE-CATEGORIA-MANEJO-ENXUGAR
BRANCH: feat/categoria-manejo-enxugar
PR: #264

# MAIKE-CATEGORIA-MANEJO-ENXUGAR — Relatório (Fatia C)

**Decisão:** [D-PROD-186](./DECISIONS.md) · **Base:** `origin/main` `73aca4f` (merge da PR #261) · **Migration:** nenhuma

## 1. O que mudou

O cadastro de Categoria de Manejo ficou com **Nome, Sigla, Espécie, Sexo e Faixa de idade**, mais o **Ícone oficial** (desenho no mapa). Nome, Sexo e Faixa são obrigatórios. A Espécie continua, numa lista com "Bovinos".

A **Faixa de idade** é uma lista fixa, por decisão do proprietário:

| Opção | Gravado (`idade_minima_meses`, `idade_maxima_meses`) | Categoria oficial (Macho / Fêmea) |
|---|---|---|
| 0 a 8 meses | 0, 8 | Bezerro / Bezerra 0 a 12 meses |
| 9 a 12 meses | 9, 12 | Bezerro / Bezerra 0 a 12 meses |
| 13 a 24 meses | 13, 24 | Garrote / Novilha 13 a 24 meses |
| 25 a 36 meses | 25, 36 | Boi / Vaca 25 a 36 meses |
| Maior que 36 meses | 37, — | Touro + 36 meses / Vaca + 36 meses |

Saíram do formulário, da grade, do CSV, da porta nativa, do service e da API: `raca`, `categoria_oficial`, `ganho_peso_anual_kg` e os 12 `gmd_*`.

| Camada | Arquivo | Mudança |
|---|---|---|
| Prisma | `backend/prisma/schema.prisma` | os 15 campos viram `@ignore` (fora do Prisma Client, dentro do schema); `migrate diff` vazio. Comentário aponta a Fatia D |
| Repository | `backend/src/modules/categoriasManejo/categoriaManejoRepository.js` | `SELECAO` explícita só com as colunas que ficam |
| Service | `backend/src/modules/categoriasManejo/categoriaManejoService.js` | `CHAVES_LEGADAS_IGNORADAS` (aceitas e ignoradas); saída pública com 12 campos; validação de sexo e faixa da lista fixa (POST completo, PATCH só o que vem no corpo) |
| Derivação | `backend/src/modules/movimentacoesMapa/categoriaOficialDerivada.js` + espelho `src/domain/lotes/categoriaOficialDerivada.js` | faixas oficiais, lista fixa `FAIXAS_IDADE_CATEGORIA_MANEJO`, `categoriaOficialDaCategoriaManejo`, `faixaIdadeDaLista`, `faixaContemIdade`, `categoriaManejoParaMudanca` |
| Rebanho | `manejoRebanhoComandoService.js`, `rebanhoLedgerManejos.js` | `resolverCategoriaManejo` casa pela oficial derivada; Nascimento passa idade 0 (desempate pela faixa) |
| Tela | `FormularioCategoriaManejo.jsx`, `TabelaCategoriasManejo.jsx`, `CadastroRapidoCategoriaManejo.jsx`, `CategoriasManejo.jsx` | campos removidos; faixa num `B1Select` existente; rótulo da faixa na grade e no CSV. Hook `useCategoriasOficiaisDisponiveis` apagado (sem outro uso) |
| Service/porta do front | `src/services/categoriaManejoService.js`, `categoriaManejoNativePort.js` | payload enxuto; na edição, idades só quando a faixa mudou; porta filtra pelos campos graváveis e descarta par fora da lista em PATCH antigo da fila offline |
| Lote | `FormularioLote.jsx` | `Lote.categoria` = oficial derivada, ou `nome`; busca por nome, sigla, sexo e espécie; não puxa mais raça da categoria |
| Mudança de Categoria | `FormularioMudancaCategoria.jsx` | categoria de manejo pela oficial derivada, escolha determinística (faixa mais avançada) |
| Exclusão | `src/domain/deleteRules.js` | regra por id primeiro; depois `nome` **e** oficial derivada nos campos que a regra antiga cobria |
| Contrato legado | `base44/entities/CategoriaManejo.jsonc` | sem os 15 campos |

## 2. Por que não há migration

`DROP COLUMN` é migration CONTRACT e precisa ser a única migration nova da release (`CONTRACT_NAO_ISOLADO`). Esta fatia faz só o lado seguro: o código deixa de ler e de escrever as 15 colunas (`@ignore` + seleção explícita), e elas ficam dormentes no banco. O DROP e o nome físico `CADCATEGORIA` são a **Fatia D** (D-PROD-187).

## 3. Cliente antigo e fila offline

- `POST`/`PATCH` com as 15 chaves legadas: 201/200, chaves ignoradas (não gravadas, não devolvidas, fora da auditoria). Outra chave desconhecida continua 400.
- `PATCH` só com chaves legadas: 200 sem efeito.
- `PATCH` sem idade nem sexo nunca é recusado por valor antigo gravado (ex.: idades invertidas de antes da validação).
- `PATCH` da fila offline da versão anterior com par de idades fora da lista: a porta tira as duas idades e aplica o resto, para não travar a fila.
- Aba aberta com a versão anterior durante o deploy grava lote sem categoria oficial: **recarregar a página depois do merge**.

## 4. Revisão adversarial

Duas rodadas (4 + 3 revisores independentes, 2 céticos por achado). Achados confirmados e tratados:

1. Nascimento ambíguo com 0–8 e 9–12 ativas → desempate pela faixa que contém 0 meses.
2. PATCH travado por idades antigas invertidas → validação só do que vem no corpo.
3. Exclusão deixava passar categoria referenciada pelo texto oficial → regra pela oficial derivada.
4. Idade negativa offline travando a fila → lista fixa no formulário.
5. Categoria sem sexo/faixa perdia a ligação oficial → Sexo e Faixa obrigatórios.
6. Mudança de Categoria escolhia pela ordem da lista → escolha determinística.
7. PATCH antigo da fila offline com par fora da lista → `corpoDeEdicao`.
8. Categorias de produção sem faixa (4) → preenchimento como dado na entrada no ar (item 6). Sem fallback no código, por decisão.

## 5. Validação (local, PostgreSQL 16 descartável, ambiente igual ao da CI)

| Etapa | Resultado |
|---|---|
| `test:gates` | 808/808 |
| `test:backend` | 1.689 testes: 1.684 passam, 0 falham, 5 todo |
| `test:smoke` | 217 arquivos, 2.643/2.643 (mais os testes da correção final, 54/54 nos arquivos tocados) |
| Gates (`tenancy`, `indices`, `import-integrity`, `product-scope`, `base44`, `no-secrets`, `rebanho-ssot`, `deploy-migrations`, …) | passam |
| `types` | 625 / teto 625, sem regressão |
| `typecheck:backend`, `lint`, `build`, `build:admin` | passam |
| `prisma migrate diff --exit-code` | vazio |

Testes novos: `backend/tests/categoriaManejoEnxuto.test.mjs` (E-00…E-15), `backend/tests/categoriaOficialDerivada.test.mjs`, R2b/R4 em `backend/tests/r2eR5ComandosLedgerConvertidos.test.mjs` (com contraprova), `tests/smoke/categoriaManejoEnxuto.test.jsx`, `tests/smoke/categoriaOficialDerivada.test.js` (paridade front/back).

## 6. Produção

- Nada desta fatia foi aplicado em produção. Nenhuma escrita em banco remoto por esta fatia.
- Leitura (só `SELECT`) do projeto Supabase MAIKE: 4 categorias, todas com idade nula; `raca` "COMPOSTO" nas 4; GMDs zerados; `categoria_oficial` com os textos antigos.
- **Antes/junto do merge:** preencher Sexo + Faixa das categorias com a lista que o proprietário vai enviar. Sem isso, Nascimento e Mudança de Categoria não ligam essas categorias à lista oficial, e lote novo grava o nome em `Lote.categoria`.
- No mesmo dia, com GO do proprietário, foi aplicada a migration da **D-PROD-183** (PR #261), que é de outra missão; registro em `CURRENT-STATE.md`.

## 7. Próximas fatias

- **Fatia D (D-PROD-187):** migration CONTRACT isolada — DROP das 15 colunas + nome físico `CADCATEGORIA` (`@@map`, model segue `CategoriaManejo`), com trava fail-closed e impressão dos valores apagados. Exige acesso bloqueado pelo proprietário (o rename não tem janela compatível) e proíbe rollback da Vercel para antes da D.
- **Fatia E:** "Categoria de evolução" opcional no cadastro (mesmo sexo, faixa maior), pré-preenchendo a Mudança de Categoria. Migration EXPAND própria, depois da D.

## 8. Fora do escopo

Trabalho visual, Cadastro de Lotes, Estoque (#260), Tipo de Atividade, Categoria de evolução e qualquer migration.
