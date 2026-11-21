MAIKE-ENTREGA2 (D-PROD-269) · `claude/tipo-tarefa-drop-colunas-1aznvv` · PR #354

# MAIKE — Entrega 2: os campos de cada tipo na "Nova realização"

Decisão: [D-PROD-269](./DECISIONS.md) · Proposta aprovada (Parte 1, itens B, D, E e G):
[`MAIKE-PROPOSTA-REFORMA-E-VARIOS-DIAS.md`](./MAIKE-PROPOSTA-REFORMA-E-VARIOS-DIAS.md) · Pesquisa:
[`MAIKE-PESQUISA-OPERACOES-CAMPO.md`](./MAIKE-PESQUISA-OPERACOES-CAMPO.md) · Runbook:
[`MAIKE-ENTREGA2-CAMPOS-POR-TIPO-RUNBOOK-RELEASE.md`](./MAIKE-ENTREGA2-CAMPOS-POR-TIPO-RUNBOOK-RELEASE.md) · Entrega anterior:
[Serviço de vários dias (D-PROD-267)](./MAIKE-VARIOS-DIAS-REPORT.md).

**Com migration EXPAND** (`20261121100000_atividade_campos_por_tipo`), testada só no PostgreSQL local. Ordem da
release: **aplicar a migration (com o GO do proprietário) e depois fazer o merge**. Nada foi aplicado em produção.

## 1. Banco

| O quê | Onde |
|---|---|
| Tabela nova `AtividadePlantio`, 1 para 1 com a atividade: `cultura_id` (o capim, obrigatório), `consorcio_cultura_id`, `forma_plantio` (CHECK `A_LANCO`, `EM_LINHA`, `AEREA`, `MUDA`), `semente_incrustada`, `cobertura`; FKs compostas pelo tenant e pela fazenda (RESTRICT), CHECK consórcio ≠ capim, uniques e índices começando por `cliente_id`, RLS | tabela nova |
| `local` VARCHAR(120) — onde foi o serviço sem área | `Atividade` |
| `numero_receituario` VARCHAR(40) | `AtividadeApontamento` |
| `vc_percentual` DECIMAL(5,2) — VC % do saco de semente | `AtividadeApontamentoProduto` |
| `carencia_dias` INTEGER — carência da bula | `Produto` |
| `alvo` VARCHAR(60) — alvo da Aplicação | `TipoAtividade` (a operação) |

As 5 colunas são anuláveis e sem DEFAULT; sem CHECK (a allowlist EXPAND recusa CHECK em tabela antiga), a API confere
forma e faixa. Nenhuma linha muda; nada é semeado. Checksum `9e6487ffddb92a35945c675c1924f363c3396e97dac52e56e8d3c94c20a32a58`,
pinado em `MIGRATIONS_APROVADAS`; o bloco RLS pinado em `DO_RLS_APROVADOS`. O preflight de schema do deploy passou a
exigir as 6 colunas novas. "Quantidade feita + unidade" **não** precisou de coluna: usa a produção do dia
(`quantidade_produzida_dia`) e a unidade da atividade (`unidade_producao_sigla`), que já existiam.

## 2. Por tipo

**Plantio de pastagem** (o valor no banco continua `PLANTIO`; só o rótulo mudou, no servidor e na tela)

- **Capim plantado**, obrigatório, do Cadastro de Culturas da fazenda (só os ativos; a espécie aparece embaixo). Sem
  ele, a tela não salva e o servidor responde 400; capim de outra fazenda, inexistente ou inativo → 422.
- Opcionais: **Forma de plantio** (A lanço, Em linha, Aérea, Muda), **Semente incrustada**, **Plantio de cobertura** e
  **Junto com** (o consórcio, outra cultura do cadastro; igual ao capim → 400).
- **Capim diferente abre outra atividade**: a busca da atividade aberta só acha plantio do mesmo capim. Continuar a
  atividade só completa o que estava vazio (nunca sobrescreve o que já foi gravado).
- **VC %** na linha da semente (no editor do insumo): 0 < VC ≤ 100, até 2 casas. A linha mostra "VC 50% · 500 pontos de
  VC/ha" (VC × kg/ha). Sem insumo lançado, o aviso **"Sem semente, não dá para calcular kg/ha."** (só aviso; salva).

