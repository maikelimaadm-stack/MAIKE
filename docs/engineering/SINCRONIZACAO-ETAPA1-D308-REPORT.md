# Relatório — Sincronização profissional, Etapa 1 (D-PROD-308)

**Data:** 2026-11-25 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-308](./DECISIONS.md)

## Pedido

> "O que pudermos fazer para fazer uma coisa profissional já vamos fazer no começo, testando com cochos e lotes e contas etc. Isso vai virar um SaaS com milhões de registros, clientes, vários usuários e futuramente várias funções."

Plano aprovado em 5 etapas, uma PR por etapa:
1. Nada se perde, nada duplica.
2. Sincronização incremental.
3. Vários usuários editando a mesma coisa.
4. A tela nunca "pisca".
5. Manutenção e levar o padrão aos outros cadastros.

Esta é a **Etapa 1**.

## O que estava errado

| # | Problema | Consequência |
|---|---|---|
| 1 | O envio direto do motor (com internet) só gravava no aparelho depois da resposta | App fechado com o pedido no ar: o código se perdia; a baixa já feita no servidor ficava sem registro; repetir mandava com código novo |
| 2 | Criação de cocho e lote sem idempotência | Resposta perdida, reenvio ou duas abas: cadastro em dobro; no lote, também a entrada no rebanho e a numeração em dobro |
| 3 | Id provisório `offline_…` | A leitura ou o lançamento num cocho criado sem internet ia com o id provisório (nada o trocava no motor) |
| 4 | O motor enviava antes da fila antiga | A leitura de um cocho novo podia chegar antes do próprio cocho e ser recusada |
| 5 | Sem trava entre abas | Duas abas do navegador sincronizavam ao mesmo tempo |

## O que mudou

### Servidor
- **Helper comum** `backend/src/shared/idempotency/idDoAparelho.js`. Qualquer cadastro pode usá-lo na Etapa 5.
  - `idDoAparelhoDe`: aceita só UUID e normaliza para minúsculas.
  - `criarComIdDoAparelho`: cria com o id dado. Repetir no mesmo tenant devolve o registro; outro tenant recebe 409 `ID_DO_APARELHO_EM_USO`; registro já excluído recebe 409 `ID_DO_APARELHO_EXCLUIDO`; a corrida pela chave primária é resolvida relendo o registro.
  - `foiExcluidoNoHistorico`: para entidade apagada de vez, consulta a auditoria.
- **Rotas:** `POST /lotes` (schema com `id` UUID opcional) e `POST /pontos-suplementacao`.

### App
- `src/lib/offline/idDoAparelho.js` gera o UUID, com `crypto.randomUUID` e uma alternativa para aparelho sem suporte.
- **Fila antiga** (`offlineEntityRuntime`), opção `idDoAparelho`:
  - o id nasce no aparelho;
  - a criação com internet que não chega a uma resposta vai para a fila com o mesmo id;
  - o reenvio manda o id;
  - a criação pendente é achada pelo id.
- **Portas:** `lotePort` e `pontoSuplementacaoPort` com `idDoAparelho: true`; o corpo de criação do lote leva o `id`.
- **Motor:**
  - grava antes do envio direto, com reserva de 2 min, e grava o progresso a cada passo;
  - a passada pula o item reservado;
  - as telas e o ícone não mostram o item reservado como "aguardando";
  - espera de fora (`definirEsperaDeFora`) para o que cita uma criação ainda na fila antiga.
- **`sincronizarTudo`:** roda o motor, a fila antiga e, se algo ficou esperando, o motor de novo.
- **`vezDaSincronia`:** roda dentro de `navigator.locks`.

## Cenários verificados

| Cenário | Antes | Agora | Teste |
|---|---|---|---|
| Cocho criado sem internet | id `offline_…`, trocado depois | id definitivo desde o aparelho | IA-01 |
| Criar cocho com internet e a resposta se perder | erro na tela; repetir criava outro | vai para a fila com o mesmo id; o servidor devolve o mesmo | IA-02, ID-01 |
| Duas criações do mesmo lote ao mesmo tempo | dois lotes | um lote | ID-02 |
| O mesmo id em outra conta | — | 409, nada vaza | ID-03 |
| Repetir a criação depois de excluir | recriava | 409, não recria | ID-04, ID-06 |
| App fechado com o lançamento no ar | código perdido | a passada termina com o mesmo código | EN-02 |
| Baixa feita e o app fecha | sem registro no aparelho | progresso gravado | EN-04 |
| Leitura num cocho criado sem internet | ia antes do cocho, com id provisório | espera o cocho; sobem os dois na mesma sincronização | OR-01 |
| Duas abas | sincronizavam juntas | uma de cada vez | AB-01 |

## Revisão independente

Antes da PR, um revisor que não participou do desenho leu o diff procurando defeitos. Ele não achou travamento nem vazamento entre contas, e achou 7 pontos, todos corrigidos e cobertos por teste:

| # | Achado | Correção | Teste |
|---|---|---|---|
| 1 | Lote apagado de vez podia ser recriado pelo reenvio | histórico de auditoria também no lote | ID-08 |
| 2 | Depois de uma criação que caiu, editar ou excluir ia direto ao servidor | a edição entra na criação; a exclusão vai depois dela; o lote só exclui depois de a criação subir; só falha de rede ou sessão vai para a fila | IA-06, IA-07, IA-10 |
| 3 | O segundo lançamento no mesmo cocho esperava até 1 minuto | pede a passada logo após o envio direto | EN-07 |
| 4 | Item da fila antiga com erro repetido segurava para sempre quem esperava por ele | retido com o motivo na 5ª vez | IA-09 |
| 5 | A resposta atrasada do envio direto podia desfazer o trabalho da passada; o relógio voltando escondia o item | `reserva_de`; reserva além do limite não vale | EN-08, EN-09 |
| 6 | Trava entre abas: se o navegador recusa, nada sincronizava; a passada agendada ficava fora da trava | roda sem trava se recusada; a passada agendada entra na vez | AB-02 |
| 7 | Criação que caiu sem conta definida ficava sem dono | volta para a tela | IA-11 |

Também: no reenvio, `ID_DO_APARELHO_EXCLUIDO` encerra o caso (IA-08).

## Verificação

- **Backend:** `backend/tests/idDoAparelho.test.mjs` (10 testes) passa contra um PostgreSQL 16 local.
  - Os testes que já existiam para lote e cocho dão o mesmo resultado com e sem esta mudança.
  - Algumas falhas locais desses testes vêm de datas fixas no futuro em relação ao relógio do ambiente; o CI é a referência.
- **App:** `tests/smoke/envioSemPerdaSemDuplicar.test.js` (22 testes) e a suíte `test:smoke` completa.
- **Gates:** types, import-integrity, source-closure, product-scope, api-boundary, admin-isolation, governance-paths, no-secrets, base44, tenancy, indices e typecheck:backend.
- **Banco:** sem migration.

## Próxima etapa

**Etapa 2 — sincronizar só o que mudou.**
- `updated_since` com cursor nas listas.
- Registro das exclusões, para outros aparelhos saberem.
- Índices `(cliente_id, updatedAt, id)` nas tabelas grandes.
- O celular guarda até onde já sincronizou, por conta e por fazenda.
- Piloto: cochos, leituras, lançamentos e lotes.
