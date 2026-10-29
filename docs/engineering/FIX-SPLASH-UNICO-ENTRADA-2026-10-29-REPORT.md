# FIX — Splash único na entrada (pós-PR #135)

**Data:** 2026-10-29  
**Branch:** `cursor/splash-unico-sem-piscar-92b8`

## Sintoma

Após merge do PR #135 (remoção de `animate-ping` / `animate-pulse`), o usuário ainda
via **piscar** ao entrar no sistema.

## Causa raiz

Dois `SplashScreen` em sequência, com **remontagem** e **fade de opacidade** em cada um:

1. **`App.jsx`** — splash enquanto `isLoadingAuth` / `isLoadingPublicSettings`; ao
   concluir, o componente **desmontava**.
2. **`Layout.jsx`** — segundo splash (`showSplash` + mínimo 5s + empresas/usuário);
   **montava do zero** com `transition-opacity duration-500`.

Entre (1) e (2) o shell (`header`, `bg-slate-50`) podia aparecer por um frame; o
segundo splash reiniciava a transição de opacidade — percebido como flash/piscar.

PR #135 alinhou visual (sem ping/pulse) e reutilizou o mesmo componente no auth, mas
não unificou o **ciclo de vida** do overlay.

## Correção

- **`src/lib/bootSplashContext.jsx`** — Layout sinaliza `markLayoutBootReady()` quando
  termina o bootstrap (5s mín. + `authLoading` + `empresasLoading`).
- **`App.jsx`** — **uma** instância de `SplashScreen` do fim do auth até
  `layoutBootReady`; rotas montam **por baixo** do overlay (sem segundo splash).
- **`Layout.jsx`** — remove `<SplashScreen>` local; chama o contexto.
- **`SplashScreen.jsx`** — `transition-opacity` só na **saída** (`visible === false`),
  evitando fade-in repetido enquanto `visible` permanece `true`.

StrictMode já estava desligado em `main.jsx` — não era fator.

## Verificação

1. `npm run dev` — abrir `/`, login se necessário.
2. Observar **um** fundo branco + logo + spinner contínuos até o app aparecer (fade
   único no fim).
3. Navegar no menu — **sem** splash de 5s de novo (shell único inalterado).

## Gates / CI

`gate:source-closure`, `gate:import-integrity` — OK nos arquivos tocados.

**CI (`test:smoke`):** na primeira passagem do PR, `appShell.test.jsx` montava
`Layout` sem `BootSplashProvider`. Com `useBootSplash()` no Layout, o helper
`renderShell` quebrou com `useBootSplash must be used within BootSplashProvider`.
Correção: envolver o Layout no mesmo provider que o `App` usa em produção
(`9ff62367`).
