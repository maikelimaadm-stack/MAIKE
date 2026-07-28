# Inventário de Escopo — Mapa Geral + Manejo

**Missão:** P0.1 — Product Scope Reset · **Data:** 2026-07-28

Este documento é o resultado do **fechamento transitivo de dependências** feito
sobre o código real. A fonte legível por máquina é `config/mapa-manejo-scope.json`.

## Método

Grafo de imports construído sobre `src/**/*.{js,jsx,ts,tsx}`, resolvendo:
imports relativos, imports por alias `@/`, `import()` dinâmico e
`export … from`, com resolução de extensão (`.js`, `.jsx`, `.ts`, `.tsx`) e de
`index.*`. Sobre isso foram cruzados manualmente: registros em
`src/pages.config.js`, rotas em `src/App.jsx`, navegação em `src/Layout.jsx` e
`src/lib/menuConfig.js`, links `createPageUrl(...)`, entidades acessadas por
`base44.entities.<Entidade>`, functions invocadas por `base44.functions.invoke`,
nomes de entidade usados como string em `src/lib/offlineEntitySync.js`,
`src/lib/entityDeleteGuards.js` e `src/components/offline/mapaOfflineCache.jsx`.

Raízes do fechamento:

```
src/pages/MapaGeral.jsx
src/pages/MapaCadastro.jsx
src/components/mapa/DetalhesLote.jsx
src/Layout.jsx
src/lib/PageNotFound.jsx · src/lib/AuthContext.jsx · src/lib/query-client.js
src/components/common/GlobalRequiredFieldsGuard.jsx
src/components/common/GlobalDeleteBlockDialog.jsx
src/components/UserNotRegisteredError.jsx · src/components/ui/toaster.jsx
```

O fechamento **só do núcleo** (as três primeiras raízes + shell) resultou em
**128 arquivos**, dos quais 22 em `src/components/ui`. Nenhuma página além de
`MapaGeral` e `MapaCadastro` aparece nesse fechamento — todas as demais páginas
preservadas são `KEEP_SUPPORT`, justificadas individualmente abaixo.

Nenhum item terminou como `REVIEW_BLOCKER`.

---

## Páginas

### KEEP_CORE

| Página | Caminho | Justificativa |
|---|---|---|
| MapaGeral | `src/pages/MapaGeral.jsx` | Superfície primária (D-PROD-05). Áreas, setores, lotes por área, movimentação de lotes, pontos, linhas, cochos e depósitos, estoque dos depósitos, bebedouros, tarefas do mapa, filtros e camadas, localização, indicadores, alertas, detalhes do lote, manejo e insights. |
| MapaCadastro | `src/pages/MapaCadastro.jsx` | Editor geográfico: cria/edita áreas, pontos e linhas; importa GeoJSON/KML; cadastro de pontos em lote; vínculo de depósitos, cochos e `LocalEstoque`. |

### KEEP_SUPPORT

