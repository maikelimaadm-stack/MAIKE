# MAIKE-TIPO-ATIVIDADE-DEFAULTS — contrato da Fatia 1 do Lançamento de Atividades

> **fatia 1 · `feat/tipo-atividade-defaults` · PR (a abrir)**
>
> Decisão: **D-PROD-195** (a `main` indica `Próxima decisão: D-PROD-195`). O número não entra no `migration.sql`.
> Este contrato é a fonte única dos agentes A1–A6. Divergência de código em relação a ele é defeito.

## 1. O que é

O Tipo de Atividade (`TipoAtividade`, D-PROD-182) passa a guardar os **padrões** que a atividade herda e as
**flags** de como ela funciona. É a base das Fatias 2 a 4 (Atividade → Apontamento → itens). Nada aqui cria a
Atividade, nem muda o Apontamento de Atividade de hoje (D-PROD-190/193).

Pedido do proprietário (literal): "TipoAtividade ganha os defaults e as flags. É a base de tudo." e "ATENÇÃO: estas
flags são do TIPO DE ATIVIDADE, não do TipoTarefa. Elas foram removidas do TipoTarefa de propósito e é aqui que elas
fazem sentido: é o tipo de atividade que sabe se gradeação exige máquina e se aplicação de veneno permite produto."

### Não fazer (vale para todos os agentes)
- Não reintroduzir flag nenhuma no `TipoTarefa` (D-PROD-181/183). As chaves `pode_ter_produto`, `pode_ter_maquina` e
  `pode_ter_implemento` continuam recusadas (400) em `/tipos-atividade` e em `/tipos-tarefa` segue valendo a D-PROD-181.
- Não criar cadastro de unidade: a unidade de produção é `UnidadeMedida`.
- Não mexer em `AbastecimentoBem`, `LancamentoTarefa`, `ApontamentoAtividade`/itens (comportamento de hoje intacto).
- Nada visual/estético. Só componentes que já existem; nenhum componente visual novo; nenhuma classe/estilo novo.
- Não aplicar migration em banco remoto. Nada de deploy.

## 2. Banco (pronto — não editar sem re-pinar)

`backend/prisma/schema.prisma` (model `TipoAtividade` + relações inversas em `CentroCusto.tiposAtividadePadrao`,
`CentroResultado.tiposAtividadePadrao`, `UnidadeMedida.tiposAtividadeProducao`) e a migration
`backend/prisma/migrations/20261114200000_tipo_atividade_defaults/migration.sql` já estão escritos e aplicam num banco
vazio (50 migrations); `prisma migrate diff` banco × schema = vazio.

| Coluna | Tipo | Regra |
|---|---|---|
| `categoria` | `VARCHAR(24)` anulável | CHECK `TipoAtividade_categoria_check`: `PREPARO_SOLO`, `PLANTIO`, `TRATO_CULTURAL`, `APLICACAO`, `COLHEITA`, `PASTAGEM`, `BENFEITORIA`, `MANEJO_ANIMAL`, `OUTROS` |
| `centro_custo_padrao_id` | `VARCHAR(64)` anulável | FK `TipoAtividade_cliente_id_centro_custo_padrao_id_fkey` (`cliente_id`, col) → `CentroCusto`(`cliente_id`, `id`) RESTRICT |
| `centro_resultado_padrao_id` | `VARCHAR(64)` anulável | FK `TipoAtividade_cliente_id_centro_resultado_padrao_id_fkey` → `CentroResultado` RESTRICT |
| `unidade_producao_id` | `VARCHAR(64)` anulável | FK `TipoAtividade_cliente_id_unidade_producao_id_fkey` → `UnidadeMedida` RESTRICT |
| `coeficiente_padrao` | `DECIMAL(14,4)` anulável | CHECK `TipoAtividade_coeficiente_padrao_check`: `> 0` (ex.: h/ha) |
| `exige_area`, `exige_safra`, `exige_maquina`, `permite_implemento`, `permite_produto`, `permite_servico`, `permite_mao_obra`, `exige_producao` | `BOOLEAN NOT NULL DEFAULT false` | linhas existentes leem `false` |

