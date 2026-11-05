# MAIKE — D-PROD-123 (H2): histórico cronológico por ocorrência

**Base:** `main` @ `bf9eb2e8` (D-PROD-122 mergeada). **Branch:** `claude/d-prod-123-h2-historico-cronologico`. **Migration:** nenhuma.

## Problema

`GET /movimentacoes-mapa/historico` paginava e ordenava por cadastro: `createdAt DESC, id DESC`. Lançamento retroativo registrado hoje subia ao topo; a ordem exibida não era a da vida do rebanho. Reordenar a página no navegador seria NO-GO: a página N continuaria sendo o pedaço N da ordem de cadastro.

## Contrato entregue

| Item | Decisão |
|---|---|
| Ocorrência | `EventoRebanho.data_operacional` quando o vínculo é inequívoco (mesmo tenant e empresa, `ev.movimentacao_id = m.id` **e** `ev.id = dados.efeito_servidor.evento_id`); senão o dia literal de `dados.data_movimentacao` (`AAAA-MM-DD` ou `AAAA-MM-DDT…`, válido por `pg_input_is_valid`, sem conversão UTC); senão `null`. |
| Registrado | `EventoRebanho.registrado_em` (vínculo inequívoco) ou `createdAt` real. |
| Ordem | `(tem_ocorrencia DESC, ocorrencia DESC, registrado DESC, createdAt DESC, id COLLATE "C" DESC)`: a mesma no ORDER BY, no predicado keyset (comparação de linha) e no cursor. |
| NULL | "Data da ocorrência não informada", sempre no fim; nunca data inventada. |
| Cursor | v2 `{v,o,r,c,i,e,s}` em base64url, com hash de escopo `e` (tenant, empresa, área, lotes, nomes) e HMAC `s` (HKDF do `AUTH_SECRET`). v1, malformado, adulterado ou de outro escopo → **400 `HISTORICO_CURSOR_INVALIDO`** com `details.motivo` (`versao_antiga`, `malformado`, `adulterado`, `escopo_divergente`). |
| Filtros e COUNT | Iguais aos da main (`condicoesHistorico`, `contarHistorico`); LEFT JOIN por chave única, sem multiplicar linhas. |
| Resposta | Itens com `historico_ocorrencia`, `historico_ocorrencia_origem`, `historico_registrado_em`; envelope com `ordem: "ocorrencia_desc_v2"`. |

### Navegador

- Card com **Ocorrência** e **Registrado em**; selo "Sem data" quando não há ocorrência.
- Reinício da primeira página **só** com `HISTORICO_CURSOR_INVALIDO`, uma vez por incidente (ver complemento PR191-R2). Qualquer outra falha fica visível.
- Offline:
  - snapshot do aparelho filtrado e ordenado com a mesma tupla;
  - aviso "Histórico offline parcial: N movimentações salvas neste aparelho, atualizado em …";
  - ordenação só pelas datas comprováveis no aparelho, sem prometer equivalência com o servidor (ver complemento PR191-R2).
- Outras fontes (nutrição, medicamentos, sanidade, manejo técnico):
  - vêm do cache do aparelho e não têm endpoint agregado;
  - entram na mesma ordem, mas só até o último movimento carregado enquanto houver páginas, para que a lista exibida seja sempre um prefixo correto da ordem global;
  - o aviso de cobertura diz quantas esperam o "Carregar mais".
- Estilo do mapa: intocado.

## Fora de escopo (inalterado)

- SSOT do rebanho: `EventoRebanho`, `PartidaRebanho`, `PesoRebanho`, `PosicaoRebanho`.
- H1: fuso e `REBANHO_DATA_FUTURA`.
- Causalidade, 409 de exclusão, saldo e cadastro de lotes.
- `entradasNaArea`, `contarHistorico` e elegibilidade.
- Data operacional gravada.
- Futuros legados: nenhum dado é reescrito; aparecem no topo, sem correção. KM-06 real não foi tocado.

## Evidências

### Backend — PostgreSQL 16 local

`backend/tests/dProd123HistoricoOcorrencia.test.mjs`, 9 testes.

**RED na main:** 8 falham pela razão certa: ordem por cadastro (`h2tardio` no topo), ausência de `ordem` e de `historico_*`, cursor v1 aceito com 200. O único verde é o "fim da paginação", que já valia.

**GREEN na branch:** 9/9, mais os 7 de `movimentacaoMapaHistoricoPaginado.test.mjs` sem alteração. Cobrem:

