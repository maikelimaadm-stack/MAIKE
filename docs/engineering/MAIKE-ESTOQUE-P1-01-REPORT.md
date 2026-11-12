# MAIKE-ESTOQUE-P1-01-GOVERNANCA-R1 — Relatório

> **STATUS: PROPOSTA DE GOVERNANÇA, só documentação.** Nenhum código, schema, migration, tela, rota, permissão, escopo ou dado de produção foi alterado. A constituição **não** foi emendada (A10). A D-PROD-176 está registrada como **proposta pendente**, não como decisão vigente.

## 1. Identidade
- **Repositório:** `maikelimaadm-stack/MAIKE`.
- **Base:** `origin/main` `74ad3b868ff947f0153c969c51852748690f78a2`, reconferida no início (PR #247 mergeada; CI `quality` run 43082063031 = success).
- **Branch:** `claude/maike-estoque-p1-01-governanca-proposta`, criada de `origin/main` limpo. PR DRAFT.
- **PRs abertas no início:** só a #229 (DRAFT, Produtividade, reserva a D-PROD-154, só docs). Não foi tocada.
  - Não há PR de estoque em curso. A branch planejada não existia.
- **Numeração:** a `main` dizia `Próxima decisão: D-PROD-176`. Nenhuma PR aberta anuncia a 176.
  - A 176 foi **reservada como proposta** e o marcador avançou para D-PROD-177, no mesmo padrão de reserva da D-PROD-154 pela #229.

## 2. Documentos produzidos ou alterados (allowlist da missão)

| Arquivo | Natureza |
|---|---|
| [`MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md`](./MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md) | **Novo.** Texto exato proposto para `00-CONSTITUICAO.md` e `07-DO-NOT-DO.md`, justificativa, conflitos de hierarquia e caminho de ratificação. As normas **não** foram editadas |
| [`MAIKE-ESTOQUE-P1-CONTRATO.md`](./MAIKE-ESTOQUE-P1-CONTRATO.md) | **Novo.** Contrato de projeto (A–E), matriz Antes → Proposta → Pré-requisito → Slice, pontos a ratificar |
| `MAIKE-ESTOQUE-P1-01-REPORT.md` | **Novo.** Este relatório |
| `DECISIONS.md` | Entrada **D-PROD-176 — PROPOSTA PENDENTE DE APROVAÇÃO** e marcador 177. Nenhuma decisão antiga foi alterada |
| `ROADMAP.md` | Nota prospectiva no track do Estoque P0-01, sem reescrever o histórico |
| `CURRENT-STATE.md` | Seção "Proposta em revisão" no topo, com status PROPOSTA |

## 3. Por que a constituição não foi editada
- `08-REGRAS-DE-IA.md` §6 **A10** proíbe o agente de emendar a constituição.
- `00-CONSTITUICAO.md` §4 exige registro em DECISIONS, justificativa e aprovação explícita do responsável.
- O repositório já usou o caminho "texto redigido pelo agente dentro da constituição, valendo com o merge manual" (D-PROD-155/157/159/162). Esta missão determinou **não** usá-lo.
- A proposta documenta os dois caminhos de ratificação, (a) e (b), na §5 da proposta de emenda, sem presumir nenhum.

## 4. Correções em relação à P1-00

A análise P1-00 foi somente leitura e **não está versionada** no repositório. O chat não é autoritativo (`CLAUDE.md`), por isso o que se aproveita dela está reescrito, com evidência, no contrato.


| Tema | P1-00 | Esta proposta |
|---|---|---|
| Saldo de implantação | "Nenhuma camada no local" | Histórico **completo** de produto, em **todos** os locais e status, mais movimentos, cache e itens confirmados, conferido sob a trava do Produto; vários locais no mesmo primeiro documento; segundo documento bloqueado; legado sem inventar saldo (contrato §3, A3) |
| Deduplicação | Só entrada → financeiro | Entrada × compra, entrada × venda, entrada × entrada (unique) e compra → entrada em **todos** os caminhos da P3 que gravam o documento (confirmar, retificar, prévia). Documento ⇒ parceiro obrigatório. READ COMMITTED com consulta depois da advisory. Limites declarados. A liberação fica bloqueada enquanto o recíproco não existir (A5) |
| Devolução | Estava entre os motivos | **Fora** do 1º slice: risco de devolução dupla com o cancelamento do abastecimento (`abastecimentoService.js:504-511`) |
| Unicidade do lote | Chave `(produto, fabricante, número)` | Reconhece a colisão legítima por número reutilizado. Propõe `ocorrencia` imutável e escolha explícita em todo número repetido, **pendente de ratificação** (B3). Reclassificação só na raiz |
| `LocalEstoque` | Uma proposta citava "local de outra empresa" | Local é do tenant, **sem `empresa_id`** (`schema.prisma:803-824`) |

## 5. Matriz de casos (contrato e evidência)

| Caso | Resultado contratado | Seção |
|---|---|---|
| Implantação repetida depois de esgotar ou transferir | 409 `IMPLANTACAO_COM_HISTORICO` (há camada `Esgotado` e movimentos) | A3 |
| Implantação em vários locais | Um único primeiro documento com vários itens; pré-validação contra o estado anterior | A3 |
| Implantação sobre cache legado ≠ 0 sem camada | Recusada; caso de saneamento com GO | A3 |
| Mesmo lote do fabricante em duas notas | Mesmo lote; duas camadas | B3 |
| Fabricante reutiliza o número | Colisão legítima reconhecida: discriminador + escolha explícita (R-LOTE) | B3 |
| Dois documentos com a mesma nota (entrada × compra) | 409 nos dois sentidos, mesma advisory | A5 |
| Doação sem nota repetida | Sem promessa de detecção; motivo, justificativa, auditoria e relatório | A5 |
| Cancelamento com consumo | 409 `CANCELAMENTO_BLOQUEADO` `lote_consumido`; sem estorno parcial | A6 |
| Litro × saco | L ⇔ L; SACO em kg pelo peso capturado; fator divergente = 409; sem conversão L↔KG | C1, C2 |
| Tenant cruzado | Mesmo corpo de "inexistente", sem oráculo; `cliente_id` só do `auth_context` | C3 |
| Troca de fazenda ou de unidade com entrada em rascunho ou lote | Bloqueada (extensão de `produtoService.js:197-205`, `:274-284`) | C3 |
| Cache inconsistente | Reconciliação só diagnostica; implantação recusada | A3, D |
| Replay de resposta | 201 em JSON puro antes do recibo; `deepEqual(201, replay)` (B-03) | C4 |
| Concorrência | Trava do Produto serializa; CAS como 2ª barreira; deadlock → `CONCURRENCY_CONFLICT` | A3, C4 |

## 6. Revisão adversarial A/B/C

Três lentes independentes revisaram estes documentos contra o código da `main` (somente leitura). Todos os achados foram corrigidos **nos documentos desta PR**, sem tocar código.

| Lente | Achado | Sev. | Correção |
|---|---|---|---|
| A | DOACAO/OUTRA contornavam a implantação única; a regra estrita empurrava para OUTRA | ALTO | Proibido usar DOACAO/OUTRA para saldo antigo. Produto com histórico e saldo não registrado só por futuro ajuste de inventário. Aviso "implantação antes" na 1ª compra (A2, A3; emenda §3 e §4.1) |
| A, B | A retificação da P3 (NO_LUGAR/SUBSTITUICAO) e a prévia também gravam o documento e escapavam do bloqueio recíproco | ALTO | Recíproco nos três caminhos (`:2218-2226`, `:2356`, `:2410`, `:1270`); parceiro e documento imutáveis na entrada confirmada (A5) |
| B | Entrada × entrada com o mesmo documento não era barrada (a advisory só serializa) | ALTO | Unique `documento_chave_ativa` na tabela nova + 409 `DOCUMENTO_DUPLICADO` (A5; nota 07) |
| B | PAGAR SEM_PRODUTOS + entrada manual = rota de compra | ALTO | Recíproco para todo PAGAR com documento, com ou sem produtos (A5) |
| B | Sem `parceiro_id` (ou com parceiro de outra empresa) a chave nunca casava | ALTO | Documento ⇒ parceiro obrigatório e validado como no financeiro (A5) |
| A, C | O texto da emenda contradizia a R-IMPL; a premissa do cancelamento era falsa | MÉDIO | Variante estrita no texto, variante aberta literal; R-IMPL decidida antes da R-EMENDA; premissa corrigida (A3; emenda §3 e §5) |
| A | M5 não cobria `estornarEmLote` | MÉDIO | M5 inclui `:879`, `:905-909` e `:1004-1007` |
| A | Discriminador do lote mutável; fusão silenciosa sem datas | MÉDIO | `ocorrencia` imutável; escolha explícita sempre (B3) |
| A | Reclassificação de camada derivada divergia da origem | MÉDIO | Só na camada raiz (B4) |
| A | Duplicação por outro Produto ou compra retroativa não declarada | MÉDIO | Limite declarado + avisos não bloqueantes (A3) |
| B | Limites da dedupe subdeclarados | MÉDIO | Quatro limites explícitos + aviso com N a ratificar (A5) |
| B | Referência a "relatório de entradas §5.4" inexistente (e nome proibido) | MÉDIO | Filtro `motivo` na consulta (P1-04) e no detalhe (P1-06); nenhuma página de relatório (A2) |
| B | "Sem concessão automática" não vale para o administrador; ação `criar` não existe | MÉDIO | Admin tem tudo por desenho; vocabulário `novo`/`salvar`; `ACOES_ENTRADA_ESTOQUE` com paridade (C4) |
| B | FK composta com empresa não existe para Produto, Fornecedor e Local | MÉDIO | FKs `(cliente_id, id)`; empresa conferida no serviço (C3) |
| C | Recorte "parte da P1-02" afrouxava o G5 | ALTO | Ratificação antes da P1-02 inteira; divisão só via R-SPLIT com autorização (contrato §7 e §8; DECISIONS) |
| C | ROADMAP omitia a ratificação e a P1-02 | MÉDIO | Sequência corrigida |
| C | Esclarecimento do SACO incompleto (4 trechos do 07 e 1 do 00); hierarquia mal enquadrada | MÉDIO | S1–S4 literais + texto para o 00; conflito declarado como pré-existente (emenda §4.2 e §6) |
| C | Precedente de reserva impreciso; risco "merge = aprovação" | MÉDIO | DECISIONS, CURRENT-STATE e emenda dizem: merge ≠ ratificação; nota de recusa prevista |
| C | Caminho de ratificação (b) depende de leitura de precedente | BAIXO | Declarado; exige autorização escrita nomeando a PR e o texto (emenda §5) |
| B | Recíproca com venda (RECEBER), vazamento de dados no 409, isolamento | BAIXO | `DOCUMENTO_DE_VENDA`; detalhes condicionados à permissão; READ COMMITTED obrigatório (A5) |
| A | Custo zero da doação ambíguo; motivos de recusa do cancelamento inexistentes; estorno pelo kg gravado; valor total calculado no servidor; travas do rascunho; I6 e custo ≥ 0 só na aplicação; linhas deslocadas | BAIXO | Corrigidos em A4, A6, C2, C4 e B4; referências ajustadas (`:647-652`, `:198-212`, `:274-285`) |
| C | "Nota" × "expansão"; nomes proibidos incompletos; "ERP amplo"; linha em branco e posição da nota; frases que soavam vigentes | BAIXO | Corrigidos na emenda, no DECISIONS e no CURRENT-STATE |

Também conferido e correto:
- todas as faixas e linhas do motor, do financeiro, da reconciliação e do classificador citadas;
- READ COMMITTED da P3;
- `LocalEstoque` sem `empresa_id`;
- âncoras de inserção existentes;
- nenhum nome proibido liberado;
- 00, 07 e 08 intocados.

## 7. Gates e CI
Os resultados abaixo foram rodados no HEAD `3b49eac1`, o commit que traz o conteúdo da
proposta, com a árvore limpa. O commit seguinte só preenche esta seção. O CI do SHA final
fica registrado na própria PR.

| Comando | Exit | Saída (última linha) |
|---|---|---|
| `npm run gate:governance-paths` | 0 | `gate:governance-paths — PASSOU (documentos, links e gates coerentes)` |
| `npm run gate:product-scope` | 0 | `gate:product-scope — PASSOU (24 páginas, 35 entidades, 0 function(s))` |
| `npm run gate:no-secrets` | 0 | `gate:no-secrets — PASSOU (2619 arquivos verificados, 0 segredos)` |
| `npm run test:gates` | 0 | `# tests 739 # pass 739 # fail 0` |
| `npm run verify:all` (integral) | 0 | `TODAS AS ETAPAS PASSARAM` (40 etapas, 1591,0 s) |

O `verify:all` rodou em PostgreSQL 17.11 local e descartável, num banco novo e vazio, com
`NODE_ENV` vazio. As principais contagens foram:
- `test:backend`: 1630 testes, 1625 passaram, 0 falharam, 5 marcados `todo`;
- vitest: 200 arquivos e 2447 testes, todos passaram;
- `lint`, `gate:types`, `typecheck:backend`, `build` e `build:admin` passaram;
- `gate:tenancy`, `gate:indices`, `gate:deploy-migrations` e `gate:base44` passaram.

Nenhum banco remoto foi tocado.

`git diff --name-status origin/main...HEAD` lista exatamente os seis documentos da §2:
- M `CURRENT-STATE.md`, `DECISIONS.md` e `ROADMAP.md`;
- A `MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md`, `MAIKE-ESTOQUE-P1-01-REPORT.md` e
  `MAIKE-ESTOQUE-P1-CONTRATO.md`.

Não há código, schema, migration, escopo, teste nem workflow no diff.

## 8. Situação
- `FILES_CHANGED`: só os 6 arquivos de documentação da §2.
- `DB_WRITES=0` · `MIGRATIONS_APPLIED=0` · `PROD_DEPLOY=0`.
- `CONSTITUTION_RATIFIED=NAO` · `IMPLEMENTACAO_AUTORIZADA=NAO`.
- **O proprietário deverá aprovar expressamente o texto proposto e ratificá-lo pelo fluxo constitucional antes da P1-02** (na parte que cria a origem de entrada manual), **da P1-05 e da P1-06.**

---

## 9. Adendo R2 — Editar e Excluir (MAIKE-ESTOQUE-P1-01-GOVERNANCA-R2, 2026-11-11/12)

> **Ainda PROPOSTA.** As seções 1 a 8 acima ficam como **histórico da R1** e não foram reescritas. Onde divergirem deste adendo, vale o adendo. Exemplos: a §5 cita `CANCELAMENTO_BLOQUEADO`, e a §8 cita a ratificação "antes da P1-05". Nada foi implementado, ratificado ou autorizado. A constituição (00), o 07 e o 08 continuam intocados (A10).

### 9.1 Feedback do proprietário
A Entrada de Estoque deve ter as ações **Editar** e **Excluir**. O proprietário não quer clicar em "Cancelar" como única alternativa para corrigir uma entrada. O pedido **não** autoriza apagar movimentos físicos imutáveis nem desligar a auditoria.

### 9.2 Antes (R1) → depois (R2), no contrato

| Tema | R1 | R2 |
|---|---|---|
| Estados | `RASCUNHO` → `CONFIRMADA` → `CANCELADA` | `RASCUNHO`, `CONFIRMADA` e `EXCLUIDA` (final, consultável), com revisões imutáveis no evento (A6) |
| Ação do usuário na confirmada | Cancelar | **Editar** e **Excluir**. Não há botão Cancelar. O estorno do motor continua interno (A6, A8.7) |
| Correção de quantidade, custo, local, produto, data, parceiro ou documento | Cancelar e relançar | **Revisão versionada atômica** do mesmo documento: estorno pelo motor do que muda e aplicação nova, numa transação (A8.2) |
| Prova de "sem dependência" | "Camadas intocadas" pelo critério do motor | Prova "**camada nunca referenciada**" P1–P10 (A8.3), no molde de `provaDaCompra`. Inclui a tabela de abastecimento, que a P3 não consulta, e baixa **depois estornada** (bloqueia) |
| Alcance da dependência | — | **Por documento**: uma camada referenciada trava a classe F inteira. A alternativa por item fica para ratificação (k) |
| Impacto FIFO | Só a R-DATA (pendente) | **Janela FIFO** pela posição na fila `(chave, id)`: nenhuma camada nova à frente de camada já tocada por baixa. Vale na confirmação e na revisão (A8.4) |
| Motivo da entrada | Mutável só no rascunho | **Imutável** (classe I): errou o motivo, exclui e relança |
| Implantação | Uma vez; reimplantar só na variante "aberta" | No máximo **uma ativa**, corrigida por edição. Nova implantação só depois de `EXCLUIDA`, desconsiderando por FK os itens já estornados de entrada manual. Variante estrita como alternativa (A3) |
| Dedupe | Recíproca só com PAGAR | Recíproca **PAGAR e RECEBER**. Revisão de parceiro ou documento roda a dedupe de novo, com advisories em ordem crescente. Aviso de documento liberado por revisão e por exclusão (A5) |
| Procedência | — | **Nunca** `atualizarProcedencia` na entrada. Diverge da D-PROD-158 de propósito (A5) |
| Recibos depois da exclusão | — | `criar`, `confirmar` e `editar` passam a `STATUS_EXCLUIDO` (A8.6) |
| Códigos | `CANCELAMENTO_BLOQUEADO`, `DOCUMENTO_DE_*`, `DOCUMENTO_DUPLICADO` | `DEPENDENCIAS_FISICAS`, `IMPACTO_FIFO`, `DOCUMENTO_CONFLITANTE`, `VERSAO_CONFLITO`, `STATUS_INVALIDO` (+ os da R1), com `details.motivos[]`. Nenhuma colisão em `errorCodes.js` (C4) |
| Permissões | `cancelar` na lista extra | `editar`/`excluir` (já existem em `ACOES`) **+ `confirmar`** para a confirmada. Nenhuma concessão por padrão (C4) |
| Slices | P1-05 → P1-06 | **P1-05a** (documento, confirmar, excluir; todo o DDL) → **P1-05b** (editar confirmada) → **P1-06** (tela só depois das duas) (§7) |
| Pontos a ratificar | R-EMENDA, R-MOTIVOS, R-IMPL, R-DATA, R-DEDUPE, R-LOTE, R-ORDEM, R-SPLIT | Os mesmos, com **R-IMPL refeita**, mais **R-EDICAO-EXCLUSAO** (a)–(l) e **R-CONVERSAO** (§8) |

**Textos propostos para 00 e 07** (proposta de emenda §3 e §4.1), sem editar as normas:
- autorizam editar e excluir com controles, versão e trilha;
- proíbem expressamente reescrever ou apagar movimento e camada;
- trazem a frase literal que muda em cada alternativa (R-IMPL estrita, (b), (k)).

### 9.3 Consequências para motor, DDL e slices
- **Motor (P1-02):** além do que a R1 previa:
  - `estornarEmLote` parametrizada (ou primitiva irmã) com `tipo_detalhado` `estorno_entrada_revisao`/`estorno_entrada_exclusao`;
  - conferência de produto, local e empresa da camada contra a linha. Hoje nenhuma das duas primitivas faz isso: `estoqueFisicoMotor.js:870-873`, `:918-919`, `:924-930` e `:700-704`;
  - CAS `Ativa` + filho nulo ao marcar o original. Hoje a marcação é só por id: `:683-687`, `:1004-1007`;
  - camadas `FOR UPDATE` em toda reversão (§6.2, item 8).
- **Reconciliação (P1-05a):** a origem `entrada_estoque` entra em `ORIGENS_PROTOCOLO`. Um CTE novo explica as camadas `Estornado` pela FK do estorno da linha. O AuditLog só usa a entidade `EntradaEstoque` (§6.2, itens 9 e 10).
- **DDL (P1-05a, com runbook e GO antes do merge; nenhuma migration agora):**
  - `EntradaEstoque`;
  - `EntradaEstoqueItem`, versionada por `revisao_inicio`/`revisao_fim`, com FKs compostas Restrict e uniques por camada, movimento e estorno;
  - `EntradaEstoqueEvento`, com tipo, modo, motivo, autor, antes e depois (§7, modelo de dados).
- **Não se promete:**
  - edição física ou exclusão com dependência;
  - recálculo de custo de baixa passada;
  - conversão de entrada em compra antes da R-CONVERSAO.

### 9.4 Cenários adversariais (item E da missão) e resultado contratado

| Cenário | Resultado contratado | Seção |
|---|---|---|
| Duas edições concorrentes da mesma confirmada | A segunda espera o `FOR UPDATE` do cabeçalho e recebe `VERSAO_CONFLITO`; nada é gravado | A8.5 |
| Replay idêntico | Devolve o corpo gravado daquela revisão (`revisao`, `versao`). Depois da exclusão → `IDEMPOTENCY_EFEITO_EXCLUIDO` | A8.6, C4 |
| `operation_id` reutilizado com outro payload (outra versão ou motivo) | `IDEMPOTENCY_CONFLICT` antes de qualquer efeito | C4 |
| Camada consumida (venda, abastecimento, suplementação) | `DEPENDENCIAS_FISICAS` `lote_consumido`; só a classe M fica editável | A8.3 |
| Camada transferida | `DEPENDENCIAS_FISICAS` `lote_transferido` (JSON da Saída `transferencia_enviada`) | A8.3 |
| Venda ou abastecimento consumiu e foi cancelado (saldo voltou) | Continua bloqueado (`consumo_estornado`), porque a fatia e o JSON persistem. A alternativa é a ratificação (b) | A8.3 |
| Correção retroativa que passaria à frente de camada já consumida | `IMPACTO_FIFO` `camada_posterior_consumida` (ordem `(chave, id)`); nunca recálculo | A8.4 |
| Saída legada sem rastro no par | `IMPACTO_FIFO` `baixa_legada_sem_rastro` e `consumo_legado_sem_rastro` (fail-closed). Estornos do próprio motor **não** contam como sem rastro | A8.3, A8.4 |
| Exclusão depois de compra com a mesma NF | A compra não confirma enquanto a entrada estiver ativa (recíproca). Depois da exclusão, a compra passa, com aviso | A5 |
| Revisão troca o documento para escapar | A dedupe roda de novo na chave nova. A chave antiga liberada gera aviso com ciência na P3. Fica como limite declarado | A5 |
| Entrada que era compra e já foi consumida | Sem caminho no 1º slice; nunca orientar a lançar sem nota (R-CONVERSAO) | A5, A8.7 |
| Reimplantação depois da exclusão, multi-local, com movimentos estornados | Aceita só se, desconsiderando por FK os itens já estornados de entrada manual, não sobrar fato de `P`. Baixa estornada sobre a implantação impede a exclusão | A3 |
| Revisão da implantação com outros fatos do produto (compras) | Quantidade, custo, unidade, fator, parceiro e documento no mesmo par e data: aceita, com prova e janela. Produto, local e data: só com as condições 1–5 e as exceções (i)/(ii). Condição 3 exata sobre as camadas do próprio documento | A3 |
| Produto de outra empresa ou tenant | Mesmo corpo de "inexistente"; `cliente_id` só do `auth_context` | C3 |
| Produto apagado | Produto citado por linha de entrada (qualquer status) não é excluído (409 `PRODUTO_DELETE_BLOCKED`) | C3 |
| Troca de unidade ou do peso do SACO | Estorno pelo kg gravado na linha. A linha nova recaptura o fator; divergência com a prévia → `FATOR_DIVERGENTE` | A6, C2 |
| Documento presente sem parceiro | Recusado (parceiro obrigatório) | A5 |
| Autor, motivo, antes e depois | Evento `EDICAO`/`EXCLUSAO` com snapshots e autor do `auth_context`. AuditLog `EntradaEstoque` com allowlist | A8.2, A8.6 |
| Exclusão da última camada | Estorno integral; cache decrementado pelo motor; `estoque_atual` < kg → `estoque_atual_insuficiente` (caso de reconciliação) | A8.3 (P9) |
| Estorno parcial | Não existe. Retirar item é revisão, que estorna a camada inteira | A6, A8.6 |
| Falha no meio da transação | Rollback total, inclusive do recibo, da numeração e do AuditLog; nenhuma janela de estoque incorreto | A8.2 |

### 9.5 Revisão adversarial da R2
- **Como foi feita:** um workflow com 7 lentes independentes (concorrência e idempotência; dependências; FIFO; dedupe; implantação; integridade e tenancy; governança e coerência), cada uma lendo o código da `main` só para leitura. Depois, **um verificador cético por achado**, encarregado de refutar.
- **Resultado:** 54 achados, 51 confirmados (11 ALTO, 22 MÉDIO, 18 BAIXO) e 3 refutados. Os confirmados se repetiam entre lentes e se agrupam nos temas abaixo. **Todos foram corrigidos nos documentos** desta PR, sem código.

| Tema (achados) | Sev. | Correção |
|---|---|---|
| Alcance da dependência diferente entre contrato (por item) e emenda, D-PROD-176 e UX (por documento) (C1, C20, C28, C36, C45) | ALTO | Alcance **por documento** em todos os textos; por item vira a alternativa (k). Listas de 00 e 07 completadas (fator, custo zero, incluir ou retirar item) |
| Implantação: "exceção única" × edição; "uma única vez" × reimplantação; troca de produto ou motivo deixava `P` sem caminho; condição 3 impossível na edição (C2, C6, C23, C29, C30, C31, C38, C43) | ALTO | Exceções (i) e (ii) por FK; condição 3 exata; "no máximo uma ativa"; motivo imutável (classe I); variante estrita avisa antes da exclusão |
| P8 e janela tratavam os estornos do próprio motor como "saída sem rastro" (C3, C11, C33) | ALTO | P8 exclui estorno de entrada (`movimento_pai_id` + `tipo_detalhado`) |
| Janela contava camada `Estornado` como tocada; isenção e empate mal provados; conjunto do próprio documento (C5, C12, C14, C15, C16) | ALTO | "Tocada" redefinida; regra exata pela ordem `(chave, id)`, conferida depois de criar a camada; isenção removida (a correção normal passa pela própria regra) |
| Relatório sem a §9 citada (C44) | ALTO | Este adendo |
| Dedupe com RECEBER só num sentido (C21, C37, C49) | MÉDIO | Recíproca nas duas direções e nos três caminhos; revisão sem troca de identidade não roda a dedupe de novo |
| Revisão que troca o documento libera a chave sem aviso; limites desatualizados (C22) | MÉDIO | Aviso com ciência na P3 e na revisão; limite declarado novo |
| Entrada que era compra e já tem dependência (C25) | MÉDIO | R-CONVERSAO; UX nunca sugere lançar sem nota |
| Rascunho sem motivo × 00/07 (C24, C35, C47) | MÉDIO | Exigências de motivo e trilha restritas à **confirmada**; rascunho com AuditLog |
| Recibo de `criar` não marcado na exclusão (C8, C41, C48) | MÉDIO | Marcado `STATUS_EXCLUIDO` |
| Ensaio do motor em SAVEPOINT na elegibilidade "sem trava" (C4) | MÉDIO | Removido. Elegibilidade só consulta |
| (b) e (c) fechados no texto da emenda e abertos no contrato (C34, C46) | MÉDIO | Texto incorpora a proposta, e a emenda dá a frase literal da alternativa |
| "Data da revisão" ambígua (C9, C17, C26, C32, C39, C51) | BAIXO | Definida: data da entrada informada no documento; estornos com data de hoje sem efeito FIFO |
| Ordem de travas incompatível; "igual ao financeiro" falso (C7, C27) | BAIXO | Advisories antes de camadas e movimentos; "compatível" com o financeiro; regra única para várias chaves |
| Condição FIFO literal "alterar o FIFO de baixas" (C19) | BAIXO | Reescrita como regra de posição na fila, em 00, 07 e D-PROD-176 |
| Citações de código e permissões (C10, C13, C40, C50) | BAIXO | `operacaoFinanceiraService.js:384-401`; `tipo_detalhado` `VarChar(128)`; endurecimento mira `estornarEmLote`; excluir = análogo, não igual, à D-PROD-158; nomes da lista |
| Modelo: par único só entre vigentes; exclusão do Produto pela FK (C42) | BAIXO | Par único entre vigentes; 409 `PRODUTO_DELETE_BLOCKED` contando as linhas |
| Saída legada filtrada por data, embora o FIFO não olhe data (C18) | BAIXO | Qualquer saída sem rastro no par recusa |

**Refutados (3)**, pelo verificador:
- "is_admin recebe tudo" já estava declarado na C4;
- a troca KG↔SACO depois de editar não leva a 500, porque a A6 trata o estorno pelo kg gravado e o fator divergente tem código;
- "UPDATE de quantidade" no 07 está qualificado por "em vez de uma nova revisão pelo motor".

### 9.6 O que continua dependendo de aprovação humana
1. **R-IMPL** (proposta ou estrita), **antes** da R-EMENDA.
2. **R-EDICAO-EXCLUSAO** (a)–(l), em especial:
   - (b): baixa estornada bloqueia;
   - (c): janela FIFO na entrada e, um dia, na P3;
   - (k): alcance por documento × por item;
   - (l): motivo imutável.
3. **R-EMENDA:** texto de 00 e 07, incorporado pelo rito da §4 da constituição (caminho (a) ou (b) da proposta de emenda, §5).
4. **R-MOTIVOS**, **R-DATA**, **R-DEDUPE** (inclui RECEBER e os avisos), **R-CONVERSAO**, **R-LOTE**, **R-ORDEM** e **R-SPLIT**.
5. Nota de ratificação, ou de recusa, na D-PROD-176.

Nem esta PR nem o merge dela ratificam a proposta. A P1-02, a P1-05a, a P1-05b e a P1-06 só começam depois da ratificação, cada uma com missão própria. DDL só com runbook e GO.

### 9.7 Gates e CI da R2

Os comandos abaixo rodaram no HEAD `44ba3c18`, o commit que traz todo o conteúdo da R2, com a árvore limpa. O commit seguinte só preenche esta seção. O CI do SHA final fica registrado na própria PR.

| Comando | Exit | Saída (última linha) |
|---|---|---|
| `npm run gate:governance-paths` | 0 | `gate:governance-paths — PASSOU (documentos, links e gates coerentes)` |
| `npm run gate:product-scope` | 0 | `gate:product-scope — PASSOU (24 páginas, 35 entidades, 0 function(s))` |
| `npm run gate:no-secrets` | 0 | `gate:no-secrets — PASSOU (2619 arquivos verificados, 0 segredos)` |
| `npm run test:gates` | 0 | `# tests 739 # pass 739 # fail 0` |
| `npm run verify:all` (integral) | 0 | `TODAS AS ETAPAS PASSARAM` (40 etapas, 1459,5 s) |

**`verify:all`:**
- rodou em PostgreSQL 17.11 local e descartável, num banco novo e vazio, com `NODE_ENV` vazio;
- `test:backend`: 1630 testes; 1625 passaram, 0 falharam e 5 estão marcados `todo`;
- vitest: 200 arquivos e 2447 testes, todos passaram;
- `lint`, `gate:types`, `typecheck:backend`, `build`, `build:admin`, `gate:tenancy`, `gate:indices` e `gate:deploy-migrations` passaram;
- nenhum banco remoto foi tocado.

**CI `quality`:** passou nos commits intermediários da R2:
- `e4550ca6`: run 43120049817, success;
- `44ba3c18`: run 43127053238, success.

**Escopo do diff:** `git diff --name-status origin/main` lista só os seis documentos da allowlist:
- M: `CURRENT-STATE.md`, `DECISIONS.md` e `ROADMAP.md`;
- A: `MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md`, `MAIKE-ESTOQUE-P1-01-REPORT.md` e `MAIKE-ESTOQUE-P1-CONTRATO.md`.

O diff contra `docs/constitution`, `README_AI.md`, `AGENTS.md`, `CLAUDE.md`, `config`, `src`, `backend`, `apps`, `base44`, `scripts`, `package.json`, `vercel.json` e `.github` está **vazio**.

No `DECISIONS.md`, só mudou a entrada D-PROD-176, a última do arquivo. O marcador continua em D-PROD-177.
