# MAIKE-IMPORTACAO-AREAS-KML-GEOJSON-01 — Relatório

**Data:** 2026-10-31 · **Decisão:** D-PROD-90 · **Base:** `main` `4a266dda` · **Branch:** `claude/new-session-26kpxu`

## 1. Escopo

O que entrou:
- importação de **áreas** dentro de Cadastro do Mapa → aba **Áreas**, pelo botão **"Importar áreas"**;
- formatos KML (`.kml`, inclusive do Google Earth), `.geojson` e `.json` com GeoJSON válido;
- fluxo em três etapas:
  1. arquivo — leitura local, sem nada no servidor;
  2. conferência — prévia no mapa, tabela editável, preenchimento em massa e conferência no servidor, sem gravar;
  3. gravação — atômica, só depois de confirmar.

O que **não** entrou:
- página, rota de tela ou menu novos;
- importação de pontos e linhas;
- atualização de áreas existentes por arquivo;
- lotes, movimentações e saldos;
- migration, mudanças no renderer do Mapa Geral e no catálogo de ícones.

## 2. ANTES → causa → DEPOIS → prova

| # | ANTES (confirmado no código de `main`) | Causa | DEPOIS | Prova |
|---|---|---|---|---|
| 1 | `MapaCadastro` montava o `ImportarGeoJSON`, mas **nenhum botão** abria o importador | `setShowImportarGeoJSON(true)` não era chamado em lugar nenhum | Botão "Importar áreas" na aba Áreas abre o assistente novo; o importador antigo foi **removido** | Captura `desktop-1440-01`; `importarAreasDialog.test.jsx` |
| 2 | O importador gravava **área sem `setor_id`** e mandava `numero_area`; o backend exige setor | `criarArea` com objeto montado do arquivo | A gravação só acontece com setor ativo da mesma empresa, conferido no servidor dentro da transação | IMP-05; pendência "Escolha o setor" |
| 3 | `numero_area` calculado no navegador como **MAX + 1** | Lista local de áreas | Número vem de `reservarNumero` (`EntidadeCodigoSequencia`) na transação; o item não aceita `numero_area` (400) | IMP-03 (1, 2), IMP-07 |
| 4 | Hectares por **Web Mercator plano** | Fórmula própria no componente | `@turf/area`, a mesma do editor; o servidor recalcula; o valor do arquivo só gera aviso | Teste "hectares geodésicos vs Mercator" (Mercator infla cerca de 7,7 % a 15,6°S); teste de paridade |
| 5 | **Pontos e linhas** criados pelo importador de áreas | Ramo `Point`/`LineString` chamava `criarPonto`/`criarLinha` | Ficam como "ignorado: não é área" e nunca são gravados | Teste do leitor; IMP-03 (0 pontos/linhas no banco) |
| 6 | **Um POST por área**, sem transação: uma falha no meio deixava metade gravada | Laço de `criarArea` no navegador | `POST /areas-pastagem/importacao` grava tudo ou nada; pendência devolve 422 com zero linhas | IMP-04 (0 áreas, 0 auditoria, 0 chaves) |
| 7 | Qualquer `.json` era tentado como GeoJSON; o primeiro anel era usado em silêncio | Sem checagem de tipo nem de anéis | `.json` precisa ser GeoJSON; buraco, várias partes e GeometryCollection ficam **inválidos com causa** | Testes do leitor (GeoJSON e KML) |
| 8 | XML com `DOCTYPE`/`ENTITY` aceito | `DOMParser` direto | Recusado antes de ler; `NetworkLink` não é seguido | Teste "recusa DOCTYPE/ENTITY" |
| 9 | Regras do formulário manual não valiam na importação | Validações espalhadas no componente | `regrasCadastroArea.js` é a regra única do formulário e da importação, e o servidor aplica a mesma | Teste de paridade; IMP-12 |

## 3. Arquivos