- 272 movimentos em 3 páginas de 100, com ordem idêntica a uma implementação de referência independente:
  - ledger com `data_movimentacao` divergente (o evento vence) e evento cancelado (mantém a data do fato);
  - legado com `T23:30-04:00` (dia literal);
  - vínculo ambíguo (cai no legado);
  - empates exatos (desempate binário por id);
  - data ausente ou inválida (`''`, `2026-02-30`, `abc`, `31/12/2025`, número, `0000-01-01`);
  - fato futuro legado (topo, dado intacto);
  - retroativo tardio (entra na data do fato).
- Empates com páginas de 7, sem repetir nem pular.
- COUNT e filtro por lote inalterados; o JOIN não duplica.
- Cursor:
  - v1 → `versao_antiga`;
  - texto qualquer → `malformado`;
  - id trocado → `adulterado`;
  - versão 3 → `malformado`;
  - área, lotes, outra empresa ou outro tenant → `escopo_divergente`;
  - fim sem cursor e conjunto vazio.
- Isolamento: evento de outra empresa ou de outro tenant nunca empresta a data; empresa alheia devolve vazio.
- Homônimo `historico_ocorrencia` gravado em `dados` não vence o valor calculado.

### Frontend — jsdom

`tests/smoke/dProd123HistoricoOcorrencia.test.jsx`, 10 testes. RED na main: 9 falham. GREEN: 10/10. Cobrem:

- paridade do dia literal com o SQL;
- comparador da tupla (id binário `B` < `a`);
- chave do servidor e do cache;
- ordem offline;
- fronteira das outras fontes;
- card com as duas datas e a ausência;
- aviso de cobertura e "Carregar mais";
- reinício só com `HISTORICO_CURSOR_INVALIDO` (`[null, "cursor-velho", null]`);
- outra falha sem reinício;
- rótulo offline parcial.

`tests/smoke/historicoMovimentacoes.test.jsx` foi atualizado em dois pontos de semântica nova:

- o movimento sem data do fato vai para o fim;
- o texto do aviso offline mudou.

### Navegador real — Playwright

Harness `?cena=historico`, script `tests/e2e/harness/run-historico.cjs`. Em 390, 412, 768 e 1440 px: as três ocorrências na ordem do servidor após "Carregar mais", três "Registrado em" e `scrollWidth − clientWidth = 0`. PNGs e `resultado.json` em `docs/engineering/evidencias/d-prod-123-historico/`.

### Desempenho

EXPLAIN (ANALYZE, BUFFERS) da consulta real (`sqlHistoricoPagina`) em banco descartável. Planos completos em `evidencias/d-prod-123-historico/explain-2k-10k-50k.txt`.

| Movimentos na fazenda | Empresa, 1ª página | Área, 1ª página | Lotes, 1ª página | Página do meio (cursor) |
|---|---|---|---|---|
| 2.000 | 11,5 ms | 7,1 ms | 6,3 ms | 12,3 ms |
| 10.000 | 54,0 ms | 18,7 ms | 30,4 ms | 58,0 ms |
| 50.000 | 116,0 ms | 88,5 ms | 280,5 ms\* | 149,6 ms |

- **Linha de base** da consulta antiga a 50k: empresa 24,0 ms; área 26,2 ms.
- O plano é top-N heapsort sobre o conjunto filtrado, mais um hash join do evento (sem multiplicar linhas).
- \* A maior parte do tempo do filtro por lotes, cerca de 200 ms, está no próprio filtro `movimentoCitaLotes`, já existente (D-PROD-101) e inalterado.

**Veredito:** sem migration (`MIGRATION_REQUIRED = NO`).

**Proposta aditiva**, se uma fazenda passar de ~50k movimentos (classificação EXPAND, missão própria):

1. colunas `ocorrencia DATE NULL` e `registrado TIMESTAMP(3) NULL` em `MovimentacaoMapa`, gravadas na escrita;
2. backfill idempotente;
3. índice `(cliente_id, empresa_id, ocorrencia DESC NULLS LAST, registrado DESC, "createdAt" DESC, id)`.

## Riscos

- **Virada do runtime:**
  - **Aba antiga, JS antigo:** depois do deploy, o "Carregar mais" com cursor v1 recebe 400 e mostra "Não foi possível carregar a próxima página". Recarregar resolve.
  - **Aba nova:** o JS novo recomeça sozinho.
  - **Cursor v2 em JS antigo:** a ordem exibida pelo JS antigo ainda é a de cadastro, mas o servidor continua íntegro.
