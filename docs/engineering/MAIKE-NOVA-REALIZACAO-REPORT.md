MAIKE-NOVA-REALIZACAO (D-PROD-265) · `claude/tipo-tarefa-drop-colunas-1aznvv` · PR (a abrir)

# MAIKE — Nova realização: tipo em cartões, "Nova realização de <Tipo>" e data de término

Decisão: [D-PROD-265](./DECISIONS.md) · Runbook da migration:
[`MAIKE-NOVA-REALIZACAO-RUNBOOK-RELEASE.md`](./MAIKE-NOVA-REALIZACAO-RUNBOOK-RELEASE.md) · Fatias anteriores:
[tipos fixos (D-PROD-258)](./MAIKE-ATIVIDADES-TIPOS-FIXOS-REPORT.md),
[várias linhas (D-PROD-262)](./MAIKE-REGISTRO-VARIAS-LINHAS-REPORT.md),
[várias áreas (D-PROD-263)](./MAIKE-REGISTRO-VARIAS-AREAS-REPORT.md).

## 1. O que mudou

**Entrada.** Na tela de Atividades, o botão "Registrar serviço" passou a **"Nova realização"** (rótulo e
`aria-label`). Nos Detalhes da área (Mapa Geral), "Manejos" continua com o nome e abre a mesma janela com a
área marcada e presa.

**Passo 1 — o tipo.** A janela abre como **"Nova realização"** e mostra os 7 tipos fixos em cartões (ícone +
nome). São botões: Tab chega neles, Enter ou clique escolhe. Grade de 4 colunas no desktop, 2 no celular
(< 768 px). Rodapé só com Cancelar; o ✕ fecha.

