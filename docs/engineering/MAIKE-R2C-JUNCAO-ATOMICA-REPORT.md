# R2C-P1 — Junção de Lotes atômica com cancelamento causal (D-PROD-104)

- **Missão:** MAIKE-R2C-P1-JUNCAO-DE-LOTES-ATOMICA-CANCELAMENTO-CAUSAL
- **Base:** `main` 04afd25 (merge da #168)
- **PR:** #169 (draft)
- **Migrations:** 0, sem mudança no schema Prisma
- **Produção:** nenhuma leitura nem escrita
- **Colisão de numeração:** durante a missão a #170 (D-PROD-102) e a #171 (D-PROD-103), ambas mobile, foram mergeadas. A main foi incorporada por merge (sem rebase nem force-push), as decisões delas ficaram intactas e esta passou a ser **D-PROD-104** (próxima livre: D-PROD-105). Arquivos da #170/#171 não foram tocados.

## 1. Diagnóstico (RED executado na main 04afd25)

A sonda reproduz, por HTTP autenticado com PostgreSQL real descartável, a **mesma sequência de chamadas** do botão "Confirmar Junção":
1. um PATCH com CAS por lote absorvido;
2. um PATCH com CAS no principal;
3. um POST genérico `tipo: 'Entrada'`, `motivo: 'Junção de Lotes'`.

A falha é injetada como sessão expirada (401) na N-ésima chamada. Evidência em `evidencias/r2c-p1-juncao/red-main-04afd25.txt`; sonda em `red-sonda-legado.test.mjs.txt`.

| Cenário (executado) | Resultado na main |
|---|---|
| Falha na 2ª chamada (PATCH do 2º absorvido) | 40/30/20 = 90 → 40/**0**/20 = **60** (30 cabeças somem) |
| Falha na 3ª chamada (PATCH do principal) | → 40/0/0 = **40** |
| Falha no POST do movimento | saldo 90/0/0, **sem movimento** que o registre |
| Retry com a leitura antiga + reabrir a tela | o PATCH com estado esperado obsoleto foi aceito; **duas "Entrada 90"** (a segunda sem nada absorvido) |
| Peso desconhecido | 40@400 + 30@? + 20@360 → gravou **257,8** (média dos conhecidos: 386,7) |
| Classificação | gravado como **'Entrada'** sem nenhuma entrada de cabeças |
| Comando atômico | `POST /comandos/juncao-lotes` → **404** |

**Da leitura do código (não executado como sonda):**
- a checagem temporal do navegador (`validarOrdemTemporalLotes`, lista limitada a 200) autorizava a escrita;
- o duplo clique concorrente é parcialmente contido pelo CAS (o segundo PATCH do mesmo lote dá 409), mas só depois de gravações parciais.

## 2. Contrato do comando

`POST /movimentacoes-mapa/comandos/juncao-lotes`

```json
{ "operation_id": "rebanho-<uuid>", "empresa_id": "…", "area_id": "…",
  "lote_principal_id": "…", "lote_origem_ids": ["…", "…"],
  "data_movimentacao": "2026-10-30T12:00:00.000Z", "observacoes": "…" }
```

**Transação:**
1. reserva idempotente `manejo_mapa_juncao_lotes`;
2. confere a empresa;
3. `FOR UPDATE` da área, depois dos lotes (da área e os pedidos) em ordem de id;
4. valida tudo no servidor;
5. confere dependência posterior com a consulta completa;
6. grava o principal (soma e peso);
7. grava cada origem (0/Inativo), com uma linha de AuditLog por lote;
8. confere a conservação;
9. grava o movimento e a auditoria do movimento.

Qualquer erro desfaz tudo.

**Invariante:** `principal' = principal + Σ origens`; origens com 0 e status Inativo; o total ativo da área não muda; nenhum lote criado.

**Peso:** média ponderada com 4 casas (`Decimal(14,4)`) só quando todos os pesos são conhecidos; senão `null` (política `desconhecido_sem_media`). A tela avisa antes de confirmar.

## 3. Matriz de casos e códigos

| Caso | Resposta |
|---|---|
| 40+30+20, 1 origem, 5 origens | 201; total conservado |
| Origem duplicada, principal entre as origens, vazio, mais de 20, campo de saldo/peso/tenant/efeito no corpo, data impossível | 400 `REQUEST_VALIDATION_FAILED` |
| Lote zerado/inativo, de outra área | 409 `JUNCAO_LOTE_INELEGIVEL` |
| Lote excluído (#167), inexistente, de outro tenant | 404 `LOTE_NOT_FOUND` |
| Categoria, sexo ou categoria de manejo diferentes; sexo indefinido | 409 `JUNCAO_CLASSIFICACAO_DIVERGENTE` |
| Área de outra empresa ou inexistente | 404 `AREA_NOT_FOUND` |
| Registro ativo posterior em participante (inclusive no meio de 610 cancelados) | 409 `JUNCAO_DATA_RETROATIVA` |
| Só cancelados posteriores (610) | 201 |
| Mesma chave e mesmo conteúdo | 201 com `replay: true`, mesmo movimento |
| Mesma chave e conteúdo diferente | 409 `IDEMPOTENCY_CONFLICT` |
| Falha injetada no 1º/2º/3º efeito ou antes do movimento | 500 e banco inalterado (lotes, movimento, auditoria, reserva) |
| POST genérico: tipo novo, `Entrada` + motivo, marcador `[JUNCAO_LOTES]` | 409 `JUNCAO_SOMENTE_POR_COMANDO` |
| POST genérico com campo `juncao` | 400 (campo reservado) |
| POST genérico `Entrada` legítima | 201 |

## 4. Cancelamento e proveniência

O endpoint é o mesmo da R2A/R2B e reutiliza o planejador da R2B, parametrizado por comando e tipo de operação. O cancelamento exige, nesta ordem:
- administrador ativo;
- operação committed apontando para o movimento;
- `lote_ids` igual aos efeitos;
- AuditLog de cada efeito igual ao pós-estado (saldo, situação, área, empresa, classificação, sexo, peso);
- nenhum registro posterior em nenhum participante (R2A, R2B, vínculos de matrizes, outras fontes);
- nenhuma alteração posterior não explicada (PATCH, ida e volta);
- estado atual igual ao pós-estado.

Restaura todos os lotes juntos, inclusive o peso `null`. Testes:

| Caso | Resultado |
|---|---|
| Usuário comum | `TENANT_ADMIN_REQUIRED` |
| 2º cancelamento | `CANCELAMENTO_JA_REALIZADO`, sem mutação dupla |
| Morte posterior no principal | `CANCELAMENTO_DEPENDENCIA_POSTERIOR` |
| Pesagem R2B posterior | `CANCELAMENTO_DEPENDENCIA_POSTERIOR` |
| Ida e volta de peso por PATCH | `CANCELAMENTO_ALTERACAO_POSTERIOR` |
| Operação de outro movimento | `CANCELAMENTO_EFEITO_NAO_COMPROVADO` |

Junções legadas (`Entrada` + motivo ou marcador) **não** viram canceláveis; a tela mostra "Junção antiga… não pode ser cancelada com segurança".

## 5. Histórico e exclusão (#167)

- O histórico por lote encontra a junção pelo principal e por **cada** absorvido (`movimentoCitaLotes`: `lote_ids` e efeitos), com cursor e total corretos; o histórico da área também.
- Com a junção ativa, todos os participantes ficam `bloqueado`/`movimentacao_ativa`, sem exclusão física.
- Depois do cancelamento comprovado, cada participante no estado de entrada vai para `exclusao_logica` e a linha é preservada. O histórico mostra a junção como cancelada.

## 6. Frontend

- O diálogo "Juntar Lotes" chama só `enviarJuncaoLotes`, que vai para `POST /comandos/juncao-lotes`.
- Saíram do fluxo: o PATCH em loop, o PATCH do principal, o `criarMovimentacao` genérico e o snapshot em observações.
- Prévia marcada "o servidor confere tudo ao confirmar"; aviso de peso desconhecido; botão "Juntando…".
- O diálogo não fecha enquanto envia.
- Envio só online. A chave idempotente fica persistida por tenant, usuário, tipo, empresa e área enquanto o resultado é desconhecido.
- Sucesso dispara `atualizar-mapa` com lotes, movimentos e histórico. Erro 409 mostra a mensagem do código e mantém o diálogo aberto.

## 7. Testes

| Suíte | Resultado |
|---|---|
| `r2cP1JuncaoLotes` (PostgreSQL real, HTTP) | **31/31** |
| `npm run test:backend` | 746 testes, 741 pass, 0 fail (5 todo) |
| Smoke R2B/R2C | 24/24 (5 novos de junção) |
| E2E 1440/768/412/390 | 18 verificações por largura; ver `e2e-*.txt` |

**Concorrência real (3 rodadas cada):**
- duas junções com origem compartilhada → uma 201 e uma 409, total conservado;
- junção × morte na origem → conservação exata;
- junção × transferência da origem → nunca as duas;
- junção × DELETE da origem → sem exclusão órfã;
- cancelar junção × pesagem do principal → nunca reverte por cima.

Nenhum 500 nem deadlock.

**E2E:** o menu do Radix anima ao abrir. Em 390, um toque com `force` caiu no item vizinho ("Mover"). Causa e correção: itens de menu passaram a ser tocados **sem** `force`, para o Playwright esperar o fim da animação. Depois disso, 3 rodadas seguidas em 390 deram 18/18, sem segundo toque. O app não mudou.

## 8. Riscos residuais

- Sem sincronização offline: offline, a junção fica indisponível.
- **Peso `null` depois de junção com peso desconhecido:** a média precisa de uma nova pesagem. É escolha de segurança: não se inventa média.
- Junções legadas continuam como estão: tipo 'Entrada', não canceláveis.
- O teto de 20 lotes absorvidos por confirmação cobre os lotes de uma área e categoria. Acima disso, fazer em mais de uma confirmação.
