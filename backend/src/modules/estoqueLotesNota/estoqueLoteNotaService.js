/**
 * Serviço de EstoqueLoteNota (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirSomenteColunasGravaveis } from '../../shared/prisma/colunasGravaveis.js';
import { atorDoTenant, ehAdminTenantAtivo, tenantAdminRequired } from '../../shared/auth/exigirAdminTenant.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_LONGA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { travarProdutosEstoque } from '../estoqueFisico/estoqueFisicoMotor.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
  excluirRegistroPorId,
} from './estoqueLoteNotaRepository.js';



const erroNaoEncontrado = () => new AppError('ESTOQUE_LOTE_NOT_FOUND', 'EstoqueLoteNota não encontrado');

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

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id */
export const buscarPorId = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registro = await buscarRegistro(auth.clienteId, id);
  if (!registro) throw erroNaoEncontrado();
  return comoPublico(registro);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const criado = await prisma.$transaction(async (tx) => {
    /** @type {Record<string, unknown>} */
    const dados = { ...exigirSomenteColunasGravaveis('EstoqueLoteNota', entrada), cliente_id: auth.clienteId };

    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'EstoqueLoteNota', entidadeId: registro.id, dadosNovos: comoPublico(registro) },
      tx
    );
    return registro;
  });
  return comoPublico(criado);
};

/**
 * D-PROD-137 (F5/F7). O lote de nota compõe saldo e custo FIFO do depósito; o
 * POST e o estorno são só do administrador real. Por isso o PATCH:
 *  - aceita de QUALQUER conta só `local_estoque_nome` — a renomeação do depósito
 *    (FormularioPonto) propaga o nome DEPOIS de renomear o LocalEstoque;
 *  - qualquer outra coluna (quantidade, custo, status...) só do administrador
 *    real, relido no banco dentro da transação; a concessão is_admin não basta;
 *  - o nome é conferido contra o LocalEstoque vinculado (local_estoque_id) no
 *    mesmo tenant, para todos — admin inclusive (mesma regra do
 *    MovimentacaoEstoque). Relação ou chave desconhecida → 400.
 */
export const CAMPOS_PATCH_DE_QUALQUER_CONTA = Object.freeze(['local_estoque_nome']);

/**
 * D-PROD-154 (§8.4/§8.5): o PATCH/DELETE que mexe no saldo entra no protocolo de
 * travas NA ORDEM da venda/confirmação — produto (`travarProdutosEstoque`) e
 * DEPOIS o lote (FOR UPDATE) — e só então relê o lote. Sem isso, a contagem de
 * vínculos (READ COMMITTED, sem trava) não via a fatia de uma venda ainda não
 * commitada, e o UPDATE, depois de esperar a linha, sobrescrevia o saldo que a
 * venda acabara de baixar (saldo fantasma; a venda deixava de ser cancelável);
 * o DELETE batia na FK da fatia (403 enganoso). Inverter a ordem (lote antes do
 * produto) fecharia ciclo com a venda.
 * @param {any} tx @param {string} clienteId @param {any} lido lote lido antes da trava
 * @param {Array<unknown>} [outrosProdutos] produto novo de um PATCH que troca `produto_id`
 */
const travarLote = async (tx, clienteId, lido, outrosProdutos = []) => {
  await travarProdutosEstoque(tx, clienteId, lido.empresa_id, [lido.produto_id, ...outrosProdutos.filter((v) => typeof v === 'string')]);
  await tx.$queryRaw`SELECT id FROM "EstoqueLoteNota" WHERE cliente_id = ${clienteId} AND id = ${lido.id} FOR UPDATE`;
  const atual = await buscarRegistro(clienteId, lido.id, tx);
  if (!atual) throw erroNaoEncontrado();
  if (atual.produto_id !== lido.produto_id || atual.empresa_id !== lido.empresa_id) {
    throw new AppError('CONCURRENCY_CONFLICT', 'o lote mudou de produto ou de empresa durante a operação; recarregue e tente de novo; nada foi alterado');
  }
  return atual;
};

