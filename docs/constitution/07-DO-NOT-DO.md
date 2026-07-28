# 07 — Lista do Que Não Fazer

**Status:** Oficial · Explícita e vinculante.
Violação exige **rollback**, não flexibilização da regra.

---

## 1. Tenancy

| # | NÃO faça | Faça em vez disso |
|---|---|---|
| D1 | Criar model sem `cliente_id` | Todo model tem `cliente_id`, sem exceção |
| D2 | Criar `@unique` isolado em chave de negócio | `@@unique([cliente_id, ...])` |
| D3 | Criar `@@index` sem `cliente_id` como primeira coluna | Índice composto começando por `cliente_id` |
| D4 | Ler `cliente_id` de parâmetro de request | Ler do contexto de autenticação |
| D5 | Adiar tenancy "porque é um cliente só" | Implementar desde o primeiro model |

## 2. Base44

| # | NÃO faça | Faça em vez disso |
|---|---|---|
| D6 | Editar arquivos em `base44/` | Somente leitura. É a especificação de origem |
| D7 | Adicionar nova chamada ao SDK da Base44 | Nenhuma referência nova; ver D-PROD-04 |
| D8 | Aumentar o baseline do gate de Base44 | Baseline só desce |
| D9 | Remover `@base44/sdk` antes de P7 | Migrar capacidade a capacidade primeiro |

## 3. Arquitetura

| # | NÃO faça | Faça em vez disso |
|---|---|---|
| D10 | Componente React chamando dado direto | Passar por `src/apis/<modulo>/` |
| D11 | Colocar regra de negócio em componente | Service no backend |
| D12 | Repository com lógica de UI | Repository = adaptador de dados |
| D13 | Criar padrão novo quando o PROJETOMG já tem um | Copiar o molde |
| D14 | Criar solução paralela a algo existente | Estender o existente |
| D15 | Scaffold manual de módulo | Seguir a estrutura padrão de `backend/src/modules/` |

## 4. Processo

| # | NÃO faça | Faça em vez disso |
|---|---|---|
| D16 | Misturar duas missões no mesmo PR | Uma missão, um PR |
| D17 | Migrar dois módulos ao mesmo tempo | Um módulo por vez |
| D18 | Afirmar que gate passou sem rodar | Colar a saída do comando |
| D19 | Corrigir bug fora do escopo da missão | Registrar em `docs/engineering/DECISIONS.md` e seguir |
| D20 | Trabalhar na branch `main` | Branch própria por missão |

## 5. Escopo do produto

| # | NÃO faça | Faça em vez disso |
|---|---|---|
| D21 | Reintroduzir módulo fora de Mapa Geral + Manejo | Ver `config/mapa-manejo-scope.json` |
| D22 | Registrar página que não está em `allowedPages` | Atualizar o manifesto com justificativa primeiro |
| D23 | Criar schema ou function Base44 nova | Nenhuma. A Base44 só sai, nunca entra |
| D24 | Copiar Studio, MDP/MMM, marketplace ou low-code do PROJETOMG | Copiar só a disciplina (D-PROD-03) |
| D25 | Hardcodar chave ou segredo em `src/` | Variável de ambiente + `.env.example` |
| D26 | Criar segunda fonte de menu ou de rota | SSOT em `src/lib/menuConfig.js` e `src/pages.config.js` |
