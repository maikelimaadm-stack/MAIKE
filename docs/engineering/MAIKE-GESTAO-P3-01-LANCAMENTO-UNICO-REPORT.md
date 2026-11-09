# MAIKE — Gestão P3-01: Central Única de Lançamentos gerenciais (D-PROD-154)

| Campo | Valor |
|---|---|
| Missão | MAIKE-GESTAO-P3-01 |
| Decisão | [D-PROD-154](./DECISIONS.md) (autorização explícita do proprietário, 2026-11-08) |
| PR | #230 (**draft**), branch `claude/maike-gestao-p3-01-lancamento-unico` |
| Base | `origin/main` `7ab43f7f` (merge da PR #227, Gestão P2) |
| HEAD deste relatório | código em `b403845e` (CI `verify:all` verde); este relatório entra no commit seguinte, só de documentação |
| Runbook de release | [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md) — **não executado** |

> **Provas.** Todo número dos §7–§8 é saída real de comando, registrada nos logs
> citados. Nada foi medido em Preview nem em produção: as provas são locais
> (PostgreSQL 16 descartável, Playwright local) e do CI da PR.

## 1. Pedido e escopo

O proprietário pediu o passo seguinte aos cadastros da P1 (D-PROD-146) e da P2
(D-PROD-153): registrar compras, vendas, despesas e receitas num lugar só, com
vencimentos, baixa manual e a mercadoria entrando e saindo do estoque sem uma
segunda tela. O contrato técnico é o SPEC da missão; a §8 dele (decisões
pós-crítica) prevalece sobre o resto.

**Entra (delimitado, SPEC §8.8):**

| Peça | O que é |
|---|---|
| Documento | `OperacaoFinanceira`: PAGAR \| RECEBER × COM_PRODUTOS \| SEM_PRODUTOS × AVISTA \| PRAZO \| PARCELADO |
| Itens | 1..200, só em COM_PRODUTOS: MERCADORIA (produto + local + KG/SACO) ou SERVICO (descrição, UN, sem estoque) |
| Rateio | **global** do documento, 1..50 linhas: natureza analítica + centro de custo e de resultado opcionais |
| Títulos | uma linha por parcela; soma exata do total |
| Liquidação | **manual**, registrada pelo usuário, com estorno em tabela própria |
| Estoque | integração mínima por comando composto: entrada na compra confirmada, saída FIFO na venda confirmada, estorno no cancelamento |
| Perfil financeiro | país, moeda e locale da empresa (onboarding obrigatório) |

**Fica fora** (continua proibido sem nova decisão do proprietário): conciliação
bancária; bancos, contas bancárias e OFX; módulo de caixa/bancos; DRE; plano de
contas; fiscal, tributos e NF-e/XML; câmbio e conversão de moeda; contabilidade;
rateio por item; pedido de compra; relatórios e dashboards financeiros; ERP amplo.
`QUITADO` quer dizer "liquidação registrada pelo usuário", **não** confirmação
bancária.

**Escopo do produto:** `config/mapa-manejo-scope.json` ganhou só
`LancamentosFinanceiros` em `allowedPages` (22 páginas). `forbiddenDomains` e
`forbiddenBase44Entities` não mudaram: `Financeiro`, `LancamentoFinanceiro`,
`ContasFinanceiras`, `CaixaBancos`, `FormasPagamento`, `MovimentacoesEstoque`,
`LancamentoProdutosEstoque` e os demais continuam proibidos. O menu
`ges-lancamentos-financeiros` ("Lançamentos Financeiros", plural) fica no grupo
`gestao-rural`; `vercel.json` foi regenerado pelo script de sincronização.

**Governança tocada:** nota de expansão na
[Constituição](../constitution/00-CONSTITUICAO.md), nota em
[07-DO-NOT-DO](../constitution/07-DO-NOT-DO.md), [README_AI](../../README_AI.md),
notas posteriores na D-PROD-08 e na D-PROD-153, [CURRENT-STATE](./CURRENT-STATE.md)
(missão ativa e DBT-04), [ROADMAP](./ROADMAP.md) e a matriz
[R2/R3 de permissões](./MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md).

## 2. Modelo e migration

Migration `20261109100000_gestao_p3_01_central_lancamentos`, **expand-only**: só
`CREATE TABLE`/`INDEX`/FK/CHECK nas 8 tabelas novas e um bloco DO de RLS/REVOKE.
Zero `ALTER` em tabela antiga, nenhum dado migrado, nenhum enum Prisma
(VarChar + CHECK), nenhum índice parcial, nenhuma autorreferência.

| Tabela | Papel | Colunas | Uniques | Índices | FKs | CHECKs |
|---|---|---:|---:|---:|---:|---:|
| `PerfilFinanceiroEmpresa` | país, moeda e locale (1 por empresa) | 9 | 2 | 0 | 2 | 3 |
| `OperacaoFinanceira` | cabeçalho do documento | 33 | 5 | 3 | 6 | 14 |
| `OperacaoFinanceiraItem` | itens; ids do lote e dos movimentos gerados | 22 | 6 | 3 | 7 | 4 |
| `OperacaoFinanceiraConsumoLote` | fatias FIFO de uma saída | 9 | 2 | 1 | 3 | 1 |
| `OperacaoFinanceiraRateio` | rateio global (natureza + centros) | 17 | 2 | 1 | 5 | 2 |
| `TituloFinanceiro` | uma linha por parcela | 15 | 3 | 3 | 3 | 6 |
| `LiquidacaoFinanceira` | baixa manual, fato imutável (só INSERT) | 12 | 3 | 0 | 3 | 2 |
| `LiquidacaoFinanceiraEstorno` | estorno de uma baixa (no máximo 1 por baixa) | 10 | 2 | 1 | 4 | 1 |
| **Total** | | **127** | **25** | **12** | **33** | **33** |

Cada tabela tem ainda a sua PK (8). Contagens tiradas do `migration.sql`.

- **FKs:** toda FK inclui `cliente_id` (composta quando aponta para tabela do
  tenant); todas `ON DELETE RESTRICT`; `ON UPDATE CASCADE`, menos as duas do
  rateio que carregam direção e tipo (`ON UPDATE RESTRICT`). Itens, rateios e
  títulos herdam a empresa do documento pela FK `(cliente_id, empresa_id,
  operacao_id)`. O estorno aponta para a baixa do **mesmo** título pela FK
  `(cliente_id, empresa_id, titulo_id, liquidacao_id)`. Tabelas antigas
  referenciadas (11): `Cliente`, `Empresa`, `Usuario`, `Fornecedor`, `Produto`,
  `LocalEstoque`, `MovimentacaoEstoque`, `EstoqueLoteNota`, `NaturezaFinanceira`,
  `CentroCusto` e `CentroResultado`. Nenhuma tabela antiga aponta para as novas.
- **CHECKs (nomes ≤ 63 bytes):** domínios fechados (situação, direção, conteúdo,
  condição, modo de rateio, tipo de item, unidade, método); valores (`> 0`,
  `≥ 0`, `valor_total = valor_bruto − valor_desconto + valor_acrescimo`,
  `valor_liquidado ≤ valor` e coerente com a situação do título); forma exata de
  MERCADORIA e de SERVICO; PAGAR → DESPESA / RECEBER → RECEITA no rateio;
  `documento_chave_ativa` preenchida só em CONFIRMADO; motivo não vazio.
- **Uniques:** `(cliente_id, id)` em todas e os alvos das FKs compostas;
  `(cliente_id, numero)`; um perfil por empresa; ordem única por documento; cada
  lote e cada movimento gerado (entrada ou estorno) ligado a no máximo um item; um
  estorno por baixa (`(cliente_id, liquidacao_id)`); duplicidade documental por
  `(cliente_id, empresa_id, direcao, parceiro_id, documento_chave_ativa)` (NULLs
  distintos, sem índice parcial).
- **Índices (12):** keyset da lista `(cliente_id, empresa_id, createdAt, id)` e
  por situação; filhos por documento (itens e títulos); títulos por situação e
  vencimento; rateio por natureza; estorno por título; e os que servem às
  checagens de exclusão e às FKs (documento e título por parceiro, item por
  produto e por local, fatia por lote). Todo índice e unique começa por
  `cliente_id` (`gate:indices`).
- **RLS:** o bloco DO tem o mesmo corpo da P2, com a lista das 8 tabelas:
  `REVOKE ALL` de `anon`/`authenticated`, RLS ligado sem FORCE e política
  `maike_backend_all` só para `maike_vercel`. No PostgreSQL local: RLS ligado e
  zero grants públicos nas 8 tabelas (matriz de segurança).
- **Pinagem:** SHA-256 do arquivo
  `69def1b65a43842270533f08485dd104ef5f2f864035a9976b743101e295bdb7` em
  `MIGRATIONS_APROVADAS`; hash do DO
  `0289125dfdf6df7bccc8ca070208a4c9d1bf948fad1b341ae4d443e9f13ab4fe` em
  `DO_RLS_APROVADOS` (`scripts/deploy/premergeMigrateLib.mjs`). Reconferidos na
  redação deste relatório: `sha256sum` do arquivo e `classificarMigrations` →
  `expand: true`, 8 tabelas novas, 0 colunas em tabela antiga, 0 violações.
- **Banco limpo local:** 70 tabelas, `prisma migrate diff --exit-code` = 0. Os
  scripts do editor SQL (01–04) passaram de 62 para 70 tabelas, e o `LOCK TABLE`
  dos scripts 02 e 04 passou a incluir as 4 tabelas da P1/P2 (lacuna antiga).
- **Reversão operacional:** ver runbook §9. Não executada.

## 3. Motor de estoque e invariantes

`backend/src/modules/estoqueFisico/estoqueFisicoMotor.js` é a única porta de
efeito físico do lançamento. Recebe a transação, nunca abre uma, e trabalha em
Decimal.

- **Unidade:** estoque interno sempre em KG. `kg = ROUND_HALF_UP(quantidade ×
  fator_kg, 4)` é calculado uma vez no planejador (SACO usa `peso_por_saco_kg`) e
  vale para item, lote, movimento, `estoque_atual`, fatia e estorno.
- **Entrada (compra confirmada):** cria `EstoqueLoteNota` (custo/kg =
  `ROUND_HALF_UP(valor_total do item / kg, 4)`) e um `MovimentacaoEstoque`
  "Entrada" com `origem_sistema = 'operacao_financeira'`, data
  `${dia}T12:00:00.000Z` e exclusão bloqueada fora dessa origem;
  `estoque_atual` sobe por `increment`. `preco_custo` não é tocado.
- **Saída FIFO (venda confirmada):** lotes `Disponivel` com saldo > 0 do
  produto, local **e empresa**, na ordem `COALESCE(data_documento, createdAt)` e
  `id` (a mesma do `fifoEstoque.js`). Grava as fatias, um movimento "Saída" a
  **custo** FIFO (nunca o preço de venda) e `estoque_atual` por `decrement`
  conferido ≥ 0. Falta de saldo → 422 `ESTOQUE_SALDO_INSUFICIENTE`
  (`saldo_lote_insuficiente` ou `estoque_atual_insuficiente`), nada gravado.
- **Estornos (cancelamento):** compra só com lote intocado (senão 409
  `ESTOQUE_JA_CONSUMIDO`); venda devolve cada fatia ao seu lote, recusando lote
  `Estornado`. O movimento de estorno fica ligado ao original (pai/filho) e o
  original vira `Estornada`.
- **Itens repetidos** (mesmo produto e local) são processados em sequência,
  relendo o estado; a prévia simula na mesma ordem.
- **Ordem global de travas (SPEC §8.4), para todos os fluxos:** cabeçalho
  (`FOR UPDATE`; `FOR SHARE` em liquidar/estornar) → produtos (advisory lock +
  trava da linha do `Produto`, em ordem crescente de id) → títulos (`FOR UPDATE`
  ordenado) → lotes/movimentos (compare-and-set) → sequências. Transações:
  confirmar/cancelar `{ maxWait: 10000, timeout: 30000 }`, rascunho
  `{ maxWait: 10000, timeout: 20000 }`. Deadlock, serialização e expiração →
  409 `CONCURRENCY_CONFLICT`, seguro repetir com o mesmo `operation_id`.
- **Regressão corrigida na mesma PR:** a saída da suplementação e a transferência
  entre locais passaram a usar a mesma trava do produto (e a suplementação grava
  `estoque_atual` por `decrement`). Sem a trava, o teste de corrida suplementação
  × venda falhou 3 de 3 vezes; com ela, passa.
- **Política de local tenant-global (declarada):** `LocalEstoque` é do tenant e
  compartilhado entre as empresas; o saldo de um local é sempre filtrado pela
  `empresa_id` dos lotes e nunca soma empresas.
- A revisão adversarial achou problemas de duração de trava e de ordem
  (CONCORRENCIA-2/4, ESTOQUE-2/3) e um de kg replanejado (ESTOQUE-1): §7.4.

## 4. Regras financeiras

- **Dinheiro:** backend em `Prisma.Decimal.clone({ precision: 50, rounding:
  ROUND_HALF_UP })` (`decimalFinanceiro.js`, sem `Decimal.set` global); JSON com
  valores em string canônica e padrão por campo (dinheiro `^\d{1,14}(\.\d{1,4})?$`,
  quantidade 4 casas, preço 6, percentual 6). Casas além das da moeda → 400
  `casas_decimais_excedidas` (sem arredondar em silêncio). Acima do que as
  colunas guardam → 422 `OPERACAO_VALORES_INVALIDOS` (`valor_excede_limite`,
  `valor_excede_limite_estoque`), nunca 500. O hook `preValidation` das rotas
  recusa número onde se espera texto (400 `valor_deve_ser_texto`/`tipo_invalido`,
  em todos os níveis), porque o Fastify coage tipos. O front faz as contas em
  BigInt de unidades mínimas, com os mesmos vetores do backend
  (`7984815747.9459 × 219.522662` → `1752848008568.60`).
- **Totais:** item = `ROUND_HALF_UP(quantidade × valor_unitario, casas)`, zero →
  422; bruto = Σ itens (COM_PRODUTOS) ou informado (SEM_PRODUTOS); total = bruto
  − desconto + acréscimo > 0. Rateio e parcelas são sempre sobre o total.
- **Rateio:** natureza ativa, analítica e do tipo da direção; centros ativos e
  opcionais (o vínculo N:N da P1 não é exigido); linha repetida → 422
  `linha_duplicada`. Modo VALOR: soma exata (422 `OPERACAO_RATEIO_INVALIDO`
  `soma_diferente`, com esperado/informado/diferença). Modo PERCENTUAL: soma 100;
  cada linha recebe o piso na escala, e o resto vai 1 unidade mínima por vez às
  linhas de maior resto, empate pela menor ordem; linha zerada → 422
  `valor_linha_zero`.
- **Parcelas:** AVISTA = 1, vencimento = emissão; PRAZO = 1, vencimento ≥
  emissão; PARCELADO = 2..120, vencimentos não decrescentes e ≥ emissão; soma
  exata; violação → 422 `OPERACAO_PARCELAS_INVALIDAS`. No rascunho ficam
  `PREVISTO` (não são obrigação); a confirmação os promove a `ABERTO`.
- **Liquidação e estorno:** só título `ABERTO`/`PARCIAL` de documento confirmado
  (senão 409 `TITULO_NAO_LIQUIDAVEL`); valor ≤ saldo (422
  `LIQUIDACAO_EXCEDE_SALDO`); método permitido pelo perfil; data ≤ hoje da
  fazenda. `valor_liquidado` e a situação são recalculados a partir dos fatos, sob
  trava. Estorno: um por baixa (unique + checagem sob trava), com motivo, datado
  com o hoje da fazenda; segundo estorno → 409 `LIQUIDACAO_JA_ESTORNADA`.
  `baixa_no_ato` só em AVISTA (400 `baixa_no_ato_so_avista`) e exige também a
  ação `liquidar`.
- **Cancelamento:** só CONFIRMADO; trava todos os títulos antes de conferir; com
  baixa ativa → 409 `OPERACAO_COM_LIQUIDACOES`; estorna o estoque; títulos →
  `CANCELADO`; o motivo fica no documento e a auditoria só registra
  `motivo_informado`.
- **Duplicidade documental:** mesmo documento, parceiro e direção já CONFIRMADO
  na empresa → 409 `OPERACAO_DOCUMENTO_DUPLICADO` (trava na chave do documento;
  a unique é a rede).
- **Moedas, PIX e locales:** catálogo fechado em código — BRL, USD, EUR, ARS e
  UYU (2 casas), PYG e JPY (0), KWD (3); países BR, AR, PY, UY, US, PT, ES, JP e KW
  (metadado, sem efeito fiscal); locales pt-BR, pt-PT, es-AR, es-PY, es-UY, es-ES,
  en-US e ja-JP (o front formata com algarismos latinos). PIX só com BR + BRL. O
  documento copia moeda e casas do perfil na criação e nunca converte. Trocar a
  moeda com lançamento existente → 409 `PERFIL_FINANCEIRO_MOEDA_EM_USO`
  (`operacoes_existentes`); moeda ≠ BRL com lote de custo > 0, também na criação →
  mesmo código (`estoque_legado_brl`).
- **Datas e fuso:** dia civil `AAAA-MM-DD`. Exigem o fuso da empresa (409
  `EMPRESA_FUSO_NAO_CONFIGURADO`): confirmar com mercadoria ou baixa no ato,
  cancelar com mercadoria, liquidar e estornar baixa. Data operacional e data da
  baixa ≤ hoje da fazenda (422 `FINANCEIRO_DATA_FUTURA`); vencimentos podem ser
  futuros. Documento com mercadoria exige `data_operacional` e a declaração
  `efeito_fisico_confirmado: true`.
- **Auditoria por allowlist:** ids, número, empresa, situação, direção, totais em
  string, contagens e ids de efeitos; nunca descrição, observação, motivo,
  referência ou nome de parceiro. O histórico do documento sai de uma consulta só.

## 5. API e permissões

Todas as rotas usam `onRequest: [app.autenticar]` e schemas fechados
(`additionalProperties: false`). Arquivo:
`backend/src/modules/financeiro/operacaoFinanceiraRoutes.js`. Tela
`ges-lancamentos-financeiros` (`TELAS.LANCAMENTOS_FINANCEIROS`, grupo
`gestao-rural`).

| Método | Rota | Guarda (ação) |
|---|---|---|
| GET | `/perfis-financeiros-empresa` | `visualizar` |
| PUT | `/perfis-financeiros-empresa` | `adminOuIsAdmin()` |
| GET | `/operacoes-financeiras` (keyset; `empresa_id` obrigatório; direção, situação, conteúdo, parceiro, emissão de/até, vencimento de/até, `com_estoque`, `q`, `cursor`, `limit` 1..100) | `visualizar` |
| GET | `/operacoes-financeiras/:id` | `visualizar` |
| POST | `/operacoes-financeiras` (rascunho, idempotente) | `novo` ou `salvar` |
| PUT | `/operacoes-financeiras/:id` (só RASCUNHO, com `versao`) | `editar` ou `salvar` |
| DELETE | `/operacoes-financeiras/:id` (descarta só RASCUNHO) | `editar` ou `salvar` |
| POST | `/operacoes-financeiras/:id/previa` (nada gravado) | `visualizar` |
| POST | `/operacoes-financeiras/:id/confirmar` | `confirmar` (+ `liquidar` na transação, com `baixa_no_ato`) |
| POST | `/operacoes-financeiras/:id/cancelar` | `cancelar` |
| POST | `/titulos-financeiros/:id/liquidacoes` | `liquidar` |
| POST | `/liquidacoes-financeiras/:id/estorno` | `estornar_liquidacao` |
| GET | `/operacoes-financeiras-opcoes/{parceiros, produtos, locais, saldos, naturezas, centros-custo, centros-resultado}` (7 rotas) | `visualizar` |

- **Ações extras:** `confirmar`, `liquidar`, `estornar_liquidacao` e `cancelar`
  existem só nesta tela, nascem `false` e não são implícitas em
  `salvar`/`editar`. A mesma lista vive em `ACOES_LANCAMENTOS_FINANCEIROS`
  (`backend/src/shared/auth/autorizacaoTela.js`), em `EXTRA_ACTION_KEYS_BY_PAGE`
  (`src/lib/permissions.js`) e em `ACOES_EXTRAS_LANCAMENTOS`
  (`src/lib/gestaoPermissions.js`, onde `estornar` = `estornar_liquidacao`); o
  teste de paridade de `gestaoMenuPermissoes.test.jsx` lê os arquivos do
  backend. Administrador real e `is_admin` têm acesso total, como nas outras
  telas. Rota a rota: matriz R2.
- **Tenancy:** tenant só da sessão; `cliente_id` no corpo ou na query → 400;
  cabeçalho e cookie ignorados. Documento, título ou baixa de outro tenant ou
  empresa → 404 com o mesmo corpo do id inexistente; referência de outro tenant
  ou empresa → 422 `OPERACAO_REFERENCIA_INVALIDA`, igual ao id inexistente; um
  `operation_id` de outro tenant não devolve a resposta guardada dele.
- **Idempotência e concorrência:** criar, confirmar, cancelar, liquidar e estornar
  são idempotentes por `operation_id` (replay igual; corpo diferente → 409
  `IDEMPOTENCY_CONFLICT`). PUT e DELETE usam `versao` (409
  `OPERACAO_VERSAO_CONFLITO`).
- **Erros novos (18, `errorCodes.js`):** `OPERACAO_FINANCEIRA_NOT_FOUND`,
  `TITULO_FINANCEIRO_NOT_FOUND`, `LIQUIDACAO_FINANCEIRA_NOT_FOUND` (404);
  `PERFIL_FINANCEIRO_NAO_CONFIGURADO`, `PERFIL_FINANCEIRO_MOEDA_EM_USO`,
  `OPERACAO_STATUS_INVALIDO`, `OPERACAO_VERSAO_CONFLITO`,
  `OPERACAO_DOCUMENTO_DUPLICADO`, `OPERACAO_COM_LIQUIDACOES`,
  `ESTOQUE_JA_CONSUMIDO`, `TITULO_NAO_LIQUIDAVEL`, `LIQUIDACAO_JA_ESTORNADA`
  (409); `OPERACAO_RATEIO_INVALIDO`, `OPERACAO_PARCELAS_INVALIDAS`,
  `OPERACAO_REFERENCIA_INVALIDA`, `OPERACAO_VALORES_INVALIDOS`,
  `LIQUIDACAO_EXCEDE_SALDO`, `FINANCEIRO_DATA_FUTURA` (422). Reusados:
  `ESTOQUE_SALDO_INSUFICIENTE`, `EMPRESA_FUSO_NAO_CONFIGURADO`,
  `EMPRESA_NOT_FOUND`, `REQUEST_VALIDATION_FAILED`, `IDEMPOTENCY_CONFLICT`,
  `CONCURRENCY_CONFLICT`. Erro de linha traz `details.field`, `reason`,
  `colecao` e `indice`.
- **Exclusões existentes sem 403 enganoso (SPEC §8.5):** fornecedor/parceiro →
  409 `PARCEIRO_EM_USO`; produto → 409 `PRODUTO_DELETE_BLOCKED`; local → 409
  `LOCAL_ESTOQUE_DELETE_BLOCKED` (`lancamentos_financeiros_vinculados`); PATCH
  administrativo de colunas operacionais e DELETE de lote vinculado → 409
  `REGISTRO_OPERACIONAL_IMUTAVEL` (renomear `local_estoque_nome` continua
  permitido); empresa com perfil ou lançamento → 409 `EMPRESA_COM_VINCULOS`.
  Vale com rascunho, e nada é apagado.
- **CORS:** `PUT` entrou em `METODOS` (`backend/src/shared/http/corsPolicy.js`),
  achado na prova ponta a ponta (§7.3).

## 6. Interface

- **Tela única:** página fina `src/pages/LancamentosFinanceiros.jsx` e pasta nova
  `src/components/financeiroGestao/` (a pasta legada `src/components/financeiro/`
  não foi usada), no padrão Base1 (`CadastroBase1Screen`): lista em tabela no
  desktop e em cartões no celular, registro ao lado.
- **Seis seções no formulário:** (1) Tipo — PAGAR/RECEBER, com/sem produtos
  (trocar com itens pede confirmação, nunca perde itens em silêncio) e condição;
  (2) Dados gerais — parceiro paginado e filtrado pela direção, emissão, data
  operacional e a declaração "mercadoria já recebida/entregue", documento,
  histórico e método preferido ("preferência — não registra pagamento");
  (3) Itens — MERCADORIA (produto, local com saldo da empresa na venda, KG/SACO
  conforme o produto) ou SERVICO, mais desconto e acréscimo; (4) Rateio — VALOR
  (padrão) ou PERCENTUAL, 100% automático com uma linha, falta/sobra ao centavo
  em tempo real; (5) Vencimentos — à vista, a prazo ou gerador de parcelas
  (entrada opcional na emissão; resto do arredondamento na última);
  (6) Prévia e confirmação.
- **Consulta:** cabeçalho, itens com os ids de lote e movimento, rateio, títulos
  com saldo e situação, baixas (estornadas marcadas; o estorno aparece como
  "Estorno de … · motivo"), histórico de quem fez o quê e quando.
- **Diálogos:** confirmação ("N parcelas, X itens no estoque, total em títulos",
  bloqueios da prévia e, com `liquidar`, a baixa no ato); registro de
  pagamento/recebimento (valor ≤ saldo, data, método em grupo de botões,
  referência, observação e aviso "sem conciliação bancária"); ação com motivo
  (cancelar, estornar baixa, descartar rascunho). Todo `DialogContent` leva
  `data-permissao-explicita`, porque o diálogo é portal fora do invólucro da tela.
- **Envio seguro:** o `operation_id` fica guardado por (ação, empresa, alvo) até
  resposta definitiva; confirmar e cancelar têm prazo de 60 s; botão desabilitado
  durante o envio; erro de rede depois do envio → "resultado incerto —
  consultar", nunca "sucesso" sem resposta. A troca de empresa fecha o registro e
  cancela as consultas.
- **Onboarding:** sem perfil, painel "Configurar perfil financeiro da empresa"
  com padrões explicados (BR/BRL/pt-BR), só para administrador real ou `is_admin`;
  sem fuso, aviso apontando a configuração da Empresa.
- **Permissões na UI:** cada botão só aparece com a sua ação; a tela de
  Permissões mostra as 4 caixas extras só no cartão desta tela (11 caixas). Teste
  com o Layout real: o perfil `{visualizar, confirmar}` faz prévia e confirma um
  rascunho salvo, sem PUT.
- **Celular:** script visual com backend falso rotulado
  (`scripts/dev/visual-lancamentos-financeiros.mjs`): 1440/1280/768/390/320 px ×
  12 etapas, 60 capturas, sem rolagem horizontal e sem diálogo maior que a tela;
  menor alvo medido: checkbox de 20 px dentro de rótulo de 40 px. O `<select>`
  nativo é proibido (teste PAR3) e o seletor dentro de diálogo travava no
  celular, por isso o método virou grupo de botões e a edição do perfil fica no
  topo da lista. As ações do cabeçalho móvel não usam palavras da heurística; o
  "Confirmar" fica no ✓ e no diálogo. Ícone ReceiptText.
- **Bibliotecas do front:** `src/lib/dinheiroDecimal.js` (BigInt, HALF_UP,
  leitura pelo locale com `formatToParts`) e `src/lib/diaCivil.js` (dias em UTC
  sobre `AAAA-MM-DD`; "hoje" no fuso da empresa).

## 7. Defeitos achados e corrigidos

### 7.1 Na construção (script visual e testes RTL)
- Campo calculado com o rótulo sobreposto ao valor.
- `<select>` nativo (reprovado pelo PAR3).
- Seletor dentro de diálogo que não deixava escolher a opção no celular (390/320 px).

### 7.2 Matriz PostgreSQL (verificação de testes, RED → GREEN)
1. **Ciclo de travas no rascunho, contra a §8.4.** A FK do item travava o
   `Produto` na ordem do array; a confirmação trava em ordem crescente. Com itens
   em ordem decrescente, deadlock e 409. RED: POST → 409 `CONCURRENCY_CONFLICT`
   em ~1,28 s; GREEN: 201 em ~0,31 s. Correção: o rascunho (POST e PUT) trava os
   produtos em ordem crescente (`FOR KEY SHARE`) antes de gravar os itens. Onde
   essa trava fica em relação à sequência do tenant é o achado CONCORRENCIA-4
   (§7.4).
2. **Curingas na busca `q`.** `%`, `_` e `\` não eram escapados: `q=%` casava
   tudo (RED: total 21 ≠ 1). Correção: `escaparCuringasLike` (já existente) na
   lista e nas opções; o formato da API não muda.

### 7.3 Prova ponta a ponta real (tela + Fastify + PostgreSQL local, 1280 e 390 px)
1. **CORS sem PUT (backend).** O navegador barrava o PUT do perfil e do
   rascunho entre origens diferentes, e o onboarding travava. Teste P4B-04d em
   `backend/tests/transporteNativo.test.mjs`; `PUT` em `METODOS`.
2. **Tela — estorno como baixa ativa.** A linha `ESTORNO` aparecia como baixa
   nova, com botão "Estornar baixa" (que daria 404) e contando no bloqueio do
   cancelamento. Corrigido em `ConsultaLancamento.jsx`.
3. **Tela — "Nada foi gravado." na prévia** com o rascunho já salvo. Corrigido
   em `mensagemDoBloqueio` (`src/lib/gestaoErros.js`).
4. **Tela — releitura do rascunho descartado** (GET → 404 logo após o DELETE).
   Corrigido em `LancamentosFinanceirosTela.jsx`; a prova é o roteiro real (o
   jsdom não reproduz).
- **Backend falso alinhado ao contrato real** (`tests/smoke/fixtures/lancamentosFakeCore.js`),
  conferido por comparador de formas real × falso: era ele que escondia os
  defeitos 2 a 4.

### 7.4 Revisão adversarial, rodada 1 (lentes concorrência e estoque)
Os 8 achados foram reproduzidos pelo revisor com scripts próprios em banco
descartável e corrigidos no commit `c40cab00`, cada um com teste PG que falhava
antes e passa depois (`backend/tests/gestaoP3Concorrencia.test.mjs`, C1–C6). CONCORRENCIA-2 e ESTOQUE-2 têm a mesma raiz (comandos antigos com o
prazo padrão de 5 s esperando travas longas); CONCORRENCIA-4 e ESTOQUE-3 também
(rascunho segurando a sequência do tenant enquanto espera o produto).

| ID | Gravidade | Defeito | Resultado |
|---|---|---|---|
| CONCORRENCIA-1 | ALTO | A guarda da §8.5 no PATCH/DELETE de lote conta os vínculos sem trava; um PATCH concorrente sobrescreve um lote que a venda acabou de consumir (205 kg fantasmas; venda nunca mais cancelável) | Corrigido: PATCH/DELETE de lote entram no protocolo (produto → lote, `FOR UPDATE`) antes de contar vínculos; 409 `REGISTRO_OPERACIONAL_IMUTAVEL`, Σ lotes = `estoque_atual`, venda cancela (C1) |
| CONCORRENCIA-2 | ALTO | Confirmar/cancelar seguram a trava do produto e a sequência de movimentos durante todos os efeitos; suplementação, transferência, POST de movimento e PATCH de produto, com o prazo padrão de 5 s, respondem 500 | Corrigido: helper `shared/prisma/transacaoConcorrente.js` (transitórios → 409) e reserva da sequência de movimentos só no fim (número provisório + `unnest`); prazos dos comandos antigos ajustados na rodada 2 (CRITICO-1) (C2, C3) |
| CONCORRENCIA-3 | MÉDIO | PUT do perfil sem `{ maxWait, timeout }` e sem tradução de transitórios: 500 enquanto uma confirmação segura o perfil em `FOR SHARE` | Corrigido: PUT do perfil pelo mesmo helper; 200 depois da espera, um único evento de auditoria (C2) |
| CONCORRENCIA-4 | MÉDIO | `criarRascunho` reserva a sequência do tenant antes de travar os produtos (§8.4 item 5): um rascunho parado atrás de uma confirmação trava todos os rascunhos do tenant | Corrigido: produtos travados (`FOR KEY SHARE` ordenado) antes de `reservarNumero` no POST e antes de apagar filhos no PUT (C4) |
| CONCORRENCIA-5 | BAIXO | Replay do POST de rascunho depois do descarte devolve 200 com o corpo de um documento apagado | Corrigido: descarte marca o recibo `criar` como excluído; replay responde 409 `IDEMPOTENCY_EFEITO_EXCLUIDO`, com mensagem na tela (C5) |
| ESTOQUE-1 | ALTO | Confirmar recalcula o kg com o peso por saco atual, mas o item guarda o kg do rascunho; o cancelamento fica bloqueado para sempre | Corrigido: confirmar grava no item `fator_kg`, `quantidade_estoque` e `valor_total` replanejados; compra e venda cancelam depois (C6) |
| ESTOQUE-2 | MÉDIO | Suplementação e transferência (prazo padrão de 5 s) esperam travas que confirmar/cancelar seguram por até 30 s e respondem 500 | Corrigido junto com CONCORRENCIA-2 (C2) |
| ESTOQUE-3 | BAIXO | O `FOR UPDATE` no `Produto` faz o rascunho esperar na FK segurando a sequência do tenant: todo rascunho do tenant entra na fila | Corrigido junto com CONCORRENCIA-4 (C4) |

### 7.5 CI: teste dependente do pool do runner (`0549d44c`)
O C2 falhou no CI com P2024: o pool padrão do runner tem 5 conexões, e o detentor
das travas, o observador de `pg_locks` e as vítimas disputavam o mesmo pool.
Defeito do teste, não do produto. O detentor e os observadores passaram a usar um
cliente próprio do teste, e as vítimas rodam em ondas de 3. RED com
`connection_limit=5`; GREEN com 5, 3 e o pool padrão.

### 7.6 Revisão adversarial, rodada 2 (12 achados das lentes + 3 do crítico de completude)
Lentes: dinheiro, segurança, schema/ops, frontend, API e conformidade; segurança e
conformidade não acharam nada. Todos os 15 foram reproduzidos e corrigidos em
`aadba910` (backend) e `93c80fe1` (tela), cada um com teste que falha no commit
anterior e passa depois (`backend/tests/gestaoP3Rodada2.test.mjs`, C7/C8 em
`gestaoP3Concorrencia.test.mjs`, `keysetCursor.test.mjs`,
`tests/smoke/gestaoLancamentosEnvio.test.jsx` e `gestaoLancamentos.test.jsx`).

| ID | Gravidade | Defeito | Resultado |
|---|---|---|---|
| CRITICO-1 | ALTO | Com a espera longa da rodada 1, suplementação e transferência das telas antigas (20 s no navegador, chave nova a cada envio) commitavam depois do navegador desistir: o reenvio baixava o estoque duas vezes | `TRANSACAO_CURTA` (maxWait 2 s, timeout 9 s, `lock_timeout` 8 s; 55P03 → 409) nos comandos chamados pelas telas antigas: resposta definitiva antes dos 20 s; provado que a transação perdedora não commita depois; trava de 6 s ainda conclui 2xx |
| CRITICO-2 | MÉDIO | Cancelar 200 itens fazia ~2.250 idas ao banco (26 s a 10 ms/ida; a venda passava de 30 s e nunca cancelava) | `estornarEmLote`: 64 idas, 0,8 s a 10 ms/ida; equivalência provada contra as funções antigas (lotes, movimentos, `estoque_atual`, itens, fatias e recusas) |
| CRITICO-3 | BAIXO | PATCH de movimento (renomear depósito) com 5 s respondia 500 durante cancelamento longo | Mesma transação curta: 200 depois do commit, 409 acima de 8 s |
| DINHEIRO-1 | MÉDIO | Decimal lido do banco (precisão 20) na prévia/confirmação: o vetor do contrato dava …568,61 e o rascunho nunca confirmava | Conversão para o Decimal de alta precisão: …568,60 na prévia e confirmação 200 |
| DINHEIRO-2 / FRONTEND-2 | MÉDIO | Pendência de `operation_id` reaproveitada por um envio NOVO de conteúdo igual: segunda baixa ou segundo rascunho viravam replay | Chave só é repetida para o mesmo envio; envio novo igual pergunta "Enviar como novo"/"Manter"; Consultar resolve a pendência quando o efeito aparece |
| FRONTEND-1 | ALTO | Trocar de empresa cancelava as consultas da empresa nova (lista, perfil e Novo sumiam) | Cancela só as consultas da empresa anterior |
| FRONTEND-3 | MÉDIO | Aviso informativo da prévia aparecia como pendência que impede confirmar | Texto próprio por código de aviso |
| FRONTEND-4 | BAIXO | "Manter" virava erro "Nada foi gravado" e sumia o Consultar | Volta ao estado de resultado incerto, com Consultar |
| FRONTEND-5 | BAIXO | Ordenação por Total, Em aberto, Emissão e Próx. vencimento comparava texto formatado | Comparação por valor (BigInt) e por dia; sem a prop, a grade Base1 ordena como antes |
| SCHEMA_OPS-1 | BAIXO | Saldo do título agregava liquidações sem `empresa_id` (sem índice) | Filtro por `empresa_id`: o índice existente atende |
| API-1 | ALTO | `q` com caractere NUL → 500 nas 7 rotas de busca | 400 `caractere_invalido` |
| API-2 | ALTO | Cursor adulterado que passava no decodificador → 500 na listagem e nas opções (e em `/marcas`) | 400 `cursor_invalido` no decodificador compartilhado e no das opções, inclusive nos módulos antigos |
| API-3 | BAIXO | `next_cursor` das opções podia passar do teto de 512 aceito pela rota | Teto acompanha o maior cursor legítimo (2.135 → 2.200) |
| API-4 | BAIXO | Motivo só de espaços → 400 sem `field`/`reason` | 400 com `field: motivo`, `reason: obrigatorio`, nada gravado |
| Lacuna do crítico | — | Mapa Geral até 60 s com saldo velho depois de confirmar/cancelar | A tela usa o mesmo refresh/invalidação/evento das telas antigas de estoque |

Uma revisão adversarial das próprias correções (rodadas 1 e 2) não achou defeito
novo com caminho concreto.

### 7.7 Prova de uso real ampliada (`b403845e`)
`scripts/dev/e2e-lancamentos-real.mjs` (tela real + Fastify real + PostgreSQL
local, 1280 e 390 px, banco conferido a cada passo): 40 checagens, 0 divergências,
com pool de 5 e de 3. Além dos fluxos de aceite: duas baixas iguais de propósito no
mesmo título; resposta perdida → Consultar → nova baixa; "Manter"/"Repetir"/"Enviar
como novo"; troca de moeda com operação → 409 sem efeito; compra da P3 consumida pelo
comando antigo de suplementação (pela API real) com saldos exatos e cancelamento da
compra recusado sem efeito; usuário só visualizar e visualizar+confirmar; troca de
empresa pelo seletor real. Contra a tela anterior à rodada 2 o roteiro reprova
(DINHEIRO-2, FRONTEND-2, FRONTEND-1).

## 8. Testes e evidências

### 8.1 Medido durante a verificação (HEADs intermediários; não substitui o §8.2)

| Prova | Resultado registrado |
|---|---|
| 4 arquivos PG da P3 (`gestaoP3Lancamentos`, `gestaoP3Seguranca`, `gestaoP3Estoque`, `gestaoP3Financeiro`) | 62/62, 0 falhas (`--test-concurrency=1`) |
| Regressão: 20 arquivos (P1, P2, estoque, empresa, permissões R1–R4, referências, leituras) | 207/207 |
| `npm run test:backend` | 96 arquivos, 1203 testes: 1198 pass, 0 fail, 5 `todo` herdados |
| Segurança | 19 ações × 15 contas; isolamento de tenant e empresa em todas as rotas; 23 escritas diretas recusadas por CHECK/FK/unique; RLS e zero grants |
| Volume (200 itens × 120 parcelas) | POST 107 ms; prévia 27 ms; confirmar compra 1269 ms e venda 1791 ms; cancelar 3144–3253 ms (limite 30 s) |
| `npx vitest run --config vitest.config.js` | 159 arquivos, 1813 testes |
| Roteiro real `scripts/dev/e2e-lancamentos-real.mjs` | 24/24 passos (12 em 1280 px e 12 em 390 px), saída 0, 58 capturas |
| Script visual | 60 capturas, saída 0 |

O erro de lint apontado no ensaio (`_vb` sem uso em
`backend/tests/gestaoP3Financeiro.test.mjs`) já não existe em `0f0a96dc`.

### 8.2 HEAD final (`b403845e`)

| Comando | Resultado |
|---|---|
| `npm run test:backend` | Dentro do `verify:all`: 98 arquivos, 1.228 testes — 1.223 pass, 0 fail, 0 cancelados, 5 `todo` herdados |
| 4 arquivos PG da P3 (`node --test --test-concurrency=1`) | 6 arquivos PG da P3 + `keysetCursor` + `transporteNativo`: 112/112 com `connection_limit=5`; concorrência 10/10 também com `connection_limit=3` |
| `npx vitest run --config vitest.config.js` | 160 arquivos, 1.831 testes, 0 falhas |
| `node scripts/dev/e2e-lancamentos-real.mjs` (PostgreSQL local, 1280 + 390) | 40 checagens, 0 divergências, saída 0, em 1280 e 390 px, com pool de 5 e de 3 |
| `node scripts/dev/visual-lancamentos-financeiros.mjs` | 60 capturas (5 larguras × 12 etapas), saída 0, sem rolagem horizontal, menor alvo 40 px |
| Gates (`gate:product-scope`, `gate:governance-paths`, `gate:tenancy`, `gate:indices`, `gate:deploy-migrations`, `gate:supabase-public-grants`, `gate:base44`, `gate:no-secrets`, `gate:import-integrity`, `gate:native-api`, `gate:api-boundary`, `gate:admin-isolation`, `gate:source-closure`, `gate:types`) | Todos PASS (os 31 gates do `verify:all`, mais `test:gates`) |
| `npm run lint` · `npm run typecheck` · `npm run typecheck:backend` · `npm run build` | lint 0 erros (56 avisos herdados) · typecheck 815 diagnósticos (teto 1.746) · typecheck:backend 0 · build e build:admin OK |
| `npm run verify:all` (banco novo) | 39 etapas PASS, saída 0, em PostgreSQL 16 local recém-criado (`maike_p3_final`) |
| CI no HEAD `b403845e` | `verify:all` verde (run 42559110486) |

## 9. Limitações declaradas

- Desconto e acréscimo do cabeçalho não entram no custo do lote de estoque nesta
  fase; a prévia e a tela avisam.
- `saldo_antes`/`saldo_depois` dos movimentos (14,4) estouram se a soma dos lotes
  de um local passar de 10¹⁰ kg (borda não protegida).
- A busca com curingas foi corrigida só na P3; o mesmo defeito existe em módulos
  fora do escopo (marcas, locais). `q` com caractere NUL ainda dá 500 em
  `/parceiros` e `/naturezas-financeiras` (P1/P2); na P3 dá 400.
- `opcoes/saldos` mostra saldo em local inativo, mas a venda desse local é
  recusada com `local_inativo`; o SPEC não define o caso.
- Reasons raros caem na mensagem genérica do código: `cursor_invalido`,
  `fatias_inconsistentes`, `devolucao_excede_entrada`,
  `lote_indisponivel_para_devolucao`.
- Sem fuso configurado, o "hoje" do front usa o relógio do navegador, com aviso;
  quem decide é o servidor.
- O teste de paridade de permissões lê arquivos do backend e quebra, de
  propósito, se `operacaoFinanceira` ou `ACOES_LANCAMENTOS_FINANCEIROS` forem
  renomeados.
- O roteiro real cobre troca de moeda, usuário restrito e troca de empresa (§7.7),
  mas o consumo do lote da P3 pelo estoque antigo foi feito pela API real do
  comando de suplementação, não pela tela do Mapa Geral (a semente não monta
  geografia, pontos e rebanho). Ele depende de `migrate deploy` e do Playwright,
  e o banco do ensaio acumula um tenant por execução, de propósito. O CI não o roda.
- Comandos chamados pelas telas antigas esperam no máximo ~8 s por uma trava
  (`TRANSACAO_CURTA`); acima disso respondem 409 e o usuário repete. A troca é
  deliberada: resposta definitiva antes dos 20 s do navegador.
- Confirmar uma venda de 200 itens × 3 fatias com 10 ms por ida ao banco leva
  ~24,6 s (limite 30 s). O cancelamento já é em lote; a confirmação ainda é item a
  item (mesma técnica aplicável depois).
- DELETE de produto, local e parceiro seguem com o prazo padrão de 5 s.
- O `maxDuration` da função na Vercel e o pool de conexões de produção não foram
  medidos com transações de até 30 s (+10 s de espera de conexão).
- A fila offline (IndexedDB) de exclusões de Produto, Fornecedor e Local para no
  primeiro erro: comportamento anterior a esta PR, agora com gatilhos novos (409
  das §8.5), sem teste.
- O refresh do cache do Mapa depois de confirmar/cancelar foi provado em teste RTL
  (espião), não em navegador real com IndexedDB.
- No Chromium headless os campos de data aparecem como MM/DD por causa do idioma
  do navegador, não do app. A consulta mostra os ids crus de lote e movimento,
  como o SPEC pede.
- O teste S7 escreve `prisma:error` no stderr: são as escritas recusadas de
  propósito.

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Runtime novo sem as 8 tabelas responde 500 nas 12 rotas novas que as usam e nas exclusões de parceiro, produto, local e empresa e no PATCH/DELETE de lote; a Vercel publica a `main` sozinha | Migration aplicada e conferida **antes** do merge (runbook) |
| Preview da PR usa o mesmo banco de produção: depois da migration, um teste na Preview gravaria lançamento e estoque reais | Nenhuma escrita de teste na Preview (runbook §2) |
| Documento grande segura travas por segundos; com a latência real (5–10 ms por ida ao Supabase) fluxos antigos podem esperar ou recusar | Rodadas 1 e 2 (§7.4, §7.6): sequência reservada no fim, cancelamento em lote, comandos antigos com resposta definitiva (2xx ou 409) em até ~8 s |
| Divergência legada entre `estoque_atual` e a soma dos lotes (CSV, PATCH absoluto, POST de lote do admin) bloqueia venda com `estoque_atual_insuficiente` | Recusa explícita, nada gravado; correção é operacional |
| A reversão de suplementação no front ainda faz leitura-modificação-escrita de `estoque_atual` | Dívida anterior a esta PR, fora do escopo |
| Exclusão concorrente de produto, local ou parceiro ainda pode responder 403 em vez de 409 | A FK RESTRICT impede perda de dado |
| Backup/PITR nunca foi comprovado nas releases anteriores | Nesta release, sem prova → `RELEASE_BLOCKED` |
| Custo legado do estoque é BRL implícito | Moeda ≠ BRL recusada com lote de custo > 0 |

## 11. Prontidão

| Critério | Estado |
|---|---|
| **CODE_READY** (23 achados da revisão fechados; testes, gates, `verify:all` e CI verdes no HEAD final) | **SIM** — código em `b403845e`, com as limitações do §9 declaradas |
| **SCHEMA_APPLIED_PROD** | **NÃO** — nesta missão: **NÃO**. Nenhum comando foi enviado ao banco de produção e o runbook não foi executado |
| **MERGE_READY** | **NÃO** — só depois de CODE_READY, do GO do proprietário e da migration aplicada e conferida pelo runbook |

Prontidão de código não é prontidão de release. O merge manual da PR #230 é
decisão do proprietário e vem depois do schema aplicado **e** conferido.

## 12. Marcadores

Todos preenchidos com saída real (§7–§8 e §11). Nenhum ficou em aberto.

## 13. Referências

- Decisão: [D-PROD-154](./DECISIONS.md); relação com D-PROD-08, D-PROD-146 e D-PROD-153.
- Runbook: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md).
- Permissões: [`MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md`](./MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md).
- Antecessoras: [P1](./MAIKE-GESTAO-CADASTROS-P1-REPORT.md) e [P2](./MAIKE-GESTAO-CADASTROS-P2-NATUREZAS-REPORT.md).
- Migration: `backend/prisma/migrations/20261109100000_gestao_p3_01_central_lancamentos/migration.sql`; pinagem em [`premergeMigrateLib.mjs`](../../scripts/deploy/premergeMigrateLib.mjs).
- Backend: `backend/src/modules/financeiro/` e `backend/src/modules/estoqueFisico/estoqueFisicoMotor.js`.
- Testes: `backend/tests/gestaoP3Lancamentos.test.mjs`, `gestaoP3Seguranca.test.mjs`, `gestaoP3Estoque.test.mjs`, `gestaoP3Financeiro.test.mjs`, `gestaoP3Concorrencia.test.mjs`, `gestaoP3Rodada2.test.mjs`, `gestaoP3Cenario.mjs`; `tests/smoke/gestaoLancamentos.test.jsx`, `gestaoLancamentosEnvio.test.jsx`, `gestaoLancamentosShell.test.jsx`, `gestaoLancamentosDinheiro.test.js`.
- Scripts: [`visual-lancamentos-financeiros.mjs`](../../scripts/dev/visual-lancamentos-financeiros.mjs), [`e2e-lancamentos-real.mjs`](../../scripts/dev/e2e-lancamentos-real.mjs), [`e2e-lancamentos-seed.mjs`](../../scripts/dev/e2e-lancamentos-seed.mjs).
