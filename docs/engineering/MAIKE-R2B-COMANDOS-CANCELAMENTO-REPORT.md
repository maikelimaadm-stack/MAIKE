# R2B-P1 — Nascimento, Pesagem e Mudança de Categoria: comando atômico e cancelamento causal (D-PROD-101)

- **Missão:** MAIKE-R2B-P1-COMANDOS-E-CANCELAMENTOS-ATOMICO-NASCIMENTO-PESAGEM-CATEGORIA
- **Base:** `main` 895b80f (merge da #167)
- **PR:** #168 (draft)
- **Migrations:** 0; o schema Prisma não muda
- **Produção:** nenhuma leitura nem escrita nesta missão
- **Rodada R2 (integridade do Nascimento):** seção 11

## 1. Diagnóstico (RED na main mergeada)

Os três handlers de `DetalhesLote` gravavam por partes, com uma chamada HTTP por linha e por lote:

| Manejo | Sequência na main | Problema |
|---|---|---|
| Nascimento | `FormularioNascimento` fazia `forEach(onSubmit)` **sem await**; cada linha fazia PATCH/POST do lote e depois POST do movimento | linhas soltas e paralelas |
| Pesagem | por lote: POST do movimento, depois PATCH do peso | N pares independentes |
| Mudança de Categoria | por linha e por lote: POST do derivado, PATCH da origem, POST do movimento | N trios independentes |

Reprodução com HTTP real e PostgreSQL real, falhando a 2ª ou 3ª chamada (sessão expirada → 401). Evidência em `evidencias/r2b-p1/red-main-gravacao-parcial.txt` e sonda em `red-sonda-legado.test.mjs.txt`:

| Caso | Antes | Depois da falha |
|---|---|---|
| Nascimento com 2 linhas | só as matrizes | lote de bezerros com 10 e o movimento gravados; a linha 2 não |
| Pesagem de 3 lotes | 400 / 380 / sem peso | 450 / 450 / sem peso, com 2 movimentos |
| Mudança parcial repetida | 50 cabeças | **70 cabeças** (origem 30, derivados 20 + 20) |

O comando `POST /comandos/manejo-rebanho` não existe na main (404). A suíte nova não carrega na main (`ERR_MODULE_NOT_FOUND`).

## 2. Contrato do comando

`POST /movimentacoes-mapa/comandos/manejo-rebanho`, autenticado, com schema estrito. Campo desconhecido responde 400, inclusive `efeito_servidor`, `situacao`, `cancelamento`, `usuario_responsavel` e `lote_ids` dentro de uma linha.

```json
{
  "operation_id": "rebanho-<uuid>",
  "tipo": "Nascimento | Pesagem | Mudança de Categoria",
  "empresa_id": "…",
  "area_id": "…",
  "data_movimentacao": "2026-10-30T12:00:00.000Z",
  "observacoes": "…",
  "modo_pesagem": "por_lote | por_categoria | todos",
  "linhas": [
    { "sexo": "Macho|Fêmea", "categoria_mae": "…", "quantidade": 10, "peso_medio_kg": 30 },
    { "lote_id": "…", "categoria": "…", "peso_medio_kg": 420 },
    { "categoria_atual": "…", "categoria_nova": "<oficial>", "quantidade": 20, "categoria_manejo_id_novo": "…", "peso_medio_kg": null }
  ]
}
```

Cada tipo usa o seu formato de linha: o primeiro exemplo é de Nascimento, o segundo de Pesagem, o terceiro de Mudança de Categoria.

**Transação:**
1. reserva a idempotência (`manejo_mapa_rebanho` + fingerprint);
2. confere a empresa;
3. aplica `FOR UPDATE` na área;
4. aplica `FOR UPDATE` nos lotes da área e nos citados, em ordem de id;
5. monta o plano em memória;
6. grava cada lote alterado uma vez, com uma linha de AuditLog;
7. cria e audita os lotes novos;
8. confere a conservação de cabeças;
9. grava o movimento agregado e a auditoria dele.

Qualquer erro desfaz tudo.

**Movimento agregado:**
- `lote_ids` lista todos os participantes; `lote_id` é o primário, por compatibilidade;
- `linhas` traz o detalhe resolvido: filhote, lote criado, peso anterior/novo/ganho, partes total/parcial;
- `efeito_servidor.efeitos[]` guarda `{lote_id, criado, auditoria_id, antes, depois}`, onde `antes`/`depois` cobrem quantidade, status, área, empresa, categoria, `categoria_manejo_id`/`nome`, sexo e peso;
- autor: `registrado_por_usuario_id` vem de `auth_context`.

## 3. Comportamento por tipo

### Nascimento

- Exige lote ativo da categoria da mãe na área. As mães não são reduzidas.
- A categoria do filhote vem de `categoriaDoFilhote(sexo)` no servidor.
- Linhas do mesmo sexo são somadas no mesmo lote.
- Se já existe lote ativo dessa categoria na área: soma as cabeças, aplica a política de peso e mantém `quantidade_entrada` e `area_entrada`.
- Se não existe: cria `"<BEZERRO|BEZERRA> - <área>"`, com `origem 'Nascimento'` e `motivo_outros 'Nascimento'`.

**Política de peso:**
- média ponderada quando os dois pesos são conhecidos (20 @ 100 + 10 @ 40 → 30 @ 80);
- peso do nascimento ausente: mantém o do lote;
- lote sem peso: continua sem peso;
- lote novo: média das linhas, só se todas informaram peso.

### Pesagem

- Só `peso_medio_kg` muda; cabeças, área, status e categoria nunca.
- Peso maior que 0 e até 3000 kg, com 4 casas (coluna `Decimal(14,4)`).
- Cada lote é uma linha.
- O modo por lote envia **só** os lotes digitados. Antes, a main usava o peso do primeiro lote da categoria como substituto para os outros.

### Mudança de Categoria

- Só aceita as 8 categorias oficiais, e a nova precisa ser diferente da atual.
- **Categoria de manejo:**
  - com id: precisa existir, estar ativa e ser da mesma oficial;
  - sem id: vale a única ativa;
  - mais de uma ativa: `MANEJO_CATEGORIA_AMBIGUA`, sem adivinhar.
- O sexo vem da categoria e é incompatível com lote Macho/Fêmea do sexo oposto (409).
- A distribuição entre os lotes da categoria atual segue a ordem de id.
  - **total:** o mesmo lote muda de categoria, categoria de manejo, sexo e peso (se informado); a entrada fica igual;
  - **parcial:** reduz a origem e cria um derivado `origem 'Mudança de Categoria'`, que não é compra.
- Linhas que disputam o mesmo saldo são somadas antes de gravar: excesso → 409 e nada gravado.
- Unificar com destino que já existe **não** é suportado (falha fechada).

## 4. Saldos — exemplos com vários lotes (testes M2, M4, N9, P4)

| Cenário | Antes | Depois | Cancelado |
|---|---|---|---|
| Nascimento M10 @ 40 + F6 @ 35 com BZ 20 @ 100 | BZ 20 @ 100; filhotes F: — | BZ 30 @ 80; lote novo BEZERRA 6 @ 35 | BZ 20 @ 100; BEZERRA 0/Inativo |
| Pesagem L1 / L2 / L3 → 450 | 400 / 380 / — (50/40/30 cab) | 450 / 450 / 450 (50/40/30 cab) | 400 / 380 / — (50/40/30 cab) |
| Mudança 50 de Garrote (G1 30 + G2 40) → Boi | Garrote 70 | G1 Boi 30 (total); G2 Garrote 20; derivado Boi 20 (total 70) | — |
| Mudança parcial 20 de G 50 → Boi | G 50 | G 30; derivado Boi 20 | G 50; derivado 0/Inativo |
| Mudança total G 50 Garrote → Boi | Garrote/cm "GARROTE ERA"/300 kg | Boi/cm resolvida/340 kg | Garrote/"GARROTE ERA"/300 kg |

## 5. Cancelamento causal (mesmo endpoint da R2A)

- **Proveniência:** operação `manejo_mapa_rebanho` committed com `response.movimentacao.id` = este movimento, e `lote_ids` igual aos efeitos. Operação de outro movimento → recusa (X6).
- **Âncora:** o AuditLog de cada efeito, com a ação certa (`create`/`update`), registra exatamente o `depois` em todos os campos R2B.
- **Dependências:** registro posterior em qualquer participante bloqueia: `MovimentacaoMapa` por `lote_id`, `lote_destino_id`, `lote_ids` ou efeito, e as fontes pecuária, nutrição, sanidade, medicamento, manejo técnico e tarefa.
- **Alteração posterior:** linha de auditoria que muda saldo, status, área, categoria, categoria de manejo, sexo ou **peso** bloqueia, a menos que venha de manejo certificado já cancelado. Inclui ida e volta (P6) e a dupla 90 → 80 (N11). Mudar só nome ou identificador não bloqueia (P7).
- **Estado:** o atual tem de ser igual ao `depois`.
- **Reversão:** todos os efeitos juntos. Lote criado fica 0/Inativo e nunca é apagado. O movimento fica `situacao 'cancelado'` com `cancelamento{em, por, motivo, operation_id, efeitos}` e AuditLog `cancelamento`.
- **Ordem:** do mais novo para o mais antigo (N10, P5, M8).

## 6. Compatibilidade

- **R2A:**
  - Morte, Abate e Transferência registram, cancelam e aparecem no histórico como antes;
  - a R2A agora também enxerga dependências por `lote_ids` e efeitos: uma pesagem R2B ativa bloqueia cancelar uma morte anterior (X4);
  - **mudança de contrato:** Pesagem legada recebia `CANCELAMENTO_TIPO_NAO_SUPORTADO` e agora recebe `CANCELAMENTO_EFEITO_NAO_COMPROVADO`, igual à Morte legada. O teste R2A foi atualizado de propósito, e o tipo sem suporte é provado com "Junção de Lotes".
- **#167:**
  - participante de R2B ativo → `movimentacao_ativa`, inclusive pela referência em `efeitos[].lote_id` (X3);
  - pesagem cancelada com prova → exclusão lógica liberada (X2).
- **Histórico:** o servidor filtra lote por `lote_id`, `lote_ids` ou efeitos; o filtro offline faz o mesmo; paginação e cursor não mudaram.

## 7. Frontend, offline e cache

- **Formulários:**
  - Nascimento passou a ter submit único assíncrono;
  - Pesagem e Mudança aguardam o envio;
  - os três bloqueiam duplo clique e mostram "Salvando…".
- **`DetalhesLote`:** um comando por confirmação. No sucesso, fecha e dispara `atualizar-mapa` com `lotes`, `movimentacoes` e `movimentacoesHistorico`. No erro, mostra a mensagem estável e mantém o formulário aberto.
- **Offline:** recusa antes de qualquer requisição (`MANEJO_REBANHO_OFFLINE`), sem fallback POST+PATCH e sem fila. O E2E prova zero requisições e fila IndexedDB sem Lote/MovimentacaoMapa.
- **Pendência idempotente:** a chave e o conteúdo ficam em `localStorage` por tenant, usuário, tipo e área até haver resposta definitiva.
  - Resultado desconhecido (rede ou 5xx): mantém a chave; reenviar o mesmo conteúdo usa a mesma chave, sem duplicar.
  - Conteúdo diferente: só segue com descarte explícito pelo usuário; senão recusa.
- **Histórico:**
  - o movimento agregado aparece por qualquer participante, com as linhas e o número de lotes envolvidos;
  - o diálogo de cancelamento mostra o efeito por lote, com categoria e peso.
- **Sessão offline sem autenticação:** nada é registrado; o limite é a indisponibilidade explícita.

## 8. Testes

| Camada | Resultado |
|---|---|
| Backend R2B `r2bP1ComandosRebanho` (PostgreSQL real, HTTP) | **52/52** |
| Backend completo `npm run test:backend` | verde (ver relatório final) |
| Smoke `npm run test:smoke` | 105 arquivos, com **16** testes R2B novos |
| E2E Chromium em 1440/768/412/390 | **112/112** (28 por largura) |
| Gates, lint, tipos, build, `verify:all` | ver relatório final / CI |

**A suíte backend R2B cobre:**
- rollback com falha injetada no 2º/3º efeito: zero lotes, movimentos, auditorias e reservas (N5, P2, M6);
- validação de forma: data impossível, sexo, quantidade, peso, campo reservado, linhas vazias, tipo R2A;
- área de outra empresa, inexistente ou de outro tenant;
- lote excluído;
- **concorrência repetida 3×:**
  - mesma chave → um efeito;
  - nascimentos distintos → os dois contados num só lote;
  - mudanças disputando o mesmo saldo → uma aceita e outra recusada;
  - pesagens paralelas → em série, sem leitura obsoleta;
  - cancelar × registrar posterior → nunca reverte por cima;
  - dois cancelamentos → uma única reversão.

**O E2E cobre:**
- os três formulários pela UI;
- 1 POST do comando por confirmação, inclusive com duplo toque;
- nenhum POST/PATCH legado de movimento ou de lote pelo navegador;
- histórico agregado;
- cancelamento pela UI recusado por dependência posterior e depois aceito na ordem certa;
- offline sem envio;
- sem overflow horizontal;
- sem erro de página.

## 9. Riscos e limites

- **Sem sincronizador offline de R2B** (adiado por escopo): offline, o manejo fica indisponível.
- **Lote de filhotes criado e depois cancelado** fica no Cadastro como 0/Inativo, com `quantidade_entrada` original e origem `Nascimento`. Não é excluído fisicamente, e a regra da #167 não o exclui porque não está no estado de entrada.
- **Lote de "filhotes" de compra:** o incremento escolhe o primeiro lote ativo da categoria do filhote na área, por ordem de id, mesmo que seja de compra. É a regra da main, agora no servidor.
- **Unificação de destino** na mudança e **junção manual** ficam para fatia própria; hoje falham fechado.
- **Movimentos legados** de Nascimento, Pesagem e Mudança não são canceláveis (sem prova).
- **Trava da área:** serializa manejos R2B da mesma área. Manejos R2A só travam lotes; a ordem área → lotes não forma ciclo com R2A.

## 10. Próximo slice sugerido

- Unificação de destino na Mudança de Categoria, com política explícita e cancelamento da identificação (padrão R2A-R3).
- Motor offline único (fila de comandos com chave idempotente e replay causal) para R2A e R2B.
- Tela de conciliação assistida para recusas `CANCELAMENTO_ALTERACAO_POSTERIOR` e `CANCELAMENTO_ESTADO_DIVERGENTE`.

## 11. PR168-R2 — integridade do Nascimento (matrizes, destino e vínculo materno)

### Diagnóstico (RED no `5ba86b9`, HTTP + PostgreSQL reais)

Evidência: `evidencias/r2b-p1/r2-integridade-nascimento/red-head-5ba86b9.txt`. Resultado: 13 de 22 falharam.

| Problema | Reprodução no 5ba86b9 |
|---|---|
| P0-A mãe masculina | lote BOIS (Macho) com `categoria_mae = Boi 25 a 36 meses` → **201**, o rebanho cresce. Vaca cadastrada Macho e Bezerra como mãe também eram aceitas (A1, A2, A3, A6) |
| P0-B destino incompatível | "Bezerro 0 a 12 meses" cadastrado Fêmea recebia os machos; havendo um compatível e outro incompatível, podia escolher o incompatível; dois compatíveis eram unificados de forma implícita (B1–B4) |
| P0-C vínculo materno | matriz citada por nascimento **ativo** podia ser excluída fisicamente; o histórico da matriz não achava o nascimento; acima de 600 eventos, o total vinha errado; cancelar a mudança Novilha→Vaca era aceito mesmo com nascimento posterior apoiado nessa vaca (C1–C4, C6) |

### Correção

- **Política materna:**
  - categoria oficial de matriz (Vaca 25-36, Vaca +36, Novilha 13-24) **e** lote Fêmea;
  - comparação sem acento e sem diferença de caixa;
  - a linha grava a categoria canônica;
  - o formulário usa a mesma regra (`ehLoteDeMatriz`).
- **Destino:**
  - mesma categoria **e** mesmo sexo;
  - incompatível ou sem sexo fica intacto e o servidor cria lote coerente;
  - dois compatíveis → `MANEJO_DESTINO_AMBIGUO`;
  - peso ponderado, entrada, área de entrada e identificação manual preservados (B2).
- **Vínculo:**
  - `movimentacaoVinculoLote.movimentoCitaLotes` é a definição única;
  - usada em `movimentacaoMapaRepository` (histórico com cursor e total), `movimentacaoMapaCancelamentoService.dependenciasPosteriores` e `loteExclusaoService.movimentosQueCitam`;
  - no frontend, `vinculoDoMovimento` / `idsDeMatrizesDoMovimento` dão a mesma resposta no histórico offline;
  - o card do nascimento diz: "Lotes de matrizes da categoria na área: N (referência da categoria; não identifica a mãe individual)".

### Testes (GREEN)

| Suíte | Resultado |
|---|---|
| `r2bP1R2IntegridadeNascimento` (PostgreSQL real, HTTP) | **22/22** |
| `r2bP1ComandosRebanho` (regressão R2B) | 52/52 |
| `npm run test:backend` | 715 testes, 710 pass, 0 fail (5 todo) |
| Smoke R2B | 19/19 (3 novos de paridade) |
| E2E 1440/768/412/390 | ver `e2e-*.txt` (37 verificações por largura) |

**O que a suíte R2 cobre:**
- mãe macho, vaca cadastrada Macho, Bezerra, nome livre;
- matriz excluída, de outra área, de outra empresa, de outro tenant;
- as três categorias maternas legítimas;
- linha válida junto com linha inválida (rollback integral);
- destino incompatível, misto, ambíguo e sem sexo, com cancelamento exato;
- matriz com nascimento ativo (bloqueio) e cancelado (exclusão lógica);
- homônimo;
- 611 eventos paginados sem duplicar;
- dependência só pelo elo materno (C6).

**Concorrência, 3 rodadas cada:**
- DELETE da matriz × nascimento → nunca os dois; sem nascimento órfão;
- cancelar a transferência da matriz × nascimento nela → nunca os dois.

### Riscos residuais

- Lotes de matriz **sem sexo** no Cadastro deixam de servir como mãe até alguém corrigir o sexo (falha fechada, intencional).
- `maes_lote_ids` é a referência da categoria na área, não maternidade individual.
- Movimentos antigos sem `linhas` não têm vínculo materno (não havia).
- **E2E 390:** duas execuções iniciais falharam ao abrir o menu "Eventos" logo após fechar um diálogo, no toque móvel. O app não mudou. O roteiro passou a esperar o menu e repetir o toque uma vez, e depois disso 390 ficou 37/37 em execuções seguidas.
