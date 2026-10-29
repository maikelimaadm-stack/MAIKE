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

- O CAS estrito (`avancarRevisaoCatalogo`) foi aplicado só a `registrarAsset`. As
  outras mutações continuam com `assertRevisaoCatalogo` + incremento simples (risco
  preexistente de corrida entre duas escritas com a mesma `revisao_esperada`).
- O cenário "commit confirmado, mas o client recebeu erro" foi testado na unidade de
  compensação (R2-08), sem simular queda de rede real no COMMIT.
- Upload real no Supabase Storage: NOT_RUN (sem credenciais, como manda a missão).
- `scripts/catalogo/bootstrap-storage-bucket.sql` contém só instruções
  comentadas: não cria bucket por si só e não foi executado.
- Produção sem mudança: 0/3 migrations do catálogo, 0/9 tabelas, bucket ausente
  (SELECT read-only de 29/10). O rollout segue pendente de autorização separada.
