FATIA: MAIKE-ESTORNO-COCHO-DEPOSITO (etapa 2 da MAIKE-EXCLUIR-HISTORICOS-MAPA)
BRANCH: feat/estorno-cocho-deposito
PR: (a abrir)

# MAIKE-ESTORNO-COCHO-DEPOSITO — Relatório

**Decisão:** [D-PROD-268](./DECISIONS.md) · **Base:** `origin/main` `2e048854` (PR #351 mergeada) · **Migration:** nenhuma

## 1. Pedido e escolhas do proprietário

Etapa 2 do pedido "meus históricos no mapa não aparecem opções de excluir" (D-PROD-266): cancelar com segurança o **lançamento de cocho** e a **transferência entre depósitos**, que até aqui ficavam suspensos (D-PROD-94a/161) porque desfazer era uma sequência de chamadas do navegador.

| Pergunta | Escolha (todas a recomendada) |
|---|---|
| Quem pode | Permissão nova, desligada para todos |
| Produto com movimento depois no(s) depósito(s) | Recusar |
| Lançamento de cocho cancelado | Some dos históricos |
| Depósito de origem inativo | Recusar |

## 2. O que mudou

| Frente | Arquivos principais | Mudança |
|---|---|---|
| Permissão | `src/lib/mapaGeralPermissions.js`, `backend/src/shared/auth/autorizacaoTela.js`, `guardasRotas.js`, `errorCodes.js` | Chave gravadora `cancelar_lancamentos_estoque` (desligada ao nascer); guarda nas 4 rotas e relida na transação antes do recibo; códigos 409 `SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO`, `SUPLEMENTACAO_REGISTRO_CANCELADO`, `LANCAMENTO_DESATUALIZADO`, `TRANSFERENCIA_CANCELAMENTO_BLOQUEADO` |
| Motor | `estoqueFisicoMotor.js`, `movimentoPosterior.js` (novo), `saidaEstoqueService.js` | `estornarSaidaSuplementacao` e `estornarTransferenciaEstoque` (CAS por camada, poço reavaliado, movimentos de estorno ligados ao original); regra "nada depois" da D-PROD-264 extraída para um helper com vários locais e desconto do par neutro; `estornarSaida` com `originalEsperado` opcional |
| Cocho (servidor) | `suplementacaoEventoCancelamentoService.js` (novo), `suplementacaoCocho.js`, `camposFechamentoEvento.js`, serviços e repositórios de evento e lote, `movimentacaoEstoqueComandoService.js` | `POST /suplementacao-eventos/:id/cancelamento` e o ensaio `GET …/elegibilidade-cancelamento`; só o último lançamento ativo, com o período aberto; documentos marcados `cancelado` e fora das listas; reabertura do período anterior só com prova; escritores endurecidos; replay de lançamento ou baixa cancelados → 409 |
| Depósito (servidor) | `transferenciaEstornoService.js` (novo), `movimentacaoEstoqueRoutes.js` | `POST /movimentacoes-estoque/:id/cancelar-transferencia` e o ensaio `GET …/elegibilidade-cancelamento-transferencia`; par S/R conferido, legado recusa, "só o último" nos dois depósitos, origem inativa 422, destino inativo aceito |
| Tela | `CancelarLancamentoCocho.jsx`, `deposito/CancelarTransferenciaDeposito.jsx`, `deposito/usePodeCancelarLancamentosEstoque.js`, históricos e detalhes do cocho/depósito, `FormularioLancamentoSuplementacao.jsx`, `FormularioTransferenciaDeposito.jsx`, `politicaEstorno.js`, `estoqueConsultaRegras.js` | Botões no cartão do histórico (só online, motivo, ensaio antes, mesma chave no reenvio, 403 com mensagem de permissão); flag do cocho liga só o caminho novo; chave pendente da transferência expira em 15 min e replay vira aviso; rótulos do kardex |

## 3. Como foi feito

Desenho por agentes com revisor-juiz (`desenho-estorno.json`), depois implementação em três frentes de arquivos separados: o motor primeiro, depois o cocho e o depósito em paralelo. Cada frente teve dois revisores independentes e uma rodada de ajustes.

Pontos da revisão que procederam e foram aplicados:
- Reenvio com a chave original de um lançamento já cancelado respondia sucesso: agora 409 no lançamento e na baixa.
- Corrida entre o gado e o cancelamento: trava das áreas (a mesma do ledger) e checagem repetida no fim da transação.
- Cartões legados sem cocho não ganham mais botão.
- 403 no ensaio mostra a mensagem de permissão.
- Chave velha da transferência reaproveitada em silêncio: janela de 15 min, replay como aviso, `IDEMPOTENCY_CONFLICT` guarda a chave.
- Ensaio "já cancelada"/404 relê o cartão; ajuda do motivo e foco acessíveis.

Na integração: dois smoke antigos (`historicoEstornoSuspenso`, `historicosMapaEstiloManejo`) foram atualizados para a flag do cocho ligada; um código de erro duplicado foi removido; `permissoesR2Rotas` passou a cobrir as rotas novas; e foi atualizada a [cobertura de endpoints](./MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md).

## 4. Validação (local, PostgreSQL 16, banco UTF8 limpo)

| Etapa | Resultado |
|---|---|
| Testes do estorno: `motorEstornoCochoTransferencia`, `suplementacaoCancelamentoCocho`, `…Vinculos`, `depositoCancelarTransferencia`, `permissoesR2Rotas`, `estoqueSaidas` | 75/75 |
| `test:backend` completo | ver §6 |
| `test:smoke` completo | 312 arquivos, 3890 testes, todos passam |
| Gates do `verify:all` (todos menos backend/smoke/build), `gate:types`, `typecheck:backend`, `lint` (0 erros), `build` | passam |

Em todos os caminhos felizes, os testes conferem `GET /estoque-fisico/reconciliacao` sem achados.

## 5. Produção

- **Sem migration.** Merge e deploy normais.
- Ninguém ganha a ação sozinho: para cancelar com o usuário `maike`, ligar **"Cancelar lançamento de cocho e transferência de depósito"** em Permissões, ou usar a conta Administrador.
- Só cancela lançamentos feitos a partir de agora com toda a prova, ou os antigos que passam na prova legada. O que não passa é recusado com o motivo; nada é alterado.

## 6. Resultado da verificação

| Onde | Etapa | Resultado |
|---|---|---|
| Local | `test:backend` completo | (preencher) |
| CI `quality` | `verify:full` (estático, smoke 1/2 e 2/2, backend 1/4 a 4/4) | (preencher) |

## 7. Fora do escopo / próximos

- **`POST /movimentacoes-mapa` genérico** (empresa fora do ledger) não toma a trava das áreas: sobra uma janela curta entre a última checagem do cancelamento e o commit. Fechar muda a trava de todo escritor de movimentação do mapa; fica para decisão própria.
- **Reenvio de operador revogado depois do commit** responde 403, não replay; a tela trata como "pode ter sido concluído, confira o histórico". Mudar exigiria afrouxar a guarda da rota.
- **Formulário de transferência:** reenviar o corpo pronto (com o rateio já calculado) evitaria o 409 de conflito quando o FIFO muda entre aberturas; hoje a chave fica guardada e nada duplica.
- Código próprio `SUPLEMENTACAO_FECHAMENTO_INVALIDO` (hoje o PATCH de fechamento usa `LANCAMENTO_DESATUALIZADO` com `reason`).
- Seguem adiados, a pedido: os 12 problemas de lote/movimentação do relatório da PR #305 (§6) e a fila offline.
