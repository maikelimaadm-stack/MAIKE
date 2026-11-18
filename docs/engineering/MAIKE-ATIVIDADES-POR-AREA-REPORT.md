# MAIKE — Lançamento de Atividades pela área (relatório, D-PROD-250)

> **fatia:** reorganizar o lançamento para quem está no campo · **branch:** `cursor/atividades-por-area-0b6c` · **PR:** a abrir
> Decisão **D-PROD-250** · a partir da `main` `637a3002` (PR #327, D-PROD-249)

O proprietário aprovou a lógica dos rascunhos e pediu o visual do MAIKE. O tipo se cadastra uma vez, longe do dia a dia. Abrir a atividade é um passo de cada vez. No campo, cada área tem o que já foi feito e o custo dela. O total da atividade é a soma.

## 1. O que entra

| Camada | Entrega |
|---|---|
| Tela | `AssistenteNovaAtividade` (tipo → áreas → conferir); `FluxoPorArea` (cartões, detalhe agrupado, "o que registrar", confirmação); lista com situação e custo em palavras simples; Tipos de atividade com "O que pode registrar" |
| Regras de tela | `src/lib/atividadeFluxoCampo.js` (situação, progresso, grupos pasto/lavoura, opções de registro, frase da confirmação, movimentos por tipo) |
| Abastecimento pela área | `JanelaAbastecimentoDaArea`: o mesmo formulário, revisão e confirmação da tela Abastecimentos, ligado ao registro do dia da área. Não passa mais por "Ajustar um dia" |
| Implementos | Opção "Implemento" (só se o tipo permite) abre o formulário da máquina; na área há o grupo "Implementos" ao lado de "Máquinas", com os usos e a nota de que o custo está em Máquinas |
| O que não muda | Servidor, banco, permissões, formulários de linha, estoque, medidor. "Mais detalhes" guarda o ajuste por tipo e por dia |

## 2. Migration `20261118100000_atividade_areas`

Já está no repositório (D-PROD-249, CONTRACT, SHA `098f0d06d45922886f64cb4e2f4bd00644dac26b833e8020feeed2632d31ec06`). O registro daquela decisão diz **`SCHEMA_APPLIED_PROD: NÃO`**. Esta entrega não cria migration e não aplica aquela. Sem ela no banco, começar a área e gravar o registro na área não funcionam em produção.

### O que depende da migration não aplicada

Começar a área e gravar registros na área (inclusive o abastecimento, que se liga ao registro do dia da área) dependem da `20261118100000_atividade_areas` em produção. Até ela ser aplicada, a tela abre, mas essas gravações não funcionam lá. Aplicar é decisão do proprietário, pelo runbook da D-PROD-249.

### Regras que o campo precisa saber

- Abastecimento na área exige um registro do dia na área: sem nenhum, a tela diz "registre antes uma máquina neste lugar".
- Implemento não tem custo próprio no servidor; o grupo mostra "N usos". O custo está em Máquinas.
- A opção de abastecimento só aparece com a permissão de novo abastecimento.

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

## 5. Verificação

| Comando | Resultado |
|---|---|
| `npm run verify:all` | todas as etapas passam, **exceto** `test:backend` e `test:smoke` (abaixo) |
| `npm run test:smoke` | 3.664 passam; 3 falham, todos em `lancamentoSuplementacaoDataFazenda.test.jsx` (LD-1, LD-2, LD-3). Falham igual sem estas mudanças: esperam a data do relógio da máquina em 13/11/2026 e o relógio daqui está em 12/11. Não são desta entrega |
| `npm run test:backend` | **não rodou**: não há PostgreSQL nesta máquina (sem `DATABASE_URL`, sem Docker). O servidor não foi alterado nesta entrega. Rodar na CI ou com `npm run db:up` |
| Testes novos | `tests/smoke/atividadeFluxoCampo.test.js` (4), `LL-ABAST-AREA-1` e `-2` (abastecimento pela área, permissão), implemento em `LA-RAIO-2` |

Palavras da confirmação: "Registro salvo. Foi anotado em Pasto 01, na atividade Adubação."
