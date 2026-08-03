# 08 — Regras para Agentes de IA

**Status:** Oficial · Complementa a constituição.

Agentes de IA estão sujeitos à mesma constituição que desenvolvedores humanos,
com as restrições adicionais abaixo.

---

## 1. Ordem de leitura obrigatória

1. `README_AI.md`
2. `docs/constitution/00-CONSTITUICAO.md`
3. `docs/constitution/07-DO-NOT-DO.md`
4. Este arquivo
5. `docs/engineering/CURRENT-STATE.md`
6. `docs/engineering/DECISIONS.md`
7. `docs/engineering/ROADMAP.md`
8. `config/mapa-manejo-scope.json`
9. `AGENTS.md`

**Histórico de chat de sessões anteriores não é autoritativo.** Se contradiz o
repositório, o repositório vence.

## 2. Antes de editar

| # | Regra |
|---|---|
| A1 | Ler o arquivo real. Nunca editar a partir de memória ou suposição |
| A2 | Ler como o PROJETOMG resolveu antes de propor solução |
| A3 | Confirmar que a missão autoriza tocar naquele arquivo |
| A4 | Se o arquivo estiver fora do escopo da fase, não tocar |

## 3. Ao afirmar

| # | Regra |
|---|---|
| A5 | Fato sobre o código exige caminho de arquivo |
| A6 | "Gate passou" exige a saída do comando colada |
| A7 | Distinguir "existe no código" de "está no roadmap" |
| A8 | Não inventar entidade, módulo ou funcionalidade |
| A9 | Falha de gate é reportada, nunca silenciada |

## 4. Parada obrigatória

O agente **para e pede confirmação humana** quando:

- A missão tem etapas marcadas ETAPA A / ETAPA B
- Encontrou ambiguidade que muda o desenho do schema
- Um gate falha e a correção exigiria mudar a regra
- A solução exigiria divergir do molde do PROJETOMG
- O escopo da missão precisaria crescer para terminar

**Parar e perguntar é comportamento correto, não falha.**

## 5. Fim de missão

Toda missão termina com relatório em `docs/engineering/`. Sem relatório, a missão não terminou.

## 6. Proibições específicas de agente

| # | NÃO faça |
|---|---|
| A10 | Emendar a constituição |
| A11 | Atualizar o baseline do gate de Base44 para cima |
| A12 | Marcar item do roadmap como concluído sem gate passando |
| A13 | Alterar o desenho de um schema em `base44/` (excluir fora do escopo é permitido por D-PROD-02) |
| A14 | Fazer commit direto na `main` |
| A15 | Continuar após falha de gate sem reportar |