| Página | Caminho | Justificativa (evidência) |
|---|---|---|
| CadastroLotes | `src/pages/CadastroLotes.jsx` | CRUD de `Lote`, a entidade central desenhada no mapa. Arrasta `src/core/repositories/loteRepository.js` e o formulário dinâmico (`campoEngine`, `Layout*`). |
| CadastroSetores | `src/pages/CadastroSetores.jsx` | CRUD de `Setor`, consumido por `src/hooks/useSetorAreas.js` dentro de `MapaGeral`. |
| CategoriasManejo | `src/pages/CategoriasManejo.jsx` | CRUD de `CategoriaManejo`, usado por `FormularioMudancaCategoria` e por toda a coloração/filtro por categoria no mapa. |
| Bebedouros | `src/pages/Bebedouros.jsx` | CRUD de `Bebedouro`. `MapaGeral` lê `base44.entities.Bebedouro` e renderiza `DetalhesBebedouro`. |
| Produtos | `src/pages/Produtos.jsx` | CRUD de `Produto`, consumido pela suplementação (cochos/depósitos) e por `DetalhesLote`. |
| Categorias | `src/pages/Categorias.jsx` | `FormularioProduto` (`src/components/produtos/FormularioProduto.jsx:67`) exige `Categoria`. |
| Marcas | `src/pages/Marcas.jsx` | `FormularioProduto` exige `Marca`. |
| UnidadesMedida | `src/pages/UnidadesMedida.jsx` | `FormularioProduto` e a conversão de unidade da suplementação exigem `UnidadeMedida`. |
| LocaisEstoque | `src/pages/LocaisEstoque.jsx` | `MapaCadastro` acessa `base44.entities.LocalEstoque` diretamente para vincular depósitos. |
| TiposTarefa | `src/pages/TiposTarefa.jsx` | `TipoTarefa` é consumido por `FormularioTarefaMapa` e `TarefasMapaPanel`. |
| GruposAtividades | `src/pages/GruposAtividades.jsx` | `GrupoAtividade` é consumido pelo painel de tarefas do mapa. |
| Empresa | `src/pages/Empresa.jsx` | `Empresa` é a fazenda operacional; o seletor no `Layout` e todo filtro `empresa_id` dependem dela. |
| Usuarios | `src/pages/Usuarios.jsx` | `Permissao` e `User` governam `src/lib/permissions.js` e `src/lib/mapaGeralPermissions.js`. |
| ConfiguracoesGerais | `src/pages/ConfiguracoesGerais.jsx` | Reduzida ao gerenciador de ícones (`ConfiguracaoIcone`), consumido pelo renderizador do mapa. Editor de menus removido (D-PROD-09). |

### DELETE — 86 páginas

Financeiro/fiscal/caixa: `Financeiro` `LancamentoFinanceiro` `ContasFinanceiras`
`PlanoContas` `GruposFinanceiros` `FormasPagamento` `CentrosCusto` `FluxoCaixa`
`LivroCaixa` `CaixaBancos` `LivrosFiscais` `MotivosCompra` `TiposDocumento`.

Folha e fichas: `Folha` `FichaOperador` `FichaOperadorImpressao`
`FichaControleCombustivel` `FichasPersonalizadas` `VisualizarFicha`.

Máquinas, combustível, agrícola e safra: `CadastroMaquinas` `AtivosFixos`
`LancamentosAbastecimento` `OperacoesAgricolas` `ControleAreas` `GerenciarSafras`
`CustosSafra`.

Comercial e cotação: `CotacoesPecuaria` `LotesAnimaisCotacao` `Fornecedores`
`SimulacaoResultados`.

Pesagens: `Pesagens` `PesagensIndividuais` `LancamentoPesagensIndividuais`
`LancamentoPesagensMobile` `ConfiguracaoPesagens`.

Estoque fora do mapa (D-PROD-08): `MovimentacoesEstoque`
`LancamentoProdutosEstoque`.

Relatórios e dashboards (28 telas): todas as `Relatorio*`, `Relatorios`,
`RelatoriosEstoque`, `Dashboard`, `Home`, `DashboardSuplementacao`.

Manutenção de dados e plataforma: `Backup` `RemoverDuplicados` `PopularCidades`
`GerenciarCidades` `EditorVisualSistema` `DiagnosticoDepositoCocho`.

Duplicatas do núcleo (D-PROD-06): `MapaPecuaria` `MapaMovimentacao`
`CadastroAreasReferencia` `AreasPastagem` `CadastroGado` `ControlePecuaria`
`GestaoPontosSuplementacao` `MovimentacoesLote` `HistoricoMovimentacoesPecuaria`
`ManejosTecnicosRebanho` `AplicacoesMedicamentos` `ConfiguracaoFatoresConsumo`
`LancamentosTarefas` `LancamentoTarefaForm` `TipoTarefaForm`
`GrupoAtividadeForm`.

`TipoTarefaForm` e `GrupoAtividadeForm` não tinham nenhum referenciador
(`grep` por `createPageUrl`/`navigate` retornou zero) e duplicavam
`FormularioTipoTarefa` / `FormularioGrupoAtividade`, já embutidos nas páginas de
listagem.

