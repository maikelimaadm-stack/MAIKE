/**
 * R1 — correção atômica da ENTRADA ORIGINAL: a parte do MOTOR do ledger.
 *
 * Chamado só pelo comando do Cadastro de Lotes, dentro da transação dele,
 * DEPOIS da elegibilidade (o lote travado, a única posição da linhagem, a
 * partida e os pesos — todos do evento ENTRADA próprio). Reescreve o MESMO
 * fato com os mesmos ids: posição (área, classificação, identidade), partida
 * (delta, data), peso do evento (atualiza/desativa; cria só se não havia),
 * evento (data, quantidade, área, correções) e reprojeta pela função canônica.
 * Nada aqui cria entrada, transferência ou escreve no Lote.
 */
import { AppError } from '../../shared/errors/AppError.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirDiaNoLedger, chaveIdentidade, travarPosicoes, validarEReprojetar, comoData, diaDoBanco, pesoNum, ponto } from './rebanhoLedgerNucleo.js';

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ clienteId: string, empresaId: string, loteId: string, ativacao: any, fato: any,
 *   novo: { quantidade: number, peso: number|null, dia: string, categoria: string|null, categoriaManejoId: string|null, sexo: string|null, areaId: string },
 *   categoriaManejoNome: string|null, operationKey: string, motivo: string }} p
 * @returns {Promise<{ evento_id: string, posicao_id: string }>}
 */
export const corrigirEntradaNoLedger = async (tx, contexto, { clienteId, empresaId, loteId, ativacao, fato, novo, categoriaManejoNome, operationKey, motivo }) => {
  const usuarioId = exigirAuthContext(contexto?.auth).usuarioId;
  await exigirDiaNoLedger(tx, clienteId, ativacao, novo.dia);
  /** @type {{posicao: any, evento: any, partida: any, pesos: any[]}} */
  const { posicao: previaPosicao, evento, partida, pesos } = fato;
  const posicao = (await travarPosicoes(tx, clienteId, [previaPosicao.id])).get(previaPosicao.id);
  const chave = chaveIdentidade({ origem: loteId, lote_entrada_id: loteId, categoria: novo.categoria, sexo: novo.sexo, categoria_manejo_id: novo.categoriaManejoId });
  if (chave !== posicao.chave_identidade || novo.areaId !== posicao.area_id) {
    const conflito = await tx.posicaoRebanho.findFirst({
      where: { cliente_id: clienteId, empresa_id: empresaId, area_id: novo.areaId, chave_identidade: chave, NOT: { id: posicao.id } },
      select: { id: true },
    });
    if (conflito) throw new AppError('LOTE_CORRECAO_ENTRADA_BLOQUEADA', 'já existe outra posição com a mesma identidade nesta área', { details: { id: loteId, motivo: 'identidade_em_conflito', posicao_id: conflito.id } });
  }
  const posicaoAntes = { area_id: posicao.area_id, categoria: posicao.categoria, categoria_manejo_id: posicao.categoria_manejo_id, sexo: posicao.sexo, quantidade_cabecas: posicao.quantidade_cabecas, peso_medio_kg: pesoNum(posicao.peso_medio_kg) };
  const eventoAntes = { data_operacional: diaDoBanco(evento.data_operacional), dados: evento.dados };
  // Mesmo fato, mesmos ids: posição (identidade/local), partida, peso e evento.
  await tx.posicaoRebanho.update({
    where: { cliente_id_id: { cliente_id: clienteId, id: posicao.id } },
    data: { area_id: novo.areaId, chave_identidade: chave, categoria: novo.categoria, categoria_manejo_id: novo.categoriaManejoId, categoria_manejo_nome: categoriaManejoNome, sexo: novo.sexo },
  });
  await tx.partidaRebanho.update({ where: { cliente_id_id: { cliente_id: clienteId, id: partida.id } }, data: { delta: novo.quantidade, data_operacional: comoData(novo.dia) } });
  ponto('correcao_entrada:apos_partida');
  const pesoAtivo = pesos.find((w) => w.ativa) ?? pesos[0] ?? null;
  if (novo.peso !== null) {
    if (pesoAtivo) {
      await tx.pesoRebanho.update({ where: { cliente_id_id: { cliente_id: clienteId, id: pesoAtivo.id } }, data: { peso_medio_kg: novo.peso, data_operacional: comoData(novo.dia), ativa: true } });
    } else {
      await tx.pesoRebanho.create({ data: { cliente_id: clienteId, empresa_id: empresaId, evento_id: evento.id, posicao_id: posicao.id, data_operacional: comoData(novo.dia), peso_medio_kg: novo.peso, medido: false } });
    }
  } else if (pesoAtivo) {
    await tx.pesoRebanho.update({ where: { cliente_id_id: { cliente_id: clienteId, id: pesoAtivo.id } }, data: { ativa: false, data_operacional: comoData(novo.dia) } });
  }
  const correcoes = (Array.isArray(evento.dados?.correcoes) ? evento.dados.correcoes : []).concat([{ operation_id: operationKey, usuario_id: usuarioId ?? null, motivo: motivo }]);
  await tx.eventoRebanho.update({
    where: { cliente_id_id: { cliente_id: clienteId, id: evento.id } },
    data: { data_operacional: comoData(novo.dia), dados: { ...evento.dados, quantidade: novo.quantidade, area_id: novo.areaId, correcoes } },
  });
  await validarEReprojetar(tx, clienteId, [posicao.id], 'REBANHO_SALDO_HISTORICO_NEGATIVO', 'a correção deixaria saldo negativo', (n) => n);
  ponto('correcao_entrada:apos_projecao');
  const depois = await tx.posicaoRebanho.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: posicao.id } } });
  await registrarEvento(contexto, {
    acao: 'correcao_entrada',
    entidade: 'EventoRebanho',
    entidadeId: evento.id,
    dadosAnteriores: { ...eventoAntes, posicao: posicaoAntes },
    dadosNovos: {
      data_operacional: novo.dia,
      quantidade: novo.quantidade,
      area_id: novo.areaId,
      motivo: motivo,
      operation_id: operationKey,
      posicao: { area_id: depois.area_id, categoria: depois.categoria, categoria_manejo_id: depois.categoria_manejo_id, sexo: depois.sexo, quantidade_cabecas: depois.quantidade_cabecas, peso_medio_kg: pesoNum(depois.peso_medio_kg) },
    },
  }, tx);
  return { evento_id: evento.id, posicao_id: posicao.id };
};
