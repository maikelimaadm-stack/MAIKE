/**
 * Serviço de PontoSuplementacao (P5.4).
 */
import { exigirVersaoEsperada, separarVersaoEsperada } from '../../shared/sincronizacao/versaoDoRegistro.js';
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { consultarMudancas } from '../../shared/sincronizacao/mudancasIncrementais.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirSomenteColunasGravaveis } from '../../shared/prisma/colunasGravaveis.js';
import { criarComIdDoAparelho, foiExcluidoNoHistorico, idDoAparelhoDe } from '../../shared/idempotency/idDoAparelho.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
  excluirRegistroPorId,
  numeroEmUso,
  motivosHistoricoPonto,
  listarCochosDoDeposito,
  outroPontoUsaLocal,
  buscarPontoPorIdEmQualquerTenant,
} from './pontoSuplementacaoRepository.js';
import { inserirLocal } from '../locaisEstoque/localEstoqueRepository.js';
import { comoLocalPublico, ENTIDADE_SEQUENCIA as ENTIDADE_SEQUENCIA_LOCAL } from '../locaisEstoque/localEstoqueService.js';

export const ENTIDADE_SEQUENCIA = 'PontoSuplementacao';

const erroNaoEncontrado = () => new AppError('PONTO_SUPLEMENTACAO_NOT_FOUND', 'PontoSuplementacao não encontrado');

/**
 * Recusa de exclusão: o cocho/depósito tem histórico (leituras, lançamentos,
 * movimentações ou saldo). `details.motivos` diz quais. Nada é apagado.
 * @param {string} id @param {string[]} motivos
 */
const erroComHistorico = (id, motivos) =>
  new AppError(
    'PONTO_SUPLEMENTACAO_COM_HISTORICO',
    'não é possível excluir o cocho/depósito: ele tem histórico (leituras, lançamentos, movimentações ou saldo de estoque)',
    { details: { id, motivos } }
  );

/** Tentativas de achar um número livre quando o sugerido (ou o da sequência) já existe. */
const MAX_TENTATIVAS_NUMERO = 50;

/**
 * `numero_ponto` do cocho/depósito é do SERVIDOR (unique `cliente_id + numero_ponto`):
 * vem da sequência do tenant, na transação da criação. Um número informado só é
 * aceito se estiver livre; se colidir, o servidor reserva o próximo livre em vez
 * de devolver 500/409 e deixar o ponto de referência sem o cocho.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {unknown} informado
 */
const numeroLivre = async (tx, clienteId, informado) => {
  const sugerido = typeof informado === 'string' ? informado.trim() : informado == null ? '' : String(informado).trim();
  if (sugerido && !(await numeroEmUso(tx, clienteId, sugerido))) return sugerido;
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS_NUMERO; tentativa += 1) {
    const numero = String(
      await reservarNumero(tx, { clienteId, entidade: ENTIDADE_SEQUENCIA, escopoTipo: ESCOPO_TENANT })
    );
    if (!(await numeroEmUso(tx, clienteId, numero))) return numero;
  }
  throw new AppError('SEQUENCE_CONFLICT', 'não foi possível reservar o número do ponto de suplementação');
};

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

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarRegistros(auth.clienteId, filtros);
  return registros.map(comoPublico);
};

/**
 * D-PROD-309 — o que mudou nos cochos/depósitos desde a última sincronização do aparelho.
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{desde?: string, cursor?: string, limite?: number}} query
 */
export const mudancas = async (contexto, query) => {
  const auth = exigirAuthContext(contexto?.auth);
  return consultarMudancas({ clienteId: auth.clienteId, query, modelo: 'pontoSuplementacao', entidadeAuditoria: 'PontoSuplementacao', publico: comoPublico });
};

/**
 * Local de estoque pedido junto com um DEPÓSITO novo (`local_estoque: { nome, descricao }`).
 * Validado aqui porque não é coluna do PontoSuplementacao.
 * @param {unknown} pedido
 * @returns {{ nome: string, descricao: string|null } | null}
 */