Índices novos (R10): `TipoAtividade_cliente_id_centro_custo_padrao_id_idx`,
`TipoAtividade_cliente_id_centro_resultado_padrao_id_idx`, `TipoAtividade_cliente_id_unidade_producao_id_idx`.
O unique `(cliente_id, grupo_atividade_id, nome_tipo)` é mantido.

**Modo CONTRACT (entrada fechada D-PROD-195).** A allowlist EXPAND não aceita, em tabela antiga, flag `NOT NULL
DEFAULT`, FK para tabela antiga nem CHECK. Mesmo caminho da D-PROD-162/183: guarda DO pinada como 1ª instrução,
`drop: []`, exatamente 18 `alter_antigas` (13 ADD COLUMN, 3 FK, 2 CHECK, nesta ordem), resto = 3 `CREATE INDEX`.
- `sha256` do arquivo: `b65d4f08de5f587cd69b893bcb2626df5cc775e1f4ca5b68fdaac863aab55dbf`
- `guarda_sha256`: `e15780190baf9494f20535c2e3ced21eb20ea6b8f362eeac0b2477dcf6dab3b0`
- `literais_guarda`: `['TipoAtividade', 'CentroCusto', 'CentroResultado', 'UnidadeMedida']`
- A guarda recusa (falha fechada) se: TipoAtividade não existe; qualquer das 13 colunas, das 5 constraints ou dos 3
  índices já existe; algum alvo das FKs não existe ou não tem índice único exatamente em (`cliente_id`, `id`).

## 3. API `/tipos-atividade` (mesmas rotas; leitura só autenticada; escrita pelas GUARDAS de hoje)

### 3.1 Corpo (POST e PATCH) — campos novos, todos opcionais

| Campo | Schema | Observação |
|---|---|---|
| `categoria` | `enum` dos 9 valores ou `null` | fora da lista → 400 |
| `centro_custo_padrao_id` | ID (`^[A-Za-z0-9_-]+$`, 1..64) ou `null` | |
| `centro_resultado_padrao_id` | ID ou `null` | |
| `unidade_producao_id` | ID ou `null` | |
| `coeficiente_padrao` | string `^\d{1,10}(\.\d{1,4})?$` ou `null` (o `PADRAO_DECIMAL` do apontamento) | `0`/`0.0000` → 422 (ver 3.3); número JSON → 400 |
| as 8 flags | `boolean` | **sem coerção**: valor não booleano no corpo BRUTO (`null`, `"true"`, `1`) → 400, como o `preValidation` da curva de ganho faz com número |

Recusas do corpo bruto (400 `REQUEST_VALIDATION_FAILED`): flag não booleana → `reason: 'valor_deve_ser_booleano'`;
coeficiente que não é texto nem `null` → `reason: 'valor_deve_ser_texto'`. O `preValidation` roda antes da guarda da
tela (400 antes de 403), como na curva de ganho.
`pode_ter_produto`, `pode_ter_maquina`, `pode_ter_implemento` e qualquer outra chave fora do schema → 400
(`additionalProperties: false`, como hoje). `exige_area` passa a ser campo válido (era chave legada recusada).
No POST, flag ausente = `false`; padrão ausente = `null`.

### 3.2 Resposta (`comoTipoPublico`) — campos novos

```json
{
  "categoria": "APLICACAO",
  "centro_custo_padrao_id": "…", "centro_custo_padrao": { "id": "…", "numero": "…", "nome": "…", "empresa_id": "…", "ativo": true },
  "centro_resultado_padrao_id": "…", "centro_resultado_padrao": { "id": "…", "numero": "…", "nome": "…", "empresa_id": "…", "ativo": true },
  "unidade_producao_id": "…", "unidade_producao": { "id": "…", "sigla": "HA", "descricao": "…", "ativo": true },
  "coeficiente_padrao": "1.5000",
  "exige_area": false, "exige_safra": false, "exige_maquina": true, "permite_implemento": true,
  "permite_produto": false, "permite_servico": false, "permite_mao_obra": false, "exige_producao": false
}
```
Sem padrão: `*_id: null` e o objeto `null`. `coeficiente_padrao` sai com 4 casas (`toFixed(4)`, como o apontamento).
Os objetos vêm do `include` do repository (lista e detalhe), sem N+1. Auditoria (`registrarEvento`) grava a forma pública.

