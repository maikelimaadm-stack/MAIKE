# MAIKE-ATIVIDADES-FASE1 — tipos fixos e formulário único (D-PROD-258)

**Data:** 2026-11-19 · **Branch:** `feat/atividades-tipos-fixos` (a partir da `main` `75464e88`) · **Estado:** commits só locais, sem push nem PR · **Migration:** nenhuma

Escopo: só serviços de **pasto**. Fora: nutrição, suplementação, cocho, depósito, Colheita, Manejo animal.

## 1. O que mudou

| Área | Antes | Depois |
|---|---|---|
| Tipo fixo | `categoria` opcional (9 valores), só escolhia o ícone | `categoria` **obrigatória**, 7 tipos fixos (Preparo do solo, Formação de pastagem, Fertilização, Aplicação, Roçada e tratos, Manutenção, Outros) |
| Cadastro | Tipo de atividade com 17 campos | Operação: **Tipo + Nome + Ativo** |
| Padrões | o usuário decidia grupo, centros, unidade, 8 chaves | servidor dá o padrão: grupo `GERAL`, `exige_area` e as 4 `permite_*` ligadas |
| Registrar serviço | área + tipo (lista única); seções conforme as chaves | área + **tipo fixo → operação (filtrada)**; **4 seções sempre visíveis**, todas opcionais |
| Manejos do mapa | tela de tipos, depois formulário | abre **direto o mesmo formulário**, área preenchida |
| Telas de atividade | Grupo e "o que o tipo permite" visíveis | Grupo e chaves escondidos (nada apagado no banco) |

Mapeamento dos valores gravados (sem mudar o CHECK do banco): `PREPARO_SOLO`, `PLANTIO`, **`TRATO_CULTURAL` = Fertilização**, `APLICACAO`, **`PASTAGEM` = Roçada e tratos**, **`BENFEITORIA` = Manutenção**, `OUTROS`.

Arquivos principais: `backend/src/modules/tiposAtividade/{tipoAtividadePadroes,tipoAtividadeService,tipoAtividadeRoutes}.js`, `src/lib/tiposFixosAtividade.js`, `src/components/tipos-atividade/*`, `src/components/lancamento-atividades/{RegistroDeCampo,JanelasDaLinha,FormularioAtividade}.jsx`, `src/components/mapa/DetalhesArea.jsx`, `scripts/ops/tipos-fixos-atividade-dados.mjs`.

## 2. Decisões de implementação (e por quê)

- **Sem migration.** Ampliar o CHECK de categoria para ter `FERTILIZACAO` é CONTRACT (D-PROD-72 item 3) e uma migration roda sozinha no deploy. Reaproveitei `TRATO_CULTURAL` para Fertilização; o rótulo muda, o valor não. Se o proprietário preferir um valor próprio, é uma decisão futura.
- **Chaves "exige_*" desligadas.** O pedido dizia "ligar as chaves". Liguei as que **permitem** (área e as quatro seções). `exige_safra`, `exige_maquina` e `exige_producao` ficam **desligadas**: ligadas, o servidor passaria a exigir safra, máquina e produção em todo registro, contrariando "todas as seções opcionais".
- **Categoria nullable no banco.** Obrigatória no servidor e na tela, mas a coluna continua aceitando nulo: registro antigo continua legível e editável (inativar etc.) sem tocar na categoria.
- **Dados fora da migration.** A atualização é um script com **dry-run por padrão**.

## 3. Script de dados (preparado; em produção a atualização foi feita à mão, ver §3.1)

`npm run ops:tipos-fixos-atividade` (`scripts/ops/tipos-fixos-atividade-dados.mjs`)

```
DATABASE_URL=... node scripts/ops/tipos-fixos-atividade-dados.mjs                  # dry-run: só lista
DATABASE_URL=... TIPOS_FIXOS_CONFIRM=sim node scripts/ops/tipos-fixos-atividade-dados.mjs \
    --aplicar --backup /caminho/antes.json [--cliente <id>]                        # grava
```

