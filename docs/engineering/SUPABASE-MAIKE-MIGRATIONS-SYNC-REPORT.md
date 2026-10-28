# Supabase MAIKE — sincronização de migrations (2026-10-23)

**Projeto:** Supabase `MAIKE` (`uuemcasqcdjucflulkne`, sa-east-1)

## Situação

O banco remoto tinha apenas migrations até **P4.1** (Setor). Código na `main` já incluía **P4.2** (AreaPastagem) e **P4.3** (geografia do mapa).

## Ação

Migrations aplicadas via Supabase (DDL alinhado a `backend/prisma/migrations/`):

- `p4_2_area_pastagem_native`
- `p4_3_map_geography_native`

## Efeito

Backend em produção/preview pode persistir áreas de pastagem e camada geográfica nativa no mesmo PostgreSQL usado pelo login `admin`.

## Pendente operacional

- Redeploy do **backend** (Railway) após merge, com `deploy:migrate` no pre-deploy — não substituir por SQL manual em rotina futura.
- **RLS** continua desligado (P8); não habilitar sem políticas.

---

## Sincronização 2026-10-28 (PR #108 / EMPRESA-NUM-01)

**Operador:** Cloud Agent (Supabase MCP `apply_migration` + registro em `_prisma_migrations` com checksum Prisma).

| `migration_name` | Aplicada (UTC) | Verificação |
|------------------|----------------|-------------|
| `20261028200000_p54_marca_list_keyset_indexes` | 2026-10-28 ~01:12 | Índices `Marca_cliente_id_*_createdAt_id_idx` presentes |
| `20261028210000_empresa_numero_empresa` | 2026-10-28 ~01:12 | Coluna `Empresa.numero_empresa` NOT NULL; unique `(cliente_id, numero_empresa)` |
| `20261028230000_operacao_idempotente` | 2026-10-28 ~01:12 | Tabela `OperacaoIdempotente` presente |

**Contagem `_prisma_migrations`:** 17 registros (inclui as três acima).

**Nota:** DDL foi aplicado diretamente no Supabase (pedido do operador). Histórico Prisma foi alinhado com inserts de checksum oficiais — equivalente a `prisma migrate resolve --applied` após DDL já presente. Próximos deploys devem usar `npm run deploy:migrate` (no-op se repositório = banco).

**Pós-ação:** redeploy **Production** Vercel se o runtime ainda estiver em SHA anterior ao merge de PR #108; smoke `POST /api/native/empresas`.
