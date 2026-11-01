# MAIKE-R2A — Cancelamento e estorno seguro de movimentação (backend primeiro)

**Data:** 2026-10-31 · **Decisão:** D-PROD-97 (redigida como D-PROD-95, depois D-PROD-96; ver a nota de numeração em `DECISIONS.md`) · subdecisões D-PROD-97a, D-PROD-97b e D-PROD-97c · **Base:** `main` d2cba91 (merge da #161)
**PR:** maikelimaadm-stack/MAIKE#162 (DRAFT) · **Branch:** `claude/new-session-26kpxu`
- É a branch designada da sessão. Foi recriada a partir de `main` depois do merge da #161; nenhum commit novo foi empilhado sobre a #161.
- Sem migration. Sem escrita em produção. Sem ledger L1.

> **Atualização R2A-R3 (D-PROD-97c):** a seção **R2A-R3** logo abaixo completa a reversão das transferências com unificação: a identificação do destino volta, e a edição posterior é preservada.
>
> **Atualização R2A-R2 (D-PROD-97b):** a seção **R2A-R2** logo abaixo substitui a regra de elegibilidade da R2A-R1 (estado causal completo) e resolve a numeração.
>
> **Atualização R2A-R1 (D-PROD-97a):** a revisão do arquiteto bloqueou a versão
> abaixo. A prova temporal por AuditLog (±15 min) aceitava "prova emprestada", e o
> `PATCH /lotes` gravava valor absoluto obsoleto. A seção **R2A-R1** logo abaixo
> substitui as seções 3, 5 e 6 onde houver conflito. As seções originais ficam como
> histórico.

## R2A-R3 — Reversão completa da identificação em unificação (D-PROD-97c)

**Missão:** MAIKE-R2A-PR162-R3-REVERSAO-COMPLETA-IDENTIFICADORES-DE-LOTES-UNIFICADOS, na mesma PR #162 (DRAFT).
- HEAD de partida: f048615.
- Base observada na auditoria: 505acd6. Durante a missão, `main` avançou para 2fcc769 (#164), que foi integrada por merge.
- Sem migration, sem backfill, sem escrita em produção.

### R3.1 Bug → correção

| Item | Conteúdo |
|---|---|
| Bug | A unificação (`parcial_unificado`, `total_unificado`) copia `identificador_nome`, `identificador_sigla` e `identificador_cor` da origem para o destino, nulos inclusive. O efeito não guardava o valor anterior, e o cancelamento não o devolvia |
| Reprodução (HEAD f048615) | Destino DESTINO/DST/#112233 com 100 cab; origem ORIGEM/ORG/#445566. Depois da unificação e do cancelamento, os saldos voltam, mas o destino fica com **ORIGEM/ORG/#445566**. Com a origem sem identificador, o destino perdia o seu (ficava nulo). `r2aR3Identificadores`: **6 de 7 falhando**. Arquivo `evidencias/r2a-r3/red-identificadores-antes.txt` |
| Outros campos sobrescritos pelo comando | Destino da unificação: só `quantidade_cabecas` e os três identificadores. Origem: `quantidade_cabecas` e `status`. No lugar: `area_atual_id`/`area_atual_nome` (já revertidos pela área). Derivado: criado; o cancelamento só zera e inativa. Nenhum outro campo fica oculto sem reversão |
| Correção | `identificacao: {antes, depois}` em cada efeito. Restauração só com prova de ausência de edição posterior; edição posterior é preservada (`preservada_edicao_posterior`). Snapshot ausente em unificação → 409 `CANCELAMENTO_EFEITO_NAO_COMPROVADO` |
| GREEN | `r2aR3Identificadores` **13/13**; backend **618 testes, 0 falhas**. Arquivo `evidencias/r2a-r3/green-identificadores-depois.txt` |

### R3.2 Política de identificação (por que preservar)

- **Prova de "ninguém mexeu":**
  - nenhuma linha de `AuditLog` do lote depois da âncora `auditoria_id` altera a identificação, salvo se explicada por manejo comprovado já cancelado ou pela reversão dele;
  - e o valor atual é exatamente o que o comando aplicou.
- **Não basta comparar o valor atual com o aplicado:** uma ida e volta (ORIGEM → X → ORIGEM) deixa linhas de auditoria, e é tratada como edição.
- Escrita sem auditoria que mude o valor também resulta em preservação.
- **Preservar, e não recusar:** a identificação não é material. Recusar travaria a devolução de cabeças por causa de um rótulo; preservar nunca destrói dado. A escolha fica registrada no efeito do cancelamento e no snapshot completo do AuditLog.
- `CAMPOS_MATERIAIS_LOTE` não mudou: a identificação não virou material.

### R3.3 Matriz de cenários (PostgreSQL 16 real, HTTP)

| Cenário | Resultado |
|---|---|
| parcial_unificado, origem identificada | origem e destino idênticos ao pré-movimento em **todos** os campos (saldo, situação, área, identificação, entrada histórica, número, empresa, categoria); replay sem efeito |
| parcial_unificado, origem com identificadores nulos | idem; o destino recupera DESTINO/DST/#112233 |
| total_unificado (identificada e nula) | idem; origem 500 Ativo, destino 100 |
| Edição posterior do identificador do destino | saldo 100; edição mantida (EDITADO/EDT; cor da origem mantida); `preservada_edicao_posterior` |
| Ida e volta ORIGEM → X → ORIGEM | edição mantida; `preservada_edicao_posterior` |
| Concorrência ordem A (cancelamento pega a trava antes da edição) | `restaurada`; depois a edição vale (EDITADO/DST/#112233); 200/200, sem 500 |
| Concorrência ordem B (edição pega a trava antes) | `preservada_edicao_posterior` (EDITADO/ORG); 200/200; repetido 3 vezes |
| Unificação sem snapshot de identificação (formato R2) | 409 `CANCELAMENTO_EFEITO_NAO_COMPROVADO`; nada muda; sem reserva nem auditoria de cancelamento |
| Duas unificações no mesmo destino | a mais antiga é bloqueada enquanto a mais recente estiver ativa; cancelando da mais recente para a mais antiga, o destino volta exato |
| PATCH material depois da unificação | 409 `CANCELAMENTO_ALTERACAO_POSTERIOR`; identificação intacta |
| Outro tenant | 404; nada muda |
| total_no_lugar e parcial_novo_lote | identificação intacta; derivado só muda saldo e situação (0/Inativo), `quantidade_entrada` 30 |

### R3.4 Interface

O diálogo de cancelamento mostra o que acontece com a identificação:
- "identificação volta a DESTINO";
- ou "identificação editada depois da movimentação: mantida".

Teste smoke 17/17.

## R2A-R2 — Estado causal completo, fail-closed e numeração (D-PROD-97b)

**Missão:** MAIKE-R2A-PR162-R2-HARDENING-ESTADO-CAUSAL-CANCELAMENTO-E-GOVERNANCA, na mesma PR #162 (DRAFT). HEAD de entrada 1fbfef6; base `main` 505acd6. Sem migration, sem backfill, sem ledger, sem escrita em produção.

### R2.1 Matriz: bug → correção

| Item | Conteúdo |
|---|---|
| Bug | Depois do movimento, um `PATCH /lotes` **válido** (CAS correto) mudava saldo, situação, área ou categoria. O cancelamento continuava elegível e somava `antes − depois` sobre o saldo atual |
| Reprodução (HEAD 1fbfef6) | 450 → PATCH 400 → cancelamento **200, saldo 450**. 450 → PATCH 550 → **600**. Ida e volta 450 → 400 → 450 → **500**. Arquivo `evidencias/r2a-r2/red-estado-causal-antes.txt` |
| Causa | `planejarCancelamento` só conferia `area_atual_id` e "Inativo com saldo". `dependenciasPosteriores` olha outras fontes, nunca o `AuditLog` do lote. O teste de intercalação aceitava "PATCH 400 e cancelamento soma 50 → 450" como ordem legítima |
| Teste RED | `backend/tests/r2aR2EstadoCausal.test.mjs`: **11 de 22 falhando** no HEAD de entrada (a1, a2, a3 categoria, a4 destino/derivado, a5 ×2, P0-C categoria ×2, data ×2) |
| Correção | Âncora `auditoria_id` gravada pelo servidor em cada efeito. Conferência da auditoria original. Toda alteração material posterior tem de ser explicada por um manejo comprovado já cancelado, ou pela reversão dele (`CANCELAMENTO_ALTERACAO_POSTERIOR`). Estado atual = pós-estado, campo a campo, em todos os participantes (`CANCELAMENTO_ESTADO_DIVERGENTE`). Restauração exata do pré-estado. Tudo na mesma transação, depois de travar movimento e lotes em ordem de id |
| Teste GREEN | `r2aR2EstadoCausal` **22/22**; `movimentacaoCancelamentoR2A` **35/35**. Arquivo `evidencias/r2a-r2/green-estado-causal-depois.txt` |

### R2.2 Campos materiais e regra de "posterior"

- **Materiais:** `quantidade_cabecas`, `status`, `area_atual_id`, `categoria`, `categoria_manejo_id`, `empresa_id`.
- **Linha de auditoria material:** qualquer ação que não seja `update` (create, delete), snapshot ausente, ou diferença nesses campos. Edição de peso, nome ou identificador **não** bloqueia (teste a6).
- **Posterior:** `createdAt` maior que o da âncora. No mesmo milissegundo, só o `create` do próprio lote é considerado anterior; o resto conta como posterior (fail-closed).
- **Explicação aceita:** `auditoria_id` presente em `efeito_servidor.efeitos` de um movimento comprovado **cancelado**, ou em `cancelamento.efeitos`. Os dois são campos reservados (400 em POST, bulk e PATCH); o cliente não os escreve.
  - Movimento posterior ativo → `CANCELAMENTO_DEPENDENCIA_POSTERIOR`.
  - O `x-request-id` **não** é usado, porque é rótulo do cliente.

### R2.3 Concorrência (PostgreSQL 16 real, trava segurada por transação à parte)

| Cenário | Resultado exato provado |
|---|---|
| Ordem A: cancelamento pega a trava antes do PATCH 450 → 400 | cancelamento 200, saldo 500; PATCH 409 `LOTE_ESTADO_CONFLITO`; trilha `500->450`, `450->500 (cancelamento)` |
| Ordem B: PATCH pega a trava antes do cancelamento | PATCH 200, saldo 400; cancelamento 409 `CANCELAMENTO_ALTERACAO_POSTERIOR`; sem crédito, sem reserva; trilha `500->450`, `450->400` |
| Destino de transferência alterado concorrentemente | PATCH 200 (150 → 145); cancelamento 409; origem 450 e destino 145 |
| Duas transferências de 60 sobre 100 | [201, 409], total 100 |
| Três cancelamentos paralelos | [200, 409, 409] |
| Mesma chave em paralelo | sem crédito duplicado |
| Falha forçada depois de atualizar o lote | rollback total (sem reserva, sem auditoria órfã); o retry com a mesma chave conclui |
| Tenant | outro tenant 404; tenants com o mesmo nome isolados |

Execução repetida três vezes: 9/9 em cada rodada.

### R2.4 Comando (P0-C)

- `categoria_animal` diferente da categoria do lote → 409 `MANEJO_ESTADO_INVALIDO`; nada é criado. Sem o campo, o movimento grava a categoria do lote.
- `data_movimentacao` "ontem", "2026-13-45", "2026-02-30T…" ou vazia → 400; nada é criado.
- Área de destino de outra empresa do mesmo tenant → 404. A área atual da origem precisa ser da empresa.
- POST genérico continua recusando `efeito_servidor`, `modo_transferencia`, `lote_destino_id`, `situacao` e `cancelamento` (400).
- O derivado de transferência parcial continua com `origem: 'MOVIMENTAÇÃO'`; não é ENTRADA. `loteDerivadoIntegridade` passa sem mudança.

### R2.5 Matriz de tipos (substitui a R1.6)

| Tipo / origem | Status |
|---|---|
| Morte, Abate e Transferência (4 modos) criados pelo comando **com âncora de auditoria**, sem alteração material posterior não comprovada | **SUPORTADO_COM_PROVA_CAUSAL** |
| Os mesmos depois de PATCH material (saldo, situação, área, categoria) em origem, destino ou derivado, inclusive ida e volta | **BLOQUEADO** (`CANCELAMENTO_ALTERACAO_POSTERIOR` / `CANCELAMENTO_ESTADO_DIVERGENTE`), para conciliação assistida futura |
| Criados pelo comando da R2A-R1 (sem `auditoria_id`) | **BLOQUEADO** (`CANCELAMENTO_EFEITO_NAO_COMPROVADO`). Só existem em ambientes de teste: a PR nunca foi mergeada |
| Legado sem `efeito_servidor` (inclusive manejo offline) | **BLOQUEADO** (mensagem de legado) |
| Nascimento, Pesagem, Categoria, Junção, Renomear, Entrada/Saída | **ADIADO** |
| Cocho e depósito | **SUSPENSO** (D-PROD-94a) |

### R2.6 Interface

- Mensagens novas sem sugerir exclusão de dados: "…Nada foi alterado. A reversão não pode ser comprovada e exigirá conciliação assistida."
- O frontend exige a mesma âncora que o servidor (`tipoTemCancelamento`).
- Pendência de cancelamento isolada por **tenant + usuário** (`maike_cancelamento_pendente:<cliente>:<usuario>:<mov>`). O motivo fica bloqueado enquanto o resultado é desconhecido.
- Cancelamento continua só online, sem fila.

### R2.6a Testes e evidências

| Comando | Resultado |
|---|---|
| `node --test backend/tests/r2aR2EstadoCausal.test.mjs` | RED 11/22 falhando no HEAD 1fbfef6 → GREEN **22/22** |
| `node --test movimentacaoCancelamentoR2A + r2aR1ProvenienciaRed + loteDerivadoIntegridade` | **49/49** |
| `npm run test:backend` (PostgreSQL 16 local) | **605 testes, 0 falhas** (5 `todo` declarados) |
| `vitest` smoke completo | 99 arquivos, **1152/1152** |
| E2E Chromium (backend + Vite locais, `maike_demo` sintético) em 1440, 768, 412 e 390 | **64/64** (16 por largura) |
| E2E manejo pela UI (Morte no Detalhes do Lote) | **36/36** |
| lint / `gate:types` / `typecheck:backend` | 0 erros / sem regressão / limpo |

Os 64 testes de cancelamento cobrem, em cada largura:
- morte cancelada (saldo 500 conferido na API);
- **morte seguida de correção direta: recusa com a mensagem de conciliação assistida, sem botão de confirmar, duas tentativas, saldo 400 antes e depois, movimento ativo**;
- legado com mensagem e sem ação;
- transferência parcial cancelada (origem 100, derivado 0/Inativo);
- abate do curral;
- histórico offline com o cancelado;
- nenhum `DELETE`/`PATCH` de movimento saindo do navegador;
- PATCH de lote sempre com `estado_esperado`;
- sem rolagem horizontal e sem erro de página.

No celular, marcadores de lotes sintéticos de execuções anteriores cobriam os rótulos de pasto. Eles foram inativados no banco local de demonstração antes de cada execução (`limpar-sinteticos-demo.mjs.txt`). Não é regressão do produto.

Evidências: `docs/engineering/evidencias/r2a-r2/`
- `red-*` e `green-*`;
- `e2e-*.txt`;
- capturas `01`–`08` por largura;
- roteiros e semente.

### R2.7 Riscos residuais

1. `PATCH /lotes` com CAS continua permitindo correção material direta, sem trilha operacional própria; a auditoria registra. O efeito é tornar o movimento anterior **não cancelável**, nunca creditar sem prova. A conciliação assistida fica para slice futuro.
2. Linha de auditoria no mesmo milissegundo da âncora conta como posterior. É um falso bloqueio possível e raro, não um falso crédito.
3. Os itens 1 a 4 da R1.8 continuam: offline legado, várias categorias, demais manejos e pendência por aparelho.

### R2.8 Próximo slice (fora desta PR)

- Conciliação assistida de movimentos bloqueados.
- Trilha operacional para correção de saldo (substituir o PATCH material direto).
- R2B: tipos adiados.
- R2C: cocho e depósito.

## R2A-R1 — Proveniência causal, concorrência, chave pendente e cache offline

**Missão:** MAIKE-R2A-PR162-R1-HARDENING-PROVENIENCIA-CONCORRENCIA-OFFLINE. Mesma PR (#162, DRAFT). Sem migration: a proveniência é um campo do JSON `dados` do movimento. Sem escrita em produção. Sem ledger.

### R1.1 P0-A — Proveniência causal (fim da prova emprestada)

- **RED antes:** `backend/tests/r2aR1ProvenienciaRed.test.mjs` no SHA f45c6a2d. Cenário: duas mortes de 50 e um único PATCH 500→450. O cancelamento da segunda morte tomou emprestada a prova da primeira e veio **200, saldo 500**: devolveu 50 cabeças que nunca saíram. Saída em `evidencias/r2a-r1/red-prova-emprestada-antes.txt`.
- **GREEN depois:** mesmo teste: as duas mortes legadas recebem **409 `CANCELAMENTO_EFEITO_NAO_COMPROVADO`**, o saldo continua 450 e nenhuma reserva de idempotência é gravada. Saída em `green-prova-emprestada-depois.txt`.
- **Comando novo:** `POST /movimentacoes-mapa/comandos/manejo-lote` cobre Morte, Abate e Transferência de Área. Numa única transação:
  - `executarComIdempotencia` com tipo `manejo_mapa_lote`;
  - `FOR UPDATE` nos lotes, em ordem de id;
  - delta calculado no servidor;
  - lote derivado criado na transferência parcial;
  - movimento gravado com `efeito_servidor = {comando, operation_id, registrado_em, registrado_por_usuario_id, modo, efeitos:[{lote_id, criado, antes, depois}]}`;
  - auditoria.
- **Cancelamento exige as duas provas:**
  1. `efeito_servidor` válido;
  2. `OperacaoIdempotente` do mesmo cliente, `operation_key`, tipo `manejo_mapa_lote` e status committed, cuja resposta gravada aponta para **este** movimento (`response_json.movimentacao.id === mov.id`).
  - O cliente não forja a segunda prova. `efeito_servidor`, `modo_transferencia` e `lote_destino_id` agora são campos reservados: 400 em POST, bulk e PATCH.
  - Uma proveniência copiada para outro movimento falha na conferência cruzada (409) e passa a contar como dependência posterior do original.
- **Elegibilidade e POST** usam o mesmo `planejarCancelamento` e a mesma prova. Recusa não reserva idempotência, porque o rollback desfaz a reserva.
- **Participantes da transferência:** cada efeito tem `lote_id` próprio, com antes e depois. O cancelamento confere cada um:
  - mesma empresa;
  - área atual igual à de `depois`;
  - nenhum Inativo com cabeças;
  - saldo não negativo;
  - conservação total.
- **Legado** (sem `efeito_servidor`, inclusive o que a primeira versão da R2A gravou com `modo_transferencia`) é **fail-closed**: `CANCELAMENTO_EFEITO_NAO_COMPROVADO`. Nada muda no banco.

### R1.2 P0-B — Concorrência em `PATCH /lotes`

- `atualizar` trava a linha (`SELECT … FOR UPDATE`) antes de ler o anterior.
- Se o PATCH **muda** `quantidade_cabecas`, `status`, `area_atual_id` ou `categoria`, `estado_esperado` precisa trazer o valor anterior desse campo. Faltando ou divergindo: **409 `LOTE_ESTADO_CONFLITO`**. Peso, nome e campos não operacionais seguem livres.
- Consumidores atualizados:
  - `DetalhesLote` (17 chamadas via `atualizarLoteSeguro` → `comEstadoEsperado(loteLido, patch)`);
  - `CadastroLotes` (`atualizarLote(id, dados, {registroAnterior})`);
  - Renomear envia só `nome`.
  - Não há fila offline que reenvie PATCH (verificado por busca).
- **Testes determinísticos** (PostgreSQL 16 local), com trava segurada por `segurarLote` numa transação separada até a liberação:
  - PATCH obsoleto depois de cancelamento → 409, saldo 500;
  - PATCH sem estado, ou com estado obsoleto, em saldo, status, área e categoria → 409; peso e nome livres;
  - intercalação controlada cancelamento × PATCH: os dois desfechos válidos (A ou B), nunca sobrescrita;
  - **duas transferências parciais de 60 da mesma origem de 100** → [201, 409], total conservado em 100;
  - três cancelamentos paralelos → [200, 409, 409];
  - mesma chave em paralelo;
  - rollback forçado por trigger e retry;
  - "timeout depois do commit" com replay;
  - isolamento de tenant.
- Colisões de status, área e categoria: cobertas pelo CAS (campo divergente → 409) e pelas checagens do cancelamento (área atual ≠ `depois` → recusa; destino incompatível → `MANEJO_ESTADO_INVALIDO`).

### R1.3 P1-A — Chave de idempotência do cancelamento

- `operation_id` e motivo são gravados no `localStorage` (`maike_cancelamento_pendente:<id>`) **antes** do envio.
- Enquanto o resultado é desconhecido, o par sobrevive a fechar e reabrir, remontar e recarregar.
- Fechar nesse estado pede confirmação explícita (`window.confirm`).
- Reabrir reusa a mesma chave e o mesmo motivo.
- A pendência só sai com resposta definitiva: sucesso ou recusa 4xx estável. Só a recusa determinística libera uma chave nova.
- Testes (vitest):
  - timeout depois do commit → fechar (recusado e aceito) → reabrir → mesmo corpo;
  - remontagem simulando refresh → mesmo corpo;
  - replay 200 limpa a pendência.

### R1.4 P1-B — Cache offline do histórico

- Nova capacidade `movimentacoesHistorico` no `mapaCacheService` guarda **ativos e cancelados** com situação, motivo e autor. `movimentacoes` (cache operacional do mapa) continua só com ativos.
- O Histórico usa `movimentacoesHistorico` para o fallback offline e para guardar a cópia quando está online. O cancelamento bem-sucedido força o refresh dessa chave.
- A interface já diz "Exibindo movimentações salvas neste aparelho em …; podem estar desatualizadas". **Não** se afirma completude offline: é cópia do último refresh.
- A paginação da R1 e o teste de 520 registros seguem iguais (17/17 em `historicoMovimentacoes`).

### R1.5 P1-C — Interface e tipos

- Registro sem proveniência mostra, sem botão: **"Registro antigo sem comprovação individual de efeito — cancelamento temporariamente indisponível"**.
- `tipoTemCancelamento` exige tipo certificado **e** `efeito_servidor.comando === 'manejo_mapa_lote'`. Tipos adiados continuam bloqueados (teste de domínio).
- Cancelados mostram "Cancelado em … por … — Motivo: …". "Usar nome original" segue criando renomeação nova. Cocho e depósito seguem suspensos (D-PROD-94a).
- Morte, Abate e Transferência **online** no `DetalhesLote` usam o comando. Offline, o fluxo legado continua (várias chamadas, PATCH com `estado_esperado`) e gera registro **legado, não cancelável**. Isso é declarado.

### R1.6 Matriz de tipos (substitui a seção 3)

| Tipo / origem | Status |
|---|---|
| Morte criada pelo comando | **SUPORTADO_COM_PROVA_CAUSAL** |
| Abate criado pelo comando (0/Inativo volta Ativo) | **SUPORTADO_COM_PROVA_CAUSAL** |
| Transferência pelo comando (`total_no_lugar`, `parcial_novo_lote`, `parcial_unificado`, `total_unificado`) | **SUPORTADO_COM_PROVA_CAUSAL** |
| Qualquer movimento legado (sem `efeito_servidor`): Morte, Abate e Transferência antigos, inclusive os gravados com `modo_transferencia` na primeira R2A, e os criados offline | **BLOQUEADO** (`CANCELAMENTO_EFEITO_NAO_COMPROVADO`); a interface mostra a mensagem de legado |
| `efeito_servidor` sem `OperacaoIdempotente` correspondente (cópia ou forja) | **BLOQUEADO** (409) |
| Nascimento, Pesagem, Mudança de Categoria, Junção, Renomear, Entrada/Saída | **ADIADO** (R2B) |
| Cocho e depósito | **SUSPENSO** (R2C, D-PROD-94a) |

### R1.7 Testes e evidências reais

| Comando | Resultado |
|---|---|
| `node --test backend/tests/r2aR1ProvenienciaRed.test.mjs` | RED em f45c6a2d (200, saldo 500) → GREEN (409, saldo 450, sem reserva) |
| `node --test backend/tests/movimentacaoCancelamentoR2A.test.mjs` | **33/33**: P0 rotas; P1 pelo comando; proveniência (duas mortes, forja, cópia); transferências pelo comando; CAS (faltante e obsoleto em saldo, status, área e categoria) e concorrência |
| `npm run test:backend` (PostgreSQL 16 local) | **581 testes, 0 fail** (5 `todo` declarados na suíte) |
| `vitest` (smoke completo) | 98 arquivos, **1139/1139** |
| E2E cancelamento/legado/offline (Chromium, `maike_demo` sintético; semente pelo **comando**) | **64/64** em 1440, 768, 412 e 390 (16 cada). Inclui: saldo 500 conferido na API, mensagem exata de legado sem botão, **offline mostra a morte cancelada com motivo e autor**, nenhum `DELETE`/`PATCH` de movimento, PATCH de lote sempre com `estado_esperado` |
| E2E manejo normal pela UI (Morte no Detalhes do Lote) | **36/36** (9 por largura): o lote certo abre, saldo QTD → QTD−7 na API, 1 POST no comando, nenhum POST legado, nenhum PATCH operacional sem estado, movimento com proveniência e elegível ao cancelamento |
| `npm run gate:types` / `typecheck:backend` / lint | passaram (sem novo diagnóstico; 2 avisos de lint preexistentes) |

Evidências: `docs/engineering/evidencias/r2a-r1/`
- `red-*` e `green-*`;
- `e2e-*.txt` e `e2e-manejo-ui-*.txt`;
- capturas `01`–`08` por largura;
- roteiros e semente.

### R1.7a Merge de `main` (#163) e colisão de numeração

- `main` avançou com a maikelimaadm-stack/MAIKE#163 (UX-MOBILE-V4), que também usava **D-PROD-95**, e depois com a #164 (ajustes do celular V5), que usa **D-PROD-96**. As duas foram preservadas. Por decisão do proprietário, a R2A ficou como **D-PROD-97**, com 97a, 97b e 97c; a próxima livre é D-PROD-98.
- Depois do merge:
  - `verify:all` com as variáveis da CI: exit 0 (smoke 99 arquivos, 1149/1149; backend 0 falhas);
  - E2E repetido nas 4 larguras: cancelamento, legado e offline **64/64**; manejo pela UI **36/36**.
  - Evidências em `evidencias/r2a-r1/pos-merge-main/`.
  - No celular, os marcadores se sobrepõem no zoom inicial. Os lotes sintéticos "UI …" do E2E de manejo foram inativados no banco local de demonstração, porque cobriam o rótulo do pasto testado. Não é regressão do produto.

### R1.8 Riscos abertos (substitui os itens 1, 2 e 5 da seção 6)

1. **Offline continua no fluxo legado:** Morte, Abate e Transferência feitas sem conexão geram registro sem proveniência, não cancelável. O PATCH leva `estado_esperado`, então estado divergente dá 409 em vez de sobrescrever.
2. **Transferência com várias categorias** = um comando por lote de origem. Cada um é atômico, mas o conjunto não. Falha no meio deixa as primeiras categorias movidas, cada uma com proveniência própria e cancelável.
3. **Demais manejos** (Nascimento, Pesagem, Mudança de Categoria, Junção) continuam no navegador, em várias chamadas. Agora estão protegidos pelo CAS, mas não são transacionais.
4. **Pendência de cancelamento** fica no `localStorage` do aparelho. Em outro aparelho, a chave não é reaproveitada: o servidor responde pelo estado (já cancelado → recusa determinística).
5. Os itens 3, 4, 6, 7 e 8 da seção 6 continuam válidos.

## 1. Inventário (consumidores reais das escritas operacionais)

| Rota | Consumidor legítimo no `src/` | Decisão |
|---|---|---|
| `PATCH /movimentacoes-mapa/:id` | só `movimentacaoReconciliation` (exclusão do histórico, já suspensa) | **fechada** |
| `DELETE /movimentacoes-mapa/:id` | `HistoricoMovimentacoes` (suspenso), **`HistoricoAbateCurral`** (ativo, P0), **`RenomearLoteForm.handleReverter`** (ativo, P0) | **fechada**; os dois P0 migraram |
| `PATCH`/`DELETE /movimentacoes-pecuaria/:id` | nenhum | **fechadas** |
| `PATCH /suplementacao-eventos/:id` | `fecharPeriodoSuplementacao` (`sobra_kg`, `dias_periodo`, `consumo_diario_grupo_kg`) e `reabrirPeriodo` (só no serviço legado suspenso) | allow-list |
| `PATCH /suplementacao-lotes/:id` | `fecharPeriodoSuplementacao` (7 métricas de consumo) | allow-list |
| `DELETE` suplementação | só `suplementacaoHistoricoService` (suspenso na R1.1) | **fechadas** |
| `PATCH /movimentacoes-estoque/:id` | `FormularioPonto` (renomeação de depósito: `local_origem`/`local_destino`) e o serviço suspenso | allow-list conferida |
| `DELETE /movimentacoes-estoque/:id` | só o serviço suspenso | **fechada** |

## 2. Matriz por endpoint

| Endpoint | Antes | Depois | Código | Autorização |
|---|---|---|---|---|
| `DELETE /movimentacoes-mapa/:id` | 204, apagava | 409, nada muda | `MOVIMENTO_CANCELAMENTO_OBRIGATORIO` | token; outro tenant 404 |
| `PATCH /movimentacoes-mapa/:id` | 200, reescrevia `dados` | 409 | idem | idem |
| `POST /movimentacoes-mapa` (+bulk) | aceitava qualquer campo | 400 se vier campo reservado | `CAMPO_RESERVADO_CANCELAMENTO` | token |
| `PATCH`/`DELETE /movimentacoes-pecuaria/:id` | 200/204 | 409 | `MOVIMENTO_CANCELAMENTO_OBRIGATORIO` | token |
| `PATCH /suplementacao-eventos/:id` | qualquer campo | só 3 métricas (número ou null); demais 409; reservado 400 | `REGISTRO_OPERACIONAL_IMUTAVEL` | token |
| `DELETE /suplementacao-eventos/:id` | 204 | 409 | `MOVIMENTO_CANCELAMENTO_OBRIGATORIO` | token |
| `PATCH /suplementacao-lotes/:id` | qualquer campo | só 7 métricas; vínculo e `empresa_id` diferente → 409 | `REGISTRO_OPERACIONAL_IMUTAVEL` | token |
| `DELETE /suplementacao-lotes/:id` | 204 | 409 | `MOVIMENTO_CANCELAMENTO_OBRIGATORIO` | token |
| `PATCH /movimentacoes-estoque/:id` | qualquer campo | só `local_origem`/`local_destino` iguais ao nome do `LocalEstoque` do movimento | 409 / 422 `NOME_LOCAL_DIVERGENTE` | token, mesmo tenant |
| `DELETE /movimentacoes-estoque/:id` | 204 | 409 | `MOVIMENTO_CANCELAMENTO_OBRIGATORIO` | token |
| **novo** `POST /movimentacoes-mapa/:id/cancelamento` | — | 200 / 409 estável | ver 4 | **admin ativo** (`exigirAdminTenant`) |
| **novo** `GET /movimentacoes-mapa/:id/elegibilidade-cancelamento` | — | 200 `{elegivel, codigo, motivo, efeitos, pode_cancelar}` | — | token; outro tenant 404 |
| UI `HistoricoAbateCurral` "Excluir" | `atualizarLote(+q)` + `DELETE` | removido → "Cancelar movimentação" (comando) | — | admin |
| UI `RenomearLoteForm` "Reverter para nome original" | `atualizarLote(nome)` + `DELETE` em laço | "Usar nome original" (renomeação nova) | — | — |

## 3. Matriz de tipos

| Tipo / subtipo | Status | Prova |
|---|---|---|
| Morte (lote_id, efeito no AuditLog) | **SUPORTADO_COM_PROVA** | 500 → 450 → 500; replay; concorrência; rollback; dependência; sem prova |
| Abate (idem; Inativo/0 volta Ativo) | **SUPORTADO_COM_PROVA** | 50 → 0 Inativo → 50 Ativo; replay 50, não 100; curral E2E |
| Transferência total no lugar (legado e novo) | **SUPORTADO_COM_PROVA** | área volta à origem; cabeças e entrada histórica intactas |
| Transferência parcial com lote novo (`parcial_novo_lote` + `lote_destino_id`) | **SUPORTADO_COM_PROVA** | 500 → 450+50 → 500+0; derivado Inativo, não apagado, `quantidade_entrada` 50 intacta |
| Transferência parcial unificada (`parcial_unificado`) | **SUPORTADO_COM_PROVA** | 500/100 → 450/150 → 500/100 |
| Transferência total unificada (`total_unificado`) | **SUPORTADO_COM_PROVA** | 500+100 → 0 Inativo/600 → 500 Ativo/100 (teste próprio) |
| Transferência parcial ou unificada **legada** (sem lote de destino gravado) | **BLOQUEADO_POR_AMBIGUIDADE** | `CANCELAMENTO_VINCULO_AMBIGUO`, nada muda (backend e E2E) |
| Movimento sem `lote_id` (vínculo só por nome) | **BLOQUEADO_POR_AMBIGUIDADE** | `CANCELAMENTO_VINCULO_AMBIGUO` |
| Movimento sem prova do efeito no AuditLog (falha no meio do fluxo legado) | **BLOQUEADO_POR_AMBIGUIDADE** | `CANCELAMENTO_EFEITO_NAO_COMPROVADO`: não devolve cabeças que nunca saíram |
| Nascimento | **ADIADO** | o lote pode ter sido criado pelo nascimento; subtrair exige contrato próprio |
| Pesagem, Mudança de Categoria, Junção, Renomear Lote, Entrada/Saída genéricas | **ADIADO** | sem snapshot suficiente → `CANCELAMENTO_TIPO_NAO_SUPORTADO` |

## 4. Contrato do comando

- **Entrada:** `{operation_id (8–128, [A-Za-z0-9_.:-]), motivo (3–500)}`, com `additionalProperties: false`. `cliente_id`, quantidade ou qualquer outro campo dá 400. Movimento, lotes, empresa (coluna do documento), áreas e quantidade são lidos do servidor.
- **Transação única:**
  1. `exigirAdminTenant` (papel relido do banco);
  2. `executarComIdempotencia` (cliente, operation_id, `cancelamento_movimentacao_mapa`; fingerprint `{movimentacao_id, motivo}`):
     - mesma chave e mesmo payload → replay (`replay: true`), sem segundo crédito;
     - mesma chave com outro motivo → 409 `IDEMPOTENCY_CONFLICT`;
  3. `SELECT … FOR UPDATE` no movimento e depois nos lotes, ordenados por id;
  4. elegibilidade, prova e dependências;
  5. updates dos lotes e do movimento, mais as auditorias.
  - Qualquer erro → rollback completo, inclusive da reserva idempotente. O retry com a mesma chave conclui (teste com trigger que falha).
- **Concorrência:**
  - chaves diferentes no mesmo original: a segunda espera o `FOR UPDATE` e lê `situacao: cancelado` → 409 `CANCELAMENTO_JA_REALIZADO`. Teste com 3 requisições paralelas: exatamente um 200;
  - mesma chave em paralelo: `ON CONFLICT DO NOTHING` + espera → replay.
- **Prova do efeito:**
  - existe `AuditLog` do lote, em ±15 min da criação do movimento, com delta exato (−q / +q), troca exata de área ou criação do derivado com q na área de destino;
  - auditorias geradas por cancelamento são excluídas da prova.
- **Dependências (conservadoras, no banco, sem teto):**
  - qualquer registro posterior (por `createdAt` ou data operacional) ligado aos lotes por id: mapa, pecuária, suplementação por lote, medicamento, sanidade, manejo técnico, tarefas;
  - `lote_destino_id` ou id do lote em `observacoes` (snapshots de junção);
  - nome só para registro legado sem id;
  - em transferência, qualquer movimento posterior nas áreas de origem ou destino;
  - cancelados não contam.
  - Consequência: cancela-se do mais recente para o mais antigo.
- **Efeito:**
  - delta nos lotes participantes; `quantidade_entrada`, `area_entrada_id` e `categoria_entrada` nunca mudam;
  - transferência conserva a soma de cabeças (checado);
  - derivado zerado fica Inativo, não é apagado.
- **Original:** `situacao: 'cancelado'`, `cancelamento: {em, por_usuario_id, por_login, motivo, operation_id, modo, efeitos}`. Data e tipo intactos. Recancelar → `CANCELAMENTO_JA_REALIZADO`.
- **Leitura:**
  - o histórico por área/lote (R1) mostra Ativo/Cancelado com motivo, ator e horário;
  - o cache de efeito atual (`mapaCacheService.movimentacoes`) e `filterMovimentacoes` (ordem temporal do lote) ignoram cancelados;
  - as listas de referência (`listTodasMovimentacoes`) os mantêm, então lote com histórico continua protegido.
- **Offline:** só leitura. O botão fica desabilitado sem conexão, não existe fila offline de cancelamento, e o histórico de cache não exibe cancelados (só o efeito atual).
- **Compatibilidade:**
  - frontend antigo que tentar `DELETE`/`PATCH` recebe 409 estável (nunca 500);
  - movimentos antigos são lidos como antes;
  - os campos novos de transferência (`modo_transferencia`, `lote_destino_id`) são aditivos.

## 5. Testes e evidências reais

| Comando | Resultado |
|---|---|
| `node --test backend/tests/movimentacaoCancelamentoR2A.test.mjs` (PostgreSQL 16 local) | **24/24**. P0 nas 5 rotas, com spoof, outro tenant (404), sem token (401), estoque com nome válido e inválido. P1: Morte, Abate, replay, conflito, recancelamento, comum 403, dependências (mapa e sanidade), efeito não comprovado, legado sem id, tipo sem suporte, transferências (no lugar, parcial nova, parcial unificada, legado ambíguo, saldo insuficiente), concorrência (3 paralelas, mesma chave), rollback por trigger + retry, cancelamento × PATCH de lote, dois tenants com o mesmo nome |
| `node --test …documentoJsonEmpresaContrato… …movimentacaoMapaNomesArea… …movimentacaoMapaHistoricoPaginado…` | 27/27 (testes da R1 ajustados ao PATCH fechado) |
| `vitest tests/smoke/cancelamentoMovimentacao.test.jsx` | **8/8**. Admin envia só `operation_id`+`motivo`; resultado desconhecido reenvia a **mesma** chave; recusa definitiva usa chave nova; não elegível não confirma; comum/offline/tipo sem suporte; curral sem Excluir; renomear seguro; varredura sem `DELETE`/`PATCH` de movimento fora da camada de API |
| `vitest` (smoke completo) | 98 arquivos, **1132** testes |
| E2E Chromium (Vite + backend local + `maike_demo` sintético; semente por HTTP no fluxo legado) | **44 PASS / 0 FAIL** em 1440, 768, 412 e 390 (11 cada): histórico com Ativo e ação; diálogo com efeito do servidor (450 → 500); cancelado com ator e motivo; **saldo 500 conferido na API**; legado bloqueado; curral sem Excluir e abate cancelado; **nenhum `DELETE`/`PATCH` operacional no navegador**; 2 POST de cancelamento; sem rolagem horizontal; sem erro de página |
| E2E usuário comum (1440) | PASS: lê o histórico e não vê "Cancelar movimentação" |
| E2E regressão da R1.1 (1440) | 15/15: área vazia, curral, cocho e depósito suspensos, seleção de tarefa |
| `npm run gate:types` / `typecheck:backend` | passaram (1240 diagnósticos ≤ teto 1746; nenhum novo) |
| `npm run verify:all` (variáveis da CI) | resultado colado na resposta ao proprietário |

Evidências: `docs/engineering/evidencias/r2a-cancelamento/`
- capturas `01`–`05` por largura e `06` (usuário comum);
- logs `e2e-*.txt`;
- roteiro e semente sintética.

## 6. Riscos abertos

1. **Criação ainda no navegador:** Morte, Abate, Transferência etc. continuam em várias chamadas sem transação (`DetalhesLote`).
   - O cancelamento se protege com a prova do AuditLog, mas a criação pode deixar estado parcial.
   - Próximo slice: comandos de criação server-side.
2. **`PATCH /lotes` não compartilha a trava:** um PATCH concorrente espera o `FOR UPDATE` e depois grava o valor absoluto que calculou antes do cancelamento. O resultado é serial, mas pode sobrescrever o delta. Testado sem 500. Não há serialização completa com o fluxo legado.
3. **Tipos adiados:** Nascimento, Pesagem, Mudança de Categoria, Junção, Renomear, Entrada/Saída.
4. **Legado parcial ou unificado** fica sem cancelamento (sem lote de destino gravado). Não há heurística por nome, por decisão.
5. **Prova por AuditLog** depende de auditoria existente (P3+). Movimentos anteriores a ela ficam bloqueados.
6. **Cocho e depósito:** cancelamento continua suspenso (D-PROD-94a), aguardando o slice de estoque. As rotas genéricas de estoque e suplementação agora recusam.
7. **Códigos `*_NOT_FOUND` não declarados** em outros módulos (bebedouros, aplicações, eventos sanitários, manejo técnico, fornecedor, ponto de suplementação) ainda viram 500. Fora do escopo; registrado aqui.
8. **`PATCH` genérico** das demais rotas JSON sem saldo (bebedouros, sanidade, medicamento, manejo técnico) continua aberto. Não afeta saldo de animais nem de estoque.

## 7. Rollback

Reverter os commits da PR. Não há migration nem dado a desfazer. Movimentos já cancelados continuam legíveis: `situacao` e `cancelamento` são campos do JSON.

## 8. Próximos slices (não iniciados)

- R2B: cancelamento de Nascimento, Pesagem e Mudança de Categoria com snapshot.
- R2C: estorno de cocho e depósito (estoque) transacional.
- Comandos de criação server-side para os manejos do `DetalhesLote`.
