# CONTRATO — Fatia D do Apontamento de Atividade: ITENS (produto, serviço, outros custos)

> Documento do ARQUITETO para os agentes construtores. Branch `feat/apontamento-itens`, empilhada sobre
> `feat/apontamento-atividade` (PR #269, D-PROD-190; migration `20261113700000_apontamento_atividade` já
> aplicada em produção). Todos os caminhos são relativos a `/home/user/MAIKE`. Onde está "(VERIFICADO)", o
> arquiteto leu o código nesta branch (commit `93a26fa`).
>
> Número da decisão: **D-PROD-193**. Este contrato nasceu com a D-PROD-191, que era a próxima livre
> (`docs/engineering/DECISIONS.md:6817`, naquele commit); a D-PROD-190 já dizia que a Fatia D "terá número
> próprio" (`DECISIONS.md:6773`). A D-PROD-191 e a D-PROD-192 ficaram com a PR #271 (a #272 foi mergeada dentro
> dela), e a numeração final é a D-PROD-193 (nota "Numeração" da decisão). O `migration.sql` **não** cita o número
> da decisão (precedente da Fatia C: `20261113700000_apontamento_atividade/migration.sql:1-5`), então renumerar não
> muda o checksum.

---

## 0. Pré-condições de governança (bloqueiam o MERGE, não a construção)

