# D-PROD-110: exclusão definitiva segura de movimentações do rebanho

**Missão:** "Excluir movimentação" passa a ser a única forma de corrigir um movimento confirmado. Não existe edição. A exclusão é server-side, idempotente, só online, e apaga o fato inteiro ou nada.
**Decisão:** [`DECISIONS.md` → D-PROD-110](./DECISIONS.md).
**Produção:** nada foi tocado. Sem migration, sem deploy, sem chamadas ao Supabase.

## Contrato

| Rota | Quem | Corpo | Resposta |
|---|---|---|---|
| `GET /movimentacoes-mapa/:id/elegibilidade-exclusao` | qualquer usuário do tenant (outro tenant: 404) | — | `{elegivel, codigo, motivo, detalhes, efeitos[], posicoes_removidas[], pode_excluir, requer_administrador, modo}` |
| `POST /movimentacoes-mapa/:id/exclusao` | administrador ativo (relido do banco) | `{operation_id, motivo}` e nada mais (400 para qualquer outro campo) | 200 `{excluida, movimentacao_id, tipo, evento_tipo, efeitos[], posicoes_removidas[], replay}` |

Cada efeito traz, por posição: `nome`, `area_nome`, `delta_desfeito`, `quantidade_depois`, `peso_revertido`, `peso_depois_kg` e `removida`. Tudo é calculado pelo servidor.

## Como funciona (uma transação)

1. `exigirAdminTenant`, depois idempotência por `(cliente, operation_id, 'exclusao_movimentacao_mapa')` com fingerprint.
2. Trava `MovimentacaoMapa FOR UPDATE`. Se o movimento já não existe, a resposta é 409 `EXCLUSAO_JA_REALIZADA` quando há auditoria da exclusão, ou 404 quando não há.
3. Movimento que não é do ledger recebe 409 `EXCLUSAO_MOVIMENTO_LEGADO`. Movimento já cancelado recebe 409 `EXCLUSAO_MOVIMENTO_CANCELADO`.
4. `excluirMovimentoDoLedger` reverte pelo motor certificado `cancelarMovimentoDoLedger`:
   - trava áreas e depois posições;
   - aplica as guardas de vínculo causal, saldo por data, peso causal, pesagem/nascimento e junção.
5. Recusa com `EXCLUSAO_REFERENCIA_DOCUMENTAL` se algum documento, mesmo cancelado, cita o movimento.
6. Apaga, nesta ordem: `PesoRebanho` → `PartidaRebanho` → `EventoRebanho` → `MovimentacaoMapa`. Não há cascata.
7. Remove a posição sem nenhum uso restante e reprojeta as demais.
8. Marca a operação original como `status = 'excluido'`. Um replay dela recebe 409 `IDEMPOTENCY_EFEITO_EXCLUIDO`.
9. Grava `AuditLog` com `exclusao_definitiva` e um `delete` por posição removida.

Qualquer falha desfaz tudo. Isso está provado com falhas injetadas em `exclusao_apos_reversao` e em `exclusao_apos_delete`.

## Tipos

**Suportados e testados em PostgreSQL real:**
- Transferência: parcial, total, retroativa, de ida e volta;
- Morte: pelo comando de baixa e pelo manejo de lote;
- Abate;
- Nascimento;
- Pesagem;
- Mudança de Categoria;
- Junção.

**Bloqueados:**
- movimento legado sem evento certificado (`EXCLUSAO_MOVIMENTO_LEGADO`);
- movimento já cancelado pelo mecanismo anterior (`EXCLUSAO_MOVIMENTO_CANCELADO`; não há limpeza retroativa nesta PR).

Entrada e saldo de abertura não são movimentos do mapa: continuam pela exclusão do Cadastro de Lotes.

## Interface

