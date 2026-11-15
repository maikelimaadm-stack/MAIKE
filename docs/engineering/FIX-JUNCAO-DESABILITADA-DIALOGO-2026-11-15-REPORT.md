# FIX-JUNCAO-DESABILITADA-DIALOGO — contrato de "Juntar Lotes" desabilitado depois da PR #291

**Data:** 2026-11-15
**Branch:** `claude/eager-fermi-am8vj1`
**Escopo:** só o teste `tests/smoke/detalhesLoteCutoverPendente.test.jsx`. Nenhum arquivo de `src/` muda.

## Sintoma

Na `main` (`8d4b36a`, merge da PR #291 `codex/botoes-manejo-modulos`), o arquivo falhava 4 de 23 casos.
Os quatro estão todos no describe "Juntar Lotes permanece visível quando indisponível": empresa sem ledger,
sem permissão, um único lote e categorias diferentes.

```
expected <div role="dialog" …> to be null
  ❯ tests/smoke/detalhesLoteCutoverPendente.test.jsx:153
      expect(screen.queryByRole("dialog")).toBe(null);
```

No commit `b650045` (merge da PR #289, anterior à #291), o mesmo arquivo passava 23/23.

## Causa

O diálogo aberto **não é** o formulário de junção. É a abertura em grade "Manejos e históricos"
(`LancLoteDialogo` em `src/components/mapa/AcoesDoLote.jsx`, classe `mk-ll-dlg`).

- **Antes da #291:** `AcoesDoLote` só usava o diálogo no celular (`max-width: 639px`). No jsdom o
  `matchMedia` não casa, então o teste via o layout de desktop. Nele os quadros ficavam à vista, sem
  diálogo, e `queryByRole("dialog")` dava `null`.
- **Commit `71dde7d` da #291** ("Unifica abertura em grade e amplia ícones e nomes em todas as telas"):
  o ramo de desktop saiu. Agora toda tela mostra o botão "Manejos e históricos", que abre a grade num
  diálogo. A mesma PR atualizou `tests/smoke/detalhesLoteQuadros.test.jsx` ("desktop: a mesma abertura em
  grade do celular"), portanto a mudança é **intencional**.
- O helper `acao()` do teste já clica em "Manejos e históricos" quando o botão existe. Quando o quadro de
  "Juntar Lotes" está desabilitado, o clique não age: `disabled` está no `<button>` e `escolher` só roda se
  `!disabled`. A grade fica aberta, e ela é o único `role="dialog"` na tela.

O comportamento do componente está certo. O contrato do commit `8253777` (botão visível, desabilitado, com
o motivo no `title`, sem formulário e sem escrita) continua valendo. O que ficou largo demais foi a asserção
"nenhum diálogo".

## Correção

Em `tests/smoke/detalhesLoteCutoverPendente.test.jsx`:

- **Casos desabilitados:** a asserção `queryByRole("dialog") === null` sai. Entram três asserções:
  - o único diálogo aberto é a grade, ou seja, `getAllByRole("dialog")` é igual a
    `[getByRole("dialog", { name: "Manejos e históricos" })]`;
  - não há diálogo com nome "Juntar Lotes";
  - o texto do formulário de junção ("Selecione o lote que receberá os animais (lote principal):") não está
    na tela.

  As asserções de `disabled`, `title`, ausência de `toast.error` e nenhuma escrita continuam como estavam.
- **Caso positivo** ("Juntar Lotes abre o diálogo de junção"): passa a afirmar que o diálogo
  `{ name: "Juntar Lotes" }` existe e que a grade fechou. Assim fica provado que a consulta negativa pelo
  nome não passa no vazio.
- O comentário do helper `acao()` deixa de dizer "no desktop os quadros já estão à vista".

Nenhum teste foi pulado ou afrouxado além do necessário.

## Prova

| Verificação | Resultado |
|---|---|
| `npx vitest run tests/smoke/detalhesLoteCutoverPendente.test.jsx` | **23/23** (antes: 19/23) |
| Mutação temporária em `AcoesDoLote.jsx` (o quadro desabilitado dispara a ação), com as asserções de `disabled`/`title` comentadas para chegar às novas | **4/4 casos falham**: o formulário de junção abre e o contrato pega |
| `npm run test:smoke` | **237 arquivos, 2.891 testes, todos verdes** |
| `npm run verify:all` | 38/39 etapas; `test:backend` fechado à parte (ver abaixo) |

### verify:all

Local: **38 das 39 etapas PASS**, incluindo todos os gates, `types`, `lint`, `test:smoke`, `build` e `build:admin`.
`test:backend` reprovou em 110 ms com `DATABASE_URL ausente`: o contêiner não tinha PostgreSQL. É ambiente, não teste.
Ele foi rodado à parte contra um PostgreSQL 16 efêmero local:

- Na primeira rodada só havia `DATABASE_URL` e `AUTH_SECRET` (descartável, o mesmo do job da CI). O resultado foi
  2.053 testes: 2.045 pass, **3 fail** e 5 todo. As 3 falhas são todas em `backend/tests/transporteNativo.test.mjs`
  ("P4B — CORS no app real") e exigem a origin `http://localhost:5173`. A CI define essa origin em
  `FRONTEND_ORIGINS`, no `env` do job (`.github/workflows/quality.yml`); a rodada local não a tinha definido.
- Com `FRONTEND_ORIGINS=http://localhost:5173`, o `transporteNativo.test.mjs` passa **20/20**.

Total do backend: **2.048 pass, 0 fail, 5 todo**. Nenhuma das falhas tem relação com esta mudança, que não toca
`backend/`.

## Fora do escopo

- Nenhuma mudança em `src/`, em `tests/smoke/setup.js` ou nos mocks.
- Não há decisão de produto, portanto nenhuma entrada nova em `DECISIONS.md`. A abertura em grade em todas
  as telas é da PR #291. A contagem de testes não muda.