1. **D-PROD-193 registrada** em `docs/engineering/DECISIONS.md` com as palavras do proprietário **literais**
   (o chat não é autoritativo: `CLAUDE.md:38`; `docs/constitution/08-REGRAS-DE-IA.md:22`). As duas decisões
   que o orquestrador repassou ("PRODUTO baixa o estoque igual ao abastecimento…"; "SERVIÇO/OUTRO: descrição
   livre + quantidade + valor unitário…") precisam ser coladas como o proprietário as escreveu.
2. **Texto constitucional**: hoje o abastecimento é "a **única** exceção" à lista "fora" da D-PROD-157, "só no
   trecho abastecimento/baixa de estoque de combustível" (`docs/constitution/00-CONSTITUICAO.md:56-57`); a
   lista "fora" inclui "baixa de estoque" e "qualquer efeito financeiro ou de estoque" (`00-CONSTITUICAO.md:43-46`).
   A Fatia D precisa de um parágrafo "Expansão autorizada pelo proprietário (D-PROD-193)" no `00 §1` e de uma
   nota no `07`, redigidos pelo agente e aprovados pelo proprietário no merge manual (rito de
   `00-CONSTITUICAO.md:34-35`, `:46-47`, `:59-60`; só o proprietário emenda: `00-CONSTITUICAO.md:161-165`;
   agente só propõe: `08-REGRAS-DE-IA.md:64`). Rascunho no Apêndice A.
3. **GO separado** para aplicar a migration em produção, **antes do merge/deploy** (precedentes D-PROD-188 e
   D-PROD-190: `DECISIONS.md:6765`, `:6788`). Ver risco R3.

---

## 1. Models Prisma (frente D1)

### 1.1 `ApontamentoAtividadeItem` (tabela nova)

Molde: `AbastecimentoBem` (`backend/prisma/schema.prisma:2680-2738`) e `ApontamentoAtividade`
(`schema.prisma:2793-2854`). Inserir logo **depois** do model `ApontamentoAtividade`.

```prisma
/// D-PROD-193 (Fatia D do apontamento) — ITEM de custo de um apontamento CONFIRMADO.
/// PRODUTO: baixa FÍSICA real pelo motor único (FIFO por lote; custo = Σ fatia × custo do lote; estorno exato).
/// SERVICO / OUTRO: descrição livre + quantidade + valor unitário; total calculado no servidor (Decimal, 4 casas);
/// sem cadastro de serviço, sem fornecedor, sem efeito de estoque nem financeiro.
/// Imutável: sem PATCH/DELETE; corrigir = cancelar (estorno) e lançar de novo. Sem centro próprio: vale o centro
/// de custo (snapshot, R-e) do cabeçalho.
model ApontamentoAtividadeItem {
  id                       String    @id @default(cuid())
  cliente_id               String    @db.VarChar(64)
  empresa_id               String    @db.VarChar(64)
  apontamento_id           String    @db.VarChar(64)
  /// 1..n dentro do apontamento (máx+1 sob a trava do apontamento; nunca reaproveitado).
  ordem                    Int
  /// PRODUTO | SERVICO | OUTRO (CHECK).
  tipo                     String    @db.VarChar(8)
  /// CONFIRMADO | CANCELADO (CHECK).
  status                   String    @db.VarChar(16)
  /// SERVICO/OUTRO: obrigatória; PRODUTO: nula (CHECK).
  descricao                String?   @db.VarChar(255)
  produto_id               String?   @db.VarChar(64)
  local_estoque_id         String?   @db.VarChar(64)
  /// PRODUTO: na unidade EFETIVA do estoque do Produto (L | KG; SACO guarda kg), sem conversão.
  quantidade               Decimal   @db.Decimal(14, 4)
  /// PRODUTO: 'L' | 'KG' (unidade efetiva); SERVICO/OUTRO: nula.
  unidade                  String?   @db.VarChar(4)
  /// PRODUTO: custo unitário FIFO do motor (4 casas); SERVICO/OUTRO: o digitado (até 12+6).
  valor_unitario           Decimal   @db.Decimal(18, 6)
  /// PRODUTO: custo total FIFO do motor; SERVICO/OUTRO: ROUND_HALF_UP(quantidade × valor_unitario, 4).
  valor_total              Decimal   @db.Decimal(18, 4)
  operation_id             String    @db.VarChar(128)
  movimentacao_estoque_id  String?   @db.VarChar(64)
  movimentacao_estorno_id  String?   @db.VarChar(64)
  criado_por_usuario_id    String?   @db.VarChar(64)
  cancelado_por_usuario_id String?   @db.VarChar(64)
  cancelado_em             DateTime?
  motivo_cancelamento      String?   @db.VarChar(500)
  /// ITEM (cancelado sozinho) | APONTAMENTO (cancelado junto com o apontamento) (CHECK).
  cancelamento_origem      String?   @db.VarChar(12)
  createdAt                DateTime  @default(now())
  updatedAt                DateTime  @updatedAt

  cliente             Cliente                               @relation(fields: [cliente_id], references: [id], onDelete: Restrict)
  apontamento         ApontamentoAtividade                  @relation(fields: [cliente_id, empresa_id, apontamento_id], references: [cliente_id, empresa_id, id], onDelete: Restrict, map: "ApontamentoAtividadeItem_apontamento_fkey")
  produto             Produto?                              @relation(fields: [cliente_id, produto_id], references: [cliente_id, id], onDelete: Restrict)
  localEstoque        LocalEstoque?                         @relation(fields: [cliente_id, local_estoque_id], references: [cliente_id, id], onDelete: Restrict)
  movimentacao        MovimentacaoEstoque?                  @relation("ApontamentoAtividadeItemMovimento", fields: [cliente_id, movimentacao_estoque_id], references: [cliente_id, id], onDelete: Restrict, map: "ApontamentoAtividadeItem_movimentacao_fkey")
  movimentacaoEstorno MovimentacaoEstoque?                  @relation("ApontamentoAtividadeItemEstorno", fields: [cliente_id, movimentacao_estorno_id], references: [cliente_id, id], onDelete: Restrict, map: "ApontamentoAtividadeItem_estorno_fkey")
  criadoPor           Usuario?                              @relation("ApontamentoAtividadeItemCriadoPor", fields: [cliente_id, criado_por_usuario_id], references: [cliente_id, id], onDelete: Restrict, map: "ApontamentoAtividadeItem_criado_por_fkey")
  canceladoPor        Usuario?                              @relation("ApontamentoAtividadeItemCanceladoPor", fields: [cliente_id, cancelado_por_usuario_id], references: [cliente_id, id], onDelete: Restrict, map: "ApontamentoAtividadeItem_cancelado_por_fkey")
  consumos            ApontamentoAtividadeItemConsumoLote[]

  @@unique([cliente_id, id])
  @@unique([cliente_id, empresa_id, id])
  @@unique([cliente_id, operation_id])
  @@unique([cliente_id, apontamento_id, ordem], map: "ApontamentoAtividadeItem_apontamento_ordem_key")
  @@unique([cliente_id, movimentacao_estoque_id], map: "ApontamentoAtividadeItem_movimentacao_key")
  @@unique([cliente_id, movimentacao_estorno_id], map: "ApontamentoAtividadeItem_estorno_key")
  @@index([cliente_id, produto_id])
  @@index([cliente_id, local_estoque_id])
}
```

Notas de desenho:
- **Sem FK direta para `Empresa`**: a FK composta `(cliente_id, empresa_id, apontamento_id)` →
  `ApontamentoAtividade(cliente_id, empresa_id, id)` já amarra tenant e empresa (o unique alvo existe:
  `20261113700000_apontamento_atividade/migration.sql:86`), e o apontamento já tem FK para Empresa (`:95`).
  Precedente: `AbastecimentoBemConsumoLote` tem `empresa_id` sem FK para Empresa (`schema.prisma:2745-2766`).
  Isso também evita mexer no `empresaService` (o item nunca existe sem apontamento, que já barra a exclusão).
- **`map:` explícito** onde o nome padrão do Prisma passaria de 63 bytes ou ficaria ambíguo (ex.:
  `ApontamentoAtividadeItem_cliente_id_cancelado_por_usuario_id_fkey` teria 65). Os padrões que ficam
  (`…_cliente_id_id_key` 41, `…_cliente_id_empresa_id_id_key` 53, `…_cliente_id_operation_id_key` 52,
  `…_cliente_id_produto_id_idx` 50, `…_cliente_id_local_estoque_id_idx` 56, `…_cliente_id_fkey` 40,
  `…_cliente_id_produto_id_fkey` 51, `…_cliente_id_local_estoque_id_fkey` 57) cabem.
- O unique `(cliente_id, apontamento_id, ordem)` serve a leitura "itens do apontamento" (prefixo
  `cliente_id, apontamento_id`); não há índice extra.
- Todos os índices/uniques começam por `cliente_id` (R10, `gate:indices` posicional:
  `scripts/gates/gate-indices.mjs:8-12`).

### 1.2 `ApontamentoAtividadeItemConsumoLote` (tabela nova; o motor EXIGE)

O estorno exato precisa das fatias por lote com FK (`DECISIONS.md:5751`; X1 em `:5758`; reconciliação
`ORIGENS_COM_FK` em `backend/src/modules/estoqueFisico/reconciliacaoEstoque.js:139`). O JSON
`lotes_consumidos` do movimento não basta (é o caminho "sem FK" da suplementação, `reconciliacaoEstoque.js:137`).
Molde exato: `AbastecimentoBemConsumoLote` (`schema.prisma:2745-2766`; DDL
`20261110300000_patrimonio_simplifica/migration.sql:291-304`, `:394-400`, `:458-462`, `:496`).

```prisma
/// D-PROD-193 — fatia FIFO consumida pelo item PRODUTO: de qual lote, quanto (na unidade do item, L ou KG) e a
/// que custo, na ordem FIFO. O cancelamento devolve cada fatia ao SEU lote (Σ quantidade = `quantidade` do item,
/// conferido no serviço). O histórico fica (item cancelado mantém as fatias).
model ApontamentoAtividadeItemConsumoLote {
  id                   String   @id @default(cuid())
  cliente_id           String   @db.VarChar(64)
  empresa_id           String   @db.VarChar(64)
  item_id              String   @db.VarChar(64)
  estoque_lote_nota_id String   @db.VarChar(64)
  ordem                Int
  quantidade           Decimal  @db.Decimal(14, 4)
  custo_unitario       Decimal  @db.Decimal(14, 4)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  cliente Cliente                  @relation(fields: [cliente_id], references: [id], onDelete: Restrict)
  item    ApontamentoAtividadeItem @relation(fields: [cliente_id, empresa_id, item_id], references: [cliente_id, empresa_id, id], onDelete: Restrict, map: "ApontamentoAtividadeItemConsumoLote_item_fkey")
  lote    EstoqueLoteNota          @relation("ApontamentoAtividadeItemConsumoDoLote", fields: [cliente_id, estoque_lote_nota_id], references: [cliente_id, id], onDelete: Restrict, map: "ApontamentoAtividadeItemConsumoLote_lote_fkey")

  @@unique([cliente_id, id])
  @@unique([cliente_id, item_id, estoque_lote_nota_id], map: "ApontamentoAtividadeItemConsumoLote_item_lote_key")
  @@unique([cliente_id, item_id, ordem], map: "ApontamentoAtividadeItemConsumoLote_item_ordem_key")
  /// Bloqueio de PATCH/DELETE administrativo do lote (X1) e checagem da FK.
  @@index([cliente_id, estoque_lote_nota_id], map: "ApontamentoAtividadeItemConsumoLote_lote_idx")
}
```

### 1.3 Relações inversas (SÓ no Prisma; nenhuma DDL em tabela antiga)

| Model antigo | Campo novo (sugestão de nome, no padrão de `schema.prisma:128-131`, `:189-194`, `:1304`, `:1381-1382`) |
|---|---|
| `Cliente` | `apontamentoAtividadeItens ApontamentoAtividadeItem[]` e `apontamentoAtividadeItemConsumos ApontamentoAtividadeItemConsumoLote[]` |
| `ApontamentoAtividade` | `itens ApontamentoAtividadeItem[]` |
| `Produto` | `apontamentoAtividadeItens ApontamentoAtividadeItem[]` |
| `LocalEstoque` | `apontamentoAtividadeItens ApontamentoAtividadeItem[]` |
| `MovimentacaoEstoque` | `apontamentoAtividadeItem ApontamentoAtividadeItem? @relation("ApontamentoAtividadeItemMovimento")` e `apontamentoAtividadeItemEstorno ApontamentoAtividadeItem? @relation("ApontamentoAtividadeItemEstorno")` (1:1 por causa dos uniques, como `schema.prisma:1381-1382`) |
| `EstoqueLoteNota` | `consumosApontamentoItem ApontamentoAtividadeItemConsumoLote[] @relation("ApontamentoAtividadeItemConsumoDoLote")` |
| `Usuario` | `apontamentoItensCriados ApontamentoAtividadeItem[] @relation("ApontamentoAtividadeItemCriadoPor")` e `apontamentoItensCancelados ApontamentoAtividadeItem[] @relation("ApontamentoAtividadeItemCanceladoPor")` |

`AbastecimentoBem` **não** muda (é a Fatia E). Atualizar o comentário do bloco `ApontamentoAtividade`
(`schema.prisma:2768-2792`, "Base enxuta, SEM itens de custo") para citar os itens da D-PROD-193.

### 1.4 Migration `backend/prisma/migrations/20261113800000_apontamento_atividade_item/migration.sql`

Gerar o corpo com `prisma migrate diff --from-migrations … --to-schema-datamodel … --script` (para o
`migrate diff` final ficar vazio) e conferir contra o esboço abaixo; depois acrescentar à mão os CHECKs e o DO.
Cabeçalho em comentário no padrão de `20261113700000_apontamento_atividade/migration.sql:1-27`
(EXPAND-ONLY, sem número de decisão, reversão operacional = DROP das 2 tabelas novas, nenhuma tabela antiga
alterada, zero dado migrado). **Nenhum ponto e vírgula dentro de CHECK** (o classificador corta por `;`:
`scripts/deploy/premergeMigrateLib.mjs:177`).

```sql
-- CreateTable
CREATE TABLE "ApontamentoAtividadeItem" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "apontamento_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "tipo" VARCHAR(8) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "descricao" VARCHAR(255),
    "produto_id" VARCHAR(64),
    "local_estoque_id" VARCHAR(64),
    "quantidade" DECIMAL(14,4) NOT NULL,
    "unidade" VARCHAR(4),
    "valor_unitario" DECIMAL(18,6) NOT NULL,
    "valor_total" DECIMAL(18,4) NOT NULL,
    "operation_id" VARCHAR(128) NOT NULL,
    "movimentacao_estoque_id" VARCHAR(64),
    "movimentacao_estorno_id" VARCHAR(64),
    "criado_por_usuario_id" VARCHAR(64),
    "cancelado_por_usuario_id" VARCHAR(64),
    "cancelado_em" TIMESTAMP(3),
    "motivo_cancelamento" VARCHAR(500),
    "cancelamento_origem" VARCHAR(12),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApontamentoAtividadeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApontamentoAtividadeItemConsumoLote" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "item_id" VARCHAR(64) NOT NULL,
    "estoque_lote_nota_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "custo_unitario" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApontamentoAtividadeItemConsumoLote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (Item)
CREATE INDEX "ApontamentoAtividadeItem_cliente_id_produto_id_idx" ON "ApontamentoAtividadeItem"("cliente_id", "produto_id");
CREATE INDEX "ApontamentoAtividadeItem_cliente_id_local_estoque_id_idx" ON "ApontamentoAtividadeItem"("cliente_id", "local_estoque_id");
CREATE UNIQUE INDEX "ApontamentoAtividadeItem_cliente_id_id_key" ON "ApontamentoAtividadeItem"("cliente_id", "id");
CREATE UNIQUE INDEX "ApontamentoAtividadeItem_cliente_id_empresa_id_id_key" ON "ApontamentoAtividadeItem"("cliente_id", "empresa_id", "id");
CREATE UNIQUE INDEX "ApontamentoAtividadeItem_cliente_id_operation_id_key" ON "ApontamentoAtividadeItem"("cliente_id", "operation_id");
CREATE UNIQUE INDEX "ApontamentoAtividadeItem_apontamento_ordem_key" ON "ApontamentoAtividadeItem"("cliente_id", "apontamento_id", "ordem");
CREATE UNIQUE INDEX "ApontamentoAtividadeItem_movimentacao_key" ON "ApontamentoAtividadeItem"("cliente_id", "movimentacao_estoque_id");
CREATE UNIQUE INDEX "ApontamentoAtividadeItem_estorno_key" ON "ApontamentoAtividadeItem"("cliente_id", "movimentacao_estorno_id");

-- CreateIndex (ConsumoLote)
CREATE INDEX "ApontamentoAtividadeItemConsumoLote_lote_idx" ON "ApontamentoAtividadeItemConsumoLote"("cliente_id", "estoque_lote_nota_id");
CREATE UNIQUE INDEX "ApontamentoAtividadeItemConsumoLote_cliente_id_id_key" ON "ApontamentoAtividadeItemConsumoLote"("cliente_id", "id");
CREATE UNIQUE INDEX "ApontamentoAtividadeItemConsumoLote_item_lote_key" ON "ApontamentoAtividadeItemConsumoLote"("cliente_id", "item_id", "estoque_lote_nota_id");
CREATE UNIQUE INDEX "ApontamentoAtividadeItemConsumoLote_item_ordem_key" ON "ApontamentoAtividadeItemConsumoLote"("cliente_id", "item_id", "ordem");

-- AddForeignKey (todas ON DELETE RESTRICT ON UPDATE CASCADE, compostas por cliente_id)
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_apontamento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "apontamento_id") REFERENCES "ApontamentoAtividade"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_cliente_id_produto_id_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_cliente_id_local_estoque_id_fkey" FOREIGN KEY ("cliente_id", "local_estoque_id") REFERENCES "LocalEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_movimentacao_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estoque_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_estorno_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estorno_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_cancelado_por_fkey" FOREIGN KEY ("cliente_id", "cancelado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApontamentoAtividadeItemConsumoLote" ADD CONSTRAINT "ApontamentoAtividadeItemConsumoLote_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApontamentoAtividadeItemConsumoLote" ADD CONSTRAINT "ApontamentoAtividadeItemConsumoLote_item_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "item_id") REFERENCES "ApontamentoAtividadeItem"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApontamentoAtividadeItemConsumoLote" ADD CONSTRAINT "ApontamentoAtividadeItemConsumoLote_lote_fkey" FOREIGN KEY ("cliente_id", "estoque_lote_nota_id") REFERENCES "EstoqueLoteNota"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domínios fechados e invariantes (CHECK escrito à mão; NULL-safe; nomes ≤ 63 bytes; nenhum ponto e vírgula dentro).
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_tipo_check" CHECK ("tipo" IN ('PRODUTO', 'SERVICO', 'OUTRO'));
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_forma_check" CHECK (("tipo" = 'PRODUTO' AND "produto_id" IS NOT NULL AND "local_estoque_id" IS NOT NULL AND "unidade" IN ('L', 'KG') AND "descricao" IS NULL AND "movimentacao_estoque_id" IS NOT NULL) OR ("tipo" IN ('SERVICO', 'OUTRO') AND "produto_id" IS NULL AND "local_estoque_id" IS NULL AND "unidade" IS NULL AND "descricao" IS NOT NULL AND char_length(btrim("descricao")) > 0 AND "movimentacao_estoque_id" IS NULL AND "movimentacao_estorno_id" IS NULL));
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_status_check" CHECK (("status" = 'CONFIRMADO' AND "movimentacao_estorno_id" IS NULL AND "cancelado_em" IS NULL AND "cancelado_por_usuario_id" IS NULL AND "motivo_cancelamento" IS NULL AND "cancelamento_origem" IS NULL) OR ("status" = 'CANCELADO' AND "cancelado_em" IS NOT NULL AND "motivo_cancelamento" IS NOT NULL AND char_length(btrim("motivo_cancelamento")) >= 3 AND "cancelamento_origem" IN ('ITEM', 'APONTAMENTO') AND ("tipo" <> 'PRODUTO' OR "movimentacao_estorno_id" IS NOT NULL)));
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_valores_check" CHECK ("quantidade" > 0 AND "valor_unitario" >= 0 AND "valor_total" >= 0 AND ("tipo" = 'PRODUTO' OR "valor_total" > 0) AND "ordem" >= 1);
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_textos_check" CHECK ("operation_id" ~ '^[A-Za-z0-9_.:-]{8,128}$');
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_movimentos_check" CHECK ("movimentacao_estorno_id" IS NULL OR "movimentacao_estorno_id" <> "movimentacao_estoque_id");
ALTER TABLE "ApontamentoAtividadeItemConsumoLote" ADD CONSTRAINT "ApontamentoAtividadeItemConsumoLote_valores_check" CHECK ("quantidade" > 0 AND "custo_unitario" >= 0 AND "ordem" >= 1);

-- Supabase Data API: mesmo corpo do DO das migrations anteriores, lista nova (ordem alfabética).
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['ApontamentoAtividadeItem','ApontamentoAtividadeItemConsumoLote'];
BEGIN
  FOREACH tbl IN ARRAY tabelas
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maike_vercel') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol_name, tbl);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO maike_vercel USING (true) WITH CHECK (true)', pol_name, tbl);
    END IF;
  END LOOP;
END $$;
```

O DO é **byte a byte** o de `20261113700000_apontamento_atividade/migration.sql:132-152` trocando só a lista
(copiar e trocar, nunca redigitar). 11 FKs, todas RESTRICT; 7 CHECKs.

---

## 2. A migration é EXPAND pura? — SIM

- **Nenhuma tabela antiga tem CHECK ou enum que limite a origem do movimento.** `MovimentacaoEstoque` foi criada
  sem nenhum CHECK (`20261027230000_p54_base44_exit_movimentacao/migration.sql:204-270`; `origem_sistema
  VARCHAR(32)` em `:253`, `exclusao_somente_em VARCHAR(32)` em `:259`); `EstoqueLoteNota`, `Produto` e
  `LocalEstoque` também não têm CHECK. `ApontamentoAtividade` não tem CHECK de status
  (`20261113700000_apontamento_atividade/migration.sql:30-64`). O único "enum" de banco no caminho é o de
  `OperacaoFinanceiraItem` (`20261110300000_patrimonio_simplifica/migration.sql:132-134`), que a Fatia D **não usa**.
- **A origem nova muda só CÓDIGO** (fail-closed): `ORIGENS_SISTEMA` e `EXCLUSAO_SOMENTE_EM`
  (`backend/src/modules/estoqueFisico/estoqueFisicoMotor.js:64-72`, recusa em `:318-322`) e a reconciliação
  (`reconciliacaoEstoque.js:135-139`, CTEs `:466-474` e `:597-604`). Ver §4 I-j e I-y.
- **O classificador aceita tudo o que a §1.4 tem**: `CREATE TABLE`, `CREATE [UNIQUE] INDEX` em tabela nova,
  `ALTER TABLE <nova> ADD CONSTRAINT … FOREIGN KEY|CHECK` e DO com hash pinado que só cita tabelas novas
  (`scripts/deploy/premergeMigrateLib.mjs:10-20`, `:169-192`). Precedente de FK de tabela nova para
  `MovimentacaoEstoque`/`EstoqueLoteNota` sem DDL nas antigas: P1-02 e simplifica (`migration.sql:458-462`).
- **Proibido nesta migration** (o classificador recusaria): UNIQUE/CHECK em tabela antiga — e
  `ApontamentoAtividade` já é antiga (`premergeMigrateLib.mjs:23`, `:182-184`); `ADD COLUMN NOT NULL` em
  antiga. Por isso **a chave de idempotência (`operation_id`) e todo dado novo ficam na tabela nova**; não se
  acrescenta `custo_itens_total` nem nada em `ApontamentoAtividade` (o total é derivado na leitura).
- **Nenhuma DECISÃO DE CONTRACT é necessária.** Não há alteração de CHECK/enum antigo a propor.

---

## 3. API (frente D2)

Tudo no plugin já existente `backend/src/modules/apontamentosAtividade/apontamentoAtividadeRoutes.js`
(registrado em `backend/src/app.js:39`, `:210-212`): tenant só da sessão; empresa no corpo/query, conferida por
`exigirEmpresaDoTenant` (`backend/src/modules/gestao/gestaoComum.js:65-73`); corpos e queries com
`additionalProperties: false` (`cliente_id` → 400). O `preValidation` do plugin
(`apontamentoAtividadeRoutes.js:153-155`) passa a recusar número em `quantidade` e `valor_unitario`: acrescentar
as duas chaves a `DECIMAIS_DO_CORPO` (`apontamentoAtividadeService.js:112`) → 400 `valor_deve_ser_texto`.

### 3.1 Constantes de schema

```js
const OPERATION_ID = { type: 'string', pattern: '^[A-Za-z0-9_.:-]{8,128}$' };          // = PADRAO_OPERATION_ID (abastecimentoPlano.js:42)
const QUANTIDADE   = { type: 'string', pattern: '^\\d{1,10}(\\.\\d{1,4})?$' };          // = PADRAO_DECIMAL (apontamentoAtividadeService.js:101)
const VALOR_UNIT   = { type: 'string', pattern: '^\\d{1,12}(\\.\\d{1,6})?$' };          // LIMITES.PRECO {12,6} (src/lib/dinheiroDecimal.js:27)
const TIPO_ITEM    = { type: 'string', enum: ['PRODUTO', 'SERVICO', 'OUTRO'] };
const MOTIVO       = { type: 'string', minLength: 1, maxLength: 500 };                  // ≥ 3 no serviço (MOTIVO_MINIMO, :104)
const PARAMS_ITEM  = { type: 'object', required: ['id', 'itemId'], additionalProperties: false, properties: { id: ID, itemId: ID } };
```

### 3.2 Rotas

| # | Método e caminho | Guarda (tela `op-apontamentos-atividade`) | Corpo/query (`additionalProperties:false`) | Resposta |
|---|---|---|---|---|
| A1 | `POST /apontamentos-atividade/:id/itens` | `g.editar` = editar \| salvar (`guardasRotas.js:293-298`, `cadastro()` em `:29-33`) — ver D-3 | required `empresa_id, versao, operation_id, tipo, quantidade`; opcionais `produto_id, local_estoque_id` (PRODUTO) e `descricao` (1..255), `valor_unitario` (SERVICO/OUTRO); nenhum aceita `null` | **201** (novo) / **200** (replay): detalhe do apontamento (§3.4) + `item_id` + `replay` |
| A2 | `POST /apontamentos-atividade/:id/itens/:itemId/cancelar` | `g.cancelar` = excluir | required `empresa_id, versao, operation_id, motivo` | **200**: detalhe + `replay` |
| A3 | `POST /apontamentos-atividade/:id/cancelar` (**muda**) | `g.cancelar` (igual) | required `empresa_id, versao, motivo` **+ `operation_id`** (novo, obrigatório) | **200**: detalhe (itens já cancelados/estornados) + `replay` |
| A4 | `GET /apontamentos-atividade/:id` (**muda**) | `g.ver` (igual) | igual (`SO_EMPRESA`) | detalhe com `itens` e `custo_itens` (§3.4) |
| A5 | `GET /apontamentos-atividade` | `g.ver` (igual) | igual | **sem mudança** (a lista NÃO traz itens; a tela busca o detalhe) |
| A6 | `GET /apontamentos-atividade-opcoes/produtos` | `g.ver` | `OPCOES()` (`empresa_id`, `q`, `cursor`, `limit`) | reaproveita `opcoesProdutos` (`backend/src/modules/financeiro/operacaoFinanceiraOpcoesService.js:92-116`): produtos ATIVOS da empresa `{id, numero, nome, unidade_principal_estoque, peso_por_saco_kg, estoque_atual}` |
| A7 | `GET /apontamentos-atividade-opcoes/locais` | `g.editar` (saldo = quem lança; molde "saldos = criar" do abastecimento, `guardasRotas.js:274-281`) | required `empresa_id, produto_id` (molde `abastecimentoRoutes.js:128`) | reaproveita `opcoesLocais` do abastecimento (`backend/src/modules/patrimonio/abastecimentoOpcoesService.js:264-291`): locais ATIVOS com saldo da EMPRESA `{itens:[{local_estoque_id, local_nome, disponivel, unidade, unidade_principal_estoque}]}`; produto fora da fazenda → 404 `PRODUTO_NOT_FOUND` |

Não existem `PATCH`/`DELETE` de item (o Fastify responde 404 de rota; o teste confere).

### 3.3 Idempotência e CAS

- **Recibo** `executarComIdempotencia` (`backend/src/shared/idempotency/operacaoIdempotenteService.js:49-129`;
  unique `(cliente_id, operation_key, tipo_operacao)`, `schema.prisma:310`), dentro de
  `emTransacao(TRANSACAO_CURTA, …)` (`backend/src/shared/prisma/transacaoConcorrente.js:56`). Tipos (≤ 64):
  - `adicionar_item_apontamento_atividade_v1`
  - `cancelar_item_apontamento_atividade_v1`
  - `cancelar_apontamento_atividade_v1`
- **Fingerprints** (ordem FIXA de chaves; valores já normalizados — decimais canônicos com 4/6 casas, textos aparados),
  molde `abastecimentoPlano.js:145-161`:
  - A1: `{ v: 1, apontamento_id, empresa_id, versao, tipo, produto_id, local_estoque_id, quantidade, descricao, valor_unitario }` (ausente → `null`);
  - A2: `{ v: 1, apontamento_id, item_id, empresa_id, versao, motivo }`;
  - A3: `{ v: 1, id, empresa_id, versao, motivo }`.
- **Unique da tabela** `(cliente_id, operation_id)` no item: P2002 → 409 `IDEMPOTENCY_CONFLICT` via o mapa
  `unicos` de `emTransacao` (molde `abastecimentoService.js:329-330`, `:427`). Reenvio conflitante auditado
  best-effort numa transação própria (molde `abastecimentoService.js:319-325`, `:429-431`).
- **Replay**: mesma chave + mesmo conteúdo → corpo gravado, 200, `replay: true` (nenhum efeito novo). Mesma chave +
  conteúdo diferente → 409 `IDEMPOTENCY_CONFLICT`.
- **CAS = `versao` do APONTAMENTO** (um único token para o agregado): A1, A2 e A3 exigem a `versao` lida.
  A1 e A2 **incrementam** a `versao` do apontamento uma vez (`atualizarComVersao` com `dados: {}`,
  `apontamentoAtividadeRepository.js:58-64`); A3 incrementa como hoje. Efeito: um PATCH ou cancelamento com
  `versao` velha depois de um item entrar/sair perde o CAS (409 `APONTAMENTO_ATIVIDADE_VERSAO_CONFLITO`) e a tela relê.
  O item não tem `versao` própria: a transição CONFIRMADO→CANCELADO é CAS sobre `status` (`updateMany where status='CONFIRMADO'`, contagem 1).

### 3.4 Formato do detalhe (A1–A4)

`comoApontamentoPublico` (`apontamentoAtividadeService.js:409`) continua igual para a lista. O DETALHE acrescenta:

```jsonc
{
  "...campos atuais...": "…",
  "itens": [                                   // ordem asc; inclui cancelados (histórico)
    {
      "id": "…", "ordem": 1, "tipo": "PRODUTO", "status": "CONFIRMADO",
      "descricao": null,                       // SERVICO/OUTRO: o texto
      "produto": { "id": "…", "nome": "…", "unidade_principal_estoque": "SACO" },   // null fora de PRODUTO
      "local_estoque": { "id": "…", "nome": "…" },                                  // null fora de PRODUTO
      "quantidade": "12.5000", "unidade": "KG",                                     // unidade null fora de PRODUTO
      "valor_unitario": "5.312500", "valor_total": "66.4063",
      "movimento": { "id": "…", "numero": "…" }, "movimento_estorno": null,
      "consumos": [ { "ordem": 1, "lote_id": "…", "quantidade": "10.0000", "custo_unitario": "5.0000" } ],
      "criado_por": { "id": "…", "nome": "…" }, "criado_em": "2026-11-14T…Z",
      "cancelamento": null                     // ou { cancelado_em, cancelado_por:{id,nome}|null, motivo, origem: "ITEM"|"APONTAMENTO" }
    }
  ],
  "custo_itens": { "total": "0.0000", "produto": "0.0000", "servico": "0.0000", "outro": "0.0000", "itens_confirmados": 0 }
}
```

Decimais sempre TEXTO (`Dec` de `backend/src/modules/financeiro/decimalFinanceiro.js`): quantidade e custos de
fatia com 4 casas, `valor_unitario` com 6, `valor_total` e somas com 4; `custo_itens` soma SÓ itens CONFIRMADO.
A1 acrescenta `item_id` (o item criado); A1–A3 acrescentam `replay`.

### 3.5 Erros

Novos (em `backend/src/shared/errors/errorCodes.js` junto de `:258-294`, fábricas em `AppError.js` junto de
`:171-250`, espelho em `src/apis/_core/ApiError.js:129-138` e `CODIGOS_PRESERVADOS` de
`src/apis/_core/nativeHttpClient.js:44-` como a Fatia C fez):

| Código | HTTP | Quando (`details`) |
|---|---|---|
| `APONTAMENTO_ATIVIDADE_ITEM_NOT_FOUND` | 404 | `itemId` não é item DESTE apontamento, desta empresa e deste tenant (mesmo corpo para outro tenant: sem oráculo) |
| `APONTAMENTO_ATIVIDADE_ITEM_INVALIDO` | 422 | `field`/`reason`: `produto_id` (`inexistente`\|`outra_empresa`\|`inativo`\|`unidade_nao_aceita`), `local_estoque_id` (`inexistente`\|`inativo`), `quantidade` (`quantidade_nao_positiva`), `valor_unitario` (`total_zero`\|`valor_excede_limite`); nada gravado |
| `APONTAMENTO_ATIVIDADE_ITEM_STATUS_INVALIDO` | 409 | item já CANCELADO (`details.status`); nada alterado |
| `APONTAMENTO_ATIVIDADE_ITENS_EXCEDIDOS` | 422 | apontamento já tem 200 itens (`details.limite`) |
| `APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO` | 409 | o estorno exato não é seguro (`details.reason` ∈ `produto_mudou_de_fazenda`\|`unidade_mudou`\|`movimento_inexistente`\|`movimento_estornado`\|`fatias_inconsistentes`\|`lote_indisponivel_para_devolucao`\|`devolucao_excede_entrada`\|`estoque_excede_limite`\|`vinculo_divergente`\|`camada_divergente`; mais `item_id`, `item_ordem`, `lote_id?`) — molde `ABASTECIMENTO_CANCELAMENTO_BLOQUEADO` (`errorCodes.js:198`, tradução `abastecimentoService.js:439-453`) |
| `APONTAMENTO_ATIVIDADE_DATA_COM_ITENS` | 409 | **só se o proprietário aprovar D-1**: PATCH muda `data_operacional` com item PRODUTO CONFIRMADO |

Reaproveitados: `APONTAMENTO_ATIVIDADE_NOT_FOUND` (404), `…_STATUS_INVALIDO` (409, apontamento CANCELADO),
`…_VERSAO_CONFLITO` (409), `ESTOQUE_SALDO_INSUFICIENTE` (422, do motor: `reason` `saldo_lote_insuficiente` |
`estoque_atual_insuficiente`, `estoqueFisicoMotor.js:554-562`), `OPERACAO_VALORES_INVALIDOS` (422, custo FIFO
acima do limite, `:134-137`), `CONCURRENCY_CONFLICT` (409), `IDEMPOTENCY_CONFLICT` (409),
`IDEMPOTENCY_IN_PROGRESS`, `EMPRESA_FUSO_NAO_CONFIGURADO`, `REQUEST_VALIDATION_FAILED` (400: forma —
`campo_obrigatorio`, `campo_nao_permitido`, `valor_deve_ser_texto`, `caractere_invalido`, `motivo_curto`),
`PRODUTO_NOT_FOUND` (A7), `REGISTRO_OPERACIONAL_IMUTAVEL` (409, lote — I-x).

### 3.6 Permissões

Mesma tela `op-apontamentos-atividade`, módulo `suporte-mapa` (`backend/src/shared/auth/autorizacaoTela.js:74-77`),
**sem ação nova**: adicionar item = `editar|salvar`; cancelar item = `excluir` (mesma ação de cancelar o
apontamento); opções de produto = `visualizar`; locais com saldo = `editar|salvar`. Espelho no front em
`src/lib/apontamentoAtividadePermissions.js:28-36` (já tem `editar` e `cancelar`). Nenhum perfil recebe acesso
automático (D-PROD-190 item 5, `DECISIONS.md:6809`). Ver decisão D-3.

---

## 4. Regras de negócio

**I-a Tipos fechados.** `PRODUTO | SERVICO | OUTRO` (schema enum + CHECK `_tipo_check`). Nenhum outro.

**I-b Só em apontamento CONFIRMADO.** A1 e A2 exigem o apontamento CONFIRMADO; CANCELADO → 409
`APONTAMENTO_ATIVIDADE_STATUS_INVALIDO`. Ordem das conferências (igual à Fatia C, `apontamentoAtividadeService.js:665-667`):
existe → status → `versao`.

**I-c Serialização.** Todo comando de item (A1, A2) e o cancelamento (A3) **travam a linha do apontamento**
(`SELECT id FROM "ApontamentoAtividade" WHERE cliente_id AND empresa_id AND id FOR UPDATE`, nova função no
repositório) **antes** de ler itens, locais ou produtos. Hoje o cancelamento não trava (`apontamentoAtividadeService.js:660-688`) e o
abastecimento trava a linha antes dos produtos (`abastecimentoService.js:477-481`; `DECISIONS.md:5753`). O PATCH
continua sem trava: ele perde o CAS se um item entrou (I-c + §3.3).

**I-d Ordem canônica de travas** (`estoqueFisicoMotor.js:32-38`):
- **A1 (PRODUTO):** recibo → `exigirEmpresaDoTenant` → Apontamento FOR UPDATE → conferências I-b/I-m →
  `LocalEstoque` FOR KEY SHARE (`SELECT id, nome, ativo … FOR KEY SHARE`, molde `abastecimentoService.js:359`) →
  `travarProdutosEstoque(tx, cli, empresaId, [produto_id])` (`estoqueFisicoMotor.js:99-106`) → leitura do Produto
  SOB a trava + I-e → `aplicarSaidaFifo` (lotes CAS, movimento, `estoque_atual −`) → Σ fatias = quantidade →
  `ordem` → INSERT item → `createMany` das fatias → `atualizarComVersao` do apontamento →
  `numerarMovimentos(tx, cli, [saida.id])` (`:1301-1308`) → AuditLog → recibo.
- **A1 (SERVICO/OUTRO):** recibo → empresa → Apontamento FOR UPDATE → conferências → `ordem` → INSERT → CAS do
  apontamento → AuditLog → recibo. Nenhuma trava de estoque.
- **A2 / A3:** recibo → empresa → `tempoDaFazenda` (Empresa FOR SHARE; `apontamentoAtividadeService.js:261-265`;
  sem fuso → `EMPRESA_FUSO_NAO_CONFIGURADO`, fail-closed) → Apontamento FOR UPDATE → conferências → leitura dos
  itens CONFIRMADO (e das fatias) → `travarProdutosEstoque` (todos os produtos dos itens PRODUTO, de uma vez) →
  conferências do I-p → `estornarEmLote` (lotes FOR UPDATE → originais FOR UPDATE → movimentos → `estoque_atual +`)
  → UPDATE dos itens → CAS do apontamento → `numerarMovimentos` → AuditLog → recibo.

**I-e PRODUTO — Produto.** Lido SOB a trava: existe no tenant (senão `inexistente`; outro tenant = mesmo corpo),
`empresa_id` = a do apontamento (`outra_empresa`), `ativo` (`inativo`), `unidadeEfetivaDoEstoque(unidade_principal_estoque)`
∈ {`L`,`KG`} (`unidade_nao_aceita`; `backend/src/modules/patrimonio/patrimonioDominio.js:118`) → 422
`APONTAMENTO_ATIVIDADE_ITEM_INVALIDO` `field: produto_id`. O motor só confere a empresa (`estoqueFisicoMotor.js:151-155`);
ativo e unidade ficam com quem chama (como `abastecimentoPlano.js:310-322`).

**I-f PRODUTO — Local.** Existe no tenant e está ativo (`inexistente`|`inativo`, `field: local_estoque_id`).
`LocalEstoque` não tem `empresa_id` (`schema.prisma:878-899`): "local da mesma empresa" = haver lote DA EMPRESA
naquele local (`lotesFifo` filtra empresa, produto, local, `Disponivel`, `> 0`: `estoqueFisicoMotor.js:545-552`).
Local sem saldo da empresa → 422 `ESTOQUE_SALDO_INSUFICIENTE` (disponível 0).

**I-g PRODUTO — Quantidade e unidade.** Texto `^\d{1,10}(\.\d{1,4})?$`, > 0 (`quantidade_nao_positiva`), na
unidade EFETIVA do estoque do Produto (L → L; KG e SACO → KG; SACO digita kg), **sem nenhuma conversão**
(`estoqueFisicoMotor.js:9-16`; `07-DO-NOT-DO.md:83-86`). O item grava `unidade` = `L`|`KG`.

**I-h PRODUTO — Baixa pelo MOTOR ÚNICO.** Só `aplicarSaidaFifo` (`estoqueFisicoMotor.js:581-639`), nunca FIFO
próprio. FIFO = `COALESCE(data_documento, createdAt)` crescente, desempate por id (`:121-127`); custo = Σ fatia ×
`custo_unitario` do lote, arredondado UMA vez (4 casas), `valor_unitario` = total/qtd (4 casas) (`:517-535`); lote
baixado por CAS (`:226-236`). O item grava `valor_unitario`/`valor_total` = `saida.valor_unitario`/`saida.valor_total`
(nunca preço digitado, nunca custo médio: `DECISIONS.md:5568`). Fatias em `ApontamentoAtividadeItemConsumoLote` na
ordem devolvida (`ordem = i+1`, quantidade 4 casas, custo 4 casas), molde `abastecimentoService.js:408-417`.
Σ fatias ≠ quantidade → `Error` de programação (500, tudo volta), molde `:377`.

**I-i Saldo insuficiente.** O motor recusa ANTES de escrever (lote: `:594-596`; `estoque_atual`: `:597-600`;
decremento conferido: `:630-632`) → 422 `ESTOQUE_SALDO_INSUFICIENTE`; nada gravado (nem item, nem fatia, nem
recibo, nem versão).

**I-j PRODUTO — Movimento.** Constante nova exportada do motor:
`export const ORIGEM_APONTAMENTO = 'apontamento_atividade'` (21 caracteres, cabe em `VarChar(32)`), incluída em
`ORIGENS_SISTEMA` e em `EXCLUSAO_SOMENTE_EM` (`[ORIGEM_APONTAMENTO]: ORIGEM_APONTAMENTO`) — `estoqueFisicoMotor.js:64-72`.
Chamada:
```js
aplicarSaidaFifo(tx, contexto, {
  empresaId, produto, local: { id: local.id, nome: local.nome },
  quantidadeKg: quantidade,                         // unidade efetiva, sem conversão
  dia: diaDe(apontamento.data_operacional),         // data operacional do APONTAMENTO
  documento: { numero: apontamento.numero, data: diaDe(apontamento.data_operacional) },
  origem: { sistema: ORIGEM_APONTAMENTO, operacaoId: apontamento.id,
            tipoDetalhado: 'apontamento_atividade', motivo: 'Saída por item de apontamento de atividade' },
  numeroMovimento: numeroMovimentoProvisorio(),
  contextoErro: { field: 'quantidade' },
})
```
Resultado no movimento (`camposComuns` `:324-344` + `:608-627`): `origem_sistema` e `exclusao_somente_em` =
`apontamento_atividade`; `tipo_detalhado` = `apontamento_atividade`; `lancamento_origem_id` = id do APONTAMENTO
(o documento, como a Central faz com a operação); `numero_documento` = número do apontamento; `data_documento` =
`data_operacional`; `data_movimentacao` = meio-dia UTC de `data_operacional` (`:111`); `unidade_medida` do Produto;
`lotes_consumidos` em JSON. NÃO preenche `centro_custo_*`, `maquina_vinculada_*` nem `tipo_documento` (C8,
`DECISIONS.md:5761`). Reusar `abastecimento_patrimonio` ou `operacao_financeira` é proveniência falsa (proibido:
`DECISIONS.md:5746`; `07-DO-NOT-DO.md:92-93`).

**I-k SERVICO/OUTRO.** `descricao` obrigatória (1..255; `textoDoCorpo` com `obrigatorio`, sem HTML/controle:
`gestaoComum.js:23-31`); `quantidade` como I-g (> 0); `valor_unitario` texto `^\d{1,12}(\.\d{1,6})?$`, ≥ 0;
**`valor_total = ROUND_HALF_UP(quantidade × valor_unitario, 4)` em `Dec` no servidor** (`decimalFinanceiro.js:16`,
`arredondar` `:69`, `CASAS_CUSTO = 4` `:31`), > 0 (`total_zero`) e ≤ `LIMITE_DINHEIRO` (`:23`;
`valor_excede_limite`), molde `operacaoFinanceiraPlano.js:390-397`. Sem produto, local, unidade, movimento; sem
cadastro de serviço, sem fornecedor; **nenhum** efeito de estoque nem financeiro. SERVICO e OUTRO só diferem no
rótulo (ver D-6).

**I-l Forma do corpo (400 `REQUEST_VALIDATION_FAILED`).** PRODUTO sem `produto_id`/`local_estoque_id` →
`campo_obrigatorio`; PRODUTO com `descricao`/`valor_unitario` → `campo_nao_permitido`; SERVICO/OUTRO sem
`descricao`/`valor_unitario` → `campo_obrigatorio`; SERVICO/OUTRO com `produto_id`/`local_estoque_id` →
`campo_nao_permitido`; número em decimal → `valor_deve_ser_texto`. Recusado ANTES da transação.

**I-m Limite.** Máximo **200 itens por apontamento** (CONFIRMADO + CANCELADO; molde `MAX_ITENS = 200` da Central,
`src/components/financeiroGestao/lancamentoModelo.js:31`) → 422 `APONTAMENTO_ATIVIDADE_ITENS_EXCEDIDOS`. Mantém o
estorno em lote dentro dos 9 s de `TRANSACAO_CURTA` (`estornarEmLote` tem nº fixo de idas ao banco:
`estoqueFisicoMotor.js:1053-1059`).

**I-n Ordem.** `ordem = COALESCE(MAX(ordem),0)+1` lido SOB a trava do apontamento; nunca reaproveitada (item
cancelado mantém a sua). O unique `(cliente_id, apontamento_id, ordem)` é a rede; P2002 nele → 409 `CONCURRENCY_CONFLICT`.

**I-o Imutável.** Sem PATCH e sem DELETE de item. Corrigir = cancelar (estorno) e lançar de novo. Apagar item é
proibido (molde `07-DO-NOT-DO.md:94-95`).

**I-p Cancelar item (A2).** Motivo 3..500 (`motivo_curto`), `operation_id`, `versao` do apontamento.
Item inexistente/de outro apontamento/empresa/tenant → 404 `…_ITEM_NOT_FOUND`; item CANCELADO → 409
`…_ITEM_STATUS_INVALIDO`. Para PRODUTO, ANTES do motor (molde `abastecimentoService.js:496-515`): Produto ainda da
empresa (`produto_mudou_de_fazenda`), mesma unidade efetiva (`unidade_mudou`), movimento original existe
(`movimento_inexistente`) e está `Ativa` sem filho (`movimento_estornado`), fatias existem e Σ = quantidade
(`fatias_inconsistentes`). Estorno pelo motor: **`estornarEmLote`** com lista de UM item (mesmas recusas e
resultado de `estornarSaida`, `estoqueFisicoMotor.js:1054-1059`; um único caminho de estorno para A2 e A3):
```js
estornarEmLote(tx, contexto, {
  empresaId, efeito: EFEITO_SAIDA, dia: hoje,       // dia do estorno = hoje da fazenda
  documento: { numero: apontamento.numero, data: diaDe(apontamento.data_operacional) },
  origem: { sistema: ORIGEM_APONTAMENTO, operacaoId: apontamento.id,
            tipoDetalhadoEstorno: 'estorno_apontamento_atividade',
            motivoEstorno: 'Estorno de item de apontamento de atividade cancelado' },
  itens: [{ produto_id, local_estoque_id, movimentacao_estoque_id, quantidade_estoque: item.quantidade,
            ordem: item.ordem, consumos: fatias.map((f) => ({ estoque_lote_nota_id, quantidade })) }],
  numeroMovimento: numeroMovimentoProvisorio,
})
```
Devolve cada fatia ao SEU lote, cria a Entrada `estorno_apontamento_atividade` com o MESMO valor do original e
`movimento_pai_id`, marca o original `Estornada` (CAS), soma ao `estoque_atual` (`:1106-1288`). Erros do motor →
409 `APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO` (tradução no molde `abastecimentoService.js:439-453`);
`CONCURRENCY_CONFLICT` passa. Grava no item (CAS `status='CONFIRMADO'`, contagem 1): `CANCELADO`,
`movimentacao_estorno_id`, `cancelado_em`, `cancelado_por_usuario_id = auth.usuarioId ?? null`, `motivo_cancelamento`,
`cancelamento_origem = 'ITEM'`. SERVICO/OUTRO: só a mudança de status (sem motor). O apontamento continua
CONFIRMADO, com `versao + 1`.

**I-q Cancelar o APONTAMENTO (A3).** Na MESMA transação, **todos** os itens CONFIRMADO são cancelados
(`cancelamento_origem = 'APONTAMENTO'`, `motivo_cancelamento` = o motivo do apontamento); os PRODUTO são
estornados de uma vez por `estornarEmLote` (lista na ordem dos itens), com as mesmas conferências do I-p por item.
Qualquer recusa → 409 `APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO` com `item_id`/`item_ordem` e **nada muda** (nem o
apontamento, nem os outros itens, nem o estoque). UPDATE dos itens em uma instrução com CAS
(contagem = nº de itens CONFIRMADO lidos). Sem itens, o cancelamento faz o mesmo de hoje (mais recibo e trava).

**I-r Datas e fuso.** Saída na `data_operacional` do apontamento (≤ hoje pela R-c, `apontamentoAtividadeService.js:268-270`);
estorno em "hoje da fazenda" (`tempoDaFazenda`, fuso da Empresa), como o abastecimento (`abastecimentoService.js:474`).
**PATCH que muda `data_operacional` com item PRODUTO CONFIRMADO: DECISÃO D-1** (recomendação: 409
`APONTAMENTO_ATIVIDADE_DATA_COM_ITENS`; o PATCH lê os itens sem trava e é protegido pelo CAS da I-c).

**I-s Centro de custo.** O item **não** tem centro, natureza nem rateio (rateio por item fora da constituição:
`00-CONSTITUICAO.md:32-33`; `07-DO-NOT-DO.md:63`). O custo do item pertence ao centro de custo do CABEÇALHO, que já
é snapshot (R-e, `DECISIONS.md:6798-6801`). Trocar o centro do cabeçalho (PATCH explícito) leva os itens junto. Ver D-4.

**I-t Tenant.** Só do `auth_context` (R11); empresa do corpo conferida; toda leitura/escrita filtra `cliente_id`
e, quando há, `empresa_id` e `apontamento_id`. Item/apontamento de outro tenant = 404 com o mesmo corpo.

**I-u Nada de saldo direto.** `estoque_atual`, lotes e movimentos só pelo motor
(`07-DO-NOT-DO.md:90-91`; `DECISIONS.md:5833`). O serviço do item não faz `update` em `Produto`, `EstoqueLoteNota`
nem `MovimentacaoEstoque`. Não altera `preco_custo` (`estoqueFisicoMotor.js:24`).

**I-v Auditoria** (mesma transação, `registrarEvento`/`registrarEventosEmLote`,
`backend/src/modules/auditoria/auditService.js:112-160`): `apontamento_atividade.item_adicionar` e
`apontamento_atividade.item_cancelar` com `entidade: 'ApontamentoAtividadeItem'`, `entidadeId` = item, dados com
`apontamento_id`, tipo, valores, movimento(s) e fatias; o A3 grava o evento do apontamento (como hoje,
`apontamentoAtividadeService.js:683-686`) + um `apontamento_atividade.item_cancelar` por item. **Nunca** AuditLog com
entidade `EstoqueLoteNota` ou `Produto` (a reconciliação rebaixaria divergência real: `DECISIONS.md:5869`).

**I-w Sem efeito financeiro.** Nenhum `OperacaoFinanceira`, título, conta a pagar, natureza (`07-DO-NOT-DO.md:92`).
O valor é custo gerencial da atividade; não vira despesa (`DECISIONS.md:5656`). Sem custo/hora nem relatório de
custo (`00-CONSTITUICAO.md:44-45`).

**I-x Lote imutável (X1).** `recusarSeVinculadoALancamento` (`backend/src/modules/estoqueLotesNota/estoqueLoteNotaService.js:115-135`)
conta também `apontamentoAtividadeItemConsumoLote` → 409 `REGISTRO_OPERACIONAL_IMUTAVEL`
`details.vinculo = 'apontamento_atividade'` (item confirmado ou cancelado: o histórico fica). Guarda
`to_regclass` antes de contar (I-z).

**I-y Reconciliação** (`reconciliacaoEstoque.js`, mesma PR que o escritor: `DECISIONS.md:6674`):
importar `ORIGEM_APONTAMENTO` (`:127`); incluir em `ORIGENS_PROTOCOLO` (`:135`) e `ORIGENS_COM_FK` (`:139`);
CTE `apo` em `lerLotes` no molde de `abs` (`:469-474`): `SUM(f.quantidade)` de `ApontamentoAtividadeItemConsumoLote f
JOIN ApontamentoAtividadeItem i ON i.cliente_id = f.cliente_id AND i.id = f.item_id WHERE … AND i.status = 'CONFIRMADO'`;
coluna `c_apo` em `x` (`:511`), em `dif` (`:540`), em `COLUNAS_LOTE` (`:443`, `consumo_apontamento`) e em `explicado`
(`:842`); ramo `UNION ALL` no CTE `fk` de `lerMovimentos` (`:597-604`) somando as fatias por
`i.movimentacao_estoque_id`. Atualizar o comentário I3 (`:13-20`).

**I-z Código antes da migration (lição do hotfix #259).** Os módulos ANTIGOS que passam a citar as tabelas novas
(guarda do lote I-x e reconciliação I-y) conferem `to_regclass('public."ApontamentoAtividadeItemConsumoLote"')`
antes (molde `backend/src/modules/empresas/empresaService.js:299-310`): sem a tabela, a contagem é 0 e o CTE vira
`SELECT NULL::text AS lote_id, 0::numeric AS consumido WHERE false` (idem o ramo do `fk`). O módulo do apontamento
pode assumir as tabelas (runbook: migration ANTES do deploy, risco R3).

---

## 5. Frontend (frente D3)

**Onde.** Nova `<SecaoForm titulo="Itens" />` dentro de `src/components/apontamentos-atividade/FormularioApontamentoAtividade.jsx`,
entre a seção "Centros" (`:362-392`) e o botão "Cancelar apontamento" (`:394-400`). **Nenhum arquivo `.jsx` novo
e nenhum CSS novo** (D-PROD-190 item 6, `DECISIONS.md:6810`): sub-funções no mesmo arquivo, só com peças já
exportadas. Todo botão da seção é `type="button"` (o `<form>` envolve tudo; em consulta o submit já não faz nada,
`:161-163`).

| Situação | A seção mostra |
|---|---|
| Novo | só `AvisoGestao tone="blue"`: "Os itens entram depois de salvar o apontamento." |
| Editando cabeçalho | itens só leitura (não mistura PATCH com comando de estoque) |
| Consulta de CONFIRMADO, com `acoes.editar` | itens gravados + botões "+ Produto", "+ Serviço", "+ Outro custo" + um card de rascunho + "Cancelar item" por item (com `acoes.cancelar`) |
| CANCELADO | tudo só leitura (itens aparecem "Cancelado junto com o apontamento") |

**Componentes existentes a reaproveitar** (todos exportados, VERIFICADO):
- `SecaoForm`, `CampoTexto`, `CampoSelect`, `AvisoGestao` — `src/components/gestao/GestaoFormParts.jsx:9`, `:22`, `:60`, `:85`;
- `EscolhaSegmentada`, `CampoNumero`, `ValorCalculado` — `src/components/financeiroGestao/CamposLancamento.jsx:12`, `:50`, `:120`;
- `SeletorPaginadoGestao` (Produto, com `detalheDaOpcao` = `rotuloDaUnidade`) — `src/components/financeiroGestao/SeletorPaginadoGestao`, uso em `FormularioAbastecimento.jsx:248-278`;
- bloco de Local copiado do abastecimento (query `locais?produto_id`, um local com saldo já escolhido, "Sai do estoque: X", `CampoSelect` "De qual local do estoque?", aviso "Sem saldo…", erro com "Tentar novamente") — `src/components/patrimonio/FormularioAbastecimento.jsx:142-148`, `:173-185`, `:325-362`;
- dica kg/SACO — `FormularioAbastecimento.jsx:386-390`; regras de unidade `src/lib/abastecimentoRegras.js:60-83`, `LIMITES_ABASTECIMENTO` `:30-33`, `rotuloDaUnidade` `:74`, `formatarQuantidade` `:332`;
- `BOTAO_PRIMARIO`, `BOTAO_PERIGO`, `BOTAO_SECUNDARIO` — `src/components/patrimonio/DialogosAbastecimento.jsx:24-26`;
- estado do envio incerto/erro: `useEnvioAbastecimento` e `AvisoEnvioAbastecimento` — `DialogosAbastecimento.jsx:41`, `:74` (só se as mensagens servirem; senão replicar o estado na página);
- diálogo de motivo do cancelamento do item: `DialogoAcao` — `src/components/financeiroGestao/DialogosLancamento.jsx:473`, já usado pela página (`src/pages/ApontamentosAtividade.jsx:458-470`; atualizar a `descricao` do cancelamento do apontamento: "os itens de produto voltam ao estoque");
- tabela de lotes consumidos recolhida em "Detalhes do estoque": marcação de `src/components/patrimonio/ConsultaAbastecimento.jsx:152-177`;
- card do item: o molde visual de `LinhaItem` (`src/components/financeiroGestao/SecoesLancamento.jsx:55-257`, não exportado: repetir as classes utilitárias existentes, não importar o privado; `BOTAO_LINHA` `:40-44`);
- decimais: `LIMITES`, `multiplicarArredondar`, `somar`, `formatarMoeda` — `src/lib/dinheiroDecimal.js:24-28`, `:194`, `:205`, `:388`.

**Detalhe em vez da linha da lista.** Hoje o registro aberto é a linha da lista (`ApontamentosAtividade.jsx:306`)
e lista/detalhe têm o mesmo formato (`apontamentoAtividadeService.js:520`, `:536`). Com itens: `detalheQuery` no
molde de `src/components/patrimonio/AbastecimentosTela.jsx:219-237`, e a resposta de A1/A2/A3 gravada no cache do
detalhe (`setQueryData`, molde `abrirRegistro` `:248-258`; equivalente atual `mostrarRegistro`
`ApontamentosAtividade.jsx:183-195`), invalidando a lista (a `versao` mudou).

**Porta e allowlist** (`src/apis/atividades/apontamentoAtividadePort.js`):
- `RECURSOS_OPCOES_APONTAMENTO` (`:24`) + `'produtos'`, `'locais'`; `locais` aceita `produto_id` na query (hoje
  `FILTROS_OPCOES` só tem `empresa_id, q, limit, cursor`, `:65`);
- `CAMPOS_DE_ITEM = ['empresa_id','versao','operation_id','tipo','produto_id','local_estoque_id','quantidade','descricao','valor_unitario']`;
- `CAMPOS_DE_CANCELAMENTO_ITEM = ['empresa_id','versao','operation_id','motivo']`;
- `CAMPOS_DE_CANCELAMENTO` (`:47`) + `'operation_id'`;
- funções novas em `src/apis/atividades/atividadesApi.js` (junto de `:86-126`) e `index.js`:
  `adicionarItemApontamentoAtividade(id, corpo)`, `cancelarItemApontamentoAtividade(id, itemId, corpo)`.

**Idempotência no cliente.** `enviarComPendencia` (`src/services/operacaoFinanceiraService.js:282-317`) com escopo
próprio `apontamento:<cliente>:<login>` (molde `src/services/abastecimentoService.js:48-49`, `:223-250`):
adicionar item = ação `'criar'` (repetível: pergunta "Enviar como novo/Manter", `operacaoFinanceiraService.js:267`) com alvo
`itens:<apontamento_id>`; cancelar item = ação `'cancelar'` alvo `item:<item_id>`; cancelar apontamento = ação
`'cancelar'` alvo `<apontamento_id>`. Retentativa explícita reaproveita a chave. Serviço:
`src/services/apontamentoAtividadeService.js` (`cancelarApontamento` em `:116-127` passa a mandar `operation_id`).

**Regras puras** em `src/lib/apontamentoAtividadeRegras.js` (junto de `validarFormulario` `:309`,
`corpoDoFormulario` `:355`, `mensagemErroApontamento` `:489`): `TIPOS_ITEM`, `itemVazio(tipo)`,
`validarItem(item, { unidade, disponivel })` (quantidade > 0 com `LIMITES.QUANTIDADE`; valor com `LIMITES.PRECO`;
descrição 1..255; aviso — não bloqueio — quando passa do `disponivel` do local), `corpoDoItem(item)` (só as chaves
de `CAMPOS_DE_ITEM` do tipo; decimais em texto canônico), `totalDoItem` = `multiplicarArredondar(q, vu, 4)` (o
servidor refaz e manda), `custoDosItens(itens)` (soma só CONFIRMADO, `somar(…, 4)`).

**Mensagens** (em `mensagemErroApontamento`, terminando em "Nada foi gravado."/"Nada foi alterado."; molde
`src/lib/patrimonioErros.js:319-400`): `…_ITEM_INVALIDO` por `field/reason`; `ESTOQUE_SALDO_INSUFICIENTE` com a
UNIDADE do item (não "kg" fixo: `gestaoErros.js:390-394` escreve kg); `…_ESTORNO_BLOQUEADO` com a lista de motivos
do abastecimento (`patrimonioErros.js:320-330`); `…_ITEM_STATUS_INVALIDO` ("Este item já foi cancelado.");
`…_ITENS_EXCEDIDOS`; `…_DATA_COM_ITENS` (se D-1); `CONCURRENCY_CONFLICT` ("Repita o mesmo envio: não duplica").
`CODIGOS_RELER_APONTAMENTO` passa a reler o detalhe. Conferir como `lerErroGestao` recebe o código do servidor
e seguir o abastecimento.

**Fora do D3:** trabalho visual, ícones novos, diálogo de "adicionar item" (nenhum diálogo do repositório tem
`SeletorPaginadoGestao` dentro), prévia de custo (D-5).

---

## 6. Testes obrigatórios

### 6.1 Backend com PostgreSQL real — `backend/tests/apontamentoAtividadeItensNativo.test.mjs` (novo, D4)

Sementes pelo caminho REAL do lote (compra P3 confirmada pela Central), reaproveitando
`backend/tests/patrimonioP1AbastecimentoCenario.mjs:71-192` (`compraP3`, `:132-141`) e o tenant de
`apontamentoAtividadeNativo.test.mjs`. Casos mínimos:

- **T1 PRODUTO feliz:** 2 lotes (custo 5 e 7, datas diferentes), item de 12 consome o mais antigo inteiro e 2 do
  outro; confere `valor_total` exato (Σ q×c, 1 arredondamento), `valor_unitario`, fatias (ordem, lote, qtd, custo),
  lotes (`Disponivel`/`Esgotado`), `estoque_atual` = antes − 12, movimento (`Saída`, `origem_sistema`,
  `exclusao_somente_em`, `tipo_detalhado`, `lancamento_origem_id` = apontamento, `numero_documento`, `data_movimentacao`
  meio-dia UTC da data operacional, número definitivo — nunca `p-…`), versão do apontamento +1, AuditLog.
- **T2 SACO e L:** Produto SACO → item em KG; Produto L → item em L; quantidade gravada = digitada (sem conversão).
- **T3 SERVICO/OUTRO:** total `Dec` (ex.: `'1'` × `'1.00005'` = `1.0001` HALF_UP, nunca `1.0000`; `'0.1'` × `'3'` =
  `0.3000`); `total_zero`; `valor_excede_limite`; nenhum movimento, lote ou `estoque_atual` tocado.
- **T4 Recusas 422/400:** produto inexistente/outra empresa/inativo/unidade; local inexistente/inativo; saldo do
  lote e `estoque_atual` insuficientes (`ESTOQUE_SALDO_INSUFICIENTE` e NADA gravado: contagens de item, fatia,
  movimento, recibo e `versao` iguais); forma (`campo_obrigatorio`, `campo_nao_permitido`, `valor_deve_ser_texto`,
  `cliente_id` no corpo); limite de 200.
- **T5 Status/CAS:** item em apontamento CANCELADO → 409; `versao` velha → 409; PATCH do cabeçalho com `versao`
  anterior ao item → 409 `VERSAO_CONFLITO`; PATCH/DELETE de item → 404 de rota.
- **T6 Cancelar item PRODUTO:** cada fatia volta ao SEU lote (mesmo depois de outra baixa ter consumido o resto
  do lote mais novo), Entrada `estorno_apontamento_atividade` com o mesmo `valor_total`, `movimento_pai_id`, original
  `Estornada` com `movimento_filho_id`, `data_movimentacao` = HOJE da fazenda (não a data operacional),
  `estoque_atual` restaurado, item CANCELADO com `cancelamento_origem='ITEM'`, apontamento CONFIRMADO versão +1.
- **T7 Estorno idempotente:** mesmo `operation_id` + mesmo corpo → 200 `replay:true`, UMA Entrada só; mesma chave
  com outro motivo → 409 `IDEMPOTENCY_CONFLICT` (+ AuditLog do reenvio); chave nova no item já cancelado → 409
  `ITEM_STATUS_INVALIDO` (com `versao` atual) ou `VERSAO_CONFLITO` (com a antiga).
- **T8 Bloqueios do estorno:** lote de origem `Estornado` (compra cancelada antes) → 409 `ESTORNO_BLOQUEADO`
  `lote_indisponivel_para_devolucao` e nada muda; unidade do Produto mudou (L↔KG) → `unidade_mudou`.
- **T9 Cancelar APONTAMENTO com itens:** 2 PRODUTO (produtos diferentes) + 1 SERVICO → tudo CANCELADO
  (`cancelamento_origem='APONTAMENTO'`), 2 Entradas, estoque restaurado, eventos de auditoria (1 + 3); com UM item
  bloqueado → 409 e NADA muda (outro item continua CONFIRMADO, apontamento CONFIRMADO, estoque igual);
  replay do cancelamento → 200 `replay:true`.
- **T10 Concorrência** (`Promise.all`, Postgres real; nenhum 500 em nenhum caso):
  - C1 duas baixas no MESMO lote por apontamentos diferentes, soma > saldo → exatamente um 201 e um 422
    `ESTOQUE_SALDO_INSUFICIENTE`; lote, `estoque_atual` e reconciliação coerentes;
  - C2 dois itens no MESMO apontamento com a mesma `versao` → um 201, um 409 `VERSAO_CONFLITO`;
  - C3 item × cancelamento do apontamento → nunca item CONFIRMADO em apontamento CANCELADO (SQL de invariante);
  - C4 dois cancelamentos do mesmo item com chaves diferentes → um 200, um 409; UMA Entrada;
  - C5 item × abastecimento no mesmo produto/lote → serializados pela trava do produto; totais exatos.
- **T11 Isolamento de tenant:** tenant B não lê, não adiciona, não cancela item de A (404 com corpo idêntico ao de
  id inexistente); opções de produto/locais de B não mostram nada de A; `empresa_id` de outra empresa do mesmo
  tenant não alcança o apontamento.
- **T12 Reconciliação:** depois de T1 e de T6, `reconciliacaoEstoque` sem `DIVERGENCIA_REAL`, sem
  `fora_do_protocolo` e com `soma_fk` = quantidade para o produto; item cancelado não conta consumo.
- **T13 X1 e exclusões:** PATCH/DELETE do lote consumido → 409 `REGISTRO_OPERACIONAL_IMUTAVEL`
  (`vinculo = apontamento_atividade`); DELETE do Produto e do Local com item → 409 (nunca o 403 genérico do P2003);
  Gestão P3: retificar/excluir a compra cujo lote o item consumiu é recusado (prova de proveniência lê
  `lotes_consumidos`, `operacaoFinanceiraService.js:1820-1858`), mesmo depois do estorno.
- **T14 Runtime novo + schema antigo (I-z):** em transação desfeita, sem as 2 tabelas novas, a guarda do lote e a
  reconciliação respondem sem 500.
- **T15 Banco:** as 2 tabelas físicas com RLS sem FORCE, 11 FKs RESTRICT e os 7 CHECKs (inserção direta inválida
  recusada: PRODUTO sem movimento, SERVICO com produto, CANCELADO sem motivo, origem fora do domínio).

**Mutações que a suíte TEM de pegar** (rodar cada uma à mão e registrar no relatório, como a Fatia C fez):
M1 origem `abastecimento_patrimonio` no lugar da nova; M2 custo do item = preço digitado ou custo médio; M3
arredondar por fatia; M4 não gravar as fatias (ou ordem trocada); M5 estorno refazendo FIFO em vez de devolver às
fatias gravadas; M6 estorno na `data_operacional`; M7 não incrementar a `versao` do apontamento; M8 cancelar o
apontamento sem cancelar/estornar os itens; M9 cancelar parcialmente quando um estorno é bloqueado; M10 aceitar
item em apontamento CANCELADO; M11 tirar a conferência `produto.empresa_id`/`ativo`; M12 tirar o
`travarProdutosEstoque` (C1 passa a dar 409/lost update em vez de 422); M13 `estoque_atual -=` escrito pelo
serviço além do motor; M14 total em `Number`; M15 tirar a origem de `ORIGENS_PROTOCOLO`/`ORIGENS_COM_FK` ou o CTE
(T12 falha); M16 tirar a contagem de X1; M17 status do CTE `apo` ignorado (item cancelado contando consumo).

### 6.2 Testes existentes que mudam (D4)
- `backend/tests/apontamentoAtividadeNativo.test.mjs`: o cancelamento passa a levar `operation_id` (`:118`,
  `:642-707`); a corrida de cancelamento (`:700`) passa a esperar `STATUS_INVALIDO` (agora há `FOR UPDATE`).
- `backend/tests/permissoesR2Rotas.test.mjs`: A1, A2, A6, A7 com as ações de §3.6.
- `backend/tests/helpers.mjs:127-130`: `apontamentoAtividadeItemConsumoLote.deleteMany` e
  `apontamentoAtividadeItem.deleteMany` ANTES de `apontamentoAtividade.deleteMany`.
- `scripts/ci/backend-test-pesos.json`: peso do arquivo novo (molde da linha de `apontamentoAtividadeNativo`).

### 6.3 Smoke (frontend, D3)
`tests/smoke/apontamentosAtividade.test.jsx` (existente; `:648` confere o caminho do cancelamento): seção Itens
nos 4 estados; corpo do item só com as chaves da allowlist por tipo; `operation_id` igual na retentativa; regras
puras (`validarItem`, `corpoDoItem`, `totalDoItem` com `'1'`×`'1.00005'`); mensagens dos códigos novos (inclusive
saldo em L e em kg); detalhe relido e cache atualizado depois de A1/A2/A3; local único escolhido sozinho; nenhum
botão de item sem `acoes.editar`/`acoes.cancelar`.

---

## 7. Portão e contagens (frente D5)

**Manifesto** (`scripts/deploy/premergeMigrateLib.mjs`):
- `MIGRATIONS_APROVADAS` (`:44-77`): `'20261113800000_apontamento_atividade_item': '<sha256 do migration.sql final>'`
  com o comentário `// D-PROD-193 (Fatia D do apontamento): ApontamentoAtividadeItem e ApontamentoAtividadeItemConsumoLote — só tabelas novas.`
- `DO_RLS_APROVADOS` (`:80-105`): `sha256(norm(corpo))` do DO (comentários fora, espaços colapsados:
  `:157`, `:161`, `:170-172`), comentário `// D-PROD-193: RLS/REVOKE das 2 tabelas de itens do apontamento (mesmo corpo, lista nova).`
- Nada em `MIGRATIONS_CONTRACT_APROVADAS` (`:108-`).
- `scripts/tests/deploy/premerge-migrate.test.mjs`: B1 (`:51-58`) com as 2 tabelas novas na lista; **B17a/B17b** no
  molde de B14a/B14b (`:687-774`): classificada sozinha = EXPAND, `tabelas_novas` = as 2; violações provadas para
  CHECK/UNIQUE em `ApontamentoAtividade` (agora antiga), `ADD COLUMN … NOT NULL` em antiga e DO citando tabela antiga;
  `--contract` inesperado. (Este contrato os chamava B15a/B15b; a base já usa B15a–B15k na D-PROD-187 e B16 em
  `migrations.test.mjs`, então viraram B17a/B17b no merge da base nova.)

**SQL editor** (`scripts/ops/sql-editor/`): as 2 tabelas entram ANTES de `'ApontamentoAtividade'`, nesta ordem:
`'ApontamentoAtividadeItemConsumoLote','ApontamentoAtividadeItem'` (a fatia referencia o item e o lote; o item
referencia apontamento, movimento, produto, local e usuário; nenhuma tabela referencia as duas):
- `01-precheck-somente-leitura.sql`: lista `:20-23`; contagens `:16` (67→**69** de tenant), `:138-139` e `:197`
  (82→**84** tabelas);
- `02-reset-e-bootstrap-maike-POS-25-MIGRATIONS.sql`: lista `:56-59`; `LOCK TABLE` `:200`; textos `:23` (84), `:27` e `:145` (69);
- `03-postcheck-somente-leitura.sql`: lista `:12-15`;
- `04-limpeza-preservando-maike.sql`: lista `:44-47`; `LOCK TABLE` `:108`; textos `:16` (84), `:20` e `:156` (69).
- `backend/tests/sqlEditorBootstrap.test.mjs:145`: `'84'` e o texto da soma ("+ 2 de itens do apontamento (D-PROD-193)");
  semente (`:100-107`) ganha 1 item SERVICO e 1 item PRODUTO com fatia (lote e movimento inseridos direto na
  semente) para PROVAR a ordem de DELETE do 02/04.

**Contagens no repositório depois da Fatia D** (VERIFICADO: hoje 44 pastas de migration e 82 tabelas em `public`,
67 de tenant — `sqlEditorBootstrap.test.mjs:145`, `01-precheck…sql:16`): **45 migrations, 84 tabelas, 69 de tenant**.
Se a PR #270 (`20261113600000_cadcurvaganho_cadastro`, já aplicada em produção) entrar antes: 46 / 85 / 70.
Em produção, depois de aplicar: 46 concluídas e 85 tabelas (a #270 já está lá: relatório da Fatia C, §7,
`docs/engineering/MAIKE-APONTAMENTO-ATIVIDADE-REPORT.md:125`, `:142-145`). Recontar no merge.
**Recontado no merge da base nova (2026-11-14,** PR #269 em `be322ab8`, com a `main` `00a06096`: PRs #263, #267, #268 e
#270), num banco limpo migrado: **48 migrations, 85 tabelas em `public`, 70 de tenant**. Em produção: 47 concluídas e
83 tabelas hoje; 48 e 85 depois de aplicar. Os ensaios e testes das CONTRACT contam as migrations pela pasta
(`TOTAL_MIGRATIONS`, `MIGRATIONS_PARTIDA`), como a base já fazia.

**Testes de contagem/ensaios das migrations CONTRACT:**
- `scripts/dev/ensaio-patrimonio-simplifica.mjs:75-76`: `MIGRATIONS_DEPOIS_DO_CONTRACT` + `'20261113800000_apontamento_atividade_item'`
  (depende do `ApontamentoAtividade`, que depende do formato novo); `TABELAS_DEPOIS_DO_CONTRACT` + as 2 (ficam fora
  da impressão digital, `:89`); GREEN `:534-535` 82→84 e 44→45; textos `:12-36`.
- `backend/tests/patrimonioSimplificaMigration.test.mjs:7-29`, `:141`, `:149`, `:152`, `:206`: 44→45, 82→84 (partida segue 42).
- `backend/tests/tipoTarefaDropColunasMigration.test.mjs:8`, `:21`, `:94`, `:96`, `:174`, `:183`, `:206`, `:235`, `:259`
  e `scripts/dev/ensaio-tipo-tarefa-drop-colunas.mjs:13`, `:29`, `:150`, `:230`, `:431`: partida 43→44, GREEN 44→45.
- `backend/tests/patrimonioP1Seguranca.test.mjs:677-694` (S8): `DROP TABLE "ApontamentoAtividadeItemConsumoLote", "ApontamentoAtividadeItem"`
  ANTES do `DROP TABLE "ApontamentoAtividade"` (`:692`), senão a FK RESTRICT do item derruba o teste; o
  `deFora` continua `['ApontamentoAtividade']` (as tabelas novas não referenciam as 7 do Patrimônio).
- Se a PR #263 (D-PROD-185) entrar antes, as contagens fixas desses ensaios viram contagem pela pasta (item 4 da
  D-PROD-185, só na PR): adaptar.

**Gates** (`npm run verify:all`): `gate:tenancy` (R9/R11/R12), `gate:indices` (R10), `gate:supabase-public-grants`
(REVOKE + RLS sem FORCE), `gate:import-integrity`, `gate:product-scope` (nenhuma página nova), `gate:no-secrets`,
`gate:base44` (não pode subir), `gate:types` (ratchet), `gate:governance-paths`, `test:gates`, `test:backend`,
`test:smoke`. Nada novo em `config/mapa-manejo-scope.json` (rotas de API não são listadas; página já existe).

**Documentos (D5):** D-PROD-193 em `DECISIONS.md` (antes do comentário `:6817`, que passa a "Próxima decisão:
D-PROD-194"); `docs/engineering/CURRENT-STATE.md`; relatório `docs/engineering/MAIKE-APONTAMENTO-ITENS-REPORT.md`
(R8) com §7 de aplicação; parágrafo no `00 §1` e nota no `07` (Apêndice A) marcados "vale só com a aprovação
explícita do proprietário no merge manual"; atualizar `MAIKE-ESTOQUE-P1-CONTRATO.md` não é necessário.

---

## 8. Frentes de construção (arquivos SEM sobreposição)

Ordem: **D1 primeiro** (schema + `prisma generate`); depois D2, D3 e D4 em paralelo; **D5 por último** (precisa do
`migration.sql` final para o SHA e do resto para recontar). D4 escreve contra o contrato (§3/§4), não contra a
implementação.

| Frente | Arquivos (exclusivos) |
|---|---|
| **D1 schema + migration** | `backend/prisma/schema.prisma`; `backend/prisma/migrations/20261113800000_apontamento_atividade_item/migration.sql` |
| **D2 backend** | `backend/src/modules/apontamentosAtividade/apontamentoAtividadeRoutes.js`; `…/apontamentoAtividadeService.js` (cancelar A3, detalhe A4, `DECIMAIS_DO_CORPO`, D-1); `…/apontamentoAtividadeRepository.js` (trava, leitura de itens/fatias, INCLUIR do detalhe); **novo** `…/apontamentoAtividadeItemService.js` (A1, A2, normalização, fingerprints, tradução de erros do motor); `backend/src/modules/estoqueFisico/estoqueFisicoMotor.js` (SÓ `ORIGEM_APONTAMENTO`, `ORIGENS_SISTEMA`, `EXCLUSAO_SOMENTE_EM` e comentários); `backend/src/modules/estoqueFisico/reconciliacaoEstoque.js`; `backend/src/modules/estoqueLotesNota/estoqueLoteNotaService.js` (X1); `backend/src/shared/errors/errorCodes.js`; `backend/src/shared/errors/AppError.js`; `backend/src/shared/auth/guardasRotas.js` (só comentário, se preciso) |
| **D3 frontend** | `src/components/apontamentos-atividade/FormularioApontamentoAtividade.jsx`; `src/pages/ApontamentosAtividade.jsx`; `src/lib/apontamentoAtividadeRegras.js`; `src/lib/apontamentoAtividadePermissions.js` (só se mudar algo); `src/apis/atividades/apontamentoAtividadePort.js`; `src/apis/atividades/atividadesApi.js`; `src/apis/atividades/index.js`; `src/services/apontamentoAtividadeService.js`; `src/apis/_core/ApiError.js`; `src/apis/_core/nativeHttpClient.js`; `tests/smoke/apontamentosAtividade.test.jsx` |
| **D4 testes backend** | **novo** `backend/tests/apontamentoAtividadeItensNativo.test.mjs` (pode dividir em `…ItensConcorrencia.test.mjs`); `backend/tests/apontamentoAtividadeNativo.test.mjs`; `backend/tests/permissoesR2Rotas.test.mjs`; `backend/tests/helpers.mjs`; `scripts/ci/backend-test-pesos.json` |
| **D5 portão, contagens e docs** | `scripts/deploy/premergeMigrateLib.mjs`; `scripts/tests/deploy/premerge-migrate.test.mjs`; `scripts/ops/sql-editor/01-…sql`, `02-…sql`, `03-…sql`, `04-…sql`; `backend/tests/sqlEditorBootstrap.test.mjs`; `backend/tests/patrimonioP1Seguranca.test.mjs`; `backend/tests/patrimonioSimplificaMigration.test.mjs`; `backend/tests/tipoTarefaDropColunasMigration.test.mjs`; `scripts/dev/ensaio-patrimonio-simplifica.mjs`; `scripts/dev/ensaio-tipo-tarefa-drop-colunas.mjs`; `docs/engineering/DECISIONS.md`; `docs/engineering/CURRENT-STATE.md`; **novo** `docs/engineering/MAIKE-APONTAMENTO-ITENS-REPORT.md`; `docs/constitution/00-CONSTITUICAO.md`; `docs/constitution/07-DO-NOT-DO.md` |

Proibido a todas as frentes: `AbastecimentoBem*` (Fatia E), flags `exige_area`/`pode_ter_*` (não voltam:
`DECISIONS.md:6642`, `:6811`), componente visual/CSS novo, `OperacaoFinanceira*`, motor além das 3 linhas da I-j.

---

## 9. Riscos e pontos que dependem do PROPRIETÁRIO (não decididos aqui)

**Decisões do proprietário:**
- **D-0 (bloqueia o merge).** Registrar a D-PROD-193 com as palavras literais e aprovar o texto do `00 §1` e do `07`
  (Apêndice A): hoje o abastecimento é a "única exceção" de baixa de estoque ligada a bens (`00-CONSTITUICAO.md:56-57`).
- **D-1 PATCH da data com itens.** Se o apontamento tem item PRODUTO CONFIRMADO, mudar `data_operacional`:
  (a) **recusar** com 409 `APONTAMENTO_ATIVIDADE_DATA_COM_ITENS` (recomendado: o movimento ficaria em outra data);
  (b) permitir e deixar o movimento na data antiga; (c) permitir e re-baixar (complexo, não recomendado).
- **D-2 Cancelar apontamento obriga `operation_id`.** Muda o contrato do `POST /:id/cancelar` da PR #269
  (`apontamentoAtividadeRoutes.js:115-122`). Recomendado obrigatório (efeito de estoque = recibo, `DECISIONS.md:5755`);
  um navegador com a versão antiga recebe 400 até recarregar.
- **D-3 Permissões.** Adicionar item = `editar|salvar`; cancelar item = `excluir`; saldo por local = `editar|salvar`.
  Alternativa: adicionar item também com `novo`. Nenhuma ação nova; nenhum perfil recebe acesso por padrão.
- **D-4 Centro de custo.** Itens sem centro próprio, seguindo o centro (snapshot) do cabeçalho; trocar o centro do
  cabeçalho leva o custo dos itens. Alternativa: snapshot do centro em cada item (coluna nova na tabela nova).
- **D-5 Prévia de custo.** Sem prévia na Fatia D (o custo FIFO aparece depois de lançar; a tela mostra o saldo
  por local). Alternativa: rota de prévia sem escrita, no molde do abastecimento.
- **D-6 SERVIÇO × OUTRO.** Mesmos campos e regras; só o rótulo muda. Confirmar que é isso (e se OUTRO precisa de
  unidade livre — hoje não tem).
- **D-7 Arredondamento/moeda.** Total de SERVIÇO/OUTRO em 4 casas (como o custo FIFO), sem moeda configurada; a tela
  exibe em R$. Alternativa: casas da moeda do perfil financeiro (cria dependência da Central).
- **D-8 Combustível como item.** Nada impede lançar combustível como item PRODUTO (baixa de estoque sem medidor nem
  tanque). Com a Fatia E (abastecimento pendurado no apontamento) isso vira dupla contagem possível. Proibir
  Produto em L no item? Avisar? Decisão do proprietário.
- **D-9 Limite de 200 itens** por apontamento (molde da Central).

**Riscos técnicos:**
- **R1 Cancelamento travado.** Se um lote de origem foi estornado (compra cancelada) ou a unidade do Produto
  mudou, o item/apontamento NÃO cancela (409, fail-closed, como o abastecimento). O usuário fica sem saída até
  existir comando de ajuste (fora do escopo, `00-CONSTITUICAO.md:110-112`).
- **R2 Baixa retroativa.** A saída fica na data operacional (pode ser antiga) e consome os lotes de HOJE (FIFO atual),
  como o abastecimento (só data futura é recusada, `abastecimentoPlano.js:301-303`). A razão por data pode mostrar
  consumo antes da entrada do lote.
- **R3 Ordem de deploy (#259).** O detalhe do apontamento lê a tabela nova: código antes da migration = 500 na tela.
  Runbook: aplicar a migration ANTES do merge/deploy (GO do proprietário; caminho A ou B com desvio da D-PROD-74
  registrado, como `DECISIONS.md:6765`, `:6788`). Os módulos antigos ficam protegidos pela I-z.
- **R4 Fila de migrations em produção.** A CONTRACT da #268 (`20261113500000`) ainda não foi aplicada e tem data
  anterior a migrations já aplicadas (`MAIKE-APONTAMENTO-ATIVIDADE-REPORT.md:147`); `20261113800000` não colide,
  mas quem renomear a #268 não pode usar `…800000`. Contagens dependem da ordem de merge de #263/#268/#270.
  **Atualização (2026-11-14):** a CONTRACT da #268 já está aplicada em produção (as PRs #263, #267, #268 e #270 foram
  mergeadas; produção tem as 47 migrations da base). A fila agora é a CONTRACT da PR #273
  (`20261114100000_cadcurvaganho_mensal`), que exige release isolada: nunca na mesma release desta.
- **R5 Transação curta.** `TRANSACAO_CURTA` (9 s, lock 8 s). O cancelamento com muitos itens PRODUTO depende do
  `estornarEmLote` em lote; o teste com ~50 itens deve ficar bem abaixo de 9 s. Se não, decidir TRANSACAO_LONGA
  (`transacaoConcorrente.js:31`) — a tela usa 20 s de timeout do navegador.
- **R6 Motor compartilhado.** Mudar `estoqueFisicoMotor.js` (3 linhas) e `reconciliacaoEstoque.js` toca
  abastecimento, Central e suplementação: rodar as suítes `estoqueP0Reconciliacao*`, `estoqueP1M2MotorParametros`,
  `patrimonioP1Abastecimentos*` e Gestão P3 inteiras.
- **R7 Proveniência da compra (Gestão P3).** Consumo de item bloqueia retificar/excluir a compra do lote, mesmo
  depois do estorno (`DECISIONS.md:5762`); é regra existente, só precisa de teste e de aviso no relatório.
- **R8 `versao` do apontamento muda com itens.** Quem estiver editando o cabeçalho enquanto outro lança item leva
  409 e precisa reler (comportamento esperado do CAS, mas novo para a tela).

---

## Apêndice A — Rascunho do texto constitucional (para aprovação do proprietário; o agente NÃO aprova)

**`00-CONSTITUICAO.md` §1, depois do parágrafo da D-PROD-177:**

> **Expansão autorizada pelo proprietário (D-PROD-193):** **Apontamento de Atividade — itens** (página
> `ApontamentosAtividade`, Fatia D do apontamento). O apontamento confirmado recebe itens de custo. O item
> **PRODUTO** baixa do estoque **exatamente** a quantidade digitada, na unidade de estoque do Produto, pelo motor de
> estoque existente (FIFO por lote, custo FIFO final, estorno exato ao cancelar o item ou o apontamento), como o
> abastecimento. Os itens **SERVIÇO** e **OUTRO** têm descrição livre, quantidade e valor unitário, com total
> calculado, sem cadastro de serviço, sem fornecedor e sem efeito de estoque. Esta é a segunda exceção à lista
> "fora" da D-PROD-157, só no trecho "baixa de estoque" por item de apontamento. Continua **fora**: lançamento
> financeiro, título ou conta a pagar a partir do item, rateio por item, cadastro de serviços, fornecedor no item,
> devolução de sobra ao estoque, edição de item, custo/hora, manutenção, peças, relatórios de custo e qualquer
> mudança no abastecimento. Nesta parte, esta expansão supera apenas o "única" do trecho "Esta é a única
> exceção…" da D-PROD-159; o resto dela continua valendo. Texto redigido pelo agente; vale só com a aprovação
> explícita do proprietário no merge manual (§4).

**`07-DO-NOT-DO.md`, depois da nota D-PROD-177:**

> **Nota (D-PROD-193):** os itens do Apontamento de Atividade são a segunda exceção, depois do abastecimento, à
> lista "fora" da D-PROD-157, só no trecho baixa de estoque, nos limites da decisão. Continua proibido: baixar o
> item fora do motor de estoque ou por `Produto.estoque_atual -= …`; gravar o movimento com a origem do
> abastecimento ou do financeiro; converter unidade; apagar ou editar item (só cancelar com estorno exato); tratar
> devolução de sobra como estorno; criar `OperacaoFinanceira`, título ou rateio a partir do item; cadastro de
> serviços ou fornecedor no item; reintroduzir as flags `exige_area`/`pode_ter_*`; conceder a tela ou as ações a
> perfis existentes por padrão. Texto redigido pelo agente; vale só com a aprovação explícita do proprietário no
> merge manual (`00-CONSTITUICAO.md` §4).

---

## 10. Pontos do §9 resolvidos pelo orquestrador (padrões recomendados; o proprietário revisa na PR)

Decisões do proprietário já tomadas no chat (perguntas e opções escolhidas, transcritas literalmente na D-PROD-193):
- "Fatia D, item do tipo PRODUTO no apontamento (ex.: herbicida aplicado numa roçada): ele baixa o estoque?" → **"Baixa o estoque (Recomendado)"** — "Igual ao abastecimento: o item escolhe produto e local de estoque, sai do estoque pelo motor único (FIFO), o custo vem do lote real e cancelar o apontamento estorna."
- "Fatia D, itens de SERVIÇO e OUTROS CUSTOS (ex.: mão de obra terceirizada, frete): como registrar?" → **"Descrição + valor (Recomendado)"** — "Descrição livre, quantidade, valor unitário e total calculado. Não existe cadastro de serviços hoje, e não crio um."

Pontos abertos do §9, resolvidos assim (todos registrados na D-PROD-193 como interpretação, reversíveis):
- **D-0:** a D-PROD-193 registra as palavras acima. O texto do Apêndice A entra em `00 §1` e `07` **nesta PR**, marcado como "vale só com a aprovação explícita do proprietário no merge manual". O agente não o aprova.
- **D-1:** opção (a). `PATCH` de `data_operacional` com item PRODUTO CONFIRMADO → 409 `APONTAMENTO_ATIVIDADE_DATA_COM_ITENS`.
- **D-2:** `operation_id` **obrigatório** em `POST /apontamentos-atividade/:id/cancelar` (efeito de estoque = recibo). O frontend da Fatia D passa a enviar; aba antiga recebe 400 até recarregar.
- **D-3:** adicionar item = `editar|salvar`; cancelar item = `excluir`; opções de produto/local = `ver` (visualizar), saldo por local = `editar|salvar`. Nenhuma ação nova; nenhum perfil recebe acesso por padrão.
- **D-4:** sem centro próprio no item; vale o centro de custo (snapshot) do cabeçalho.
- **D-5:** sem prévia de custo nesta fatia.
- **D-6:** SERVICO e OUTRO com os mesmos campos e regras; só o rótulo muda; sem unidade.
- **D-7:** total de SERVICO/OUTRO em 4 casas, `ROUND_HALF_UP`; a tela exibe em R$.
- **D-8:** **recusar** como item PRODUTO um produto de combustível, isto é, um produto aceito por algum tanque (`TanqueBemProduto`). Recusa: 422 `APONTAMENTO_ATIVIDADE_ITEM_INVALIDO` com `reason: 'combustivel_no_abastecimento'` ("combustível se lança no abastecimento"). Assim se evita dupla contagem com a Fatia E; a regra é reversível.
- **D-9:** limite de 200 itens por apontamento (contando cancelados), **422** ao exceder (`APONTAMENTO_ATIVIDADE_ITENS_EXCEDIDOS`). **Errata (2026-11-14):** este item dizia "409 ao exceder"; o certo é 422, como na tabela de erros (§3.5), no código, nos testes, na tela e na D-PROD-193.
