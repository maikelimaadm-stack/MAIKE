import { exigirLotesNaoExcluidos } from '../../shared/lotes/loteVivo.js';
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { carregarAutorizacao, acessoTotal, acaoNaoPermitida } from '../../shared/auth/autorizacaoTela.js';
import { montarRegistroDeAnexo } from '../anexos/attachmentValidation.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { buscar, excluir, inserir, listarPorFiltro } from './registroAnexoRepository.js';

const comoPublico = (registro) => ({
  id: registro.id,
  entidade: registro.entidade,
  entidade_id: registro.entidade_id,
  nome_original: registro.nome_original,
  storage_key: registro.storage_key,
  mime_type: registro.mime_type,
  tamanho_bytes: registro.tamanho_bytes,
  checksum: registro.checksum,
  criado_por: registro.criado_por,
  created_date: registro.createdAt?.toISOString?.() ?? registro.createdAt,
  updated_date: registro.updatedAt?.toISOString?.() ?? registro.updatedAt,
});

export const listar = async (contexto, filtro = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarPorFiltro(auth.clienteId, filtro);
  return registros.map(comoPublico);
};

/**
 * D-PROD-136 (F8) — o produto só anexa em Lote (`ENTIDADES_COM_ANEXO = ['Lote']`,
 * dialog do Cadastro de Lotes). A guarda da rota aceita a tela de Lotes; aqui o
 * ESCOPO: sem acesso total, só entidade 'Lote' (antes: qualquer `entidade`,
 * inclusive tarefa/empresa). Outras entidades seguem só com acesso total.
 */
const ENTIDADE_DA_TELA = 'Lote';

/**
 * Lote citado tem de EXISTIR no tenant (antes: id inventado passava) e não
 * estar excluído. Usa a trava `FOR SHARE` de `exigirLotesNaoExcluidos` (dentro
 * da transação), para a corrida com a exclusão do lote seguir fechada
 * (MAIKE-LOTES-R1); a linha travada prova a existência.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId @param {string} loteId
 */
const exigirLoteDoTenant = async (tx, clienteId, loteId) => {
  await exigirLotesNaoExcluidos(tx, clienteId, [loteId]);
  const [linha] = /** @type {Array<{id: string}>} */ (await tx.$queryRaw`SELECT id FROM "Lote" WHERE cliente_id = ${clienteId} AND id = ${loteId}`);
  if (!linha) throw new AppError('ATTACHMENT_OWNER_INVALID', 'o lote do anexo não existe nesta fazenda');
};

export const criar = async (contexto, entrada) => {
  exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const criado = await prisma.$transaction(async (tx) => {
    const registro = montarRegistroDeAnexo(contexto, {
      entidade: entrada.entidade,
      entidadeId: entrada.entidade_id ?? entrada.entidadeId,
      nomeOriginal: entrada.nome_original ?? entrada.nomeOriginal,
      storageKey: entrada.storage_key ?? entrada.storageKey,
      mimeType: entrada.mime_type ?? entrada.mimeType,
      tamanhoBytes: entrada.tamanho_bytes ?? entrada.tamanhoBytes,
      checksum: entrada.checksum,
    });
    if (registro.entidade !== ENTIDADE_DA_TELA && !acessoTotal(await carregarAutorizacao(contexto, tx))) {
      throw acaoNaoPermitida({ anexo: registro.entidade, exige: ['acesso_total'] });
    }
    // Anexo novo em lote inexistente ou excluído do cadastro: recusado (MAIKE-LOTES-R1).
    if (registro.entidade === ENTIDADE_DA_TELA) await exigirLoteDoTenant(tx, registro.cliente_id, registro.entidade_id);
    const salvo = await inserir(tx, registro);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'RegistroAnexo', entidadeId: salvo.id, dadosNovos: comoPublico(salvo) },
      tx
    );
    return salvo;
  });
  return comoPublico(criado);
};

export const excluirPorId = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    const existente = await buscar(auth.clienteId, id, tx);
    if (!existente) throw new AppError('ATTACHMENT_OWNER_INVALID', 'anexo não encontrado');
    // F8: a tela de Lotes "excluir" só alcança anexo de Lote (antes: de qualquer entidade).
    if (existente.entidade !== ENTIDADE_DA_TELA && !acessoTotal(await carregarAutorizacao(contexto, tx))) {
      throw acaoNaoPermitida({ anexo: existente.entidade, exige: ['acesso_total'] });
    }
    await excluir(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: 'RegistroAnexo', entidadeId: id, dadosAnteriores: comoPublico(existente) },
      tx
    );
  });
};
