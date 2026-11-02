# MAIKE-R2D-P1 — Morte e Abate multi-lote por comando atômico (D-PROD-105)

- **Base:** main `52bc804` (merge da PR #169, D-PROD-104).
- **Branch:** `claude/r2d-p1-baixas-multilotes`.
- **PR:** uma PR nova, em DRAFT.
- **Migrations:** 0. O schema Prisma não mudou; o movimento usa os campos JSON reservados já existentes (`lote_ids`, `linhas`, `efeito_servidor`).
- **Produção:** não tocada. Tudo roda em PostgreSQL 16 local descartável, com dados sintéticos.

## 1. Diagnóstico (RED na main 52bc804)

`DetalhesLote.handleMorte/handleAbate` percorria os lotes da categoria e fazia um `registrarManejoLote` (comando R2A, uma transação) por lote. `backend/tests/r2dP1BaixasRed.test.mjs` reproduz esse laço exatamente: ordem da tela, `quantidadeAplicavel`, saldo lido na renderização e chave por envio + lote.

| Caso | Resultado na main |
|---|---|
| R0 `POST /comandos/baixa-rebanho` | 404 (não existe) |
| R1 Morte 60 em 40+30+20, rede cai na 2ª chamada | **40 baixadas** (L40 0/Inativo), 1 movimento, a tela mostra erro |
| R2 Abate 60, 2º lote excluído entre a tela e o envio | **40 baixadas**, 2ª chamada 404 `LOTE_NOT_FOUND` |
| R3 Morte 80, 3º lote inativado entre a tela e o envio | **70 baixadas**, 2 movimentos, 3ª chamada 409 |
| R4 duplo clique (dois envios com chaves diferentes) | 30 baixadas uma vez, porque a trava R2A serializou; o 2º envio vira erro 409 na tela |
| R5 timeout + reenvio pelo usuário | **40 baixadas** e o reenvio dá 409 `MANEJO_ESTADO_INVALIDO` (saldo da tela velho) |
| R6 100 pedidas com 90 disponíveis | **baixa 90 e "sucesso"**; as 10 restantes são ignoradas em silêncio |

- Evidência: `evidencias/r2d-p1-baixas-multilotes/red-main.txt`, com ANTES/DEPOIS de saldos, movimentos, auditorias e reservas.
- O laço legado é não atômico por natureza. A correção é a tela não usá-lo mais. Por isso a suíte RED fica em `skip` no CI e roda com `R2D_RED=1`.

## 2. Contrato

`POST /movimentacoes-mapa/comandos/baixa-rebanho` (autenticado, `additionalProperties: false`):

```json
{
  "operation_id": "…",
  "tipo": "Morte" | "Abate",
  "empresa_id": "…",
  "area_id": "…",
  "data_movimentacao": "2026-10-30T12:00:00.000Z",
  "observacoes": "…",
  "lotes_selecionados": ["…"],
  "linhas": [
    { "categoria": "Boi 25 a 36 meses", "quantidade": 60, "causa_morte": "Doença" },
    { "categoria": "…", "quantidade": 5, "peso_vivo_total_kg": 2400, "peso_carcaca_total_kg": 1300, "destino": "Frigorífico", "destino_nome": "…" }
  ]
}
```

- **Por que `linhas`:** os formulários permitem várias categorias, e a mesma categoria com causa ou destino diferente, numa só confirmação. Um único `categoria`/`quantidade` no topo continuaria dividindo a confirmação em vários POSTs.
- **Recusado pelo schema (400):** saldo, lote alvo, distribuição, tenant, autor, `efeito_servidor`, `lote_ids`, `situacao`, `usuario_responsavel`.
- **`lotes_selecionados`** (opcional) é a lista dos lotes que a tela mostrava; o mapa pode estar filtrado.
  - Funciona só como filtro.
  - Cada id é relido sob trava.
  - Lote inelegível não entra na conta.
  - Id de outro tenant ou empresa dá 404.
- **Resposta:** `201 {movimentacao, lotes, replay}`.

| Código | HTTP | Quando |
|---|---|---|
| `REQUEST_VALIDATION_FAILED` | 400 | forma inválida, data impossível, causa ou destino fora da lista, campo de abate na morte (e vice-versa), carcaça > vivo, peso > 3000 kg/cab |
| `EMPRESA_NOT_FOUND` / `AREA_NOT_FOUND` / `LOTE_NOT_FOUND` | 404 | outro tenant, empresa ou área, ou id selecionado alheio |
| `BAIXA_SALDO_INSUFICIENTE` | 409 | soma pedida por categoria > disponível nos lotes elegíveis (`disponivel`, `pedido`) |
| `BAIXA_CLASSIFICACAO_DIVERGENTE` | 409 | categoria oficial com lote de sexo contrário |
| `BAIXA_DATA_RETROATIVA` | 409 | registro ativo posterior num participante |
| `IDEMPOTENCY_CONFLICT` | 409 | mesma chave com conteúdo diferente |

## 3. Alocação e saldos

- **Elegível:** lote da área e da empresa, `Ativo`, não excluído, com saldo > 0 e da categoria da linha (comparação sem acento e sem caixa).
- **Ordem determinística:** `numero_lote` numérico crescente, depois texto ou vazio, depois `id`. Fica gravada como `baixa.politica_alocacao = numero_lote_crescente_depois_id`.
- **Linhas da mesma categoria** dividem o saldo na ordem em que aparecem.
- **Cada participante** é gravado uma vez, com uma auditoria, mesmo quando várias linhas o usam.
- **Zerado → `Inativo`.** Nunca é apagado.
- **Peso médio, entrada, origem, identificação e Cadastro:** intactos. Nenhum lote é criado; o movimento nunca é `Entrada`.
- **Invariante:** total antes − total depois = total pedido.
- **Movimento:**
  - `lote_id` = primeiro participante;
  - `lote_ids` = participantes;
  - `linhas[].distribuicao` com `{lote_id, nome, numero_lote, quantidade}`;
  - `baixa.lotes` com saldo antes/depois e status.
- **Na tela:** o toast mostra a distribuição final do servidor e o histórico descreve as linhas. A tela não estima.

## 4. Metadados de Morte e Abate

- **Morte:** `causa_morte` é obrigatória e vem da lista do formulário.
- **Abate:**
  - `peso_vivo_total_kg` e `peso_carcaca_total_kg` são **totais da linha**, como digitados, e ficam na linha;
  - nunca são multiplicados nem rateados por lote;
  - campo vazio não vira zero;
  - `destino` vem da lista; `destino_nome` é obrigatório onde o formulário o exige.

## 5. Atomicidade, idempotência e concorrência

- **Ordem dentro de uma transação:**
  1. reserva idempotente `manejo_mapa_baixa_rebanho` com fingerprint canônico;
  2. trava da área e depois de todos os lotes da área (e dos selecionados), em ordem de id — mesma ordem de R2B/R2C e sem ciclo com R2A ou #167;
  3. releitura e validação;
  4. guarda temporal;
  5. efeitos;
  6. movimento.
- **Falha injetada** no 1º, 2º ou 3º efeito, ou antes do movimento → 500 e **nada** gravado, nem a reserva.
- **Replay** da mesma chave → mesma resposta, sem nova baixa.
- **Mesma chave com outro conteúdo** → 409.

## 6. Cancelamento

- **Endpoint:** o mesmo (`POST /movimentacoes-mapa/:id/cancelamento`), só para administrador ativo do tenant e idempotente.
- **Roteamento:** `planejarCancelamento` envia Morte/Abate com `efeito_servidor.comando = manejo_mapa_baixa_rebanho` para o planejador certificado R2B/R2C (`planejarCancelamentoRebanho`). Ele exige:
  - proveniência: operação `committed` que aponta para o movimento;
  - `lote_ids` igual aos efeitos;
  - auditorias-âncora iguais ao pós-estado;
  - dependências posteriores;
  - nenhuma alteração posterior, inclusive ida e volta;
  - estado atual = pós-estado.
- **Reversão:** todos os participantes voltam juntos, inclusive status `Ativo`; o peso é preservado.
- **Recusa 409:** nada muda.
- **Morte/Abate legados** (POST genérico) continuam sem cancelamento, com mensagem clara. **R2A individual** continua pelo caminho antigo.
- `COMANDOS_CERTIFICADOS` inclui o comando de baixa, para explicar alterações em cancelamentos de outros movimentos.

## 7. Histórico e #167

- **Histórico** por lote e por área: o vínculo estrutural `movimentoCitaLotes` já cobre `lote_ids` e `efeitos`. A baixa aparece em cada participante e não aparece em lote que não participou; total e paginação estão íntegros.
- **#167:**
  - participante de baixa ativa: elegibilidade `bloqueado / movimentacao_ativa`, e `DELETE` dá 409;
  - depois do cancelamento: `exclusao_logica` e `DELETE` 204, com o histórico preservado como `cancelado`.

## 8. Frontend (Web)

- **Formulários:**
  - `FormularioMorte` e `FormularioAbate` chamam `onSubmit` **uma vez** com `linhas`, e não mais um `forEach` por categoria;
  - o botão fica desabilitado ("Registrando…") durante o envio.
- **`DetalhesLote`:**
  - `handleMorte` e `handleAbate` chamam `executarBaixa`, com trava síncrona (`useRef`) contra duplo clique antes da renderização;
  - não há mais laço de `registrarManejoLote` nem o fallback `criarMovimentacao` + `atualizarLote`.
- **`enviarBaixaRebanho`:**
  - online-only, com pendência idempotente por tenant + usuário + tipo + empresa + área;
  - offline recusa antes de qualquer requisição, sem fila;
  - recusa definitiva limpa a pendência;
  - resultado desconhecido mantém a chave para o reenvio do mesmo conteúdo.
- **Erros:** o diálogo continua aberto com a mensagem.
- **Cancelamento na tela:** `situacaoMovimento` reconhece a baixa agregada certificada para oferecer o botão; o servidor decide.
- **Escopo preservado:** layout e componentes não mudaram; Transferência e suplementação não foram tocadas.

## 9. Testes

**`r2dP1BaixasMultilotes.test.mjs`: 42/42.**

| Grupo | Casos |
|---|---|
| Saldos e alocação | B1 Morte 60 → 0/10/20 e cancelar → 40/30/20 (3 auditorias, 1 movimento, 1 reserva) |
| | B2 Abate com metadados totais |
| | B3 1, 2 e 3 lotes |
| | B4 excedente, sem lote, duas linhas excedendo |
| | B5 inativo, excluído, outra área, outra empresa e outro tenant fora da conta |
| | B5b seleção como filtro |
| | B6 sexo divergente |
| | B7 mesma categoria em duas linhas |
| | B8 duas categorias numa confirmação |
| | B9 política determinística (unidade) |
| Atomicidade e contrato | A1 falha injetada 1/2/3/antes do movimento → rollback total |
| | A2 replay e conflito |
| | A3 23 formas inválidas ou reservadas → 400 sem gravação |
| | A4 tenant, empresa ou área alheios → 404; sem token → 401 |
| | A5 POST genérico com campos reservados → 400 |
| Data | D1 posterior ativo bloqueia; não participante, mesmo dia e cancelado não bloqueiam |
| | D2 data impossível registrada depois bloqueia |
| | D3 610 cancelados + 1 ativo |
| Cancelamento | X1 só admin, replay, segundo cancelamento |
| | X2 pesagem posterior bloqueia; cancelada a pesagem, cancela |
| | X3 ida e volta e estado divergente recusam |
| | X4 legado e R2A individual |
| Histórico e #167 | H1 histórico por lote e área |
| | H2 bloqueio e exclusão após cancelamento |
| Concorrência (3 rodadas cada) | K1 duas baixas disputando saldo |
| | K2 baixa × transferência |
| | K3 baixa × junção |
| | K4 baixa × DELETE |
| | K5 cancelar × pesagem |
| | K6 confirmação duplicada paralela com a mesma chave |

Sem cabeça fantasma, 500 inesperado ou deadlock.

**Frontend smoke `r2dBaixasMultilotes.test.js`: 9/9.**
- corpo único com várias categorias;
- pesos totais;
- offline sem requisição;
- pendência e replay;
- mensagens;
- DetalhesLote sem laço legado;
- formulários com envio único;
- cancelamento só com proveniência;
- histórico legível.

**E2E Chromium (Web responsivo) em 1440, 768, 412 e 390:** 19 checagens por largura, 76/76 no total.
- Morte por formulário real com duplo toque → 1 POST, sem `manejo-lote`, PATCH `/lotes` ou POST genérico;
- distribuição em 2 lotes;
- histórico com a distribuição;
- cancelamento pela UI devolvendo o conjunto;
- Abate com peso total e destino;
- 409 de data retroativa com o diálogo aberto e nada alterado;
- offline sem requisição e sem fila;
- sem overflow;
- sem erro de página.

Safari real não foi testado; o E2E roda em Chromium com emulação de toque.

## 10. Riscos residuais

- **POST genérico `Morte`/`Abate`** continua aceito como registro sem efeito em saldo e sem proveniência, portanto sem cancelamento. Bloqueá-lo exige mapear outros consumidores e fica para fatia própria.
- **Política de alocação:** é determinística (`numero_lote`), mas pode diferir da ordem visual antiga da tela. A distribuição real aparece no sucesso e no histórico.
- **Lote de sexo contrário** na categoria oficial bloqueia a baixa da categoria inteira, até a correção do cadastro. É fail-closed.
- **Data:** a guarda temporal no servidor é mais estrita que a validação antiga da tela. Registro sem data confiável lançado depois bloqueia baixa retroativa, pela mesma semântica de D-PROD-104.
- **Transferência multi-lote** continua com o laço por lote no navegador; será outra fatia.
