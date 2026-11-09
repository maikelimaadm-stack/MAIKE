# MAIKE-PATRIMONIO-P1-01 — Cadastros patrimoniais, frota e parâmetros operacionais

Decisão: **D-PROD-157** ([`DECISIONS.md`](./DECISIONS.md)). Base: `main` `e4e907ea` (P3-02 mergeada, PR #231), integrada na R2 por merge não destrutivo; a base original era `f2b81e1b` (P3-01, PR #230).
Branch: `claude/maike-patrimonio-p1-01-cadastros-inventario` · PR #232 (draft).

## 1. O que entra e o que fica fora

**Entra:** domínio nativo Patrimônio e Frota, só cadastros:
- catálogos do tenant: famílias (natureza fechada), tipos (subtipos da família, com perfis de medição sugeridos), perfis de medição e combustíveis; catálogo padrão instalável pelo administrador (idempotente, por tenant; nenhum seed gravado em produção por esta PR);
- bens por fazenda: código patrimonial estável, código de frota (ex.: TP-02), nome descritivo, classificação, propriedade, responsável, centro de custo, área e identificação condicionada à natureza;
- medições físicas (benfeitorias), medidor de uso (horímetro, odômetro, ciclos ou sem medidor), tanques com os combustíveis que aceitam, aquisição e parâmetros de depreciação linear com prévia **só simulada**;
- **R2:** vínculo **combustível × produto por empresa** (quais Produtos de cada fazenda representam cada tipo de combustível), gerido na tela Combustíveis, e o contrato **só leitura** dos produtos elegíveis de um bem, para a P1-02 (§5a).

**Fica fora:** abastecimento, manutenção, peças, baixa de estoque, ordens de serviço, custo/hora, apuração e lançamento de depreciação, baixa/venda do bem, transferência entre fazendas, dashboards, mapa novo, offline, anexos/foto. Nada toca estoque nem financeiro: o vínculo da R2 não baixa estoque, não calcula custo nem converte L↔KG.

## 2. Arquivos e contratos

**Backend** (`backend/src/modules/patrimonio/`):
- `patrimonioDominio.js` (domínios fechados e matriz de capacidades por natureza), `patrimonioComum.js` (anti-coerção, trava de catálogo, utilitários), `unidadesFisicas.js` (dimensões, unidades e fatores exatos), `depreciacaoLinear.js` (prévia pura sobre `decimalFinanceiro.js`), `patrimonioCatalogoPadrao.js`;
- catálogos: `familiaPatrimonialService.js`, `tipoPatrimonialService.js`, `perfilMedicaoService.js`, `tipoCombustivelService.js`, `patrimonioCatalogoRoutes.js`;
- bens: `bemPatrimonialService.js`, `bemPatrimonialRoutes.js` e as opções (inclui `produtosElegiveisDoBem`, R2);
- vínculo combustível × produto (R2): `combustivelProdutoService.js`, `combustivelProdutoRoutes.js`.
- Compartilhados: `app.js` (rotas), `autorizacaoTela.js` (5 telas `pat-*` + ação extra `inativar`), `guardasRotas.js` (`GUARDAS.patrimonio*`), `errorCodes.js` (códigos do domínio), `fornecedorService.excluir` (conta bens → 409 `PARCEIRO_EM_USO`), `produtoService` (R2: excluir produto vinculado → 409 `PRODUTO_DELETE_BLOCKED`; PATCH com `empresa_id` trava a linha antes de ler e recusa a troca de fazenda com vínculo ativo → 409 `PRODUTO_VINCULADO_COMBUSTIVEL`).

**Banco:** `backend/prisma/schema.prisma` (10 models; o `Produto` ganha só a relação inversa, sem DDL) e a migration `20261110100000_patrimonio_p1_01_cadastros` (§6).

**Frontend:**
- `src/apis/patrimonio/*`, `src/services/patrimonioCatalogoService.js`, `src/services/bemPatrimonialService.js`, `src/services/combustivelProdutoService.js` (R2);
- `src/lib/patrimonioPermissions.js`, `src/lib/patrimonioErros.js`, `src/lib/patrimonioDominio.js`, `src/hooks/usePatrimonioSessao.js`;
- `src/components/patrimonio/*` (telas, tabelas e formulários no Motor Base1; R2: `ProdutosDoCombustivel.jsx` na tela Combustíveis), `src/pages/{BensPatrimoniais,FamiliasPatrimoniais,TiposPatrimoniais,PerfisMedicao,Combustiveis}.jsx`;
- registro: `src/pages.config.js`, `src/lib/menuConfig.js` (grupo `patrimonio`), `src/components/navigation/MobileModulesView.jsx`, `src/lib/permissions.js`, `src/components/usuarios/ConfiguracaoPermissoesTelas.jsx`, `config/mapa-manejo-scope.json` (+5 `allowedPages`; `forbiddenDomains` e `forbiddenBase44Entities` intactos), `vercel.json` (gerado pelo sync).

**Rotas** (cobertura completa em [`MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md`](./MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md)):
- `/patrimonio-familias`, `/patrimonio-tipos`, `/patrimonio-perfis-medicao`, `/patrimonio-combustiveis` (lista keyset, detalhe, POST, PATCH com `versao`); `POST /patrimonio-catalogo-padrao`;
- `/bens-patrimoniais` (lista, detalhe, POST, PATCH com `versao`), `POST /bens-patrimoniais-previa-depreciacao`, `GET /bens-patrimoniais-opcoes/{familias,tipos,perfis-medicao,combustiveis,responsaveis,parceiros,centros-custo,areas}`;
- R2: `GET`/`POST /patrimonio-combustiveis/:id/produtos`, `PATCH /patrimonio-combustivel-produtos/:id`, `GET /patrimonio-combustiveis-opcoes/produtos`, `GET /bens-patrimoniais/:id/produtos-elegiveis`.
- Tela Produtos (existente): o bloqueio de exclusão e a troca de fazenda recusada passam a dizer o vínculo real e o que fazer (`src/services/produtoService.js`, `src/pages/Produtos.jsx`).

## 3. Modelo lógico

- Catálogos do **tenant** (só `cliente_id`), para o bem poder mudar de fazenda no futuro sem quebrar FK: `FamiliaPatrimonial`, `TipoPatrimonial`, `TipoPatrimonialPerfil`, `PerfilMedicao`, `TipoCombustivel`.
- `BemPatrimonial` por **empresa** (FK composta com `Empresa`); é a raiz do agregado: `MedicaoBem`, `TanqueBem` e `TanqueBemCombustivel` só mudam pelo POST/PATCH do bem, numa transação, com trava da linha do bem e CAS por `versao`.
- `numero` (código patrimonial) por `reservarNumero` no escopo do tenant: não muda se o bem trocar de fazenda. `codigo_frota` é outro campo, opcional, normalizado e único por `(cliente_id, empresa_id, codigo_frota)`.
- `natureza` é copiada da família na criação e é imutável: trocar para família de outra natureza → 409 `BEM_NATUREZA_IMUTAVEL`, nada apagado.
- `TipoCombustivelProduto` (R2) por **empresa**: liga um tipo do catálogo a um Produto da mesma fazenda (§5a).
- Referências a cadastros existentes, sem duplicar: Parceiro (`Fornecedor`) como proprietário e fornecedor, `Usuario` como responsável, `CentroCusto` (FK com empresa), `AreaPastagem`.

## 4. Regras de medição

- Três conceitos separados: **medição física** (benfeitoria), **medidor de uso** (horímetro, odômetro, ciclos) e **capacidade operacional** (tanques). O medidor nunca é derivado da unidade física.
- Perfis: dimensão (extensão, área, volume, massa, quantidade, cabeças), unidade canônica e unidades permitidas. Conversão só dentro da dimensão, com fatores exatos: 1 km = 1.000 m, 1 ha = 10.000 m², 1 m³ = 1.000 L, 1 t = 1.000 kg. Dimensões diferentes → 422 `MEDICAO_UNIDADE_INCOMPATIVEL`.
- Cada medição guarda o valor e a unidade informados **e** o valor normalizado na unidade canônica. Um perfil por bem (sem duas fontes para o mesmo significado), no máximo uma principal; quantidade e cabeças só inteiras.
- Medidor: escolha explícita para máquina, veículo e equipamento (pode ser "sem medidor"); proibido em benfeitoria. A leitura atual não regride (422 `MEDIDOR_LEITURA_REGRESSIVA`, sem gravação parcial), a data não volta nem vai para o futuro (pelo fuso da fazenda). O tipo e a leitura inicial só podem ser corrigidos enquanto não houve ajuste depois do cadastro inicial (evento de auditoria próprio); troca de painel auditável é operação futura.

## 5. Tanques e combustíveis (flex)

- Zero a dez tanques **ativos** por bem (máquina, veículo, equipamento), cada um com identificador único no bem, capacidade nominal em litros > 0 e os combustíveis que aceita. Veículo flex = **um** tanque com gasolina e etanol, sem tanque falso.
- Tanque nunca é removido, só inativado (o identificador continua reservado). Combustível inativo continua legível onde já estava; não pode ser acrescentado.
- Neste slice o tanque aceita só combustível em litros (GNV, em m³, fica no catálogo sem vínculo a tanque).
- Combustível é catálogo classificatório: sem preço, custo nem saldo. Os produtos de estoque que o representam são ligados por empresa (§5a). Nenhum consumo (km/L, L/h) é calculado ou exibido.

## 5a. Vínculo combustível × produto por empresa (R2)

**Por quê.** O tipo de combustível é do tenant, mas o Produto de estoque é de cada fazenda (`Produto.empresa_id`). Cada fazenda precisa dizer quais produtos **dela** são aquele combustível (ex.: Diesel S10 → "DIESEL S10 A GRANEL" e "DIESEL S10 POSTO" na fazenda A; outro produto na fazenda B).

**Modelo** (`TipoCombustivelProduto`): `id`, `cliente_id`, `empresa_id`, `tipo_combustivel_id`, `produto_id`, `ativo`, `ativo_chave`, `versao`, datas.
- FKs compostas com o tenant, todas `ON DELETE RESTRICT`: `(cliente_id)` → Cliente; `(cliente_id, empresa_id)` → Empresa; `(cliente_id, tipo_combustivel_id)` → TipoCombustivel; `(cliente_id, produto_id)` → Produto.
- Uniques: `(cliente_id, id)`; o par `(cliente_id, empresa_id, tipo_combustivel_id, produto_id)` (sem duplicata, ativa ou inativa); **um tipo ATIVO por produto por empresa** `(cliente_id, empresa_id, produto_id, ativo_chave)`, com `ativo_chave` = TRUE no ativo e NULL no inativo. CHECK NULL-safe `(ativo AND ativo_chave IS TRUE) OR (NOT ativo AND ativo_chave IS NULL)` e `versao >= 1`. Índices começam por `cliente_id`.
- Vários produtos no mesmo tipo e na mesma fazenda são permitidos; o mesmo produto em dois tipos ativos, não (409 `COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO`, com o tipo vencedor em `details`).
- O vínculo nunca é apagado: inativa/reativa com CAS (`versao`). Reativar exige as regras do POST. O inativo continua listado e rastreável, mas nunca é elegível.

**Limite de integridade (assumido e provado).** `Produto` não tem unique `(cliente_id, empresa_id, id)` e esta PR **não** cria um (nenhum DDL em tabela antiga). A regra `Produto.empresa_id = vínculo.empresa_id` é do **serviço**:
- POST e reativação leem o produto com `FOR KEY SHARE` e exigem a mesma empresa e produto ativo (422 `COMBUSTIVEL_PRODUTO_INVALIDO`, `reason` `inexistente` ≡ outro tenant, `outra_empresa`, `inativo`; tipo inativo → `tipo_inativo`);
- `PATCH /produtos/:id` com `empresa_id` trava a linha (`FOR UPDATE`) antes de ler o estado anterior e recusa a troca de fazenda com vínculo ATIVO (409 `PRODUTO_VINCULADO_COMBUSTIVEL`, nada gravado); com vínculo só inativo a troca passa e o vínculo fica rastreável (`empresa_coerente=false`);
- `DELETE /produtos/:id` com vínculo, ativo ou inativo → 409 `PRODUTO_DELETE_BLOCKED` (`details.vinculo` = "combustíveis do patrimônio"), nunca o 403 da FK;
- a trava consultiva por (tenant, empresa, produto) serializa as escritas do vínculo; os uniques são a barreira final (P2002 → 409 de negócio);
- SQL direto fora do serviço pode quebrar a regra; nesse caso a leitura marca `empresa_coerente=false` e o produto **nunca** fica elegível, porque opções e elegíveis filtram por `produto.empresa_id`.

**Tela Combustíveis.** No registro aberto em leitura, a seção "Produtos vinculados nesta fazenda" (fazenda selecionada; sem fazenda, nada é lido) lista ativos e inativos com nome, código, unidade de estoque **como está** e a situação (ativo, vínculo inativo, produto inativo, produto movido de fazenda). "Vincular produto" (ação criar, combustível ativo) usa um seletor paginado com busca no servidor dos produtos ATIVOS da fazenda e indica quando o produto já está em outro tipo. Inativar/Reativar exige a ação `inativar` e confirmação.

**Contrato de elegibilidade (só leitura, para a P1-02).** `GET /bens-patrimoniais/:id/produtos-elegiveis?empresa_id&tanque_id?` → `{ itens: [{ tanque_id, tanque_identificador, tipo_combustivel_id, tipo_combustivel_nome, produto_id, produto_nome, unidade_principal_estoque, empresa_id }] }` = tanques ATIVOS do bem × tipos aceitos (tipo ativo) × vínculos ATIVOS da empresa do bem × produtos ATIVOS da mesma empresa. Sem vínculo → `itens: []`, **nunca** "todos os produtos". Sem preço, saldo nem custo. TP-02 (diesel S10) não oferece S500; o flex UT-04 oferece só gasolina e etanol. No frontend, `bemPatrimonialService.produtosElegiveisDoBem` (sem tela nesta PR).

**Fora do escopo da R2:** baixa de estoque, FIFO, custo, lançamento financeiro e conversão L↔KG.

## 6. Depreciação (somente prévia)

- Parâmetros no bem: depreciável (só bem **próprio**), método linear, vida útil em meses (a tela aceita anos e converte ×12), residual em valor **ou** percentual, data de início. Validados no service e por CHECKs no banco (inclusive os casos com NULL).
- Prévia (`POST /bens-patrimoniais-previa-depreciacao`, função pura): custo base = aquisição + incorporação; valor depreciável = custo base − residual; quota mensal truncada em centavos e a diferença na última quota; quota anual = min(quota × 12, valor depreciável); taxa anual = 1200 ÷ meses; sem pró-rata no primeiro mês. Exemplo de aceite: R$ 200.000,00, residual R$ 50.000,00, 120 meses → **R$ 1.250,00/mês**.
- A resposta diz `simulada: true`, `contabilizada: false`, `valor_contabil: null`, `depreciacao_acumulada: null`. Nada é gravado: nenhuma competência, lançamento, título, despesa, caixa ou estoque (provado por contagem de tabelas antes/depois).

## 7. Pontos de integração para os próximos slices

- **P1-02 Abastecimentos/Consumo:** usar `TanqueBem`/`TanqueBemCombustivel` (qual tanque e qual combustível), o contrato de elegíveis da R2 (§5a) para escolher o Produto, decidir a conversão L↔KG da unidade de estoque, e o medidor do bem (a leitura do abastecimento passa a ser a fonte do ajuste). Saída de estoque e custo pelo motor existente, com proteção contra lançamento duplicado.
- **Manutenção:** mesma raiz `BemPatrimonial`, medidor como gatilho de plano preventivo.
- **Depreciação por competência:** apuração mensal idempotente por bem × competência, usando `depreciacaoLinear.js`; revisão auditável de parâmetros; baixa do bem.
- **Transferência entre fazendas:** muda `empresa_id` do bem com trilha própria; `numero` e catálogos (do tenant) não mudam; o centro de custo precisa ser trocado (FK com empresa).
- Ganchos legados preservados: `TipoTarefa.pode_ter_maquina`/`pode_ter_implemento`, `MovimentacaoEstoque.maquina_vinculada_*` (não alterados).

## 8. Matriz de testes

Números da árvore final da R2 (PostgreSQL 16 local descartável; `verify:all` e CI no §12).

| Suíte | Tipo | Resultado |
|---|---|---|
| `backend/tests/patrimonioP1Catalogos.test.mjs` | PostgreSQL real + Fastify | 14/14 |
| `backend/tests/patrimonioP1Bens.test.mjs` | PostgreSQL real + Fastify | 19/19 |
| `backend/tests/patrimonioP1Seguranca.test.mjs` | PostgreSQL real + Fastify | 12/12 |
| `backend/tests/patrimonioP1CombustivelProduto.test.mjs` (R2) | PostgreSQL real + Fastify | 19/19 (RED 17/17 antes da API; +2 da revisão, RED→GREEN) |
| Regressão que toca Produto e a P3-01/P3-02: cadastrosEstoqueNativo, estabP0LancamentosNativo, gestaoP3Concorrencia, gestaoP3Lancamentos, gestaoP3Rodada2, leiturasCadastrosIntegrada, permissoesR2Rotas, referenciasSincronizarIntegrada, trocaSenhaInicialS04P2 + patrimonioP1* | PostgreSQL real | 177/177 |
| `tests/smoke/patrimonioMenuPermissoes.test.jsx` | React + backend falso | 18/18 |
| `tests/smoke/patrimonioCatalogos.test.jsx` | React + backend falso | 32/32 |
| `tests/smoke/bensPatrimoniais.test.jsx` | React + backend falso | 40/40 |
| `tests/smoke/patrimonioFormularioRegras.test.js` | regras puras | 13/13 |
| `tests/smoke/patrimonioCombustivelProdutos.test.jsx` (R2) | React + backend falso com os códigos reais | 29/29 |
| `tests/smoke/bensPatrimoniaisProdutosElegiveis.test.js` (R2) | service + nativeHttpClient reais, `fetch` falso | 5/5 |
| `tests/smoke/produtosBloqueioCombustivel.test.js` (R2) | service + nativeHttpClient reais, `fetch` falso | 4/4 (RED 3/4 antes) |

Casos críticos cobertos: famílias/tipos (tipo de família errada ou inativa recusado); um bem de cada (cerca 1.250 m, curral m² + cabeças, reservatório em litros, trator TP-02 com horímetro e diesel S10 180 L, caminhonete flex UT-04 com odômetro e tanque único de 80 L gasolina + etanol, implemento sem motor/tanque) com releitura; TP-02 duplicado na mesma empresa (sequencial e simultâneo → [201, 409]) e permitido em outra; troca de natureza → 409 sem apagar; conversões e recusas (dimensão errada, zero, negativo, não numérico, estouro); flex e combustível não listado/inativo; prévia 1.250,00 e zero escrita; residual > custo e vida 0 → 422; medidor regressivo → 422 sem mutação parcial; 401, 403 por ação (ver, criar, editar, inativar), 404 cruzado, `cliente_id` no corpo → 400, campo extra → 400, número JSON em decimal → 400; RLS ligado e sem grants; CHECKs e FKs direto no banco; auditoria com rollback; parceiro com bens → 409; empresa com bens → 409; catálogo padrão idempotente e isolado; runtime novo sobre schema antigo → P2021 (500 sem detalhe) e o preflight acusa a migration pendente.

## 9. Migration e hashes

- `backend/prisma/migrations/20261110100000_patrimonio_p1_01_cadastros/migration.sql` — a **mesma pasta** da R1 (nunca aplicada em ambiente remoto), ampliada na R2: 10 `CREATE TABLE` (+ `TipoCombustivelProduto`), índices e uniques que começam por `cliente_id`, FKs `ON DELETE RESTRICT` com `cliente_id`, CHECKs escritos à mão e o bloco `DO` de REVOKE/RLS (a lista ganhou `TipoCombustivelProduto`). Nenhuma coluna, índice ou constraint em tabela antiga (nenhum DDL em `Produto`).
- SHA-256 final `b8818ba8f16528580b7ba6053b0c89f07f0d4fd434955f4b9c5830a62ffd64dc`; hash do `DO` `01dbf9ae4875444fa77082d37e1b71da655f217ecc25cc95a4d1b8a4a108a0a3`; pinados em `scripts/deploy/premergeMigrateLib.mjs` (a entrada da P3-02, `df4d1ab2…` / `dc05126c…`, intacta). Classificador: expand, 10 tabelas novas, 0 colunas novas em tabela antiga, 0 violações; o B1c recusa um unique em `Produto`. **Inválidos:** `58fa953b…` (R1) e `f421ba25…` (após a renumeração para D-PROD-157).
- Prova local (PostgreSQL 16 descartável, banco novo, árvore final): `deploy:migrate` encontrou e aplicou as **37** migrations (36 da `main` + esta); a reexecução respondeu "No pending migrations"; 81 tabelas em `public` (80 de domínio + `_prisma_migrations`), todas com RLS; `_prisma_migrations.checksum` da migration = SHA pinado; `prisma migrate diff` (migrations × schema e banco × schema) sem diferença. SQL Editor 01–04 recontados (81 tabelas, "+ 10 de Patrimônio P1-01"; `TipoCombustivelProduto` antes de `TipoCombustivel` na ordem de limpeza e nos `LOCK TABLE`) e testados (`sqlEditorBootstrap`).
- **Não aplicada em produção.** Nenhum comando foi executado contra Supabase ou Vercel (nem leitura de segredo, nem escrita na Preview).

## 10. Riscos e limitações

- **Ordem de release:** a Vercel publica a `main` sozinha. Se o código entrar antes da migration, respondem 500 (P2021) as rotas do patrimônio **e rotas antigas**: `DELETE /fornecedores/:id`, `DELETE /produtos/:id` e `PATCH /produtos/:id` com `empresa_id` diferente (consultam as tabelas novas). A barreira é o preflight, que acusa a migration pendente. A migration tem de ser aplicada com autorização **antes** do merge, pelo runbook [`MAIKE-PATRIMONIO-P1-01-RUNBOOK-RELEASE.md`](./MAIKE-PATRIMONIO-P1-01-RUNBOOK-RELEASE.md) (não executado; SQL de aplicação e de rollback ensaiados num PostgreSQL local).
- **Coerência produto × vínculo é do serviço** (§5a): sem unique composto em `Produto`, SQL direto pode gravar vínculo ativo com produto de outra fazenda; a leitura o rotula (`empresa_coerente=false`) e ele nunca fica elegível. Todo `PATCH /produtos/:id` com `empresa_id` (o formulário sempre manda) agora trava a linha do produto, como o próprio UPDATE já faria.
- O seletor compartilhado `SeletorPaginadoGestao` não desabilita a opção de produto preso a outro tipo: a tela mostra o motivo, deixa "Gravar vínculo" desabilitado e o servidor é a barreira final (409).
- O smoke do frontend usa backend falso alinhado aos códigos reais; a integração front × back da R2 não foi exercitada ponta a ponta em navegador.
- `scripts/deploy/preflightSchemaLib.mjs` não lista as 10 tabelas em `TABELAS_PROTEGIDAS` (a detecção depende de "migrations pendentes", que basta); acrescentá-las daria também a checagem de RLS e grants no preflight.
- Semântica do PATCH do bem: `aquisicao` e `depreciacao` substituem o bloco inteiro; no `medidor` de um contador do mesmo tipo, campos omitidos ou nulos significam "como está" (desvio deliberado do texto do adendo A6, alinhado à regra de transição do medidor e ao envio mínimo da tela; registrado na D-PROD-157).
- Correção de medidor só enquanto não houve ajuste; erro descoberto depois depende da operação futura auditável.
- O bem "Bebedouro fixo" do catálogo padrão não substitui nem se liga ao Bebedouro do Mapa.
- Depreciação: sem pró-rata no primeiro mês e sem regras fiscais (taxas legais não são impostas); terrenos e benfeitorias em área de terceiros não têm regra própria neste slice.

## 11. Divergências do molde PROJETOMG

Nenhuma nova: API → service → Prisma, migration versionada e pinada, tenancy desde o primeiro model, erros padronizados, uma missão por PR.

## 11a. Integração com a `main` (R2)

- `origin/main` `e4e907ea` (Gestão P3-02, PR #231) integrada por **merge não destrutivo** (`d203cf29`), sem rebase nem force-push. Conflitos em 10 arquivos, todos resolvidos por união: `DECISIONS.md`, `CURRENT-STATE.md`, `premergeMigrateLib.mjs` (entradas P3-02 + Patrimônio), `premerge-migrate.test.mjs` (lista B1 ordenada com as duas migrations), SQL Editor 01–04 e `sqlEditorBootstrap.test.mjs` (contagens), `schema.prisma` (back-relations de `CentroCusto` dos dois lados).
- **D-PROD-156 preservada:** a decisão da `main` (Gestão P3-02, rateio por item) ficou intacta; o Patrimônio passou a **D-PROD-157** em código, testes, scripts e docs desta PR (só linhas ausentes da `main` e sem menção à P3-02), e o marcador foi para D-PROD-158. O diff de `DECISIONS.md` contra a `main` só acrescenta texto (fora o marcador).
- Migrations antigas, `migration_lock.toml` e os arquivos da P3-02 idênticos à `origin/main`. Nenhum código financeiro da P3-01/P3-02 alterado; regressão P3 verde (§8).

## 12. Situação

| Item | Valor |
|---|---|
| CODE_READY | SIM — R2 implementada, 5 achados da revisão adversarial confirmados e corrigidos com teste (RED→GREEN), `verify:all` local verde na árvore final; CI do HEAD final no relatório da missão |
| SCHEMA_READY_LOCAL | SIM — banco novo local: 37 migrations, reexecução sem pendências, `migrate diff` sem diferença |
| SCHEMA_APPLIED_PRODUCTION | NÃO |
| MERGE_READY | NÃO — depende da aplicação autorizada da migration em produção (preflight + GO escrito) e da revisão humana |
| OPERATIONAL_RELEASE_READY | NÃO |

Decisões para aprovação humana: a própria D-PROD-157 (expansão de escopo, agora com o vínculo combustível × produto), a aplicação da migration em produção (GO escrito) e o merge manual.
