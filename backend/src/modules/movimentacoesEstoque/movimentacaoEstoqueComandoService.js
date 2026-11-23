/**
 * Comandos transacionais de movimentação de estoque (ESTAB-P0-01).
 *
 * D-PROD-161 (Estoque P0, motor físico único): a suplementação e a
 * transferência entre locais não têm mais FIFO próprio em Number. Elas só
 * validam a entrada e chamam o motor (`estoqueFisicoMotor.js`):
 *  - suplementação → `aplicarSaida` com `ORIGEM_SUPLEMENTACAO` (CAS no lote,
 *    decremento conferido do cache, `lotes_consumidos`);
 *  - transferência → `aplicarTransferenciaEstoque` (camadas de destino com o
 *    custo, a data e a procedência da origem; cache intocado).
 * Ordem de travas: recibo → local (FOR KEY SHARE) → produto → lotes (CAS) →
 * INSERTs → Produto ± → sequência NO FIM (`numerarMovimentos`) → AuditLog.
 *
 * Contrato externo preservado (§3.4 da SPEC P0): rotas, schemas, status
 * 201/200, chaves do corpo, `rateio[]` com números e o fingerprint de
 * idempotência (quantidade em Number, mesmas chaves e ordem) — um recibo antigo
 * continua dando replay. Todas as validações novas ficam DENTRO de `executar`.
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { buscarRegistro as buscarEmpresa } from '../empresas/empresaRepository.js';
import { buscarProduto } from '../produtos/produtoRepository.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { comoPublico, ENTIDADE_SEQUENCIA } from './movimentacaoEstoqueService.js';
import { CASAS_CUSTO, CASAS_QUANTIDADE, dec, paraBanco } from '../financeiro/decimalFinanceiro.js';
import { comporObservacoes } from '../estoqueFisico/rateioObservacoes.js';
import {
  ENTIDADE_MOVIMENTO,
  ORIGEM_SUPLEMENTACAO,
  aplicarSaida,
  aplicarTransferenciaEstoque,
  exigirLocaisEstoque,
  kgDeEntrada,
  normalizarLotesEscolhidos,
  numerarMovimentos,
  numeroMovimentoProvisorio,
  travarProdutosEstoque,
} from '../estoqueFisico/estoqueFisicoMotor.js';

const TIPO_SAIDA = 'saida_suplementacao';
const TIPO_TRANSFERENCIA = 'transferencia_locais';

// Uma sequência ÚNICA de movimentos por tenant: o motor numera no fim com a
// mesma entidade que o CRUD de movimentos usa (fail-closed se divergirem).
if (ENTIDADE_SEQUENCIA !== ENTIDADE_MOVIMENTO) {
  throw new Error(`sequência de movimentos divergente: ${ENTIDADE_SEQUENCIA} × ${ENTIDADE_MOVIMENTO}`);
}

/**
 * Quantidade do corpo para o FINGERPRINT de idempotência (formato congelado:
 * Number, mesmas chaves e ordem). Nunca decide saldo nem custo: o kg do efeito
 * é `kgDeEntrada` (Decimal, HALF_UP(4) uma vez).
 * @param {unknown} valor
 */
const parseNumero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

/** @param {string} operationId */
const exigirOperationId = (operationId) => {
  const chave = typeof operationId === 'string' ? operationId.trim() : '';
  if (chave.length < 8 || chave.length > 128) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'operation_id inválido', {
      details: { field: 'operation_id', reason: 'format' },
    });
  }
  return chave;
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} empresaId
 */
const exigirEmpresaDoTenant = async (tx, clienteId, empresaId) => {
  const empresa = await buscarEmpresa(clienteId, empresaId, tx);
  if (!empresa) {
    throw new AppError('EMPRESA_NOT_FOUND', 'Empresa não encontrada neste tenant');
  }
  return empresa;
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} produtoId
 * @param {string} empresaId
 */
const exigirProdutoDaEmpresa = async (tx, clienteId, produtoId, empresaId) => {
  const produto = await buscarProduto(clienteId, produtoId, tx);
  if (!produto || produto.empresa_id !== empresaId) {
    throw new AppError('PRODUTO_NOT_FOUND', 'Produto não encontrado nesta empresa');
  }
  return produto;
};

const DIA_ISO = /^\d{4}-\d{2}-\d{2}/;

/**
 * Instante do movimento: meio-dia UTC do dia `AAAA-MM-DD` informado; ausente →
 * agora (como antes). D-PROD-161: formato inválido ou dia inexistente → 400
 * (antes virava `Invalid Date` e 500 no INSERT).
 * @param {unknown} valor
 */
