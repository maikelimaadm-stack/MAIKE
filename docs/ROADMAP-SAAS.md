# MAKGESTAO — Roadmap de Independência da Base44

Documento de trabalho. Destino: `docs/ROADMAP-SAAS.md` no repositório MAKGESTAO, branch `saas-migration`.

---

## 1. Objetivo

Tornar o MAKGESTAO um sistema completo e independente, com o mesmo padrão arquitetural já validado no PROJETOMG, e remover integralmente a dependência da Base44.

O PROJETOMG **não é o destino dos dados**. É o **molde arquitetural** — a referência de como fazer.

---

## 2. Decisões travadas

| # | Decisão | Valor |
|---|---|---|
| D-01 | Tenancy atual | Cliente único (operação própria) |
| D-02 | Migração de dados | Todos os registros recebem o mesmo `cliente_id` |
| D-03 | Etapa de desambiguação | **Não necessária** |
| D-04 | Branch de trabalho | `saas-migration` |
| D-05 | Ponto de retorno | tag `base44-freeze` na `main` |
| D-06 | Stack backend | Fastify + Prisma + PostgreSQL (espelha PROJETOMG) |
| D-07 | Estratégia de corte | Shim de compatibilidade, migração módulo a módulo |

**Consequência de D-01/D-02:** a Fase 2 é limpa. Mas o `cliente_id` entra em **todos** os models desde o primeiro dia, mesmo com um cliente só. Retrofitar tenancy depois é o erro mais caro possível.

---

## 3. Inventário do legado

### Volume

| Métrica | Valor |
|---|---|
| Arquivos | 582 |
| Linhas em `src/` | 116.217 |
| Entidades Base44 | 87 |
| Campos totais nas entidades | 1.332 |
| Entidades com `empresa_id` | 68 |
| Páginas | 102 |
| Funções de backend | 11 |
| Chamadas ao SDK | 2.801 |
| Repositórios existentes | 2 |

### Distribuição das chamadas ao SDK

| Método | Ocorrências |
|---|---|
| `.filter()` | 1.809 |
| `.list()` | 516 |
| `.create()` | 183 |
| `.update()` | 182 |
| `.delete()` | 102 |
| `.bulkCreate()` | 9 |

### Integrações em uso

| Integração | Usos | Substituto |
|---|---|---|
| `UploadFile` | 17 | Supabase Storage |
| `SendEmail` | 7 | Resend ou SES |
| `InvokeLLM` | 3 | Chamada direta à API do modelo |
| `SendSMS` | 0 | Descartar |
| `GenerateImage` | 0 | Descartar |
| `ExtractDataFromUploadedFile` | 0 | Descartar |

### Ponto crítico

Existem **2 repositórios para 87 entidades**. As 2.801 chamadas ao SDK estão majoritariamente dentro de componentes React. Não há camada de acesso a dados. Este é o principal custo do projeto e a razão pela qual o shim (Fase 3) é obrigatório.

---

## 4. Decomposição em módulos de domínio

As 87 entidades agrupadas em 14 módulos + camada de plataforma.

| Módulo | Entidades |
|---|---|
| **rebanho** | Lote, Apartacao, LoteApartacao, MovimentacaoPecuaria, CategoriaManejo, ManejoTecnicoRebanho, Marca |
| **pesagem** | Pesagem, PesagemIndividual |
| **sanidade** | SanidadeAnimal, EventoSanitario, ItemSanidade, ConfiguracaoSanidade, AplicacaoMedicamento |
| **mapa** | MovimentacaoMapa, TarefaMapa, HistoricoTarefaMapa, PontoReferencia, LinhaGeografica, AreaPastagem, ControleArea, Setor |
| **bebedouros** | Bebedouro, BebedouroHistorico, BebedouroAlerta, BebedouroAnexo, BebedouroSanidade |
| **suplementacao** | PontoSuplementacao, SuplementacaoEvento, SuplementacaoLote, FatorConsumoCategoria |
| **estoque** | MovimentacaoEstoque, EstoqueLoteNota, LocalEstoque, Produto, UnidadeMedida, Categoria |
| **financeiro** | LancamentoFinanceiro, BaixaFinanceira, ContaFinanceira, ContaBancaria, MovimentacaoBancaria, GrupoFinanceiro, PlanoContas, CentroCusto, FormaPagamento, LivroFiscal, CustoSafra |
| **maquinas** | Maquina, AbastecimentoMaquina, ManutencaoMaquina, Implemento, TipoAtivo |
| **tarefas** | LancamentoTarefa, HistoricoLancamentoTarefa, TipoTarefa, GrupoAtividade, PlanoAcao |
| **comercial** | Embarque, DocumentoEmbarque, HistoricoEntrega, ProdutoCotacao, LoteAnimaisCotacao, MotivoCompra, Fornecedor |
| **folha** | FolhaFicha, FolhaFuncionario, FolhaConfiguracao, FichaPersonalizada |
| **agricola** | OperacaoAgricola, Safra |
| **cadastros** | Cidade, TipoDocumento, ConfiguracaoIcone |
| **plataforma** | Empresa, User, Permissao, RegistroAnexo |

