/**
 * Serviço de EstoqueLoteNota (P5.4).
 *
 * D-PROD-161 (MAIKE-ESTOQUE-P0-01, F3): o lote é a camada de quantidade e custo
 * do motor físico. Ele só nasce de uma ENTRADA (compra confirmada) ou de uma
 * TRANSFERÊNCIA, e saldo, custo e situação só mudam pelos comandos do motor
 * (venda, suplementação, transferência, abastecimento e seus cancelamentos; o
 * item de apontamento de atividade da D-PROD-193 saiu na D-PROD-199).
 * Por esta API sobram a leitura e a renomeação benigna do local
 * (`local_estoque_nome`, FormularioPonto). POST, PATCH de coluna operacional e
 * DELETE de lote LIVRE → 409 ESTOQUE_ESCRITA_DIRETA_RECUSADA; nada é gravado.
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirSomenteColunasGravaveis } from '../../shared/prisma/colunasGravaveis.js';
import { atorDoTenant, ehAdminTenantAtivo, tenantAdminRequired } from '../../shared/auth/exigirAdminTenant.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { travarProdutosEstoque } from '../estoqueFisico/estoqueFisicoMotor.js';
import {
  listarRegistros,
  buscarRegistro,
  atualizarRegistroPorId,
} from './estoqueLoteNotaRepository.js';

const erroNaoEncontrado = () => new AppError('ESTOQUE_LOTE_NOT_FOUND', 'EstoqueLoteNota não encontrado');

/**
 * D-PROD-161: recusa da escrita direta de lote (details.entidade/operacao/campos).
 * @param {string} mensagem @param {{ operacao: 'criar'|'editar'|'excluir', campos?: string[] }} detalhes
 */
const escritaDiretaRecusada = (mensagem, detalhes) =>
  new AppError('ESTOQUE_ESCRITA_DIRETA_RECUSADA', mensagem, { details: { entidade: 'EstoqueLoteNota', ...detalhes } });

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

/**
 * D-PROD-161 (SPEC §2 W16, F3): saldo de lote sem fato (sem movimento de
 * entrada, sem trava, sem cache) não nasce mais por aqui. A ordem das recusas
 * anteriores fica: guarda SO_ADMIN (403) → colunas graváveis (400, a matriz de
 * relações) → 409. Sem transação e sem auditoria.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 * @returns {Promise<never>}
 */