- "Excluir movimentação" substitui "Cancelar movimentação" no **Histórico de Movimentações** e no **Histórico de Abate do Curral**. O componente `CancelarMovimentacao.jsx` foi removido.
- O endpoint de cancelamento continua no backend só por compatibilidade.
- O diálogo mostra:
  - a conferência de elegibilidade;
  - o bloqueador, com data, área e tipo do documento;
  - o efeito por posição;
  - os campos obrigatórios: motivo e a caixa "exclusão definitiva".
- Resultado desconhecido: a mesma `operation_id` é guardada por tenant e usuário, e "Tentar de novo" reenvia com ela.
- Offline: o botão fica desabilitado, com motivo visível. Nada vai para a fila.
- Operação offline pendente para o mesmo registro: a exclusão fica bloqueada.
- Depois do sucesso, ou se o servidor responde "já excluída":
  - o movimento sai das cópias offline do tenant (`removerRegistroDosCachesOffline`);
  - sai também de `movimentacoes` e `movimentacoesHistorico` da empresa;
  - os caches são atualizados com refresh forçado e as consultas são invalidadas;
  - o evento `atualizar-mapa` é disparado.
- Não havia na UI do rebanho nenhuma ação de "editar movimento confirmado". As que existem pertencem ao estoque, que está fora do escopo.

## Testes

**Backend:** `backend/tests/exclusaoMovimentacaoLedger.test.mjs`, 23 testes em PostgreSQL 16 local isolado.
- **RED:** 23/23 falhavam porque a rota não existia (`docs/engineering/evidencias/d-prod-110/backend-red.txt`).
- **GREEN:** 23/23 passam (`backend-green.txt`).

| Requisito | Teste |
|---|---|
| (a) exclusão simples, some do histórico e da listagem, saldos restaurados | B6, transferência total ida/volta |
| B6: 10 em A → 3 para B → EXCLUIR → A=10, B=0, cadastro 10, item fora do histórico | B6 |
| (b) dependente bloqueia com 0 escrita | morte/pesagem posterior, tarefa, documento ativo e cancelado |
| (c) posterior independente não bloqueia | T1 → T2 + pesagem em A |
| (d) cancelar × excluir, duas exclusões, retry com a mesma chave | EX-D (3 testes; o primeiro roda 3 rodadas) |
| (e) falha injetada → ROLLBACK total | EX-E (2 passos) |
| (f) replay do comando original não ressuscita o fato | EX-F |
| (g) usuário comum 403, tenant B 404, sem token 401, delta/saldo/ids no corpo 400, admin revogado 403 | EX-G |
| (h) proveniência forjada, operação não confirmada, legado, cancelado | EX-H |
| (i) Lote intacto | B6 e EX-T (todos os tipos) |
| (j) auditoria mantida sem segredo; nenhum evento "cancelado" sobra | `exigirFatoApagado` em todos os sucessos |
| todos os manejos devolvem a projeção exata de antes | EX-T (8 casos) |

**Smoke (vitest):** `tests/smoke/exclusaoMovimentacao.test.jsx`, 13 testes:
- diálogo, confirmação e corpo enviado;
- caches do tenant e da empresa;
- retry com a mesma chave, inclusive depois de remount e isolado por usuário;
- recusas;
- "já excluída";
- bloqueio por fila offline;
- usuário comum, offline, legado e cancelado;
- domínio;
- curral;
- varredura.

Também foram ajustados `historicoMovimentacoes`, `r2eLedgerRebanho` e `detalhesLoteCutoverPendente`.

**Gate:** `gate:rebanho-ssot` ganhou a regra `P110-EXCLUSAO-UNICA`.

## Riscos e limites

- Não houve smoke visual em um navegador real, nem em desktop nem no celular. A verificação foi feita com jsdom. A conferência visual fica no Vercel Preview desta PR.
- A busca por citações à posição removida usa `strpos` sobre o JSON dentro do tenant. É uma busca conservadora: na dúvida, a posição fica.
- **Release bloqueado:** sem backup restaurável comprovado e sem autorização de deploy do proprietário, o uso real não está liberado.
