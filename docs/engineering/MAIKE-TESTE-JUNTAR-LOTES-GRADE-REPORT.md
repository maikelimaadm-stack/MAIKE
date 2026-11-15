# Teste "Juntar Lotes" com a grade de manejos (PR #291) — relatório

**Data:** 2026-11-15 · **Branch:** `claude/fix-juntar-lotes-teste` · **Sem decisão nova** (só teste)

## Problema

A PR #291 (`codex/botoes-manejo-modulos`) unificou a abertura dos manejos dos Detalhes do Lote: agora eles abrem numa
grade em diálogo ("Manejos e históricos") também no desktop. O smoke
`tests/smoke/detalhesLoteCutoverPendente.test.jsx` ("Juntar Lotes permanece visível quando indisponível", 4 casos)
esperava `queryByRole("dialog") === null` depois do clique no botão desabilitado. A grade aberta é um diálogo, então os 4
casos falhavam na `main` (`8d4b36a1`). No merge da #289 (`b650045d`), antes da #291, eles passavam.

## Correção

O que o teste protege não mudou: o clique em "Juntar Lotes" desabilitado não abre a junção nem grava nada. A asserção
passa a conferir isso diretamente:
- o único diálogo aberto é a grade "Manejos e históricos";
- o texto da junção ("Selecione o lote que receberá os animais…") não aparece.

As outras asserções seguem como estavam: botão desabilitado, motivo no `title`, nenhum `toast.error` e nenhuma escrita.
Nenhum código de produção mudou.

## Verificação

`npx vitest run tests/smoke/detalhesLoteCutoverPendente.test.jsx`: 23/23.
