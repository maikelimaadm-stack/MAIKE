# README — Ponto de Entrada para Agentes de IA

**Status:** Oficial — pre-flight obrigatório antes de qualquer implementação
**Versão:** 2.0.0
**Repositório:** MAIKE

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
| **Produto** | Pecuária — **Mapa Geral + Manejo** (D-PROD-01) |
| **Superfície primária** | `MapaGeral` — a raiz `/` redireciona para lá (D-PROD-05) |
| **Missão atual** | **P0.1 — Product Scope Reset** (entregue) |
| **Próxima missão** | **P1 — Native Foundation Bootstrap** |
| **Branch de trabalho** | `claude/maike-scope-reset-ona5vs` |
| **Escopo executável** | `config/mapa-manejo-scope.json` |
| **Molde arquitetural** | PROJETOMG — **parcial** (D-PROD-03) |
| **Roadmap** | `docs/engineering/ROADMAP.md` |

O MAIKE **não é mais um ERP amplo**. Financeiro, fiscal, folha, máquinas,
combustível, agrícola, safra, comercial, cotação, pesagens individuais,
relatórios genéricos, dashboards paralelos, fichas personalizadas e editor visual
**saíram do produto** e foram fisicamente excluídos (D-PROD-02).

### Inventário atual

| Métrica | Valor |
|---|---|
| Páginas | 16 |
| Arquivos em `src/` | 231 |
| Schemas Base44 | 38 |
| Functions Base44 | 1 (`syncEntityReferences`) |
| Arquivos em `src/` com SDK | 71 |

Antes/depois completo: `docs/engineering/CURRENT-STATE.md`.

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
| 6 | Roadmap | `docs/engineering/ROADMAP.md` |
| 7 | Registro de gates | `docs/engineering/GATE-REGISTRY.md` |
| 8 | Escopo do produto | `config/mapa-manejo-scope.json` |
| 9 | Comandos | `AGENTS.md` |

**Se algum documento estiver desatualizado em relação ao código, atualize-o antes
de prosseguir.**

---

## Durante a implementação — três perspectivas

### 1. Escopo do produto
A mudança serve ao Mapa Geral, ao manejo iniciado pelo Mapa Geral ou à
configuração indispensável dessas capacidades? Se não, ela não entra
(D-PROD-06). Em conflito entre preservar código antigo e cumprir o escopo,
**o escopo do produto vence**.

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
- Ampliar `config/mapa-manejo-scope.json` sem aprovação humana

---

## Disciplina de escopo

| Tipo de missão | Comportamento |
|---|---|
| **Levantamento** | Somente leitura. Produz documento. Zero alteração de código |
| **Fundação** | Só a camada declarada na missão |
| **Schema** | Só `backend/prisma/`. Um módulo por vez |
| **Migração de capacidade** | Só a capacidade declarada. Nunca duas ao mesmo tempo |

Quando a missão disser "não altere X", não altere X — **mesmo que encontre um bug**.
Registre o bug em `docs/engineering/DECISIONS.md` e siga.

---

## Etapa vermelha conhecida

`npm run typecheck` **falha desde antes desta missão** e continua falhando. É
`tsc -p ./jsconfig.json` com `checkJs: true` sobre código JavaScript sem tipos.
Erros: 10.935 na `main`, 2.788 depois do P0.1 — a queda vem da exclusão de
escopo, nenhum erro novo foi introduzido. Tratamento em P1 (DBT-03).
**Não desabilite o gate nem edite `jsconfig.json` para esconder isso.**

---

## Certificação de fim de missão

Toda missão termina com relatório em `docs/engineering/` contendo:

1. Arquivos criados ou alterados
2. Resultado de `npm run verify:all` (colado, não resumido)
3. Divergências em relação ao molde do PROJETOMG, com justificativa
4. Pendências e riscos identificados
5. Decisões que precisam de aprovação humana

Último relatório: `docs/engineering/P0.1-MAPA-MANEJO-SCOPE-RESET-REPORT.md`.