---

## Componentes e bibliotecas

### Diretórios eliminados por completo

`src/components/areas` · `custos` · `editor` · `email` · `embarque` · `folha` ·
`fornecedores` · `manejo` · `maquinas` · `movimentacoes` · `movimentacoes/utils` ·
`movimentacoes-pecuaria` · `operacoes` · `pecuaria` · `pesagens` · `relatorios` ·
`relatorios/consumoInteligente` · `sanidade` · `shared`

Mais `src/components/PWAInstaller.jsx` e `src/components/ProtectedRoute.jsx`
(sem consumidores).

### Diretórios reduzidos

`bebedouros` (5) · `categorias-manejo` (2) · `common` (15) · `dynamic` (3) ·
`filters` (2) · `financeiro` (2) · `lotes` (26) · `mapa` (35) · `offline` (2) ·
`produtos` (3) · `setores` (2) · `suplementacao` (16) · `tarefas` (3) ·
`tipos-tarefa` (2) · `grupos-atividades` (3) · `usuarios` (3) · `empresa` (2) ·
`marcas` (2) · `categorias-produto` (2) · `configuracoes` (1) · `utils` (2)

`src/components/ui/**` foi **preservado integralmente** por decisão da missão,
mesmo com componentes temporariamente sem uso.

### Removidos do shell (`src/Layout.jsx`)

Clima (open-meteo), `SendEmailDialog`, sino de notificações, `MobileSyncAction` +
`SyncManager` + `SyncProgressDialog` (sincronização mobile genérica, sincronizava
`Apartacao`/`LoteApartacao`/sanidade — fora do escopo), menu dinâmico por
`localStorage`, `DEFAULT_MENU` duplicado, submenu de 3 níveis, ícones e imports
mortos. A busca global permanece, mas agora só enxerga páginas permitidas.

### Bibliotecas e serviços removidos

`src/api/entities.js` · `src/api/integrations.js` (ambos sem importadores) ·
`src/lib/NavigationTracker.jsx` · `src/lib/VisualEditAgent.jsx` ·
`src/lib/designSystemStandards.js` · `src/lib/reportNameResolvers.js` ·
`src/services/estoqueService.js` · `src/services/layoutService.js` ·
`src/services/pesagemService.js` · `src/services/dynamicRecordService.js` ·
`src/services/dynamicRulesEngine.js` · `src/config/dynamicFieldSources.js` ·
`src/config/pesagensConfig.js` · `src/hooks/useBebedouroSanidade.js` ·
`src/hooks/useDoubleTap.js` · `src/types/bebedouro.js` ·
`src/entities/*.json` (7 specs legadas sem importadores) ·
`src/functions/seedPesagemLayout.js` · `src/public/{sw.js,manifest.json,offline.html}`
(não servidos: o `publicDir` do Vite é a raiz `public/`, que não existe) ·
`src/assets/react.svg`.

`src/hooks/use-mobile.jsx` foi **restaurado** após a exclusão: é importado por
`src/components/ui/sidebar.jsx`, que a missão manda preservar.

### Gates antigos na raiz

`gate-apis.mjs` `gate-base44.mjs` `gate-indices.mjs` `gate-tenancy.mjs`
`verify-all.mjs` e `files.zip` foram removidos da raiz. Os três primeiros
verificavam `backend/prisma/schema.prisma`, que não existe; voltam como gates de
P1/P3 (`docs/engineering/GATE-REGISTRY.md`). O ratchet foi reescrito em
`scripts/gates/gate-base44-ratchet.mjs`.

---

## Entidades Base44

### KEEP — 38

