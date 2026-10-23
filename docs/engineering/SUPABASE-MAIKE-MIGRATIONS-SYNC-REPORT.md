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
