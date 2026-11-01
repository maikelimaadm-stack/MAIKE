/**
 * Exclusão do Cadastro de Lotes — MAIKE-LOTES-R1 (D-PROD-100).
 *
 * Quem decide é o SERVIDOR (`GET /lotes/:id/elegibilidade-exclusao` e o
 * próprio DELETE, que revalida com o lote travado). Aqui só há textos estáveis
 * por código. Listas carregadas na tela nunca autorizam exclusão.
 */

export const TIPOS_EXCLUSAO = Object.freeze({
  FISICA: 'exclusao_fisica',
  LOGICA: 'exclusao_logica',
  BLOQUEADO: 'bloqueado',
  JA_EXCLUIDO: 'ja_excluido',
});

/** Confirmação quando ao menos um lote sairá por exclusão lógica. */
export const TEXTO_CONFIRMACAO_LOGICA =
  'A entrada sairá do Cadastro e dos saldos atuais; movimentos cancelados ficarão preservados para auditoria.';

/** Motivo de bloqueio → texto. Nunca sugere apagar outro dado para forçar a exclusão. */
export const MENSAGENS_MOTIVO_EXCLUSAO = Object.freeze({
  lote_gerado_por_manejo: 'Lote gerado por manejo no mapa: não é uma entrada e não pode ser excluído pelo Cadastro.',
  movimentacao_ativa: 'Há movimentação ativa deste lote no mapa. Só lotes cujas movimentações foram todas canceladas podem sair do Cadastro.',
  movimentacoes_pecuarias: 'Há registro pecuário (pesagem, nascimento, categoria…) ligado a este lote.',
  suplementacao_lote: 'Há suplementação lançada para este lote.',
  manejos_tecnicos: 'Há manejo técnico lançado para este lote.',
  eventos_sanitarios: 'Há evento sanitário lançado para este lote.',
  aplicacoes_medicamento: 'Há aplicação de medicamento lançada para este lote.',
  lancamentos_tarefa: 'Há tarefa ligada a este lote.',
  vinculo_legado_por_nome: 'Há registro antigo que cita o lote só pelo nome; não é possível provar que não é este lote.',
  cancelamento_nao_comprovado: 'Há movimentação marcada como cancelada sem comprovação do cancelamento.',
  estado_divergente_da_entrada: 'O lote não está como na entrada (saldo, área, categoria ou situação mudaram).',
  alteracao_sem_comprovacao: 'O lote teve alteração de saldo, área ou situação sem manejo comprovado.',
});

export const mensagemDoMotivoExclusao = (motivo) =>
  MENSAGENS_MOTIVO_EXCLUSAO[motivo] || 'Existem registros vinculados a este lote.';