| Entidade | Papel | Evidência |
|---|---|---|
| `AreaPastagem` | KEEP_CORE | `MapaCadastro`, `mapaOfflineCache`, renderizador |
| `PontoReferencia` | KEEP_CORE | `MapaCadastro`, renderizador de pontos |
| `PontoSuplementacao` | KEEP_CORE | Cochos e depósitos do mapa |
| `LinhaGeografica` | KEEP_CORE | Linhas geográficas do mapa |
| `Lote` | KEEP_CORE | `DetalhesLote`, `CadastroLotes`, renderizador |
| `MovimentacaoMapa` | KEEP_CORE | Movimentação de lote entre áreas |
| `ConfiguracaoIcone` | KEEP_CORE | Ícones de área, ponto, cocho, depósito e lote |
| `Setor` | KEEP_CORE | `useSetorAreas`, `CadastroSetores` |
| `CategoriaManejo` | KEEP_CORE | Mudança de categoria, coloração e filtros |
| `SuplementacaoEvento` | KEEP_CORE | Lançamento de suplementação |
| `SuplementacaoLote` | KEEP_CORE | Suplementação por lote em `DetalhesLote` |
| `EstoqueLoteNota` | KEEP_CORE | Estoque dos cochos/depósitos |
| `MovimentacaoEstoque` | KEEP_CORE | Transferência de depósito no mapa |
| `LancamentoTarefa` | KEEP_CORE | Painel de tarefas do mapa |
| `HistoricoLancamentoTarefa` | KEEP_CORE | Histórico de tarefa no mapa |
| `Bebedouro` `BebedouroHistorico` `BebedouroAlerta` `BebedouroSanidade` | KEEP_CORE | Camada de bebedouros e seus detalhes |
| `ManejoTecnicoRebanho` `EventoSanitario` `AplicacaoMedicamento` | KEEP_CORE | Manejo técnico/sanitário no cache do mapa |
| `MovimentacaoPecuaria` | KEEP_SUPPORT | `consumoUtils`, `loteRepository`, `FormularioLancamentoSuplementacao` |
| `Produto` `LocalEstoque` `UnidadeMedida` `Categoria` `Marca` | KEEP_SUPPORT | Cadeia de suplementação e formulário de produto |
| `TipoTarefa` `GrupoAtividade` | KEEP_SUPPORT | Configuração das tarefas do mapa |
| `Empresa` `User` `Permissao` | KEEP_SUPPORT | Tenant operacional, autenticação e permissão |
| `RegistroAnexo` | KEEP_SUPPORT | Anexos de lote (`RegistroAnexosDialog`) |
| `Fornecedor` | KEEP_SUPPORT | `loteRepository.listFornecedores` alimenta `FormularioLote` quando o motivo de entrada é COMPRA |
| `LayoutCampo` `LayoutSecao` `LayoutConfiguracao` | KEEP_SUPPORT | Formulário dinâmico de lote (`loteRepository`, `campoEngine`) |

### DELETE — 49

`AbastecimentoMaquina` `Apartacao` `BaixaFinanceira` `BebedouroAnexo`
`CampoPersonalizado` `CentroCusto` `Cidade` `ConfiguracaoSanidade`
`ContaBancaria` `ContaFinanceira` `ControleArea` `CustoSafra`
`DocumentoEmbarque` `Embarque` `FatorConsumoCategoria` `FichaPersonalizada`
`FolhaConfiguracao` `FolhaFicha` `FolhaFuncionario` `FormLayout` `FormPanel`
`FormPanelField` `FormaPagamento` `GrupoFinanceiro` `HistoricoEntrega`
`HistoricoTarefaMapa` `Implemento` `ItemSanidade` `LancamentoFinanceiro`
`LayoutTabelaColuna` `LayoutVersao` `LivroFiscal` `LoteAnimaisCotacao`
`LoteApartacao` `ManutencaoMaquina` `Maquina` `MotivoCompra`
`MovimentacaoBancaria` `OperacaoAgricola` `Pesagem` `PesagemIndividual`
`PlanoAcao` `PlanoContas` `ProdutoCotacao` `Safra` `SanidadeAnimal` `TarefaMapa`
`TipoAtivo` `TipoDocumento`

Casos que exigiram leitura, não só nome:

- `FatorConsumoCategoria` aparecia na lista de investigação, mas só era lida por
  `src/components/offline/CacheManager.jsx` (arquivo morto) e citada em
  `entityDeleteGuards`. A cadeia de consumo do mapa (`consumoUtils`) **não** a
  usa. Excluída, junto com a página `ConfiguracaoFatoresConsumo`.
- `TarefaMapa` e `HistoricoTarefaMapa` existiam apenas em `entityDeleteGuards`.
  O painel real do mapa usa `LancamentoTarefa` e `HistoricoLancamentoTarefa`.
- `Pesagem` sobrevive apenas como **string de tipo de movimentação**
  (`mov.tipo === 'Pesagem'` em `HistoricoMovimentacoes`), não como entidade.
  `base44.entities.Pesagem` foi removida de `Produtos.jsx`.
- `Cidade` sobrevive apenas como **rótulo de campo/coluna**, nunca como entidade.
- `BebedouroAnexo` tinha zero referências; os anexos de bebedouro passam por
  `RegistroAnexo`.

Ajustes de código exigidos por essa limpeza:
`src/lib/entityDeleteGuards.js` (regras de domínios removidos apagadas),
`src/pages/Produtos.jsx` (numeração global deixou de ler `Pesagem`/`Fornecedor`;
guarda de exclusão por `CustoSafra` removida),
`src/components/lotes/camposConfigOptions.jsx` (`CentroCusto` removido das
entidades relacionais).

---

## Functions Base44

| Function | Estado | Chamadores |
|---|---|---|
| `syncEntityReferences` | **KEEP** | `src/core/repositories/loteRepository.js:66`, `src/pages/CadastroSetores.jsx:89`, `src/pages/TiposTarefa.jsx:45`, `src/pages/Produtos.jsx:146`, `src/pages/GruposAtividades.jsx:39` |
| `backfillHistoricoMovimentacoesRefs` | DELETE | 0 chamadores |
| `corrigirDuplicidadePasto08` | DELETE | 0 chamadores |
| `diagnosticarKm08C` | DELETE | 0 chamadores |
| `exportAllData` | DELETE | 0 chamadores (era `Backup`) |
| `exportBackupZip` | DELETE | 0 chamadores (era `Backup`) |
| `importBackup` | DELETE | 0 chamadores (era `Backup`) |
| `migrateStockData` | DELETE | 0 chamadores |
| `pwaServiceWorker` | DELETE | 0 chamadores; PWA fora do escopo |
| `relinkSetorCategoriaReferences` | DELETE | 0 chamadores |
| `removerDuplicados` | DELETE | 0 chamadores (era `RemoverDuplicados`) |

## Integrações Base44

`src/api/integrations.js` exportava `InvokeLLM`, `SendEmail`, `SendSMS`,
`UploadFile`, `GenerateImage` e `ExtractDataFromUploadedFile`. O arquivo não
tinha **nenhum importador** e foi excluído. O `SendEmailDialog` que usava
`SendEmail` saiu junto com o Layout. O upload de anexo preservado usa
`base44.integrations.Core.UploadFile` diretamente nos componentes de anexo e
ícone — 6 ocorrências restantes contra 24 no baseline.

---

## Rotas e menu

Rotas: `src/App.jsx` deixou de importar 12 páginas manualmente. Restam as 16
rotas geradas de `pages.config.js`, a raiz `/` (redireciona para `/MapaGeral`) e
o catch-all `PageNotFound`. `allowedManualRoutes` é `[]` no manifesto.

Menu final (`src/lib/menuConfig.js`, SSOT único — D-PROD-09):

```
Mapa              → Mapa Geral · Cadastro do Mapa
Manejo            → Lotes · Setores · Categorias de Manejo · Bebedouros
Suporte do Mapa   → Produtos · Categorias de Produto · Marcas · Unidades de Medida
                    Locais de Estoque · Tipos de Tarefa · Grupos de Atividades
Administração     → Empresa · Usuários e Permissões · Configurações Gerais
```