### 3.3 Regras do serviço (422 `TIPO_ATIVIDADE_PADRAO_INVALIDO`, `field` e `reason` no corpo, como o `errorHandler` faz com todo código)

Conferidas **só quando o campo muda** (valor diferente do gravado; no POST, quando vem não nulo), dentro da transação:
- centro de custo / de resultado: tem de existir **no cliente** (`reason: 'nao_encontrado'` — id de outro cliente é
  indistinguível de inexistente) e estar **ativo** (`'inativo'`);
- os dois centros padrão, quando ambos ficam preenchidos (valor final), têm de ser **da mesma empresa**
  (`field: 'centro_resultado_padrao_id'`, `reason: 'empresas_diferentes'`) — confere sempre que um dos dois muda;
- unidade de produção: existe no cliente (`'nao_encontrado'`) e ativa (`'inativo'`);
- `coeficiente_padrao` igual a zero → `reason: 'nao_positivo'`.
Padrão que fica inativo DEPOIS de gravado continua no tipo (não é apagado nem revalidado num PATCH que não o toca).
Corrida com exclusão do cadastro: P2003 da FK nova na escrita do tipo → mesmo 422 `nao_encontrado` do campo.

### 3.4 Opções para o formulário (rota nova, escrita do tipo)

`GET /tipos-atividade/opcoes/centros-custo?empresa_id=…` e `GET /tipos-atividade/opcoes/centros-resultado?empresa_id=…`
→ `{ "itens": [{ "id", "numero", "nome" }] }`: só os **ativos** da empresa, ordenados pelo **valor numérico** de `numero`
(o número da sequência guardado como texto; números que não são só dígitos vêm por último, por texto), no máximo 1000
— o corte de 1000 é feito na mesma ordem, no SQL
(o teto de ativos por empresa da gestão). Guarda: quem pode **criar ou editar** tipo de atividade (não depende das
telas de centros, como as opções do apontamento). `empresa_id` validado contra o cliente do `auth_context` (outra
empresa / outro cliente → 404 da empresa, como no resto do repo). Rota nova entra em `config/mapa-manejo-scope.json`
se o gate de escopo exigir. Unidades: o formulário usa `GET /unidades-medida` (já é só autenticada).

### 3.5 "Preparar o terreno" — padrões herdados na criação da atividade

Módulo puro `backend/src/modules/tiposAtividade/tipoAtividadePadroes.js` (sem Prisma, sem I/O):
- `CATEGORIAS_TIPO_ATIVIDADE` (as 9, congeladas) e `FLAGS_TIPO_ATIVIDADE` (as 8, nesta ordem);
- `padroesParaAtividade(tipo, { empresaId })` → `{ centro_custo_id, centro_resultado_id, unidade_producao_id, coeficiente }`:
  o centro só vale se existir, estiver **ativo** e for da **mesma empresa** da atividade; a unidade só vale se ativa;
  senão `null`. Recebe o tipo como o repository devolve (com os 3 objetos incluídos);
- `regrasDoTipo(tipo)` → objeto só com as 8 flags (booleanos; flag ausente sai `false`).
A Fatia 2 usa esses dois no "Abrir atividade". Nenhum fluxo de produção chama isto nesta fatia.

## 4. Exclusões e relações inversas

- `UnidadeMedida` tem exclusão física: com a FK nova, apagar a unidade usada como padrão gera P2003 →
  traduzir em **409 `UNIDADE_MEDIDA_DELETE_BLOCKED`** (código que o front já conhece; `details: { vinculo: 'tipo_atividade' }`) reconhecendo a constraint
  `TipoAtividade_cliente_id_unidade_producao_id_fkey` no erro (lição do hotfix #259: o módulo de unidade NUNCA consulta
  `TipoAtividade`). Hoje esse P2003 viraria o 403 enganoso do `errorHandler`.
