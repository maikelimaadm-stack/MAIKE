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
| `npm run typecheck:backend` | passou depois de tipar o resultado do `$queryRaw` |
| `npm run gate:types` | passou (1253 diagnósticos, teto 1746; nenhum novo) |
| `npm run verify:all` com `DATABASE_URL` local, `AUTH_SECRET` de teste e `FRONTEND_ORIGINS=http://localhost:5173` (igual à CI) | **TODAS AS ETAPAS PASSARAM**: 38 etapas, 502,7 s. Gates: 646/646. test:backend: 547 testes, 542 aprovados, 0 falhas, 5 marcados como todo (pré-existentes). test:smoke: 95 arquivos e 1108 testes. build e build:admin ok |

Primeira rodada do `verify:all`, antes dos ajustes:
- `types` e `typecheck:backend` reprovaram por tipagem do código novo; ambos foram corrigidos;
- `governance-paths` reprovou porque o relatório ainda não existia;
- `test:backend` reprovou em P4B CORS (2 subtestes) porque `FRONTEND_ORIGINS` não estava definida localmente. A falha se repete em `origin/main` sem as mudanças desta PR; a CI define a variável.

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

---

## 11. R1.1 — cancelamentos suspensos e Histórico da Área pelo contorno (D-PROD-94a)

**Missão:** MAIKE-MAPA-HISTORICO-MOVIMENTACOES-R1.1-SEGURANCA-E-ACESSO-AREAS.
- Mesma PR: maikelimaadm-stack/MAIKE#161 (DRAFT).
- Base: `main` a312f2d1. HEAD auditado: c1e13077 (CI quality SUCCESS, run 41241994010).

### 11.1 Achados confirmados

| # | Achado | Onde |
|---|---|---|
| 1 | "Excluir" do cocho chama `excluirEventoSuplementacaoComReversao`. São 5 etapas HTTP independentes (lotes de suplementação, reabrir período, devolver estoque, apagar movimento de estoque, apagar evento), sem transação | `HistoricoSuplementacaoPonto.jsx`, `suplementacaoHistoricoService.js:128-177` |
| 2 | "Excluir" do depósito chama `excluirTransferenciaDeposito`. Lotes de estoque, saldo da origem e par de movimentos são tratados em etapas independentes | `HistoricoDepositoSuplementacao.jsx`, `suplementacaoHistoricoService.js:180-277` |
| 3 | `handleClickArea` fazia `if (!isCurral) return;`. `DetalhesArea` retornava `null` fora do curral. Na tela, o histórico de área vazia **não era alcançável**, embora a API suportasse a consulta | `MapaGeral.jsx`, `DetalhesArea.jsx` |
| 4 | Consumidores das duas rotinas de reversão: **só** os dois históricos (teste por varredura) | — |

### 11.2 Mudanças

- `src/domain/estornos/politicaEstorno.js` (novo):
  - `CANCELAMENTO_COCHO_HABILITADO = false`;
  - `CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO = false`;
  - `MENSAGEM_ESTORNO_SUSPENSO`.
- `HistoricoSuplementacaoPonto.jsx` e `HistoricoDepositoSuplementacao.jsx`:
  - sem botão "Excluir"; aviso com `role="note"`;
  - `handleDelete` recusa na primeira linha, antes de `confirm` e da rotina de reversão;
  - textos verdadeiros: nutrição é consulta, cancelamento suspenso;
  - listagens, filtros e saldos inalterados.
- `HistoricoMovimentacoes.jsx`: só o texto da nutrição. `EXCLUSAO_NO_HISTORICO_HABILITADA = false` continua intacto.
- `src/domain/mapa/cliqueArea.js` (novo): `acaoDoCliqueNaArea`. A precedência é:
  1. seleção de local de tarefa;
  2. clique que encerra o toque longo;
  3. curral;
  4. área comum, se tiver a permissão.
- `MapaGeral.jsx`: `handleClickArea` usa a política acima. Passa `permissions` para `DetalhesArea` e remove o `onClose` que `DetalhesArea` nunca usou.
- `DetalhesArea.jsx`:
  - área comum → `HistoricoMovimentacoes lotes={[]} areaId`;
  - curral → abas "Abate" (padrão, `HistoricoAbateCurral` intacto) e "Histórico da Área";
  - sem a permissão: curral só com abate, área comum sem diálogo.
- **Sem mudança de backend, schema, migration, saldo ou dados.**

### 11.3 Autorização (contrato registrado)

