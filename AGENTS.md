# AGENTS.md — Comandos operacionais

## Setup

```bash
npm install
cp .env.example .env.local
```

Backend:

```bash
cd backend
npm install
cp .env.example .env
npx prisma generate
```

## Desenvolvimento

| Tarefa | Comando |
|---|---|
| Frontend | `npm run dev` |
| Backend | `cd backend && npm run dev` |
| Lint | `npm run lint` |
| Build | `npm run build` |

## Gates

| Gate | Comando | Verifica |
|---|---|---|
| Tenancy | `npm run gate:tenancy` | Todo model tem `cliente_id` |
| Índices | `npm run gate:indices` | Índice composto e unique com `cliente_id` |
| Base44 | `npm run gate:base44` | Referências só diminuem |
| APIs | `npm run gate:apis` | Componente não acessa dado direto |
| **Todos** | `npm run verify:all` | Roda os quatro |

## Prisma

| Tarefa | Comando |
|---|---|
| Validar schema | `cd backend && npx prisma validate` |
| Gerar client | `cd backend && npx prisma generate` |
| Criar migration | `cd backend && npx prisma migrate dev --name <nome>` |

## Armadilhas

- **`base44/` é somente leitura.** É a especificação de origem das 87 entidades.
- **Branch.** Todo trabalho em `saas-migration`. A `main` está congelada em `base44-freeze`.
- **Baseline do gate de Base44.** Está em `scripts/gates/base44-baseline.json`.
  Só pode ser atualizado para **baixo**. Aumentar é violação.
