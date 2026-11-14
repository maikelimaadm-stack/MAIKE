# MAIKE-ATIVIDADE-CABECALHO — contrato da Fatia 2 do Lançamento de Atividades

> **fatia 2 · `feat/atividade-cabecalho` · PR #285**
>
> Decisão **D-PROD-199**. Pedido do proprietário: "FATIA 2 — O cabeçalho + transformar o apontamento atual em filho
> dele." Base: a Fatia 1 (D-PROD-197), já em produção, com os padrões e as flags do Tipo de Atividade.

## 1. Modelo (fixado no `schema.prisma`)

Dois níveis no lugar do apontamento de linha única (D-PROD-190/193):

```
Atividade (cabeçalho, aberta)              "Cigarrinha Pasto 01"
  └─ AtividadeApontamento (dia/turno)      sequência 1, 2… no mesmo dia e turno = as passadas
```

- **`Atividade`**: os campos do pedido, mais dois:
  - **`bem_id`** (máquina da atividade, FK `BemPatrimonial` da mesma empresa): é o que a flag `exige_maquina` confere
    na abertura ("mesmo para safra e máquina"). É também onde fica a máquina dos 2 apontamentos convertidos. As linhas
    de máquina por dia, com medidor, chegam na Fatia 3.
  - **`unidade_producao_sigla`**: snapshot da sigla da `UnidadeMedida`. Também guarda a unidade de texto dos 2
    apontamentos convertidos (`KM`, `HA`), que não existem no cadastro de unidades do cliente.
- **`AtividadeApontamento`**: os campos do pedido. O unique `(cliente_id, atividade_id, data_operacional, turno,
  sequencia)` é `NULLS NOT DISTINCT` no banco (PostgreSQL 17): turno nulo conta como valor e duas passadas sem turno
  não colidem só porque o turno é nulo. O Prisma não vê a cláusula e o `migrate diff` continua vazio.
- Listas fechadas por CHECK: status da atividade `ABERTA | CONCLUIDA | CANCELADA`; turno `MANHA | TARDE | NOITE | nulo`;
  origem `WEB | APP`; status do apontamento `CONFIRMADO | CANCELADO`; números ≥ 0; `sequencia ≥ 1`;
  `data_prevista_fim ≥ data_inicio`; `CONCLUIDA ⇔ concluida_em`; `CANCELADA ⇔ cancelada_em`; `CANCELADO ⇔ cancelado_em`.
- Toda FK é composta e tenant-aware, `RESTRICT`. O apontamento aponta para a atividade por `(cliente_id, empresa_id,
  id)`: mesma fazenda por construção.

## 2. Migration `20261114500000_atividade_cabecalho` (CONTRACT, com conversão)

Ordem dentro do arquivo:
1. **Guarda** (falha fechada): as 3 tabelas antigas existem e as 2 novas não; itens de custo e fatias FIFO **vazios**;
   nenhum apontamento antigo com implemento, hora de início/fim ou horas trabalhadas (o modelo novo não tem onde
   guardar); status só `CONFIRMADO`/`CANCELADO`, com cancelamento completo; nenhum contador `Atividade`.
2. **Tabelas novas** pela allowlist EXPAND: CREATE TABLE, índices, CHECKs, FKs e RLS (`maike_backend_all`).
3. **Conversão pinada**:
   - cada `ApontamentoAtividade` vira uma `Atividade`, com id `'atv_' || id antigo` e o **mesmo número**;
   - o nome é `<tipo> (apontamento nº <n>)`;
   - tipo e grupo (snapshots), área com o setor dela, máquina, safra, centros, unidade de texto, data como
     `data_inicio`, produção e tarefa vão para o cabeçalho;
   - status `ABERTA`, ou `CANCELADA` com o cancelamento;
   - cada um vira também um `AtividadeApontamento` filho, com o **mesmo id antigo**, sequência 1 e sem turno;
   - operador, produção do dia, observação, status e cancelamento vão para o filho;
   - o contador `ApontamentoAtividade` passa a ser o da entidade `Atividade` (as convertidas mantêm 1 e 2; a próxima é 3).
4. **DROP pinado** de `ApontamentoAtividadeItemConsumoLote`, `ApontamentoAtividadeItem` e `ApontamentoAtividade`.
   Os itens e as fatias estão vazios pela guarda: nada com custo é apagado.

O portão ganha o formato **conversão**: guarda → `alter_antigas` → resto EXPAND → `conversao` pinada → DROP pinados no
fim. O formato antigo (DROP logo depois da guarda) continua igual para as 6 entradas existentes. Produção: 52
migrations e 84 tabelas depois desta (85 − 3 + 2).

