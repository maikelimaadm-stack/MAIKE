# MAIKE — R1: correção atômica da ENTRADA ORIGINAL (Cadastro de Lotes)

- **Base:** `main` @ `a080c815`.
- **Branch:** `claude/r1-correcao-entrada-lote`.
- **Migration:** nenhuma.
- **Decisão proposta:** registrar em `DECISIONS.md` **depois** da conciliação das PRs #193/#194 (as duas editam o arquivo; numeração a confirmar, provavelmente D-PROD-127). O texto proposto está na seção [Decisão proposta](#decisão-proposta).

## Problema (antes)

- **Formulário:** `FormularioLote.jsx` deixava quantidade, peso, categoria, sexo, setor e área de entrada só leitura na edição e os retirava do PATCH.
- **Rota:** `loteRoutes.js` não aceitava `area_entrada_id` no PATCH.
- **Serviço:** no ledger, `loteService.js` recusa a simples **presença** de campo operacional, incluindo `data_entrada` e `status`.
- **Ledger:** `registrarEntradaSeAtivo` grava ENTRADA, partida, peso e posição juntos, mas não existia comando para corrigir esse fato. Corrigir um erro de digitação da entrada era impossível.

## Contrato entregue

### Rotas novas

- `GET /lotes/:id/elegibilidade-correcao-entrada` — só leitura. Devolve `{elegivel, motivo, detalhes, campos, updated_date}`.
- `POST /lotes/:id/correcao-entrada` — corpo fechado:
  - `operation_id`;
  - `motivo` (obrigatório);
  - `estado_esperado.updated_date` (compare-and-swap);
  - `campos` ⊂ {quantidade, peso_entrada_kg, data_entrada, categoria, categoria_manejo_id, sexo, setor_id, area_entrada_id}.

O corpo não aceita `cliente_id`, usuário, saldo calculado nem nenhum campo fora da lista. O nome da categoria de manejo vem do banco.

### Elegibilidade

Decidida no banco, com o lote travado, numa só transação.

| Verificação | Motivo de bloqueio |
|---|---|
| Lote excluído | `lote_excluido` |
| Gerado por manejo | `lote_gerado_por_manejo` |
| Outro módulo cita o lote (suplementação, sanidade, medicamento, manejo técnico, mov. pecuária, tarefa) | o nome da fonte |
| Legado vinculado pelo nome | `vinculo_legado_por_nome` |
| Movimentação do mapa que cite o lote, **inclusive cancelada** (a cancelada carrega referência e histórico) | `movimentacao_ativa` / `movimentacao_cancelada` |
| Lote fora do retrato da entrada | `estado_divergente_da_entrada` |
| Auditoria sem explicação (ida e volta de saldo não passa) | `alteracao_sem_comprovacao` |
| **Ledger:** mais de uma posição da linhagem | `posicoes_derivadas` |
| **Ledger:** partida ou peso, ativo **ou inativo**, de outro evento | `evento_posterior` |
| **Ledger:** entrada vinda da ativação (evento agregado do modo `entradas` ou `SALDO_ABERTURA`) | `entrada_por_ativacao_agregada` (fail-closed) |
| **Ledger:** entrada cancelada, ambígua ou sem posição | `entrada_cancelada` / `entrada_ambigua_no_ledger` / `entrada_sem_posicao_no_ledger` |
| **Ledger:** tarefa ou movimentação que cite a posição | `lancamentos_tarefa` / `movimentacao_da_posicao` |

### Transação e SSOT

1. **Travas:** área (antiga, nova e da posição) → `Lote FOR NO KEY UPDATE` → posição (`FOR UPDATE`). É a mesma ordem da transferência e da exclusão.
2. **Releitura e validações:**
   - relê o lote e exige o mesmo `updated_date` (senão `LOTE_ESTADO_CONFLITO`);
   - reavalia a elegibilidade (senão `LOTE_CORRECAO_ENTRADA_BLOQUEADA`, 409);
   - H1: `exigirDiaNoLedger` aplica o "hoje" no fuso IANA da fazenda e o corte do `saldo_abertura`.
3. **Mesmo fato, mesmos ids:**
   - `PosicaoRebanho`: área, categoria, sexo, categoria de manejo e `chave_identidade` recalculada. Se a identidade colidir com outra posição, recusa.
   - `PartidaRebanho`: `delta` e data.
   - `PesoRebanho`: o mesmo registro é atualizado ou desativado (com `null`). Só é criado se a entrada não tinha peso.
   - `EventoRebanho` ENTRADA: data, `dados.quantidade`, `dados.area_id` e `dados.correcoes[]`.
   - Reprojeção canônica com `validarEReprojetar`.
   - `Lote`: entrada e "atual" iguais, com nomes de setor e área do banco.
4. **Auditoria:** `AuditLog` `correcao_entrada` para o Lote e para o EventoRebanho, com antes/depois, motivo, `operation_id` e usuário da sessão.
5. **Idempotência:** `executarComIdempotencia` (`correcao_entrada_lote`). Replay devolve a resposta guardada; o mesmo id com corpo diferente dá `IDEMPOTENCY_CONFLICT`.
6. **Sem efeitos indiretos:** nenhuma transferência e nenhuma segunda ENTRADA. Outro lote nunca é tocado.
7. **Modelo legado** (empresa sem ledger): corrige só o cadastro.

