# MAIKE-ESTOQUE-P1-01 — Proposta de emenda constitucional (entrada manual documentada)

> **STATUS: PROPOSTA, AGUARDANDO APROVAÇÃO EXPRESSA DO PROPRIETÁRIO.**
>
> - Este documento **não emenda** nada. Os arquivos `docs/constitution/00-CONSTITUICAO.md` e `docs/constitution/07-DO-NOT-DO.md` **não foram alterados** nesta PR.
> - Enquanto a emenda não for ratificada e incorporada, continuam valendo:
>   - a proibição de entrada de estoque avulsa (a **expansão** D-PROD-155 no `00` e a **nota** D-PROD-155 no `07`);
>   - a D-PROD-08 e as notas posteriores dela.
> - **O merge desta PR de documentação não equivale à emenda nem a aprova.** Isso difere do padrão D-PROD-22/155/157/159/162, em que o merge manual materializava a aprovação.
> - Decisão candidata: **D-PROD-177** (proposta pendente em `DECISIONS.md`).
> - Missão: MAIKE-ESTOQUE-P1-01-GOVERNANCA-R1.
> - Base: `origin/main` `74ad3b868ff947f0153c969c51852748690f78a2`.
> - Contrato técnico: [`MAIKE-ESTOQUE-P1-CONTRATO.md`](./MAIKE-ESTOQUE-P1-CONTRATO.md).
> - **Revisão R2 (2026-11-11, ainda PROPOSTA):** a pedido do proprietário, o texto proposto passa a autorizar **Editar** e **Excluir** a entrada, com controles, versão e trilha auditável. Ele proíbe expressamente reescrever ou apagar fatos físicos. "Cancelar" deixa de ser a ação do usuário. O texto da R1 está no histórico do git desta PR (commit `3b49eac1`) e foi substituído pelo abaixo.

## 1. Por que o agente não edita a constituição

- **`08-REGRAS-DE-IA.md` §6, A10:** "NÃO faça: Emendar a constituição".
- **`00-CONSTITUICAO.md` §4:** alterar a constituição exige três coisas:
  - registro em `DECISIONS.md`;
  - justificativa escrita;
  - **aprovação explícita do responsável**.
  "Agente de IA não emenda a constituição — apenas propõe."
- **Hierarquia normativa** (`00-CONSTITUICAO.md` §3): constituição > `07-DO-NOT-DO.md` > `08-REGRAS-DE-IA.md` > `DECISIONS.md` > `ROADMAP.md` > escopo.
  - Uma decisão (nível 4) não supera a proibição do `07` (nível 2) nem a expansão da constituição (nível 1).
  - Por isso, a D-PROD-177 sozinha **não** libera a entrada manual: a emenda precisa estar nos dois textos superiores.

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

**Feedback do proprietário (R2).** A entrada deve ter **Editar** e **Excluir**, e o usuário não quer depender de "Cancelar" para corrigir. A proposta atende a isso sem abrir mão da imutabilidade dos fatos:
- a edição confirmada é uma **revisão** que estorna pelo motor e aplica de novo;
- a exclusão é **lógica**, com estorno integral;
- ambas só valem quando nenhuma camada de nenhum item da entrada foi usada. Além disso, nenhuma camada nova pode passar à frente, na fila FIFO, de camada que alguma baixa já tocou;
- com dependência, só se editam observação e justificativa, e a tela explica o motivo e o próximo passo.

## 3. Texto exato proposto — `docs/constitution/00-CONSTITUICAO.md`

**Onde:** inserir um parágrafo novo **depois** do parágrafo "Revisão autorizada pelo proprietário (D-PROD-162)", ou seja, depois da linha que termina em "no merge manual (§4).", e **antes** de "## 2. Princípios fundadores". O parágrafo vai precedido e seguido de uma linha em branco.

**Texto a vigorar SOMENTE após a ratificação (literal; variante proposta da R-IMPL):**