## 3. Regras

**Abrir atividade** (`POST /atividades`):
- tipo inexistente ou inativo → recusa;
- grupo do tipo inativo → recusa;
- `nome` obrigatório (1–120, sem só espaços).
- **Herança do tipo**, pelo `padroesParaAtividade(tipo, { empresaId })` da Fatia 1 (snapshot, nunca relido):
  - centro de custo e centro de resultado padrão, só se o centro for da mesma fazenda da atividade e estiver ativo;
    senão ficam nulos;
  - unidade de produção, com a sigla.
  - Centros e unidade **não vêm no corpo**: o corpo recusa esses campos.
- **Setor herdado da área** (`AreaPastagem.setor_id/setor_nome`); nunca vem no corpo.
- A área, a máquina e a tarefa têm de ser da mesma fazenda, e a área e a máquina ativas.
- **Flags do tipo:**
  - `exige_area` sem área → 422;
  - `exige_safra` sem safra → 422;
  - `exige_maquina` sem máquina → 422.
- **Datas:**
  - `data_inicio` padrão hoje e nunca no futuro;
  - `data_prevista_fim ≥ data_inicio`;
  - `area_planejada ≥ 0`.

**Editar atividade** (`PATCH`, CAS por `versao`):
- só `ABERTA`;
- tipo imutável;
- trocar a área refaz o setor;
- as flags valem de novo na edição;
- centros e unidade não mudam.

**Concluir:**
- só `ABERTA`;
- `data_conclusao` padrão hoje, nunca futura nem antes de `data_inicio`;
- com `exige_producao` no tipo, exige produção > 0 somada dos apontamentos confirmados;
- grava `concluida_em/por`;
- registro de auditoria.

**Reabrir:**
- só `CONCLUIDA`;
- permissão própria (`op-atividade-reabrir`);
- motivo obrigatório (1–500, sem só espaços);
- grava `reaberta_em/por/motivo`;
- limpa a conclusão;
- registro de auditoria a cada reabertura.

**Cancelar:**
- só `ABERTA` (concluída: reabrir antes);
- motivo obrigatório;
- cancela todos os apontamentos confirmados no mesmo `UPDATE`, com o mesmo motivo, data e usuário;
- registro de auditoria.
- O estorno de estoque não tem o que estornar nesta fatia: produto volta na Fatia 3. O ponto de extensão fica no
  serviço, dentro da mesma transação.

**Duplicar atividade:**
- é uma abertura nova, com as mesmas regras e os padrões relidos do tipo atual;
- copia nome, tipo, área, máquina, safra, área planejada, tarefa e observação;
- corpo opcional: `nome`, `data_inicio` (padrão hoje), `data_prevista_fim`;
- não copia apontamentos.

**Apontamento:**
- **Só em atividade `ABERTA`.** Concluída ou cancelada não aceita apontamento novo nem edição: 409.
- **Data:**
  - `data_operacional` obrigatória;
  - no futuro → 422;
  - fora de `[data_inicio, data_prevista_fim]` → **alerta** em `alertas[]` na resposta, sem bloquear (ele sai e
    volta).
- **Turno e sequência:**
  - `turno`: nulo, `MANHA`, `TARDE` ou `NOITE`;
  - `sequencia` = máx + 1 por (atividade, dia, turno), calculada no servidor sob `SELECT … FOR UPDATE` da atividade.
    Nunca vem no corpo.
- **Campos:**
  - operador: usuário ativo do cliente;
  - área do dia e produção do dia ≥ 0;
  - `origem` `WEB` (padrão) ou `APP`.
  - O corpo **recusa** área, setor, safra, centros, unidade e máquina: são herdados e travados no cabeçalho.
- **Editar** (CAS) e **cancelar** (motivo obrigatório): só apontamento `CONFIRMADO` de atividade `ABERTA`.
- **Duplicar** ("repetir último lançamento"):
  - copia turno, operador, área do dia, produção e observação;
  - `data_operacional` do corpo, padrão hoje;
  - sequência nova;
  - as linhas chegam na Fatia 3.
- **Totais:** a cada criar, editar ou cancelar apontamento, `area_executada` e `quantidade_produzida` do cabeçalho são
  recalculadas como a soma dos apontamentos `CONFIRMADO`, na mesma transação. Nenhum confirmado com valor → nulo.

## 4. API

