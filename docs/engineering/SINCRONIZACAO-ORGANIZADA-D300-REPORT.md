# Relatório — sincronização organizada (D-PROD-300)

**Data:** 2026-11-25 · **Branch:** `claude/nifty-feynman-rh0kdn`

## O que o proprietário relatou (teste no campo)

1. Lançamento feito sem internet não aparece no histórico do depósito.
2. A formulação não aparecia no lançamento do cocho sem internet, mesmo depois de baixar os dados.
3. Ao voltar a internet não aparece nada; a sincronização ficava escondida no menu.
4. Sem internet, o depósito fica "carregando" e mostra tudo zerado (o cocho abre); "parece página de web".

## Causas encontradas

| Relato | Causa |
|---|---|
| 1 | O histórico do depósito só lia o que o servidor tinha. |
| 2 | (D-PROD-299) a soma do saldo em texto escondia a formulação; a leitura dela não estava na lista do que baixar. Aqui: a lista dependia de quais módulos já tinham sido abertos. |
| 3 | Só a janela no menu do usuário; nenhum aviso ao enviar. |
| 4 | React Query no padrão `networkMode: 'online'`: sem sinal, toda consulta fica PAUSADA, sem ler o celular. O cocho reaproveita consultas do mapa já carregadas; o depósito tem as suas (saldo, histórico), que nunca rodavam. |

## O que mudou

- `src/services/historicoAguardandoEnvioService.js` (novo) + `mapaCacheService` (visão na leitura de `movimentacaoEstoque`): transferência e baixa do lançamento que esperam envio entram no histórico do depósito, marcadas "aguardando envio". `DetalhesDepositoSuplementacao` mostra o selo/linha "Situação" e escuta a fila; `HistoricoDepositoSuplementacao` não oferece "Excluir" nelas.
- `src/components/offline/DadosOffline.jsx`: janela **Sincronização** (internet, Envio, Dados no celular por parte, **Sincronizar agora** = envia e baixa). `dadosOfflineService.situacaoDaBaixa()` guarda como veio cada parte.
- `src/components/offline/BotaoSincronizacao.jsx` (novo): ícone no topo (Layout, nos três cabeçalhos).
- `src/components/offline/AvisoDeSincronizacao.jsx` (novo, em `App.jsx`): "Enviando…", "Tudo enviado", "precisam de atenção".
- `src/lib/query-client.js`: `networkMode: 'always'` nas consultas.
- `src/apis/offline/offlineApi.js`: carrega todas as portas antes de baixar; `movimentacaoPecuariaNativePort` registra a leitura sem limite.
- Textos "Dados sem internet" → "Sincronização".

## Testes

- `tests/smoke/sincronizacaoOrganizada.test.jsx` — SO-01..05 (ícone, aviso, janela e ordem envia→baixa).
- `tests/smoke/penteFinoOffline.test.js` — PF-01 (17 leituras dos formulários do cocho e do depósito sem internet depois de baixar), PF-02 (consulta não pausa sem internet).
- `tests/smoke/depositoTransferenciaOffline.test.js` — ET-08; `tests/smoke/lancamentoCochoOffline.test.js` — LCO-01 (baixa no histórico); `tests/smoke/dadosOfflineLeitura.test.js` — DB-04.

## Fica para depois

- Estender o pente-fino aos demais manejos (gado) quando entrarem no motor.
- Mensagem "ainda não baixado" nas listas que vierem vazias sem internet.
