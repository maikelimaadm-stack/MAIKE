FATIA: MAIKE-EXCLUIR-SO-EXCLUSAO-MAPA
BRANCH: feat/excluir-historicos-mapa-textos
PR: a PR aberta desta branch (número no GitHub; sem push extra para não gerar outra prévia)

# MAIKE-EXCLUIR-SO-EXCLUSAO-MAPA — Relatório

**Decisão:** [D-PROD-269](./DECISIONS.md) · **Base:** `origin/main` `80aa1db3` (PR #353 mergeada) · **Migration:** nenhuma · **Servidor:** sem mudança

## 1. Pedido

Depois da D-PROD-268, o proprietário: "Olha eu não tenho cancelamentos eu tenho exclusão ok". No mapa, o usuário não deve ver "cancelar" nem "cancelado": só **Excluir**, e o que foi excluído sai do histórico. Por baixo continua o mesmo desfazer seguro (estoque volta, auditoria guardada).

## 2. O que mudou na tela

| Onde | Antes | Agora |
|---|---|---|
| Histórico e detalhes do cocho, cartão de suplementação da aba Histórico do lote/pasto | "Cancelar lançamento", "Cancelando...", chip/aviso de cancelado | **"Excluir lançamento"**, "Excluindo...", "Motivo da exclusão", "Lançamento excluído."; o excluído some |
| Histórico do depósito | "Cancelar transferência"; perna estornada com chip "Cancelado"; movimentos de estorno como cartões | **"Excluir transferência"**; as duas pernas e os estornos não aparecem |
| Histórico da área | "Cancelar registro"; chip "Cancelado" até reler | **"Excluir registro"**, "Excluindo...", "Motivo da exclusão"; some na hora; erro do servidor com "estorno"/"cancele" vira texto neutro |
| Histórico de Movimentação do lote e da área | Movimentos antigos com selo "Cancelado" e faixa "Cancelado em … por …"; "o cancelamento está temporariamente suspenso"; textos "cancelamento indisponível" | Movimentos cancelados antigos não aparecem; "Nutrição: para excluir, use o histórico do cocho."; textos de exclusão |
| Abate do curral | Abates cancelados antigos com selo "Cancelado"/"Ativo" | Não aparecem; sem o selo |
| Excluir movimentação | Recusas "já está cancelada", "(mesmo cancelados)", "cancelada pelo mecanismo anterior"; "Cancelar" no aviso de resposta sem confirmação | Recusas em linguagem de exclusão; motivo cru do servidor com cancelar/estorno vira "Exclusão indisponível"; "Voltar" |
| Permissões | "Cancelar lançamento de cocho e transferência de depósito" | **"Excluir lançamento de cocho e transferência de depósito"** (chave `cancelar_lancamentos_estoque` igual) |
| Nível, alertas e indicadores do mapa | Um lançamento excluído vindo de cópia antiga do aparelho podia contar | `semExcluidos` em `calcularNivelCocho` e uma vez em `MapaGeral` |

O que **não** mudou: servidor, rotas, códigos, chaves, nomes de arquivos; Financeiro, Lançamento de Atividades e o kardex da tela de Estoque. O `DialogoAcao` (compartilhado com o Financeiro) só ganhou props opcionais com o padrão de antes, e os smoke do Financeiro passam iguais.

## 3. Como foi feito

Duas rodadas de três frentes com arquivos separados (cocho; depósito; área + permissão; depois diálogo da área; histórico de movimentação + abate; limpezas), cada frente com um revisor cético e uma rodada de ajuste, e uma varredura final de tudo que abre a partir do `MapaGeral`. Pontos da revisão aplicados, entre outros: nível do cocho contando lançamento excluído; "Cancelar" no aviso de resposta sem confirmação; erro do catálogo com "estorno" dentro do diálogo da área; testes que não provavam o filtro de texto do servidor.

## 4. Validação (local)

| Etapa | Resultado |
|---|---|
| `test:smoke` completo | 316 arquivos, 3962 testes, todos passam |
| Todos os gates do `verify:all` (menos backend/smoke/build), `gate:types`, `typecheck:backend` | passam |
| `lint` | 0 erros |
| `build` | passa |
| Backend | sem arquivo alterado |

Testes novos ou atualizados provam: textos sem `/cancel|estorn/i` nos diálogos e históricos do mapa; registro excluído/cancelado fora das listas; botão "Excluindo..." e rótulo "Motivo da exclusão"; filtro da mensagem crua do servidor; o nome novo da permissão.

## 5. Produção

Merge e deploy normais. Quem já tinha a permissão continua com ela, agora com o nome "Excluir lançamento de cocho e transferência de depósito".

## 6. Fora do escopo

- `src/domain/lotes/situacaoMovimento.js` ainda tem textos de "cancelamento" para outras telas; no mapa eles são traduzidos na própria tela.
- Nomes internos (arquivos `Cancelar*.jsx`, chave `cancelar_lancamentos_estoque`, rotas `/cancelamento`) ficam como estão: não aparecem para o usuário.