### Meta-entidades — não portar

Estas 11 são infraestrutura de layout, não domínio. O motor **MDP do PROJETOMG já cobre essa função genericamente**:

`LayoutCampo` · `LayoutSecao` · `LayoutConfiguracao` · `LayoutTabelaColuna` · `LayoutVersao` · `FormLayout` · `FormPanel` · `FormPanelField` · `CampoPersonalizado` · `FichaPersonalizada` · `ConfiguracaoIcone`

Avaliar caso a caso: portar como model próprio só se o MDP não cobrir o caso de uso. O caminho preferido é mapear para `MdpRegistryEntry` / `MdpField`.

**Isso reduz o escopo real de ~87 para ~76 entidades de domínio.**

---

## 5. O molde: o que copiar do PROJETOMG

Trabalho já validado. Não redesenhar.

| Ativo | Origem no PROJETOMG |
|---|---|
| Servidor | `backend/src/server.js` |
| Padrão de módulo | `backend/src/modules/<dominio>/{routes,services,repositories}` |
| Repositório com fallback | `backend/src/modules/empresas/repositories/empresaRepository.js` |
| Camada de tenant | models `Cliente`, `Usuario`, `PermissaoEmpresa`, `ClienteModulo` |
| Auditoria | model `AuditLog` |
| Numeração | models `EntidadeCodigoSequencia`, `RegistroGlobal` |
| Contratos de UI | `src/apis/{auth,empresa,anexos,http}` |
| Framework de cadastro | `src/framework/cadastro/*` |
| Deploy | `railway.json`, `render.yaml`, `Dockerfile.railway` |
| Padrão de migration | `backend/prisma/migrations/*` (18 exemplos) |

---

## 6. Fases

### Fase 1 — Fundação

Criar `backend/` no MAKGESTAO copiando o esqueleto do PROJETOMG. Schema Prisma **somente** com a camada de tenant. Nenhuma entidade de domínio ainda.

**Entregável:** servidor sobe, autentica um usuário, responde health check.

**Critério de aceite:** `npm run prisma:validate` passa; `POST /auth/login` retorna token válido; nenhum import de `@base44/sdk` no backend.

---

### Fase 2 — Schema de domínio

Gerar os models Prisma a partir dos 87 arquivos em `base44/entities/*.jsonc`.

**Regras invioláveis:**

1. Todo model recebe `cliente_id String @db.VarChar(64)` — sem exceção, mesmo com cliente único
2. Todo model recebe relação `cliente Cliente @relation(...) onDelete: Cascade`
3. Todo índice de consulta é **composto começando por `cliente_id`**
4. Entidades com `empresa_id` (68 delas) mantêm o campo, agora como FK real para `Empresa`
5. Chaves únicas de negócio viram `@@unique([cliente_id, ...])`, nunca `@unique` isolado
6. Meta-entidades de layout: avaliar mapeamento para MDP antes de criar model

**Entregável:** `schema.prisma` completo, migration inicial aplicada.

**Critério de aceite:** `prisma validate` passa; nenhum model sem `cliente_id`; nenhum índice de consulta sem `cliente_id` como primeira coluna.

---

### Fase 3 — Shim de compatibilidade

O passo que evita reescrever 2.801 chamadas de uma vez.

Criar um cliente com **assinatura idêntica** à do SDK da Base44, apontando para o backend próprio:

