# MAIKE-PATRIMONIO-P1-01 — Cadastros patrimoniais, frota e parâmetros operacionais

Decisão: **D-PROD-156** ([`DECISIONS.md`](./DECISIONS.md)). Base: `main` `f2b81e1b` (P3-01 mergeada, PR #230).
Branch: `claude/maike-patrimonio-p1-01-cadastros-inventario` · PR #232 (draft).

## 1. O que entra e o que fica fora

**Entra:** domínio nativo Patrimônio e Frota, só cadastros:
- catálogos do tenant: famílias (natureza fechada), tipos (subtipos da família, com perfis de medição sugeridos), perfis de medição e combustíveis; catálogo padrão instalável pelo administrador (idempotente, por tenant; nenhum seed gravado em produção por esta PR);
- bens por fazenda: código patrimonial estável, código de frota (ex.: TP-02), nome descritivo, classificação, propriedade, responsável, centro de custo, área e identificação condicionada à natureza;
- medições físicas (benfeitorias), medidor de uso (horímetro, odômetro, ciclos ou sem medidor), tanques com os combustíveis que aceitam, aquisição e parâmetros de depreciação linear com prévia **só simulada**.

**Fica fora:** abastecimento, manutenção, peças, baixa de estoque, ordens de serviço, custo/hora, apuração e lançamento de depreciação, baixa/venda do bem, transferência entre fazendas, dashboards, mapa novo, offline, anexos/foto. Nada toca estoque nem financeiro.

## 2. Arquivos e contratos

**Backend** (`backend/src/modules/patrimonio/`):
- `patrimonioDominio.js` (domínios fechados e matriz de capacidades por natureza), `patrimonioComum.js` (anti-coerção, trava de catálogo, utilitários), `unidadesFisicas.js` (dimensões, unidades e fatores exatos), `depreciacaoLinear.js` (prévia pura sobre `decimalFinanceiro.js`), `patrimonioCatalogoPadrao.js`;
- catálogos: `familiaPatrimonialService.js`, `tipoPatrimonialService.js`, `perfilMedicaoService.js`, `tipoCombustivelService.js`, `patrimonioCatalogoRoutes.js`;
- bens: `bemPatrimonialService.js`, `bemPatrimonialRoutes.js` e as opções.
- Compartilhados: `app.js` (rotas), `autorizacaoTela.js` (5 telas `pat-*` + ação extra `inativar`), `guardasRotas.js` (`GUARDAS.patrimonio*`), `errorCodes.js` (códigos do domínio), `fornecedorService.excluir` (conta bens → 409 `PARCEIRO_EM_USO`).

**Banco:** `backend/prisma/schema.prisma` (9 models) e a migration `20261110100000_patrimonio_p1_01_cadastros` (§6).

**Frontend:**
- `src/apis/patrimonio/*`, `src/services/patrimonioCatalogoService.js`, `src/services/bemPatrimonialService.js`;
- `src/lib/patrimonioPermissions.js`, `src/lib/patrimonioErros.js`, `src/lib/patrimonioDominio.js`, `src/hooks/usePatrimonioSessao.js`;
- `src/components/patrimonio/*` (telas, tabelas e formulários no Motor Base1), `src/pages/{BensPatrimoniais,FamiliasPatrimoniais,TiposPatrimoniais,PerfisMedicao,Combustiveis}.jsx`;
- registro: `src/pages.config.js`, `src/lib/menuConfig.js` (grupo `patrimonio`), `src/components/navigation/MobileModulesView.jsx`, `src/lib/permissions.js`, `src/components/usuarios/ConfiguracaoPermissoesTelas.jsx`, `config/mapa-manejo-scope.json` (+5 `allowedPages`; `forbiddenDomains` e `forbiddenBase44Entities` intactos), `vercel.json` (gerado pelo sync).

**Rotas** (cobertura completa em [`MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md`](./MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md)):
- `/patrimonio-familias`, `/patrimonio-tipos`, `/patrimonio-perfis-medicao`, `/patrimonio-combustiveis` (lista keyset, detalhe, POST, PATCH com `versao`); `POST /patrimonio-catalogo-padrao`;
- `/bens-patrimoniais` (lista, detalhe, POST, PATCH com `versao`), `POST /bens-patrimoniais-previa-depreciacao`, `GET /bens-patrimoniais-opcoes/{familias,tipos,perfis-medicao,combustiveis,responsaveis,parceiros,centros-custo,areas}`.

## 3. Modelo lógico

- Catálogos do **tenant** (só `cliente_id`), para o bem poder mudar de fazenda no futuro sem quebrar FK: `FamiliaPatrimonial`, `TipoPatrimonial`, `TipoPatrimonialPerfil`, `PerfilMedicao`, `TipoCombustivel`.
- `BemPatrimonial` por **empresa** (FK composta com `Empresa`); é a raiz do agregado: `MedicaoBem`, `TanqueBem` e `TanqueBemCombustivel` só mudam pelo POST/PATCH do bem, numa transação, com trava da linha do bem e CAS por `versao`.
- `numero` (código patrimonial) por `reservarNumero` no escopo do tenant: não muda se o bem trocar de fazenda. `codigo_frota` é outro campo, opcional, normalizado e único por `(cliente_id, empresa_id, codigo_frota)`.
- `natureza` é copiada da família na criação e é imutável: trocar para família de outra natureza → 409 `BEM_NATUREZA_IMUTAVEL`, nada apagado.
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
- Combustível é catálogo classificatório: sem preço, custo, saldo nem vínculo a Produto. Motivo: o motor de estoque é em KG (D-PROD-155) e combustível em litros não cabe nele hoje; a ligação com Produto entra na P1-02. Nenhum consumo (km/L, L/h) é calculado ou exibido.

## 6. Depreciação (somente prévia)

- Parâmetros no bem: depreciável (só bem **próprio**), método linear, vida útil em meses (a tela aceita anos e converte ×12), residual em valor **ou** percentual, data de início. Validados no service e por CHECKs no banco (inclusive os casos com NULL).
- Prévia (`POST /bens-patrimoniais-previa-depreciacao`, função pura): custo base = aquisição + incorporação; valor depreciável = custo base − residual; quota mensal truncada em centavos e a diferença na última quota; quota anual = min(quota × 12, valor depreciável); taxa anual = 1200 ÷ meses; sem pró-rata no primeiro mês. Exemplo de aceite: R$ 200.000,00, residual R$ 50.000,00, 120 meses → **R$ 1.250,00/mês**.
- A resposta diz `simulada: true`, `contabilizada: false`, `valor_contabil: null`, `depreciacao_acumulada: null`. Nada é gravado: nenhuma competência, lançamento, título, despesa, caixa ou estoque (provado por contagem de tabelas antes/depois).

## 7. Pontos de integração para os próximos slices

- **P1-02 Abastecimentos/Consumo:** usar `TanqueBem`/`TanqueBemCombustivel` (qual tanque e qual combustível), ligar `TipoCombustivel` a Produto, e o medidor do bem (a leitura do abastecimento passa a ser a fonte do ajuste). Saída de estoque e custo pelo motor existente, com proteção contra lançamento duplicado.
- **Manutenção:** mesma raiz `BemPatrimonial`, medidor como gatilho de plano preventivo.
- **Depreciação por competência:** apuração mensal idempotente por bem × competência, usando `depreciacaoLinear.js`; revisão auditável de parâmetros; baixa do bem.
- **Transferência entre fazendas:** muda `empresa_id` do bem com trilha própria; `numero` e catálogos (do tenant) não mudam; o centro de custo precisa ser trocado (FK com empresa).
- Ganchos legados preservados: `TipoTarefa.pode_ter_maquina`/`pode_ter_implemento`, `MovimentacaoEstoque.maquina_vinculada_*` (não alterados).

## 8. Matriz de testes

| Suíte | Tipo | Resultado |
|---|---|---|
| `backend/tests/patrimonioP1Catalogos.test.mjs` | PostgreSQL real + Fastify | 11/11 |
| `backend/tests/patrimonioP1Bens.test.mjs` | PostgreSQL real + Fastify | 18/18 |
| `backend/tests/patrimonioP1Seguranca.test.mjs` | PostgreSQL real + Fastify | 10/10 |
| Regressão: gestaoP1Cadastros, gestaoP2Naturezas, gestaoP3Seguranca, gestaoP1R2Blindagem, leiturasCadastrosIntegrada, empresaNumero, empresaUniqueViolation, gestaoP3Lancamentos, permissoesR2Rotas | PostgreSQL real | 101/101 |
| `tests/smoke/patrimonioMenuPermissoes.test.jsx` | React + backend falso | 18/18 |
| `tests/smoke/patrimonioCatalogos.test.jsx` | React + backend falso | 31/31 |
| `tests/smoke/bensPatrimoniais.test.jsx` | React + backend falso | 32/32 |
| `npm run test:smoke` (suíte inteira) | React | 165 arquivos, 1960/1960 |
| `npm run test:gates` | gates + premerge (B1..B8) | 694/694 |

Casos críticos cobertos: famílias/tipos (tipo de família errada ou inativa recusado); um bem de cada (cerca 1.250 m, curral m² + cabeças, reservatório em litros, trator TP-02 com horímetro e diesel S10 180 L, caminhonete flex UT-04 com odômetro e tanque único de 80 L gasolina + etanol, implemento sem motor/tanque) com releitura; TP-02 duplicado na mesma empresa (sequencial e simultâneo → [201, 409]) e permitido em outra; troca de natureza → 409 sem apagar; conversões e recusas (dimensão errada, zero, negativo, não numérico, estouro); flex e combustível não listado/inativo; prévia 1.250,00 e zero escrita; residual > custo e vida 0 → 422; medidor regressivo → 422 sem mutação parcial; 401, 403 por ação (ver, criar, editar, inativar), 404 cruzado, `cliente_id` no corpo → 400, campo extra → 400, número JSON em decimal → 400; RLS ligado e sem grants; CHECKs e FKs direto no banco; auditoria com rollback; parceiro com bens → 409; empresa com bens → 409; catálogo padrão idempotente e isolado; runtime novo sobre schema antigo → P2021 (500 sem detalhe) e o preflight acusa a migration pendente.

## 9. Migration e hashes

- `backend/prisma/migrations/20261110100000_patrimonio_p1_01_cadastros/migration.sql`: 9 `CREATE TABLE`, índices e uniques que começam por `cliente_id`, FKs `ON DELETE RESTRICT` com `cliente_id`, CHECKs escritos à mão e o bloco `DO` de REVOKE/RLS idêntico ao da P3-01 (só a lista muda). Nenhuma coluna nova e nenhum ALTER em tabela antiga.
- SHA-256 `58fa953b00973de211a1213157d7be7ffe24f496c794eb2f56f00818aa021a18`; hash do `DO` `0d83249dd58c726be989ee0090787b7665861c251479a40d0831c4da38fbbbab`; pinados em `scripts/deploy/premergeMigrateLib.mjs` (classificador: expand, 9 tabelas novas, 0 violações).
- Prova local (PostgreSQL 16 descartável): `deploy:migrate` num banco vazio aplica as 36 migrations e a reexecução não aplica nada; `prisma migrate diff` (migrations × schema e banco × schema) sem diferença; scripts do SQL Editor 01–04 atualizados (79 tabelas) e testados.
- **Não aplicada em produção.** Nenhum comando foi executado contra Supabase ou Vercel.

## 10. Riscos e limitações

- **Ordem de release:** a Vercel publica a `main` sozinha. Se o código entrar antes da migration, as rotas do patrimônio e o `DELETE /fornecedores/:id` respondem 500 (P2021). A barreira é o preflight, que acusa a migration pendente. A migration tem de ser aplicada com autorização **antes** do merge.
- `scripts/deploy/preflightSchemaLib.mjs` não lista as 9 tabelas em `TABELAS_PROTEGIDAS` (a detecção depende de "migrations pendentes", que basta); acrescentá-las daria também a checagem de RLS e grants no preflight.
- Correção de medidor só enquanto não houve ajuste; erro descoberto depois depende da operação futura auditável.
- O bem "Bebedouro fixo" do catálogo padrão não substitui nem se liga ao Bebedouro do Mapa.
- Depreciação: sem pró-rata no primeiro mês e sem regras fiscais (taxas legais não são impostas); terrenos e benfeitorias em área de terceiros não têm regra própria neste slice.

## 11. Divergências do molde PROJETOMG

Nenhuma nova: API → service → Prisma, migration versionada e pinada, tenancy desde o primeiro model, erros padronizados, uma missão por PR.

## 12. Situação

| Item | Valor |
|---|---|
| CODE_READY | SIM (pendente da revisão adversarial e do verify:all final) |
| SCHEMA_READY_LOCAL | SIM |
| SCHEMA_APPLIED_PRODUCTION | NÃO |
| MERGE_READY | NÃO |
| OPERATIONAL_RELEASE_READY | NÃO |

Decisões para aprovação humana: a própria D-PROD-156 (expansão de escopo), a aplicação da migration em produção (GO escrito) e o merge manual.