Regras: Aplicação/Trato cultural com nome de adubação → Fertilização; Trato cultural sem isso → Aplicação; Preparo do solo, Plantio, Aplicação, Pastagem, Benfeitoria e Outros ficam; Colheita, Manejo animal e sem categoria → Outros; chaves → padrão. Transação única, idempotente, backup do valor anterior, não imprime `DATABASE_URL`.

**Riscos:** (a) conferir a lista do dry-run antes (o nome decide Fertilização × Aplicação; operações sem categoria caem em Outros); (b) desligar `exige_*` muda a regra de quem registrava por aquela operação; (c) antes de rodar o script, operação antiga com `permite_*` desligado faz o servidor recusar a linha de insumo/serviço/mão de obra no formulário novo (mensagem "o tipo não permite…"): **rodar o script junto com a publicação**.

### 3.1 Execução em produção (2026-11-19)

O proprietário declarou que as atividades de produção eram **todas teste** ("se você quiser apagar o que já foi lançado pode, é apenas testes") e deu o GO escrito **"aplica"**. O script não foi usado (a sessão não tem `DATABASE_URL`): foi uma transação única pelo `execute_sql` do Supabase, com guardas antes (contagens exatas e o estado de cada operação) e depois.

| O quê | Antes | Depois |
|---|---|---|
| `Atividade` | 6 (nº 1 a 6: "TESTE (apontamento nº 1)", "TES (apontamento nº 2)", "teste", "Tetse", "COMBATE CONTRA CIGARRINHA", "teste") | 0 |
| `AtividadeArea` | 7 | 0 |
| `AtividadeApontamento` | 6 | 0 |
| `AtividadeApontamentoMaquina` | 3 (horímetro; uma sem medidor com custo R$ 2.850,00) | 0 |
| Produto, mão de obra, serviço, abastecimento ligado | 0 | 0 (nada de estoque nem de custo de pessoal foi tocado) |
| `TipoAtividade` | 3: TES (sem categoria, chaves desligadas), TESTE (sem categoria, exige máquina), COMBATE CONTRA CIGARRINHA (Aplicação, exige máquina, sem produto e sem mão de obra) | 1: **COMBATE CONTRA CIGARRINHA**, Aplicação, exige área, permite implemento, produto, serviço e mão de obra; não exige safra, máquina nem produção |

- **Medidor:** nada é gravado no bem pelas linhas de máquina (`abastecimentoMedidor.js`): a série do horímetro voltou ao ponto do cadastro.
- **Auditoria:** os eventos antigos ficam (histórico).
- **Numeração:** o contador de atividades não foi mexido; a próxima é a nº 7.
- **Cópia do antes:** as linhas apagadas foram lidas (JSON completo) antes da transação, no registro da sessão; os valores essenciais estão na tabela acima.
- Migrations: 70, sem mudança.

## 4. Verificação

Ver a seção de resultados no resumo da entrega (números de build, lint, testes). Testes novos/alterados:

- backend: `tipoAtividadeNativo.test.mjs` (categoria obrigatória e só os 7; legado legível; padrão automático de grupo e chaves; auditoria do grupo `GERAL`), `tiposFixosAtividade.test.mjs` (mapeamento puro + script em dry-run, aplicado e idempotente contra o banco descartável);
- frontend: `tiposAtividade.test.jsx` (formulário de 3 campos, 7 opções, envio só com 3 campos), `detalhesAreaHistorico.test.jsx` (Manejos abre o mesmo formulário, 4 seções, filtro operação por tipo, asterisco), `lancamentoAtividades.test.jsx` (Registrar serviço em dois passos; Grupo e chaves escondidos), `tiposFixosAtividade.test.js` (lib e paridade cliente × servidor).

## 5. Fica para as próximas fases

~~Várias linhas por seção (fase 2)~~ — **feito na D-PROD-262** ([relatório](./MAIKE-REGISTRO-VARIAS-LINHAS-REPORT.md)). ~~Várias áreas por registro (fase 3)~~ — **feito na D-PROD-263** ([relatório](./MAIKE-REGISTRO-VARIAS-AREAS-REPORT.md)). Ainda abertos: planejar antes de fazer, operação sem área (Manutenção), alinhar o filtro de Infraestrutura entre mapa e menu, remover a tela "Nova atividade", apagar colunas (GO do proprietário), colheita com produção.