/** D-PROD-154 (§8.5): lote ligado a item ou fatia FIFO de lançamento financeiro → 409. Chamar sob `travarLote`. */
const recusarSeVinculadoALancamento = async (tx, clienteId, id) => {
  const [itens, consumos] = await Promise.all([
    tx.operacaoFinanceiraItem.count({ where: { cliente_id: clienteId, estoque_lote_nota_id: id } }),
    tx.operacaoFinanceiraConsumoLote.count({ where: { cliente_id: clienteId, estoque_lote_nota_id: id } }),
  ]);
  if (itens + consumos > 0) {
    throw new AppError('REGISTRO_OPERACIONAL_IMUTAVEL', 'lote de estoque vinculado a lançamento financeiro só muda pelo próprio lançamento (cancelamento); nada foi alterado', {
      details: { id, vinculo: 'lancamento_financeiro', itens, consumos },
    });
  }
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  // Espera as travas que confirmar/cancelar/suplementação seguram (até 30 s) em
  // vez de estourar os 5 s padrão (500); PATCH absoluto, sem operation_id.
  const atualizado = await emTransacao(TRANSACAO_LONGA, async (tx) => {
    const lido = await buscarRegistro(auth.clienteId, id, tx);
    if (!lido) throw erroNaoEncontrado();
    const patch = exigirSomenteColunasGravaveis('EstoqueLoteNota', entrada);
    const restritos = Object.keys(patch).filter((campo) => {
      if (CAMPOS_PATCH_DE_QUALQUER_CONTA.includes(campo)) return false;
      // clientes antigos reenviam a empresa atual
      return !(campo === 'empresa_id' && patch.empresa_id === lido.empresa_id);
    });
    if (restritos.length && !ehAdminTenantAtivo(await atorDoTenant(contexto, tx))) throw tenantAdminRequired();
    // D-PROD-154 (§8.4/§8.5): coluna operacional (saldo, custo, situação...) só
    // depois de travar produto → lote e reler; lote criado/consumido por
    // lançamento financeiro só muda pelo próprio lançamento (cancelamento): o
    // PATCH administrativo seria um "ressuscitar" de lote estornado ou saldo
    // fantasma. Só o nome do local (de qualquer conta) segue sem o protocolo.
    const existente = restritos.length ? await travarLote(tx, auth.clienteId, lido, [patch.produto_id]) : lido;
    if (restritos.length) await recusarSeVinculadoALancamento(tx, auth.clienteId, id);
    if (Object.prototype.hasOwnProperty.call(patch, 'local_estoque_nome')) {
      const nome = typeof patch.local_estoque_nome === 'string' ? patch.local_estoque_nome.trim() : '';
      const localId = Object.prototype.hasOwnProperty.call(patch, 'local_estoque_id') ? patch.local_estoque_id : existente.local_estoque_id;
      const local = typeof localId === 'string' && localId
        ? await tx.localEstoque.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: localId } }, select: { nome: true } })
        : null;
      if (!local || !nome || local.nome !== nome) {
        throw new AppError('NOME_LOCAL_DIVERGENTE', 'nome não corresponde ao local vinculado ao lote de nota', {
          details: { field: 'local_estoque_nome' },
        });
      }
      patch.local_estoque_nome = nome;
    }
    const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, patch);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'EstoqueLoteNota',
        entidadeId: id,
        dadosAnteriores: comoPublico(existente),
        dadosNovos: comoPublico(registro),
      },
      tx
    );
    return registro;
  }, {}, MENSAGEM_CONFLITO_SEM_CHAVE);
  return comoPublico(atualizado);
};

export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  await emTransacao(TRANSACAO_LONGA, async (tx) => {
    const lido = await buscarRegistro(auth.clienteId, id, tx);
    if (!lido) throw erroNaoEncontrado();
    // §8.4/§8.5: produto → lote travados e relidos ANTES de contar os vínculos.
    const existente = await travarLote(tx, auth.clienteId, lido);
    await recusarSeVinculadoALancamento(tx, auth.clienteId, id);
    await excluirRegistroPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: 'EstoqueLoteNota', entidadeId: id, dadosAnteriores: comoPublico(existente) },
      tx
    );
  }, {}, MENSAGEM_CONFLITO_SEM_CHAVE);
};
