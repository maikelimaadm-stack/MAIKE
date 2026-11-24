# Relatório — Cochos e depósitos sem internet (D-PROD-296)

## Missão

Ligar ao motor de sincronização (D-PROD-295) todos os lançamentos de cochos e
depósitos: leitura de cocho, lançamento de suplementação (com a baixa do
depósito e o fechamento do período anterior) e transferência entre depósitos.

## O que entrou

- **Servidor:** `POST /leituras-cocho` aceita `operation_id` (idempotente,
  `OperacaoIdempotente`, tipo `leitura_cocho_criar`). Sem migration.
- **Motor:** `situacaoNaFila` (aguardando, confirmando, atenção, enviado),
  "confirmando envio" impede excluir o que pode ter chegado ao servidor,
  reenvio do mesmo código não duplica, `atualiza` (as telas releem quando o
  registro chega), `mensagemDaFila`, `operacaoDaReferencia`, e a recusa de
  negócio (código do servidor fora do catálogo do app) vai para atenção na hora.
- **Tipos** (`src/lib/offline/sincronizacao/tiposDeEnvio.js`): `cocho.leitura`
  (porta da leitura), `deposito.transferencia` (`suplementacaoEstoqueService`),
  `cocho.lancamento` (`suplementacaoService`, três passos no envio).
- **Visão no aparelho:** `leituraCochoService.leiturasAguardandoEnvio`,
  `lancamentoCochoAguardandoService` (lançamento como último do cocho e o
  período anterior fechado), `estoqueAguardandoEnvioService` (lotes com a saída
  e a entrada do que espera envio), ligados ao cache do mapa e às listas da
  suplementação.
- **Revisão (Codex):** o saldo do aparelho só aplica o que nunca tentou subir
  (sem contar duas vezes a baixa já gravada); o "Tentar de novo" do
  lançamento recusado porque o cocho mudou religa ao lançamento atual e refaz
  o fechamento, sem baixar de novo; descartar com a baixa feita avisa.
- **Telas:** formulários da leitura, do lançamento e da transferência usam o
  motor; a leitura que espera envio aparece com "aguardando envio" e pode ser
  excluída; o lançamento que espera envio não mostra "Excluir lançamento".

## O que não entrou

- Editar e excluir na fila o lançamento e a transferência que ainda não
  subiram; cancelar sem internet o que já subiu (próxima etapa).
- Limpeza dos recibos antigos de idempotência (missão separada, combinada com
  o proprietário).

## Verificação

- Backend (PostgreSQL real): `leituraCochoNativo.test.mjs` — 15 casos, 5 novos
  (LC-ID-01..05).
- Frontend: `leituraCochoOffline` (LO-01..05), `depositoTransferenciaOffline`
  (ET-01..05), `lancamentoCochoOffline` (LCO-01..07), `motorSincronizacao`
  (MS-01..25). Os testes antigos do formulário de lançamento passam por um
  adaptador de teste (`tests/smoke/helpers/shimLancamentoCocho.js`) que faz a
  mesma sequência do serviço com as simulações de antes.
- Gates: `gate:types`, `gate:api-boundary`, `gate:source-closure`,
  `gate:import-integrity`, `gate:product-scope`, `gate:tenancy`,
  `gate:no-secrets`.