const dataMovimentacaoDeEntrada = (valor) => {
  if (!valor) return new Date();
  const texto = String(valor);
  const dia = texto.slice(0, 10);
  const instante = DIA_ISO.test(texto) ? new Date(`${dia}T12:00:00.000Z`) : null;
  if (!instante || Number.isNaN(instante.getTime()) || instante.toISOString().slice(0, 10) !== dia) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'data_movimentacao inválida (use AAAA-MM-DD)', {
      details: { field: 'data_movimentacao', reason: 'format' },
    });
  }
  return instante;
};

/**
 * `rateio[]` da resposta no formato externo de antes da P0 (números JSON), com
 * os valores vindos do Decimal do motor; `lote_destino_id` só na transferência (aditivo).
 * @param {Array<{ lote_id: string, quantidade: any, custo_unitario: any, lote: any, lote_destino_id?: string }>} fatias
 */
const rateioLegado = (fatias) =>
  fatias.map((f) => ({
    lote_id: f.lote_id,
    numero_documento: f.lote.numero_documento || 'S/N',
    serie_documento: f.lote.serie_documento || '',
    data_documento: f.lote.data_documento ?? null,
    fornecedor_id: f.lote.fornecedor_id ?? null,
    fornecedor_nome: f.lote.fornecedor_nome ?? null,
    quantidade_consumida: Number(dec(f.quantidade).toFixed(CASAS_QUANTIDADE)),
    custo_unitario: Number(dec(f.custo_unitario).toFixed(CASAS_CUSTO)),
    valor_total: Number(dec(f.quantidade).times(dec(f.custo_unitario)).toString()),
    ...(f.lote_destino_id ? { lote_destino_id: f.lote_destino_id } : {}),
  }));

/** Movimento relido depois de `numerarMovimentos` (sem isso a resposta/recibo/auditoria sairiam com `p-…`). */
const relerMovimento = (tx, clienteId, id) =>
  tx.movimentacaoEstoque.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } });

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const comandoSaidaSuplementacao = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const operationKey = exigirOperationId(String(entrada.operation_id ?? ''));
  const empresaId = String(entrada.empresa_id || '').trim();
  const produtoId = String(entrada.produto_id || '').trim();
  const localOrigemId = String(entrada.local_origem_id || '').trim();
  const quantidade = parseNumero(entrada.quantidade);
  const lotesEscolhidos = normalizarLotesEscolhidos(entrada.lotes);

  const payloadCanonico = {
    empresa_id: empresaId,
    produto_id: produtoId,
    local_origem_id: localOrigemId,
    quantidade,
    area_id: entrada.area_id ?? null,
    deposito_id: entrada.deposito_id ?? null,
    ponto_suplementacao_id: entrada.ponto_suplementacao_id ?? null,
    data_movimentacao: entrada.data_movimentacao ?? null,
    observacoes: entrada.observacoes ?? null,
    // D-PROD-279: a escolha de lotes só entra no fingerprint quando vem (o reenvio de antes continua casando).
    ...(lotesEscolhidos ? { lotes: lotesEscolhidos } : {}),
  };
  const fingerprint = fingerprintDePayload(payloadCanonico);

  // D-PROD-155 (§8.4): espera as travas que confirmar/cancelar seguram, mas só
  // até a resposta caber nos 20 s do navegador (TRANSACAO_CURTA): o formulário
  // antigo gera operation_id NOVO a cada envio, então um commit depois do aviso
  // de falha viraria segunda baixa no reenvio. Espera longa demais → 409
  // CONCURRENCY_CONFLICT definitivo (nada gravado, nem depois).
  const resultado = await emTransacao(TRANSACAO_CURTA, async (tx) => {
    const idem = await executarComIdempotencia(tx, {
      clienteId: cli,
      operationKey,
      tipoOperacao: TIPO_SAIDA,
      fingerprint,
      executar: async () => {
        await exigirEmpresaDoTenant(tx, cli, empresaId);
        const instante = dataMovimentacaoDeEntrada(entrada.data_movimentacao);
        const kg = kgDeEntrada(entrada.quantidade);
        // D-PROD-161: local validado e travado ANTES do produto (a origem pode estar
        // inativa, para consumir o resto); o nome vem do banco, não do corpo.
        const locais = await exigirLocaisEstoque(tx, cli, [{ id: localOrigemId, field: 'local_origem_id', exigirAtivo: false }]);
        // D-PROD-155 (§3/§8.4): trava do produto (a MESMA chave do lançamento
        // financeiro) ANTES de ler produto e lotes.
        await travarProdutosEstoque(tx, cli, empresaId, [produtoId]);
        const produto = await exigirProdutoDaEmpresa(tx, cli, produtoId, empresaId);
        const local = /** @type {{ id: string, nome: string }} */ (locais.get(localOrigemId));
        const saida = await aplicarSaida(tx, contexto, {
          empresaId,
          produto,
          local: { id: local.id, nome: local.nome },
          quantidadeKg: kg,
          instante,
          origem: { sistema: ORIGEM_SUPLEMENTACAO, operacaoId: null, tipoDetalhado: 'suplementacao', motivo: 'Baixa automática de suplementação' },
          numeroMovimento: numeroMovimentoProvisorio(),
          procedencia: true,
          contextoErro: { field: 'quantidade' },
          lotes: lotesEscolhidos,
          complemento: (plano) => ({
            area_vinculada_id: entrada.area_id ?? null,
            area_vinculada_nome: entrada.area_nome ?? null,
            tipo_vinculo: entrada.area_id ? 'area' : null,
            centro_custo_nome: entrada.area_nome ?? null,
            deposito_id: entrada.deposito_id ?? null,
            ponto_suplementacao_id: entrada.ponto_suplementacao_id ?? null,
            observacoes: comporObservacoes(entrada.observacoes, plano.fatias),
            custo_medio_antes: paraBanco(plano.custoMedioAntes, CASAS_CUSTO),
            custo_medio_depois: paraBanco(plano.custoMedioDepois, CASAS_CUSTO),
          }),
        });
        // Sequência de movimentos só no FIM (W24): não prende a numeração do tenant durante os efeitos.
        await numerarMovimentos(tx, cli, [saida.movimento.id]);
        const publico = comoPublico(await relerMovimento(tx, cli, saida.movimento.id));
        await registrarEvento(
          contexto,
          {
            acao: 'create',
            entidade: 'MovimentacaoEstoque',
            entidadeId: saida.movimento.id,
            dadosNovos: publico,
          },
          tx
        );

        const body = {
          committed: true,
          operation_id: operationKey,
          replay: false,
          movimentacao: publico,
          rateio: rateioLegado(/** @type {any[]} */ (saida.fatias)),
        };
        return { httpStatus: 201, body };
      },
    });
    // D-PROD-268: o recibo da baixa continua `committed` depois do cancelamento do
    // lançamento do cocho (a reconciliação e o bloqueio da exclusão da compra o leem).
    // Reenviar a chave original dessa baixa não pode responder "baixada" com o retrato
    // antigo: se a saída foi estornada pelo cancelamento, recusa sem gravar nada.
    if (idem.replay) await recusarReplayDeSaidaEstornada(tx, cli, idem.body);
    return idem;
  });

  if (resultado.replay) {
    return { ...resultado.body, replay: true };
  }
  return resultado.body;
};