```markdown
**Expansão autorizada pelo proprietário (D-PROD-177):** **Estoque — entrada manual
documentada** (missão MAIKE-ESTOQUE-P1). Além da compra confirmada da Central Única de
Lançamentos, a quantidade de estoque também pode nascer de um **documento de Entrada de
Estoque** confirmado, só pelo motor de estoque único e só por um destes motivos fechados:
saldo de implantação, doação e outra causa com justificativa e permissão própria. Há no
máximo uma implantação ativa por produto e empresa, e ela só é aceita se o produto não
tiver nenhum histórico físico em nenhum local; os fatos de itens de entrada manual já
estornados por edição ou exclusão, que por regra nunca tiveram consumo, não contam como
histórico. Doação e outra causa não servem para registrar saldo antigo. A entrada manual
não é compra, não cria título, conta a pagar nem receita, e não pode duplicar um
lançamento da Central nem outra entrada: com o mesmo parceiro e documento, um bloqueia o
outro, nos dois sentidos. O usuário pode **editar** e **excluir** a entrada; o motivo
dela nunca muda. O rascunho não mexe no estoque. Na entrada confirmada, editar
quantidade, custo, unidade, fator, produto, local, data, parceiro ou documento, incluir
ou retirar item, ou excluí-la, só é aceito quando nenhuma camada de nenhum item dela foi
consumida, transferida ou citada por outro fato, mesmo que depois estornado; com essa
dependência, só se editam observação e justificativa. Ao confirmar ou editar, nenhuma
camada nova pode ficar, na fila FIFO do produto no local, à frente de camada que alguma
baixa já tocou: o motor não refaz nem recalcula baixas, e a mudança que faria isso é
recusada. A edição vira uma nova revisão do mesmo documento, que estorna pelo motor o que
muda e aplica a versão nova numa só transação; a exclusão estorna tudo e deixa o
documento EXCLUÍDO, fora da lista ativa mas consultável. Nenhum movimento ou camada de
estoque é reescrito ou apagado; cada revisão e cada exclusão da entrada confirmada ficam
registradas com autor, data, motivo e valores antes e depois. Não há estorno parcial de
camada nem exclusão parcial do documento. O Cadastro de Produtos continua sem lançar
estoque. Continua **fora**: entrada por compra fora da Central, ajuste ou inventário,
devolução, transferência entre empresas, entrada por nota fiscal, edição de saldo e
qualquer escritor genérico de estoque. O MAIKE não volta a ser ERP amplo. Nesta parte,
esta expansão supera apenas o trecho "não há tela avulsa de entrada" da expansão
D-PROD-155; o resto da D-PROD-155 continua valendo. Texto proposto pelo agente; vale só
com a aprovação explícita do proprietário (§4), registrada como ratificação na D-PROD-177.
```

**Frases que mudam se a ratificação escolher outra opção** (contrato §8):
- **R-IMPL estrita:** apagar `; os fatos de itens de entrada manual já estornados por edição ou exclusão, que por regra nunca tiveram consumo, não contam como histórico`. O ponto final fica depois de `em nenhum local`.
- **(b) recusada** (aceitar baixa estornada): apagar `, mesmo que depois estornado`.
- **(k) por item:** trocar `quando nenhuma camada de nenhum item dela foi consumida` por `quando nenhuma camada do item afetado foi consumida (data, parceiro e documento afetam todos os itens, e excluir exige isso de todos)`. Trocar também `com essa dependência, só se editam observação e justificativa` por `os itens com essa dependência só têm observação e justificativa editáveis`.

**Diferença em relação à R1:**
- sai "o cancelamento só estorna se nada tiver sido consumido ou transferido";
- entram editar e excluir, a revisão versionada, a janela FIFO por posição na fila, a regra de dependência por documento (inclusive baixa estornada), o motivo imutável, o estado excluído consultável, a proibição de reescrever ou apagar fatos e a trilha auditável;
- "uma única vez" vira "no máximo uma implantação ativa", e a dedupe passa a valer nos dois sentidos;
- a variante "aberta" da R1 vira a variante **proposta**, agora com itens **já estornados** de entrada manual.

## 4. Texto exato proposto — `docs/constitution/07-DO-NOT-DO.md`

### 4.1 Nota nova

