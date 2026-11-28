# MAIKE — Estoque na unidade do cadastro, UE-1 (relatório, D-PROD-371)

**Data:** 2026-11-27 · **Decisão:** [D-PROD-371](./DECISIONS.md) · **SPEC:** [`MAIKE-ESTOQUE-UNIDADE-CADASTRO-SPEC.md`](./MAIKE-ESTOQUE-UNIDADE-CADASTRO-SPEC.md) ·
**Branch:** `claude/estoque-unidade-cadastro` · **Migration:** `20261127200000_estoque_unidade_cadastro` (CONTRACT, **aplicada em produção em
2026-11-27**, antes do merge da PR #460) · **Runbook:** [`MAIKE-ESTOQUE-UNIDADE-CADASTRO-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-UNIDADE-CADASTRO-RUNBOOK-RELEASE.md)

## 1. Pedido

O proprietário pediu: "a unidade de estoque para a conversão tem que ser a unidade do cadastro principal". Ele escolheu
"Estoque na unidade que eu escolher" e aprovou a emenda da Constituição (texto em `00-CONSTITUICAO.md` e `07-DO-NOT-DO.md`).
Esta PR é a UE-1 da SPEC (§4).

## 2. O que mudou

### Banco

A migration `20261127200000_estoque_unidade_cadastro` recria 6 CHECKs mais largos, com o mesmo nome:

| CHECK | Antes | Depois |
|---|---|---|
| `ProdutoUnidadeConversao_sigla_check` | não vazia, maiúscula, `NOT IN ('KG','L','UN')` | não vazia, maiúscula |
| `EntradaEstoqueItem/SaidaEstoqueItem/AjusteEstoqueItem_unidade_check` | não vazia e `<> 'UN'` | não vazia |
| `OperacaoFinanceiraItem_forma_check` | mercadoria com `unidade <> 'UN'` | mercadoria sem essa condição (o serviço continua `= 'UN'`) |
| `AtividadeApontamentoProduto_valores_check` | `unidade IN ('L','KG')` | unidade não vazia (o resto igual) |

- É uma CONTRACT condicionada, no formato de sempre.
- A guarda falha fechada. Ela usa `lock_timeout`/`statement_timeout`, a trava 72707369, confere as 6 tabelas e os 6 CHECKs no formato anterior, e trava as 6 tabelas em `ACCESS EXCLUSIVE`.
- Depois vêm as 12 instruções pinadas. Não há DML.
- **SHA-256:** `f9719220fd738d6a522fa0c0967c77dcde0dd6fa498d9ef31744b2387878a77f`.
- **Guarda:** `8d78338bcd424a644f78ea2a2bc2e506a71af7c57b23c87cf60271224b7a9af7`.

Registro feito:
- o manifesto e a entrada em `MIGRATIONS_CONTRACT_APROVADAS` (`scripts/deploy/premergeMigrateLib.mjs`, decisão D-PROD-371);
- os testes do premerge (B1, B8-0, contagens de pastas 83 → 84, posições do manifesto e os novos B49a/b/c);
- o runner (B31 em `migrations.test.mjs` e AB-05);
- os ensaios das CONTRACT antigas (`ensaio-categoria-manejo-cadcategoria`, `ensaio-patrimonio-simplifica` e os testes deles, mais `estoqueEntradasMotivosMigration`), com a nova fora da partida.

O preflight de schema não pina CHECK e ficou igual.

### Servidor

- `produtoUnidadesConversao.js`:
  - `unidadeEstoqueEfetiva` devolve a sigla real (aparada, em maiúsculas), e KG para o SACO legado e para o vazio;
  - `resolverUnidade` usa fator 1 na própria unidade e só recusa KG ↔ L (`unidade_incompativel`). O resto vai às conversões: um produto em SC lança em KG pela conversão KG;
  - `normalizarConversoes` não reserva mais KG, L e UN, e recusa KG num produto em L e L num produto em KG (`conversao_kg_l`);
  - `SIGLAS_RESERVADAS` saiu.
- `produtoService.js`:
  - o domínio da unidade de estoque é KG, L ou uma sigla ATIVA do cadastro de Unidades do tenant (do `auth_context`), em maiúsculas e com até 8 caracteres;
  - o SACO é só legado (nenhum produto passa a SACO). Fora disso, 400 `unidade_invalida` (`details.permitidos = ['KG','L']`, `details.cadastro = 'unidades_medida'`);
  - o corpo que traz só `unidade_medida` grava a mesma sigla nas duas colunas: na criação sempre, na edição só quando ela muda;
  - qualquer troca da unidade efetiva exige produto sem histórico. A ordem é `estoque` → `lotes` → `movimentos` → `lancamentos`, e os lançamentos agora incluem os itens de entrada, saída, ajuste e linha de produto da atividade, além do item do financeiro;
  - KG ↔ SACO continua passando;
  - a regra do tanque não muda.
- Rótulos com a unidade real:
  - o movimento do motor (`estoqueFisicoMotor.js`, `unidade_medida`);
  - `unidade_estoque` da entrada, da saída e do ajuste;
  - a consulta do saldo (`unidadeDeEstoque`);
  - o desfazer da transferência.
- A linha de entrada, saída e ajuste aceita UN (o servidor não recusa mais `UN` no formato).
- **Trava até a UE-3:** a saída para o cocho (`comandoSaidaSuplementacao`) recusa produto com estoque fora de KG, com 422 `UNIDADE_LANCAMENTO_INVALIDA` e `reason: 'unidade_sem_peso'`. O L segue como antes.
- **Sem mudança:** abastecimento, patrimônio, tanque, financeiro (`operacaoFinanceiraPlano.js`) e as opções da atividade. Eles continuam recusando produto fora de KG/L (é a UE-2).

### Tela

- `FormularioProduto.jsx`:
  - a "Unidade de Medida" é a unidade de estoque. O seletor "Unidade principal de estoque" e o aviso de litros saíram, e a guia passa a se chamar "Estoque";
  - `unidadePrincipalDoFormulario` manda a sigla escolhida no produto novo ou quando a pessoa troca a Unidade de Medida. Sem troca, manda a unidade gravada, o que cobre o produto antigo com estoque noutra unidade e o SACO legado;
  - o "Estoque atual" mostra a unidade real ("12,5 kg", "0 SC");
  - quando o estoque gravado não é a Unidade de Medida mostrada, aparece um aviso;
  - o erro do servidor (409) aparece com a frase nova: "a unidade de estoque só muda em produto sem estoque, lotes, movimentos ou lançamentos. Cadastre um Produto novo na unidade SC".
- `UnidadesConversaoProduto.jsx`: KG, L e UN valem como conversão, e "Conversão entre KG e L não é permitida". O texto diz "Saldo e custo ficam sempre em <unidade real>".
- `unidadeLancamentoRegras.js` (`unidadeDeEstoqueDoProduto`, `rotuloDoEstoque` e o rótulo do seletor) e as regras do estoque (`estoqueEntradasRegras`, `estoqueSaidasRegras`, `estoqueAjustesRegras`, `estoqueConsultaRegras` e o saldo do ajuste em `estoqueAjustesApi`) usam a unidade real.
- O nível do depósito (`calcularNivelDeposito`) deixa o produto com estoque fora de KG fora do saldo em kg, com aviso. O detalhe do depósito mostra esse produto à parte, com a sigla, e o cartão do movimento usa a sigla real.

## 3. Testes

- **Novo:** `backend/tests/estoqueUnidadeCadastro.test.mjs`, com 8 testes.
  - Antes das mudanças do servidor: 0 de 8 passavam (vermelho).
  - Depois: 8 de 8.
  - Cobre: o domínio pelo cadastro (de outro tenant não vale), a Unidade de Medida como unidade de estoque e o produto em SC com "1 KG = 0,04 SC" (500 KG → 20 SC a R$ 50, movimento SC, saldo SC, UN na linha);
  - também: a troca com histórico (409 nas 4 razões, incluindo o rascunho do financeiro), `conversao_kg_l` e o cocho com produto em SC (422 `unidade_sem_peso`, nada gravado).
- **Adaptados à regra nova (nenhum apagado nem pulado):**
  - `estoqueP1M3Unidades` D1: SACO novo e as siglas fora do cadastro são recusados, e a sigla do cadastro cria. O teste continua conferindo `kg`/`Litro`/`L L`.
  - `produtoUnidadeLitros` P2/P3/P4: a troca L → SACO virou L → KG. O SACO legado volta a KG com histórico, e KG → SACO é recusado. UN do cadastro num produto aceito em tanque dá 409 `aceito_em_tanque`.
  - `produtoUnidadesConversao`: as recusas `sigla_reservada` viraram `conversao_kg_l` (L num produto em KG).
  - `patrimonioSimplificaMigration` SM-03: o `forma_check` final sem `<> 'UN'` e a recusa citando a D-PROD-371.
  - `patrimonioSimplifica02` C6, `patrimonioSimplificaAbastecimentos` e `patrimonioSimplificaTanqueProdutos` T7: o KG → SACO pela API virou SACO gravado por fora, como nos produtos antigos (ou UN do cadastro, no T7). A intenção não mudou: a unidade efetiva kg não trava, e o aceite que não vale não trava.
  - Os smoke `produtoUnidadeLitros` (PL-1 com o campo único e PL-3 com a frase nova) e `produtosBase1Rollout`.
- **Novos casos no smoke:** `produtoUnidadesConversao` (UC-3b, UC-4b, produto em SC) e `unidadeConvertidaRegras` (UCR-SC).
- **Resultados:** ver o §5.

## 4. Ensaio local da migration

No PostgreSQL 17 local, `deploy:migrate` levou de 83 para 84 migrations. Os CHECKs novos foram conferidos por
`pg_get_constraintdef`. Rodar a guarda de novo falha fechada: "os 6 CHECKs de unidade não estão no formato anterior".

## 5. Gates e suítes rodados

Rodados no PostgreSQL 17 local, com o banco migrado até a 84ª.

| O quê | Resultado |
|---|---|
| Backend, um arquivo por vez (208 arquivos fora os de migration) | 2704 passam e 3 falhavam (os 3 do patrimônio acima). Depois de adaptados: 13/13, 10/10 e 9/9 |
| Testes de migration do backend (20 arquivos, cada um com banco próprio) | todos passam, depois de registrar a nova (`estoqueEntradasMotivos` 5/5, `patrimonioSimplificaMigration` 14/14, `categoriaManejoCadcategoria` 20/20, os outros como antes) |
| `node --test scripts/tests/deploy/*.test.mjs` | `migrations` 113/113, `premerge-migrate` 231/231, `alvo-banco` 6/6, `preflight-schema` 10/10, `usuarios-bench-guard` 13/13 |
| `npm run test:gates` | 1104/1104 |
| `npm run test:smoke` (vitest, tudo) | 407 arquivos, 4932 testes, todos passam |
| `npm run verify:all` | todas as etapas passam (lint, `gate:types`, `typecheck:backend`, build, build:admin, todos os gates e o smoke). A exceção é `test:backend`, que não roda sem `DATABASE_URL` nesse comando; ele foi rodado à parte, na linha de cima |
| `gate:governance-paths`, `gate:product-scope`, `gate:tenancy`, `gate:indices`, `gate:deploy-migrations`, `gate:no-secrets`, `gate:base44`, `gate:import-integrity` | passam |
| eslint nos arquivos mudados | sem erro |

## 6. Fica para depois

- **UE-2:**
  - o financeiro (`exigirUnidadeCompativel`, as allowlists de `operacaoFinanceiraPlano.js` e as opções);
  - a linha de produto da atividade e as opções dela;
  - a transferência;
  - os rótulos das telas do estoque que ainda fixam kg/L (`TelaNovoMovimentoEstoque`, `CampoLotes`, `CamposAjusteEstoque`, `CancelarTransferenciaDeposito`, `ConsultaLancamento`, `RateioItensLancamento`);
  - a `FichaProduto`.
- **UE-3:** cocho, depósito e formulação pelo "kg por unidade de estoque" (SPEC §2.7), tirando a trava do cocho e do nível do depósito.
- **Atenção ao trocar a unidade de um produto sem histórico:** as conversões que já existem guardam o mesmo fator. Na tela, a prévia passa a mostrar a unidade nova (por exemplo, "1 SACO = 25 SC"), e a pessoa confere antes de salvar.
- **Para o proprietário decidir:**
  - o cadastro de Unidades pode ter "LT" ou "LITRO" em vez de "L". Escolher LT faz o estoque ficar em LT, que não é L: o abastecimento e a mistura do implemento não o aceitam. Até haver uma decisão, use a sigla L para combustível e defensivo em litros;
  - o cocho sem internet guarda o lançamento e só recebe a recusa (`unidade_sem_peso`) ao sincronizar.