- **Troca do `AUTH_SECRET`:** invalida os cursores v2 em uso (400, com reinício automático).
- **`pg_input_is_valid`:** exige PostgreSQL ≥ 16; produção é PG17.
- **Outras fontes:** continuam vindo do cache do aparelho, cuja cobertura é a do cache, e isso é dito na tela.

## NOT_RUN

- Testes contra Supabase ou Preview: proibido, porque o Preview compartilha o banco de produção.
- Medição de volume de produção.
- Playwright do app autenticado: o harness é isolado, com dados sintéticos.

## Complemento PR191-R2 — consistência do frontend (sem D-PROD nova)

**Base:** HEAD auditado `049a9bae`. Mesma branch e mesma PR #191. Backend, SQL, cursor v2 e envelope sem alteração.

### R2-A — reinício por cursor inválido era consumido para sempre

- **Defeito** (`HistoricoMovimentacoes.jsx`, HEAD `049a9bae`, l. 311-317): a ref booleana `reiniciadoPorCursor` virava `true` no primeiro 400 e nunca era rearmada. Além disso, `resetQueries({ queryKey: ['historico-movimentacoes'] })` zerava as consultas de TODAS as empresas e escopos.
- **Correção:**
  - incidente = `JSON([chave da consulta, pageParams, next_cursor da última página])`;
  - reinicia quando o incidente muda: outro filtro, empresa ou escopo, ou página 1 recarregada com outro cursor;
  - o mesmo incidente repetido após o reinício não reinicia, e o erro fica visível (sem laço);
  - o reset é `{ queryKey: chaveDaConsulta, exact: true }`;
  - o código é lido do corpo do erro nativo (`cause.code`), sem casar texto.
- **Testes** (`tests/smoke/dProd123HistoricoR2.test.jsx`):
  - dois incidentes na mesma montagem (`[null,c1,null,c2,null,c3]`, 2 resets);
  - mesmo cursor recusado de novo (1 reset, 4 requisições, erro visível);
  - 401, 403, 500, 400 genérico e rede (0 resets);
  - Área → Lotes;
  - empresa A → B → A (reset `exact`, cache de A intacto);
  - `atualizar-mapa` seguido de novo incidente.

### R2-B — a ordem offline prometia equivalência não comprovada

- **Defeito** (`historicoMovimentacoes.js`, HEAD `049a9bae`, `chaveDoMovimento`):
  - offline, o registro vinha de `efeito_servidor.registrado_em` sempre que existisse, embora o servidor só use `EventoRebanho.registrado_em` com vínculo inequívoco (senão usa `createdAt`);
  - `historico_*` gravado em `dados` (lista genérica) era aceito como se viesse do servidor;
  - o aviso dizia "na mesma ordem por ocorrência do servidor".
  - **Reprodução:** mesmo dia, A criado 08:00 com `efeito_servidor.registrado_em` 23:00, B criado 09:00. Servidor (vínculo não comprovado): B, A. Offline antigo: A, B.
- **Snapshot offline:**
  - vem de `listMovimentacoes()` (lista genérica: documento + `created_date`), sem EventoRebanho;
  - é a janela dos mais recentemente criados, até 500.
- **Correção:**
  - `chaveDoMovimento(mov, { doServidor })`: `historico_*` só vale para itens do endpoint H2 (`origem: servidor` e `ordem: ocorrencia_desc_v2`);
  - offline: ocorrência = dia literal válido de `data_movimentacao`; registro = `created_date`;
  - aviso: "cópia parcial ordenada pelas datas disponíveis no aparelho (data da ocorrência gravada e hora de cadastro), que pode diferir da ordem do servidor", mantendo contagem, data de atualização e limite de 500.
- **Limitação declarada:** para um movimento do ledger, a hora de registro do evento (`registrado_em`) não está no cache. Entre movimentos do ledger do mesmo dia, a ordem offline usa a hora de cadastro e pode diferir da online. A tela diz isso.

### Evidência

- **RED** (testes finais contra o código de `049a9bae`): `dProd123HistoricoR2` com 8 falhas e 8 passando. Os que passam são os casos de "não reiniciar" (comportamento preservado), a chave do servidor e o dia literal.
- **GREEN:** `dProd123HistoricoR2` 16/16, `dProd123HistoricoOcorrencia` 10/10 e `historicoMovimentacoes` 19/19.
- `dProd123HistoricoOcorrencia.test.jsx` (teste "chave do movimento") foi atualizado: ele codificava a semântica corrigida.
- Playwright do harness: 4/4 larguras, sem regressão.
- Backend H2 (PG16) reexecutado sem alteração; `verify:all` na seção de entrega.
