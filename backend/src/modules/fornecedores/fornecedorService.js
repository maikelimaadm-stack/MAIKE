/**
 * Serviço de Fornecedor (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirSomenteColunasGravaveis } from '../../shared/prisma/colunasGravaveis.js';
import { carregarAutorizacao, acessoTotal } from '../../shared/auth/autorizacaoTela.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
  excluirRegistroPorId,
} from './fornecedorRepository.js';

export const ENTIDADE_SEQUENCIA = 'Fornecedor';

const erroNaoEncontrado = () => new AppError('FORNECEDOR_NOT_FOUND', 'Fornecedor não encontrado');

/** @param {Record<string, unknown>} registro */
export const comoPublico = (registro) => {
  // eslint-disable-next-line no-unused-vars -- tenant não exposto na API pública
  const { createdAt, updatedAt, cliente_id, ...resto } = registro;
  return {
    ...resto,
    created_date: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    updated_date: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
  };
};

/**
 * D-PROD-137 (GET-04) — o que o seletor de fornecedor do Cadastro de Lotes usa
 * (FormularioLote: nome, busca por nome/cpf/cnpj/cidade/estado, cidade/estado de
 * origem, `empresa_id` para o filtro da empresa). ALLOWLIST: RG, nascimento,
 * IE, responsável, telefone, e-mail, endereço, CEP, IBGE e observações ficam de
 * fora — nenhuma tela de quem só cadastra lote os mostra.
 */
const CAMPOS_SELETOR = Object.freeze([
  'id', 'empresa_id', 'numero_cadastro', 'tipo_pessoa', 'nome', 'razao_social', 'cnpj', 'cidade', 'estado', 'tipos', 'ativo',
]);

/**
 * CPF de terceiro mascarado no padrão usual (`***.456.789-**`): a busca do
 * seletor ainda casa pelos dígitos do meio, e o número completo não sai.
 * Formato inesperado → nada (falha fechada).
 * @param {unknown} cpf
 */
export const mascararCpf = (cpf) => {
  const d = String(cpf ?? '').replace(/\D/g, '');
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : null;
};

/** @param {Record<string, unknown>} registro */
export const comoItemDoSeletor = (registro) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const campo of CAMPOS_SELETOR) saida[campo] = registro[campo] ?? null;
  saida.cpf = mascararCpf(registro.cpf);
  const { createdAt, updatedAt } = registro;
  saida.created_date = createdAt instanceof Date ? createdAt.toISOString() : createdAt;
  saida.updated_date = updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
  return saida;
};

/**
 * A rota já exige o Cadastro de Lotes (ou acesso total). Registro completo só
 * com acesso total (administrador real ou `is_admin`); a tela de Lotes recebe a
 * projeção do seletor.
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 */
export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const [registros, aut] = await Promise.all([listarRegistros(auth.clienteId, filtros), carregarAutorizacao(contexto)]);
  return registros.map(acessoTotal(aut) ? comoPublico : comoItemDoSeletor);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const criado = await prisma.$transaction(async (tx) => {
    /** @type {Record<string, unknown>} */
    const dados = { ...exigirSomenteColunasGravaveis('Fornecedor', entrada), cliente_id: auth.clienteId };
    if (!dados.numero_cadastro) {
      dados.numero_cadastro = String(
        await reservarNumero(tx, {
          clienteId: auth.clienteId,
          entidade: ENTIDADE_SEQUENCIA,
          escopoTipo: ESCOPO_TENANT,
        })
      );
    }
    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'Fornecedor', entidadeId: registro.id, dadosNovos: comoPublico(registro) },
      tx
    );
    return registro;
  });
  return comoPublico(criado);
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const atualizado = await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, exigirSomenteColunasGravaveis('Fornecedor', entrada));
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'Fornecedor',
        entidadeId: id,
        dadosAnteriores: comoPublico(existente),
        dadosNovos: comoPublico(registro),
      },
      tx
    );
    return registro;
  });
  return comoPublico(atualizado);
};

export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    await excluirRegistroPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: 'Fornecedor', entidadeId: id, dadosAnteriores: comoPublico(existente) },
      tx
    );
  });
};
