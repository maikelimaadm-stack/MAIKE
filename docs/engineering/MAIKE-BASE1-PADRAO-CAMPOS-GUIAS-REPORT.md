# Relatório — Padrão Base1: campos preenchidos, guias laterais e grade de 4 colunas (D-PROD-260)

**Fatia:** padrão visual Base1 · **Branch:** `feat/base1-campos-underline-busca` · **PR:** #339

## O que mudou

Visual único dos formulários do motor Base1: campos preenchidos com pesquisa dentro do campo, guias laterais com "Buscar guia" e recolher, grade de 4 campos por linha. Onze formulários convertidos para guias (lista na D-PROD-260).

## Como a PR foi fechada

A PR foi feita em outra ferramenta e parou com conflito com a PR #338 (D-PROD-258) e 64 testes de fumaça vermelhos em 12 arquivos.

- **Conflito:** atividade no layout em guias sem Grupo e sem "este tipo permite registrar"; operação com os 3 campos da D-PROD-258.
- **Correções de tela:** teclado nas guias verticais; guia com erro abre ao salvar; Lote (ícone da categoria, aviso e motivo da correção de entrada, sem motivo automático); Bens (aviso "Escolha o tipo de bem"); Serviços ("Ativo" só em registro gravado); foco da pesquisa do `B1Select`.
- **Testes atualizados** (sem afrouxar corpo de requisição nem regra): abrem a guia certa antes de usar o campo; orientação vertical das guias; nova pesquisa dentro do campo.
- **Testes novos:** ↓/↑ nas guias, filtro "Buscar guia", recolher/expandir.

## Validação local

- Fumaça: 300 arquivos, 3735 testes, 0 falhas.
- `node scripts/gates/verify-all.mjs --pular=test:backend`: todas as etapas PASS.
- Sem mudança de backend nem migration.

## Pendências para o proprietário

- "Código" do lote escondido durante a edição e "Nº patrimonial" do bem só em leitura.
- Com as guias recolhidas, trocar de guia exige expandir.
