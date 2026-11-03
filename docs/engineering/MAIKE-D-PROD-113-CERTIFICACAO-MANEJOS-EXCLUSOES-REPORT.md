# D-PROD-113 — Certificação transversal: manejos, dependências e exclusões

- **Base:** `origin/main` `69cb9eca` (merge da PR #180).
- **Alvo:** só PostgreSQL 16 local isolado (bancos `maike_ci` e `maike_e2e_r2`), com dados sintéticos. A suíte backend recusa qualquer alvo que não seja localhost antes de escrever.
- **Produção e Preview:** sem nenhuma escrita.
- **Decisão:** [D-PROD-113](./DECISIONS.md).

## Matriz executada (PostgreSQL real)

Arquivo: `backend/tests/certificacaoManejosExclusoes.test.mjs`, 15 testes.

Em todos os testes:
- antes de cada exclusão, o GET é conferido sem escrita, por fotografia completa (Lote, posições, eventos, partidas, pesos, movimentos, recibos e auditoria);
- todo 409 é conferido sem mutação;
- depois de cada exclusão: apagamento físico, recibo original marcado (exatamente 1), conservação de cabeças, zero órfãos e verificação do ledger íntegra;
- no fim, a projeção é idêntica à de antes da cadeia e o Cadastro de Lotes não muda.

| Cadeia / cenário | O que prova |
|---|---|
| **CERT-1** entrada → transferência → pesagem → mudança de categoria → morte | Os nós do meio bloqueiam (saldo, peso causal). Na ordem inversa, cada antecessor só libera depois que o dependente sai. |
| **CERT-2a** nascimento → transferência dos bezerros → pesagem | O nascimento fica bloqueado enquanto os nascidos são usados. As matrizes ficam intactas. |
| **CERT-2b** morte retroativa das matrizes antes do nascimento | Recusada na criação (`REBANHO_DEPENDENCIA_FATO_SEM_SALDO`). O nascimento de outra área é independente. |
| **CERT-3a** entradas A+B → junção → abate | Junção bloqueada pelo abate. A reversão devolve linhagem e peso ponderado (400/350 → 380 → volta). |
| **CERT-3b** abate e morte pelo comando de baixa (multi-categoria) | Mesma reversão do manejo de lote. |
| **CERT-4a** posteriores independentes e mesmo dia | Uma transferência de A para C, uma pesagem e uma morte em A não bloqueiam a transferência A→B. Uma transferência no mesmo dia, registrada depois e usando as cabeças, bloqueia. |
| **CERT-4b** retroativo | Morte em data anterior a uma transferência já lançada: a criação retroativa que deixaria saldo negativo é recusada, e a exclusão em qualquer ordem válida restaura. |
| **CERT-5** pesagens sucessivas | Excluir a intermediária e a final restaura a série (460 → 420 → 400). A transferência derivada do peso bloqueia a pesagem que a alimentou (`REBANHO_PESO_DEPENDENCIA_CAUSAL`). |
| **CERT-6a** destino já existente + transferência multi-item | A posição de destino que ainda é usada não sai. A multi-item reverte as duas origens. |
| **CERT-6b** transferência total + morte total no destino | A origem zerada não é removida (tem a entrada). A reversão é exata. |
| **CERT-7** mudança de categoria total + pesagem na nova categoria | Bloqueia e depois desbloqueia; a categoria original volta. |
| **CERT-8** dois nascimentos na mesma posição | A posição é compartilhada. A exclusão respeita o peso derivado; a posição só sai quando não tem nenhum uso. |
| **CERT-9a** excluir transferência × criar morte dependente, simultâneos (4 rodadas) | No máximo um vence; o ledger fica íntegro (sem TOCTOU). |
| **CERT-9b** duas exclusões independentes na mesma origem, simultâneas (4 rodadas) | Ambas passam, sem deadlock. |
| **CERT-10** legado sem prova, cancelado pelo endpoint antigo, DELETE/PATCH genéricos | Recusados com código estável e zero mutação. A entrada do cadastro não é movimento excluível. |

Também seguem verdes as suítes anteriores:
- `exclusaoMovimentacaoLedger` (28): autenticação, tenant B, recibo exato, falha injetada, replay e idempotência;
- R1, R5, R6 e cancelamento (80).

## Bugs encontrados e corrigidos

| ID | Severidade | Reprodução | Correção |
|---|---|---|---|
| UX-1 | P1 | Card bloqueado por pendência offline; a fila sincroniza com o histórico aberto; o card continua "Exclusão bloqueada" até remontar. | O card escuta o evento de mudança da fila (serviço → API → porta) e relê as pendências. |
| UX-2 | P2 | 10 cards; o histórico fecha com 8 consultas esperando vaga; mesmo assim 6 GETs disparam depois de desmontar. | `comLimiteDeConsultas(fn, signal)`: a consulta enfileirada com `signal` abortado não roda. |
| UX-3 | P2 | 2 consultas que nunca respondem prendem as 2 vagas, e todos os outros cards ficam em "Verificando…" para sempre. | Teto de 30 s por consulta (`LIMITE_CONSULTA_MS`): libera a vaga e falha fechado. |
| BUG-4 | P1 (release/CI) | `premerge-migrate` no HEAD da main com árvore limpa → MANIFESTO_INCOMPLETO. B7 fica vermelho, assim como o CI de cada merge na main desde a #174. | `migrationsDoManifestoFaltando`: uma migration aprovada que já está na main não "falta". Teste B8. |

Os testes RED estão no HEAD de partida. Evidências: `evidencias/d-prod-113/ux-red-green.txt` e `b7-premerge-red-green.txt`.

## UI real (Playwright, stack local)

`evidencias/d-prod-113/visual/`: 57/57 PASS em 1440, 390 e 412.

- O histórico da área mostra a cadeia antes de qualquer clique: transferência, pesagem e mudança como "Exclusão bloqueada", e a morte como elegível.
- O motivo fica visível no card e ligado ao botão por `aria-describedby`. Clicar no card bloqueado não abre o diálogo.
- Ao excluir pela UI, na ordem morte → mudança → pesagem → transferência, cada antecessor **desbloqueia sem recarregar** e o item excluído some do histórico.
- No fim só resta a entrada, e o cadastro continua igual.
- No histórico de abate do curral, o abate é excluído pela UI e as cabeças voltam ao curral.
- No máximo 2 GETs simultâneos. Nenhum DELETE ou PATCH de movimento. Sem rolagem horizontal. Sem erros na página.

## Não executado / limites

- Escrita no Vercel Preview: bloqueada por segurança, porque o banco do Preview pode ser o mesmo da produção. Todo o E2E foi local.
- Carga além de 100 cards ou concorrência acima de 2 clientes simultâneos: não medidas, e não há SLA definido.
- Referência documental de outros módulos: coberta pelas suítes da D-PROD-110 (tarefa, documento ativo e cancelado), não repetida aqui.
