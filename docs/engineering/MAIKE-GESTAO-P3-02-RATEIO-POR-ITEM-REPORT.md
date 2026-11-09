# MAIKE — Gestão P3-02: rateio gerencial por item (D-PROD-156)

| Campo | Valor |
|---|---|
| Missão | MAIKE-GESTAO-P3-02-RATEIO-POR-ITEM-IMPLEMENTACAO-INTEGRADA (2026-11-09) |
| Decisão | [D-PROD-156](./DECISIONS.md) (autorização explícita do proprietário) |
| PR | #231 (**draft**), branch `claude/maike-gestao-p3-02-rateio-por-item` |
| Base | `origin/main` `f2b81e1b`, merge da PR #230 (P3-01, em produção) |
| Runbook de release | [`MAIKE-GESTAO-P3-02-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-02-RUNBOOK-RELEASE.md), **não executado** |

> **Provas.** Todo número deste relatório é saída real de comando, medida em
> PostgreSQL 17.11 local descartável, com Playwright local, ou no CI da PR.
> Nada foi gravado em Preview nem em produção.

## 1. Gate 0: smoke da release P3-01 (somente leitura, 2026-11-09)

| Item | Resultado |
|---|---|
| `main` | `f2b81e1b` (merge da PR #230). O CI `quality` da `main` foi acompanhado |
| Deploy de produção | `dpl_2oFTcopkiQv1YqQD9sv282zdy7q4` READY, SHA `f2b81e1b`, aliases `www.makgestao.com`, `makgestao.com` e `maike-five.vercel.app` |
| `GET /api/native/health` | 200; `banco: up`; release `f2b81e1b` |
| `/LancamentosFinanceiros` | 200 (`text/html`) |
| API protegida sem sessão | `GET /api/native/operacoes-financeiras` → 401 `TENANT_CONTEXT_REQUIRED`, sem dados |
| Logs do deploy novo | só o aviso `FSTDEP023` (depreciação do Fastify), presente desde 2026-10-23; nenhum 5xx novo |
| Banco (SELECT) | 35 concluídas e 0 com falha; checksum da P3-01 `bb89f4e0…`; 8 tabelas com RLS e sem FORCE; 8 políticas; 0 grants públicos |
| `maxDuration` efetivo | **NAO_COMPROVADO**. O conector da Vercel não expõe o valor; conferir no painel (runbook da P3-01, §8.7) |

Veredito: **PASS**, com uma pendência só de leitura no painel (`maxDuration`).

## 2. O que foi entregue

O comportamento está descrito na D-PROD-156. Em resumo:

- **Escopo do rateio**, no mesmo documento:
  - **GERAL** é o padrão e o comportamento da P3-01;
  - **POR_ITEM** existe só com produtos. Cada item, mercadoria ou serviço, tem a sua própria divisão de natureza e centros, por valor ou percentual, sobre o **valor líquido** do item;
  - os modos são mutuamente exclusivos.
- **Banco:** migration expand-only `20261109200000_gestao_p3_02_rateio_por_item`.
  - Coluna anulável `OperacaoFinanceira.rateio_escopo`.
  - Tabela nova `OperacaoFinanceiraItemRateio`: 18 colunas; 6 FKs compostas com tenant e empresa; 2 CHECKs, um deles de tipo × direção; PK, 2 uniques e 3 índices; RLS e política para `maike_vercel`.
  - O classificador sem alteração devolve `expand: true` e 0 violações.
  - SHA-256 `df4d1ab29144d551793bb2fe43616d60bed86b87f10ec044d1cae2552076f4a0` e DO `dc05126c…bd576`, pinados.
- **Backend:**
  - **Algoritmo único de maiores restos** (`maioresRestos`, BigInt), usado pelo rateio do cabeçalho, pelo rateio geral em percentual e pelo rateio por item. Comparado com a cópia do algoritmo da P3-01 em 6.000 casos, deu igual em todos.
  - **Normalização e plano** com exclusões de escopo, base no líquido do item, invariante Σ = total e `rateio_consolidado`.
  - **Erros** que apontam item e linha.
  - **Serviço:**
    - itens criados com `createManyAndReturn` e linhas associadas pela ordem do item na mesma requisição;
    - linhas apagadas antes dos itens no PUT e no descarte;
    - a confirmação replaneja a partir do banco e recusa um POR_ITEM inválido mesmo vindo direto pela API;
    - retrato dos nomes na confirmação;
    - auditoria com `rateio_escopo`.
- **Tela** (`LancamentosFinanceiros`):
  - seletor "Rateio: Geral | Por item" e blocos por item que recolhem e expandem, com líquido e diferença por item e total;
  - linha única mostrada como 100%; "Aplicar classificação a todos";
  - diálogos de troca nos dois sentidos, sem perda silenciosa;
  - estado preso à chave estável do item; botões para subir e descer item;
  - Confirmar desabilitado enquanto algo não fecha;
  - erro do servidor levado ao campo exato;
  - consulta e prévia com a classificação por item e o consolidado;
  - 390 px sem rolagem horizontal.
- **Backend falso** dos testes espelhando o contrato real.

## 3. Provas

| Prova | Resultado |
|---|---|
| Testes PG da P3 (`gestaoP3*.test.mjs`, 9 arquivos, com `NODE_ENV=test` e `MAIKE_TESTE_AGORA`) | **161/161**, 0 falhas. O arquivo novo `gestaoP3RateioItem.test.mjs` cobre os casos do SPEC §7 (listados abaixo da tabela) |
| Vetores de paridade `tests/smoke/fixtures/rateioPorItemVetores.json` (16 casos: BRL, PYG e KWD; VALOR e PERCENTUAL; empates; desconto+acréscimo; mercadoria+serviço) | Conferidos pelo backend (plano puro e PostgreSQL) e pela tela (função pura e backend falso): **0 divergências**. Sem o arquivo, o teste da tela falha |
| Paridade aleatória backend × tela | 3.000 documentos no teste do backend: 1.859 aceitos, 1.141 recusas iguais, 11.791 linhas idênticas. Fuzz com 2 × 5.000 documentos (sementes 156 e 909): **0 divergências** em 54.472 linhas e 3.957 recusas |
| vitest | Suíte completa: **164 arquivos, 1.967/1.967**. `gestaoLancamentos*`: 7 arquivos, 246/246 |
| E2E real (tela + Fastify + PG17; passos novos 28 e 29) | 1280 e 390 px; `connection_limit` 5 e 3: **58 ✓ / 0 ✗** em cada pool, 174 capturas. Os passos 1 a 27 da P3-01 continuam verdes |
| No banco, depois do E2E | escopo POR_ITEM e nenhuma linha no rateio geral; **1 título por parcela** (771,66 + 771,67 = total); **1 movimento e 1 lote por mercadoria**, com kg × custo = líquido; o serviço não gera movimento; 4 linhas por item exatas; Σ por item = líquido; Σ total = 1.543,33 |
| Gates | `deploy-migrations`, `supabase-public-grants`, `tenancy` (70 models), `indices`, `import-integrity`, `no-secrets`, `base44`, `governance-paths`, `product-scope` e `native-api` passam; `test:gates` 695/695 |
| Lint e tipos | lint com 0 erros (56 avisos herdados); `gate:types` com 815 (teto 1.746); `typecheck:backend` 0 |
| Prisma | `validate` OK; `migrate diff --exit-code` 0 de banco → schema e de migrations → schema |
| Ensaio do SQL do runbook em PG17.11 local com `anon`, `authenticated` e `maike_vercel`, a partir de 35 migrations e do arquivo do HEAD (`df4d1ab2…`) | SQL de produção recusado (`RELEASE_BLOCKED: alvo divergente`); com o identificador local: `COMMIT`, 36 concluídas, `migrate diff` 0 e `migrate status` em dia. Repetir é recusado (`migration já registrada`). Coluna `varchar(12)` anulável e sem default; tabela com 18 colunas, `p` 1, `f` 6 e `c` 2; FKs `operacao` e `natureza` `(r,r)`, as demais `(r,c)`; índices 1/2/3; RLS sem FORCE; 1 política; 0 grants públicos. O rollback do §9.1 deixa 35, sem tabela e sem coluna, e a reaplicação dá `COMMIT` e 36 |
| `verify:all` no HEAD final | ver §5 |

Casos cobertos pelo arquivo novo `gestaoP3RateioItem.test.mjs` (SPEC §7):
- 3 naturezas; 1 item em 2 centros; mercadoria + serviço;
- desconto e acréscimo; BRL, PYG e KWD;
- soma errada recusada com `indice` e `subindice`;
- natureza ou centro inativo, de outro tenant ou de outra empresa; tipo × direção;
- duplicidade; alteração e remoção de item; cancelamento; replay;
- documento antigo com `rateio_escopo` NULL tratado como GERAL;
- 1000 linhas;
- concorrência PUT×PUT, PUT×confirmar e confirmar×PUT.

## 4. Revisão adversarial

A revisão adversarial foi focada, com três lentes em paralelo: dinheiro, banco e
tela. Resultado: **13 achados**, nenhum ALTO, 4 MÉDIOS e 9 BAIXOS.
- **12 corrigidos com RED→GREEN.** O corretor só corrigia depois que um teste
  reproduzisse a falha.
- **1 sem mudança de código:** DIN-2, que é decisão de contrato, registrada.

Para acelerar, não houve a rodada separada de verificadores: o teste RED fez
esse papel.

### 4.1 Achados e correções

Cada achado ganhou primeiro um teste que reproduz a falha (RED), e só então a
correção mínima (GREEN). Os testes novos ficam nas suítes da P3-02.

| Achado | Gravidade | Defeito | Correção | Teste (RED → GREEN) |
|---|---|---|---|---|
| BANCO-01 | médio | A prévia e o GET do detalhe liam cabeçalho, itens e linhas por item em comandos separados, em READ COMMITTED. Um PUT que confirmasse no meio rasgava o documento: prévia com `item_sem_rateio` falso, e detalhe com itens sem linhas e consolidado vazio | Prévia com o cabeçalho em `FOR SHARE`, serializada com PUT, descarte e confirmação. Detalhe numa transação `REPEATABLE READ` só de leitura | `RI11b` (2 testes, determinísticos, sem sleep: PUT parado no portão do título com as linhas novas gravadas e `LOCK TABLE` na fila). RED: `bloqueios=[item_sem_rateio]` e itens `[[],[]]`. GREEN: prévia sem bloqueio e detalhe `[['30.00'],['12.00','8.00']]` |
| BANCO-02 | baixo | Uma linha gravada fora da API com `operacao_id` = A e `item_id` = item de B é aceita pela FK. Efeitos: prévia de A limpa, confirmar A dava 500, o detalhe de B somava 45,00 com total 40,00, descartar B dava 403 e confirmar B passava | `exigirLinhasDoDocumento` devolve 422 `OPERACAO_RATEIO_INVALIDO` `linha_de_item_fora_do_documento` na prévia, na confirmação, no PUT e no descarte de A e de B. O detalhe mostra em cada item só as linhas do próprio documento | `RI10` "linha cruzada". RED: a prévia de A voltava com plano. GREEN: 422 nos 8 comandos, "nada mudou" pela fotografia e consolidados 30,00 e 40,00 |
| DIN-1 | médio | "Usar a classificação geral" no modo VALOR tirava, sem aviso, a linha que dava zero num item. Com 99,99 + 0,01 e dois itens de 50,00, a SANIDADE sumia do documento | O proporcional é recusado, com o motivo (linha, natureza e item), quando alguma linha do geral ficaria com zero. Sobra "começar em branco" | RTL `RIT-8 DIN-1`. RED: botão habilitado. GREEN: botão desabilitado e motivo à vista |
| DIN-2 | baixo | O SPEC dizia que `esperado` é o líquido do item, mas no PERCENTUAL ele vem em % | Sem mudança de código: mantida a semântica do rateio geral da D-PROD-155 e registrada na D-PROD-156 (PERCENTUAL em %, com o líquido em `valor_liquido`) | `RI3` agora fixa também `valor_liquido` no PERCENTUAL. Já passava: não há RED de código |
| DIN-3 | baixo | O backend falso lançava `RangeError` com casas a mais e respondia 422 `valor_linha_zero` (ou `soma_diferente`) para valor ou percentual ausente. O servidor responde 400 | O falso normaliza as linhas por item como o servidor: 400 `REQUEST_VALIDATION_FAILED`, `obrigatorio`/`casas_decimais_excedidas`, com item e linha | vitest `RI-4` com as 4 respostas copiadas do servidor real (PYG). RED: `RangeError: casas_excedidas`. GREEN: 400 igual ao servidor |
| BANCO-03 | baixo | O quadro de rollback dizia só "Recusa" | O runbook (§0 e §9.2) traz as respostas exatas do runtime da P3-01: 403 `TENANT_SCOPE_VIOLATION` ao salvar ou descartar, e 422 `soma_diferente` ao confirmar. Traz também o aviso ao suporte | Documentação, conferida no código da `main` `f2b81e1b` (`apagarFilhosDoRascunho` antigo, `errorHandler` P2003 → 403, `ApiError` "Você não tem acesso a este registro.") |
| T1 | médio | O diálogo prometia que o geral voltava como estava, mas depois de salvar por item o formulário recarregado vinha com ele em branco | O texto passou a ser honesto ("guardado enquanto o rascunho não for salvo"). A volta para "Geral" diz quando o geral começa em branco | RTL `RIT-8 T1`. RED: a pergunta dizia "volta como estava". GREEN: "começa em branco" |
| T2 | médio | A recusa do servidor (`indice`/`subindice`) era resolvida contra o formulário atual. Mover um item com o PUT no ar levava o erro para o item errado | Retrato das chaves enviadas (item → linhas) no envio. O índice do servidor é traduzido por ele, e a mensagem cita a posição atual | RTL `RIT-8 T2`. RED: o erro não estava na linha 2 do FRETE. GREEN: "(item 1, linha 2 do rateio)" no campo certo |
| T3 | baixo | O "Modo do rateio" do bloco por item mudava o modo do geral guardado | `rateio_modo_geral` é guardado ao entrar no POR_ITEM e restaurado ao voltar ao GERAL (troca de escopo ou "sem produtos") | RTL `RIT-8 T3`. RED: o geral voltava em percentual. GREEN: 700,00/300,00 em valor |
| T4 | baixo | O POR_ITEM sobrevivia a "Sem produtos" sem itens e voltava sem diálogo | "Sem produtos" sempre volta ao GERAL | RTL `RIT-8 T4` |
| T5 | baixo | A escolha de "aplicar a todos" sobrevivia à troca de direção, e uma natureza de despesa ia para uma venda | A escolha pendente é zerada quando a direção muda | RTL `RIT-8 T5` |
| T6 | baixo | "Adicionar linha" depois de sobrar uma linha trazia de volta um valor antigo | A linha 1 recebe sempre o valor que estava à vista (líquido ou 100%) | RTL `RIT-8 T6`. RED: 420,00. GREEN: 600,00 |
| T7 | baixo | `aria-controls` apontava para um corpo fora do DOM com o bloco recolhido | `aria-controls` só com o bloco aberto (padrão do `SeletorPaginadoGestao`) | RTL `RIT-8 T7` |

Provas da rodada de correção (PostgreSQL 17.11 local, banco próprio, saída real):
`gestaoP3*.test.mjs` 164/164, eram 161 (+2 `RI11b` e +1 `RI10`); vitest
`gestaoLancamentos*` 7 arquivos e 255/255; `test:gates` 695/695; `lint` com 0
erros e as mesmas 56 advertências de antes; `gate:types` com 815 diagnósticos,
sem regressão; `typecheck:backend` limpo; `gate:deploy-migrations`,
`gate:supabase-public-grants`, `gate:tenancy` e `gate:indices` verdes;
`prisma migrate diff` banco→schema com saída 0. E2E real
(`e2e-lancamentos-real.mjs`, tela + Fastify + PG, 1280 e 390 px): pool 5 com
58 ✓ e 0 ✗, pool 3 com 58 ✓ e 0 ✗, incluindo os passos 28 e 29 (POR ITEM e
GERAL).

A migration da P3-02 **não foi alterada**: o sha256 está pinado em
`MIGRATIONS_APROVADAS`, e o comentário dela ("a linha herda a empresa do
documento e do item pelas FKs compostas") já é exato. O limite da FK está no
serviço, na D-PROD-156 e no §6.

## 5. Gate final

| Prova | Resultado |
|---|---|
| `npm run verify:all` no HEAD de código final `a89f2256`, em PostgreSQL 17.11 recém-criado e com a árvore limpa | **39/39 etapas PASS**, saída 0, 966 s. `test:gates` 695/695; `test:backend` 1.306 testes, 1.301 pass, 0 fail, 0 cancelados, 5 `todo` herdados; `test:smoke` 164 arquivos e 1.976 testes; lint, `gate:types`, `typecheck:backend`, `build` e `build:admin` PASS |
| Commits seguintes | só documentação (relatório, runbook e PR). O código e a migration ficam os de `a89f2256` |
| CI `quality` (`verify:all`) | conferido nos checks da PR #231 no HEAD final |

## 6. Limitações declaradas

- **`rateio_escopo` sem CHECK no banco.** O classificador proíbe CHECK em
  tabela antiga, então o domínio (NULL, GERAL ou POR_ITEM) é garantido no
  serviço e nos testes. NULL é tratado como GERAL.
- **Item de outro documento.**
  - A FK não amarra `item.operacao_id` a `linha.operacao_id`: isso exigiria uma
    unique nova em `OperacaoFinanceiraItem`, e o classificador a proíbe.
  - Desde a correção BANCO-02 (§4.1), o serviço confere essa amarração
    (`exigirLinhasDoDocumento`). Uma linha cruzada, que só pode ser gravada por
    SQL direto, é recusada com 422 `linha_de_item_fora_do_documento` na prévia,
    na confirmação, no PUT e no descarte, sem 500 e sem gravar nada.
- **`rateio_modo` é do documento.** VALOR ou PERCENTUAL vale para todas as
  linhas de todos os itens.
- **Preview da PR.** Ela usa o banco de produção, que ainda não tem o schema da
  P3-02. Não use a Preview para testar.
- **`maxDuration` de 60 s.** Continua sem leitura no painel desde a P3-01.

## 7. Prontidão

| Critério | Estado |
|---|---|
| CODE_READY | **SIM**: achados da revisão fechados (12 corrigidos e 1 decisão de contrato), `verify:all` 39/39 no HEAD de código e CI conferido na PR |
| SCHEMA_APPLIED_PROD | **NÃO**. Nada da P3-02 foi enviado ao Supabase |
| MERGE_READY | **NÃO**. Antes do merge: GO específico, migration aplicada e conferida pelo runbook |
