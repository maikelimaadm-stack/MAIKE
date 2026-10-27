# Demo seed — tenant MAIKE (produção / Supabase)

Script operacional para popular **dados mínimos de demonstração** em um tenant
já existente. Não cria usuário, não altera senha e não apaga linhas.

## Artefato

| Item | Caminho |
|------|---------|
| Script | `scripts/ops/seed-demo-tenant.mjs` |
| npm | `npm run ops:seed-demo-tenant` |

## O que é inserido (chaves estáveis)

Reexecutar o script é seguro: registros identificados por `numero_*` ou título
fixo são **pulados** se já existirem.

| Entidade | Chave de idempotência |
|----------|------------------------|
| Marca | `SEED-M01`, `SEED-M02` |
| Setor | `SEED-S01` |
| Categoria | `SEED-CAT01` |
| Produto | `SEED-P01` |
| Lote | `SEED-L01` (vinculado ao setor seed se criado) |
| GrupoAtividade | nome `SEED Grupo Demo` |
| TipoTarefa | `SEED Inspeção` no grupo acima |
| LancamentoTarefa | título `[SEED] Inspeção de pasto demo` |

## Tenant MAIKE (referência)

| Campo | Valor |
|-------|--------|
| Supabase project | `uuemcasqcdjucflulkne` |
| `SEED_CLIENTE_ID` | `ca98fddc19f711cde8c2a6383` |
| `SEED_EMPRESA_ID` | `empresa-maike-principal` |
| Cliente (`codigo`) | `maike` |

## Conexão Supabase (porta 5432 direta)

Use a connection string **Session pooler desligado** / **Direct connection**
do dashboard Supabase (porta **5432**), não a URL do pooler transaction mode
para scripts longos, salvo orientação contrária da infra.

1. Copie `DATABASE_URL` do projeto (Settings → Database → URI).
2. **Nunca** commite a URI no repositório.
3. Exporte no shell local ou no CI manual one-shot.

## Execução

### Desenvolvimento (PostgreSQL local)

```bash
export DATABASE_URL='postgresql://...'
export SEED_CLIENTE_ID='<cuid-do-cliente-local>'
export SEED_EMPRESA_ID='empresa-demo'

npm run ops:seed-demo-tenant
```

### Produção / Supabase

Confirmação explícita obrigatória quando `NODE_ENV=production`:

```bash
export DATABASE_URL='postgresql://postgres.[ref]:[SENHA]@db.uuemcasqcdjucflulkne.supabase.co:5432/postgres'
export SEED_CLIENTE_ID='ca98fddc19f711cde8c2a6383'
export SEED_EMPRESA_ID='empresa-maike-principal'
export NODE_ENV=production
export CONFIRM=sim

npm run ops:seed-demo-tenant
```

Sem `CONFIRM=sim`, o script **aborta** em produção.

## Alternativa: SQL manual (MCP / psql)

Equivalente ao script — apenas `INSERT`, sem `DELETE`/`TRUNCATE`. Preferir
sempre o script Node para manter uma única fonte de regras; SQL avulso só
para emergência com revisão.

## Relacionado

- Bootstrap de usuário: `npm run auth:bootstrap:local` ( **não** roda em
  `NODE_ENV=production` ).
- RLS permanece desligado até **P8** — ver `P8-HARDENING-CHECKLIST.md`.
