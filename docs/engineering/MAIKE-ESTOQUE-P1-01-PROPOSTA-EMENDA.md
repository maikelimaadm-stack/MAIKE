# MAIKE-ESTOQUE-P1-01 — Proposta de emenda constitucional (entrada manual documentada)

> **STATUS: PROPOSTA, AGUARDANDO APROVAÇÃO EXPRESSA DO PROPRIETÁRIO.**
>
> - Este documento **não emenda** nada. Os arquivos `docs/constitution/00-CONSTITUICAO.md` e `docs/constitution/07-DO-NOT-DO.md` **não foram alterados** nesta PR.
> - Enquanto a emenda não for ratificada e incorporada, continuam valendo:
>   - a proibição de entrada de estoque avulsa (a **expansão** D-PROD-155 no `00` e a **nota** D-PROD-155 no `07`);
>   - a D-PROD-08 e as notas posteriores dela.
> - **O merge desta PR de documentação não equivale à emenda nem a aprova.** Isso difere do padrão D-PROD-22/155/157/159/162, em que o merge manual materializava a aprovação.
> - Decisão candidata: **D-PROD-176** (proposta pendente em `DECISIONS.md`).
> - Missão: MAIKE-ESTOQUE-P1-01-GOVERNANCA-R1.
> - Base: `origin/main` `74ad3b868ff947f0153c969c51852748690f78a2`.
> - Contrato técnico: [`MAIKE-ESTOQUE-P1-CONTRATO.md`](./MAIKE-ESTOQUE-P1-CONTRATO.md).

## 1. Por que o agente não edita a constituição

- **`08-REGRAS-DE-IA.md` §6, A10:** "NÃO faça: Emendar a constituição".
- **`00-CONSTITUICAO.md` §4:** alterar a constituição exige três coisas:
  - registro em `DECISIONS.md`;
  - justificativa escrita;
  - **aprovação explícita do responsável**.
  "Agente de IA não emenda a constituição — apenas propõe."
- **Hierarquia normativa** (`00-CONSTITUICAO.md` §3): constituição > `07-DO-NOT-DO.md` > `08-REGRAS-DE-IA.md` > `DECISIONS.md` > `ROADMAP.md` > escopo.
  - Uma decisão (nível 4) não supera a proibição do `07` (nível 2) nem a expansão da constituição (nível 1).
  - Por isso, a D-PROD-176 sozinha **não** libera a entrada manual: a emenda precisa estar nos dois textos superiores.

**Mecanismo já usado no repositório (descrito, não presumido):**
- Nas D-PROD-155, 157, 159 e 162, o agente redigiu o texto **dentro** dos arquivos constitucionais.
- O próprio texto diz: "Texto redigido pelo agente; vale com a aprovação explícita do proprietário no merge manual (§4)".
- Esta missão determinou **não** usar esse caminho: aqui o agente só propõe.

## 2. Justificativa

**Direção do proprietário.** A semântica do estoque segue a dos lotes de animais:
- Produto é cadastro;
- a quantidade nasce de um **documento de entrada confirmado**;
- toda movimentação é fato autônomo, produzido por comando do motor único;
- o histórico nunca é reescrito.

**Lacuna real.** Hoje o único jeito de introduzir quantidade é confirmar uma **compra** na Central de Lançamentos (D-PROD-155; `operacaoFinanceiraService.js:1374`). Ficam sem caminho legítimo:
- o saldo físico que já existia quando o produto passou a ser controlado (implantação);
- as doações.

Hoje esses casos empurram o usuário a duas saídas ruins:
- inventar uma compra, o que falsifica o financeiro;
- ou não registrar nada, o que esconde estoque.

**Risco controlado:**
- 3 motivos fechados, nenhum deles compra, inventário, devolução ou "saldo antigo por outro nome";
- motor único, sem escritor genérico;
- sem título nem receita;
- deduplicação documental com a Central nos dois sentidos e entre entradas (contrato §3, A5);
- nenhum domínio proibido reaberto.

## 3. Texto exato proposto — `docs/constitution/00-CONSTITUICAO.md`

**Onde:** inserir um parágrafo novo **depois** do parágrafo "Revisão autorizada pelo proprietário (D-PROD-162)", ou seja, depois da linha que termina em "no merge manual (§4).", e **antes** de "## 2. Princípios fundadores". O parágrafo vai precedido e seguido de uma linha em branco.

**Texto a vigorar SOMENTE após a ratificação (literal, variante estrita):**

