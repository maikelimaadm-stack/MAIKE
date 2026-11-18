# MAIKE — Lançamento de Atividades pela área (relatório, D-PROD-250)

> **fatia:** reorganizar o lançamento para quem está no campo · **branch:** `cursor/atividades-por-area-0b6c` · **PR:** a abrir
> Decisão **D-PROD-250** · a partir da `main` `637a3002` (PR #327, D-PROD-249)

O proprietário aprovou a lógica dos rascunhos e pediu o visual do MAIKE. O tipo se cadastra uma vez, longe do dia a dia. Abrir a atividade é um passo de cada vez. No campo, cada área tem o que já foi feito e o custo dela. O total da atividade é a soma.

## 1. O que entra

| Camada | Entrega |
|---|---|
| Tela | `AssistenteNovaAtividade` (tipo → áreas → conferir); `FluxoPorArea` (cartões, detalhe agrupado, "o que registrar", confirmação); lista com situação e custo em palavras simples; Tipos de atividade com "O que pode registrar" |
| Regras de tela | `src/lib/atividadeFluxoCampo.js` (situação, progresso, grupos pasto/lavoura, opções de registro, frase da confirmação, movimentos por tipo) |
| O que não muda | Servidor, banco, permissões, formulários de linha, estoque, medidor, abastecimento. "Mais detalhes" guarda o ajuste por tipo e por dia |

## 2. Migration `20261118100000_atividade_areas`

Já está no repositório (D-PROD-249, CONTRACT, SHA `098f0d06d45922886f64cb4e2f4bd00644dac26b833e8020feeed2632d31ec06`). O registro daquela decisão diz **`SCHEMA_APPLIED_PROD: NÃO`**. Esta entrega não cria migration e não aplica aquela. Sem ela no banco, começar a área e gravar o registro na área não funcionam em produção.

## 3. Como ver na máquina do proprietário

Pasta separada, para não mexer no checkout que já está na porta 5173:

```bash
git fetch origin cursor/atividades-por-area-0b6c
git worktree add ../MAIKE-atividades cursor/atividades-por-area-0b6c
cd ../MAIKE-atividades
npm install
```

Copie o `.env` e o `.env.local` do checkout que já funciona (não versionar). O frontend precisa de `VITE_MAIKE_API_URL` (em desenvolvimento, `http://localhost:3333`). O backend precisa de `DATABASE_URL`, `AUTH_SECRET` e `FRONTEND_ORIGINS` incluindo `http://localhost:5174`.

```bash
npm run dev -- --port 5174
```

O backend, se for o mesmo da porta 3333 que já está no ar, não precisa de outro processo. Se subir outro, use outra `PORT` e aponte o `VITE_MAIKE_API_URL` para ela. A porta 5173 não é usada por este comando.

## 4. Prévia

`vercel.json` deixa esta branch passar no `ignoreCommand`, junto com `main` e `codex/previa-detalhes-mapa`. O endereço da prévia aparece no comentário da Vercel no PR, depois do build.
