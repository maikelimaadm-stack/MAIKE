# MAIKE — Diário da máquina (backend): runbook de release (D-PROD-323)

> **Estado: `SCHEMA_APPLIED_PROD: SIM` (2026-11-26, caminho B, GO do proprietário, antes do merge da PR #406).**
> Pós-checagem do §2.4 conferida. Registro no §5.

Decisão: [D-PROD-323](./DECISIONS.md) · Migration: `20261127100000_diario_maquina` (EXPAND, sem `--contract`).

## 1. O que muda no banco

| Item | Valor |
|---|---|
| Colunas novas (anuláveis) | `Produto.quantidade_padrao`, `Produto.quantidade_padrao_unidade`, `AtividadeApontamentoProduto.mistura_id`, `AtividadeApontamentoProduto.volume_aplicado` |
| Tabelas novas (tenant primeiro, RLS) | `AtividadeMistura`, `AtividadeMisturaItem`, `AtividadeMisturaMovimento` |
| Natureza | **expand-only**: nada apagado, nada renomeado, nenhum `NOT NULL` em coluna existente, nenhum DML |
| Checksum do arquivo (manifesto) | `b1896a7c2d350fe31a313563f97192bd961db4c9b905b235bbecced90bfc0aeb` |
| Bloco DO de RLS | aprovado por hash (`aad031e7…4b02`) |
| Preflight (`COLUNAS_EXIGIDAS`) | as 4 colunas novas são exigidas: sem a migration o preflight para |

**Por que antes do merge:** o cadastro de produto passa a ler `quantidade_padrao`, e a linha de produto da atividade lê
`mistura_id`. Sem a migration em produção, esses lugares respondem 500. A rota nova da mistura responde 404 (o
servidor de produção não tem a rota). A tela precisa degradar para o fluxo antigo até lá (regra 5 do CONTEXTO).

## 2. Caminho oficial

1. Conferir a `_prisma_migrations` de produção (só leitura): 82 concluídas e 0 abertas, a última
   `20261126300000_sincronizacao_incremental_indices` com o checksum `a1cdcd2f…fc3c`.
2. Rodar o preflight de produção (só leitura) e confirmar que as 4 colunas ainda não existem.
3. Com o GO do proprietário, aplicar pelo caminho oficial do repositório (`scripts/deploy/`, runner de migrations com a
   conexão própria, sem o pooler de transação). Não aplicar à mão, nem por SQL solto.
4. Pós-checagem: 83 concluídas, 0 abertas, o checksum `b1896a7c…aeb`, as 4 colunas e as 3 tabelas existem, RLS ligado nas 3
   tabelas novas.
5. Registrar o resultado neste arquivo (`SCHEMA_APPLIED_PROD: SIM`, data e contagens) e só então fazer o merge.

## 3. Se algo sair do previsto

Parar. Não reaplicar, não editar o checksum, não rodar `DROP` para "limpar". A migration é aditiva: a reversão operacional,
se o proprietário decidir por ela, é o `DROP` das três tabelas e das quatro colunas, feito à parte e com GO.

## 4. Depois da aplicação

A tela (outra tarefa) só liga o Diário da máquina quando a rota `GET /atividades/:id/misturas` responde. Até lá, a tela
mostra o fluxo antigo com o aviso "Diário da máquina ainda não está ligado no servidor".

## 5. Registro

- `SCHEMA_APPLIED_PROD`: SIM.
- Cópia antes de aplicar (só leitura): estrutura (colunas, constraints, índices) e todas as linhas de `Produto` (2) e
  `AtividadeApontamentoProduto` (11), capturadas em 2026-11-26 11:13 UTC, guardadas fora do repositório.
- Preflight em produção (só leitura): `sid` 7692130048193495360, 82 concluídas e 0 ruins, a última
  `20261126300000_sincronizacao_incremental_indices` com `a1cdcd2f…fc3c`, esta não registrada, nenhuma das 4 colunas e
  nenhuma das 3 tabelas existia, 112 tabelas.
- Aplicação (2026-11-26, GO do proprietário: "Sim, pode criar as tabelas no banco e fazer o merge"): **caminho B**
  (conector Supabase, uma única transação com as guardas de alvo, histórico, anterior e tabelas, `lock_timeout` 5 s,
  desvio da D-PROD-74 autorizado como nas anteriores), com o conteúdo integral de `migration.sql` (SHA-256
  `b1896a7c…aeb`) e o registro em `_prisma_migrations`. Ensaiada antes no PostgreSQL local (82 → 83, `migrate status`
  em dia, `migrate diff` vazio).
- Pós-checagem: 83 concluídas e 0 ruins; a nova com `b1896a7c…aeb` e 1 passo; as 4 colunas existem; as 3 tabelas existem
  com RLS ligado (sem FORCE) e 1 política cada; 115 tabelas; linhas de `Produto` e `AtividadeApontamentoProduto`
  inalteradas (2 e 11). `get_advisors` security: sem alerta.
