# MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO — contrato do ajuste da Fatia 4

> **fatia 4 (ajuste) · `feat/atividade-mao-obra-parceiro` · PR (a abrir)**
>
> Decisão **D-PROD-208** (ajusta a D-PROD-207). Pedido do proprietário: "o cadastro de funcionários deveria ser lá em
> parceiros, outra coisa, eu também tenho mão de obra com terceiros não apenas com funcionários, tipo assim, lá já tenho
> as opções papeis do parceiro, só iria incluir quando eu escolher o funcionário os dados dele". Plano aprovado: "sim
> pode fazer". Base: a Fatia 4 (D-PROD-207), em produção, com `Funcionario` e `AtividadeApontamentoMaoObra` vazias.

## 1. Modelo

- **`Fornecedor` (parceiro)** ganha 4 colunas anuláveis, sem DEFAULT, usadas só com o papel `funcionario`:
  `funcionario_tipo` (`MENSALISTA | DIARISTA | TAREFEIRO`), `funcionario_cargo` (até 120), `funcionario_custo_hora` e
  `funcionario_custo_diaria` (Decimal 14,4, ≥ 0). CHECK `Fornecedor_funcionario_check`. Enviar qualquer uma sem o papel
  nos papéis finais → 422 `PARCEIRO_FUNCIONARIO_SEM_PAPEL`; tirar o papel limpa as 4.
- **`AtividadeApontamentoMaoObra`**: sai `funcionario_id` (com a FK e o índice); entram `parceiro_id` (FK composta
  `(cliente_id, parceiro_id) → Fornecedor(cliente_id, id)`, `RESTRICT`; índice `(cliente_id, parceiro_id)`) e `origem`
  (`FUNCIONARIO | TERCEIRO`, CHECK `AtividadeApontamentoMaoObra_origem_check`), ambos `NOT NULL`.
- **Sai** a tabela `Funcionario` (vazia em produção), a tela Funcionários e as rotas `/funcionarios`.

## 2. Regras

1. A `origem` é decidida pelo **servidor** a partir do parceiro novo: ativo, da mesma fazenda e com o papel
   `funcionario` → `FUNCIONARIO` (com os dois papéis, vale funcionário); senão com `prestador_servico` → `TERCEIRO`;
   qualquer outro caso (inexistente, outro tenant, outra fazenda, inativo, sem os papéis) → a mesma recusa 422
   `ATIVIDADE_LINHA_INVALIDA` (`field: parceiro_id`, `reason: parceiro_invalido`), sem oráculo. A mesma fazenda do
   parceiro é conferida no código (`FOR SHARE`); o banco só garante o tenant.
2. **Funcionário:** `HORA` e `DIARIA` copiam `funcionario_custo_hora`/`funcionario_custo_diaria` como snapshot (o corpo
   não aceita `custo_unitario`; sem custo no papel, a linha entra sem custo); `TAREFA` pede o custo digitado.
3. **Terceiro:** o custo é **sempre** digitado (`custo_unitario` obrigatório, ≥ 0), em qualquer medida.
4. **Edição** (cancelar e lançar de novo): o parceiro mantido fica com a `origem` gravada, mesmo se depois perdeu o
   papel ou foi inativado; mantidos o parceiro e a medida, o custo gravado fica e só o total é recalculado; trocar só
   o parceiro mantém o custo digitado gravado e descarta o snapshot. A correção da unidade do serviço mantida na
   edição (apontada pelo Codex na PR #294) continua.
5. **Auditoria do parceiro:** `funcionario_tipo` e os 2 custos entram como valor; o cargo só como
   `tem_funcionario_cargo`.
6. **Fora**, como na D-PROD-207: folha (D-PROD-02), salário, encargos, ponto, pagamento, financeiro, título, rateio.

## 3. API

| Ponto | Chaves |
|---|---|
| Corpo da linha de mão de obra (criar, editar, `mao_obra[]` do lançamento) | `parceiro_id`, `tipo_medida`, `quantidade`, `custo_unitario` (só tarefa do funcionário e terceiro), `observacao`, `operation_id` |
| Leitura da linha | `parceiro { id, nome, funcionario_tipo, funcionario_cargo, funcionario_custo_hora, funcionario_custo_diaria }` e `origem` |
| Totais da atividade | `mao_obra [{ parceiro_id, nome, origem, tipo_medida, quantidade, custo_total }]` |
| Seletor | `GET /atividades-opcoes/mao-obra` (parceiros ativos da fazenda com papel `funcionario` ou `prestador_servico`); o `/atividades-opcoes/funcionarios` saiu |
| Parceiros | `funcionario_tipo`, `funcionario_cargo`, `funcionario_custo_hora`, `funcionario_custo_diaria` no corpo e na leitura |

## 4. Migration e release

`20261116000000_mao_obra_parceiro`, **CONTRACT condicionado a tabelas vazias** (entrada em
`MIGRATIONS_CONTRACT_APROVADAS`, decisão `D-PROD-208`, `drop_no_fim`): guarda pinada (trava `Funcionario` e
`AtividadeApontamentoMaoObra` em `ACCESS EXCLUSIVE` e aborta com qualquer linha) → 12 instruções pinadas em tabela
antiga → o índice novo → `DROP TABLE "Funcionario"` por último. SHA-256
`65a8a4eb8abc7b44e24d3121605a375fee34ea88968bffe875c53b30e9cf9dd0`. Produção 58 → 59 migrations, 95 → 94 tabelas (de
tenant, 80 → 79). Aplicar **antes** do merge e mergear logo em seguida; o Instant Rollback deixa de ser seguro depois.
Só com o GO escrito do proprietário: [runbook](./MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-RUNBOOK-RELEASE.md).
