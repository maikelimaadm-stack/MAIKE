# Protocolo de Continuidade

Como retomar o trabalho em sessão nova, sem depender de histórico de chat.

---

## Início de sessão

1. Ler `README_AI.md`
2. Ler `docs/engineering/CURRENT-STATE.md` — descobre a fase atual
3. Ler `docs/engineering/DECISIONS.md` — descobre o que já foi decidido
4. Rodar `npm run verify:all` — descobre o estado real do código
5. Ler o relatório da última fase concluída em `docs/FASE-N-RELATORIO.md`

**Só depois disso começar a trabalhar.**

## Fim de sessão

1. Escrever ou atualizar `docs/FASE-N-RELATORIO.md`
2. Atualizar `docs/engineering/CURRENT-STATE.md`
3. Registrar decisões novas em `DECISIONS.md` com `D-xx`
4. Rodar `npm run verify:all` e colar a saída no relatório
5. Commit

## Quando o chat contradiz o repositório

**O repositório vence.** Sempre.

## Quando o agente não sabe o que fazer

Parar e perguntar. Ver `docs/constitution/08-REGRAS-DE-IA.md`, seção 4.

Parar é comportamento correto. Inventar não é.