/**
 * D-PROD-268 — replay de uma saída de suplementação cujo lançamento de cocho foi
 * cancelado: 409 `SUPLEMENTACAO_REGISTRO_CANCELADO` (nada gravado).
 * @param {any} tx
 * @param {string} cli
 * @param {any} body  resposta guardada no recibo
 */
const recusarReplayDeSaidaEstornada = async (tx, cli, body) => {
  const id = body?.movimentacao?.id;
  if (typeof id !== 'string' || !id) return;
  const m = await tx.movimentacaoEstoque.findUnique({
    where: { cliente_id_id: { cliente_id: cli, id } },
    select: { id: true, status: true, movimento_filho_id: true },
  });
  if (!m || m.status !== 'Estornada' || !m.movimento_filho_id) return;
  const filho = await tx.movimentacaoEstoque.findUnique({
    where: { cliente_id_id: { cliente_id: cli, id: m.movimento_filho_id } },
    select: { tipo_detalhado: true },
  });
  if (filho?.tipo_detalhado !== 'estorno_suplementacao') return;
  throw new AppError(
    'SUPLEMENTACAO_REGISTRO_CANCELADO',
    'esta baixa foi estornada pelo cancelamento do lançamento do cocho; nada foi gravado agora',
    { details: { field: 'operation_id', reason: 'saida_estornada', movimentacao_id: m.id } }
  );
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const comandoTransferenciaEntreLocais = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const operationKey = exigirOperationId(String(entrada.operation_id ?? ''));
  const empresaId = String(entrada.empresa_id || '').trim();
  const produtoId = String(entrada.produto_id || '').trim();
  const localOrigemId = String(entrada.local_origem_id || '').trim();
  const localDestinoId = String(entrada.local_destino_id || '').trim();
  const quantidade = parseNumero(entrada.quantidade);
  const lotesEscolhidos = normalizarLotesEscolhidos(entrada.lotes);

  if (localOrigemId === localDestinoId) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'Origem e destino devem ser distintos', {
      details: { field: 'local_destino_id', reason: 'invalid' },
    });
  }

  const payloadCanonico = {
    empresa_id: empresaId,
    produto_id: produtoId,
    local_origem_id: localOrigemId,
    local_destino_id: localDestinoId,
    quantidade,
    data_movimentacao: entrada.data_movimentacao ?? null,
    observacoes: entrada.observacoes ?? null,
    // D-PROD-279: a escolha de lotes só entra no fingerprint quando vem (o reenvio de antes continua casando).
    ...(lotesEscolhidos ? { lotes: lotesEscolhidos } : {}),
  };
  const fingerprint = fingerprintDePayload(payloadCanonico);

  // D-PROD-155 (§8.4): espera as travas que confirmar/cancelar seguram, mas só
  // até a resposta caber nos 20 s do navegador (TRANSACAO_CURTA): o formulário
  // antigo gera operation_id NOVO a cada envio, então um commit depois do aviso
  // de falha viraria segunda baixa no reenvio. Espera longa demais → 409
  // CONCURRENCY_CONFLICT definitivo (nada gravado, nem depois).
  const resultado = await emTransacao(TRANSACAO_CURTA, async (tx) => {
    const idem = await executarComIdempotencia(tx, {
      clienteId: cli,
      operationKey,
      tipoOperacao: TIPO_TRANSFERENCIA,
      fingerprint,
      executar: async () => {
        await exigirEmpresaDoTenant(tx, cli, empresaId);
        const instante = dataMovimentacaoDeEntrada(entrada.data_movimentacao);
        const kg = kgDeEntrada(entrada.quantidade);
        // D-PROD-161: origem e destino num único SELECT … FOR KEY SHARE em ordem
        // de id, antes do produto; destino tem de estar ativo.
        const locais = await exigirLocaisEstoque(tx, cli, [
          { id: localOrigemId, field: 'local_origem_id', exigirAtivo: false },
          { id: localDestinoId, field: 'local_destino_id', exigirAtivo: true },
        ]);
        // D-PROD-155 (§3/§8.4): mesma trava do produto antes de ler lotes.
        await travarProdutosEstoque(tx, cli, empresaId, [produtoId]);
        const produto = await exigirProdutoDaEmpresa(tx, cli, produtoId, empresaId);
        const origem = /** @type {{ id: string, nome: string }} */ (locais.get(localOrigemId));
        const destino = /** @type {{ id: string, nome: string }} */ (locais.get(localDestinoId));
        const t = await aplicarTransferenciaEstoque(tx, contexto, {
          empresaId,
          produto,
          origem: { id: origem.id, nome: origem.nome },
          destino: { id: destino.id, nome: destino.nome },
          quantidadeKg: kg,
          instante,
          numeros: { saida: numeroMovimentoProvisorio(), entrada: numeroMovimentoProvisorio() },
          contextoErro: { field: 'quantidade' },
          lotes: lotesEscolhidos,
          complemento: (plano) => ({
            observacoes: comporObservacoes(entrada.observacoes, plano.fatias),
            custo_medio_antes: paraBanco(plano.custoMedioAntes, CASAS_CUSTO),
            custo_medio_depois: paraBanco(plano.custoMedioDepois, CASAS_CUSTO),
          }),
        });
        // Saída = n, entrada = n + 1, reservados no FIM (W24).
        await numerarMovimentos(tx, cli, [t.saida.id, t.entrada.id]);
        const publicoSaida = comoPublico(await relerMovimento(tx, cli, t.saida.id));
        const publicoEntrada = comoPublico(await relerMovimento(tx, cli, t.entrada.id));
        await registrarEvento(
          contexto,
          {
            acao: 'create',
            entidade: 'MovimentacaoEstoque',
            entidadeId: t.saida.id,
            dadosNovos: publicoSaida,
          },
          tx
        );
        await registrarEvento(
          contexto,
          {
            acao: 'create',
            entidade: 'MovimentacaoEstoque',
            entidadeId: t.entrada.id,
            dadosNovos: publicoEntrada,
          },
          tx
        );

        const body = {
          committed: true,
          operation_id: operationKey,
          replay: false,
          movimentacao_saida: publicoSaida,
          movimentacao_entrada: publicoEntrada,
          rateio: rateioLegado(t.fatias),
        };
        return { httpStatus: 201, body };
      },
    });
    return idem;
  });

  if (resultado.replay) {
    return { ...resultado.body, replay: true };
  }
  return resultado.body;
};