const localPedido = (pedido) => {
  if (pedido === undefined || pedido === null) return null;
  const invalido = () =>
    new AppError('REQUEST_VALIDATION_FAILED', 'local_estoque deve ser { nome, descricao }', {
      details: { field: 'local_estoque', reason: 'invalido' },
    });
  if (typeof pedido !== 'object' || Array.isArray(pedido)) throw invalido();
  const { nome, descricao, ...resto } = /** @type {Record<string, unknown>} */ (pedido);
  if (Object.keys(resto).length) throw invalido();
  const nomeLimpo = typeof nome === 'string' ? nome.trim() : '';
  if (!nomeLimpo || nomeLimpo.length > 255) throw invalido();
  if (descricao !== undefined && descricao !== null && typeof descricao !== 'string') throw invalido();
  const descricaoLimpa = typeof descricao === 'string' && descricao.trim() ? descricao.trim() : null;
  return { nome: nomeLimpo, descricao: descricaoLimpa };
};

/**
 * Cria o cocho/depósito. Um DEPÓSITO novo pode trazer `local_estoque: { nome, descricao }`:
 * o local é criado NA MESMA TRANSAÇÃO e ligado ao depósito — se o depósito falhar,
 * nenhum local fica órfão (antes o navegador criava o local antes e precisava de
 * "excluir" em Locais para desfazer).
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  // D-PROD-308: id gerado no aparelho — repetir a criação devolve o mesmo ponto (sem segundo
  // local de estoque nem segunda numeração); excluído não é recriado.
  const { registro } = await criarComIdDoAparelho({
    id: idDoAparelhoDe(/** @type {Record<string, unknown>} */ (entrada ?? {}).id),
    clienteId: auth.clienteId,
    entidade: 'PontoSuplementacao',
    buscar: async (id) => {
      const ponto = await buscarPontoPorIdEmQualquerTenant(id);
      if (ponto) return { cliente_id: ponto.cliente_id, registro: comoPublico(ponto) };
      return (await foiExcluidoNoHistorico(auth.clienteId, 'PontoSuplementacao', id))
        ? { cliente_id: auth.clienteId, excluido: true, registro: null }
        : null;
    },
    criar: (id) => criarNaTransacao(contexto, auth, entrada, id),
  });
  return registro;
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {import('../../shared/auth/authContext.js').AuthContext} auth
 * @param {unknown} entrada
 * @param {string|null} idDoAparelho
 */
const criarNaTransacao = async (contexto, auth, entrada, idDoAparelho) => {
  const prisma = getPrismaClient();
  const { local_estoque: pedidoLocal, ...colunas } = /** @type {Record<string, unknown>} */ (entrada ?? {});
  const local = localPedido(pedidoLocal);
  const criado = await prisma.$transaction(async (tx) => {
    /** @type {Record<string, unknown>} */
    const dados = { ...exigirSomenteColunasGravaveis('PontoSuplementacao', colunas), cliente_id: auth.clienteId };
    if (local) {
      if (String(dados.categoria_ponto ?? '').toUpperCase() !== 'DEPOSITO' || dados.local_estoque_id) {
        throw new AppError('REQUEST_VALIDATION_FAILED', 'local_estoque só acompanha um DEPÓSITO novo sem local_estoque_id', {
          details: { field: 'local_estoque', reason: 'so_deposito_sem_local' },
        });
      }
      const numeroLocal = await reservarNumero(tx, {
        clienteId: auth.clienteId,
        entidade: ENTIDADE_SEQUENCIA_LOCAL,
        escopoTipo: ESCOPO_TENANT,
      });
      const registroLocal = await inserirLocal(tx, {
        nome: local.nome,
        descricao: local.descricao,
        cliente_id: auth.clienteId,
        numero_local: String(numeroLocal),
      });
      await registrarEvento(
        contexto,
        { acao: 'create', entidade: 'LocalEstoque', entidadeId: registroLocal.id, dadosNovos: comoLocalPublico(registroLocal) },
        tx
      );
      dados.local_estoque_id = registroLocal.id;
      dados.local_estoque_nome = registroLocal.nome;
    }
    dados.numero_ponto = await numeroLivre(tx, auth.clienteId, dados.numero_ponto);
    const registro = await inserirRegistro(tx, idDoAparelho ? { ...dados, id: idDoAparelho } : dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'PontoSuplementacao', entidadeId: registro.id, dadosNovos: comoPublico(registro) },
      tx
    );
    return registro;
  });
  return comoPublico(criado);
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const { versaoEsperada, resto } = separarVersaoEsperada(entrada);
  const atualizado = await prisma.$transaction(async (tx) => {
    // D-PROD-316: trava a linha e confere a versão que a pessoa viu (senão 409 com quem alterou, nada gravado).
    await tx.$queryRaw`SELECT id FROM "PontoSuplementacao" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR NO KEY UPDATE`;
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    await exigirVersaoEsperada(tx, { clienteId: auth.clienteId, entidade: 'PontoSuplementacao', registro: existente, versaoEsperada, rotulo: String(existente.categoria_ponto ?? '').toUpperCase() === 'DEPOSITO' ? 'O depósito' : 'O cocho', pedido: resto });
    const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, exigirSomenteColunasGravaveis('PontoSuplementacao', resto));
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'PontoSuplementacao',
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

/**
 * Elegibilidade de exclusão (só leitura): `{ id, pode_excluir, motivos }`.
 * A tela consulta antes de excluir para dizer o porquê; a exclusão confere de novo.
 */
export const elegibilidadeExclusao = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const existente = await buscarRegistro(auth.clienteId, id);
  if (!existente) throw erroNaoEncontrado();
  const motivos = await motivosHistoricoPonto(prisma, auth.clienteId, existente);
  return { id, pode_excluir: motivos.length === 0, motivos };
};