Tenant sempre do `auth_context`; `empresa_id` validado contra o acesso do usuário, como no módulo antigo.

| Método e rota | Guarda |
|---|---|
| `GET /atividades` (keyset `createdAt desc, id desc`; filtros `status`, `tipo_atividade_id`, `area_id`, `data_de`, `data_ate` sobre `data_inicio`) | atividades: ver |
| `GET /atividades/:id` (cabeçalho + objetos de tipo, área, setor, máquina, centros, unidade, tarefa + totais) | atividades: ver |
| `POST /atividades` · `POST /atividades/:id/duplicar` | atividades: criar |
| `PATCH /atividades/:id` · `POST /atividades/:id/concluir` | atividades: editar |
| `POST /atividades/:id/cancelar` | atividades: cancelar |
| `POST /atividades/:id/reabrir` | **reabrir** (permissão separada) |
| `GET /atividades/:id/apontamentos` (por dia desc, turno, sequência) · `GET /atividades/:id/apontamentos/:apontamentoId` | apontamentos: ver |
| `POST /atividades/:id/apontamentos` · `POST …/:apontamentoId/duplicar` | apontamentos: criar |
| `PATCH /atividades/:id/apontamentos/:apontamentoId` | apontamentos: editar |
| `POST …/:apontamentoId/cancelar` | apontamentos: cancelar |
| `GET /atividades-opcoes/{bens,operadores}?empresa_id=` | atividades: ver |