**Onde:** inserir **ao final do arquivo**, depois da nota "Nota (D-PROD-159, revista pela D-PROD-162)". A posição mantém a ordem cronológica das notas (155, 157, 159, 176). O bloco vai precedido de uma linha em branco, para não se fundir com o blockquote anterior.

**Texto a vigorar SOMENTE após a ratificação (literal; variante proposta da R-IMPL):**

```markdown
> **Nota (D-PROD-177):** o documento de Entrada de Estoque, nos limites da decisão e da
> expansão constitucional, é a única exceção à proibição de "criar entrada de estoque
> avulsa" da nota D-PROD-155. O usuário edita e exclui a entrada; não existe "cancelar"
> como ação dela. Continua proibido:
> - lançar estoque pelo Cadastro de Produtos, por CSV, por rota genérica de movimento ou de
>   lote, ou por qualquer caminho fora do motor de estoque (`estoqueFisicoMotor.js`);
> - usar a entrada manual como compra, inventário/ajuste, devolução, transferência entre
>   empresas ou entrada por nota fiscal, ou criar, alterar ou cancelar título, conta a
>   pagar ou receita a partir dela, inclusive ao editá-la ou excluí-la;
> - usar doação ou outra causa para registrar saldo antigo (pré-existente); mudar o
>   motivo de uma entrada;
> - confirmar ou editar uma entrada manual com o mesmo parceiro e documento de um
>   lançamento confirmado da Central (a pagar ou a receber) ou de outra entrada
>   confirmada, e confirmar na Central um lançamento com o mesmo parceiro e documento de
>   uma entrada confirmada;
> - ter mais de uma implantação ativa por produto e empresa, ou implantar saldo de um
>   produto que já tenha histórico físico em qualquer local, salvo os fatos de itens de
>   entrada manual já estornados por edição ou exclusão;
> - editar quantidade, custo, unidade, fator, produto, local, data, parceiro ou documento,
>   incluir ou retirar item, ou excluir uma entrada confirmada quando alguma camada de
>   algum item dela foi consumida, transferida ou citada por outro fato, mesmo que depois
>   estornado;
> - confirmar ou editar uma entrada manual de modo que uma camada nova fique, na fila FIFO
>   do produto no local, à frente de camada que alguma baixa já tocou, ou com saída sem
>   rastro nesse produto e local;
> - corrigir uma entrada confirmada reescrevendo ou apagando movimento ou camada de estoque
>   (`UPDATE` de quantidade, custo, data, local, produto ou procedência, ou `DELETE`), em
>   vez de uma nova revisão pelo motor; recalcular o custo de baixas passadas;
> - editar ou excluir a entrada confirmada sem motivo, sem autor, sem versão ou sem
>   registrar os valores antes e depois; estornar camada em parte, excluir o documento em
>   parte ou restaurar entrada excluída;
> - conceder a tela ou as ações da entrada a perfis existentes por padrão;
> - reabrir qualquer nome de `forbiddenDomains` (`config/mapa-manejo-scope.json`), em
>   especial `MovimentacoesEstoque`, `LancamentoProdutosEstoque`, `RelatoriosEstoque`,
>   `Relatorios`, `Dashboard` e `Home`.
```

**Frases que mudam com outra opção:**
- **R-IMPL estrita:** o item "ter mais de uma implantação…" termina em "em qualquer local", sem a ressalva.
- **(b) recusada:** apagar ", mesmo que depois estornado".
- **(k) por item:** trocar "quando alguma camada de algum item dela" por "quando alguma camada do item afetado (ou de qualquer item, para data, parceiro, documento e exclusão)".

**Diferença em relação à R1:**
- sai "cancelar uma entrada cujas camadas já foram consumidas ou transferidas, ou estorná-la em parte";
- entram as proibições de editar ou excluir com dependência, de passar à frente na fila FIFO, de mudar o motivo, de reescrever ou apagar fatos, de recalcular custo, de editar a confirmada sem trilha, de estorno ou exclusão parcial e de restauração;
- a dedupe passa a valer também na edição e no sentido Central → entrada.

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
- Não autoriza editar ou excluir **qualquer outro** documento ou fato de estoque: compra, venda, abastecimento, suplementação, transferência, movimento ou camada. A edição e a exclusão valem só para o documento de Entrada de Estoque e só pelas regras do contrato (A8).