**Backend**
- `backend/src/modules/areas/areaImportacaoGeometria.js` (novo): valida o anel (faixa WGS84, vértice repetido, autointerseção, área mínima), calcula hectares (Turf) e gera a chave canônica do contorno.
- `backend/src/modules/areas/areaImportacaoService.js` (novo): `conferirImportacao` e `importarAreas`.
- `backend/src/modules/areas/areaImportacaoRoutes.js` (novo): as duas rotas, com schema fechado.
- `backend/src/app.js`: registra as rotas.
- `backend/src/shared/errors/errorCodes.js`: `AREA_IMPORT_VALIDATION_FAILED` (422) e `AREA_IMPORT_LIMIT_EXCEEDED` (413).

**Frontend**
- `src/lib/geografia/importacaoAreas.js` (novo): leitor KML/GeoJSON.
- `src/lib/geografia/topologia.js` (novo): autointerseção, com o mesmo algoritmo do servidor.
- `src/domain/areas/regrasCadastroArea.js` (novo): listas e pendências compartilhadas.
- `src/apis/areas/areaImportacaoNativePort.js` (novo), `areasApi.js`, `index.js`: porta online, sem fila offline.
- `src/services/areaImportacaoService.js` (novo): converte a linha da tela no item do contrato e gera a chave de retentativa.
- `src/components/mapa/importacaoAreas/ImportarAreasDialog.jsx` (novo): o assistente.
- `src/components/mapa/importacaoAreas/PreviaImportacaoMapa.jsx` (novo): MapLibre isolado.
- `src/pages/MapaCadastro.jsx`: botão "Importar áreas" e montagem do assistente.
- `src/components/mapa/FormularioArea.jsx`: usa a regra compartilhada.
- `src/components/mapa/ImportarGeoJSON.jsx`: **removido**.
- `src/apis/_core/ApiError.js` e `nativeHttpClient.js`: códigos da importação, `IDEMPOTENCY_*` e `EMPRESA_NOT_FOUND` preservados até a tela.

**Testes e documentação**
- `backend/tests/areaImportacaoNativa.test.mjs`
- `tests/smoke/importacaoAreasParser.test.js`
- `tests/smoke/importacaoAreasParidade.test.js`
- `tests/smoke/importarAreasDialog.test.jsx`
- fixtures sintéticas em `tests/smoke/fixtures/importacaoAreas/`
- `docs/engineering/DECISIONS.md` (D-PROD-90), este relatório e as capturas.

## 4. Rotas e payload

`POST /areas-pastagem/importacao/conferir`. Autenticada, não grava. Corpo:

```json
{ "empresa_id": "…", "itens": [ {
  "ref": "f1", "nome": "PASTO SEDE", "sigla": null, "setor_id": "…",
  "tipo_cultura": "Pastagem", "tipo_pastagem": "Marandu", "area_pastejada": 96.46,
  "aproveitamento_classificacao": "Média", "cor": "#f8f9fa",
  "coords": [[-15.6, -56.1], [-15.6, -56.091], [-15.609, -56.091], [-15.609, -56.1]]
} ] }
```

Resposta 200:

```json
{ "empresa_id": "…", "total": 1, "validas": 1, "com_pendencia": 0,
  "itens": [ { "ref": "f1", "ok": true, "tamanho_hectares_geodesico": 96.46, "pendencias": [] } ] }
```

Cada pendência tem a forma `{ campo, codigo, mensagem }`. Códigos possíveis:
- `CAMPO_OBRIGATORIO`, `CAMPO_INVALIDO`
- `SETOR_INVALIDO`, `SETOR_DE_OUTRA_EMPRESA`, `SETOR_INATIVO`
- `VERTICE_INVALIDO`, `VERTICE_FORA_DA_FAIXA`, `VERTICE_REPETIDO`
- `POLIGONO_DEGENERADO`, `POLIGONO_AUTOINTERSECAO`
- `PASTEJADA_MAIOR_QUE_TOTAL`
- `AREA_DUPLICADA`, `AREA_DUPLICADA_NO_ARQUIVO`, `NOME_DUPLICADO_NO_SETOR`, `NOME_DUPLICADO_NO_ARQUIVO`

`POST /areas-pastagem/importacao` recebe o mesmo corpo mais `operation_id` (8 a 128 caracteres, `[A-Za-z0-9_-]`). Respostas:

