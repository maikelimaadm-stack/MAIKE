# D-PROD-114 — Certificação pela UI: Nascimento e Junção, dependências e exclusão segura

- **Base:** `origin/main` `2b2477f3` (merge da #181; CI da main 41741228608 = success).
- **Alvo:** só local.
  - Backend em `127.0.0.1:3334`, Vite em `127.0.0.1:5180`, PostgreSQL 16 no banco `maike_e2e_r2`.
  - O roteiro recusa qualquer alvo não local ou banco com roles do Supabase antes de escrever.
  - Cada execução cria um tenant sintético novo, com senha aleatória que não é gravada.
- **Sem escrita** em produção nem no Preview. **Decisão:** [D-PROD-114](./DECISIONS.md).

## Matriz (UI real, 148/148 PASS em 1440, 390, 412 e 768)

O roteiro está em `evidencias/d-prod-114/visual/roteiro-e2e-local.cjs.txt` e o resultado por linha em `visual/resultados.txt`.

| Cenário | Verificado pela UI | 1440 | 390 | 412 | 768 |
|---|---|---|---|---|---|
| A1 Nascimento com 2 linhas (3 M 32 kg, 2 F 30 kg) | 1 POST por confirmação (duplo clique não duplica); corpo sem saldo; posições dos nascidos; matrizes e cadastro intactos; ledger íntegro, conservação e 0 órfãos | PASS | PASS | PASS | PASS |
| A2 Pesagem dos bezerros (dependente) | 1 POST; no histórico, Nascimento **bloqueado antes do clique** (disabled, `aria-describedby`, motivo) e Pesagem elegível | PASS | PASS | PASS | PASS |
| A3 Excluir pesagem → desbloqueio → excluir nascimento | 1 POST `/exclusao` com só `{operation_id, motivo}`; fato apagado com auditoria; nascimento **desbloqueia sem recarregar**; projeção **exata** pré-nascimento (posições dos bezerros removidas); 2 recibos `excluido`; cadastro intacto; reabrir o histórico não ressuscita nada | PASS | PASS | PASS | PASS |
| B1 Juntar Lotes (PRIN 30 × 400 + ORIG 20 × 350) | 1 POST de junção; nenhum POST/PATCH de lote ou movimento genérico; corpo só com ids; servidor: 50 cabeças, peso ponderado 380, origem 0, linhagem com a contribuição | PASS | PASS | PASS | PASS |
| B2 Morte de 40 (dependente da junção) | Junção **bloqueada antes do clique**, Morte elegível; excluir a morte desbloqueia a junção **sem recarregar**; excluir a junção devolve o estado pré-junção **exato** (quantidades, pesos, linhagem); 2 recibos `excluido` | PASS | PASS | PASS | PASS |
| B3 POST com dependência ativa | 409 `CANCELAMENTO_SALDO_HISTORICO_NEGATIVO` e **zero mutação** (posições, cadastro, recibos, auditoria) | PASS | PASS | PASS | PASS |
| C3 Concorrência e qualidade | Máximo de 2 GETs de elegibilidade em voo (contador dentro da página); 0 DELETE/PATCH ou `/cancelamento`; sem erros de página; sem respostas 4xx; sem rolagem horizontal | PASS | PASS | PASS | PASS |

Duas formas de navegar foram cobertas:
- abrir o histórico depois do manejo;
- reabrir o histórico depois das exclusões.

**Não executados pela UI** (cobertos em PostgreSQL real pelas suítes D-PROD-110/113, que seguem verdes):
- nascimento retroativo impossível (morte das matrizes antes);
- origem incompatível ou classificação divergente na junção;
- saldo insuficiente;
- vínculo documental;
- replay da operação original.

Também não foram repetidos aqui:
- aborto real ao desmontar: provado no E2E da D-PROD-113 R2 e no smoke R2-3;
- falha de rede e fila offline: smoke.

O setup das entradas usou a API do cadastro (`POST /lotes`), não a tela do Cadastro.

## Bug encontrado

| ID | Severidade | Reprodução | Correção |
|---|---|---|---|
| UX-4 | P2 | Excluir pela UI. A invalidação geral refaz o GET de elegibilidade do id apagado antes de o histórico recarregar, gerando `404 GET /movimentacoes-mapa/<id>/elegibilidade-exclusao` (3 por rodada). No smoke: a consulta se repete depois da exclusão. | `ExcluirMovimentacao.jsx`: o estado `excluida` desliga as consultas e o card some ao confirmar. |

Evidências: `ux4-red-green.txt` (RED no `2b2477f3`), `backend-regressao.txt` (56/56) e `visual/*.png`.

## Observação (não corrigida, fora de escopo)
- No bloqueio por saldo, o servidor não envia o tipo do fato bloqueador. Por isso o card lê "Bloqueador: em 04/11/2026 (PASTO JUNC)".
- É só texto: a recusa é correta.