- `CentroCusto`/`CentroResultado` não têm exclusão física (só inativação): nada a traduzir; inativar um centro usado
  como padrão é permitido (o padrão inativo deixa de ser herdado — 3.5).
- `TipoAtividade` segue com exclusão física (FK RESTRICT do apontamento → 409 de hoje).

## 5. Gate `gate:tarefa-cadastro-native`

Hoje proíbe `exige_area`/`pode_ter_*` em TipoAtividade (D-PROD-182). Passa a: **TipoAtividade** proíbe só
`pode_ter_produto`, `pode_ter_maquina`, `pode_ter_implemento` (nomes aposentados) e **exige** as 8 flags novas
`Boolean @default(false)`; **TipoTarefa** proíbe as 4 antigas **e** as 8 novas (não reintroduzir flag no TipoTarefa).
Registrar a mudança em `docs/engineering/GATE-REGISTRY.md`.

## 6. Frontend (só componentes existentes)

- Porta `src/apis/atividades/tipoAtividadePort.js` e `src/services/tipoAtividadeCadastroService.js`: os campos novos
  nos dois sentidos; `coeficiente_padrao` digitado no formato local da tela vira a string canônica da API.
- Formulário `FormularioTipoAtividade.jsx` em **3 seções**, nesta ordem, com o padrão de seção que já existe no Base1:
  1. **Identificação**: grupo, nome, categoria (lista com os 9 rótulos legíveis), descrição, ativo;
  2. **Apropriação**: centro de custo padrão, centro de resultado padrão (opções da fazenda selecionada, rota 3.4;
     sem fazenda selecionada, aviso existente e campos só leitura; padrão gravado de outra fazenda ou inativo aparece
     marcado e pode ser limpo);
  3. **Como funciona**: unidade de produção (de `UnidadeMedida`, ativas + a gravada), coeficiente padrão e as 8 flags
     como caixas de marcar (componente existente).
- Tabela `TabelaTiposAtividade.jsx`: coluna **Categoria** (rótulo legível) pelo mecanismo de colunas que já existe;
  se o conjunto de colunas muda, seguir a regra de versão da chave de preferência que o repo já usa.
- Mensagem de `TIPO_ATIVIDADE_PADRAO_INVALIDO` em `src/apis/_core/ApiError.js` (texto por `reason`).

### 6.1 Rótulos e test ids (fixos)

- Seções: títulos "Identificação", "Apropriação", "Como funciona"; `data-testid` `tipo-atividade-secao-identificacao`,
  `tipo-atividade-secao-apropriacao`, `tipo-atividade-secao-como-funciona`.
- Campos: "Categoria", "Centro de custo padrão", "Centro de resultado padrão", "Unidade de produção",
  "Coeficiente padrão".
- Categorias: `PREPARO_SOLO` "Preparo de solo", `PLANTIO` "Plantio", `TRATO_CULTURAL` "Trato cultural",
  `APLICACAO` "Aplicação", `COLHEITA` "Colheita", `PASTAGEM` "Pastagem", `BENFEITORIA` "Benfeitoria",
  `MANEJO_ANIMAL` "Manejo animal", `OUTROS` "Outros".
- Flags (caixas de marcar, nesta ordem): "Exige área", "Exige safra", "Exige máquina", "Permite implemento",
  "Permite produto", "Permite serviço", "Permite mão de obra", "Exige produção"; `data-testid`
  `tipo-atividade-flag-<nome_da_flag>` (ex.: `tipo-atividade-flag-exige_area`).

## 7. Testes exigidos

