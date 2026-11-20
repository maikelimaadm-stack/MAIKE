FATIA: MAIKE-EXCLUIR-HISTORICOS-MAPA (etapa 1)
BRANCH: feat/excluir-historicos-mapa
PR: #351

# MAIKE-EXCLUIR-HISTORICOS-MAPA — Relatório (etapa 1)

**Decisão:** [D-PROD-266](./DECISIONS.md) · **Base:** `origin/main` `3c8329b1` · **Migration:** nenhuma

## 1. Pedido e escolhas do proprietário

"Meus históricos no mapa não aparecem opções de excluir" — em todos os históricos do mapa (Lote, Área/Pasto, Suplementação do lote, Cocho/Depósito/Tarefas). Duas escolhas dele:

- **Quem pode:** "liberar para quem tem permissão" (não só o administrador). O usuário `maike` está como usuário comum, sem `is_admin` e com quase nenhuma ação do mapa ligada (leitura em produção, só `SELECT`).
- **Escopo:** duas etapas. Etapa 1 (esta) leva para os históricos do mapa o que já existe; etapa 2 faz o estorno seguro de lançamento de cocho e de transferência de depósito, que precisa de servidor novo.

## 2. Levantamento (antes de mexer)

Quatro agentes mapearam cada histórico (tipos de registro, rota existente, regra, onde já aparecia, por que não aparecia no mapa) e um revisor cético conferiu cada mapa. Principais achados:

| Histórico | O que existia | Por que não aparecia |
|---|---|---|
| Lote / pasto (aba Histórico v12) | Exclusão definitiva dos 7 tipos do ledger (D-PROD-110), no diálogo Manejos → Históricos → "Histórico de Movimentação" | A aba era só leitura por decisão (D-PROD-218/222); o cartão não levava o movimento; só o administrador real via |
| Área (registros de campo) | Cancelamento do apontamento (`/atividades/.../cancelar`) na tela de Atividades | A aba da área não tinha ação |
| Suplementação do lote / lançamento de cocho / transferência de depósito | **Nada seguro**: DELETE sempre 409 por desenho, estorno suspenso (`CANCELAMENTO_COCHO_HABILITADO = false`) | Bloqueio deliberado (D-PROD-94a/161) → **etapa 2** |
| Leitura de cocho, bebedouro, abate do curral | Excluir existente | Já aparecem |
| Tarefa (evento) | DELETE existente, só administrador/`is_admin` | O botão aparecia para quem o servidor recusa (403) |

## 3. O que mudou

| Frente | Arquivos | Mudança |
|---|---|---|
| Permissão | `src/lib/mapaGeralPermissions.js`, `backend/src/shared/auth/autorizacaoTela.js`, `movimentacaoMapaRoutes.js`, `movimentacaoMapaExclusaoService.js`, `ExcluirMovimentacao.jsx`, `scripts/gates/gate-rebanho-ssot.mjs` | Chave gravadora `excluir_movimentacoes_lote` (desligada ao nascer; aparece sozinha em Permissões). Guarda nas duas rotas e relida na transação. Tela mostra a ação para administrador, `is_admin` ou a chave; 403 vira "Você não tem permissão para excluir movimentações." |
| Lote / pasto | `LinhaDoTempo.jsx` (espaço `acoes`), `historicoDoPasto.js` (movimento no cartão), `AbaHistorico.jsx`, `src/styles/mk-dp-tl-acoes.css` | Um Excluir por movimento, mesmas condições do "Histórico de Movimentação"; aviso só quando o registro envolve outro pasto; relê histórico e mapa depois |
| Área | `AbaRegistrosDaArea.jsx`, `DetalhesArea.jsx`, `detalhes-area/CancelarRegistroDaArea.jsx` (novo) | "Cancelar registro" com motivo, só online, permissão de Atividades; conflito de versão fecha e relê; nome acessível com tipo e dia |
| Tarefa | `HistoricoTarefaPanel.jsx`, `DetalhesTarefaMapa.jsx`, `src/hooks/usePodeExcluirEventoTarefa.js` (novo) | Excluir só para quem o servidor aceita; conexão conferida antes e depois da confirmação; relê depois de excluir |

Cada frente passou por um revisor independente; 14 pontos procederam e foram aplicados (entre eles: o gate do rebanho, o teste antigo EX-G, o aviso de "outros pastos" falso, o diálogo da área com versão velha depois de 409, a rede caindo durante a confirmação da tarefa).

## 4. Validação

| Etapa | Resultado |
|---|---|
| Backend (PostgreSQL 16 local): `exclusaoMovimentacaoPermissaoMapa`, `…Puro`, `exclusaoMovimentacaoLedger` | 39/39 |
| Smoke das frentes (permissão, aba do lote, área, tarefa) e regressão dos históricos | passam (ver §6) |
| `gate:rebanho-ssot` | passa com a guarda nova |

## 5. Produção

- Sem migration. Merge e deploy normais.
- Ninguém ganha permissão sozinho: a chave nasce desligada. Para excluir movimentações com o usuário `maike`, ligar "Excluir movimentações do lote" (e as de visualizar o histórico) em Permissões, ou usar a conta Administrador.

## 6. Resultado da verificação

| Onde | Etapa | Resultado |
|---|---|---|
| CI `quality` (commit `90bb4e6a`) | `verify:full` estático (gates, tipos, lint, build), smoke 1/2 e 2/2, backend 1/4 a 4/4, `verify:all` | **todos verdes** |
| Local | backend da exclusão (39 testes, PostgreSQL 16) | 39/39 |

## 7. Fora do escopo / próximos

- **Etapa 2:** estorno transacional e idempotente do lançamento de cocho (rateio, baixa de estoque, reabertura do período) e da transferência entre depósitos.
- Fila offline: as portas de evento de tarefa e de leitura de cocho ainda aceitam exclusão na fila; a tela já bloqueia offline. Declarar `exclusao: 'somente_online'` nelas muda o comportamento de campo e fica para decisão própria.
- Demais ações da tarefa (editar, registrar evento, concluir) ainda aparecem para quem o servidor recusa.