```markdown
**Expansão autorizada pelo proprietário (D-PROD-176):** **Estoque — entrada manual
documentada** (missão MAIKE-ESTOQUE-P1). Além da compra confirmada da Central Única de
Lançamentos, a quantidade de estoque também pode nascer de um **documento de Entrada de
Estoque** confirmado, só pelo motor de estoque único e só por um destes motivos fechados:
saldo de implantação (uma única vez por produto e empresa, e só se o produto não tiver
nenhum histórico físico em nenhum local), doação e outra causa com justificativa e
permissão própria. Doação e outra causa não servem para registrar saldo antigo. A entrada
manual não é compra, não cria título, conta a pagar nem receita, e não pode duplicar um
lançamento da Central nem outra entrada: com o mesmo parceiro e documento, um bloqueia o
outro. O rascunho não mexe no estoque; a confirmação cria fato e camada; o cancelamento
só estorna se nada tiver sido consumido ou transferido. O Cadastro de Produtos continua
sem lançar estoque. Continua **fora**: entrada por compra fora da Central, ajuste ou
inventário, devolução, transferência entre empresas, entrada por nota fiscal, edição de
saldo e qualquer escritor genérico de estoque. O MAIKE não volta a ser ERP amplo. Nesta
parte, esta expansão supera apenas o trecho "não há tela avulsa de entrada" da expansão
D-PROD-155; o resto da D-PROD-155 continua valendo. Texto proposto pelo agente; vale só
com a aprovação explícita do proprietário (§4), registrada como ratificação na D-PROD-176.
```

**Variante aberta (só se a R-IMPL for aprovada; ver contrato §3, A3).** Trocar `nenhum histórico físico em nenhum local)` por:

```markdown
nenhum histórico físico em nenhum local, salvo os fatos de implantações canceladas sem
consumo)
```

## 4. Texto exato proposto — `docs/constitution/07-DO-NOT-DO.md`

### 4.1 Nota nova

**Onde:** inserir **ao final do arquivo**, depois da nota "Nota (D-PROD-159, revista pela D-PROD-162)". A posição mantém a ordem cronológica das notas (155, 157, 159, 176). O bloco vai precedido de uma linha em branco, para não se fundir com o blockquote anterior.

**Texto a vigorar SOMENTE após a ratificação (literal):**

```markdown
> **Nota (D-PROD-176):** o documento de Entrada de Estoque, nos limites da decisão e da
> expansão constitucional, é a única exceção à proibição de "criar entrada de estoque
> avulsa" da nota D-PROD-155. Continua proibido:
> - lançar estoque pelo Cadastro de Produtos, por CSV, por rota genérica de movimento ou de
>   lote, ou por qualquer caminho fora do motor de estoque (`estoqueFisicoMotor.js`);
> - usar a entrada manual como compra, inventário/ajuste, devolução, transferência entre
>   empresas ou entrada por nota fiscal, ou criar título, conta a pagar ou receita a partir
>   dela;
> - usar doação ou outra causa para registrar saldo antigo (pré-existente);
> - confirmar uma entrada manual com o mesmo parceiro e documento de um lançamento
>   confirmado da Central (a pagar ou a receber) ou de outra entrada confirmada;
> - implantar saldo de um produto que já tenha histórico físico em qualquer local;
> - cancelar uma entrada cujas camadas já foram consumidas ou transferidas, ou estorná-la
>   em parte;
> - conceder a tela ou as ações da entrada a perfis existentes por padrão;
> - reabrir qualquer nome de `forbiddenDomains` (`config/mapa-manejo-scope.json`), em
>   especial `MovimentacoesEstoque`, `LancamentoProdutosEstoque`, `RelatoriosEstoque`,
>   `Relatorios`, `Dashboard` e `Home`.
```

Variante aberta da R-IMPL: acrescentar ", salvo os fatos de implantações canceladas sem consumo" ao item "implantar saldo…".

### 4.2 Esclarecimento sobre SACO no abastecimento

**Problema.** A D-PROD-169 fez o tanque aceitar Produto em `SACO`, que abastece digitando quilos e grava `KG` (`produtoService.js:154-158`; `abastecimentoPlano.js:14-17`). A nota "D-PROD-159, revista pela D-PROD-162" do `07` fala só em `L` ou `KG`.
- Pela §3 da constituição, uma decisão (nível 4) **não** supera o `07` (nível 2).
- Há, portanto, um **conflito normativo pré-existente**, e não só redação: até a ratificação, prevalece o texto do `07`.
- A ratificação regulariza o comportamento já em produção.

**Substituições literais dentro da nota "Nota (D-PROD-159, revista pela D-PROD-162)":**

**S1.** Trocar

```markdown
> **exatamente** a quantidade digitada na unidade de estoque do Produto (`L` ou `KG`).
```

por

```markdown
> **exatamente** a quantidade digitada na unidade física de estoque do Produto (`L`, ou `KG`
> para Produto em `KG` ou `SACO`).
```

**S2.** Trocar