**Passo 2 — o formulário.** O título vira **"Nova realização de <Tipo>"** (ex.: "Nova realização de
Aplicação"), com o ícone do tipo e o botão **"Trocar tipo"** ao lado. Trocar tipo volta aos cartões; o novo
tipo mantém áreas, datas e linhas e limpa só a operação (voltar ao mesmo tipo não a perde). O select de Tipo
saiu do corpo. Seções, nesta ordem:

1. **Área** — o campo "Áreas" e a tabela (D-PROD-263);
2. **Operação** — as operações do tipo escolhido;
3. **Datas** — **Data de início*** (o `data_operacional` de antes) e **Data de término** (opcional, nova);
4. **Insumos**, 5. **Máquinas**, 6. **Equipe**, 7. **Serviço de terceiro (se houver)** — sem mudança;
8. **Planejamento** — só leitura: a linha "Entra em …" / "Nova atividade será criada: …" (sem área ou
   operação, um aviso de como ela aparece). Não há botão de planejar;
9. **Informações complementares** — Operador e Observação.

"Salvar e novo" mantém o tipo e a operação e limpa o resto (o término também). Com a operação presa (prop
`tipo`), a janela abre direto no formulário, sem "Trocar tipo", com a operação só leitura.

**Data de término.** Opcional. No cliente: antes da Data de início → "A data de término não pode ser antes da
data de início." (no campo, ao digitar e ao salvar; nada sai); depois de hoje na fazenda → recusada também.
Só vai no corpo quando preenchida (a porta `lancamentoAtividadePort` ganhou `data_termino` na lista fechada do
registro). O período aparece como **"10/11 a 12/11"** no histórico da área (linha "Período" do cartão) e na
lista de lançamentos da atividade (só quando o término é depois do início).

**Servidor.** `POST /atividades/registrar` aceita `data_termino` opcional (`AAAA-MM-DD` ou null) no corpo
fechado:

- formato errado → 400 do schema; dia inexistente → 422 `data_inexistente`;
- antes de `data_operacional` → **400** `REQUEST_VALIDATION_FAILED`, `field: data_termino`,
  `reason: periodo_invertido`;
- no futuro da fazenda → **422** `ATIVIDADE_DATA_INVALIDA` `futura` (a mesma regra do dia);
- várias áreas: **todos** os apontamentos com o mesmo término.

O campo fica só nesta rota: ele **não** entrou em `CAMPOS_DO_DIA`/`camposDoCorpo`, então o
`POST /atividades/:id/apontamentos` segue com o corpo de antes (recusa `data_termino` com 400). Foi a
mudança menor e segura; o caminho compartilhado (`lancarNaTransacao`) só ganhou a conversão do dia em
`paraGravacao`. O término volta na forma pública do apontamento (depois de `atividade_area`), na auditoria e
no histórico da área (`GET /atividades-por-area/:id/registros`).

**Idempotência.** Sem `data_termino` (ausente ou null), o fingerprint do recibo `atividade_registrar_v1` é
**byte a byte o de antes** (nenhuma chave nova): o reenvio pendente/offline feito antes do deploy ainda
casa. Com ele, ele entra no fingerprint (outro término, ou tirar o término, com a mesma chave → 409).

**Edição.** Editar o término depois de gravado está **fora** desta fatia. Editar a data do lançamento para
depois do término gravado → 422 `ATIVIDADE_DATA_INVALIDA` `depois_do_termino` (o CHECK também recusaria; a
tela tem a frase própria). A repetição (duplicar) não copia o término.

`B1Janela` ganhou o encaixe opcional `acoesDoTitulo` (logo depois do título), usado pelo "Trocar tipo".

## 2. Migration — preparada e testada SÓ no Postgres local; NÃO aplicada em produção

`20261120200000_apontamento_data_termino` (SHA-256 `a1f8a13c782cfc4fe3d3050749ebb0663eb943d039231db0490ce89fea90c84b`):

```sql
-- guarda DO $$ … $$ (pinada: 5518e0acb080aab98bd066d026d328d3cec549c763de6ad86ddd3f5d1735a4b4):
--   lock_timeout 5s, statement_timeout 120s, a trava do prisma migrate, a tabela existe,
--   a coluna e o CHECK novos não existem, LOCK "AtividadeApontamento" IN ACCESS EXCLUSIVE MODE
ALTER TABLE "AtividadeApontamento" ADD COLUMN "data_termino" DATE;
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_data_termino_check" CHECK ("data_termino" IS NULL OR "data_termino" >= "data_operacional");
```

**É CONTRACT aditiva, não EXPAND.** O pedido era uma migration aditiva (EXPAND) com o CHECK, mas a allowlist
EXPAND (`premergeMigrateLib.mjs`, D-PROD-107 R7) recusa **coluna DATE** e **CHECK** em tabela antiga — e o
teste B1e prova a recusa de DATE em tabela antiga, então alargar a allowlist enfraqueceria uma prova. O
caminho do repositório para isso é o da D-PROD-216 e da D-PROD-259 (a `data_validade` DATE das Entradas): uma
entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS` (decisão D-PROD-265, guarda pinada, `drop: []`,
`literais_guarda: ['AtividadeApontamento']`, as 2 instruções pinadas em `alter_antigas`). Nenhuma linha muda,
nenhum DROP, nenhuma tabela nova.

Registro: `MIGRATIONS_APROVADAS` (checksum) e `MIGRATIONS_CONTRACT_APROVADAS` (a 16ª entrada). Consequência:
aplicar exige o **GO do proprietário** e `--contract D-PROD-265` (o runner recusa CONTRACT pendente no alvo
remoto sem `MIGRATION_CONTRACT_AUTORIZADO`). Tem de subir **antes** do merge: o runtime novo lê a coluna em
toda leitura do apontamento (o antigo não a conhece e segue igual com o banco migrado: não há janela).

Provas atualizadas: `premerge-migrate` B39a/B39b/B39k (e B1, B8-0, contagens 71→72, posições do manifesto),
`migrations.test.mjs` B28 (barreira do CONTRACT, mais `sem265` nos cenários antigos), `alvo-banco` AB-05;
backend: os espelhos de `diaDaD223.mjs` sem a coluna (`schemaSemDataTermino`), e as partidas de
`estoqueEntradasMotivosMigration`, `categoriaManejoCadcategoriaMigration` e `patrimonioSimplificaMigration`
com a pasta nova depois delas (e a lista de CONTRACT pendentes do SM-03). Nenhuma prova enfraquecida.

## 3. Testes

| Suíte | Resultado |
|---|---|
| `backend/tests/atividadeRegistroDataTermino.test.mjs` (novo, PG local) | **6/6** — aceita e grava (resposta, leitura, histórico da área), término = início vale, null = sem término; antes do início 400, futuro 422, formato 400, dia inexistente 422, nada gravado; o CHECK do banco recusa; várias áreas com o mesmo término + replay; recibo sem o campo = fórmula de antes byte a byte, replay com e sem `null`, término mexido 409; edição 422 `depois_do_termino`; `POST …/apontamentos` recusa o campo |
| `atividadeRegistro` + `atividadeRegistroVariasAreas` + `atividadeApontamentoNativo` | **57/57** |
| testes de migration do backend (17 arquivos: espelhos D-PROD-223/249, Entradas, CADCATEGORIA, Patrimônio, etc.) | 1ª rodada **239/241**: o SM-03/SM-04 do Patrimônio esperavam a lista de CONTRACT pendentes sem a D-PROD-265; incluída, o arquivo passou **14/14** |
| `npm run test:gates` (deploy/migrations/gates) | **1055/1055** |
| smoke `tests/smoke/registroDeCampoNovaRealizacao.test.jsx` (novo) | **9/9** — cartões na ordem com ícone, só Cancelar; cartão → "Nova realização de X", sem Tipo, seções na ordem; teclado; Trocar tipo mantém áreas/datas/linhas e limpa a operação; Data de término só vai preenchida e é barrada antes do início; Salvar e novo; mapa com a área presa; operação presa sem Trocar tipo; período "10/11 a 12/11"; botão renomeado e "Manejos" mantido |
| smoke ajustados (`detalhesAreaHistorico`, `lancamentoAtividades`) | o Tipo agora é cartão; o botão se chama "Nova realização"; "Escolha o tipo." deixou de existir no formulário (sem tipo não há formulário) — as asserções ficaram iguais ou mais estritas |
| `node scripts/gates/verify-all.mjs --pular=test:backend` | tudo PASS (smoke 3788/3788 em 303 arquivos, build, lint, tipos) depois do ajuste do JSDoc do `atividadeDataInvalida` |

## 4. Capturas (harness local, Chromium com `--lang=pt-BR` e `LANG/LANGUAGE` pt_BR)

Pasta: `/tmp/claude-0/-home-user-MAIKE/10ef7a8b-75ae-5c1d-b8e4-004ede2f335f/scratchpad/registro-shots/out-realizacao/`
(script `shots-realizacao.cjs`), desktop 1440×900 e celular 390×844:

- `r1-tipos-{desktop,celular}.png` — os cartões;
- `r2-aplicacao-preenchida-{desktop,celular}{,-2,-3}.png` — "Nova realização de Aplicação" com 2 áreas,
  insumos, máquina, equipe e término, em partes;
- `r3-planejamento-complementares-{desktop,celular}.png`;
- `r3b-termino-antes-do-inicio-{desktop,celular}.png` — a mensagem no campo;
- `r4-mapa-area-presa-{desktop,celular}.png` e `r4b-mapa-titulo-longo-{desktop,celular}.png` (o título mais
  longo, "Formação de pastagem (plantio)", com "Trocar tipo").

Rodada de correção: o "Trocar tipo" usava `tb-btn-sm`, que no motor é botão só de ícone (24 px) — o texto
vazava por cima do título. Passou a botão com texto (`tb-btn-outline`, largura do texto). As datas da 1ª
rodada saíram em mm/dd/aaaa porque o `--lang` sozinho não muda o formato do `<input type="date">` no
Chromium do harness; com `LANG/LANGUAGE` pt_BR saem dd/mm/aaaa.

## 5. Pontos abertos

- **A migration é CONTRACT aditiva** (ver §2): o GO do proprietário e `--contract D-PROD-265` antes do merge.
- **Editar o término** de um lançamento gravado não existe ainda (fora de escopo).
- **Repetir** (duplicar) um lançamento não copia o término.
- No celular, o rótulo flutuante das datas encosta no valor (o mesmo desenho do campo "Data" de antes, do
  `CampoDia`); não mudou nesta fatia.
- Fora de escopo, para as próximas fatias: campos próprios de cada tipo (safra, cultura, praga/alvo, local,
  área opcional), a lista nova de atividades, Planejar, remover as telas antigas.
