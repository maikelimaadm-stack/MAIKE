# MAIKE-ATIVIDADE-MAO-OBRA — contrato da Fatia 4 do Lançamento de Atividades

> **fatia 4 · `feat/atividade-mao-obra-servico` · PR (a abrir)**
>
> Decisão **D-PROD-204**. Pedido do proprietário: "FATIA 4 — Mão de obra e serviço de terceiro. Fecha o custo."
> Escolha aprovada pelo proprietário antes de implementar ("sim, vai de acordo com o cadastro de parceiro"):
> cadastro próprio de **Funcionário** (não `Usuario`); o prestador do serviço vem do **cadastro de Parceiros**
> (tabela `Fornecedor`, papel `prestador_servico`). Base: Fatias 1 a 3 (D-PROD-197, 200 e 202), em produção.

## 1. Modelo (fixado no `schema.prisma`)

**Cadastros novos, por fazenda (`cliente_id`, `empresa_id`), nunca apagados (só inativar/reativar):**
- `Funcionario`: `numero`, `nome`, `cargo?`, `tipo` (`MENSALISTA | DIARISTA | TAREFEIRO`), `custo_hora?`,
  `custo_diaria?` (Decimal 14,4, ≥ 0), `ativo`. Não é folha: sem salário, encargos, ponto ou pagamento.
- `Servico`: `numero`, `nome`, `unidade_medida_id` (FK `UnidadeMedida`, o cadastro existente), `centro_custo_padrao_id?`
  (FK composta `CentroCusto` da mesma fazenda), `valor_referencia?` (≥ 0), `ativo`.

**Linhas novas do apontamento (mesmo desenho da linha de máquina da Fatia 3):**
- `AtividadeApontamentoMaoObra`: `funcionario_id`, `tipo_medida` (`HORA | DIARIA | TAREFA`), `quantidade` (> 0),
  `custo_unitario?` (snapshot), `custo_total?`.
- `AtividadeApontamentoServico`: `servico_id`, `fornecedor_parceiro_id?`, `quantidade` (> 0), `unidade` (snapshot da
  sigla da unidade do serviço), `valor_unitario` (≥ 0), `valor_total`, `documento_referencia?` (até 120).
- Comuns às duas: `ordem`, `status` (`CONFIRMADO | CANCELADO`), `operation_id`, `observacao?`, autores, cancelamento
  (`LINHA | EDICAO | APONTAMENTO | ATIVIDADE`), como nas linhas da Fatia 3.

Toda FK é composta pelo tenant e `RESTRICT`. Apontamento, funcionário e serviço entram por `(cliente_id, empresa_id,
id)`. O parceiro só tem `(cliente_id, id)`: a mesma fazenda é conferida no serviço (`FOR KEY SHARE`, como
`bemPatrimonialService`).

**Migration `20261114800000_atividade_mao_obra_servico`, EXPAND (só 4 tabelas novas):** produção 55 → 56
migrations e 90 → 94 tabelas (depois das Formulações, D-PROD-203, `20261114700000_cadformulacao`). Aplicável antes do merge, só com autorização do proprietário.

## 2. Cadastros Funcionário e Serviço

- Padrão dos cadastros por fazenda do repo (molde: `CadEstacao` para módulo/tela/guarda; `CentroCusto`/`Marca` para a
  numeração `reservarNumero(..., ESCOPO_TENANT)`).
- Rotas: `GET /funcionarios?empresa_id=&q=&ativo=&limit=&cursor=` (paginação **keyset**, `createdAt DESC, id DESC`:
  envelope `{ items, total, limit, has_more, next_cursor }`; não há `page`), `GET /funcionarios/:id`,
  `POST /funcionarios`, `PATCH /funcionarios/:id`, `POST /funcionarios/:id/inativar`,
  `POST /funcionarios/:id/reativar`. Igual para `/servicos`. **Sem DELETE** (cadastro com custo nunca é apagado).
- `q` é busca **literal** (`%` e `_` escapados, `termoDeBusca`): funcionário por nome, número e cargo; serviço por nome
  e número.
- `GET /servicos-opcoes/centros-custo?empresa_id=`: centros de custo ATIVOS da fazenda (id, número, nome) para o
  centro padrão do formulário de serviço. Guarda: `novo`, `salvar` **ou** `editar` da tela de Serviços (quem cria ou
  edita serviço escolhe o centro sem ter a tela de Centros de Custo; só `visualizar` → 403).
