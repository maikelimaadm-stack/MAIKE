/**
 * Exclusão DEFINITIVA segura de um fato do ledger — D-PROD-110.
 *
 * Não há segunda fórmula de estorno: a reversão é o motor certificado do
 * cancelamento (`cancelarMovimentoDoLedger`), com as MESMAS guardas — vínculos
 * causais por id, saldo histórico ≥ 0 por data, peso causal, pré-condições de
 * pesagem/nascimento, linhagem da junção — e a mesma ordem de travas
 * (movimento → áreas → posições). Só depois de a reversão passar, e na MESMA
 * transação, o fato some fisicamente, na ordem das FKs (todas Restrict, nunca
 * cascata):
 *
 *   PesoRebanho(evento) → PartidaRebanho(evento) → EventoRebanho → MovimentacaoMapa
 *
 * Posição que só existia por este fato (sem nenhuma outra partida, peso,
 * tarefa, linhagem ou documento que a cite por id) também sai; qualquer
 * referência a mantém, zerada e coerente. A operação idempotente que gerou o
 * fato vira `excluido` (o recibo fica; replay → 409 estável, nunca recria).
 *
 * Falha em qualquer passo → a transação do chamador desfaz tudo.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { STATUS_EXCLUIDO } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { comoPosicaoPublica, diaDoBanco, ponto, recusa, reprojetar } from './rebanhoLedgerNucleo.js';
import { FONTES_JSON_CAUSAIS, cancelarMovimentoDoLedger } from './rebanhoLedgerService.js';

/**
 * Documentos de outros módulos que citam o PRÓPRIO movimento por id, em
 * qualquer situação (inclusive cancelados). O cancelamento já recusa os
 * ativos; a exclusão também não pode deixar referência órfã nos cancelados.
 */
const referenciasDocumentais = async (tx, clienteId, empresaId, movimentacaoId) => {
  const bloqueadores = [];
  for (const tabela of FONTES_JSON_CAUSAIS) {
    const linhas = /** @type {Array<{id: string}>} */ (await tx.$queryRawUnsafe(
      `SELECT t.id FROM "${tabela}" t WHERE t.cliente_id = $1 AND t.empresa_id = $2 AND t.dados->>'movimentacao_id' = $3 ORDER BY t.id LIMIT 20`,
      clienteId, empresaId, movimentacaoId,
    ));
    for (const l of linhas) bloqueadores.push({ tipo: tabela, id: l.id });
    if (bloqueadores.length >= 20) break;
  }
  return bloqueadores;
};

/**
 * Posição sem nenhum uso restante (depois de apagado o fato): sem partidas nem
 * pesos de qualquer evento, sem tarefa, e nenhum outro registro do tenant a
 * cita por id (linhagem de outra posição, outro movimento, outro evento,
 * documentos dos módulos vinculados). Na dúvida, fica.
 */
const posicaoSemUso = async (tx, clienteId, empresaId, posicaoId) => {
  const [r] = /** @type {Array<{usos: bigint|number}>} */ (await tx.$queryRaw`
    SELECT (SELECT count(*) FROM "PartidaRebanho" WHERE cliente_id = ${clienteId} AND posicao_id = ${posicaoId})
         + (SELECT count(*) FROM "PesoRebanho" WHERE cliente_id = ${clienteId} AND posicao_id = ${posicaoId})
         + (SELECT count(*) FROM "LancamentoTarefa" WHERE cliente_id = ${clienteId} AND posicao_id = ${posicaoId})
         + (SELECT count(*) FROM "PosicaoRebanho" WHERE cliente_id = ${clienteId} AND id <> ${posicaoId} AND strpos(linhagem::text, ${posicaoId}) > 0)
         + (SELECT count(*) FROM "MovimentacaoMapa" WHERE cliente_id = ${clienteId} AND strpos(dados::text, ${posicaoId}) > 0)
         + (SELECT count(*) FROM "EventoRebanho" WHERE cliente_id = ${clienteId} AND strpos(dados::text, ${posicaoId}) > 0)
         + (SELECT count(*) FROM "PosicaoRebanho" WHERE cliente_id = ${clienteId} AND id = ${posicaoId} AND quantidade_cabecas <> 0) AS usos`);
  if (Number(r.usos) > 0) return false;
  for (const tabela of FONTES_JSON_CAUSAIS) {
    const [x] = /** @type {Array<{n: bigint|number}>} */ (await tx.$queryRawUnsafe(
      `SELECT count(*) AS n FROM "${tabela}" t WHERE t.cliente_id = $1 AND t.empresa_id = $2 AND strpos(t.dados::text, $3) > 0`,
      clienteId, empresaId, posicaoId,
    ));
    if (Number(x.n) > 0) return false;
  }
  return true;
};

/**
 * Exclui definitivamente o fato do ledger ligado a `mov` (já travado `FOR
 * UPDATE` pelo chamador, do ledger e não cancelado).
 * @returns {Promise<{evento_tipo: string, efeitos: Array<Record<string, unknown>>, posicoes_removidas: string[]}>}
 */
