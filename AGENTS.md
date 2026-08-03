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
| Dívida de tipos (catraca) | `npm run typecheck` |
| Dívida de tipos (bruta) | `npm run typecheck:raw` |
| Smoke automatizado | `npm run test:smoke` |
| Testes dos gates | `npm run test:gates` |
| Build | `npm run build` |

## Gates

Todos os scripts vivem em `scripts/gates/`.

| Gate | Comando | Verifica |
|---|---|---|
| Testes dos gates | `npm run test:gates` | Os próprios gates, com casos de falha |
| Governança | `npm run gate:governance-paths` | Documentos, links e gates coerentes |
| Package/lock | `npm run gate:package-sync` | `package.json` e `package-lock.json` batem |
| Escopo do produto | `npm run gate:product-scope` | Rotas, menu, schemas, functions **e entidades dentro das functions** (por AST) |
| Fechamento de código | `npm run gate:source-closure` | Nenhum arquivo executável órfão em `src/` |
| Integridade de imports | `npm run gate:import-integrity` | Nenhum import quebrado em `src/` |
| Segredos | `npm run gate:no-secrets` | Nenhum segredo em arquivo versionado; nenhum `.env` |
| Base44 | `npm run gate:base44` | Acoplamento só diminui (10 eixos) |
| Tipos | `npm run gate:types` | A dívida de tipos não cresce |
| **Todos** | `npm run verify:all` | 12 etapas, build por último |

### Baselines

Ambos são versionados. **Baseline ausente reprova** — nenhum gate cria baseline
sozinho. Execução normal nunca escreve arquivo.

```bash
# só grava se não houver regressão E houver pelo menos uma redução
node scripts/gates/gate-base44-ratchet.mjs --update
node scripts/gates/gate-typecheck-ratchet.mjs --update

# mudança consciente de jsconfig.typecheck.json ou de versão do TypeScript
# (sujeita à mesma barreira de não regressão)
node scripts/gates/gate-typecheck-ratchet.mjs --rebase-contract
```

`gate:types` não tem `--seed`. Baseline perdido se restaura do Git:
`git checkout -- scripts/gates/typecheck-baseline.json`.

`scripts/gates/base44-baseline.json` · `scripts/gates/typecheck-baseline.json`

O baseline de tipos também grava o hash canônico da configuração, o comando e a
versão do compilador (D-PROD-13). Reduzir a cobertura reprova com
`P01-TYPE-CONTRACT` — nem `--rebase-contract` aceita.

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
- **`gate:types` verde significa "a dívida não cresceu", não "sem erros".**
  São 2.802 diagnósticos versionados, com teto certificado de 2.802 (DBT-03).
  Veja os reais com `npm run typecheck:raw`. Afrouxar `jsconfig.typecheck.json`
  não passa: a configuração está no baseline (D-PROD-13). Rebasear também não
  passa: **nenhum modo** aceita diagnóstico novo (D-PROD-17).
- **Código novo entra com zero diagnóstico.** Absorver erro novo no baseline é
  proibido — corrija no código.
- **Function Base44 não pode indexar `entities` com variável.** Use acesso
  literal ou um registro literal local — senão `gate:product-scope` reprova com
  `P01-SCOPE-FUNCTION-DYNAMIC-UNVERIFIABLE` (D-PROD-15).
- **Arquivo órfão reprova** (`gate:source-closure`). Remova-o ou justifique em
  `orphanAllowlist` com consumidor dinâmico real — "pode ser útil depois" não
  é justificativa.
- **Branch.** Uma missão, uma branch, um PR. Não trabalhe na `main`.
- **Menu e rotas têm SSOT único**: `src/lib/menuConfig.js` e `src/pages.config.js`.