| Situação | Status e corpo |
|---|---|
| Gravou | **201** `{ operation_id, empresa_id, gravadas, importadas: [{ref, id, numero_area, nome, setor_id, setor_nome, tamanho_hectares}], replay }` |
| Alguma pendência | **422** `AREA_IMPORT_VALIDATION_FAILED`, com `details.itens` e `details.gravadas = 0` |
| Empresa fora do tenant | **404** `EMPRESA_NOT_FOUND` |
| Mesma chave, outro conteúdo | **409** `IDEMPOTENCY_CONFLICT` |
| Mesma chave ainda em processamento | **409** `IDEMPOTENCY_IN_PROGRESS` |
| Campo do servidor no corpo (`numero_area`, `setor_nome`, `cliente_id`, `empresa_id` no item, `tamanho_hectares`) | **400** |
| Acima dos limites | **400** pelo schema, ou **413** `AREA_IMPORT_LIMIT_EXCEEDED` pelo total de vértices |

O registro gravado tem:
- `coordenadas: { coords: [[lat,lng],...], cor }`, contrato do editor e anel aberto;
- `tamanho_hectares` geodésico com 2 casas (0 para Infraestrutura, como no formulário manual);
- `quantidade_atual: 0`, `status_ocupacao: "Disponível"`, `ativo: true`;
- `setor_nome` lido do setor;
- uma auditoria `create` por área, com `origem: importacao_arquivo` e o `operation_id`.

## 5. Contratos e segurança

- **Tenant:** só do `auth_context`; `cliente_id` no corpo é recusado pelo hook global. A empresa precisa existir no tenant. O setor é lido pelo unique `[cliente_id, id]` e precisa ter `empresa_id` igual e `ativo`. O frontend só oferece setores ativos da empresa selecionada.
- **Atomicidade:** uma transação do Prisma (timeout 60 s) com trava `pg_advisory_xact_lock(hashtext('areas-import:<cliente>:<empresa>'))`, reconferência completa, e depois número, inserção e auditoria de cada área. Uma pendência lança antes de qualquer inserção; falha de banco ou de auditoria no meio desfaz tudo.
- **Concorrência:** duas importações iguais ao mesmo tempo terminam em uma 201 e uma 422, com 3 áreas no banco (IMP-14).
- **Idempotência:** `OperacaoIdempotente`, que já existia (ESTAB-P0-01). A chave da tela muda só quando o conteúdo enviado muda; o "Verificar e concluir" reenvia com a mesma chave (teste do assistente). Reimportar o mesmo arquivo com outra chave dá `AREA_DUPLICADA` e `NOME_DUPLICADO_NO_SETOR` (IMP-08, captura 11).
- **Offline:** a porta de importação não passa pelo `createOfflineEntityAdapter`. Sem rede, conferir e importar ficam bloqueados com aviso, e o rascunho continua na tela aberta.
- **Geometria:** nada é descartado em silêncio. Vértice malformado invalida o contorno inteiro. O vértice de fechamento e as repetições em sequência viram aviso. Buraco e várias partes viram inválidos.
- **Texto do arquivo:** só nome e sigla são lidos, sem caracteres de controle e com tamanho limitado. A descrição não vira nome nem comando.

## 6. Limites declarados

| Limite | Valor | Onde |
|---|---|---|
| Arquivo | 10 MB e 500 elementos (Placemark/Feature) | navegador |
| Por confirmação | 100 áreas, atômicas | navegador e servidor |
| Vértices | 5 000 por área; 50 000 por pedido | servidor |
| Corpo HTTP | 4 MB (a Vercel aceita 4,5 MB) | rota |

Um arquivo com mais de 100 áreas é importado em lotes sucessivos no mesmo assistente (R1, seção 13): "Continuar com áreas restantes". Cada lote é tudo-ou-nada só dentro dele; lotes já gravados não são desfeitos por um seguinte, e a tela diz isso.

## 7. Testes executados (resultados reais)