```js
// src/api/makClient.js
export const mak = {
  entities: new Proxy({}, {
    get: (_, entityName) => ({
      list:       (sort, limit)   => http.get(`/api/${entityName}`, { sort, limit }),
      filter:     (where, sort)   => http.get(`/api/${entityName}`, { where, sort }),
      get:        (id)            => http.get(`/api/${entityName}/${id}`),
      create:     (data)          => http.post(`/api/${entityName}`, data),
      update:     (id, data)      => http.patch(`/api/${entityName}/${id}`, data),
      delete:     (id)            => http.del(`/api/${entityName}/${id}`),
      bulkCreate: (rows)          => http.post(`/api/${entityName}/bulk`, rows),
    })
  }),
  auth: { /* me, login, logout */ },
  integrations: { Core: { /* UploadFile, SendEmail, InvokeLLM */ } },
};
```

Trocar **um import** em `src/api/base44Client.js` e os 102 pages passam a rodar na infra própria sem alteração de componente.

Preservar os wrappers já existentes: `installTextNormalization`, `applyDeleteGuards`, `installOfflineEntitySync`.

**Entregável:** shim funcional; ao menos um módulo lendo e gravando no backend próprio.

**Critério de aceite:** app sobe sem `@base44/sdk` no runtime de um módulo piloto; CRUD completo funciona ponta a ponta.

---

### Fase 4 — Migração módulo a módulo

Ordem sugerida — do menor risco ao maior:

1. `cadastros` (Cidade, TipoDocumento) — valida o padrão
2. `estoque` — Produto, UnidadeMedida, Categoria
3. `maquinas`
4. `tarefas`
5. `bebedouros`
6. `suplementacao`
7. `sanidade`
8. `agricola`
9. `folha`
10. `comercial`
11. `mapa`
12. `pesagem`
13. `financeiro` — maior volume de regra de negócio
14. `rebanho` — coração do sistema, migrar por último

Cada módulo, ao ser migrado, sai do shim genérico e passa a usar contrato próprio em `src/apis/<modulo>/`.

**Critério de aceite por módulo:** zero chamadas diretas ao SDK nos componentes daquele módulo; toda leitura/escrita passa por `src/apis/`.

---

### Fase 5 — Endurecimento

Só depois que o sistema roda inteiro na infra própria.

- **RLS no PostgreSQL** — policies em todos os models, com `cliente_id` vindo do contexto de sessão. Rede de proteção contra vazamento entre clientes.
- **Autenticação real** — eliminar `requiresAuth: false`; sessão, refresh token, expiração
- **Autorização** — reaproveitar `PermissaoEmpresa` do molde
- **Migração das 11 functions** — avaliar quais viram endpoint, quais viram job, quais são descartáveis
- **Rate limiting** e proteção de endpoints
- **Observabilidade** — logs estruturados, métricas, alertas
- **Backup automatizado** e teste de restore
- **Billing** — só quando houver segundo cliente

---

### Fase 6 — Corte

- Remover `@base44/sdk` e `@base44/vite-plugin` do `package.json`
- Remover o plugin do `vite.config.js`
- Renomear `name` no `package.json` (hoje é `base44-app`)
- Arquivar a pasta `base44/` como referência histórica
- Exportar e arquivar os CSVs finais da Base44
- Encerrar a conta

---

## 7. Riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| Model sem `cliente_id` | Alta | Regra de lint na Fase 2; revisão do schema antes da migration |
| Query sem filtro de tenant | Alta | RLS na Fase 5 como rede de segurança |
| Perda de dados na exportação | Alta | Exportar CSVs **antes** de tudo; validar contagem de registros |
| `.filter()` com semântica divergente | Média | Testar o shim contra o comportamento real do SDK antes da Fase 4 |
| Regra de negócio escondida em componente | Média | Migrar módulo por módulo, nunca em lote |
| Escopo inflar via meta-entidades | Média | Decidir MDP vs model próprio antes de codar |

---

## 8. Pré-requisitos antes de começar

- [ ] Exportar CSV de todas as coleções da Base44
- [ ] Validar contagem de registros por coleção
- [ ] Clonar MAKGESTAO e PROJETOMG lado a lado
- [ ] Criar tag `base44-freeze` na `main`
- [ ] Criar branch `saas-migration`
- [ ] Tornar ambos os repositórios privados
- [ ] Provisionar PostgreSQL de desenvolvimento