### Frontend (Cadastro de Lotes)

- **Elegibilidade:** consultada no servidor por lote (`lote-correcao-entrada`), com os estados `consultando`, `elegível`, `bloqueado com motivo` e `erro`. Fora de `elegível`, os campos da entrada ficam só leitura.
- **Campos editáveis quando elegível:** quantidade da **entrada** (rótulo "Qtd. Cabeças (entrada)", não o saldo), peso de entrada, data, categoria de manejo, sexo, setor e área de entrada. "Motivo da correção" é obrigatório quando algum campo da entrada muda.
- **Envio:**
  - o que mudou na entrada vai pelo comando, com o `updated_date` lido (CAS);
  - o resto segue pelo PATCH, **só com o que mudou** — o PATCH nunca leva campo da entrada nem `status` inalterado. Antes, a simples presença de `status`/`data_entrada` dava 409 no ledger.
- **Proteções:**
  - duplo clique: trava síncrona;
  - retentativa após falha de rede: mesma `operation_id`;
  - recusa: o formulário mantém o que foi digitado, com aviso específico.
- **Caches:** Cadastro e mapa invalidados (`atualizar-mapa`); o histórico se atualiza pelo mesmo evento.
- **Fora deste slice:** "Informações do Lote" no mapa e "Renomear Lote" (missão R2, separada).

## Evidências

### Backend — PostgreSQL 16 local descartável

`backend/tests/r1CorrecaoEntradaLote.test.mjs`, 19 testes.

- **RED na main:** 18 falham (rota inexistente). O teste de regressão "PATCH genérico continua recusando" passa nos dois lados.
- **GREEN:** 19/19.

| Caso | O que prova |
|---|---|
| (a) | 100 → 120 em lote, evento, partida, posição e `/rebanho/posicoes`; uma única ENTRADA; ids preservados; auditoria antes/depois |
| (b) | Peso 300 → 310 no mesmo registro; `null` desativa sem apagar |
| (c) | Data retroativa nas quatro superfícies; futura → `REBANHO_DATA_FUTURA`; antes do corte → `REBANHO_ANTES_DO_CORTE`; inválida → 400 |
| (d) | Área sem transferência; área de outra empresa → 404; fora do setor → 400; setor e área juntos |
| (e) | Categoria/sexo/categoria de manejo com `chave_identidade` recalculada, peso e quantidade intactos; categoria de outra empresa → 400 |
| (f) | PATCH de metadados não tira a elegibilidade; correções sucessivas |
| (g) | Transferência parcial ativa → bloqueado |
| (h) | Movimento cancelado → bloqueado; ida e volta com saldo igual → bloqueado |
| (i) | Suplementação → bloqueado |
| (j) | Outro tenant → 404, nada gravado |
| corpo | Campos fora do contrato, `cliente_id`, motivo vazio ou falta de CAS → 400 |
| (k) | Duas correções simultâneas: 200 + 409 `LOTE_ESTADO_CONFLITO`; CAS obsoleto → 409 |
| (l) | Falha injetada após a partida e após a projeção → rollback integral |
| (m) | Replay sem duplicar; payload diferente → `IDEMPOTENCY_CONFLICT` |
| (n) | Modos `entradas` (agregado) e `saldo_abertura` (abertura) → recusa explícita; lote cadastrado depois da ativação → corrigível |
| (o) | Corrigir um lote não toca o outro |
| — | Modelo legado: corrige só o cadastro |
| — | A exclusão continua possível após a correção |

### Frontend — jsdom

`tests/smoke/r1CorrecaoEntradaLote.test.jsx`, 9 testes.

- **RED com a UI da main:** 6 testes de página falham.
- **GREEN:** 9/9.

Cobertura:
- domínio: diferença dos campos, PATCH só com o que mudou, mensagens;
- os quatro estados de elegibilidade;
- motivo obrigatório;
- envio com CAS e duplo clique;
- recusa preservando o formulário;
- cache do mapa.

A regressão dos testes de lotes existentes passou: 181/181.

## Casos NÃO suportados (fail-closed, visíveis na tela)

- **Entrada criada pela ativação do ledger** (agregada ou saldo de abertura). Suporte exigiria separar a partida do lote do evento agregado com prova de autoria — missão própria.
- **Lote com qualquer registro posterior,** inclusive movimentação cancelada.
- **Lote derivado ou dividido** em mais de uma posição.

## Decisão proposta

> **D-PROD-1xx — Correção atômica da entrada original.** O Cadastro de Lotes corrige quantidade, peso de entrada, data, categoria, categoria de manejo, sexo, setor e área de entrada pelo comando `POST /lotes/:id/correcao-entrada`. O PATCH genérico continua recusando esses campos. O comando só vale quando nada depende da entrada, verificado no banco com o lote travado; movimentação cancelada também bloqueia.
>
> A correção reescreve o MESMO fato (Lote, EventoRebanho, PartidaRebanho, PesoRebanho e PosicaoRebanho), com os mesmos ids, numa transação. Exige motivo, CAS, idempotência e auditoria antes/depois. Entrada vinda da ativação (agregada ou saldo de abertura) é recusada de forma explícita. "Informações do Lote" no mapa (metadados da posição) é a missão R2, separada.
