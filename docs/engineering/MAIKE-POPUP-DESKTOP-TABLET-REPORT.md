# MAIKE-POPUP-DESKTOP-TABLET — relatório

**Decisão:** [D-PROD-290](./DECISIONS.md) · **Data:** 2026-11-24 · sem servidor, sem migration

- `src/styles/lancamento-lote.css`: `.mk-ll-dlg--largo.is-desktop:has(.mk-dp)` em ≥1024 px → `width: 720px; max-height: min(820px, 100vh - 64px)`.
- `src/styles/mk-dp-detalhes-v13.css`: removido o arranjo de 2 colunas (área | lotação) só do computador.
- Verificação: `verify-all` estático e smoke no CI.
