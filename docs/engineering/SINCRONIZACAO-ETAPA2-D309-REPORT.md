# Relatório — Sincronização profissional, Etapa 2: só o que mudou (D-PROD-309)

**Data:** 2026-11-25 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-309](./DECISIONS.md)

## Problema

A cada sincronização (preparo, 6 h, "Sincronizar agora", reabrir telas), o app baixava as listas **inteiras**. A mesma lista era pedida por três camadas: o cache das entidades, o mapa e as telas. Com milhões de registros por cliente, isso não escala: o volume cresce com o tamanho da fazenda, não com o que mudou.

## Solução

### Servidor: "o que mudou desde"

`GET /lotes/mudancas`, `/pontos-suplementacao/mudancas`, `/leituras-cocho/mudancas` e `/suplementacao-eventos/mudancas`.

| Parâmetro | Significado |
|---|---|
| `desde` | a marca da última sincronização (instante do servidor); ausente = tudo |
| `cursor` | a próxima página (keyset `updatedAt, id`) |
| `limite` | tamanho da página (até 2000) |

A resposta traz:
- `agora`: a próxima marca;
- `itens`: a mesma forma da listagem;
- `excluidos`: exclusão física pelo histórico de auditoria, lote excluído logicamente e lançamento cancelado;
- `proximo`: o cursor da próxima página;
- `recarregar`: exclusões demais no período, então o aparelho baixa tudo.

A janela tem uma margem de 60 s, para não perder gravações que ficam visíveis um pouco depois. Repetir um registro é inofensivo, porque o aparelho junta pelo id.

### App: um ponto só

`nativeRequest` reconhece os 4 caminhos e, com a cópia guardada e a marca, pede só o que mudou. Ele junta pelo id, tira os excluídos, ordena como o servidor e devolve a lista inteira. Cadastros, mapa e telas ganharam juntos, sem mudar nenhuma tela.

| Situação | Comportamento |
|---|---|
| Primeira vez, cópia sem marca ou formato antigo | baixa tudo em páginas de 1000 |
| Próximas vezes | só o que mudou (normalmente uma página pequena) |
| Sem internet | a cópia |
| Internet fraca, com cópia | a tela abre em até 6 s com a cópia; a sincronização termina por trás |
| Servidor sem a rota (versões fora de ordem) | a lista inteira, como antes |
| Três telas pedindo juntas | uma sincronização só |
| A tela acabou de salvar | a próxima leitura sempre traz o que foi salvo |
| A conta trocou no meio | nada é gravado |

## Revisão independente

O revisor confirmou como corretos:
- a forma pública idêntica nas 4 rotas;
- o conteúdo das listas;
- a ordem do lado do app;
- o `updatedAt` em todas as escritas, inclusive o `UPDATE` cru do ponto, que usa `now()`;
- as exclusões auditadas;
- a impossibilidade de excluir em cascata leitura de cocho com histórico;
- a permissão e o tenant.

Ele achou 5 pontos no app, todos corrigidos e cobertos por teste:

| # | Achado | Correção | Teste |
|---|---|---|---|
| 1 | Uma leitura logo depois de salvar podia pegar carona numa sincronização de antes e não mostrar o salvo | uma sincronização rodando e uma na espera; quem chega depois de a rodando ir à rede recebe a seguinte | SI-09 |
| 2 | A espera de 6 s valia por página: com muitas páginas, a tela esperava minutos | 6 s no total; depois a cópia, e a sincronização termina por trás | SI-10 |
| 3 | Quem pedia primeiro emprestava o `signal` às outras telas | o trabalho compartilhado não leva o `signal` | — |
| 4 | Conta trocada no meio das páginas podia misturar dados | confere a conta antes de cada página e antes de gravar | SI-11 |
| 5 | `Object.hasOwn` não existe em WebView Android antigo | `hasOwnProperty.call` | — |

O revisor também apontou a falta de índices por `updatedAt`. Eles vão numa missão própria, ver abaixo.

## Por que os índices ficaram para a próxima missão

O projeto tem uma disciplina rígida para migration:
- manifesto com checksum;
- classificador EXPAND/CONTRACT;
- uma bateria de testes que fixa a ordem e a contagem das migrations aplicadas;
- liberação manual em produção (`release-migrate`).

Adicionar a migration aqui quebrava dezenas de testes pinados e misturava duas liberações. O código desta etapa funciona sem os índices; eles só aceleram as consultas quando houver volume. A próxima missão é só deles:
- `(cliente_id, updatedAt, id)` nas 4 tabelas;
- `(cliente_id, entidade, acao, createdAt)` em `AuditLog`.

## Verificação

- **Backend:** `backend/tests/sincronizacaoIncremental.test.mjs` (MU-01..08) passa contra um PostgreSQL 16 local. `loteNativo`, `g2PontosLigacoes` e `idDoAparelho` continuam passando.
- **App:** `tests/smoke/sincronizacaoIncremental.test.js` (SI-01..11) e a suíte `test:smoke` completa.
- **Gates:** types, import-integrity, source-closure, product-scope, api-boundary, admin-isolation, governance-paths, no-secrets, base44, tenancy, indices e typecheck:backend.
- **Banco:** sem migration.
