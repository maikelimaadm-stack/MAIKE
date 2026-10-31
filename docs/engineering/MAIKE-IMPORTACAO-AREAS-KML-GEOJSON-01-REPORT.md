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

Um arquivo com mais de 100 áreas é importado em confirmações sucessivas. Cada uma é tudo-ou-nada, e as já gravadas aparecem como duplicadas nas seguintes. A tela não diz que uma confirmação desfaz a anterior.

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
- O **tempo de função da Vercel** para 100 áreas não foi medido em produção. O limite é conservador: cerca de 4 consultas por área numa transação de até 60 s.
- O **`FormularioArea`** continua calculando um `numero_area` local que a porta já descarta antes do envio. É código morto, não comportamento; fica para a missão do formulário.
