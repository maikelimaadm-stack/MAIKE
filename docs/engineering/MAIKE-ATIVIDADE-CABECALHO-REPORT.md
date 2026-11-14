# MAIKE-ATIVIDADE-CABECALHO — relatório da Fatia 2 do Lançamento de Atividades

> **fatia 2 · `feat/atividade-cabecalho` · PR #285**
>
> Decisão **D-PROD-200** · contrato [`MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md`](./MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md) ·
> runbook [`MAIKE-ATIVIDADE-CABECALHO-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-CABECALHO-RUNBOOK-RELEASE.md)

## 1. O que é

O lançamento passa a ter dois níveis. A **Atividade** é o cabeçalho aberto, por exemplo "Cigarrinha Pasto 01". Cada
**AtividadeApontamento** é o lançamento de um dia ou turno, e a sequência 1, 2… no mesmo dia e turno são as
passadas. O apontamento de linha única (D-PROD-190) e os itens dele (D-PROD-193) saem.

Tudo o que vem do cabeçalho é herdado e travado no apontamento:
- do tipo (snapshot, nunca relido): centro de custo, centro de resultado e unidade de produção;
- da área: o setor;
- do próprio cabeçalho: safra e máquina.

## 2. O que entrou

| Camada | Entrega |
|---|---|
| Banco | `Atividade` e `AtividadeApontamento`, com FKs compostas pelo tenant (RESTRICT), CHECKs das listas fechadas e do status com data, e unique das passadas `NULLS NOT DISTINCT`. Saem as 3 tabelas antigas. Tabelas 85 → 84 |
| Migration | `20261114500000_atividade_cabecalho`, **CONTRACT** com conversão (sétima entrada fechada; formato novo do portão: guarda → EXPAND → conversão pinada → DROP no fim). A guarda trava as 3 antigas antes de conferir. Os 2 registros de teste viram 2 atividades com 1 apontamento cada (mesmo número; ids `atv_<id>` e o id antigo). Nada é descartado. SHA `c288cf47…1feb` |
| Portão | `conversao` em `MIGRATIONS_CONTRACT_APROVADAS`; rótulo do `premerge-migrate` com as conversões; preflight de schema exige as 2 tabelas novas |
| API | `/atividades` (lista keyset, detalhe, abrir, editar, concluir, reabrir, cancelar, duplicar), `/atividades/:id/apontamentos` (lista, detalhe, lançar, editar, cancelar, repetir) e `/atividades-opcoes/{bens,operadores}`. Erros `ATIVIDADE_*`. Exclusão de cadastro usado por atividade → 409 (tradutor de vínculo ancorado; nunca o 403 da #259) |
| Permissões | Tela `op-atividades` ("Lançamento de Atividades"). Ações padrão para a atividade. Ações extras `lancar_apontamento`, `editar_apontamento`, `cancelar_apontamento` e `reabrir` (as permissões `op-atividade-apontamentos` e `op-atividade-reabrir` do pedido). Sem concessão automática |
| Tela | Lista com status e área executada / planejada; ações por permissão e status; cabeçalho só leitura com os herdados; apontamentos por dia; formulário do dia (data, turno, operador, área do dia, produção, observação). Só componentes que já existem |
| Saiu | Módulo, tela, porta, serviço, regras, permissões e testes do apontamento antigo; o ramo do lote de estoque que contava as fatias dos itens |

## 3. Agentes

| Agente | Entrega |
|---|---|
| B0 | Mapa do módulo antigo: 9 riscos, entre eles permissões fora do menu, 403 enganoso nas exclusões e 500 no lote |
| B1 | Formato "conversão" no portão, 7ª entrada, teste da migration em PostgreSQL real (28), runbook, SQL Editor, testes das CONTRACT anteriores. Achou e corrigiu a corrida da guarda |
| B2a / B2b / B3 | Fundação comum, erros, guardas e tradutor de vínculo; cabeçalho; apontamentos |
| B4 / B5 | Porta, serviço, permissões, menu e página; formulários e apontamentos por dia |
| B6a / B6b / B1b | Testes de backend (33 + 20), smoke (40) e conferência das CONTRACT antigas |
| B7/B8 | Revisão única de correção e segurança/tenant, com a integração real tela ↔ servidor (§6) |

## 4. Decisões e pontos para o proprietário

1. **Máquina no cabeçalho (`bem_id`)**, fora da lista do pedido. Sem ela, "Exige máquina" não dá para conferir na
   abertura, e os 2 registros antigos perderiam a máquina. As linhas de máquina por dia, com medidor, chegam na
   Fatia 3.
2. **`unidade_producao_sigla`** (snapshot). Os registros antigos usam KM e HA, que não existem no cadastro de
   unidades do cliente.
3. **Permissões como ações extras** na linha de `op-atividades`. A tela Permissões só desenha páginas do menu e as
   extras delas. As concessões antigas `op-apontamentos-atividade` ficam inertes: usuários comuns precisam de nova
   concessão (administrador da fazenda e `is_admin` têm tudo).
4. **"Repetir" abre o formulário já preenchido** (data de hoje). Sem ajuste, duplica; com ajuste, lança. Isso evita
   gravar sem querer um lançamento que depois exige cancelamento com motivo.
5. **Cancelar só com a atividade ABERTA**; uma concluída precisa ser reaberta antes. Cancelada é final.
6. **Área executada e produção do cabeçalho** = soma dos apontamentos confirmados, sempre (regra do pedido). A
   conclusão não digita área.
7. **Constituição não alterada.** A expansão D-PROD-193 (itens do apontamento) fica histórica. A nota que atualiza a
   exceção de estoque para as linhas novas vem na Fatia 3, para sua aprovação.
8. **Máquina da atividade**: só bens de natureza máquina, veículo ou equipamento, como a tela antiga.

## 5. Validação (local; o GitHub Actions da conta não roda)

| Etapa | Resultado |
|---|---|
| Backend completo (`npm run test:backend`) | 150 arquivos, 1978 testes: **1973 ok**, 5 `todo` (os do ledger L2, anteriores), **0 falhas** |
| `test:gates` (portão e runner incluídos) | 915/915 |
| Smoke completo | 230 arquivos, 2845/2845 |
| Migration em PostgreSQL real | 28/28: conversão na forma exata dos 2 registros de produção, cada recusa da guarda, corrida, `NULLS NOT DISTINCT`, RLS, `migrate diff` vazio |
| Typecheck do backend / tipos do front / lint / build | zero diagnósticos / 614 ≤ 625 / 0 erros / ok |

## 6. Revisão independente

(preenchida ao fim da revisão)

## 7. Release

(preenchida na aplicação)

## 8. Fora do escopo

- Produto e máquina por dia, com estoque FIFO e medidor: Fatia 3.
- Mão de obra, serviço e os cadastros novos: Fatia 4.
- Abastecimento ligado à atividade: Fatia 5, que vem depois.
- `ORIGEM_APONTAMENTO` no motor de estoque e a reconciliação protegida por `to_regclass` ficam como código morto
  inofensivo até a Fatia 3.
