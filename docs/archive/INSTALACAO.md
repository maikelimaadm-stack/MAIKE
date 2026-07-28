# Instalação da governança no MAKGESTAO

## 1. Copiar arquivos

Copie todo o conteúdo deste pacote para a raiz do repositório MAKGESTAO,
na branch `saas-migration`.

Estrutura resultante:

```
MAKGESTAO/
├── CLAUDE.md
├── README_AI.md
├── AGENTS.md
├── docs/
│   ├── constitution/
│   │   ├── 00-CONSTITUICAO.md
│   │   ├── 07-DO-NOT-DO.md
│   │   └── 08-REGRAS-DE-IA.md
│   └── engineering/
│       ├── CURRENT-STATE.md
│       ├── DECISIONS.md
│       ├── GATE-REGISTRY.md
│       └── CONTINUITY-PROTOCOL.md
└── scripts/gates/
    ├── gate-tenancy.mjs
    ├── gate-indices.mjs
    ├── gate-base44.mjs
    ├── gate-apis.mjs
    └── verify-all.mjs
```

Coloque também o `ROADMAP-SAAS.md` em `docs/engineering/`.

## 2. Adicionar scripts ao package.json

```json
{
  "scripts": {
    "gate:tenancy": "node scripts/gates/gate-tenancy.mjs",
    "gate:indices": "node scripts/gates/gate-indices.mjs",
    "gate:base44":  "node scripts/gates/gate-base44.mjs",
    "gate:apis":    "node scripts/gates/gate-apis.mjs",
    "verify:all":   "node scripts/gates/verify-all.mjs"
  }
}
```

## 3. Gerar o baseline

```bash
npm run gate:base44
```

Isso cria `scripts/gates/base44-baseline.json`. **Commite esse arquivo.**

## 4. Verificar

```bash
npm run verify:all
```

Esperado neste momento:

- `gate:tenancy` — SKIP (schema ainda não existe)
- `gate:indices` — SKIP
- `gate:base44` — PASS (baseline recém-criado)
- `gate:apis` — **FAIL**, 4 arquivos em `src/components/offline/`

A falha do `gate:apis` é esperada e está registrada como DBT-01 em
`CURRENT-STATE.md`. Será resolvida na Fase 4.

## 5. Commit

```bash
git add .
git commit -m "governanca: constituicao, regras de IA e gates executaveis"
```

## 6. Verificação final

Abra uma sessão nova do Claude Code e pergunte:

> Quais são as regras invioláveis deste projeto?

Se ele responder citando R1 a R8 sem você ter explicado nada, a governança está
funcionando.
