# MAIKE-SUPLEMENTACAO-BASE — relatório (D-PROD-201)

**Data:** 2026-11-14 · **Decisão:** [D-PROD-201](./DECISIONS.md) · **Branch:** `claude/kind-knuth-tztu1v`

## 1. Entrega

Etapa 1 de 4 da suplementação de cocho: corrigir a base do lançamento.

- **Rebanho.** O formulário usa o mesmo rebanho do mapa: posições do ledger, ou Lotes no legado (`listarRebanhoParaSuplementacao`).
- **Peso.** Vale o peso projetado de hoje; sem projeção, o último peso. O lote sem peso fica fora da média, com aviso na tela, e o evento grava `cabecas_sem_peso`.
- **Salvar de novo.** Há um `operation_id` por lançamento. Salvar de novo depois de uma falha reaproveita a baixa já feita, e mudar os valores da baixa é recusado.
- **Avisos.** `toast.warning` no lugar de `toast.warn`: a falha no fechamento do período anterior não vira mais "Não foi possível registrar".
- **Datas.** Recusa a data anterior ao último abastecimento e o "fim do consumo anterior" fora da janela. Não salva enquanto o último lançamento carrega.
- **Mapa.** O motivo "os lotes do pasto não tinham peso no lançamento" substitui "o produto não tinha %PV" quando o que falta é o peso.

## 2. Arquivos

- `src/services/suplementacaoService.js`: `listarRebanhoParaSuplementacao`.
- `src/components/suplementacao/consumoPVUtils.jsx`: `pesoDeConsumoDoLote` e `resumoPesoDosLotes`. `pesoMedioPonderadoLotes` passa a ignorar os lotes sem peso.
- `src/components/suplementacao/FormularioLancamentoSuplementacao.jsx`:
  - rebanho, peso e aviso (`AvisoPesoDoRebanho`);
  - `operacaoRef`, `chaveDaSaida` e `erroDeDataDoLancamento`;
  - `toast.warning`.
- `src/domain/suplementacao/nivelSuplementacao.js`: `motivoSemPeso` e `orientacaoSemPeso`.
- `src/components/mapa/DetalhesPontoSuplementacao.jsx`: mostra a orientação de "sem peso".
- `tests/smoke/suplementacaoLancamentoBase.test.jsx`: SB-1 a SB-6, 6 testes. Os 6 falham com o formulário antigo (conferido).

## 3. Verificação

- **Testes de suplementação que já existiam:** 15 arquivos e 199 testes, todos verdes.
- **Testes novos:** 6 de 6.
- **`gate:types`:** passou, sem regressão.

## 4. Verificação completa

**GitHub Actions** (perfil `full`, head `cdfba0ad`): os 10 jobs passaram, com conclusão `success`.
- `classify`;
- `verify:full`: estático, backend 1 a 4 (PostgreSQL efêmero) e smoke 1 e 2;
- o agregador `verify:all`.

Não houve falha, nem do DC-1 do cocho, já corrigido na `main`.
