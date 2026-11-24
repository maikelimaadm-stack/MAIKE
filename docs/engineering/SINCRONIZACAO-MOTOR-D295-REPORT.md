# Relatório — Motor de sincronização (D-PROD-295)

## Missão

Base da gravação sem internet: um motor genérico, com as regras definitivas,
antes de ligar qualquer manejo. Primeiro consumidor previsto: cochos e
depósitos (próxima missão).

## O que entrou

- `src/lib/offline/sincronizacao/filaDeEnvio.js`: fila durável (IndexedDB
  `maike_fila_envio`) e fila em memória para teste. Gravação na fila não
  engole erro.
- `src/lib/offline/sincronizacao/motorDeSincronizacao.js`: registro de tipos
  (`offline: true|false` obrigatório), `enviarOuGuardar`, `sincronizar`,
  referências entre registros, ordem por recurso, espera crescente,
  "precisa de atenção", tentar de novo, descartar, dono da fila.
- `src/lib/offline/sincronizacao/gatilhosDeSincronizacao.js`: disparos (volta
  da internet, abrir/retomar, a cada minuto com pendência). Envia também a fila
  antiga de entidades, que até aqui nunca era disparada.
- `src/services/sincronizacaoService.js` e `src/hooks/useFilaDeEnvio.js`: o que
  as telas usam.
- `src/components/offline/FilaDeEnvio.jsx`: seção "Envio" na janela "Dados sem
  internet". `src/Layout.jsx`: número no item do menu e aviso ao sair com
  registros não enviados.
- `offlineEntityRuntime.contarPendenciasDaFilaDeEntidades`.
- Docs: D-PROD-295, `OFFLINE-INVENTARIO.md`.

## O que não entrou

- Nenhum manejo ligado ao motor ainda (cochos e depósitos são a próxima PR).
- Leitura de cocho sem `operation_id` no servidor (precisa antes de ir ao motor).
- Mostrar no mapa, na hora, o registro que espera envio (por tipo, junto do manejo).

## Verificação

- `tests/smoke/motorSincronizacao.test.js`: 21 casos (contrato, com/sem
  internet, queda no meio sem duplicar, ordem por recurso, referência ao id do
  servidor, descarte, espera, 401, tipo desconhecido, dono).
- Gates: `gate:types`, `gate:api-boundary`, `gate:source-closure`,
  `gate:import-integrity`, `gate:product-scope`, `gate:native-api`,
  `gate:no-secrets`, `gate:base44`.
