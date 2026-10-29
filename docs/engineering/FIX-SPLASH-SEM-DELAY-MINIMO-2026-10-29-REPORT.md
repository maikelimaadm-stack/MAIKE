# FIX — Splash sem delay mínimo de 5s

**Data:** 2026-10-29  
**Branch:** `cursor/splash-sem-delay-minimo-26e2`  
**Base:** `main` pós-PR #137 (splash único)

## Pedido

Após o splash único (#137), o usuário pediu: manter a entrada **sem** espera
artificial de ~5 segundos — entrar assim que auth + dados do layout estiverem
prontos. Também questionou se a **pesquisa** (buscar telas) tinha sumido.

## Causa

`Layout.jsx` ainda guardava o gate legado `minTimePassed` com `setTimeout(..., 5000)`
antes de chamar `markLayoutBootReady()`. O splash único no `App` só escondia
depois desse mínimo **e** de `!authLoading && !empresasLoading`.

## Correção

- Removido `minTimePassed` / timer de 5s em `src/Layout.jsx`.
- `markLayoutBootReady()` dispara quando `!authLoading && !empresasLoading`.
- Comentários em `App.jsx` e `bootSplashContext.jsx` alinhados (sem “mínimo 5s”).

Fade de saída do `SplashScreen` (`transition-opacity duration-500` só com
`visible === false`) permanece — é animação de saída, não espera forçada.

## Pesquisa (buscar telas)

**Intacta.** Em `Layout.jsx` continuam:

- botão lupa no header (`setSearchOpen(true)`);
- `Dialog` “Buscar telas” com filtro por título/categoria.

Nada foi removido na PR #137 nem nesta correção.

## Verificação

1. Entrar autenticado: splash some assim que usuário/empresas carregam (sem ~5s).
2. Navegar no menu: sem splash de novo (shell único).
3. Lupa do header abre “Buscar telas”.
4. `appShell.test.jsx` mantém `BootSplashProvider` em volta do Layout.
