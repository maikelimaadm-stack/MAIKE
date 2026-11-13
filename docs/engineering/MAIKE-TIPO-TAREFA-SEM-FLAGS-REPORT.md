# MAIKE-TIPO-TAREFA-SEM-FLAGS — Relatório (Fatia A)

**fatia A · `feat/tipo-tarefa-sem-flags` · PR em rascunho** · Decisão: [D-PROD-179](./DECISIONS.md)

## 1. O que mudou

As 4 flags de exigência saíram do cadastro de Tipo de Tarefa: `exige_area`, `pode_ter_produto`, `pode_ter_maquina` e `pode_ter_implemento`.

| Camada | Arquivo | Mudança |
|---|---|---|
| Prisma | `backend/prisma/schema.prisma` | model `TipoTarefa` sem os 4 campos. Unicidade, FK composta, índices e relações iguais |
| Repository | `backend/src/modules/tiposTarefa/tipoTarefaRepository.js` | seleção sem os 4 campos |
| Service | `backend/src/modules/tiposTarefa/tipoTarefaService.js` | saída pública e campos editáveis sem os 4 |
| Rotas | `backend/src/modules/tiposTarefa/tipoTarefaRoutes.js` | as 4 chaves passam a `CHAVES_LEGADAS_IGNORADAS`: aceitas no corpo e sem efeito |
| Porta | `src/apis/tarefas/tipoTarefaNativePort.js` | lista de envio sem os 4 |
| Formulário | `src/components/tipos-tarefa/FormularioTipoTarefa.jsx` | estado e as 4 chaves liga/desliga removidos. Nenhum componente novo |
| Contrato legado | `base44/entities/TipoTarefa.jsonc` | sem os 4 |
| Testes | `backend/tests/tarefaCadastroNativo.test.mjs` | teste novo de compatibilidade com cliente antigo |

A `TabelaTiposTarefa.jsx` não exibia nenhuma flag e não mudou. A varredura global achou referências só em `dist/` (build antigo, fora do git) e no relatório histórico da Patrimônio P1-01, que não se edita.

## 2. Por que não há migration (DROP COLUMN)

`DROP COLUMN` numa tabela que já existe é uma migration **CONTRACT**. O portão de migrations recusa CONTRACT por padrão (D-PROD-72 item 3, D-PROD-107 R7). Uma exceção exige:
- entrada nova na lista fechada `MIGRATIONS_CONTRACT_APROVADAS`;
- decisão própria do proprietário;
- release isolada com guarda (como na D-PROD-162).

Esta fatia, então, faz só o lado seguro:
- o código deixa de ler e de escrever as 4 colunas;
- elas ficam **dormentes** no banco, como `BOOLEAN NOT NULL DEFAULT false`;
- o `INSERT` usa o default;
- o deploy funciona com o banco atual, sem passo de banco.

A remoção física vira uma migration CONTRACT própria, quando o proprietário der GO.

## 3. Cliente antigo

O app recusa chave desconhecida com 400 (`removeAdditional: false`). Por isso, um front antigo, ou a fila offline, que mande as 4 chaves recebe 201/200 e as chaves são ignoradas. Qualquer outra chave desconhecida continua 400.

## 4. Validação (local, PostgreSQL 16 descartável)

- `node --test backend/tests/tarefaCadastroNativo.test.mjs`: 5/5.
- `npm run verify:all`: ver a seção 5.

## 5. Gates

Resultado registrado no corpo da PR e na resposta ao proprietário.

## 6. Fora do escopo

- `LancamentoTarefa`;
- `TipoAtividade` (Fatia B);
- `ApontamentoAtividade`;
- `AbastecimentoBem`;
- trabalho visual;
- qualquer SQL remoto.
