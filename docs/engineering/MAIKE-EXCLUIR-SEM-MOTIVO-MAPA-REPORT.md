FATIA: MAIKE-EXCLUIR-SEM-MOTIVO-MAPA
BRANCH: feat/excluir-sem-motivo-mapa
PR: a PR aberta desta branch (número no GitHub)

# MAIKE-EXCLUIR-SEM-MOTIVO-MAPA — Relatório

**Decisão:** [D-PROD-270](./DECISIONS.md) · **Base:** `origin/main` `fe9bd3ed` (PR #356 mergeada) · **Migration:** nenhuma · **Servidor:** sem mudança

## 1. Pedido

"Eu não preciso de motivos para exclusão ok nos históricos de todos."

## 2. O que mudou

| Diálogo | Arquivo | Mudança |
|---|---|---|
| Excluir lançamento (cocho) | `src/components/suplementacao/CancelarLancamentoCocho.jsx` | Sem campo de motivo |
| Excluir transferência (depósito) | `src/components/mapa/deposito/CancelarTransferenciaDeposito.jsx` | Sem campo de motivo nem ajuda de tamanho |
| Excluir movimentação (lote, curral) | `src/components/lotes/ExcluirMovimentacao.jsx` | Sem campo de motivo; a confirmação "a exclusão é definitiva" continua |
| Excluir registro (área) | `src/components/mapa/detalhes-area/CancelarRegistroDaArea.jsx` | `DialogoAcao` com `comMotivo={false}` |

Em todos, a tela envia o texto fixo **"Excluído pelo histórico do mapa"** (`src/domain/mapa/motivoExclusaoMapa.js`), que o servidor exige e grava na auditoria. Reenvio com a mesma chave usa o mesmo texto (mesmo fingerprint); uma pendência antiga com motivo digitado reenvia o motivo dela.

Fora do mapa nada muda: Financeiro e Lançamento de Atividades continuam pedindo motivo.

## 3. Validação

Ver a PR: smoke completo, gates, tipos, lint e build rodados localmente antes do único push.

## 4. Produção

Merge e deploy normais.
