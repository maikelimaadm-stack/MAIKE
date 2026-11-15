# MAIKE-FECHAMENTO-CONSUMO — Relatório

**Branch `claude/kind-knuth-tztu1v`** · Decisão: [D-PROD-206](./DECISIONS.md) ·
Runbook: [`MAIKE-FECHAMENTO-CONSUMO-RUNBOOK-RELEASE.md`](./MAIKE-FECHAMENTO-CONSUMO-RUNBOOK-RELEASE.md)

Etapa 4 de 4 da suplementação: quando um abastecimento novo (ou a saída do gado) fecha
o período anterior do cocho, o consumo real é comparado com o esperado da formulação,
com farol pela faixa de tolerância da formulação, consumo em g/cab/dia e %PV, e custo
por cabeça/dia pelo custo real do estoque.

## 1. Entrega

| Camada | O que entrou |
|---|---|
| Banco | `CADFORMULACAO.faixa_tolerancia_percentual DECIMAL(5,2)` anulável (vazia = 15%), pela migration **EXPAND** `20261115200000_formulacao_faixa_tolerancia` (SHA-256 `bb8be379…`). Sem CHECK: a allowlist EXPAND recusa CHECK em tabela antiga (teste B25b); a faixa é conferida no serviço |
| Release | manifesto pinado; preflight de schema exige a coluna; runbook com caminhos A e B, ensaiado em banco local (SQL pronto fora do repositório); testes do ferramental B25a/b/k (B24k passa a representar o dia da Leitura de cocho, sem a pasta nova) e contagem 56 → 57 migrations (tabelas continuam 91); os ensaios das migrations anteriores deixam a nova fora da partida e a aplicam por último (ela depende da CADFORMULACAO) |
| Backend | `/formulacoes` aceita e devolve `faixa_tolerancia_percentual` (0 < x ≤ 100, até 2 casas, vírgula pt-BR; `null`/vazio = padrão), também nas opções do lançamento |
| Domínio | `src/domain/suplementacao/fechamentoConsumo.js` (puro): `calcularFechamentoConsumo`, `resumoDoFechamento`, `farolPelaRelacao`, `faixaDeTolerancia`, `PATCH_REABERTURA_CONSUMO` |
| Fechamento | `calcularFechamentoDePeriodo` grava os campos do fechamento do consumo no patch do evento; `prepararFechamentoPeriodo` acha a faixa, o custo e o compartilhamento (com reserva para evento antigo) — vale para o abastecimento e para a saída do gado; a reabertura limpa os campos |
| Lançamento | grava `custo_unitario_kg` (saída FIFO), `faixa_tolerancia_percentual` e `peso_vivo_consumo_kg`; o campo Sobra vem vazio ("Não medida"); prévia do farol do período que vai fechar |
| Tela | "Fechamento do consumo" no cartão do lançamento (Último Registro e Histórico), cartão "Último período fechado" no detalhe do cocho, campo "Faixa de tolerância (%)" e coluna opcional "Faixa (%)" em Formulações |
| Docs | D-PROD-206, este relatório, runbook, `CURRENT-STATE` |

## 2. Como funciona a conta

Exemplo combinado com o proprietário: 300 kg fornecidos, 20 kg de sobra anterior e 40 kg
de sobra final, 100 cabeças de 400 kg em 7 dias, formulação de 0,1% PV, R$ 3,50/kg:

| Passo | Conta | Resultado |
|---|---|---|
| Consumo real | 300 + 20 − 40 | 280 kg |
| kg/dia do grupo | 280 ÷ 7 | 40 kg/dia |
| g/cab/dia | 40 ÷ 100 × 1000 | 400 g |
| %PV real | 40 ÷ (100 × 400) × 100 | 0,100% |
| %PV esperado | 40 kg/dia esperados ÷ 40.000 kg × 100 | 0,100% |
| Relação | 40 ÷ 40 | 100% → 🟢 Dentro |
| Custo do período | 280 × R$ 3,50 | R$ 980,00 |
| R$/cab/dia | 980 ÷ (100 × 7) | R$ 1,40 |

