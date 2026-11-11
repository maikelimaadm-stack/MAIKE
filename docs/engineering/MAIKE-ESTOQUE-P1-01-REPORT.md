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
_(registrado abaixo, com saídas e exit codes reais)_

## 8. Situação
- `FILES_CHANGED`: só os 6 arquivos de documentação da §2.
- `DB_WRITES=0` · `MIGRATIONS_APPLIED=0` · `PROD_DEPLOY=0`.
- `CONSTITUTION_RATIFIED=NAO` · `IMPLEMENTACAO_AUTORIZADA=NAO`.
- **O proprietário deverá aprovar expressamente o texto proposto e ratificá-lo pelo fluxo constitucional antes da P1-02** (na parte que cria a origem de entrada manual), **da P1-05 e da P1-06.**