- Concorrência: `PATCH`, inativar e reativar travam a linha do cadastro (`SELECT … FOR UPDATE`) antes de ler o
  "antes" (como `parceiroService`/`fornecedorService`); a unidade de medida e o centro de custo do serviço são lidos
  `FOR SHARE` (uma inativação em voo termina antes e é vista).
- Tenant do `auth_context`; `empresa_id` conferido contra o escopo do usuário; schemas fechados; decimais como string.
- Funcionário: `tipo` obrigatório; custos opcionais, ≥ 0.
- Serviço: unidade de medida ativa do cliente; centro de custo padrão ativo da mesma fazenda; valor de referência ≥ 0.
- Exclusão de unidade de medida usada por serviço (mesmo inativo) → 409 `UNIDADE_MEDIDA_DELETE_BLOCKED` (vínculo
  `servico`), barrada pela **FK** `Servico_cliente_id_unidade_medida_id_fkey` (RESTRICT) e reconhecida por
  `shared/errors/vinculoServico.js` — o módulo da unidade não consulta `Servico`.
- Telas novas `Funcionarios` e `Servicos` no grupo de cadastros, com permissão de tela própria, registradas no
  `config/mapa-manejo-scope.json`. Só componentes existentes (nada visual novo). Nunca usar a palavra "Fornecedores"
  em menu/rota (domínio proibido).

## 3. Linha de mão de obra

- Tipo da atividade precisa de `permite_mao_obra`; sem ele → 422 `ATIVIDADE_EXIGIDA_PELO_TIPO`,
  `reason: permite_mao_obra` (a tela esconde o bloco).
- Apontamento `CONFIRMADO` e atividade `ABERTA`. Funcionário ativo da mesma fazenda.
- **Custo:**
  - `HORA` → `custo_unitario` = `Funcionario.custo_hora` (snapshot); `DIARIA` → `custo_diaria`. O corpo **não** aceita
    `custo_unitario` nesses casos. Sem custo no cadastro → custo nulo (a linha entra, sem custo).
  - `TAREFA` → `custo_unitario` obrigatório no corpo (≥ 0).
  - `custo_total = quantidade × custo_unitario` (mesmo arredondamento da linha de máquina).
  - **Edição mantém o snapshot:** se o `funcionario_id` **e** o `tipo_medida` não mudam, o `custo_unitario` gravado
    fica (inclusive nulo) e só o `custo_total` é recalculado com a quantidade nova; o cadastro (`custo_hora` /
    `custo_diaria`) só é lido de novo quando o funcionário ou a medida mudam. Entrar em `TAREFA` continua exigindo o
    custo digitado; editar uma `TAREFA` sem trocar a medida mantém o custo gravado, salvo se o corpo trouxer outro.
    O "Repetir" (lançamento novo) grava o snapshot do cadastro **atual**.
  - O funcionário é lido `FOR SHARE` na escrita da linha: uma inativação ou troca de custo em voo termina antes e é
    vista (inativo → 422 `inativo`).
- Sugestão na tela (não regra): MENSALISTA → HORA, DIARISTA → DIARIA, TAREFEIRO → TAREFA.

## 4. Linha de serviço

- Tipo da atividade precisa de `permite_servico`; sem ele → 422 `ATIVIDADE_EXIGIDA_PELO_TIPO`, `reason: permite_servico`.
- Serviço ativo da mesma fazenda. `unidade` = sigla da unidade de medida do serviço (snapshot).
- `valor_unitario` obrigatório no corpo (a tela preenche com `valor_referencia`); `valor_total = quantidade ×
  valor_unitario`.
- `fornecedor_parceiro_id` opcional: parceiro **ativo, da mesma fazenda e com o papel `prestador_servico`**
  (`lerPapeis(tipos)`); outro caso → recusa uniforme 422, sem revelar se o id existe. Parceiro usado em linha conta
  como "em uso" na exclusão de parceiro (`fornecedorService`, `PARCEIRO_EM_USO`).

## 5. Comum às duas linhas (igual à Fatia 3)

- **Editar** = cancelar a linha (`EDICAO`) e criar outra, na mesma transação. **Cancelar** com motivo.
- `PATCH` **sem mudança real** (o estado mesclado igual ao gravado; decimais comparados no canônico de 4 casas; na
  hora/diária o custo não conta) → 422 `ATIVIDADE_LINHA_INVALIDA`, `field: corpo`, `reason: sem_alteracao`: nada é
  cancelado nem recriado e a `versao` não sobe. A tela já não envia um PATCH vazio ("Sem alterações") e trata essa
  resposta do mesmo jeito.
