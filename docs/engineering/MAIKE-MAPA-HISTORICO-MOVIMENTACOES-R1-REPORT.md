# MAIKE-MAPA-HISTORICO-MOVIMENTACOES-R1 — Restaurar a leitura do histórico

**Data:** 2026-10-31 · **Decisão:** D-PROD-94 · **Base:** `origin/main` a312f2d1 (pós-#160)
**Escopo:** só leitura. Nenhum saldo de lote, movimento, ledger, migration, auth ou licenciamento foi alterado. Nenhuma escrita em produção.

## 1. Sintoma e causa raiz

**Sintoma:** "Histórico de Movimentação" do Mapa mostrava **"Nenhum lançamento encontrado"** em qualquer área, mesmo com movimentações no banco.

**Leitura agregada e só leitura do banco MAIKE (31/10/2026):**
- 3 `MovimentacaoMapa`, todas "Transferência de Área" com `lote_id`, origem, destino, data e `empresa_id` na **coluna**;
- 0 com `empresa_id` dentro de `dados`.

**Árvore de dependências (UI → PostgreSQL):**

```
DetalhesLote.jsx ── "Histórico de Movimentação" (permissão visualizar_historico_movimentacoes_lote)
 └─ HistoricoMovimentacoes.jsx (lotes, areaId)
     ├─ ANTES: mapaCacheService.getMapaCachedData/refreshMapaCacheEntry('movimentacoes', …)
     │    └─ CAPACIDADES.movimentacoes = daEmpresa(listMovimentacoes(), empresa)   ← filtro item.empresa_id
     │         └─ lotesApi.listMovimentacoes (limit 500, tenant inteiro)
     │              └─ GET /movimentacoes-mapa → movimentacaoMapaService.listar
     │                   └─ documentoComoPublico(registro)   ← devolvia só `dados` (sem empresa_id)
     │                        └─ "MovimentacaoMapa" (cliente_id, empresa_id COLUNA, dados JSON)
     ├─ + suplementacaoLote, eventosSuplementacao, aplicacaoMedicamento, eventoSanitario, manejoTecnico, areas (mesmo caminho)
     └─ filtro no componente: mov.empresa_id === localStorage('empresa_selecionada_id')  ← nunca verdadeiro
```

**Causa raiz:**
- `montarDocumento` (`backend/src/shared/jsonDocument/jsonDocumentPublic.js`) tira `empresa_id` do corpo e grava só na coluna.
- `documentoComoPublico` devolvia `{...dados, id, created_date, updated_date}`, sem a coluna.
- Os **10** recursos JSON saíam sem `empresa_id`. Dois filtros por empresa descartavam 100%:
  - o `daEmpresa` do cache do mapa;
  - o filtro do próprio componente.

**Problemas agravantes encontrados no componente:**
1. A empresa vinha de `localStorage` cru, não do hook tenant-aware, e a `queryKey` não tinha empresa: risco de cache cruzado.
2. Laço de revalidação: a `queryFn` chamava `refreshMapaCacheEntry(...).then(invalidateQueries(mesma key))`, e cada reexecução repetia o ciclo.
3. Corte temporal global (`inicioNovoHistorico` = última entrada de QUALQUER lote em foco) escondia fatos anteriores da área, inclusive de lotes que saíram.
4. `matchLoteFlex` casava por id **ou** nome, então homônimos com outro `lote_id` misturavam.
5. Truncamento silencioso: os 500 mais recentes do **tenant** eram filtrados por empresa no cliente.
6. Erro de rede e ausência de dados viravam a mesma tela vazia.

**Efeito colateral da causa raiz:** `PATCH` sem `empresa_id` no corpo respondia 400 em todas as rotas JSON. O update monta o documento a partir de `documentoComoPublico(existente)`, que não trazia o campo.

## 2. Prova vermelha antes do patch

| Prova | Resultado antes | Depois |
|---|---|---|
| `backend/tests/documentoJsonEmpresaContrato.test.mjs` | **14 de 15 falharam**: unidade, 10 rotas JSON, linha real sem `empresa_id`, `dados.empresa_id` forjado vencendo a coluna, PATCH 400 | 15/15 |
| Componente de `origin/main` com documento no formato real (sem `empresa_id`), teste descartável | renderiza **"Nenhum lançamento encontrado"** | — (arquivos temporários removidos) |

## 3. Correção (diff)

### Backend (só leitura)

- **`jsonDocumentPublic.js` — `documentoComoPublico`:**
  - `empresa_id` = **coluna** autoritativa;
  - `empresa_id`, `cliente_id` e demais reservados dentro de `dados` são descartados na saída, então nunca vencem a coluna nem vazam;
  - vale para todos os consumidores: 10 serviços JSON, `suplementacaoEventoComandoService` e `syncEntityReferencesService`.
- **`GET /movimentacoes-mapa/historico`** (`movimentacaoMapaRoutes/Service/Repository`):
  - tenant do token (R11). `empresa_id` é obrigatório e funciona como escopo dentro do tenant: empresa de outro tenant devolve vazio;
  - filtros:
    - `area_id`: origem, destino ou `area_id` do evento;
    - `lote_ids[]`: vínculo por id;
    - `lote_nomes[]`: **só** para registro sem `lote_id`;
  - keyset `createdAt DESC, id DESC` com o cursor opaco existente (`keysetCursor.js`); padrão 100, teto 200;
  - envelope `{items, next_cursor, has_more, total, limit}`;
  - `additionalProperties: false`: `cliente_id` na query dá 400;
  - SQL com `Prisma.sql` parametrizado, sem migration; usa o índice `(cliente_id, empresa_id)`.
- **Inalterados:** `POST`, `PATCH` e `DELETE /movimentacoes-mapa`. A única mudança observável no PATCH vem do serializador: sem `empresa_id` no corpo, agora preserva a coluna em vez de dar 400 (teste dedicado).

### Frontend

- **`src/domain/lotes/historicoMovimentacoes.js`** (novo, puro). Escopos:
  - **Área:** fatos com a área como origem, destino ou local, inclusive de lotes que saíram. Registro sem área entra só para lote presente e depois que **esse** lote entrou na área (corte por lote, não global).
  - **Lotes atuais:** trajetória pelo id.
  - Regras comuns:
    - id vence nome; homônimo com outro id nunca entra;
    - legado sem id casa pelo nome e sai marcado;
    - lote derivado sem transferência pelo próprio id usa `area_entrada_id` e `created_date` dele; sem prova, não há corte.
- **`HistoricoMovimentacoes.jsx`:**
  - empresa via `useEmpresaSelecionadaId()`; `useInfiniteQuery` com key `[…, empresa, escopo, área|lotes]`;
  - online → servidor paginado ("Movimentações: N de T" + "Carregar mais"). Também grava cópia para uso offline, sem `await` e sem reinvalidar;
  - offline → cache do mapa com aviso "Sem conexão… salvas neste aparelho em dd/mm hh:mm". Se o aparelho não tem cópia, a tela diz isso em vez de "Nenhum lançamento";
  - servidor fora: com cache, mostra o cache e avisa da falha; sem cache, estado de erro com "Tentar novamente";
  - vazio legítimo continua "Nenhum lançamento encontrado";
  - o evento `atualizar-mapa` (disparado pelo `DetalhesLote` depois de movimentar, pesar, etc.) invalida o histórico. O laço `refresh → invalidate` foi removido;
  - seletor mínimo "Área | Lotes atuais" no diálogo existente; badge "Vínculo pelo nome" em registro legado.
- **Exclusão pelo histórico SUSPENSA** (`EXCLUSAO_NO_HISTORICO_HABILITADA = false`):
  - o código da exclusão foi preservado **byte a byte** (347 linhas idênticas a `origin/main`) e só ficou inalcançável;
  - motivo: ninguém excluía por ali desde a P5.5, porque a lista vinha vazia. Restaurar a leitura reabriria uma reversão de saldo feita no navegador, em várias chamadas, sem transação nem idempotência. Isso é a R2.
- **API e serviços:** `listarHistoricoMovimentacoesMapaPagina` (porta nativa, fora do adaptador offline), `listHistoricoMovimentacoesPagina` (lotesApi), `listarHistoricoMovimentacoesPagina` (loteManejoService) e `getMapaCacheSnapshot` (mapaCacheService, itens + `updated_at`).

## 4. Cenários obrigatórios — provas

| # | Cenário | Prova |
|---|---|---|
| 1 | Serialização: coluna presente e `dados` sem `empresa_id`; `dados.empresa_id` conflitante; sem `cliente_id`; tenant | `documentoJsonEmpresaContrato.test.mjs`: unidade, linha real, forjado, PATCH e isolamento entre tenants |
| 2 | Todos os consumidores do serializador | O mesmo arquivo cobre POST+GET nas 10 rotas JSON. Suíte backend completa verde (seção 6) |
| 3 | 500 cabeças: parcial de 50 A→B, pesagem na origem e transferência dos 450 | Backend: A tem 3 fatos com saídas 50+450=500; B tem 2 com entradas 500; 3 ids distintos. Smoke: mesma soma pelo `fluxoNaArea`. Nada é gravado em lote |
| 4 | Homônimo; área vazia; lote derivado | Backend: homônimo com outro `lote_id` fora, legado pelo nome dentro. Smoke: área sem lotes mantém 3 fatos; outra empresa nunca entra; derivado usa a própria entrada |
| 5 | Troca de empresa com histórico aberto; offline; reconexão | Smoke: rerender com outra empresa consulta a nova e não mostra a anterior; offline lê cache, avisa, filtra outra empresa e não chama o servidor. Reconexão: `refetchOnReconnect` padrão do React Query com `networkMode: 'always'` |
| 6 | As três movimentações | Fixture sintética equivalente (smoke) e demonstração local (`maike_demo`, capturas). Nenhuma leitura nova de produção |
| 7 | 500+ movimentos; datas de evento × criação; mesma data; falha de rede | Backend: 520 movimentos em páginas de 200, 3 páginas, sem repetir, com 30 `createdAt` empatados (desempate por id). Smoke: 100 de 520 → "Carregar mais" → 200 de 520; falha com e sem cache. Pesagem e transferência no mesmo dia aparecem ambas |
| 8 | verify:all, gates, backend, smoke, capturas | Seção 6 |
| 9 | Regressão do serializador comum | Seção 7 |

## 5. Capturas (app real em Vite + backend local, banco `maike_demo`, dados sintéticos)

`docs/engineering/evidencias/historico-movimentacoes/`, em 1440, 390 e 412 px:

- `01-area-origem`: PASTO 1 com 3 fatos (duas saídas de 50 e a pesagem de 450) e "Movimentações: 3 de 3";
- `02-lotes-atuais`: a trajetória do lote pelo id;
- `03-area-destino`: PASTO 2 com 2 entradas de 50;
- `04-offline-cache`: aviso "Sem conexão… salvas neste aparelho em 31/10/2026, 20:52".

O mapa mostra 400 + 100 = **500** cabeças: nada foi duplicado.

## 6. Testes e gates executados (local, nunca em produção)

| Comando | Resultado |
|---|---|
| `node --test backend/tests/documentoJsonEmpresaContrato.test.mjs` | 15/15 (antes do patch: 1/15) |
| `node --test backend/tests/movimentacaoMapaHistoricoPaginado.test.mjs` | 7/7 |
| `vitest tests/smoke/historicoMovimentacoes.test.jsx` | 17/17 |
| `vitest` (suíte smoke completa) | ver `verify:all` |
| `npm run verify:all` | ver resposta da PR (saída colada no relatório final ao proprietário) |

## 7. Regressões avaliadas (mudança do serializador comum)

- **10 rotas JSON:**
  - `/movimentacoes-mapa`, `/movimentacoes-pecuaria`, `/suplementacao-eventos`, `/suplementacao-lotes`, `/aplicacoes-medicamento`, `/eventos-sanitarios`, `/manejos-tecnico-rebanho`, `/bebedouros-historico`, `/bebedouros-alertas`, `/bebedouros-sanidade`;
  - efeito: passam a devolver `empresa_id`, que é campo novo e aditivo;
  - consumidores que filtravam por `empresa_id` e recebiam vazio passam a receber os registros da empresa. É o comportamento pretendido: cache do mapa, nutrição, sanidade.
- **Auditoria:** `dadosAnteriores` e `dadosNovos` passam a registrar `empresa_id`. É informação a mais, sem PII.
- **`syncEntityReferencesService`:**
  - a lista já vinha filtrada por empresa no SQL;
  - a guarda `record.empresa_id !== empresaId` (linha 132) passa a ser efetiva, coerente com o filtro;
  - `applyPatch` grava só em `dados`; a coluna não muda.
- **`suplementacaoEventoComandoService`:** usa `eventoPublico` para encadear. Ganha `empresa_id`, que já era o mesmo do comando.
- **`PATCH` sem `empresa_id`:** de 400 passa a 200, preservando a coluna. `PATCH` com outro `empresa_id` continua movendo a coluna, como antes; isso é escrita, fora do escopo e anotado para a R2.

### 7.1 Comportamentos que voltam a valer (consequência direta da causa raiz)

Desde a P5.5, todo filtro do frontend por `empresa_id` sobre documentos JSON dava vazio. Com a correção, voltam a funcionar como foram desenhados:

| Onde | Antes (desde a P5.5) | Agora | Avaliação |
|---|---|---|---|
| `validarOrdemTemporalLote` / `validarSemRegistrosPosteriores` (`loteManejoService.js:45-75`; 18 chamadas em `DetalhesLote`, `manejoValidations`, `movimentacaoReconciliation`) | **no-op**: `filterMovimentacoes({empresa_id, lote_id})` nunca casava | volta a **bloquear** manejo com evento posterior no lote, com a mensagem original | Proteção pretendida, restaurada. Limitação pré-existente: `filterMovimentacoes` lê os 200 mais recentes do tenant e filtra no cliente, então lote com evento posterior além desses 200 não é detectado. Próximo slice: consulta por `lote_id` no servidor |
| Histórico do cocho (`HistoricoSuplementacaoPonto.jsx`), histórico de suplementação do lote, `DetalhesPontoSuplementacao` | vazios | mostram os eventos | Leitura correta. **Atenção:** o histórico do cocho tem "Excluir" com reversão de estoque feita no navegador (`excluirEventoSuplementacaoComReversao`, várias chamadas, sem transação). Ficava inalcançável com a lista vazia e volta a ser alcançável. Não alterei porque está fora do escopo do histórico de movimentações. **Decisão do proprietário:** suspender também (uma constante, como na R1) ou aceitar até a R2 |
| Coloração "situação do pasto" (`MapaGeral.jsx:747`) | cache de movimentações vazio | usa as movimentações reais | Restaurado |
| Cache do mapa (`mapaCacheService` → `daEmpresa`) para nutrição, medicamento, sanidade e manejo técnico | vazio | populado (até 500 mais recentes da conta) | Restaurado; limite descrito em 8.1 |

## 8. Limitações e risco residual

1. **Demais fontes do histórico** (nutrição, medicamento, sanidade, manejo técnico):
   - seguem pelo cache do mapa, que lista os **500 mais recentes da conta** e filtra a empresa no cliente;
   - numa conta com várias empresas e muito volume podem faltar registros antigos. A tela não promete completude para elas; só as movimentações têm "N de T";
   - próximo slice: mesmo envelope keyset por empresa.
2. **Legado pelo nome no servidor:** `lower(btrim())` sem remoção de acento, enquanto o cliente ignora acentos. Um legado "Nelóre" com lote "Nelore" aparece offline e não online. Hoje não há legado sem `lote_id` no banco (as 3 têm id).
3. **Cache do mapa:** guarda por empresa no IndexedDB do aparelho. Os dados de uma empresa permanecem no aparelho depois do logout (comportamento anterior, fora do escopo).
4. **Exclusão pelo histórico suspensa** até a R2. O proprietário decide reabrir trocando a constante.
5. `listTodasMovimentacoes` e `filterMovimentacoes` (lista geral, outros consumidores) não mudaram.

## 9. Rollback

Reverter o commit da PR. Não há migration, dado ou configuração a desfazer.

Para reverter só a suspensão da exclusão: `EXCLUSAO_NO_HISTORICO_HABILITADA = true` em `HistoricoMovimentacoes.jsx`, com aprovação.

## 10. Próximos slices

- **R2 — MAIKE-MAPA-MOVIMENTACOES-R2-ESTORNO-SEGURO:**
  - fechar ou restringir `DELETE`/`PATCH` diretos;
  - estorno no servidor, transacional e idempotente, com trilha imutável e validação de saldos e dependentes;
  - política com o ledger L1/L2.
- **R1.1 — demais fontes paginadas por empresa:** suplementação, medicamento, sanidade e manejo técnico com envelope keyset e `total`, substituindo o cache de 500 da conta.
- **R1.2:** normalização de acento no vínculo legado pelo nome (servidor), se aparecer legado real.
