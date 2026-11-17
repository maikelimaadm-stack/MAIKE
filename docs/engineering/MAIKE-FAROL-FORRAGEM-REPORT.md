# MAIKE-FAROL-FORRAGEM — Relatório

**Branch `claude/kind-knuth-tztu1v`** · Decisão: [D-PROD-221](./DECISIONS.md)

Terceiro passo do Manejo de Pastagens: depois do Cadastro de Culturas (D-PROD-215), da Área ligada à
Cultura (D-PROD-216) e da Medição de Forragem (D-PROD-219), o mapa mostra o farol de cada pasto.

## 1. Entrega

| Camada | O que entrou |
|---|---|
| Domínio | `src/domain/pastagem/farolForragem.js`: última medição por pasto (dia, depois hora do registro); cor pela situação; 15 dias de validade (`DIAS_VALIDADE_FORRAGEM`); no olho → tom mais claro (`clarear`) e 👁; régua sem situação e medição vencida → cinza; nunca medido → neutro; Infraestrutura/Reserva/APP → cor normal (`null`) |
| Mapa | modo de coloração **"Forragem"** em `MODOS_COLORACAO` (painel Visualização; preferência por usuário e permissão de colorir já existentes); `MapaGeral.jsx` carrega `medicoesForragem` só com o modo ligado, calcula os faróis uma vez (`useMemo`) e pinta em `getAreaColor`; o refresh do mapa recarrega as medições nesse modo |
| Legenda | `MapaLegenda.jsx` e a legenda do painel: Rapado, Descanso, Pronto, Passou do ponto, Sem medição recente (> 15 dias), Nunca medido e "👁 tom mais claro: avaliado no olho" |
| Detalhe do pasto | `PainelForragemArea.jsx`: chip do farol (cor + situação, "há N dias", "vencida") acima da última medição |
| Banco / API | nada (sem migration; lê a `MEDICAOFORRAGEM` da D-PROD-219) |

## 2. Validação local

| Etapa | Resultado |
|---|---|
| `tests/smoke/farolForragem.test.jsx` (novo) | 8/8: última medição, 15 × 16 dias, olho, sem situação, nunca medido, usos sem forragem, dia inválido, modo e legenda |
| Smoke do mapa (filtros/preferências/visualização/integrado/cache) e da medição | verdes (58 + 7) |
| `gate:types`, lint, gates de governança, imports, escopo, fechamento, segredos, tenancy | verdes |
| `npm run build` | ok |

## 3. Pendências e notas

- Estimativa pelos dias de descanso, lotação/dias de pastejo pela medição e produtividade por pasto ficam para as próximas missões.
