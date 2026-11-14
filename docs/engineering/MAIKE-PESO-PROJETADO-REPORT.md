# MAIKE-PESO-PROJETADO — Relatório

**Branch `claude/kind-knuth-tztu1v`** · Decisão: [D-PROD-198](./DECISIONS.md) ·
Runbook: [`MAIKE-PESO-PROJETADO-RUNBOOK-RELEASE.md`](./MAIKE-PESO-PROJETADO-RUNBOOK-RELEASE.md)

## 1. Entrega

| Camada | O que entrou |
|---|---|
| Banco | `CADCATEGORIA.peso_objetivo_kg DECIMAL(10,2)` opcional; migration **EXPAND** `20261114400000_cadcategoria_peso_objetivo` |
| Release | manifesto pinado; preflight exige a coluna; runbook com caminhos A e B; testes do ferramental (B20a/b/k) |
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
| ferramental de migration (`scripts/tests/deploy`), depois do merge da `main` `1dd44f0c` (PR #276) | 171/171 |
| `verify:all` e revisão | ver §4 |

## 4. Verificação completa e revisão

**`npm run verify:all`** (local, Postgres 16, `maike_verify`; GitHub Actions pausadas): 40 etapas, 38 PASS na primeira rodada.
- `test:backend` passou: 899 + 1.978 testes, 0 falhas.
- Duas etapas falharam e foram corrigidas:
  - `typecheck:backend`: TS2339, porque o item do projetor ganhava `chave` depois de criado. Agora `chave` nasce no literal.
  - `test:smoke`: o CM3 de `manejoServices` não esperava `peso_objetivo_kg: null` no corpo enxuto.
- Depois da correção, as duas etapas rodaram de novo e passaram, junto com `gate:types` e o lint dos arquivos tocados. `test:smoke` fechou com 232 arquivos e 2.860 testes.

**Revisão independente:** nove achados, todos corrigidos e cobertos por teste.
1. Empresa sem fuso não quebra mais a lista de posições (antes, 409). O fuso é lido sem trava e a resposta traz `motivo: 'sem_fuso'`.
2. Um nascimento ou entrada medida soma o saldo projetado que já estava no destino.
3. Os eventos são lidos pelo filtro `cliente_id`/`empresa_id`, sem lista de ids, e só `pesos_derivados` do JSON.
4. Rodízio longo não trunca mais: o cálculo virou programação dinâmica em ordem cronológica e saiu o limite de profundidade 60.
5. "Atinge" tem tolerância de ponto flutuante.
6. O desempate dentro do mesmo fato é por `createdAt` e `id`.
7. "Atinge" ordena por chave numérica.
8. O texto ficou "X% do previsto".
9. "1.200" é lido como milhar no servidor e na tela, e a coluna ordena pelo número.

**Limites registrados na D-PROD-198:**
- "pesado × previsto" só olha pesagens da própria posição;
- o custo cresce com o histórico de pesos da fazenda;
- a troca BOI PASTO → BOI CONFINAMENTO fica para a próxima missão.