**Safra automática**

- O servidor calcula a safra quando ela não vem: atividade nova de Plantio, de Fertilização ou de operação com
  `exige_safra`, ano agrícola de **1º de julho a 30 de junho**, formato **"2026/27"** (30/06/2027 → 2026/27;
  01/07/2027 → 2027/28). Na tela, a **Safra** é só leitura ("preenchida pela data"); o campo manual saiu.
- **Fingerprint igual ao de antes** quando os campos novos não vêm (a safra é calculada depois do fingerprint): provado
  em teste reconstruindo a fórmula antiga, inclusive numa Fertilização com a safra do servidor.

**Aplicação**

- **Alvo** no cadastro da operação (lista curta: Mato (folha larga), Dessecar tudo (reforma), Cigarrinha, Formiga,
  Cupim, Lagarta, ou "Outro (escrever)"); na Nova realização, só leitura ("vem do cadastro da operação"); sem alvo,
  o campo diz onde cadastrar.
- **Nº do receituário**, opcional, gravado no apontamento de cada área.
- **Pasto liberado em** = (término ?? dia) + a **maior carência** dos produtos escolhidos, na tela e na resposta do
  servidor (`pasto_liberado_em`, `carencia_dias`); sem carência cadastrada, nada (não se inventa prazo).
- **Carência (dias)** no Cadastro de Produtos (0 a 365, vazio limpa); a opção do produto no lançamento traz a carência.

**Manutenção**

- **Área opcional** ("Nenhuma área"). Sem área, **Local** obrigatório (ex.: "DIVISA NORTE", em maiúsculas).
- **Quantidade feita + unidade** (KM, M, UNIDADES) quando a operação não tem unidade de produção; com unidade na
  operação, vale a dela. Unidade diferente da do serviço → 422. Com várias áreas, a quantidade é repartida pelos hectares.
- Sem área, o serviço é achado pela operação e o **mesmo local** (outro local abre outra atividade); a trava, o
  "parado há mais de 30 dias" e o "Como fica depois de salvar? Concluída" valem igual (D-PROD-267). A lista mostra o
  local na coluna Área.

**Outros**: o mesmo da Manutenção (área opcional, Local obrigatório sem área), sem a quantidade feita.

**Lista de referência de capins**: o Marandu passa de 25/15 para **35/20** e entram Ipyporã 35/20, Integra 35/25,
Tamani 50/25, Quênia 65/35, Tupi 20/10 e Estilosantes Campo Grande (sem altura: o Doc 397 não traz), da Tabela 2 do
Doc 397. Só a referência mudou: o comando "Incluir lista de referência" continua pulando a cultura que a fazenda já tem
pelo nome. **Nenhuma linha de fazenda foi reescrita.** Quantas linhas de produção ficam diferentes: a consulta só de
leitura do runbook §2.1 conta (total de Marandu, quantos diferem de 35/20, quantos ainda são a cópia intocada da
referência antiga 25/15, e as áreas ligadas a ele sem altura própria). Não foi rodada em produção (sem acesso nesta
sessão, de propósito); no banco local deu 0.

**Data no celular**: no celular (390 px) o rótulo "Data de início" cobria a data (a fonte de 16 px do celular num
campo de 38 px). O campo da Nova realização passa a 48 px **só abaixo de 768 px** (`.b1-realizacao .b1-form-embutido`
em `cadastro-base1.css`); o desktop não muda.

## 3. Servidor (resumo técnico)

- `POST /atividades/registrar`: `plantio` (objeto fechado), `numero_receituario`, `local`, `unidade_producao_sigla`
  (`KM | M | UN`) e `vc_percentual` nas linhas de insumo; todos opcionais no schema e conferidos por tipo dentro da
  transação (o tipo fixo é a `categoria` da operação). Booleanos do plantio sem coerção. O tenant vem só do
  `auth_context` (`cliente_id` no corpo → 400).
- Os campos novos entram no fingerprint só quando vêm; o registro sem área usa a versão 3 (com o local). A trava
  consultiva do registro sem área é por local.
