# Relatório — Corrigir sem internet (D-PROD-298)

## Missão

Editar e excluir o que foi feito sem internet e ainda não subiu, e excluir
(cancelar com estorno) sem internet o que já está no servidor — lançamento do
cocho e transferência entre depósitos.

## O que entrou

- **Motor:** `alterarNaFila` (mesma posição e código; só o que o servidor
  certamente não tem), `dependentesNaFila`, `registroNaFila`.
- **Lançamento que espera envio** (`AcoesDoLancamentoAguardando`): Editar no
  formulário de lançamento em modo edição (`edicao`) e Excluir, no histórico do
  cocho. Serviços: `alterarLancamentoDoCocho`, `excluirLancamentoAguardando`,
  `lancamentoAguardandoParaEditar`, `dependentesDoLancamentoAguardando`.
- **Transferência que espera envio** (`TransferenciasAguardandoDeposito`): seção
  "Aguardando envio" no depósito com Editar (formulário em modo edição) e
  Excluir. Serviços: `transferenciasAguardandoDoLocal`,
  `descartarTransferenciaAguardando`, `transferenciaAguardandoPodeEditar`,
  `registrarTransferenciaEntreLocais({ edicao })`.
- **Saldo do formulário em edição** não desconta o próprio registro
  (`comEstoqueAguardandoEnvio(lotes, { ignorar })`).
- **Excluir sem internet o que já subiu:** tipos `cocho.cancelamento` e
  `deposito.cancelamento-transferencia`; os botões funcionam sem internet
  (confirmação simples); visão no aparelho (`cancelamentosAguardandoService`) e
  estoque de volta (`estoqueAguardandoEnvioService`).
- **Janela "Dados sem internet":** Excluir para o que espera envio, com aviso de
  dependentes.

## O que não entrou

- Prévia do servidor (efeitos e recálculo) na exclusão sem internet.
- Limpeza dos recibos antigos de idempotência (missão separada).

## Verificação

- `motorSincronizacao` (MS-26..27), `lancamentoCochoOffline` (LCO-08..11),
  `depositoTransferenciaOffline` (ET-06..07), `cochoCancelarLancamento` (C4),
  `depositoCancelarTransferencia` (CT-2). 1723 testes das telas e serviços
  ligados passaram.
- Gates: `types`, `api-boundary`, `source-closure`, `import-integrity`,
  `product-scope`, `no-secrets`.
