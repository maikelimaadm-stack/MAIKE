# D-PROD-112 — Pré-validação da exclusão no histórico

Missão: MAIKE-POS178-UX. A pessoa vê **antes de clicar** se a movimentação pode ser excluída.
Decisão: [D-PROD-112](./DECISIONS.md). Motor, ledger, banco e migrations não foram alterados.

## O que mudou
- `src/components/lotes/ExcluirMovimentacao.jsx`:
  - estado do card antes do clique: verificando, elegível, bloqueada (com motivo), erro (com "Verificar de novo"), offline e pendência offline;
  - consulta só do card visível, com limite global de 2 em voo (`comLimiteDeConsultas`);
  - chave da consulta por tenant + usuário + empresa + id;
  - revalidação ao abrir o diálogo; confirmar exige elegibilidade fresca;
  - após um 409, o card reconsulta.
- `HistoricoMovimentacoes.jsx` e `HistoricoAbateCurral.jsx`:
  - a ação foi para o rodapé do card, em largura total, com o motivo visível;
  - o evento `atualizar-mapa` invalida a elegibilidade.

## Provas
- **Interface (vitest):** `tests/smoke/exclusaoMovimentacao.test.jsx`, 24 testes:
  - os 6 estados;
  - sem autorização, legado e cancelado;
  - `pode_excluir=false`;
  - revalidação ao abrir;
  - corrida GET→POST com 409;
  - escopo por tenant/empresa;
  - escala: com 100 cards, no máximo 2 GETs simultâneos e 1 por card;
  - com IntersectionObserver: só os 6 cards visíveis consultam e os outros 94 ficam "Verificando…".
- **PostgreSQL local:** `backend/tests/exclusaoMovimentacaoLedger.test.mjs`, teste EX-UX (28/28 no arquivo).
  - Cenário: 50 de A→B, depois pesagem em B (320→350).
  - O GET recusa a transferência (`REBANHO_DEPENDENCIA_FATO_SEM_SALDO`, com tipo, data e área) e permite a pesagem.
  - O POST da transferência recebe 409 e nada muda.
  - Depois de excluir a pesagem, a transferência fica elegível e a exclusão dela devolve A=80 e B=0.
- **Playwright local** (stack isolada, sem Preview): 21/21 PASS em 1440, 390 e 412.
  - O card da transferência mostra "Exclusão bloqueada" com o motivo sem nenhum clique.
  - A pesagem fica com o botão habilitado.
  - Sem rolagem horizontal.
  - Ao abrir o histórico de B (16 movimentos), no máximo 2 GETs simultâneos e 2 no total.
  - Evidências em `evidencias/d-prod-112/`.

## PR180-R2 — fail-closed da fila offline
- **Defeito** (no HEAD `ad490a9c`): a leitura da fila offline usava `Array.isArray(data) ? data : []`. Uma fila ainda sem resposta, ou cuja leitura falhou, contava como vazia. Se o GET elegível chegasse antes da leitura da fila, o card podia habilitar.
- **Correção:**
  - fila vazia **confirmada** = leitura terminada com sucesso + array vazio + nenhuma releitura em voo;
  - formato inesperado vira erro;
  - elegibilidade só vale fresca;
  - o mesmo predicado vale no botão e no guard de `confirmar`;
  - o retry com a mesma chave continua, mas só com a fila confirmada vazia.
- **Testes A–E** (`exclusaoMovimentacao.test.jsx`):
  - RED no código antigo: 4 falham (A, B, C, E); o D (releitura) já passava;
  - GREEN: 29/29 no arquivo e 86/86 no smoke afetado;
  - EX-UX em PostgreSQL local: 28/28;
  - Playwright local: 14/14 (1440 e 390);
  - evidências em `evidencias/d-prod-112/pr180-r2-*.txt`.

## Limites
- No cenário de aceite, a área do bloqueador não sai no card: o servidor manda só o `area_id` nesse código. O trajeto (A → B) já aparece no card.
- Elegibilidade reaproveitada por até 30 s, enquanto o histórico fica aberto. Confirmar sempre reconsulta.
