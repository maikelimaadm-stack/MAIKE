# MAIKE-ATIVIDADE-MAO-OBRA — relatório da Fatia 4 do Lançamento de Atividades

> **fatia 4 · `feat/atividade-mao-obra-servico` · PR #294**
>
> Decisão **D-PROD-207** · contrato [`MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md`](./MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md) ·
> runbook [`MAIKE-ATIVIDADE-MAO-OBRA-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-MAO-OBRA-RUNBOOK-RELEASE.md)

## 1. O que é

O apontamento do dia fecha o custo com as duas linhas que faltavam: **mão de obra** (funcionário, por hora, diária ou
tarefa) e **serviço de terceiro** (serviço, quantidade e valor, com o parceiro prestador opcional). Entram os dois
cadastros mínimos que elas pedem, por fazenda: **Funcionário** e **Serviço**. O totalizador e o custo por hectare da
atividade passam a somar as quatro linhas (produto, máquina, mão de obra e serviço).

## 2. O que entrou

| Camada | Entrega |
|---|---|
| Banco | `Funcionario`, `Servico`, `AtividadeApontamentoMaoObra` e `AtividadeApontamentoServico`, com FKs compostas pelo tenant (`RESTRICT`), 8 CHECKs, 23 índices começando por `cliente_id` e o RLS de sempre. Nenhuma coluna em tabela antiga. Tabelas 91 → 95 (de tenant, 76 → 80) |
| Migration | `20261115900000_atividade_mao_obra_servico`, **EXPAND** (zero violações no portão). SHA `79f139a0…`, RLS `16d2680d…`. Aplicável antes do merge |
| Cadastros | Funcionário (tipo, cargo, custo por hora e por diária) e Serviço (unidade de medida do cadastro existente, centro de custo padrão, valor de referência), por fazenda, sem DELETE: só inativar e reativar |
| Mão de obra | Hora e diária com o custo do cadastro como snapshot (sem custo no cadastro, a linha entra sem custo); tarefa com custo digitado; exige `permite_mao_obra` |
| Serviço | Unidade como snapshot da sigla da unidade do serviço; valor digitado (a tela sugere o de referência); parceiro opcional, ativo, da mesma fazenda e com o papel `prestador_servico`; exige `permite_servico` |
| Comum | Editar = cancelar e lançar de novo; cascatas do apontamento e da atividade; idempotência por `operation_id`; trava de data; totais e custo por hectare com as quatro linhas |
| Tela | Blocos "Mão de obra" e "Serviços" no apontamento, telas de cadastro Funcionários e Serviços; só componentes que já existem |
| Portão e operação | Pins em `premergeMigrateLib.mjs`, colunas exigidas no preflight de schema, scripts do SQL Editor com as 4 tabelas (80 de tenant, 95 em `public`), contagens 58 / 95 nos testes das migrations anteriores, teste da migration e runbook |

## 3. Agentes

| Agente | Entrega |
|---|---|
| D0 | Mapa somente leitura (cadastros de referência, Parceiros, linhas da Fatia 3, unidade, centro de custo, portão e contagens) |
| D (orquestrador) | Schema, migration e contrato |
| D1 | Cadastros de Funcionário e de Serviço (backend e telas) |
| D2 | Portão da migration (pins, EXPAND), contagens 57 → 58 / 91 → 95, teste da migration, runbook, SQL Editor, governança e este relatório |
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
5. **Constituição:** a expansão D-PROD-207 no `00` e a nota no `07` foram redigidas pelo agente e **valem só com a sua
   aprovação no merge**.

## 5. Validação (local; o GitHub Actions roda no push)

- Backend completo em PostgreSQL 16 local: 2145 testes, 0 falhas (antes dos merges da `main`).
- Depois do último merge (`1e47c262`): `test:gates` 933/933, typecheck e lint sem erro, `verify-all` (sem backend) todo verde,
  `scripts/tests/deploy` 205/205; backend da fatia: `atividadeLinhaMaoObra` 18, `atividadeLinhaServico` 11,
  `funcionarioServicoNativo` 28, `atividadeIntegracaoTela` 12, `atividadeMaoObraMigration` 11 — todos verdes.
- GitHub Actions na PR #294: verde.

## 6. Revisão independente

- **Correção (D6):** sem achado alto. Corrigidos: custo da mão de obra mantido na edição (snapshot), PATCH sem mudança
  recusado (`sem_alteracao`), chave do totalizador por serviço e unidade, chaves de idempotência exatas.
- **Segurança (D7):** sem achado crítico, alto ou médio. Corrigidos: travas contra inativação concorrente, buscas literais
  nos cadastros, busca de prestadores só por nome.
- **Integração real tela ↔ servidor (D5):** 12 casos; um desalinhamento da prévia do custo na edição, corrigido.
- **Abertos (baixos):** a unidade do serviço é relida do cadastro na edição; o custo por hora/diária aparece no seletor
  para quem só vê atividades (decisão do proprietário).

## 7. Release

Aplicada em produção em 2026-11-15 às 19:58:35 UTC, antes do merge, pelo caminho B do runbook, com o GO do proprietário ("Aplica e aprova"; depois "pode seguir", "sim ele já fez isso já liberou pode continuar" e "mande de novo por favor"). Três outras migrations entraram em produção durante a espera (Formulações, leitura de cocho, faixa de tolerância); a cada vez a guarda recusou sem gravar nada, e a fatia foi renumerada e mesclada. Preflight: 57 / 0, anterior `20261115200000_formulacao_faixa_tolerancia` (`bb8be379…`), 0 tabelas novas, 91 tabelas. Postcheck: 58 / 0, checksum `79f139a0…`, 4 tabelas novas, 95 tabelas, 8 CHECKs, 17 FKs RESTRICT validadas, 23 índices, RLS sem FORCE e `maike_backend_all` nas 4, 0 grants para anon/authenticated/PUBLIC.

## 8. Fora do escopo

- Folha de pagamento, salário, encargos, ponto, pagamento, lançamento financeiro, título, rateio e contrato de serviço.
- Abastecimento ligado à atividade: Fatia 5, que vem depois.
