# Catálogo global R2: integridade transacional (relatório)

**Base:** `origin/main` `91a11e16a6dc171a81e9debadbd3aade808b5065` (merge da PR #133)
**Escopo:** só `backend/src/modules/catalogoGlobal/**`, os testes dele e a R9 do `CLAUDE.md`. Esta missão não tem migration nova, não toca no Mapa e não escreve no Supabase/Vercel.

## Problema

Em `registrarAsset`, a transação gravava o objeto no Storage, criava o
`CatalogoAsset`, avançava a revisão e **commitava**. A auditoria vinha depois,
num client separado. Se a auditoria falhasse, o `catch` removia o objeto do
Storage com o asset já commitado. O resultado era um registro válido apontando para
um arquivo apagado, e um evento de auditoria perdido. A falha de remoção era engolida
por `.catch(() => {})`. As outras 9 mutações administrativas também auditavam
depois do commit, então uma alteração podia ser confirmada sem audit trail.

## Correção

1. `registrarAuditoriaCatalogo(params, tx)` agora exige a transação da mutação. Ela não
   tem mais client próprio, e todas as mutações auditam dentro da própria transação.
2. `registrarAsset` foi reordenado:
   - lê a revisão (CAS) e o dedupe `(sha256, revisao)` fora de transação. No dedupe
     ele não grava objeto, não avança revisão e não audita;
   - grava o objeto **antes** de abrir a transação, então nenhuma transação fica
     aberta durante a rede. O path é exclusivo da tentativa:
     `v{revisao}/{sha16}-{assetId}.{ext}`, com `x-upsert: false`;
   - cria o asset, grava a auditoria e avança a revisão numa única transação.
     `avancarRevisaoCatalogo` confere, sob o lock de linha do UPDATE, que a
     revisão foi de R para R+1. Uma corrida devolve 409 em vez de dois commits na mesma revisão.
3. A compensação (`compensarObjetoAssetCatalogo`) só remove o objeto quando o banco
   confirma que nenhum asset o referencia. Se a verificação falhar (commit incerto)
   ou a remoção falhar, o objeto fica e sai um log JSON
   `evento: catalogo_asset_orfao` com `storage_path`, `request_id` e `desfecho`.
   O erro original é sempre o que o chamador recebe.
4. A remoção no Supabase agora falha quando a resposta não é 2xx/404. Antes o resultado era ignorado.

## Testes (PostgreSQL 16 real e local; falhas injetadas por trigger)

R2-01 sucesso · R2-02 falha na auditoria → rollback + compensação · R2-03 falha
no COMMIT (constraint trigger deferido) → rollback + compensação · R2-04 erro no
Storage → banco intacto, nenhuma remoção · R2-05 erro de banco após upload → só o
objeto novo é removido · R2-06 dedupe sem efeitos · R2-07 corrida → 201 + 409 com
compensação · R2-08 compensação preserva objeto referenciado ou incerto e registra
órfão · R2-09/R2-10 auditoria atômica em criar/atualizar tipo + CAS 409 ·
R2-11 `is_admin` do tenant ≠ operador → 403 · R2-12 sem JWT → 401.
Nenhum teste usa credencial real ou rede externa.

## Recuperação de órfãos

Um objeto sem `CatalogoAsset` é inofensivo, porque nenhuma URL do catálogo aponta para ele.
O procedimento é este: filtrar os logs por `catalogo_asset_orfao`. Para cada `storage_path`, conferir
`SELECT 1 FROM "CatalogoAsset" WHERE storage_path = $1`. Se não houver linha,
remover o objeto pelo painel/API do Storage com credencial de servidor.

## Limitações e pendências

- ~~CAS estrito só em `registrarAsset`~~ — resolvido na R3 (abaixo).
- Upload real no Supabase Storage: NOT_RUN (sem credenciais, como manda a missão).
- `scripts/catalogo/bootstrap-storage-bucket.sql` contém só instruções
  comentadas: não cria bucket por si só e não foi executado.
- Produção sem mudança: 0/3 migrations do catálogo, 0/9 tabelas, bucket ausente
  (SELECT read-only de 29/10). O rollout segue pendente de autorização separada.

---

# R3: fechamento de integridade (auditoria externa `CORRECTIONS_REQUIRED`)

**Mesma PR #136, mesma branch `claude/new-session-abgn5w`.** O escopo continua sendo só
`backend/src/modules/catalogoGlobal/**`, os testes dele e este relatório. Sem migration e sem schema.

## Governança

`GOVERNANCE_EXCEPTION_MULTIPLE_OPEN_PRS` (29/10/2026): #134 (MapLibre M2-B3),
#135 (SplashScreen) e #136 estão abertas ao mesmo tempo. A #136 foi criada sem
que esta sessão soubesse das outras duas. A #134 e a #135 não foram tocadas.
Não há arquivo em comum com elas (`git diff --name-only` conferido).

## Bloqueio A: upload com resultado remoto incerto

`assetId` e `storage_path` (`caminhoObjetoCatalogo`) passam a ser fixados **antes** da
rede. A exceção de `gravar` é classificada:

| Erro de `gravar` | Interpretação | Ação |
|---|---|---|
| resposta 4xx recebida (`gravacaoRecusada`) | Storage recusou, nada gravado | nenhuma remoção, nenhum evento |
| 5xx, rede, timeout, outro | **incerto**: pode ter gravado | tenta `remover` (idempotente, 404 = ok) e emite `upload_incerto` |

A remoção no caso incerto é segura porque o banco nunca foi tocado e o path é
exclusivo da tentativa (assetId novo). Nenhuma linha pode referenciá-lo, e o
path de outra tentativa nunca é alcançado. Se a remoção falhar, o objeto fica e
o evento traz `remocao: falhou`. Um path devolvido pelo adaptador fora do contrato
também é tratado como incerto.

## Bloqueio B: COMMIT ambíguo ≠ rollback

Fases registradas só no servidor: `upload_enviado → upload_confirmado →
transacao_iniciada → callback_concluido → commit_confirmado`.

| Fase da falha | Pode ter commitado? | Ação |
|---|---|---|
| `upload_enviado` | não (sem transação) | ver Bloqueio A |
| `transacao_iniciada` (callback rejeitou) | **não**: o Prisma só envia COMMIT quando o callback resolve | SELECT de referência; sem linha → remove; com linha ou SELECT falho → mantém + evento |
| `callback_concluido` (erro no/após COMMIT) | **incerto** | **nunca remove**; evento `commit_incerto` |

O erro após o callback não é classificado por código Prisma ou SQLSTATE. Mesmo
um erro determinístico no COMMIT (trigger deferido) é tratado como ambíguo. É a
política conservadora: ela custa um órfão recuperável e nunca deixa link quebrado.
Por isso o **R2-03 mudou de expectativa**: o objeto agora fica retido e aparece no log.

Os eventos `catalogo_asset_orfao` levam `desfecho`, `fase`, `storage_path`,
`request_id` e `erro_original.{motivo,status}`. Nunca levam mensagem, corpo,
token, chave ou Base64. A falha de compensação nunca substitui o erro original.

## Bloqueio C: CAS em todas as escritas

`avancarRevisaoCatalogo(tx, revisaoEsperada)` é o contrato único, usado pelas 10
mutações. O UPDATE de `CatalogoMeta` trava a linha e, em READ COMMITTED,
devolve o valor já somado a toda escrita confirmada. Se `revisao_esperada` foi
informada e o resultado não é `esperada + 1`, a resposta é 409
`CONCURRENCY_CONFLICT` com `revisao_atual`/`revisao_esperada` e rollback (a
auditoria some junto). A janela entre `assert` e incremento deixou de existir.

- `revisao_esperada` omitida mantém o contrato HTTP anterior: sem CAS, a última
  escrita vence, e cada mutação confirmada incrementa a revisão uma vez e audita uma vez (R3-09).
- `registrarAsset` usa CAS **sempre**, mesmo sem `revisao_esperada`, porque o path
  é versionado pela revisão lida.
- Dois uploads idênticos `(sha256, revisao)` concorrentes: o perdedor bate na
  unique (P2002) ainda dentro do callback, compensa **só o próprio** objeto e
  devolve a linha vencedora (mesma semântica do dedupe, 201). Não sai 500 e o
  objeto vencedor fica intacto.

## Testes R3 (PostgreSQL 16 real, corridas sem `sleep`)

| Teste | Prova |
|---|---|
| R3-01 | Storage grava e a resposta se perde: 500, banco igual, objeto removido, evento `upload_incerto`/`ECONNRESET` |
| R3-02 | o mesmo, com remoção falhando: objeto retido e evento visível |
| R3-03 | recusa 4xx: nenhuma remoção, nenhum evento |
| R3-04 | fase `callback_concluido` com SELECT sem linha: **não** remove |
| R2-03 | COMMIT falho (trigger deferido): banco igual, objeto **retido**, `commit_incerto` |
| R3-05 | 2 uploads idênticos sincronizados por barreira: 201+201 com o mesmo id, 1 asset, 1 auditoria, revisão 1, objeto vencedor intacto, perdedor removido |
| R3-06 | `atualizarTipo` concorrente: 200+409, 1 auditoria, revisão +1 |
| R3-07 | `criarTipo` concorrente: 201+409, 1 tipo, 1 auditoria |
| R3-08 | `publicarIcone` concorrente: 200+409, 1 auditoria de publicação |
| R3-09 | sem `revisao_esperada`: 200+200, 2 auditorias, revisão +2 |
| R3-10 | TOCTOU com interleaving manual (escrita confirmada entre assert e avanço): 409, rollback, revisão externa preservada |

Prova de vermelho: com a checagem do CAS neutralizada localmente, R3-06, 07, 08 e 10
**falham**. Restaurado o código, passam.

## Recuperação de órfãos (procedimento)

1. Filtrar os logs do backend por `"evento":"catalogo_asset_orfao"`.
2. Para cada `storage_path`: `SELECT id FROM "CatalogoAsset" WHERE storage_path = $1`.
3. Com linha: **não remover** (o objeto está em uso).
4. Sem linha, com o desfecho `commit_incerto` e transcorrido o timeout de transação
   (sem commit pendente possível): remover pela API/painel do Storage com credencial de servidor.
5. Sem linha nos demais desfechos: remover.

## Limitações R3

- Nenhum teste com Supabase Storage real (NOT_RUN, sem credenciais). A classificação
  4xx/5xx do adaptador foi verificada só por revisão de código.
- A queda real de conexão durante o COMMIT é simulada pela fase (R3-04) e pelo trigger
  deferido (R2-03), sem cortar socket.
- Não existe job automático de reconciliação de órfãos. O procedimento é manual (acima).