export const criar = async (contexto, entrada) => {
  exigirAuthContext(contexto?.auth);
  exigirSomenteColunasGravaveis('EstoqueLoteNota', entrada);
  throw escritaDiretaRecusada(
    'lote de estoque só nasce de uma entrada (compra confirmada) ou de uma transferência entre locais; nada foi gravado',
    { operacao: 'criar' }
  );
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
 * D-PROD-155 (§8.4/§8.5): o PATCH/DELETE que mexe no saldo entra no protocolo de
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

/**
 * D-PROD-155 (§8.5): lote ligado a item ou fatia FIFO de lançamento financeiro → 409.
 * D-PROD-159 (X1): idem para fatia FIFO de abastecimento de bem (confirmado ou
 * cancelado: o histórico fica). Chamar sob `travarLote`.
 * D-PROD-199: o ramo das fatias FIFO de item de apontamento de atividade
 * (D-PROD-193) saiu com as tabelas dos itens, que a migration da Fatia 2 só
 * apaga vazias (o delegate do Prisma deixou de existir); as linhas de produto
 * da atividade chegam na Fatia 3.
 */
const recusarSeVinculadoALancamento = async (tx, clienteId, id) => {
  const [itens, consumos, abastecimentos] = await Promise.all([
    tx.operacaoFinanceiraItem.count({ where: { cliente_id: clienteId, estoque_lote_nota_id: id } }),
    tx.operacaoFinanceiraConsumoLote.count({ where: { cliente_id: clienteId, estoque_lote_nota_id: id } }),
    tx.abastecimentoBemConsumoLote.count({ where: { cliente_id: clienteId, estoque_lote_nota_id: id } }),
  ]);
  if (itens + consumos > 0) {
    throw new AppError('REGISTRO_OPERACIONAL_IMUTAVEL', 'lote de estoque vinculado a lançamento financeiro só muda pelo próprio lançamento (cancelamento); nada foi alterado', {
      details: { id, vinculo: 'lancamento_financeiro', itens, consumos },
    });
  }
  if (abastecimentos > 0) {
    throw new AppError('REGISTRO_OPERACIONAL_IMUTAVEL', 'lote de estoque consumido por abastecimento de bem só muda pelo próprio abastecimento (cancelamento); nada foi alterado', {
      details: { id, vinculo: 'abastecimento_bem', consumos_abastecimento: abastecimentos },
    });
  }
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  // Espera as travas que confirmar/cancelar/suplementação seguram em vez de
  // estourar os 5 s padrão (500), até caber nos 20 s do navegador
  // (TRANSACAO_CURTA; espera longa demais → 409); PATCH absoluto, sem operation_id.
  const atualizado = await emTransacao(TRANSACAO_CURTA, async (tx) => {
    const lido = await buscarRegistro(auth.clienteId, id, tx);
    if (!lido) throw erroNaoEncontrado();
    const patch = exigirSomenteColunasGravaveis('EstoqueLoteNota', entrada);
    const restritos = Object.keys(patch).filter((campo) => {
      if (CAMPOS_PATCH_DE_QUALQUER_CONTA.includes(campo)) return false;
      // clientes antigos reenviam a empresa atual
      return !(campo === 'empresa_id' && patch.empresa_id === lido.empresa_id);
    });
    if (restritos.length && !ehAdminTenantAtivo(await atorDoTenant(contexto, tx))) throw tenantAdminRequired();
    // D-PROD-155 (§8.4/§8.5): coluna operacional (saldo, custo, situação...) só
    // depois de travar produto → lote e reler; lote criado/consumido por
    // lançamento financeiro só muda pelo próprio lançamento (cancelamento): o
    // PATCH administrativo seria um "ressuscitar" de lote estornado ou saldo
    // fantasma. Só o nome do local (de qualquer conta) segue sem o protocolo.
    //
    // D-PROD-161 (SPEC §2 W17, F3): e o lote LIVRE também não muda por aqui —
    // a recusa vem DEPOIS da trava e da contagem de vínculos (a venda em curso
    // continua sendo esperada e o vínculo dela continua aparecendo como 409
    // REGISTRO_OPERACIONAL_IMUTAVEL); nada é gravado, nem o nome junto.
    if (restritos.length) {
      await travarLote(tx, auth.clienteId, lido, [patch.produto_id]);
      await recusarSeVinculadoALancamento(tx, auth.clienteId, id);
      throw escritaDiretaRecusada(
        'saldo, custo, situação, produto, empresa e local do lote só mudam pelos comandos do estoque; aqui só se renomeia o local (local_estoque_nome); nada foi alterado',
        { operacao: 'editar', campos: restritos }
      );
    }
    // D-PROD-161 (R2, achado B-01/LC-1): a renomeação TRAVA a linha do lote
    // (FOR NO KEY UPDATE, a força do próprio UPDATE: não disputa com o FOR KEY
    // SHARE das fatias FK) e RELÊ antes de auditar. Sem isso, uma baixa do motor
    // (CAS no lote) que commitasse entre a leitura e o UPDATE deixava o AuditLog
    // com `quantidade_disponivel` anterior ≠ nova — uma "escrita provada de
    // quantidade" que a renomeação não fez e que a reconciliação toma como
    // escritor fora do motor (falso LIMITACAO_LEGADA que mascara divergência
    // real). Só esta linha é travada e nada antes dela: o motor trava produto →
    // lote e só espera; não há ciclo. O caminho restrito acima segue a ordem
    // produto → lote de `travarLote` (esta trava não pode vir antes dele).
    await tx.$queryRaw`SELECT id FROM "EstoqueLoteNota" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR NO KEY UPDATE`;
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    if (Object.prototype.hasOwnProperty.call(patch, 'empresa_id') && patch.empresa_id !== existente.empresa_id) {
      throw new AppError('CONCURRENCY_CONFLICT', 'o lote mudou de empresa durante a operação; recarregue e tente de novo; nada foi alterado');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'local_estoque_nome')) {
      const nome = typeof patch.local_estoque_nome === 'string' ? patch.local_estoque_nome.trim() : '';
      const localId = existente.local_estoque_id;
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

/**
 * D-PROD-161 (SPEC §2 W18, F3): o lote nunca é apagado por aqui. Mantém o
 * protocolo de travas (produto → lote, relidos) e a contagem de vínculos — o
 * lote de lançamento ou de abastecimento continua respondendo 409
 * REGISTRO_OPERACIONAL_IMUTAVEL com o vínculo —; o lote LIVRE, 409
 * ESTOQUE_ESCRITA_DIRETA_RECUSADA. Nada é apagado.
 */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  await emTransacao(TRANSACAO_CURTA, async (tx) => {
    const lido = await buscarRegistro(auth.clienteId, id, tx);
    if (!lido) throw erroNaoEncontrado();
    // §8.4/§8.5: produto → lote travados e relidos ANTES de contar os vínculos.
    await travarLote(tx, auth.clienteId, lido);
    await recusarSeVinculadoALancamento(tx, auth.clienteId, id);
    throw escritaDiretaRecusada(
      'lote de estoque não é excluído: o saldo só sai pelos comandos do estoque (venda, suplementação, transferência, abastecimento ou cancelamento da compra); nada foi apagado',
      { operacao: 'excluir' }
    );
  }, {}, MENSAGEM_CONFLITO_SEM_CHAVE);
};
