# README — Ponto de Entrada para Agentes de IA

**Status:** Oficial — pre-flight obrigatório antes de qualquer implementação
**Versão:** 1.0.0
**Repositório:** MAKGESTAO

---

## Propósito

Este é o **primeiro documento** que qualquer agente de IA ou nova sessão deve ler
antes de tocar no código.

O projeto **não depende de memória de chat**. Toda estratégia, arquitetura, estado
e decisão vivem neste repositório.

---

## ESTADO ATUAL DO PROJETO

| Campo | Valor |
|---|---|
| **Programa ativo** | Independência da Base44 |
| **Fase atual** | Fase 0 — Pré-requisitos |
| **Próxima fase** | Fase 1 — Fundação do backend |
| **Branch de trabalho** | `saas-migration` |
| **Ponto de retorno** | tag `base44-freeze` |
| **Tenancy** | Cliente único (D-01) |
| **Molde arquitetural** | repositório PROJETOMG |
| **Roadmap** | `docs/engineering/ROADMAP-SAAS.md` |

### Inventário do legado

| Métrica | Valor |
|---|---|
| Entidades Base44 | 87 |
| Campos totais | 1.332 |
| Entidades com `empresa_id` | 68 |
| Páginas | 102 |
| Funções de backend | 11 |
| Chamadas ao SDK | 2.801 |
| Repositórios existentes | 2 |
| Linhas em `src/` | 116.217 |

---

## Checklist Pré-Implementação (obrigatório)

Antes de alterar **qualquer** arquivo, leia e verifique:

| # | Documento | Caminho |
|---|---|---|
| 0 | Este arquivo | `README_AI.md` |
| 1 | Constituição | `docs/constitution/00-CONSTITUICAO.md` |
| 2 | Do Not Do | `docs/constitution/07-DO-NOT-DO.md` |
| 3 | Regras de IA | `docs/constitution/08-REGRAS-DE-IA.md` |
| 4 | Estado atual | `docs/engineering/CURRENT-STATE.md` |
| 5 | Decisões | `docs/engineering/DECISIONS.md` |
| 6 | Roadmap | `docs/engineering/ROADMAP-SAAS.md` |
| 7 | Registro de gates | `docs/engineering/GATE-REGISTRY.md` |
| 8 | Comandos | `AGENTS.md` |

**Se algum documento estiver desatualizado em relação ao código, atualize-o antes
de prosseguir.**

---

## Durante a implementação — três perspectivas

Toda mudança deve ser analisada sob:

### 1. Tenancy
O dado é isolável por cliente? O índice suporta a consulta filtrada?
Existe caminho em que `cliente_id` pode ser omitido?

### 2. Arquitetura
Respeita o molde do PROJETOMG? Cria solução paralela a algo que já existe?
Componente está acessando dado diretamente?

### 3. Independência
Esta mudança aumenta ou diminui o acoplamento com a Base44?
**Nunca pode aumentar.**

---

## Trabalho baseado em evidência

O agente **deve**:

| # | Requisito |
|---|---|
| E1 | Citar caminho de arquivo ao afirmar fato sobre a arquitetura |
| E2 | Ler o arquivo real antes de editar — nunca assumir de memória |
| E3 | Rodar `npm run verify:all` após mudanças estruturais |
| E4 | Reportar falha de gate honestamente — nunca silenciar ou pular |
| E5 | Distinguir "existe no código" de "está planejado no roadmap" |

O agente **não deve**:

- Afirmar que gate passou sem ter rodado
- Inventar módulos, entidades ou funcionalidades que não existem
- Citar conclusão de relatório antigo sem reverificar no código atual

---

## Disciplina de escopo

| Tipo de missão | Comportamento |
|---|---|
| **Levantamento** | Somente leitura. Produz documento. Zero alteração de código |
| **Fundação** | Só `backend/`. Não tocar em `src/` |
| **Schema** | Só `backend/prisma/`. Um módulo por vez |
| **Shim** | Só `src/api/`. Não alterar componentes |
| **Migração de módulo** | Só o módulo declarado. Nunca dois ao mesmo tempo |

Quando a missão disser "não altere X", não altere X — **mesmo que encontre um bug**.
Registre o bug em `docs/engineering/DECISIONS.md` e siga.

---

## Certificação de fim de missão

Toda fase termina com relatório em `docs/FASE-N-RELATORIO.md` contendo:

1. Arquivos criados ou alterados
2. Resultado de `npm run verify:all` (colado, não resumido)
3. Divergências em relação ao molde do PROJETOMG, com justificativa
4. Pendências e riscos identificados
5. Decisões que precisam de aprovação humana