```markdown
> - abastecer Produto cuja unidade de estoque não seja `L` nem `KG`;
```

por

```markdown
> - abastecer Produto cuja unidade física de estoque não seja `L` nem `KG` (um Produto em
>   `SACO` tem unidade física `KG` e abastece digitando quilos, sem conversão pelo peso do
>   saco, conforme a D-PROD-169);
```

**S3.** Trocar

```markdown
> - deixar a tela de abastecimento de Produto em `KG` sem o aviso de que se digitam quilos;
```

por

```markdown
> - deixar a tela de abastecimento de Produto em `KG` ou `SACO` sem o aviso de que se
>   digitam quilos;
```

**S4.** Trocar

```markdown
>   unidade que não seja `L` nem `KG` (ex.: GNV em m³).
```

por

```markdown
>   unidade física que não seja `L` nem `KG` (ex.: GNV em m³).
```

- O esclarecimento não cria conversão `L ↔ KG` e não amplia unidades.
- A tela já trata a dica para KG e SACO (`src/components/patrimonio/FormularioAbastecimento.jsx:192`). Reconferir na ratificação.

**No `00`:** a revisão D-PROD-162 diz "na unidade de estoque do Produto (litros `L` ou quilos `KG`)". Propõe-se acrescentar, logo depois de "quilos `KG`", o texto literal `; um Produto em sacos (`SACO`) abastece em quilos, conforme a D-PROD-169`.

### 4.3 O que a emenda NÃO faz
- Não retira nome algum de `forbiddenDomains`.
- Não cria página nem rota.
- Não concede permissão.
- Não autoriza código: cada slice continua precisando da própria missão e, se houver DDL, de GO e runbook.

## 5. Como ratificar (decisão do proprietário)
1. **Decidir a R-IMPL antes** (variante estrita ou aberta), porque ela muda o texto da §3 e da §4.1.
2. Aprovar ou ajustar os textos da §3 e da §4.
3. Incorporar o texto nos dois arquivos de uma destas formas:
   - **(a)** o próprio proprietário edita e mergeia;
   - **(b)** o proprietário autoriza **por escrito** uma PR de agente nomeada, citando o texto exato aprovado; a PR copia só esse texto, e o proprietário a mergeia manualmente.
     - A PR (b) só é compatível com a A10 pela leitura de precedente de que o merge manual do proprietário materializa a aprovação (D-PROD-22/155/157/159/162).
     - Sem autorização escrita que nomeie a PR e o texto, só vale o caminho (a).
4. Registrar na D-PROD-176 uma nota posterior: "ratificada em <data> por <responsável>, texto incorporado em <SHA>".
   - Se for recusada: nota "recusada em <data>". O número não é reaproveitado (registro append-only).
5. Só depois disso começam a P1-02, a P1-05 e a P1-06.
   - A divisão da P1-02 em uma parte sem a origem de entrada manual (R-SPLIT, contrato §8) só vale com autorização expressa.

## 6. Conflitos de hierarquia mapeados

| Texto vigente | Nível | Conflito com a proposta | Como fica |
|---|---|---|---|
| `00-CONSTITUICAO.md`, expansão D-PROD-155: "não há tela avulsa de entrada" | 1 | Direto | Superado **só nesse trecho** pela expansão D-PROD-176 (§3), se ratificada |
| `00-CONSTITUICAO.md`, revisão D-PROD-162: "litros `L` ou quilos `KG`" | 1 | Não menciona o SACO da D-PROD-169 | Esclarecimento proposto na §4.2 |
| `07-DO-NOT-DO.md`, nota D-PROD-155: "criar entrada de estoque avulsa (tela ou rota própria)" | 2 | Direto | Exceção pela nota D-PROD-176 (§4.1), se ratificada |
| `07-DO-NOT-DO.md`, nota D-PROD-159/162: "`L` ou `KG`" (quatro trechos) | 2 | Conflito **pré-existente** com a D-PROD-169 (nível 4 não supera nível 2) | Esclarecimento §4.2. Até lá, prevalece o `07` |
| `DECISIONS.md` D-PROD-08 (nota da D-PROD-155): "não há tela avulsa de entrada" | 4 | Direto | Nota posterior datada, só depois da ratificação. O texto original fica preservado |
| `DECISIONS.md` D-PROD-161 e `ROADMAP.md`: a entrada manual da P1 incluía "ajuste" e "devolução" | 4–5 | Escopo: a proposta **exclui** os dois | A D-PROD-176, se ratificada, delimitará os motivos. O ROADMAP ganha uma nota prospectiva, sem reescrever o histórico |
| `config/mapa-manejo-scope.json` | 6 | Nenhum agora | A página candidata `EntradasEstoque` só entraria no escopo na P1-06 |