Backend (PostgreSQL real): defaults na criação (flags `false`, padrões `null`); flags gravando e lendo; categoria
inválida → 400; coeficiente inválido → 400/422; centro de outro cliente → 422 `nao_encontrado`; centro inativo → 422;
centros de empresas diferentes → 422 `empresas_diferentes`; unidade inexistente/inativa → 422; unicidade mantida;
chaves `pode_ter_*` → 400; `exige_area` aceita; flag não booleana → 400; resposta com os objetos incluídos; excluir
unidade usada como padrão → 409 `UNIDADE_MEDIDA_DELETE_BLOCKED`; opções 3.4 (só ativos da empresa, 403 sem
permissão, 404 empresa alheia); `padroesParaAtividade`/`regrasDoTipo` (mesma empresa herda; outra empresa, inativo ou
sem padrão → `null`). Migration em PostgreSQL real (guarda, linhas antigas intactas com `false`/`null`, FKs, CHECKs,
reaplicação recusada). Portão: entrada CONTRACT pinada e adulterações recusadas. Smoke: 3 seções, campos, flags, envio
da porta, tabela com Categoria. Schema × banco.

## 8. Governança

D-PROD-195 em `DECISIONS.md` (revê a D-PROD-182 só no ponto "TipoAtividade sem flags"; cita o pedido literal);
proposta de emenda da nota D-PROD-193 de `docs/constitution/07-DO-NOT-DO.md` (a proibição de
`exige_area`/`pode_ter_*` passa a valer para TipoTarefa e para o item do apontamento; o TipoAtividade tem as 8 flags da
D-PROD-195) — texto do agente, vale só com a aprovação do proprietário no merge (`00-CONSTITUICAO.md` §4);
`GATE-REGISTRY.md`; `CURRENT-STATE.md`; relatório `MAIKE-TIPO-ATIVIDADE-DEFAULTS-REPORT.md`; runbook
`MAIKE-TIPO-ATIVIDADE-DEFAULTS-RUNBOOK-RELEASE.md` (release CONTRACT isolada, `--contract D-PROD-195`, guarda do
caminho B contando 49 aplicadas antes e 50 depois, aplicar antes do merge).

## 9. Pontos para o proprietário (relatar, não decidir sozinho)

1. A Fatia 3 diz "só aparece se o tipo permite máquina", mas a lista de flags tem `exige_maquina` e não tem
   `permite_maquina` (máquina opcional). Hoje: máquina só quando `exige_maquina`. Acrescentar `permite_maquina` antes
   da migration ser aplicada custa só re-pinar.
2. Tipo é do cliente; centro é da fazenda. Com mais de uma fazenda, o centro padrão vale só para a fazenda dele.
   Padrão por fazenda seria uma tabela filha (decidir na Fatia 2).

## 10. Divisão (arquivos de cada agente — não editar arquivo de outro)

| Agente | Arquivos |
|---|---|
| A1 banco/portão | `scripts/deploy/premergeMigrateLib.mjs`, `scripts/tests/deploy/*`, `backend/tests/tipoAtividadeDefaultsMigration.test.mjs` (novo), contagens de migrations (`scripts/ops/sql-editor/*`, testes que contam 49), `scripts/tests/run-backend-tests.mjs` (dica), `scripts/gates/gate-tarefa-cadastro-native.mjs`, `docs/engineering/GATE-REGISTRY.md`, runbook |
| A2 backend | `backend/src/modules/tiposAtividade/*`, `backend/src/modules/unidadesMedida/unidadeMedidaService.js`, `backend/src/shared/errors/*`, `backend/src/shared/auth/guardasRotas.js` (se precisar), `backend/src/app.js` (se precisar), `config/mapa-manejo-scope.json` (se precisar) |
| A3 frontend | `src/apis/atividades/*`, `src/services/tipoAtividadeCadastroService.js`, `src/components/tipos-atividade/*`, `src/pages/TiposAtividade.jsx`, `src/apis/_core/ApiError.js` |
| A4 testes | `backend/tests/tipoAtividadeNativo.test.mjs`, `backend/tests/tipoAtividadePadroes.test.mjs` (novo), teste de exclusão de unidade, `tests/smoke/tiposAtividade.test.jsx` |
| orquestrador | `schema.prisma`, `migration.sql`, este contrato, `DECISIONS.md`, constituição, `CURRENT-STATE.md`, relatório |
