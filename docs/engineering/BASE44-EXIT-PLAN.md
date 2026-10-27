# Plano de saída da Base44 (MAIKE nativo)

**Atualizado em:** 2026-10-27  
**Decisão:** D-PROD-44  
**Catraca:** `npm run gate:base44` — todo PR deve **reduzir** ao menos um eixo.

## Estado após P5.0 (cadastro de tarefas)

| Camada | Nativo | Ainda Base44 |
|---|---|---|
| Auth / sessão app | JWT + `/auth/login`, `/auth/contexto` | `fetchPublicSettings`, token SDK para **dados** |
| Usuário atual (Layout) | `/auth/contexto` | — |
| Mapa geográfico | Setor, AreaPastagem, pontos, linhas, ícones | PontoSuplementacao, MovimentacaoMapa, Bebedouro, … |
| Cadastros suporte | Marca, UnidadeMedida, GrupoAtividade, TipoTarefa, **Categoria**, **LocalEstoque**, **Produto** | Empresa, CategoriaManejo, Fornecedor, … |
| Manejo / lançamentos | **Lote**, **LancamentoTarefa** + histórico | movimentações mapa/pecuária, CategoriaManejo, suplementação, estoque |
| Admin | Usuario (contas) | Permissao, User (perfil legado), Empresa |
| Functions | — | `syncEntityReferences` |
| Infra | `base44Client`, vite-plugin, env `VITE_BASE44_*` | Até P7 |

## Ordem sugerida (desbloqueia testes de lançamentos)

1. ~~**TipoTarefa** + **GrupoAtividade**~~ — **feito (P5.0, D-PROD-45)**.
2. ~~**Lote** (cadastro)~~ — **feito (P5.1, D-PROD-47)**. Movimentações mapa/pecuária seguem Base44.
3. ~~**LancamentoTarefa** + histórico~~ — **feito (P5.3, D-PROD-49)**.
4. ~~**Produto**, **Categoria**, **LocalEstoque**~~ — **feito (P5.2, D-PROD-48)**.
5. ~~**Empresa**~~ — **feito (P5.4, D-PROD-50)**.
6. ~~**Permissao**~~ (CRUD menu) — **feito (P5.4)**; refinamentos P6.
7. ~~**MovimentacaoEstoque** / **EstoqueLoteNota** / **PontoSuplementacao**~~ — **feito (P5.4)**.
8. ~~**Fornecedor**, **CategoriaManejo**, **Bebedouro** (cadastro)~~ — **feito (P5.4)**.
9. **SuplementacaoEvento/Lote**, **MovimentacaoMapa/Pecuaria** — próximo PR.
7. **syncEntityReferences** — eliminar quando destinos denormalizados forem nativos.
8. **P7** — remover `@base44/sdk`, plugin Vite, `base44Client`, schemas órfãos.

## Um PR = uma capacidade

Seguir molde: model Prisma + migration + módulo Fastify + `*NativePort.js` + gate
`*-native` + atualizar `MIGRADAS_PARA_NATivo` nos testes + ratchet Base44.

## Produção

- Remover `VITE_SKIP_NATIVE_LOGIN` no projeto Vercel (revogado em código).
- Manter token Base44 (app) enquanto houver entidade no registry — hoje ainda
  necessário para lotes, tarefas e permissões.
