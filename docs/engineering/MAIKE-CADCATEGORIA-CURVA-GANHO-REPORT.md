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

1. A migration é **CONTRACT** e **não foi aplicada em nenhum banco remoto**.
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

_(preenchido ao fim da missão.)_