- **Farol** (faixa padrão 15%): abaixo de 85% do esperado → 🔴 Abaixo; acima de 115% → 🔵 Acima; de 85% a 115%, **inclusive**, → 🟢 Dentro. Com outra faixa na formulação (ex.: 20%), os limites passam a 80% e 120%.
- **Sem referência** (⚪), com o motivo escrito: sem consumo esperado (formulação sem %PV ou rebanho sem peso), ou **cocho compartilhado** (os mesmos animais com o mesmo produto em outro cocho — a mesma regra do nível do cocho, D-PROD-178). O consumo real e o custo continuam aparecendo.
- Cabeças de categoria que **não consome** a formulação (D-PROD-203) ficam fora do g/cab/dia, do peso vivo e do custo por cabeça.
- **Sobra não medida:** o campo Sobra vazio conta 0 e o resultado aparece como "Aproximado — sobra não informada". Com valor digitado (inclusive 0), é medido. Na saída do gado, o campo é obrigatório e começa em 0.
- **Custo:** o R$/kg é o da saída de estoque (FIFO) do abastecimento que abriu o período; sem depósito vinculado não há saída e o cartão diz "Sem custo".
- **Eventos antigos:** período aberto antes desta decisão busca a faixa na formulação (pelo `formulacao_id`) e o custo no movimento de estoque do cache do mapa; período fechado antes desta decisão é calculado na tela com o que há (sem saber se a sobra foi medida).

## 3. Validação local

| Comando | Resultado |
|---|---|
| `node --test backend/tests/formulacaoNativo.test.mjs` (campo novo: chaves públicas, `null` padrão, validação, round-trip com vírgula, PATCH troca/limpa, opções do lançamento) | 19/19 |
| ensaios das migrations anteriores com a nova fora da partida e aplicada por último: `atividadeLinhasMigration` 11, `atividadeCabecalhoMigration` 28, `cadCategoriaCurvaGanhoMigration` 10, `cadCurvaGanhoMensalMigration` 10, `categoriaManejoCadcategoriaMigration` 20, `patrimonioSimplificaMigration` 14, `tipoAtividadeDefaultsMigration` 25; `sqlEditorBootstrap` 13 | todos verdes |
| `node --test scripts/tests/deploy/premerge-migrate.test.mjs` (B25a/b/k e contagens) | 117/117 |
| `npx vitest run tests/smoke/fechamentoConsumo.test.jsx` (domínio: cores, limites 85/115 e 80/120, sem esperado, sem peso, sem custo, sobra não medida, compartilhado, quem não consome; patch e reabertura; resumo de evento antigo; serviço: faixa e custo de evento antigo, compartilhamento pelo cache; tela) | 11/11 |
| `suplementacaoLancamentoBase` (SF-5 sobra vazia × 0 digitado; SF-6 custo, faixa e peso vivo no evento; SF-7 reservas e a prop do compartilhamento), `suplementacaoServices` (SP2/SP3 com os campos novos), `formulacoes` (validação e campo da faixa), `detalhesCochoNiveis` (cartão "Último período fechado") | 13/13, verdes, 31/31, 10/10 |
| Ensaio do caminho B (banco à parte com as 56 da `main`) | alvo divergente recusado; aplicou 56 → 57, coluna `numeric(5,2)` anulável sem DEFAULT, 91 tabelas; `migrate status` em dia; `migrate diff` vazio; reexecução recusada |
| verify:all por etapas | ver §5 |

## 4. Limites conhecidos

- Cocho compartilhado não tem farol: o consumo do grupo não é rateado entre os cochos (registrado na D-PROD-206; mesma regra do nível, D-PROD-178).
- O custo é o R$/kg do abastecimento que abriu o período; a sobra herdada de outro ciclo entra pelo mesmo valor.
- Evento antigo com a formulação inativada: as opções do lançamento só trazem as ativas, e a faixa cai no padrão de 15%.
- O custo de evento antigo vem do cache do mapa (`movimentacaoEstoque`); sem o movimento no cache, "Sem custo".
- O peso vivo é o do lançamento (peso projetado de hoje ou o último peso, D-PROD-201), não o do fim do período.

## 5. verify:all

Local, PostgreSQL 16, com `DATABASE_URL` e `AUTH_SECRET` exportados. Como na D-PROD-205, as etapas rodaram separadas (o `verify:all` inteiro passa de 30 min com o backend num processo só; o CI o divide em 4 shards).

| Etapa | Resultado |
|---|---|
| todos os gates `gate:*` | PASSOU |
| `gate:types` | PASSOU (546 ≤ teto 625) |
| `typecheck:backend` | PASSOU |
| `lint` | 0 erros (2 avisos antigos, fora desta missão) |
| `test:backend` | ver abaixo |
| `test:smoke` | ver abaixo |
| `build`, `build:admin` | ver abaixo |