| Comando | Resultado |
|---|---|
| `node --test backend/tests/areaImportacaoNativa.test.mjs` (PostgreSQL 16 local) | **14/14** |
| `npx vitest run tests/smoke/importacaoAreasParser.test.js` | **19/19** |
| `npx vitest run tests/smoke/importacaoAreasParidade.test.js` | **5/5** |
| `npx vitest run tests/smoke/importarAreasDialog.test.jsx` | **13/13** |
| `npm run verify:all` | ver seção 8 |

Casos cobertos:
- KML com namespace, altitude, `name` e anel aberto ou fechado;
- `.geojson` (FeatureCollection) e `.json` (Feature único); propriedades em português e inglês; JSON inválido e JSON que não é GeoJSON;
- 0 como coordenada; Turf comparado com Mercator;
- autointerseção, degenerado, fora de faixa, buraco, MultiPolygon e MultiGeometry com 2 partes; arquivo misto; arquivo sem polígono;
- conferir sem gravar; preenchimento em massa só na seleção e sem sobrescrever valor próprio;
- regras por tipo de uso, com 0 aceito;
- setor de outro tenant, de outra empresa e inativo; empresa de outro tenant;
- campos do servidor recusados; tudo-ou-nada; retentativa e conflito de chave; duplicata no arquivo e já existente;
- homônimas em setores diferentes; concorrência;
- 422 na tela; resultado desconhecido com reenvio pela mesma chave; troca de empresa; sem rede; cancelar;
- atualização da lista, do cache `areas` do mapa e do evento `atualizar-mapa`.

## 8. Gates e CI

- `npm run verify:all`: resultado da execução final na resposta da PR.
- `gate:types` passa: nenhum diagnóstico novo; o arquivo removido levou junto a dívida dele.
- `gate:area-pastagem-native` não muda: as rotas novas ficam em arquivo próprio, todas com `app.autenticar` e schema fechado, sem citar `setor_nome`.
- CI do GitHub: ver a PR.

## 9. Evidências

Capturas reais em `docs/engineering/evidencias/importacao-areas/`, feitas com o app em Vite contra o backend local, banco de demonstração `maike_demo` com dados sintéticos. Não há produção envolvida.

| Largura | Capturas |
|---|---|
| Desktop 1440 px | `01` aba Áreas com o botão, `02` escolha do arquivo, `03` arquivo lido, `04` conferência com pendências, `05` preenchimento em massa, `06` bloqueio por nome vazio, `07` conferido no servidor, `08` confirmação tudo-ou-nada, `09` relatório, `10` áreas cadastradas, `11` reimportação com duplicadas apontadas |
| Tablet 768 px e celulares 412 e 390 px | `01` a `04` |

## 10. Validação manual pelo proprietário (ambiente seguro, nunca produção)

1. Abrir Cadastro do Mapa → Áreas → **Importar áreas**.
2. Enviar `tests/smoke/fixtures/importacaoAreas/fazenda-google-earth.kml`. Deve mostrar 7 elementos: 3 áreas, 2 ignorados e 2 inválidos.
3. **Conferir áreas.** Em massa, escolher Setor, Pastagem, Marandu e "Igual à área total". Dar nome ao Placemark 3.
4. **Conferir seleção** (nada gravado), depois **Importar 3 área(s)** e **Gravar áreas**. Conferir números, setor e hectares no relatório e na lista.
5. Repetir com o mesmo arquivo: as 3 linhas devem aparecer como duplicadas e a gravação deve ficar bloqueada.
6. Abrir o Mapa Geral: as áreas novas aparecem em branco.

## 11. Rollback

A mudança só adiciona código; não há migration nem dado alterado fora das áreas importadas. Para reverter:
- reverter o commit da PR. As rotas somem e o botão some;
- as áreas já importadas são registros normais de `AreaPastagem`, com auditoria `origem: importacao_arquivo`. Podem ser baixadas pela exclusão lógica de sempre.

## 12. Riscos residuais e limites conhecidos

