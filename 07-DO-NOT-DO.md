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
| D7 | Adicionar nova chamada ao SDK da Base44 | Usar o shim em `src/api/makClient.js` |
| D8 | Aumentar o baseline do gate de Base44 | Baseline só desce |
| D9 | Remover `@base44/sdk` antes da Fase 6 | Migrar módulo a módulo primeiro |

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
| D16 | Misturar duas fases no mesmo PR | Uma fase, um PR |
| D17 | Migrar dois módulos ao mesmo tempo | Um módulo por vez |
| D18 | Afirmar que gate passou sem rodar | Colar a saída do comando |
| D19 | Corrigir bug fora do escopo da missão | Registrar em `DECISIONS.md` e seguir |
| D20 | Trabalhar na branch `main` | `saas-migration` |