- Permissão reutilizada: `visualizar_historico_movimentacoes_lote` ("Ver histórico de movimentações"), a mesma que já abre o histórico pelo lote. Nenhum grant novo.
- **Lacuna de backend, pré-existente e registrada:**
  - o servidor não aplica as permissões do Mapa Geral (`Permissao.mapa_geral_permissoes` é preferência de interface, D-PROD-71);
  - `GET /movimentacoes-mapa` já devolvia as mesmas movimentações a qualquer usuário autenticado do tenant, e `GET /movimentacoes-mapa/historico` (R1) não amplia essa exposição;
  - tenant sempre do token (R11); empresa como escopo dentro do tenant; `cliente_id` na query dá 400 (teste R1).
- Fechar leitura por permissão no servidor é trabalho de autorização de backend, fora desta PR.

### 11.4 Testes reais

| Comando | Resultado |
|---|---|
| `npx vitest run tests/smoke/historicoEstornoSuspenso.test.jsx` | **7/7**. T01 e T02: listagem, aviso, nenhum "Excluir", clique em todos os botões → **0** chamadas a `excluirEventoSuplementacaoComReversao` e `excluirTransferenciaDeposito`; guarda antes de `confirm` e da reversão. T03: só os dois históricos importam a política; consumidores das rotinas = os dois históricos + o serviço |
| `npx vitest run tests/smoke/detalhesAreaHistorico.test.jsx` | **9/9**. Política do clique (T08, toque longo, T04/T05, T10); pasto vazio com saída antiga consultando por `areaId` sem `loteIds` (T04); vazio verdadeiro (T06); erro + "Tentar novamente"; curral com aba Abate padrão e Histórico da Área sob demanda (T07); sem permissão (T10) |
| `npx vitest run` (smoke completo) | 97 arquivos, **1124** testes, 0 falhas |
| `npm run gate:types` | PASSOU, 1243 diagnósticos (antes 1253; teto 1746; nenhum novo) |
| **E2E real no Chromium** (Vite + backend local + banco `maike_demo` sintético; roteiro `evidencias/historico-movimentacoes/r1-1/roteiro-e2e-r1-1.cjs.txt`) | **57 PASS, 0 FAIL**: 1440 (15), 768 (14), 412 (14), 390 (14). Logs em `r1-1/e2e-*.txt`. T08 roda só no desktop, porque o fluxo depende de clique direito para abrir a tarefa; no toque, a precedência é coberta pelo teste de unidade. Em toda sessão: **nenhum `DELETE`/`PATCH`** disparado e nenhum erro de página |
| `npm run verify:all` | ver 11.6 |

**Achado durante o E2E:** em 412 e 390, com o mapa afastado, o marcador do depósito ficava sobre o PASTO 5. O toque abriu **só** o depósito: o marcador tem precedência e não abre dois diálogos (T09). O dado sintético foi movido para o roteiro testar a área. A captura do caso ficou em `r1-1/evid-mobile-412-marcador-sobre-area-abre-so-o-deposito.png`.

### 11.5 Capturas (`docs/engineering/evidencias/historico-movimentacoes/r1-1/`, larguras 1440, 768, 412 e 390)

- `01-area-vazia-saida-antiga`: PASTO 5 sem lote, saída de 120 cabeças;
- `02-area-sem-movimento`: PASTO 10 com vazio verdadeiro;
- `03-curral-abate` e `04-curral-historico-area`;
- `05-cocho-cancelamento-suspenso`;
- `06-deposito-cancelamento-suspenso`;
- `07-selecao-local-tarefa` (1440): o clique vincula "PASTO 10" à tarefa e não abre histórico.

### 11.6 Gates

`verify:all` local com as variáveis da CI: resultado colado na resposta ao proprietário. CI do HEAD final: link na PR.

### 11.7 O que NÃO foi alterado e riscos abertos

- **Backend continua aceitando `DELETE`/`PATCH` genéricos** para qualquer usuário autenticado do tenant, em `/movimentacoes-mapa/:id`, `/movimentacoes-estoque/:id`, `/suplementacao-eventos/:id`, `/suplementacao-lotes/:id` e demais rotas JSON. A suspensão é **só de interface**; não há estorno seguro implementado nem integridade certificada.
- O serviço legado `suplementacaoHistoricoService.js` foi mantido sem alteração e sem chamadores ativos.
- A leitura de histórico não é autorizada por permissão no servidor (lacuna pré-existente, 11.3).
- Limitações da R1 seguem valendo (seção 8).
- **Próximo:** R2-ESTORNO-SEGURO, em nova PR, depois do merge manual da #161. Não foi iniciada.