- **Sobreposição parcial** entre áreas não é avisada; só o contorno idêntico é detectado. Áreas vizinhas que dividem borda continuam aceitas.
- A **autointerseção** é calculada no plano lng/lat, como o editor desenha. Bordas tangentes muito finas podem ser recusadas; o motivo aparece na linha.
- **Infraestrutura** grava 0 ha cadastrais, mantendo a regra do formulário manual; a área real aparece na prévia e o contorno fica gravado.
- **Formulário manual:** Reserva e APP deixaram de exigir cultura, e a pastejada maior que o total passou a ser recusada. Isso é efeito da regra compartilhada (D-PROD-90).
- O **tempo de função da Vercel** para 100 áreas não foi medido em produção. Benchmark local e estimativa na seção 13.
- ~~`FormularioArea` calculava `numero_area` local~~ — removido na R1 (seção 13).

---

## 13. R1 — correção pedida pelo arquiteto (2026-10-31)

Executada sobre a mesma branch e a mesma PR (#157, DRAFT). HEAD auditado: `76933212`; base: `main` `4a266dda`, sem mudança desde a auditoria; nenhuma outra PR aberta.

### 13.1 ANTES → causa → DEPOIS → prova

| Achado | Causa real no código auditado | Correção (arquivos) | Antes (HEAD `76933212`) | Depois |
|---|---|---|---|---|
| R1-P1 "resultado desconhecido" descartável | `fechar()` só barrava `gravando`; `reiniciar()` apagava chave, assinatura e itens. Esc, clique fora, Cancelar e "Recomeçar" descartavam a operação | `ImportarAreasDialog.jsx`: pedido **congelado** (`pendente` = chave + empresa + itens); em `desconhecido` tudo fica travado (edição, seleção, massa, "Outro arquivo", "Recomeçar"). Esc, clique fora, X e Cancelar abrem a confirmação "O resultado ainda é desconhecido; áreas podem já ter sido criadas". O reenvio usa exatamente o pedido congelado, inclusive com a empresa trocada no meio | 13 testes do assistente falham (ex.: Esc fechava; não havia confirmação) | `importarAreasDialog.test.jsx` 27/27 |
| R1-P1 timeout de 20 s × transação de 60 s; falhas ambíguas ditas "nenhuma gravada" | `TIMEOUT_MS` global de 20 s; só `PROVIDER_UNAVAILABLE` e `IDEMPOTENCY_IN_PROGRESS` iam para "desconhecido". 500, código desconhecido, corpo ilegível e 201 sem corpo diziam "Nenhuma área foi gravada" | `nativeHttpClient.js`: opção `timeoutMs` **por pedido**, sem mudar o padrão global. `areaImportacaoNativePort.js`: 75 s só na gravação. `areaImportacaoService.js` (front): `classificarFalhaDeGravacao` e `respostaDeGravacaoValida` | 4 testes da fronteira falham (`TIMEOUT_GRAVACAO_MS` indefinido; sem classificação) | `importacaoAreasGravacao.test.js` 4/4; casos 500, 502/504, desconhecido, corpo ilegível e 201 sem corpo na UI |
| R1-P1 sem continuação após 100 | Depois do sucesso só havia "Importar outro arquivo" (apagava tudo) e "Ver áreas" | "Continuar com áreas restantes (N)" mantém arquivo, edições e o mapa ref → área gravada; seleciona as próximas ≤100 não gravadas; chave nova para conteúdo novo; setores relidos a cada lote; linhas gravadas ficam travadas e marcadas "Gravada · nº X (lote L)"; resumo acumulado; sair no meio avisa o que ficou gravado | Teste de lotes falha | IMP-19 (backend, 205 = 100+100+5 com falha no 2º) e teste de UI (lote 10: 10 + falha + 10 + 5) |
| R1-P1 corrida com a **mesma** chave | `executarComIdempotencia` fazia `create` + captura de `P2002`. No PostgreSQL o erro de unique **aborta a transação** (25P02) e a releitura no `catch` falhava → **500** | `backend/src/shared/idempotency/operacaoIdempotenteService.js`: reserva por `createMany({ skipDuplicates: true })` (`INSERT … ON CONFLICT DO NOTHING`); o segundo pedido espera o primeiro e relê sem erro → replay (mesmo conteúdo) ou `IDEMPOTENCY_CONFLICT` (outro) | IMP-15 e IMP-16: **500 INTERNAL_ERROR**; o teste do consumidor de saída de suplementação: 500 com `25P02` no log | IMP-15/16 verdes; consumidor de estoque verde; 172 testes dos 4 consumidores sem falha |
| R1-P2 carga | Sem medição | `scripts/bench/importacao-areas-bench.mjs` (fora do CI) e medição no Chromium (13.4). Achado e corrigido: o Select do Radix renderiza todas as opções mesmo fechado; com 205 linhas a conferência levava **12,2 s** e **419 MB** de heap. `SeletorImportacao.jsx` monta o Select só quando abre; `LinhaImportacao.jsx` (linha memorizada) | 12,2 s / 419 MB (205 linhas, 1440 px) | 1,0 s / 85 MB |
| R1-P2 paridade de regras | Listas e regras copiadas em duas camadas, sem prova | `backend/src/modules/areas/areaImportacaoRegras.js` (regras puras do servidor); `regrasCadastroArea.js` ganhou limites de nome e sigla | — | `importacaoAreasParidade.test.js`: matriz de 1.500+ combinações (uso × cultura × pastejada × nome × sigla × setor), listas e limites idênticos, arredondamento a 2 casas |
| R1-P2 MAX+1 no formulário | `FormularioArea` listava todas as áreas e calculava `numero_area` (a porta descartava) | Removidos o cálculo, a listagem e o envio de `numero_area`/`setor_nome` | `formularioAreaCriacaoManual.test.jsx`: 1 falha (`numero_area` enviado) | 2/2 |
| R1-P2 trava × criação manual | A trava `pg_advisory_xact_lock` só existe na importação | **Não alterado** (fora do contrato desta missão). Ver risco residual 13.6 | — | Documentado |

### 13.2 Contrato final

- **Atomicidade por lote:** cada confirmação grava até 100 áreas, todas ou nenhuma. O arquivo inteiro **não** é transacional; lotes anteriores continuam gravados se um lote seguinte falhar (IMP-19).
- **Chave por lote:** `operation_id` novo quando o conteúdo enviado muda; o mesmo conteúdo reaproveita a chave. A chave de um lote gravado nunca é usada para outro conjunto (teste de UI: 3 lotes, 3 chaves).
- **Resultado desconhecido:** só sai por resposta conclusiva do servidor:
  - 201 válido, inclusive `replay: true`;
  - recusa avaliada (422, 413, 400, 404 de empresa, 409 de conflito de chave).

  Rede, timeout, 5xx, gateway, código desconhecido, corpo ilegível, 201 sem corpo coerente e "em processamento" mantêm o estado. 401 no reenvio também mantém, porque não prova nada sobre o envio anterior.
- **Fechar ou recarregar com resultado desconhecido:** só com confirmação explícita. A chave e o pedido vivem na memória da tela, sem armazenamento durável de geometria (decisão consciente); **depois de fechar ou recarregar, a reconciliação automática se perde**. O texto avisa: "áreas podem já ter sido criadas — confira a lista antes de importar de novo". Reimportar o mesmo arquivo com chave nova é barrado como duplicado (IMP-08, IMP-19).
- **Timeouts:**
  - gravação: 75 s no cliente e 60 s na transação;
  - conferência: padrão global de 20 s, sem chave;
  - se a borda da Vercel cortar antes (limite de duração da função não configurado em `vercel.json`, depende do plano), o cliente recebe 504 e o resultado é tratado como desconhecido. Nunca há reenvio automático.

### 13.3 Testes (resultados reais nesta máquina)

| Suíte | Resultado |
|---|---|
| `backend/tests/areaImportacaoNativa.test.mjs` (PostgreSQL 16) | **19/19** (IMP-01..19) |
| `backend/tests/estabP0LancamentosNativo.test.mjs` | 7/7 (inclui a corrida com a mesma chave) |
| Consumidores de idempotência (`estabP0`, `estoquePecuarioLedger*`, `catalogo*`, `inicializarTenant…`, importação) | 172 aprovados, 0 falhas (5 pulados) |
| `tests/smoke/importarAreasDialog.test.jsx` | 27/27 |
| `tests/smoke/importacaoAreasGravacao.test.js` | 4/4 |
| `tests/smoke/importacaoAreasParidade.test.js` | 7/7 |
| `tests/smoke/importacaoAreasParser.test.js` | 19/19 (sem regressão) |
| `tests/smoke/formularioAreaCriacaoManual.test.jsx` | 2/2 |
| Antes, no HEAD `76933212` (worktree, testes novos) | 18 falhas na UI e no cliente; IMP-15/16: 500 |

Sobre a UI com 205 linhas no jsdom: o worker de teste estoura a memória. O teste de UI exercita a mesma lógica com lote de 10 (prop `maxPorLote`, padrão 100) e 25 linhas. As 205 áreas reais estão provadas no backend (IMP-19) e no Chromium (13.4).

### 13.4 Benchmark local (sem rede até o banco)

`node scripts/bench/importacao-areas-bench.mjs` com PostgreSQL 16 local e Fastify `inject`:

| Cenário | Corpo | Leitura no navegador | Conferir | Importar | RSS |
|---|---|---|---|---|---|
| 10 áreas × 4 vértices | 3 KB | 4 ms | 25 ms | 132 ms | 150 MB |
| 50 × 4 | 16 KB | 3 ms | 18 ms | 486 ms | 151 MB |
| 100 × 4 | 32 KB | 3 ms | 16 ms | 904 ms | 154 MB |
| 100 × 500 (50 mil vértices) | 2,0 MB | 245 ms | 289 ms | 3.020 ms | 190 MB |
| 10 × 5.000 (máx. por área) | 2,0 MB | 702 ms | 845 ms | 2.459 ms | 274 MB |

Chromium headless, SwiftShader, sem GPU, com o arquivo de 205 áreas e lote de 100:

| Viewport | Abrir a conferência | Aplicar em massa (100) | Gravar 100 | Heap JS |
|---|---|---|---|---|
| 1440 | 980 ms | 459 ms | 2.220 ms | 85 MB |
| 768 | 1.004 ms | 483 ms | 1.875 ms | 88 MB |
| 412 | 974 ms | 480 ms | 1.957 ms | 82 MB |
| 390 | 886 ms | 607 ms | 2.075 ms | 102 MB |

**Limites desta medição:**
- o banco é local, com latência quase zero. A gravação faz cerca de 4 idas ao banco por área (sequência, inserção, auditoria), mais as leituras fixas;
- com 5 a 10 ms por ida até o Supabase, 100 áreas somam de 2 a 4 s a mais. Fica abaixo da transação de 60 s, **mas não foi medido em produção**;
- o corpo de 2 MB cabe no limite de 4 MB da rota e de 4,5 MB da Vercel.

**Recomendação operacional:** manter 100 áreas e 50 mil vértices por lote. Se a medição em produção mostrar mais de 30 s, reduzir o lote antes de ampliar o timeout.

### 13.5 Evidências R1 (capturas reais; backend local, banco `maike_demo` sintético)

Em `docs/engineering/evidencias/importacao-areas/r1-{1440,768,412,390}-NN-*.png`, para cada largura:

| Nº | Captura |
|---|---|
| 01 | Seleção conferida |
| 02 | **Resultado desconhecido**: o servidor gravou e a resposta foi cortada pela automação; o banco já tinha 3 áreas |
| 03 | Esc pede confirmação |
| 04 | "Verificar e concluir" → replay, banco continua com 3 áreas |
| 05 | Reimportação com duplicadas apontadas |
| 06 | Conferência de 205 áreas |
| 07 | Lote 1 gravado, com "Continuar com áreas restantes (105)" |
| 08 | Lote 2 com as 100 já gravadas marcadas |
| 09 | Tabela com rolagem horizontal |
| 10 | Aviso ao sair no meio |

Fixture de validação manual: `tests/smoke/fixtures/importacaoAreas/lote-205-areas.geojson`.

### 13.6 Riscos residuais (R1)

- **Trava × criação manual:** a trava por empresa só serializa importações entre si. Uma área desenhada à mão com contorno idêntico, no mesmo instante de uma importação, pode passar nas duas checagens; a criação manual também não tem checagem de duplicidade. É a janela residual: a importação não promete prevenção absoluta contra qualquer fluxo. Fechar exigiria mudar o contrato da criação manual, fora desta missão.
- **Fechar ou recarregar em "resultado desconhecido"** perde a reconciliação automática (13.2). Mitigações: confirmação explícita, aviso e bloqueio de duplicidade na reimportação.
- **Produção:** tempo de gravação e limite de duração da função Vercel não medidos.
- **O helper de idempotência compartilhado mudou** (correção do 500 em corrida). Consumidores cobertos por teste: estoque, ledger e catálogo, mais a importação.

### 13.7 Validação manual R1

1. Usar `lote-205-areas.geojson`: conferir, preencher em massa, conferir e importar 100.
2. Clicar em "Continuar com áreas restantes (105)": as 100 primeiras aparecem como "Gravada"; repetir até 205.
3. Resultado desconhecido: no DevTools, aba Network, marcar "Offline" logo após clicar em "Gravar áreas". Aparece "Resultado desconhecido". Esc pede confirmação. Voltar o Network para "Online" e clicar em "Verificar e concluir": aparece o resultado, sem duplicar.

### 13.8 Rollback

Reverter os commits R1 da PR. O helper de idempotência volta ao `create` + `P2002`, e com ele o 500 em corrida. Não há migration.

---

## 14. R2 — "importar tudo" e "imediata" (D-PROD-91, 2026-10-31)

### 14.1 Contorno que se cruza

| Antes | Depois |
|---|---|
| Contorno que se cruza ou passa duas vezes pelo mesmo ponto → item inválido, não importa (10 Placemarks do arquivo real do proprietário) | O item é importado como está no arquivo, com aviso na linha ("…será importado como está no arquivo"). O servidor marca `avisos: [{codigo: 'CONTORNO_SE_CRUZA'}]` e grava as coordenadas sem alteração (IMP-20) |

Continuam recusados, porque importar perderia ou inventaria dado:
- coordenada fora de WGS84;
- menos de 3 pontos distintos ou área nula;
- buraco interno;
- várias partes (MultiPolygon ou MultiGeometry com mais de um polígono).

### 14.2 Lentidão: "fica Gravando…"

**Causa:**
- Supabase em `sa-east-1` (consultado: projeto MAIKE, `region: sa-east-1`). O `vercel.json` não fixa região, então as funções rodam na região padrão da Vercel, a cerca de 120 ms de São Paulo por ida e volta;
- o código fazia cerca de 4 idas ao banco por área, dentro da transação.

**Prova:** proxy TCP local com 60 ms por sentido entre a API e o PostgreSQL (`/tmp`, fora do repositório). Mesmo código e mesmo banco, antes e depois:

| Áreas | Antes (main `465e72b9`) | Depois |
|---|---|---|
| 10 | 6,8 s | 3,1 s |
| 50 | 26,0 s | 2,1 s |
| 100 | **50,8 s** (limite da transação: 60 s) | **2,1 s** |

**Correção (número fixo de idas ao banco):**
- `setor.findMany` por lista de ids;
- `reservarNumeros(tx, …, N)`: garante a linha da sequência e faz um `UPDATE … + N RETURNING`;
- `inserirAreasEmLote` com `createManyAndReturn`. Cada área é associada à sua `ref` pelo número reservado, sem depender da ordem do retorno;
- `registrarEventosEmLote`: `createMany` da auditoria, um evento por área, com o mesmo conteúdo de antes.

**Provas (IMP-21):** 100 áreas com números consecutivos depois de uma já existente, refs na ordem e apontando para a área certa, 101 auditorias e a sequência avançando exatamente 100.

**Gates:** `verify:all` local 32/32 PASS (backend 519/524 com 0 falhas, smoke 1081/1081).

**Recomendação não aplicada:** fixar `"regions": ["gru1"]` no `vercel.json` aproxima todas as funções do banco e acelera o sistema inteiro. Muda a configuração de deploy, então fica para decisão do proprietário.
