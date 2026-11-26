# Relatório — Sincronização profissional, Etapa 3: versão do registro e quem alterou (D-PROD-316)

**Data:** 2026-11-25 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-316](./DECISIONS.md) · **Migration:** nenhuma

## Problema

Duas pessoas, ou dois aparelhos (um deles sem internet), editando o mesmo lote ou o mesmo cocho: a última gravação apagava a outra sem avisar. O lote tinha só uma conferência parcial: `estado_esperado`, nos campos de saldo e posição.

## Solução

### A versão é o `updatedAt`

O servidor já atualiza `updatedAt` em toda gravação, inclusive nas internas: manejos, ledger, cascatas e o UPDATE cru do ponto (conferido na D-PROD-309). Por isso ele serve de versão do registro sem migration, e nenhum caminho de escrita precisa lembrar de "incrementar" nada. O app já recebe esse valor como `updated_date`.

### Servidor

- `shared/sincronizacao/versaoDoRegistro.js`:
  - `separarVersaoEsperada` tira o campo do corpo; formato inválido dá 400.
  - `exigirVersaoEsperada` compara a versão vista com a atual, sob a trava da linha. Se forem diferentes, responde 409 `REGISTRO_VERSAO_CONFLITO` e não grava nada. Os detalhes trazem `versao_atual`, `alterado_por_nome`, `alterado_por_id` e `alterado_em`, lidos da última entrada da auditoria.
  - `ultimaAlteracao` faz essa leitura da auditoria.
- `PATCH /lotes/:id` e `PATCH /pontos-suplementacao/:id` aceitam `versao_esperada`. O ponto passou a travar a linha (`FOR NO KEY UPDATE`) antes de ler.
- **Compatível:** sem `versao_esperada` (app antigo, cascatas internas como renomear o depósito nos cochos), grava como antes.

### App

- **Telas:**
  - O cadastro de lotes manda a versão do lote aberto (`registroAnterior.updated_date`).
  - O Renomear lote manda a versão do lote aberto junto com o nome.
  - O formulário do cocho ou depósito no mapa manda a versão. Quando ele grava em dois passos (o vínculo do depósito antigo e depois o resto), o segundo passo usa a versão nova.
- **Fila sem internet (`offlineEntityRuntime`):**
  1. A versão vai só no PATCH. Nunca entra no registro guardado no aparelho nem numa criação que ainda está na fila.
  2. Duas edições sem internet juntam numa, com a versão da primeira. A da segunda foi lida da cópia do aparelho, que tem uma hora local.
  3. Com internet e uma edição do mesmo registro ainda na fila, a nova vai para a fila logo depois dela, como item próprio e sem versão, e a fila é enviada. Antes ela ia direto ao servidor, fora de ordem. Juntar no item que pode estar sendo enviado naquele momento poderia perdê-la.
  4. Conflito ao enviar: a edição fica retida na janela "Sincronização" com a mensagem. A edição seguinte do mesmo registro espera, porque ir sozinha gravaria por cima de quem alterou.
- **Mensagem:** "Este lote foi alterado por Maria em 25/11/2026 14:30, depois que você o abriu. Abra de novo, confira e refaça a alteração. Nada foi gravado." O cadastro de lotes relê a lista quando isso acontece.

## Testes

- **Backend:** `versaoDoRegistro.test.mjs`.

  | Teste | O que prova |
  |---|---|
  | VR-01 | versão vista grava; versão velha dá 409, com quem e quando, sem gravar |
  | VR-02 | sem versão, grava como antes |
  | VR-03 | cocho e depósito, cada um com o nome certo na mensagem |
  | VR-04 | formato inválido dá 400 |
  | VR-05 | mudança feita pelo próprio servidor também muda a versão |
  | VR-06 | outro tenant recebe 404 e não vê a versão nem o autor |

  As suítes de lote e cocho também passam.
- **App:** `tests/smoke/versaoDoRegistro.test.js` (VA-01..08) e a suíte `test:smoke` completa.
- **Gates:** os 30 gates e `typecheck:backend`.

## Fora (próximas etapas)

- **Duas gravações no mesmo milissegundo:** a versão não muda, e o conflito não é detectado. É raro, porque a trava da linha serializa as gravações.
- **Outras entidades:** os lançamentos de cocho são feitos por comandos com as próprias regras, como "só o último" e o fechamento. As demais entidades ficam para a Etapa 5.
- **"Alterado por" na tela de detalhe:** hoje só aparece no conflito. Mostrar fora dele exigiria guardar o autor no próprio registro.