- Resposta: `registro.local`, `registro.plantio_completado`, `registro.pasto_liberado_em`, `registro.carencia_dias`;
  a atividade pública traz `local` e `plantio` (com o capim e o consórcio resumidos); a linha de produto, `vc_percentual`.
- `PATCH/POST /produtos`: `carencia_dias`. `PATCH/POST /tipos-atividade`: `alvo`. O resumo da área traz
  `plantio_cultura_id` por atividade (a prévia "Entra em…" respeita o capim).
- `atividadeService.abrirNa` ganhou `dispensarArea` e `unidadeSemCadastro` (o "exige área" da operação não vale para
  Manutenção e Outros sem área).
- Arquivos: `atividadeRegistroService.js` (as regras), `atividadeRegistroRoutes.js`, `atividadeService.js`,
  `atividadeComum.js`, `atividadeApontamento*`, `atividadePorAreaService.js`, `atividadeOpcoesService.js`,
  `culturaService.js`, `produto*`, `tipoAtividade*`, `AppError.js`.

## 4. Tela (resumo técnico)

- Regras puras em `src/lib/camposPorTipo.js` (novo): campos por tipo, safra, pasto liberado, VC, local, corpo do plantio.
- `RegistroDeCampo.jsx`: os campos de cada tipo, as validações e o corpo; `AreasDoRegistro.jsx` (`opcional`);
  `LinhasDoRegistro.jsx` (o VC no editor do insumo); `FormularioProduto.jsx` (Carência); `FormularioTipoAtividade.jsx`
  (Alvo, só na Aplicação); portas `lancamentoAtividadePort.js`, `tipoAtividadePort.js`, `produtoNativePort.js`;
  `registroDeCampoRegras.js` (destino pelo capim e sem área); `servicoVariosDias.js` (o local na coluna Área);
  `cadastro-base1.css` (a data no celular).

## 5. Testes

- **Backend novo** `backend/tests/atividadeCamposPorTipo.test.mjs` (24 testes, Postgres real): regras puras (safra nas
  bordas 30/06 e 01/07, pasto liberado, listas); plantio (capim obrigatório, gravado 1 para 1, mesmo capim continua e
  diferente abre outra, continuar só completa o vazio, outra fazenda/outro tenant/inativo → 422, formatos → 400);
  safra (Plantio e Fertilização, a do corpo vale, Roçada não, continuar não troca); **fingerprint byte a byte o de
  antes** sem os campos novos; VC (2 casas, faixa, formatos); carência no produto e pasto liberado; receituário só na
  Aplicação; Manutenção e Outros sem área (local, unidade, mesmo local continua, outro abre, 422 da unidade, parado
  sem área, Concluída sem área, com área como sempre e quantidade repartida); alvo na operação; lista de referência
  sem alterar a cultura que a fazenda já tem; tenancy.