export const excluirMovimentoDoLedger = async (tx, contexto, mov, motivo, operationKey) => {
  const auth = exigirAuthContext(contexto?.auth);
  const clienteId = auth.clienteId;
  const empresaId = mov.empresa_id;

  // 1. Reversão pelo motor certificado (todas as guardas; nenhuma fórmula nova).
  await cancelarMovimentoDoLedger(tx, contexto, mov, motivo, operationKey);
  ponto('exclusao_apos_reversao');
  const evento = await tx.eventoRebanho.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: String(mov.dados.efeito_servidor.evento_id) } } });
  if (!evento || evento.movimentacao_id !== mov.id) throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'o evento do ledger não confere com este movimento');

  // 2. Nenhum documento (nem cancelado) pode ficar citando um movimento apagado.
  const referencias = await referenciasDocumentais(tx, clienteId, empresaId, mov.id);
  if (referencias.length) {
    throw recusa('EXCLUSAO_REFERENCIA_DOCUMENTAL', 'há documentos de outros módulos que citam esta movimentação (mesmo cancelados); trate-os antes (nada foi alterado)', { bloqueadores: referencias });
  }

  // 3. Apagar o fato, na ordem das FKs (Restrict; sem cascata).
  const partidas = await tx.partidaRebanho.findMany({ where: { cliente_id: clienteId, evento_id: evento.id }, select: { posicao_id: true, delta: true } });
  const pesos = await tx.pesoRebanho.findMany({ where: { cliente_id: clienteId, evento_id: evento.id }, select: { posicao_id: true } });
  const tocadas = [...new Set([...partidas, ...pesos].map((x) => x.posicao_id))].sort();
  const nomes = new Map((await tx.posicaoRebanho.findMany({ where: { cliente_id: clienteId, id: { in: tocadas } }, select: { id: true, nome: true, area: { select: { nome: true } } } }))
    .map((p) => [p.id, { nome: p.nome, area_nome: p.area?.nome ?? null }]));
  await tx.pesoRebanho.deleteMany({ where: { cliente_id: clienteId, empresa_id: empresaId, evento_id: evento.id } });
  await tx.partidaRebanho.deleteMany({ where: { cliente_id: clienteId, empresa_id: empresaId, evento_id: evento.id } });
  await tx.eventoRebanho.delete({ where: { cliente_id_id: { cliente_id: clienteId, id: evento.id } } });
  await tx.movimentacaoMapa.delete({ where: { cliente_id_id: { cliente_id: clienteId, id: mov.id } } });

  // 4. Posição que só existia por este fato sai; as demais são reprojetadas.
  const removidas = [];
  for (const id of tocadas) {
    if (!(await posicaoSemUso(tx, clienteId, empresaId, id))) continue;
    const antes = await tx.posicaoRebanho.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } });
    await tx.posicaoRebanho.delete({ where: { cliente_id_id: { cliente_id: clienteId, id } } });
    await registrarEvento(contexto, { acao: 'delete', entidade: 'PosicaoRebanho', entidadeId: id, dadosAnteriores: comoPosicaoPublica(antes) }, tx);
    removidas.push(id);
  }
  await reprojetar(tx, clienteId, tocadas.filter((id) => !removidas.includes(id)));
  ponto('exclusao_apos_delete');

  // Efeito legível (o cliente nunca manda delta: tudo daqui sai do ledger).
  const depois = new Map((await tx.posicaoRebanho.findMany({ where: { cliente_id: clienteId, id: { in: tocadas } }, select: { id: true, quantidade_cabecas: true, peso_medio_kg: true } }))
    .map((p) => [p.id, p]));
  const efeitos = tocadas.map((id) => {
    const delta = partidas.filter((x) => x.posicao_id === id).reduce((t, x) => t + x.delta, 0);
    const d = depois.get(id);
    return {
      posicao_id: id,
      nome: nomes.get(id)?.nome ?? null,
      area_nome: nomes.get(id)?.area_nome ?? null,
      delta_desfeito: -delta,
      quantidade_depois: d ? d.quantidade_cabecas : 0,
      peso_depois_kg: d && d.peso_medio_kg !== null ? Number(d.peso_medio_kg) : null,
      peso_revertido: pesos.some((x) => x.posicao_id === id),
      removida: removidas.includes(id),
    };
  });

  // 5. O recibo da operação original vira marcador estável (nunca replay/recriação).
  await tx.operacaoIdempotente.updateMany({ where: { cliente_id: clienteId, operation_key: evento.operation_id, status: 'committed' }, data: { status: STATUS_EXCLUIDO } });

  // 6. Auditoria administrativa mínima (não é histórico operacional).
  await registrarEvento(contexto, {
    acao: 'exclusao_definitiva',
    entidade: 'MovimentacaoMapa',
    entidadeId: mov.id,
    dadosAnteriores: {
      empresa_id: empresaId,
      tipo: mov.dados?.tipo ?? null,
      data_movimentacao: mov.dados?.data_movimentacao ?? null,
      evento_id: evento.id,
      evento_tipo: evento.tipo,
      data_operacional: diaDoBanco(evento.data_operacional),
      operation_id_original: evento.operation_id,
      registrado_por_usuario_id: evento.registrado_por_usuario_id ?? null,
    },
    dadosNovos: { motivo, operation_id: operationKey, efeitos, posicoes_removidas: removidas },
  }, tx);
  return { evento_tipo: evento.tipo, efeitos, posicoes_removidas: removidas };
};
