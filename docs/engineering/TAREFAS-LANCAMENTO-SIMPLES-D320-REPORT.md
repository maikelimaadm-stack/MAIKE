# Tarefas, parte 1: lançamento simples (D-PROD-320)

**Data:** 2026-11-26 · **Decisão:** [D-PROD-320](./DECISIONS.md) · **Branch:** `claude/nifty-feynman-rh0kdn` · **Migration:** nenhuma

## O que o proprietário vê

O formulário de nova tarefa, aprovado em imagens antes de mexer:

| Antes (16 campos) | Agora |
|---|---|
| Título\*, Fazenda, Local, **Grupo\***, **Tipo\***, Responsável, **Solicitante**, Prioridade, **Status**, **Data do pedido\***, Prazo, **Data de conclusão**, Descrição, **Observações internas**, Ponto no mapa, Fotos | Título\*, **Setor**, Local, **Tipo (opcional)**, Responsável, Prioridade, Prazo, **Descrição/observações**, Ponto no mapa, Fotos |

- Só o **título** é obrigatório.
- **Setor:** é o mesmo campo, que antes se chamava "Fazenda" e já escolhia o setor.
- **Tipo:** se não achar, a pessoa deixa em branco e a tarefa fica como **"SEM TIPO"**. O administrador troca depois, editando a tarefa.
- **O grupo:** sai da tela e vem do próprio tipo.
- **O que saiu da tela:** quem pediu e a data do pedido o sistema grava sozinho. O andamento (começar, concluir, cancelar, registrar) continua nos **eventos** dos detalhes. A data de conclusão é gravada ao concluir.
- **Na edição:** o que já estava gravado fica, inclusive o status e as observações antigas.

## Como

### Servidor (`lancamentoTarefaService`, `lancamentoTarefaRoutes`)

- O `POST /lancamentos-tarefa` exige só `empresa_id` e `titulo`.
- `garantirTipoSemTipo`: sem `tipo_tarefa_id`, usa o tipo "SEM TIPO" do cliente, no grupo "GERAL" (o mesmo das operações, D-PROD-258).
  - Na primeira vez cria o grupo e o tipo, auditados, numa transação curta própria.
  - Com duas criações ao mesmo tempo, a unique do banco decide e a outra relê.
- `completarCriacao`:
  - tipo base "Outro";
  - `data_pedido` = hoje em São Paulo;
  - `solicitante` = quem lança.
  - O que vier no corpo vale.
- O banco não muda: o tipo continua obrigatório no banco, e o "SEM TIPO" ocupa esse lugar.

### App (`FormularioTarefaMapa`)

- Os campos são os da tabela acima.
- O tipo lista todos os tipos ativos.
- Sem tipo escolhido, o campo não vai no envio.

## Testes

| Arquivo | Casos |
|---|---|
| `backend/tests/lancamentoTarefaNativo.test.mjs` | LS-01: só o título (SEM TIPO/GERAL, "Outro", pedido hoje, quem pediu). LS-02: três ao mesmo tempo usam o mesmo tipo e o mesmo grupo. LS-03: com tipo, como antes; o SEM TIPO é trocado na edição. LS-04: sem título dá 400 |
| `tests/smoke/tarefaFormularioSimples.test.jsx` | TS-01: os campos. TS-02: só o título salva, sem mandar tipo. TS-03: sem título não salva. TS-04: na edição, o tipo e o status gravados continuam |

As suítes de tarefa, id do aparelho e tipos e grupos de atividade passaram: 21 + 96 testes no servidor e 50 no app.

## Próximas partes

- **Parte 2:** a aba **Tarefas** no mapa, ao lado de Lotes e Pontos.
  - Mostra o resumo em cartões, no estilo dos lotes.
  - Tem o botão **Nova tarefa**, com o local de onde se está.
  - Substitui a tabela.
- **Parte 3:** tarefas sem internet.
