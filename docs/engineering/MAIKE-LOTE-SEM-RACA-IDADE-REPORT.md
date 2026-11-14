# MAIKE-LOTE-SEM-RACA-IDADE — Relatório

**Branch `claude/kind-knuth-tztu1v`** · Decisão: [D-PROD-196](./DECISIONS.md)

## 1. Entrega

O cadastro de lotes perdeu os campos **Raça Predominante** e **Idade Média (meses)**,
a pedido do proprietário. A aba Geral do formulário foi reorganizada em duas linhas
cheias.

| Camada | O que mudou |
|---|---|
| Formulário do lote | os dois campos saíram (definição, grupo, layout padrão, valor inicial, gravação); Geral = Categoria · Sexo · Sistema / Cabeças · Peso |
| Grade do cadastro | coluna "Raça Predominante" removida |
| Porta nativa | não envia mais os dois campos, nem num corpo antigo da fila offline |
| Correção da entrada | os dois campos saíram da lista de administrativos (front e servidor) |
| Mapa | detalhes do lote sem a coluna "Raça" e sem "Raça Predom." no card; posição sem `raca_predominante` |
| API | não lê, não grava e não devolve os dois campos; `POST`/`PATCH` aceitam e ignoram, para cliente antigo |
| Banco | **sem migration**: colunas ficam com os valores antigos (84 lotes) |

## 2. Por que assim

- **Nada se perde e não há janela de release.** Sem migration não há GO de banco
  nem ordem migration → merge. O deploy da `main` basta.
- **Compatível com cliente antigo.** Até o navegador recarregar, o bundle antigo
  ainda envia os dois campos. O servidor os aceita e ignora, em vez de recusar com
  400, e a fila offline antiga não trava.

## 3. Validação local

| Comando | Resultado |
|---|---|
| backend afetados (`r1CorrecaoEntradaLote` com o novo teste D-PROD-196, `loteDerivadoIntegridade`, `r2eR4ContratoTresResponsabilidades`, `permissoesAutorizacao`) | 61/61 |
| smoke completo (`npx vitest run tests/smoke`), com o novo `loteSemRacaIdade` | 230 arquivos, 2.833 testes |
| `verify:all` e revisão | ver §4 |

## 4. Verificação completa e revisão

- **Revisão independente** do commit `aeef10c0`: nenhum defeito alto ou médio. Quatro
  pontos baixos foram corrigidos em `22ece107`:
  - no tablet, o Sexo ficava sozinho numa linha;
  - layout salvo com a ordem antiga deixava buracos (agora vale a ordem padrão);
  - `PATCH` só com chaves ignoradas gravava auditoria vazia;
  - a doc dizia "obrigatórios", mas os campos só tinham asterisco.

  Também entraram testes que renderizam o formulário e o layout salvo antigo. O
  teste do layout falha sem a correção.
- **Backend dos lotes** depois das correções: 83/83. **Smoke** `r1CorrecaoEntradaLote`: 24/24.
- **`verify:all`** em `22ece107`: etapas até `lint` passaram, e `test:backend` estava
  em andamento, sem falha, quando o proprietário pediu o merge ("faça o merge"). O
  merge foi feito antes do fim, por pedido explícito: a release não tem migration, e o
  smoke completo já tinha passado em `aeef10c0` (230 arquivos, 2.833 testes). O
  resultado final é conferido depois do merge.
