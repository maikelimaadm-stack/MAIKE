# Relatório — Limpeza de escopo: remoção de Layout* e campos personalizados

**Data:** 2026-10-23  
**Decisão:** D-PROD-30  
**Branch:** `cursor/mapa-manejo-scope-cleanup-516d`

## Objetivo

Manter o MAIKE restrito às 16 páginas Mapa + Manejo e retirar o subsistema de
layout configurável (`Layout*`) e campos personalizados do cadastro de lotes.

## Alterações

| Área | Ação |
|------|------|
| `config/mapa-manejo-scope.json` | `Layout*` removidas de `allowedBase44Entities`; incluídas em `forbiddenBase44Entities` |
| `base44/entities/Layout*.jsonc` | Excluídos (fora do escopo) |
| Provider / API / service de lotes | Removidos endpoints e funções de layout |
| UI (`CadastroLotes`, formulário, tabela, filtros) | Sem tela de configuração de campos; colunas e formulário fixos |
| Componentes órfãos | Removidos diálogo e helpers de campos personalizados |

## Verificação

```bash
npm run verify:all
```

## Fora de escopo desta missão

- UX estilo Frota (referência CONTROLE-DE-ESTOQUE) — missão separada.
- Remoção total da Base44 (P7).
- Podar entidades Base44 além de `Layout*` — somente o fechamento do motor de
  campos personalizados.
