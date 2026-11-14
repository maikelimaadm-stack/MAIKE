# MAIKE-CADCATEGORIA-CURVA-GANHO — Relatório

**Branch `claude/kind-knuth-tztu1v` · PR em rascunho** · Decisão: [D-PROD-195](./DECISIONS.md) ·
Runbook: [`MAIKE-CADCATEGORIA-CURVA-GANHO-RUNBOOK-RELEASE.md`](./MAIKE-CADCATEGORIA-CURVA-GANHO-RUNBOOK-RELEASE.md)

## 1. Entrega

A **Categoria de Manejo** passa a ter uma **Curva de Ganho obrigatória**, da mesma
fazenda. É o primeiro passo para o peso projetado do lote: a categoria diz qual
curva usar, e várias categorias podem usar a mesma.

| Camada | O que entrou |
|---|---|
| Banco | `CADCATEGORIA.curva_ganho_id NOT NULL` com FK composta `(cliente_id, empresa_id, curva_ganho_id) → CADCURVAGANHO(cliente_id, empresa_id, id)`, `RESTRICT`; `UNIQUE (cliente_id, empresa_id, id)` em `CADCURVAGANHO`; índice na categoria. Migration **CONTRACT** `20261114200000_cadcategoria_curva_ganho` com guarda e ligação das categorias existentes à `'CURVA PADRÃO'` da fazenda |
| Dado prévio | `'CURVA PADRÃO'` (0,100 kg/dia nos 12 meses) cadastrada pelo banco na única fazenda com categorias, a pedido do proprietário (runbook §7) |
| Release | manifesto e contrato fechado `D-PROD-195` (5 instruções pinadas); runbook com caminhos A e B; testes do ferramental e de migration |
| Backend | formato público com `curva_ganho_id` e `curva_ganho_nome`; curva obrigatória, da mesma fazenda e ativa quando informada; opções `GET /categorias-manejo-opcoes/curvas-ganho`; excluir curva em uso → 409 `CURVA_GANHO_EM_USO` |
| Frontend | campo "Curva de ganho" no formulário (e no cadastro rápido do lote), coluna na lista (chave `_v2`), aviso ao excluir curva em uso; criar categoria só online (criação antiga na fila offline fica retida) |
| Docs | D-PROD-195, este relatório, runbook, `CURRENT-STATE` |

## 2. Por que assim

- **Obrigatória também no banco.** O proprietário pediu a curva obrigatória e,
  para isso, a `'CURVA PADRÃO'` nas categorias que já existiam. A ligação das
  categorias antigas fica **dentro** da migration (versionada, testada, com
  guarda), e não num comando solto: a guarda recusa se faltar a CURVA PADRÃO em
  alguma fazenda com categoria.
- **Mesma fazenda pelo banco.** A FK composta com `empresa_id` impede apontar
  para a curva de outra fazenda, mesmo por um caminho que pule o serviço.
- **Exceção fechada, sem alargar a allowlist.** A FK entre duas tabelas antigas, o
  `UNIQUE` em tabela antiga, o `UPDATE` e o `SET NOT NULL` não cabem no caminho
  EXPAND. Como nas D-PROD-162, 183, 187 e 194, entram como texto pinado de uma
  entrada nomeada; o mesmo SQL com outro nome continua recusado.
- **Opções sem a tela de curvas.** Quem cria categoria pelo cadastro rápido do lote
  nem sempre tem a tela de curvas; o seletor usa um endpoint de opções que devolve
  só `id`, `nome` e `ativo`.

## 3. Validação local

| Comando | Resultado |
|---|---|
| ensaio manual da migration (PG 16, banco novo com as 49 migrations, 2 fazendas com categorias) | recusa a fazenda sem CURVA PADRÃO e a reaplicação, desfazendo tudo; com as CURVA PADRÃO, liga cada categoria à da própria fazenda; o banco recusa curva de outra fazenda, categoria sem curva e exclusão de curva em uso; `migrate diff` vazio |
| testes, gates e `verify:all` | ver §5 |

## 4. Release

1. A migration é **CONTRACT** e foi **aplicada em produção em 2026-11-14 14:51:56 UTC** (caminho B, GO escrito do proprietário; conferência no §7 do runbook).
2. Ordem: análise local (o GitHub Actions do proprietário está pausado) → GO do
   proprietário → preflight → aplicação (caminho A com `--contract D-PROD-195`, ou
   B só com GO escrito e específico) → conferência → **merge imediato** → deploy →
   smoke. Ver o runbook.
