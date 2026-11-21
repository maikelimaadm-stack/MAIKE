MAIKE-ENTREGA3 (D-PROD-275) · `claude/tipo-tarefa-drop-colunas-1aznvv` · PR (a abrir)

# MAIKE — Entrega 3: a reforma de pastagem como agrupador

Decisão: [D-PROD-275](./DECISIONS.md) · Proposta aprovada (Parte 1, §1.2 A, B e C e o "Reforma (PR C)" do §1.3):
[`MAIKE-PROPOSTA-REFORMA-E-VARIOS-DIAS.md`](./MAIKE-PROPOSTA-REFORMA-E-VARIOS-DIAS.md) · Runbook:
[`MAIKE-ENTREGA3-REFORMA-RUNBOOK-RELEASE.md`](./MAIKE-ENTREGA3-REFORMA-RUNBOOK-RELEASE.md) · Entrega anterior:
[Campos por tipo (D-PROD-274, PR #354)](./MAIKE-ENTREGA2-CAMPOS-POR-TIPO-REPORT.md).

**Com migration EXPAND** (`20261122100000_reforma_planejamento`), testada só no PostgreSQL local. A branch foi
refeita sobre a `main` `6cb0b176` (a Entrega 2, D-PROD-274, PR #354, mergeada; a migration dela aplicada em produção em
2026-11-23; também o estoque #350 com a `20261120300000_estoque_ajustes` e as PRs #353, #355 a #359): os 3 commits da
Entrega 3 foram reaplicados por cherry-pick, com os conflitos resolvidos mantendo os dois lados. Produção hoje: 74
migrations e 109 tabelas; esta é a 75ª e leva a 111. Ordem da release: **aplicar esta migration (com o GO do
proprietário) e então o merge**. Nada foi aplicado em produção; nada foi enviado ao `origin`.

## 1. Banco

| O quê | Onde |
|---|---|
| Tabela nova `Planejamento` (a reforma): `numero` (sequência do tenant), `nome` (do servidor), `tipo` (CHECK `REFORMA`, `FORMACAO`, `OUTRO`), `safra_ciclo`, `cultura_alvo_id` (o capim que vai ficar, opcional, FK composta ao Cadastro de Culturas da mesma fazenda), `data_inicio` (o início previsto), `status` (CHECK `ABERTO`, `CONCLUIDO`, `CANCELADO`; a data de conclusão só no CONCLUIDO), `data_conclusao` (CHECK ≥ início), `criado_por_usuario_id`, `versao` | tabela nova |
| Tabela nova `PlanejamentoArea`: as áreas da reforma e os `hectares` de cada uma (CHECK > 0; a mesma área uma vez só por reforma) — o divisor do R$/ha | tabela nova |
| `planejamento_id` VARCHAR(64), anulável, sem DEFAULT — de que reforma a realização faz parte; índice (`cliente_id`, `planejamento_id`) e FK (`cliente_id`, `planejamento_id`) → `Planejamento` (`cliente_id`, id), RESTRICT | `Atividade` |

Uniques e índices começando por `cliente_id`; FKs compostas pelo tenant (e pela fazenda nas tabelas novas), RESTRICT;
o bloco RLS de sempre nas duas tabelas novas. Nenhuma linha muda; nada é semeado; **nenhum custo é gravado** (o custo
e o R$/ha são calculados na leitura). Checksum `27f16e1d44df673e97a62ef2122199c94d8d6adcdd07d006180ef0f90b873a10`, pinado
em `MIGRATIONS_APROVADAS`; o bloco RLS (`3dd03bb8…5c654`) em `DO_RLS_APROVADOS`. O preflight de schema do deploy
passou a exigir `Planejamento.status`, `PlanejamentoArea.hectares` e `Atividade.planejamento_id`. O número da decisão
não está no SQL (renumerar não muda o checksum).

**Por que a FK de `Atividade` é só pelo tenant:** a allowlist EXPAND (`premergeMigrateLib.mjs`) só aceita, em tabela
antiga, a FK `("cliente_id", "<coluna nova>") → "<tabela nova>"("cliente_id", "id")`. A mesma fazenda é conferida
pela API (o registro confere o `planejamento_id` contra a fazenda do registro, `FOR SHARE`). Nas tabelas novas as FKs
incluem `empresa_id`.

## 2. O que foi feito (itens 1 a 7 do pedido)

**1. Migration EXPAND** — acima. Ensaio do caminho B num banco local com as 74 anteriores: aplicou, 75 / 0, 111
tabelas; 2ª execução e alvo divergente recusaram; `migrate status` e `migrate diff` limpos (runbook §3).

**2. "Planejar" cria a reforma** — o botão "Planejar" da lista agora pergunta o que planejar: **Reforma de pastagem**
ou **Um serviço** (o planejar de antes, sem mudança). O formulário da reforma tem só os 4 campos: **Áreas** (com os
hectares de cada uma, o mesmo componente de áreas da Nova realização; infraestrutura fora), **Tipo** (Reforma,
Formação, Outro), **Capim que vai ficar** (opcional, do Cadastro de Culturas, com "(recuperação: mesmo capim)" ou
"(renovação: troca de capim)" comparando com o capim de hoje das áreas) e **Início previsto**. A **Safra** e o **nome
sugerido** ("Reforma · PASTO DA AROEIRA · 2026/27") são só leitura; o servidor grava o nome e a safra (ano agrícola do
início, julho a junho, `safraDoDia`). Mais de uma área: "Reforma · PASTO DA AROEIRA +1 · 2026/27". Salvar abre a lista
filtrada pela reforma nova.

**3. "Faz parte de" na Nova realização** — na seção Planejamento, quando há uma reforma ABERTA com todas as áreas do
registro: "Faz parte de: Reforma · … ✓" já marcada, com o **tirar** (uma cerca nova numa área em reforma, por exemplo)
e o **pôr de volta**. Com duas reformas abertas, uma lista obrigatória ("Não faz parte de reforma" é uma opção). O
serviço que continua e já faz parte de uma reforma mostra a dela e não manda o campo. Sem área (Manutenção e Outros com
o local) não há "Faz parte de". No servidor, `POST /atividades/registrar` aceita `planejamento_id`:

- conferido dentro da transação, antes das áreas, com a reforma travada `FOR SHARE`: da mesma fazenda e tenant
  (senão `inexistente`), ABERTA (`fechado`) e com TODAS as áreas do registro (`area_fora`, com a área em
  `details.area_id`) → 422 `ATIVIDADE_REFERENCIA_INVALIDA`; com o campo e sem área → 400 (`sem_area`);
- a atividade NOVA nasce ligada; a que CONTINUA só é ligada se ainda não tinha reforma (auditado
  `atividade.planejamento`); **uma ligação diferente nunca é sobrescrita**. A resposta diz o que aconteceu:
  `registro.planejamento_ligacao` = `criada | completada | ja_ligada | mantida_outra`;
- entra no fingerprint de idempotência **só quando vem**: sem ele, o fingerprint é byte a byte o de antes (provado em
  teste reconstruindo a fórmula anterior); com ele, o mesmo envio repete e outro valor dá 409;
- pede só a permissão de lançar (a mesma do registro).

**4. A lista com o filtro Reforma e a barra** — a pílula **Reforma** (só aparece quando a fazenda tem reforma, ou com
uma escolhida) filtra no servidor (`GET /atividades?planejamento_id=`). Com ela, a barra em cima da lista: **custo
total**, **R$/ha** (custo ÷ hectares da reforma), **área da reforma**, nº de serviços, o **custo por tipo** (Preparo do
solo, Plantio de pastagem, Fertilização, Aplicação…) e os **serviços em ordem de data** com a situação (Concluída, Em
andamento, Cancelada). O custo é o MESMO cálculo da lista (`custosTotaisDasAtividades`), na leitura; a realização
cancelada aparece mas não soma. Nas telas do harness: 6.400 + 3.000 + 7.240 + 1.600 = R$ 18.240,00 ÷ 40 ha =
R$ 456,00/ha.

**5. Mapa: "Em reforma desde DD/MM"** — o Detalhes da área mostra, na linha da cultura, "Em reforma desde 01/09" e o
nome da reforma (com o chip "Reforma"); com o início ainda no futuro, "Reforma prevista para …". Vem do resumo da área
(`GET /atividades-por-area/:id/resumo`, que agora traz `planejamentos`: as reformas ABERTAS da área com todas as áreas
de cada uma). A concluída sai do mapa.

**6. Concluir e Cancelar** — na barra:

- **Concluir reforma**: a data de conclusão (padrão hoje na fazenda; nunca futura nem antes do início), o custo final
  e, quando o capim que vai ficar é diferente do capim de hoje de alguma área, a pergunta **"Trocar o capim da área
  para MOMBAÇA?"** com a lista "PASTO DA AROEIRA: BRAQUIARINHA → MOMBAÇA". "Sim, trocar e concluir" manda
  `trocar_capim: true`: o servidor troca o capim de cada área pelo **caminho de sempre da área** (o mesmo
  `PATCH /areas-pastagem/:id`, agora com o miolo `atualizarNaTransacao` exportado: regras da cultura, `tipo_pastagem`
  derivado, auditoria `update` da área) **na mesma transação** da conclusão; uma recusa da área desfaz tudo. "Não, só
  concluir" conclui sem mexer na área. CAS por `versao` (409 com versão velha ou já concluída).
- **Cancelar**: CANCELADO; **nada é apagado** — as realizações continuam ligadas e com custo; a reforma só deixa de
  receber realização nova.

**7. Permissões, guardas e erros** — em `guardasRotas.js`, tela `op-atividades`: ver = visualizar; criar =
novo|salvar; concluir = editar|salvar e, **só com `trocar_capim: true`**, também o editar da tela do Cadastro do Mapa
(a mesma exigência do PATCH da área); cancelar = excluir. Na tela, sem o editar do Cadastro do Mapa o "Sim, trocar"
fica desligado e a frase diz por quê. Erros pelo `AppError`/`errorCodes`: código novo `PLANEJAMENTO_NOT_FOUND` (404,
outra fazenda ou outro tenant), as referências `planejamento_id` (inexistente, fechado, area_fora), `cultura_alvo_id`
(inexistente, inativo) e `trocar_capim` (sem_capim), o conflito de versão da reforma e as frases em português na tela
(`lancamentoAtividadesRegras.js`). O tenant vem só do `auth_context` (`cliente_id` no corpo → 400).

## 3. Arquivos

- **Servidor:** `planejamentoService.js` e `planejamentoRoutes.js` (novos, em `backend/src/modules/atividades/`);
  `atividadeRegistroService.js` e `atividadeRegistroRoutes.js` (o "Faz parte de"); `atividadeService.js` (grava o
  `planejamento_id` na atividade nova, o filtro da lista); `atividadeRoutes.js`; `atividadeComum.js` (a forma
  pública); `atividadePorAreaService.js` (o resumo da área); `areaPastagemService.js` (`atualizarNaTransacao`
  exportado, o `atualizar` de sempre por cima dele); `guardasRotas.js`; `AppError.js`, `errorCodes.js`; `app.js`;
  `schema.prisma`; a migration; `premergeMigrateLib.mjs` e `preflightSchemaLib.mjs` (os pinos).
- **Tela:** `src/lib/reformaRegras.js` (novo: nome sugerido, natureza, "Faz parte de", pergunta do capim, "Em reforma
  desde", corpo); `JanelaPlanejar.jsx`, `FormularioReforma.jsx`, `BarraDaReforma.jsx` e `DialogoConcluirReforma.jsx`
  (novos, em `src/components/lancamento-atividades/`); `RegistroDeCampo.jsx` (o "Faz parte de");
  `LancamentoAtividades.jsx` (Planejar, a pílula, a barra, concluir/cancelar); `AbaDetalhesDaArea.jsx` (o mapa);
  `AreasDoRegistro.jsx` (a palavra dos hectares); portas e serviços (`lancamentoAtividadePort.js`,
  `atividadesApi.js`, `apis/atividades/index.js`, `lancamentoAtividadesService.js`, `useLancamentoAtividadesSessao.js`,
  `lancamentoAtividadesPermissions.js`, `lancamentoAtividadesRegras.js`, `ApiError.js`, `nativeHttpClient.js`);
  `cadastro-base1.css`. Sem página nova: `config/mapa-manejo-scope.json` não mudou (R1).

## 4. Testes

- **Backend novo** `backend/tests/atividadeReforma.test.mjs` (20 testes, Postgres real): nome sugerido e safra;
  criar (nome/safra/número do servidor, áreas sem hectares = o tamanho, auditoria), recusas 400 e 422, lista e 404 de
  outra fazenda e outro tenant; "Faz parte de" (nova nasce ligada, sem o campo fica sem, continuar liga só a sem
  reforma e nunca troca, várias áreas, recusas sem gravar nada, **fingerprint byte a byte o de antes sem o campo**);
  custo (total = Σ da lista, R$/ha, por tipo, ordem de data, a cancelada não soma, nada gravado); resumo da área;
  concluir sem e com a troca do capim (só as áreas com outro capim, `tipo_pastagem`, auditoria da área), recusas
  (sem capim, datas, versão velha, já concluída), a recusa da área desfaz a conclusão; cancelar; permissões (incluindo
  o editar do Mapa Cadastro só para trocar o capim) e tenant.
- **Smoke novo** `tests/smoke/reformaPastagem.test.jsx` (16 testes): as regras puras; o "Faz parte de" na tela real
  (marcada, tirar/pôr de volta, duas reformas, o que continua, sem área, a recusa do servidor embaixo da linha); o
  formulário (4 campos, renovação/recuperação, o corpo); a lista (Planejar pergunta, a pílula filtra no servidor, a
  barra, concluir com e sem troca, sem permissão do mapa, sem editar/cancelar); o mapa ("Em reforma desde").
- **Mudaram de propósito:**
  - `tests/smoke/lancamentoAtividades.test.jsx` (LA-CABECALHO-1 e LA-REGISTRAR-1): "Planejar" agora abre a escolha;
    o teste clica em "Um serviço" para seguir para o planejar de antes;
  - `tests/smoke/permissoesAntigasInertes.test.jsx`: o objeto de permissões da sessão de atividades ganhou
    `trocarCapimDaArea: false` (sem as permissões antigas, continua desligado);
  - `backend/tests/atividadeNativo.test.mjs`: as chaves públicas pinadas da atividade ganham `planejamento_id` e
    `planejamento`;
  - contagem de migrations e tabelas (75 pastas, 111 tabelas) e o espelho do schema sem a migration nova:
    `scripts/tests/deploy/premerge-migrate.test.mjs` (contagens, posições `NOMES.at(-N)`, B1, B41a/B41k e o bloco
    novo B42a/B42b/B42k; B42k parte das 74 de produção, a última a `20261121100000_atividade_campos_por_tipo` com o
    checksum `9e6487ff…2a58`), `preflight-schema.test.mjs` (as 3 colunas exigidas), `backend/tests/diaDaD223.mjs`
    (`schemaSemReforma`, composto sobre o espelho da Entrega 2), `categoriaManejoCadcategoriaMigration`,
    `estoqueEntradasMotivosMigration`, `patrimonioSimplificaMigration` (111 tabelas e a lista do RLS),
    `sqlEditorBootstrap` (111; no SE-07c a primeira FK violada pode ser `Atividade` ou `AtividadeArea`, porque o laço
    das FKs não tem ORDER BY e a tabela nova mudou a ordem do catálogo), os ensaios `scripts/dev/ensaio-*.mjs` e os
    scripts do editor SQL (`scripts/ops/sql-editor/01..04`: 96 tabelas do tenant, 111 no total, `PlanejamentoArea` e
    `Planejamento` antes de `Atividade` na ordem de apagar); `helpers.mjs` limpa as tabelas novas depois de
    `Atividade`.
- **Resultados (2026-11-21, nesta branch, PostgreSQL local `maike_e3`):** ver §4.1.

### 4.1 Resultados

- `npm run test:backend` (194 arquivos, PostgreSQL local, com `FRONTEND_ORIGINS=http://localhost:5173` e
  `MAIKE_TESTE_AGORA=2027-06-15T15:00:00.000Z`; `prisma validate`, `generate` e as migrations pelo runner de deploy
  antes): **2646 testes, 2640 passaram, 0 falharam, 6 todo** (exit 0). A renumeração da decisão (D-PROD-270 →
  D-PROD-275) entrou durante a rodada e mudou só números em comentários e mensagens (diff conferido palavra a palavra).
- `node --test backend/tests/atividadeReforma.test.mjs`: 20 / 20; `atividadeCamposPorTipo.test.mjs` (o fingerprint
  da Entrega 2): 24 / 24.
- `node scripts/gates/verify-all.mjs --pular=test:backend`: **TODAS AS ETAPAS PASSARAM** (38 etapas PASS,
  `test:backend` pulada; `test:gates` 1061 / 1061; `test:smoke` 315 arquivos, 3941 testes, 0 falhas; lint 0 erros
  (2 avisos antigos em `CategoriasManejo.jsx` e `Produtos.jsx`, fora desta entrega); `gate:types` 374 diagnósticos,
  sem regressão sobre o teto 625; `typecheck:backend` limpo; build e build:admin ok).
- `node --test scripts/tests/deploy/*.test.mjs`: 333 testes, 333 passaram (também dentro do `test:gates`).
- `npx vitest run` nos smokes da área (8 arquivos, incluindo `reformaPastagem`, `lancamentoAtividades`,
  `registroDeCampo*` e `permissoesAntigasInertes`): 178 / 178.
- Ensaio do caminho B do runbook num banco local separado (`maike_e3_rb`): ver o runbook §3.

## 5. Telas (harness com os componentes reais e backend falso)

`registro-shots/out-entrega3/` no scratchpad da sessão, em 390 px (celular) e 1440 px (desktop):
`e3-planejar-*` (a escolha Reforma de pastagem / Um serviço), `e3-reforma-form-*` (os 4 campos, a renovação, a safra e
o nome sugerido; `-celular-2` é o fim do formulário no celular), `e3-faz-parte-*` (a Nova realização com "Faz parte de"
marcada), `e3-lista-reforma-*` (a pílula Reforma e a barra: R$ 18.240,00, R$ 456,00/ha, 40 ha, 4 serviços, por tipo e
em ordem de data), `e3-concluir-reforma-*` (a pergunta "Trocar o capim da área para MOMBAÇA?") e
`e3-area-em-reforma-*` (o Detalhes da área com "Em reforma desde 01/09"). Os números do mock são coerentes entre as
telas.

## 6. Pontos em aberto

- **A FK de `Atividade` é só pelo tenant** (a allowlist EXPAND); a mesma fazenda é garantida pela API. Uma FK com
  `empresa_id` pediria uma migração CONTRACT ou uma mudança na allowlist.
- **Serviço que continua e já está noutra reforma** (mesmo concluída) fica com ela ("mantida_outra"); a tela mostra a
  dela. Mudar a ligação de um serviço não existe nesta entrega.
- **Editar a reforma** (áreas, capim, início) e **reabrir** a concluída/cancelada não existem; atividades antigas não
  são ligadas a reforma nenhuma (a consulta do runbook §2.1 conta quantas existem por tipo).
- **Área**: o servidor aceita qualquer área ativa da fazenda; a tela tira as de infraestrutura da escolha (como a Nova
  realização).
- **Criar a reforma não tem chave de idempotência** (um duplo clique é evitado na tela; um reenvio depois de timeout
  cria outra, que pode ser cancelada).
- **OUTRO** usa o prefixo "Planejamento" no nome; **FORMACAO**, "Formação".
- A troca do capim pede o editar do Cadastro do Mapa; sem ele, só "Não, só concluir".
- `gate:types`: sem regressão; o teto não foi baixado (`--update` não rodado).
- **Fora de escopo (próximas):** planejar cada serviço com data, insumo e custo previsto ("Planejada"); "Conferir
  nascimento"; o aviso do 1º pastejo; offline.
