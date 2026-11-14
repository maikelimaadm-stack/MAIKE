# MAIKE-ATIVIDADE-LINHAS — relatório da Fatia 3 do Lançamento de Atividades

> **fatia 3 · `feat/atividade-itens-produto-maquina` · PR #289**
>
> Decisão **D-PROD-202** · contrato [`MAIKE-ATIVIDADE-LINHAS-CONTRATO.md`](./MAIKE-ATIVIDADE-LINHAS-CONTRATO.md) ·
> runbook [`MAIKE-ATIVIDADE-LINHAS-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-LINHAS-RUNBOOK-RELEASE.md)

## 1. O que é

O apontamento do dia ganha as linhas que geram custo: **produto** (baixa de estoque) e **máquina** (bem, implemento e
medidor). A atividade ganha um totalizador fixo com área, totais por produto e máquina, custo acumulado e custo por
hectare. "Repetir último lançamento" traz as linhas do apontamento anterior.

## 2. O que entrou

| Camada | Entrega |
|---|---|
| Banco | `AtividadeApontamentoProduto`, `AtividadeApontamentoProdutoConsumoLote` e `AtividadeApontamentoMaquina`, com FKs compostas pelo tenant e CHECKs. Colunas anuláveis `BemPatrimonial.custo_uso_unitario` e `TipoPatrimonial.salto_maximo_medidor`. Tabelas 84 → 87 |
| Migration | `20261114600000_atividade_linhas_produto_maquina`, **EXPAND** (zero violações no portão). SHA `e374c81d…`. Aplicável antes do merge |
| Produto | Baixa e estorno pelo motor FIFO do abastecimento: mesma divisão por lote e mesmo custo, conferido em teste. Edição = estorno exato + nova saída. Cancelar o apontamento ou a atividade estorna tudo. Idempotência por `operation_id`, com o recibo conferido antes da versão. Saldo insuficiente com mensagem clara. Combustível recusado (vai pelo abastecimento). `dose_ha` calculada. Data do apontamento travada com linha. Conciliação do estoque lendo as tabelas novas. Lote com fatia de linha imutável |
| Máquina | Medidor vindo do bem e nunca perguntado. Final obrigatória, nunca para trás. Salto acima do teto do tipo do bem pede justificativa. "Sem medidor" aceita horas ou km. Implemento ≠ máquina e só com `permite_implemento`. Custo de uso como snapshot. A leitura fica na linha: a leitura vigente do bem, o abastecimento e o piso do PATCH do bem passam a considerar as linhas, sem gravar `BemPatrimonial.medidor_*` |
| Cadastros | "Custo por hora/km" no bem e "Teto de salto do medidor" no tipo patrimonial (campos numéricos que já existem) |
| Tela | Blocos Produtos e Máquinas dentro de cada apontamento, com janelas de adicionar, editar e cancelar. Favoritos no seletor de produto. Totalizador fixo. "Repetir último lançamento" com as linhas. Envio incerto com "Repetir o mesmo envio" e "Consultar". Só componentes que já existem |

## 3. Agentes

| Agente | Entrega |
|---|---|
| C0 | Mapa do motor FIFO, do medidor, do item antigo (D-PROD-193), da conciliação e da Constituição |
| C1 (orquestrador) / C1g | Schema, migration e contrato / pins do portão, contagens 54 / 87, teste da migration (11), runbook, SQL Editor |
| C2 | Backend do produto, cascatas, totais, opções, conciliação e lote, com testes (20) |
| C3 | Backend da máquina, medidor no cálculo vigente, campos de cadastro, com testes (19 → 20) |
| C4/C5 | Telas (janelas, totalizador, repetir), com smoke (17 + 41) |
| C8/C9 | Revisão única de correção e tenant, com integração real tela ↔ servidor (§6) |

## 4. Decisões e pontos para o proprietário

1. **Leitura do medidor na linha** (padrão do abastecimento), sem gravar no cadastro do bem. Para o usuário, a
   "leitura atual" do bem sobe com o lançamento. Gravar no cadastro exigiria mudar um CHECK de tabela antiga e iria
   contra uma regra do DO-NOT-DO.
2. **Máquina em qualquer tipo de atividade.** Só existe "Exige máquina", que é conferida na abertura.
3. **Salto do medidor** = leitura final − leitura vigente na data, e não só o uso da linha. A revisão achou que uma
   inicial digitada alta pulava o teto.
4. **Limitação conhecida:** no mesmo dia, depois de uma segunda passada (ou de um abastecimento), a primeira passada
   não pode ser corrigida para baixo, porque a regra de data herdada do abastecimento recusa. Nada se corrompe.
   Corrigir pede refazer a série dentro do dia, nas duas pontas; fica para uma fatia futura, se você quiser.
5. **Constituição:** a nota D-PROD-202 no `00` e no `07` (expansão para as linhas, edição por estorno, custo de uso
   como snapshot) foi redigida pelo agente e **aprovada por você** em 2026-11-14 ("autorizo vocÇe").

## 5. Validação (local; o GitHub Actions roda no push)

- `verify-all` (sem o backend): todas as etapas passaram; `test:gates` 921/921; typecheck 0.
- Backend completo em PostgreSQL 16 local: **2049 testes, 0 falhas** (inclui `atividadeLinhaProduto` 20, `atividadeLinhaMaquina` 20,
  `atividadeLinhasMigration` 11 e `atividadeIntegracaoTela` 8).
- GitHub Actions na PR #289 (`3753d222`): verde.

## 6. Revisão independente

- **Corrigido:** o salto do medidor contado da leitura vigente (média).
- **Sem bug em:** estoque (motor, estornos, cascatas, idempotência, travas sem ciclo com o abastecimento,
  conciliação, lote), medidor (nada gravado no bem; abastecimento igual ao de antes sem linhas) e tenant (404 sem
  oráculo, guardas, schemas fechados, decimais só como texto).
- **Integração real tela ↔ servidor** (`atividadeIntegracaoTela`, 8/8):
  - seletores; lançar, editar e cancelar produto e máquina; totais;
  - "repetir" com rede caindo depois da gravação, sem baixa dupla;
  - cascatas;
  - salto com justificativa.
- **Abertos (baixos):**
  - o replay da linha de máquina responde 201 sem `replay: true`;
  - as FKs novas não estão no tradutor de vínculo (o caso não ocorre hoje).

## 7. Release

**Aplicada em produção em 2026-11-14, antes do merge**, com o GO "autorizo vocÇe" (resposta a "aplica e aprova"), pelo
caminho B do runbook. O primeiro envio expirou sem resposta à confirmação do Supabase e não executou; o reenvio foi
pedido com "mande de novo a autorização".

- Preflight: PRONTO PARA APLICAR (53 / 0, anterior com checksum certo, 0 novas, 7 chaves, 84 tabelas, 0 travas).
- Postcheck: **APLICADA E CONFERIDA** (54 / 0, 3 / 0, 87 tabelas, 2 colunas, 9 CHECKs, 17 / 17 FKs, 20 / 20 / 13
  índices, RLS sem FORCE com `maike_backend_all` nas três, 0 grants).
- Merge da PR #289 depois do postcheck; a Vercel publica a `main`.

## 8. Fora do escopo

- Mão de obra, serviço e cadastros de Serviço/Funcionário: Fatia 4.
- Abastecimento ligado à atividade: Fatia 5, que vem depois.
