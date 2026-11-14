# MAIKE-PESO-PROJETADO — Relatório

**Branch `claude/kind-knuth-tztu1v`** · Decisão: [D-PROD-198](./DECISIONS.md) ·
Runbook: [`MAIKE-PESO-PROJETADO-RUNBOOK-RELEASE.md`](./MAIKE-PESO-PROJETADO-RUNBOOK-RELEASE.md)

## 1. Entrega

| Camada | O que entrou |
|---|---|
| Banco | `CADCATEGORIA.peso_objetivo_kg DECIMAL(10,2)` opcional; migration **EXPAND** `20261114400000_cadcategoria_peso_objetivo` |
| Release | manifesto pinado; preflight exige a coluna; runbook com caminhos A e B; testes do ferramental (B19a/b/k) |
| Backend | peso objetivo validado (> 0 e ≤ 3.000 kg, vírgula, 2 casas; 400 `peso_objetivo_invalido`); motor do peso projetado (`pesoProjetado.js`); `GET /rebanho/posicoes` com `projecao_peso` |
| Frontend | campo e coluna "Peso objetivo (kg)" (chave `_v3`); nos Detalhes do Lote (seção Pesagem): peso projetado, @, GMD do mês, base, objetivo, quando atinge, pesado × previsto, próximos fins de mês; card com o peso projetado |
| Docs | D-PROD-198, este relatório, runbook, `CURRENT-STATE` |

## 2. Como a conta funciona

- **Projetado hoje** = valor da base + soma do GMD de cada dia depois da base. O GMD de cada dia é o do mês daquele dia na curva da categoria do lote.
- **Base** = o último peso gravado do lote: entrada, pesagem (inclusive a estimada) ou abertura.
- **Base derivada:** o lote que veio de uma transferência, mudança de categoria ou junção tem gravada a média do peso **registrado** das origens. A conta troca esse valor pelo peso **projetado** das origens no dia do evento. Exemplo: 400 kg em 01/03 no pasto a 0,5 kg/dia, mudança para confinamento em 31/03 (1,5 kg/dia). A base passa a ser 415 kg, e em 30/05 o projetado é 505 kg, não 490.
- **Objetivo:** vem da categoria. O sistema mostra quanto falta e a data prevista para atingir; "ATINGIDO" quando já passou; "SEM PREVISÃO" quando a curva não chega lá em 3 anos.
- **Pesado × previsto:** a última pesagem dividida pelo projetado logo antes dela (ex.: "98,5% abaixo").
- **@:** peso vivo ÷ 30.

## 3. Validação local

| Comando | Resultado |
|---|---|
| `node --test backend/tests/pesoProjetado.test.mjs` (motor puro: meses, bissexto, objetivo, pasto → confinamento, pesado × previsto, sem curva, origem desconhecida) | 6/6 |
| `node --test backend/tests/pesoProjetadoApi.test.mjs` (API da categoria e lista de posições com o relógio de teste) | 2/2 |
| `npx vitest run tests/smoke/pesoProjetadoMapa.test.js` (catálogo do mapa) | 3/3 |
| ferramental de migration (`scripts/tests/deploy`) | 154/154 |
| `verify:all` e revisão | ver §4 |

## 4. Verificação completa e revisão

_(preenchido ao fim da missão.)_
