/**
 * Serviço de MovimentacaoEstoque (P5.4).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirSomenteColunasGravaveis } from '../../shared/prisma/colunasGravaveis.js';
import { exigirSomenteCamposPermitidos, movimentoExigeCancelamento } from '../../shared/operacional/protecaoOperacional.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import {
  listarRegistros,
  buscarRegistro,
  atualizarRegistroPorId,
} from './movimentacaoEstoqueRepository.js';

export const ENTIDADE_SEQUENCIA = 'MovimentacaoEstoque';

const erroNaoEncontrado = () => new AppError('MOVIMENTACAO_ESTOQUE_NOT_FOUND', 'MovimentacaoEstoque não encontrado');

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
 * D-PROD-161 (MAIKE-ESTOQUE-P0-01, F3, SPEC §2 W13): movimento de estoque é o
 * FATO do motor físico — só nasce pelos comandos (compra/venda confirmada,
 * suplementação, transferência, abastecimento e seus cancelamentos), na mesma
 * transação do efeito no lote e no cache. O POST genérico inseria fato sem
 * saldo, forjava `origem_sistema`/`lotes_consumidos` e ocupava a sequência do
 * tenant. A rota fica registrada (gates P5.4) e a ordem das recusas anteriores
 * também: schema (400) → guarda SO_ADMIN (403) → colunas graváveis (400, a
 * matriz de relações) → 409 ESTOQUE_ESCRITA_DIRETA_RECUSADA. Sem transação,
 * sem reservar número e sem auditoria: nada é gravado.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 * @returns {Promise<never>}
 */
export const criar = async (contexto, entrada) => {
  exigirAuthContext(contexto?.auth);
  exigirSomenteColunasGravaveis('MovimentacaoEstoque', entrada);
  throw new AppError(
    'ESTOQUE_ESCRITA_DIRETA_RECUSADA',
    'movimento de estoque só nasce pelos comandos do estoque (compra ou venda confirmada, suplementação, transferência, abastecimento); nada foi gravado',
    { details: { entidade: 'MovimentacaoEstoque', operacao: 'criar' } }
  );
};

/**
 * R2A (D-PROD-99): movimento de estoque compõe saldo, FIFO e custo. PATCH aceita
 * SÓ o nome exibido do local (`local_origem`/`local_destino`), que a renomeação
 * de depósito propaga (`FormularioPonto`). O nome é conferido contra o
 * `LocalEstoque` vinculado ao movimento (`local_estoque_origem`/`_destino`) no
 * mesmo tenant: não muda id de local, quantidade, custo, produto, tipo ou data.
 */
export const CAMPOS_PATCH_PERMITIDOS = Object.freeze(['local_origem', 'local_destino']);

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  // D-PROD-155 (rodada 2, CRITICO-3): o cancelamento da P3 segura a linha do
  // movimento original (marcado 'Estornada') até o commit. A renomeação de
  // depósito (FormularioPonto) faz este PATCH: espera (TRANSACAO_CURTA) em vez
  // de estourar os 5 s padrão (500, renomeação pela metade); espera longa
  // demais → 409. Valor absoluto: repetir depois do 409 leva ao mesmo estado.
  const atualizado = await emTransacao(TRANSACAO_CURTA, async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    exigirSomenteCamposPermitidos(entrada, CAMPOS_PATCH_PERMITIDOS, { entidade: 'MovimentacaoEstoque', empresaAtual: existente.empresa_id });
    const patch = {};
    for (const [campo, campoId] of [
      ['local_origem', 'local_estoque_origem'],
      ['local_destino', 'local_estoque_destino'],
    ]) {
      if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
      const localId = existente[campoId];
      const nome = typeof entrada[campo] === 'string' ? entrada[campo].trim() : '';
      const local = localId
        ? await tx.localEstoque.findUnique({
            where: { cliente_id_id: { cliente_id: auth.clienteId, id: localId } },
            select: { nome: true },
          })
        : null;
      if (!local || !nome || local.nome !== nome) {
        throw new AppError('NOME_LOCAL_DIVERGENTE', 'nome não corresponde ao local vinculado ao movimento', {
          details: { field: campo },
        });
      }
      patch[campo] = nome;
    }
    if (Object.keys(patch).length === 0) return existente;
    const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, patch);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'MovimentacaoEstoque',
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

/** R2A (D-PROD-99): DELETE apagaria saldo/FIFO sem estorno — nada é removido. */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const existente = await buscarRegistro(auth.clienteId, id);
  if (!existente) throw erroNaoEncontrado();
  throw movimentoExigeCancelamento('MovimentacaoEstoque');
};

