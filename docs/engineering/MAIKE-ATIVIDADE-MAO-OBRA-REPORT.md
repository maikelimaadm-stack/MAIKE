# MAIKE-ATIVIDADE-MAO-OBRA — relatório da Fatia 4 do Lançamento de Atividades

> **fatia 4 · `feat/atividade-mao-obra-servico` · PR (a abrir)**
>
> Decisão **D-PROD-204** · contrato [`MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md`](./MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md) ·
> runbook [`MAIKE-ATIVIDADE-MAO-OBRA-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-MAO-OBRA-RUNBOOK-RELEASE.md)

## 1. O que é

O apontamento do dia fecha o custo com as duas linhas que faltavam: **mão de obra** (funcionário, por hora, diária ou
tarefa) e **serviço de terceiro** (serviço, quantidade e valor, com o parceiro prestador opcional). Entram os dois
cadastros mínimos que elas pedem, por fazenda: **Funcionário** e **Serviço**. O totalizador e o custo por hectare da
atividade passam a somar as quatro linhas (produto, máquina, mão de obra e serviço).

## 2. O que entrou

| Camada | Entrega |
|---|---|
| Banco | `Funcionario`, `Servico`, `AtividadeApontamentoMaoObra` e `AtividadeApontamentoServico`, com FKs compostas pelo tenant (`RESTRICT`), 8 CHECKs, 23 índices começando por `cliente_id` e o RLS de sempre. Nenhuma coluna em tabela antiga. Tabelas 87 → 91 (de tenant, 72 → 76) |
| Migration | `20261114800000_atividade_mao_obra_servico`, **EXPAND** (zero violações no portão). SHA `79f139a0…`, RLS `16d2680d…`. Aplicável antes do merge |
| Cadastros | Funcionário (tipo, cargo, custo por hora e por diária) e Serviço (unidade de medida do cadastro existente, centro de custo padrão, valor de referência), por fazenda, sem DELETE: só inativar e reativar |
| Mão de obra | Hora e diária com o custo do cadastro como snapshot (sem custo no cadastro, a linha entra sem custo); tarefa com custo digitado; exige `permite_mao_obra` |
| Serviço | Unidade como snapshot da sigla da unidade do serviço; valor digitado (a tela sugere o de referência); parceiro opcional, ativo, da mesma fazenda e com o papel `prestador_servico`; exige `permite_servico` |
| Comum | Editar = cancelar e lançar de novo; cascatas do apontamento e da atividade; idempotência por `operation_id`; trava de data; totais e custo por hectare com as quatro linhas |
| Tela | Blocos "Mão de obra" e "Serviços" no apontamento, telas de cadastro Funcionários e Serviços; só componentes que já existem |
| Portão e operação | Pins em `premergeMigrateLib.mjs`, colunas exigidas no preflight de schema, scripts do SQL Editor com as 4 tabelas (76 de tenant, 91 em `public`), contagens 55 / 91 nos testes das migrations anteriores, teste da migration e runbook |

## 3. Agentes

| Agente | Entrega |
|---|---|
| D0 | Mapa somente leitura (cadastros de referência, Parceiros, linhas da Fatia 3, unidade, centro de custo, portão e contagens) |
| D (orquestrador) | Schema, migration e contrato |
| D1 | Cadastros de Funcionário e de Serviço (backend e telas) |
| D2 | Portão da migration (pins, EXPAND), contagens 54 → 55 / 87 → 91, teste da migration, runbook, SQL Editor, governança e este relatório |
| D3 | Backend das linhas de mão de obra e de serviço, cascatas e totais |
| D4 | Telas das linhas, totalizador e repetir |

## 4. Decisões e pontos para o proprietário

1. **Funcionário próprio, não `Usuario`.** `Usuario` é conta de acesso (login e senha obrigatórios), sem custo e por
   cliente. O funcionário é cadastro por fazenda e não entra no sistema. Aprovado antes de implementar.
2. **Prestador do cadastro de Parceiros** (papel `prestador_servico`), só como referência na linha de serviço:
   "sim, vai de acordo com o cadastro de parceiro".
3. **Mesma fazenda do parceiro conferida no código.** A tabela de Parceiros só tem a chave `(cliente_id, id)`; o
   banco garante o cliente, e o serviço confere a fazenda. Apontamento, funcionário, serviço e centro de custo têm a
   mesma fazenda garantida pelo banco.
4. **Sem financeiro e sem folha.** Nenhuma `OperacaoFinanceira`, título ou rateio a partir das linhas; nada de
   salário, encargos, ponto ou pagamento.
5. **Constituição:** a expansão D-PROD-204 no `00` e a nota no `07` foram redigidas pelo agente e **valem só com a sua
   aprovação no merge**.

## 5. Validação (local; o GitHub Actions roda no push)

(preenchida no fim da validação)

## 6. Revisão independente

(preenchida depois da revisão)

## 7. Release

Ainda não aplicada; aguarda o GO do proprietário. A ordem é aplicar antes do merge, pelo runbook.

## 8. Fora do escopo

- Folha de pagamento, salário, encargos, ponto, pagamento, lançamento financeiro, título, rateio e contrato de serviço.
- Abastecimento ligado à atividade: Fatia 5, que vem depois.
