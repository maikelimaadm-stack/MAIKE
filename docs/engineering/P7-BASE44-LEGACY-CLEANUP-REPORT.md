# P7 — Limpeza de legado Base44 (relatório)

**Branch:** `cursor/p7-base44-legacy-cleanup-516d`  
**Decisão:** D-PROD-52

## Entregue

- Removidos `VITE_BASE44_*`, `getDataProviderConfig` e parâmetros de URL/storage
  `base44_*` de `src/config/runtimeConfig.js` — sem consumidor após P5.5
- `.env.example` documenta apenas `VITE_GOOGLE_MAPS_API_KEY` e `VITE_MAIKE_API_URL`
- Comentários históricos (`base44.auth`, `base44Client`) reescritos em session/offline/textNormalization
- Baseline `gate:base44` reduzido (`arquivosComSdk`, `authRefs` → 0)

## Mantido de propósito

- Schemas `base44/entities/*.jsonc` (35) — escopo do manifesto; remoção exige decisão de produto
- Stub `base44Provider.js` vazio — fronteira API autorizada pelo manifesto

## Verificação

- `npm run verify:all` verde na branch