Corpos com `additionalProperties: false`; decimais como string (sem coerção do AJV); datas `YYYY-MM-DD`. Erros
novos em `errorCodes.js` com prefixo `ATIVIDADE_`; o servidor não lê tabela de outro módulo para explicar FK:
reconhece P2003 pelo nome da constraint (lição da #259).

## 5. Permissões e menu

- **Menu:** o item `op-apontamentos-atividade` ("Apontamentos de Atividade") sai. Entra `op-atividades` ("Lançamento de
  Atividades", página `LancamentoAtividades`), no mesmo grupo `suporte-mapa`, logo abaixo de Tipos de Atividade.
- **Onde as permissões ficam:** a tela Permissões só desenha páginas do menu e as **ações extras** da linha da página
  (padrão `ACOES_LANCAMENTOS_FINANCEIROS`, D-PROD-155). Por isso as três permissões do pedido moram na linha da tela
  `op-atividades`.
- **Permissões da atividade** (`op-atividades`, ações padrão):
  - ver (`visualizar`): lista, detalhe e apontamentos;
  - criar ou duplicar (`novo` | `salvar`);
  - editar ou concluir (`editar` | `salvar`);
  - cancelar (`excluir`).
- **Permissões do apontamento** (`op-atividade-apontamentos`, ações extras):
  - `lancar_apontamento`: criar e repetir;
  - `editar_apontamento`;
  - `cancelar_apontamento`.
- **Reabrir** (`op-atividade-reabrir`): ação extra `reabrir`.
- **Sem concessão automática.** Administrador da fazenda e `is_admin` têm tudo; as extras nascem desligadas.
- **Concessões antigas:** as linhas `op-apontamentos-atividade` ficam inertes no JSON (precedente D-PROD-162). Os
  usuários comuns precisam de nova concessão.

## 6. Tela "Lançamento de Atividades" (só componentes que já existem)

- **Lista:**
  - número, nome, tipo, área, status, área executada / planejada e data de início;
  - filtros de status, tipo, área e data;
  - ações abrir, concluir, reabrir, cancelar e duplicar, cada uma conforme a permissão e o status.
- **Atividade aberta:**
  - cabeçalho fixo no topo, só leitura, com os campos herdados (tipo, grupo, área, setor, máquina, safra, centros,
    unidade, datas, área executada / planejada, produção);
  - lista dos apontamentos por dia (data, turno, sequência, operador, área do dia, produção, status);
  - botões "Novo lançamento", editar, cancelar e "Repetir".
- **Formulário do apontamento:** data, turno, operador, área do dia, produção do dia e observação. Nada de centro de
  custo: é herdado e travado.

## 7. O que sai

O módulo `backend/src/modules/apontamentosAtividade/*` (incluindo os itens da D-PROD-193), a tela
`ApontamentosAtividade` com componentes, porta e serviço, os testes do apontamento antigo e as referências nos gates,
scripts e documentos operacionais. Documentos históricos ficam.

## 8. Testes

- herança e travamento dos campos;
- setor herdado da área;
- flags respeitadas;
- dias não contíguos aceitos;
- duas passadas no mesmo dia (mesma data, sequência 1 e 2);
- concluir bloqueia;
- reabrir exige permissão e motivo;
- cancelar propaga;
- duplicar (atividade e apontamento);
- isolamento por `cliente_id` (e por fazenda);
- conversão dos 2 registros antigos, em PostgreSQL real, com a forma exata dos de produção;
- schema × banco (`migrate diff` vazio);
- portão (formato conversão aceito; DML no resto, DROP fora do lugar e conversão adulterada recusados).

## 9. Release

A migration **apaga a tabela que o código em produção usa** e cria as que o código novo usa: não há ordem sem janela.
O runbook prevê aplicar e fazer o merge em seguida, fora de pico. A janela é a do deploy da Vercel: a tela antiga
quebra até o código novo subir. **Só com autorização explícita do proprietário**, pelo caminho A
(`--contract D-PROD-199`) ou pelo caminho B com GO escrito para esta migration.

**GO do proprietário (2026-11-14):** "autorizo pode enviar", em resposta a "A migration da Fatia 2 apaga a tabela que
a versão no ar usa. Então ela só entra com nova autorização sua, logo antes do merge." Vale para aplicar esta
migration logo antes do merge da PR da Fatia 2 e fazer o merge, depois de toda a validação local verde e de um
preflight `PRONTO PARA APLICAR`. Não vale para a Fatia 3.

## 10. Formato da API (backend e tela seguem este texto)

Convenções do módulo antigo, mantidas:
- decimais como string com 4 casas (`t4`);
- datas `AAAA-MM-DD` (`diaDe`) e instantes ISO (`iso`);
- resumos ao lado de cada id: `usuarioPublico {id, nome}`; `bemPublico {id, numero, codigo_frota, nome, natureza}`;
  `centroPublico {id, numero, nome}`; área `{id, numero_area, nome}`;
- `empresa_id` vem na query (GET) ou no corpo (escrita) e é conferido contra o tenant (`exigirEmpresaDoTenant`);
- "hoje" é o dia no fuso da fazenda (`tempoDaFazenda`; sem fuso, falha fechado `EMPRESA_FUSO_NAO_CONFIGURADO`);
- decimais do corpo só como string, sem coerção do AJV, como no módulo antigo;
- motivo com no mínimo 3 caracteres úteis e no máximo 500;
- conflito de versão: 409 com `versao_atual` e `versao_informada`.

**Atividade (lista e detalhe):**

```
{ id, empresa_id, numero, nome, status, versao,
  tipo_atividade_id, tipo_atividade_nome, grupo_atividade_id, grupo_atividade_nome,
  area_id, area {id, numero_area, nome} | null, setor_id, setor_nome,
  bem_id, bem {…bemPublico} | null, safra_ciclo,
  centro_custo_id, centro_custo {…centroPublico} | null,
  centro_resultado_id, centro_resultado {…centroPublico} | null,
  unidade_producao_id, unidade_producao_sigla, unidade_producao {id, sigla, descricao} | null,
  data_inicio, data_prevista_fim, data_conclusao,
  area_planejada, area_executada, quantidade_produzida,
  lancamento_tarefa_id, lancamento_tarefa {id, numero, nome?} | null, observacao,
  concluida_em, concluida_por {…usuarioPublico} | null,
  cancelada_em, cancelado_por {…usuarioPublico} | null, motivo_cancelamento,
  reaberta_em, reaberta_por {…usuarioPublico} | null, motivo_reabertura,
  criado_por {…usuarioPublico} | null, createdAt, updatedAt }
```

O detalhe (`GET /atividades/:id`) acrescenta `totais: { apontamentos_confirmados, apontamentos_cancelados,
dias_com_apontamento }`. A lista devolve a mesma forma de lista paginada do módulo antigo (`listarApontamentos` →
helper keyset; mesmo envelope).

**Corpo de criar:**
- `{ empresa_id, nome, tipo_atividade_id, area_id?, bem_id?, safra_ciclo?, data_inicio?, data_prevista_fim?,
  area_planejada?, lancamento_tarefa_id?, observacao? }`;
- `PATCH`: os mesmos menos `empresa_id` e `tipo_atividade_id`, mais `versao` obrigatória.

**Corpos das ações:**
- `concluir {empresa_id, versao, data_conclusao?}`;
- `reabrir {empresa_id, versao, motivo}`;
- `cancelar {empresa_id, versao, motivo}`;
- `duplicar {empresa_id, nome?, data_inicio?, data_prevista_fim?}`.

Toda escrita devolve a atividade no formato do detalhe.

**Apontamento:**

```
{ id, empresa_id, atividade_id, data_operacional, turno, sequencia,
  operador_usuario_id, operador {…usuarioPublico} | null,
  area_executada_dia, quantidade_produzida_dia, observacao, origem, status, versao,
  cancelado_em, cancelado_por {…usuarioPublico} | null, motivo_cancelamento,
  criado_por {…usuarioPublico} | null, createdAt, updatedAt }
```

- **Lista:** `GET /atividades/:id/apontamentos` devolve `{ items: [...] }` (sem paginação; ordem
  `data_operacional desc, turno, sequencia`).
- **Escritas:** criar, editar, cancelar e duplicar devolvem `{ apontamento, atividade, alertas }`.
  - `atividade` é o cabeçalho com os totais recalculados.
  - `alertas` é `[]` ou `[{ codigo: 'FORA_DO_INTERVALO', mensagem, data_inicio, data_prevista_fim }]`.
- **Corpo de criar:** `{ empresa_id, data_operacional, turno?, operador_usuario_id?, area_executada_dia?,
  quantidade_produzida_dia?, observacao?, origem? }`.
- **Corpo de editar:** os mesmos campos de dado mais `versao`.
- **Corpo de cancelar:** `{ empresa_id, versao, motivo }`.
- **Corpo de duplicar:** `{ empresa_id, data_operacional? }`.

**Opções:**
- `GET /atividades-opcoes/bens` e `GET /atividades-opcoes/operadores` (`?empresa_id=&q=&cursor=&limit=`), no formato
  de opções do módulo antigo (`opcoesBens`, `opcoesResponsaveis`), com a guarda "ver";
- tipos, áreas e tarefas reusam as rotas que já existem e só pedem login (`/tipos-atividade`, que já traz as flags e
  os padrões; `/areas-pastagem`; `/lancamentos-tarefa`), como a tela antiga.

**Erros novos** (`errorCodes.js`, prefixo `ATIVIDADE_`):

| Código | HTTP | Quando |
|---|---|---|
| `ATIVIDADE_NOT_FOUND` | 404 | atividade não encontrada |
| `ATIVIDADE_APONTAMENTO_NOT_FOUND` | 404 | apontamento não encontrado |
| `ATIVIDADE_REFERENCIA_INVALIDA` | 422 | `field`; `reason` `inexistente` \| `inativo` \| `outra_empresa` \| `grupo_inativo` |
| `ATIVIDADE_EXIGIDA_PELO_TIPO` | 422 | `field` `area_id` \| `safra_ciclo` \| `bem_id` \| `quantidade_produzida` |
| `ATIVIDADE_DATA_INVALIDA` | 422 | `field`; `reason` `futura` \| `antes_do_inicio` \| `periodo_invertido` \| `data_inexistente` |
| `ATIVIDADE_STATUS_INVALIDO` | 409 | ação não permitida no status atual; `details.status`, `details.acao` |
| `ATIVIDADE_VERSAO_CONFLITO` | 409 | conflito de versão |
| `ATIVIDADE_MOTIVO_INVALIDO` | 422 | motivo ausente, curto ou longo |
| `ATIVIDADE_VINCULADA` | 409 | excluir cadastro usado por atividade ou apontamento (P2003 reconhecido pelo nome da FK) |

**Exclusão de cadastro usado por atividade.** Um tradutor novo, `shared/errors/vinculoAtividade.js`, substitui
`vinculoApontamentoAtividade.js`. Ele reconhece as FKs `Atividade_*` e `AtividadeApontamento_*` com regex **ancorada**
(`Atividade_…_fkey` é substring de `TipoAtividade_…_fkey`). Entra no `errorHandler` (P2003 e P2010/23503 → 409
`ATIVIDADE_VINCULADA`) e nas exclusões de Tipo de Atividade, Grupo de Atividade e Unidade de Medida, que hoje usam o
tradutor antigo. Assim, excluir tipo, grupo, área, setor, unidade, tarefa, bem ou centro usado por atividade devolve
409, nunca o 403 genérico (lição da #259).

**Lote de estoque.** O ramo de `estoqueLoteNotaService.js` que conta `apontamentoAtividadeItemConsumoLote` sai, porque
o delegate do Prisma deixa de existir. O motor FIFO e a reconciliação não mudam nesta fatia: as referências à origem
do apontamento são protegidas por `to_regclass` e viram código morto inofensivo até a Fatia 3.