## 5. Como ratificar (decisão do proprietário)
1. **Decidir a R-IMPL antes** (variante proposta ou estrita), porque ela muda o texto da §3 e da §4.1.
   - Junto, decidir a **R-EDICAO-EXCLUSAO** (contrato §8), que dá o sentido técnico das frases sobre editar e excluir.
   - **Nem esta PR nem o merge dela ratificam a proposta.**
2. Aprovar ou ajustar os textos da §3 e da §4.
3. Incorporar o texto nos dois arquivos de uma destas formas:
   - **(a)** o próprio proprietário edita e mergeia;
   - **(b)** o proprietário autoriza **por escrito** uma PR de agente nomeada, citando o texto exato aprovado; a PR copia só esse texto, e o proprietário a mergeia manualmente.
     - A PR (b) só é compatível com a A10 pela leitura de precedente de que o merge manual do proprietário materializa a aprovação (D-PROD-22/155/157/159/162).
     - Sem autorização escrita que nomeie a PR e o texto, só vale o caminho (a).
4. Registrar na D-PROD-177 uma nota posterior: "ratificada em <data> por <responsável>, texto incorporado em <SHA>".
   - Se for recusada: nota "recusada em <data>". O número não é reaproveitado (registro append-only).
5. Só depois disso começam a P1-02, a P1-05a, a P1-05b e a P1-06.
   - A divisão da P1-02 em uma parte sem a origem de entrada manual (R-SPLIT, contrato §8) só vale com autorização expressa.

## 6. Conflitos de hierarquia mapeados

| Texto vigente | Nível | Conflito com a proposta | Como fica |
|---|---|---|---|
| `00-CONSTITUICAO.md`, expansão D-PROD-155: "não há tela avulsa de entrada" | 1 | Direto | Superado **só nesse trecho** pela expansão D-PROD-177 (§3), se ratificada |
| `00-CONSTITUICAO.md`, revisão D-PROD-162: "litros `L` ou quilos `KG`" | 1 | Não menciona o SACO da D-PROD-169 | Esclarecimento proposto na §4.2 |
| `07-DO-NOT-DO.md`, nota D-PROD-155: "criar entrada de estoque avulsa (tela ou rota própria)" | 2 | Direto | Exceção pela nota D-PROD-177 (§4.1), se ratificada |
| `07-DO-NOT-DO.md`, nota D-PROD-159/162: "`L` ou `KG`" (quatro trechos) | 2 | Conflito **pré-existente** com a D-PROD-169 (nível 4 não supera nível 2) | Esclarecimento §4.2. Até lá, prevalece o `07` |
| `DECISIONS.md` D-PROD-08 (nota da D-PROD-155): "não há tela avulsa de entrada" | 4 | Direto | Nota posterior datada, só depois da ratificação. O texto original fica preservado |
| `DECISIONS.md` D-PROD-161 e `ROADMAP.md`: a entrada manual da P1 incluía "ajuste" e "devolução" | 4–5 | Escopo: a proposta **exclui** os dois | A D-PROD-177, se ratificada, delimitará os motivos. O ROADMAP ganha uma nota prospectiva, sem reescrever o histórico |
| `config/mapa-manejo-scope.json` | 6 | Nenhum agora | A página candidata `EntradasEstoque` só entraria no escopo na P1-06 |
| `DECISIONS.md` D-PROD-158 (P3): exclusão de confirmado como `CANCELADO` + `excluido_em`; procedência reescrita no lugar (`atualizarProcedencia`) | 4 | **Não é conflito.** É divergência de desenho entre domínios. A entrada usa `EXCLUIDA` e nunca reescreve procedência | Declarada no contrato (A5, A6, A8). A P3 não muda |
| `DECISIONS.md` D-PROD-110 (rebanho): "não existe edição de movimento confirmado", com exclusão física | 4 | **Não é conflito.** Vale só para movimentos do rebanho | A entrada de estoque tem edição versionada e exclusão só lógica (contrato A8) |
