import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
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
    await excluir(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: 'RegistroAnexo', entidadeId: id, dadosAnteriores: comoPublico(existente) },
      tx
    );
  });
};