/**
 * Exclui o cocho/depósito, numa transação:
 *  - com histórico → 409 `PONTO_SUPLEMENTACAO_COM_HISTORICO`, nada apagado;
 *  - depósito: os cochos que apontavam para ele são desvinculados, e o
 *    LocalEstoque dele (se nenhum outro ponto o usa) é inativado — nunca
 *    apagado aqui (D-PROD-137: DELETE de local só pela tela Locais).
 */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();

    const motivos = await motivosHistoricoPonto(tx, auth.clienteId, existente);
    if (motivos.length) throw erroComHistorico(id, motivos);

    const ehDeposito = String(existente.categoria_ponto ?? '').toUpperCase() === 'DEPOSITO';
    if (ehDeposito) {
      for (const cocho of await listarCochosDoDeposito(tx, auth.clienteId, id)) {
        const desvinculado = await atualizarRegistroPorId(tx, auth.clienteId, cocho.id, {
          deposito_origem_id: null,
          deposito_origem_nome: null,
        });
        await registrarEvento(
          contexto,
          {
            acao: 'update',
            entidade: 'PontoSuplementacao',
            entidadeId: cocho.id,
            dadosAnteriores: comoPublico(cocho),
            dadosNovos: comoPublico(desvinculado),
          },
          tx
        );
      }
    }

    await excluirRegistroPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: 'PontoSuplementacao', entidadeId: id, dadosAnteriores: comoPublico(existente) },
      tx
    );

    // D-PROD-137: DELETE de local de estoque é só da tela Locais. Aqui o local do
    // depósito (se nenhum outro ponto o usa) é só INATIVADO, na mesma transação;
    // quem tiver Locais "excluir" pode removê-lo depois.
    const localId = ehDeposito ? existente.local_estoque_id : null;
    if (localId && !(await outroPontoUsaLocal(tx, auth.clienteId, localId, id))) {
      const local = await tx.localEstoque.findUnique({
        where: { cliente_id_id: { cliente_id: auth.clienteId, id: localId } },
      });
      if (local && local.ativo !== false) {
        await tx.localEstoque.update({
          where: { cliente_id_id: { cliente_id: auth.clienteId, id: localId } },
          data: { ativo: false },
        });
        await registrarEvento(
          contexto,
          {
            acao: 'update',
            entidade: 'LocalEstoque',
            entidadeId: localId,
            dadosAnteriores: { id: localId, nome: local.nome, ativo: true },
            dadosNovos: { id: localId, nome: local.nome, ativo: false },
          },
          tx
        );
      }
    }
  });
};