- As chaves derivadas das linhas de um lançamento (`<operation_id>:o<n>`, `:s<n>`, e `:p<n>` do produto) são
  conferidas por comparação **exata** (`operation_id IN (<k>:o1 … <k>:o20)`, 20 = máximo de linhas por tipo no
  corpo), nunca por prefixo (`LIKE` faria do `_` da chave um curinga).
- Cancelar o apontamento ou a atividade cancela as linhas confirmadas (`APONTAMENTO` / `ATIVIDADE`).
- Idempotência por `operation_id` (`executarComIdempotencia`; recibo antes da versão); CAS pela `versao` do
  apontamento; data do apontamento travada com linha confirmada (incluir as novas na trava).
- `POST /atividades/:id/apontamentos` e `…/duplicar` aceitam `mao_obra[]` e `servicos[]` (tudo numa transação, um
  `operation_id`); o apontamento (lista e detalhe) traz `mao_obra[]` e `servicos[]`, inclusive canceladas.
- Nada de financeiro: nenhuma `OperacaoFinanceira`, título ou rateio a partir das linhas.

## 6. API

| Rota | Guarda |
|---|---|
| `POST /atividades/:id/apontamentos/:apId/mao-obra` · `…/servicos` | apontamentos: criar |
| `PATCH …/mao-obra/:linhaId` · `…/servicos/:linhaId` | apontamentos: editar |
| `POST …/mao-obra/:linhaId/cancelar` · `…/servicos/:linhaId/cancelar` | apontamentos: cancelar |
| `GET /atividades-opcoes/funcionarios?empresa_id=&q=` (ativos: id, numero, nome, cargo, tipo, custo_hora, custo_diaria) | atividades: ver |
| `GET /atividades-opcoes/servicos?empresa_id=&q=` (ativos: id, numero, nome, unidade, valor_referencia) | atividades: ver |
| `GET /atividades-opcoes/parceiros-servico?empresa_id=&q=` (ativos com papel `prestador_servico`: id, nome; o `q` casa só o `nome`) | atividades: ver |

A linha de mão de obra (no apontamento e nas escritas) traz ao lado do `funcionario_id` o resumo
`funcionario: { id, numero, nome, cargo, tipo, custo_hora, custo_diaria }` com os custos **atuais** do cadastro (a
prévia da tela ao trocar funcionário ou medida, e o "Repetir"); o snapshot da linha é o `custo_unitario`.

**Totais** (`GET /atividades/:id/totais`) ganham, somando só linhas confirmadas de apontamentos confirmados:

```
mao_obra: [{ funcionario_id, nome, tipo_medida, quantidade, custo_total }],
servicos: [{ servico_id, nome, unidade, quantidade, custo_total }]
```

`custo_total` e `custo_por_ha` passam a somar produto + máquina + mão de obra + serviço. A mão de obra agrupa por
funcionário e medida; o serviço, por serviço **e** unidade (a tela usa `${servico_id}-${unidade}` como chave).

## 7. Tela (só componentes existentes)

- Blocos "Mão de obra" e "Serviços" dentro do apontamento, ao lado de Produtos e Máquinas, cada um visível só com a
  flag do tipo; janelas de adicionar, editar e cancelar no mesmo molde (`JanelasDaLinha`).
- Mão de obra: funcionário, medida (sugerida pelo tipo do funcionário), quantidade; custo unitário mostrado (hora/diária)
  ou digitado (tarefa); total calculado.
- Serviço: serviço, parceiro (opcional, só prestadores), quantidade com a unidade do serviço, valor unitário (preenchido
  com o de referência), documento; total calculado.
- Totalizador e "Repetir último lançamento" incluem as linhas novas.
- Telas de cadastro Funcionários e Serviços no molde das telas de cadastro existentes.

## 8. Constituição (precisa da aprovação do proprietário no merge)

Expansão D-PROD-204 no `00` e nota no `07`: cadastros mínimos de Funcionário e Serviço e as linhas de mão de obra e
serviço como **custo da atividade** (snapshot), com parceiro prestador como referência. Continua fora: folha
(D-PROD-02), salário, encargos, ponto, pagamento, lançamento financeiro, título, rateio, contrato de serviço.

## 9. Testes

Cadastros (CRUD, inativar, tenant, empresa, sem DELETE, unidade em uso) · linha de mão de obra (hora/diária com
snapshot, tarefa digitada, sem custo no cadastro, flag desligada recusa) · linha de serviço (valor, unidade snapshot,
parceiro com/sem papel e de outra fazenda) · editar/cancelar · cascatas · idempotência · trava de data · repetir com
linhas · totais e custo/ha com as quatro linhas · migration (schema × banco, CHECKs, FKs, RLS) · isolamento por tenant.