3. Entre o `COMMIT` e o deploy, **criar** categoria falha (o runtime antigo não
   grava a coluna obrigatória) e excluir uma curva ligada a categoria é barrado
   pela FK com um 403 `TENANT_SCOPE_VIOLATION` enganoso no lugar do 409. Nada se
   perde.
4. Criar categoria passa a ser **só online**; uma criação antiga na fila offline
   fica retida, sem travar o resto da fila.

## 5. Verificação completa e revisão

Com o GitHub Actions do proprietário pausado, a análise foi local.

| Verificação | Resultado |
|---|---|
| Revisão independente do commit `a2de2c56` (2 lentes, um cético por achado) | 3 achados confirmados, todos corrigidos em `3295a12b`: (1) POST de categoria gravado na fila offline pela versão anterior travaria a fila inteira → criar categoria passa a ser só online e o item antigo fica retido; (2) criar categoria offline já não era possível sem as opções de curva → registrado como decisão; (3) a janela entre a migration e o deploy também afeta excluir curva em uso (403 do runtime antigo) → docs corrigidas |
| smoke da correção (`categoriaManejoCriacaoOnline`, `categoriaManejoEnxuto`, `categoriaManejoCurvaGanho`, `offlineRuntime`) | 56/56 |
| `verify:all` no commit `a2de2c56` (banco dedicado `maike_verify`) | **TODAS AS ETAPAS PASSARAM** (exit 0), terminado depois do merge: backend 1.900 testes (1.895 passaram, 0 falhas, os demais pulados), smoke 229 arquivos e 2.827 testes. O merge não esperou o fim porque, com a migration aplicada, criar categoria ficava quebrado até o deploy. As etapas finais (smoke em diante) já leram a árvore com a primeira versão da emenda R2, que só muda o frontend |
| aplicação em produção e conferência | ver runbook §7 |

## 6. Emenda R2 — fila offline (depois do merge)

A segunda revisão independente, do commit `3295a12b`, confirmou três problemas
na retenção da criação antiga de categoria. Estavam no ar desde o merge da PR
#278, mas só afetam quem tem uma categoria criada sem conexão pela versão
anterior e ainda não sincronizada:

| Achado | Correção (D-PROD-195, emenda R2) |
|---|---|
| Um lote criado offline apontando para a categoria retida ia ao servidor com `categoria_manejo_id = 'offline_…'` e era gravado com referência solta | No replay, um `create` que cita uma criação retida pela política fica retido junto (`quarentena.depende_de`), em qualquer ordem; a edição de um registro real que a cita vai sem esses campos (sem resto, sai da fila); edição ou exclusão do registro retido fica junto dele. Outros ids offline seguem como antes |
| A categoria retida aparecia em todas as listas, inclusive online | Para entidade com criação só online, nem o `create` da fila nem a cópia `offline_…` do cache entram nas listas, sem depender de sincronizar antes |
| Criar categoria online deixou de pôr o registro no cache offline | Política `criacao: 'somente_online'` no runtime, que grava o registro confirmado no cache |

A terceira revisão independente, feita sobre a primeira versão desta emenda,
mostrou que reter **todo** id `offline_…` sem mapeamento escondia para sempre
cadastros legítimos de outras entidades. Um exemplo é o lote cuja área foi criada
numa sincronização anterior, porque o mapa de ids vale só para uma passada. A regra
ficou restrita às criações retidas pela política e conhecidas antes do laço. A lista
também passou a esconder a cópia `offline_…` do cache e decide pela política, sem
esperar um replay. A quarta revisão mostrou que reter a **edição de um lote real**
que citava a categoria retida a deixava por cima do servidor nas listas e travava a
exclusão do lote; agora essa edição vai sem o campo que cita a categoria.

Sem migration. Testes: `categoriaManejoCriacaoOnline` (8, entre eles lote dependente
nas duas ordens, lista sem a retida pela fila e pelo cache, cache depois de criar
online e outro id offline que não é retido), `offlineRuntime`,
`estoqueP0FilaOfflineLegada`, `loteDeleteOfflineBloqueado` e
`loteExclusaoCacheOffline`: 63/63. Com o runtime anterior, 5 dos 8 falham.

