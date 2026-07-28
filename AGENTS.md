# AGENTS.md — Comandos operacionais

## Setup

```bash
npm install
cp .env.example .env.local
```

Preencha `VITE_GOOGLE_MAPS_API_KEY` em `.env.local`. Sem essa variável o Mapa
Geral abre e mostra "Mapa indisponível" com a mensagem de configuração — não
fica em branco.

Não existe `backend/` ainda. Ele entra em **P3** — ver `docs/engineering/ROADMAP.md`.

## Desenvolvimento

| Tarefa | Comando |
|---|---|
| Frontend | `npm run dev` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |

## Gates

Todos os scripts vivem em `scripts/gates/`.

| Gate | Comando | Verifica |
|---|---|---|
| Governança | `npm run gate:governance-paths` | Documentos, links e gates coerentes |
| Escopo do produto | `npm run gate:product-scope` | Rotas, menu, schemas e functions dentro do manifesto |
| Integridade de imports | `npm run gate:import-integrity` | Nenhum import quebrado em `src/` |
| Segredos | `npm run gate:no-secrets` | Nenhuma chave literal; nenhum `.env` versionado |
| Base44 | `npm run gate:base44` | Acoplamento só diminui |
| **Todos** | `npm run verify:all` | Os 5 gates + lint + typecheck + build |

Baseline da catraca: `scripts/gates/base44-baseline.json`.
Para regravá-lo depois de uma redução real:

```bash
node scripts/gates/gate-base44-ratchet.mjs --update
```

## Escopo do produto

O escopo executável é `config/mapa-manejo-scope.json`. Ele declara páginas,
rotas manuais, schemas e functions permitidos, além dos domínios proibidos.

Para adicionar uma página ou entidade:

1. Provar a necessidade pelo fechamento de dependências
2. Registrar a decisão em `docs/engineering/DECISIONS.md`
3. Só então atualizar o manifesto
4. Rodar `npm run verify:all`

## Armadilhas

- **`base44/` é a especificação de origem.** Não altere o desenho de um schema
  preservado. Excluir schema fora do escopo é permitido por D-PROD-02.
- **Nenhum schema ou function Base44 novo.** A Base44 só sai (D-PROD-04).
- **`npm run typecheck` está vermelho desde antes do P0.1** (DBT-03). Não
  desabilite o gate nem edite `jsconfig.json` para esconder isso.
- **Branch.** Uma missão, uma branch, um PR. Não trabalhe na `main`.
- **Menu e rotas têm SSOT único**: `src/lib/menuConfig.js` e `src/pages.config.js`.