- **Smoke novo** `tests/smoke/registroDeCampoCamposPorTipo.test.jsx` (15 testes): cada tipo na tela real com o
  backend falso (o corpo que sai, o que não sai, VC inválido, prévia pelo capim, a altura do campo no celular, o Alvo
  da operação, a Carência do produto). O aviso de sucesso do registro sem área ("REFORMA DE CERCA registrada em
  DIVISA NORTE.") é conferido: sem a correção, o aviso lia `areas.length` de um corpo sem áreas e quebrava depois de
  salvar (os 2 testes falham sem ela).
- **Mudaram de propósito:**
  - chaves públicas pinadas ganham os campos novos: `atividadeNativo` (`local`, `plantio`),
    `atividadeApontamentoNativo` (`numero_receituario`), `atividadeLinhaProduto` (`vc_percentual`; a opção do produto
    com `carencia_dias: null`), `tipoAtividadeNativo` (`alvo`);
  - o rótulo "Plantio de pastagem": `tiposFixosAtividade` e os smokes `servicoVariosDias`,
    `registroDeCampoNovaRealizacao`, `detalhesAreaHistorico`, `tiposAtividade`;
  - a lista de referência: `culturaNativo` (17 itens, Marandu 35/20) e `areaCulturaNativa` (Marandu 35/20);
  - a contagem de migrations e tabelas (73 pastas, 106 tabelas) e o espelho do schema sem a migration nova:
    `premerge-migrate` (posições `NOMES.at(-N)`, B1, B39 e o bloco novo B40a/B40b/B40k), `diaDaD223.mjs`
    (`schemaSemCamposPorTipo`), `categoriaManejoCadcategoriaMigration`, `estoqueEntradasMotivosMigration`,
    `patrimonioSimplificaMigration`, `sqlEditorBootstrap`, os ensaios `scripts/dev/ensaio-*.mjs` e os scripts do
    editor SQL (`scripts/ops/sql-editor/01..04`); `helpers.mjs` limpa a tabela nova;
  - `patrimonioP1Seguranca` (S8, o "schema antigo" numa transação desfeita): a `AtividadePlantio` sai antes da
    `Atividade`, como a `AtividadeArea`; no ensaio do Patrimônio simplificado (`ensaio-patrimonio-simplifica.mjs`), a
    impressão das tabelas que ficam deixa de fora `Produto.carencia_dias` e `TipoAtividade.alvo` (posteriores, como as
    da D-PROD-216/223) e o retrato das linhas de `Produto` compara a linha sem a coluna nova e conta as linhas em que
    ela veio preenchida (tem de ser 0);
  - `preflight-schema` (as 6 colunas exigidas).
- **Resultados (2026-11-21, nesta branch):**
  - `npm run test:backend` (189 arquivos, PostgreSQL local, com `FRONTEND_ORIGINS=http://localhost:5173` como na CI):
    **2577 testes, 2571 passaram, 0 falharam, 6 todo** (exit 0; `prisma validate`, `generate` e `deploy:migrate`
    antes). Sem a variável de CORS, os 3 testes P4B de `transporteNativo` falham por ambiente (com ela, 20/20).
  - `node scripts/gates/verify-all.mjs --pular=test:backend`: **TODAS AS ETAPAS PASSARAM** (38 etapas PASS, `test:backend`
    pulada; `test:smoke` 310 arquivos, 3879 testes, 0 erros; lint 0 erros; `gate:types` sem regressão).
  - `node --test scripts/tests/deploy/*.test.mjs`: 330 testes, 330 passaram (também dentro do `test:gates`).

## 6. Telas (harness com os componentes reais e backend falso)

`registro-shots/out-entrega2/` no scratchpad da sessão, em 390 px (celular) e 1440 px (desktop):
`e2-plantio-*` (capim, safra, forma, chaves, consórcio, VC na linha), `e2-plantio-sem-semente-*` (o aviso),
`e2-aplicacao-*` (alvo, receituário, pasto liberado), `e2-manutencao-*` (Nenhuma área, Local, Quantidade feita + KM),
`e2-outros-*`, `e2-datas-*` (o rótulo da data no celular) e `e2-culturas-*` (a lista de referência nova).

## 7. Pontos em aberto

- **Outras alturas da lista contra o Doc 397** não foram mudadas (o pedido era o Marandu): Xaraés 30/15 (Doc 40/20),
  Piatã 35/20 (40/20), Paiaguás 30/15 (35/20), Decumbens 20/10 (30/15), Mombaça 90/45 (90/40), Zuri 75/35 (80/40),
  Tanzânia 70/35 e Massai 55/25 iguais. Os capins novos nascem **sem dias de descanso** (a fonte não traz).
- **Pontos de VC:** a tela usa VC × kg/ha (50% × 10 kg/ha = 500 pontos); a maquete V4 mostrava "5,0 pontos" para o
  mesmo exemplo (kg de semente pura viável por ha). Confirmar com o proprietário qual número ele quer ver.
- **Plantios abertos sem capim** (de antes) não são continuados pelo registro novo: o próximo plantio abre outra
  atividade, com o capim. A consulta do runbook §2.1 conta quantos existem.
- **VC** só entra pelo registro de campo (as rotas de linha avulsa não o editam). **Receituário** só na Aplicação;
  **local** só sem área.
- O alvo nasce vazio nas operações de Aplicação que já existem: o proprietário preenche no cadastro da operação.
- **Próxima entrega:** agrupador de Reforma e "Faz parte de: Reforma"; "Conferir nascimento" (estande); o aviso do
  1º pastejo (item F da proposta).
