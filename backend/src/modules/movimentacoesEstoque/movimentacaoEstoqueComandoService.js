/**
 * Comandos transacionais de movimentação de estoque (ESTAB-P0-01).
 */
import { Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { buscarRegistro as buscarEmpresa } from '../empresas/empresaRepository.js';
import { buscarProduto } from '../produtos/produtoRepository.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { buscarRegistro as buscarLoteNota, inserirRegistro as inserirLoteNota, atualizarRegistroPorId as atualizarLoteNota } from '../estoqueLotesNota/estoqueLoteNotaRepository.js';
import { inserirRegistro, atualizarRegistroPorId } from './movimentacaoEstoqueRepository.js';
import { comoPublico, ENTIDADE_SEQUENCIA } from './movimentacaoEstoqueService.js';
import { buildRateioObservacao, calcularRateioFifo, parseNumero } from './fifoEstoque.js';

const TIPO_SAIDA = 'saida_suplementacao';
const TIPO_TRANSFERENCIA = 'transferencia_locais';

const dec = (valor) => {
  if (valor instanceof Prisma.Decimal) return valor.toNumber();
  return parseNumero(valor);
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

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {{ empresa_id: string; produto_id: string; local_estoque_id: string }} filtro
 */
const listarLotesFifo = async (tx, clienteId, filtro) =>
  tx.estoqueLoteNota.findMany({
    where: {
      cliente_id: clienteId,
      empresa_id: filtro.empresa_id,
      produto_id: filtro.produto_id,
      local_estoque_id: filtro.local_estoque_id,
      status: 'Disponivel',
      quantidade_disponivel: { gt: 0 },
    },
    orderBy: [{ data_documento: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {Array<Record<string, unknown>>} rateio
 */
const aplicarBaixaFifo = async (tx, clienteId, rateio) => {
  for (const item of rateio) {
    const loteId = String(item.lote_id);
    const consumo = parseNumero(item.quantidade_consumida);
    const lote = await buscarLoteNota(clienteId, loteId, tx);
    if (!lote) {
      throw new AppError('ESTOQUE_LOTE_NOT_FOUND', 'Lote de nota não encontrado', {
        details: { lote_id: loteId },
      });
    }
    const saldoAtual = dec(lote.quantidade_disponivel);
    if (consumo > saldoAtual) {
      throw new AppError('ESTOQUE_SALDO_INSUFICIENTE', 'Saldo insuficiente no lote para baixa FIFO', {
        details: { lote_id: loteId, field: 'quantidade_disponivel' },
      });
    }
    const novoSaldo = saldoAtual - consumo;
    await atualizarLoteNota(tx, clienteId, loteId, {
      quantidade_disponivel: novoSaldo,
      status: novoSaldo > 0 ? 'Disponivel' : 'Esgotado',
    });
  }
};

const dataMovimentacaoDeEntrada = (valor) => {
  if (!valor) return new Date();
  const texto = String(valor).slice(0, 10);
  return new Date(`${texto}T12:00:00.000Z`);
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const comandoSaidaSuplementacao = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const operationKey = exigirOperationId(String(entrada.operation_id ?? ''));
  const empresaId = String(entrada.empresa_id || '').trim();
  const produtoId = String(entrada.produto_id || '').trim();
  const localOrigemId = String(entrada.local_origem_id || '').trim();
  const quantidade = parseNumero(entrada.quantidade);

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
  };
  const fingerprint = fingerprintDePayload(payloadCanonico);

  const prisma = getPrismaClient();
  const resultado = await prisma.$transaction(async (tx) => {
    const idem = await executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey,
      tipoOperacao: TIPO_SAIDA,
      fingerprint,
      executar: async () => {
        await exigirEmpresaDoTenant(tx, auth.clienteId, empresaId);
        const produto = await exigirProdutoDaEmpresa(tx, auth.clienteId, produtoId, empresaId);
        const lotes = await listarLotesFifo(tx, auth.clienteId, {
          empresa_id: empresaId,
          produto_id: produtoId,
          local_estoque_id: localOrigemId,
        });

        const fifo = calcularRateioFifo({
          lotesNota: lotes,
          produtoId,
          localEstoqueId: localOrigemId,
          quantidade,
        });
        if (!fifo.sucesso) {
          throw new AppError('ESTOQUE_SALDO_INSUFICIENTE', fifo.erro || 'Baixa inviável', {
            details: { field: 'quantidade', reason: 'insufficient' },
          });
        }

        const saldoAntes = lotes.reduce((t, l) => t + dec(l.quantidade_disponivel), 0);
        const numero = String(
          await reservarNumero(tx, {
            clienteId: auth.clienteId,
            entidade: ENTIDADE_SEQUENCIA,
            escopoTipo: ESCOPO_TENANT,
          })
        );

        const obsRateio = buildRateioObservacao(fifo.rateio);
        const observacoes = [entrada.observacoes, obsRateio ? `[RATEIO_FIFO] ${obsRateio}` : '']
          .filter(Boolean)
          .join('\n');

        const movimentacao = await inserirRegistro(tx, {
          cliente_id: auth.clienteId,
          empresa_id: empresaId,
          numero_movimentacao: numero,
          tipo_movimentacao: 'Saída',
          tipo_detalhado: 'suplementacao',
          data_movimentacao: dataMovimentacaoDeEntrada(entrada.data_movimentacao),
          produto_id: produtoId,
          produto_nome: produto.nome_produto,
          produto_codigo: produto.codigo_interno || produto.codigo_barras || '',
          produto_categoria: produto.categoria,
          quantidade,
          unidade_medida: produto.unidade_medida || 'KG',
          valor_unitario: fifo.custoMedioPonderado,
          valor_total: fifo.valorTotal,
          local_estoque_origem: localOrigemId,
          local_origem: entrada.local_origem_nome ?? null,
          area_vinculada_id: entrada.area_id ?? null,
          area_vinculada_nome: entrada.area_nome ?? null,
          tipo_vinculo: entrada.area_id ? 'area' : null,
          centro_custo_nome: entrada.area_nome ?? null,
          motivo_movimentacao: 'Baixa automática de suplementação',
          observacoes,
          origem_sistema: 'suplementacao',
          deposito_id: entrada.deposito_id ?? null,
          ponto_suplementacao_id: entrada.ponto_suplementacao_id ?? null,
          bloqueado_exclusao_estoque: true,
          exclusao_somente_em: 'cocho',
          is_registro_principal: true,
          numero_movimentacao_seq: 1,
          total_movimentacoes_grupo: 1,
          saldo_antes: saldoAntes,
          saldo_depois: saldoAntes - quantidade,
          custo_medio_antes: dec(produto.preco_custo),
          custo_medio_depois: fifo.custoMedioPonderado,
          usuario_responsavel: auth.login || 'Sistema',
          status: 'Ativa',
        });

        await aplicarBaixaFifo(tx, auth.clienteId, fifo.rateio);

        const estoqueAtual = dec(produto.estoque_atual);
        const novoEstoque = estoqueAtual - quantidade;
        if (novoEstoque < 0) {
          throw new AppError('ESTOQUE_SALDO_INSUFICIENTE', 'Estoque do produto ficaria negativo', {
            details: { field: 'estoque_atual' },
          });
        }
        await tx.produto.update({
          where: { cliente_id_id: { cliente_id: auth.clienteId, id: produtoId } },
          data: { estoque_atual: novoEstoque },
        });

        const publico = comoPublico(movimentacao);
        await registrarEvento(
          contexto,
          {
            acao: 'create',
            entidade: 'MovimentacaoEstoque',
            entidadeId: movimentacao.id,
            dadosNovos: publico,
          },
          tx
        );

        const body = {
          committed: true,
          operation_id: operationKey,
          replay: false,
          movimentacao: publico,
          rateio: fifo.rateio,
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

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const comandoTransferenciaEntreLocais = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const operationKey = exigirOperationId(String(entrada.operation_id ?? ''));
  const empresaId = String(entrada.empresa_id || '').trim();
  const produtoId = String(entrada.produto_id || '').trim();
  const localOrigemId = String(entrada.local_origem_id || '').trim();
  const localDestinoId = String(entrada.local_destino_id || '').trim();
  const quantidade = parseNumero(entrada.quantidade);

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
  };
  const fingerprint = fingerprintDePayload(payloadCanonico);
  const prisma = getPrismaClient();

  const resultado = await prisma.$transaction(async (tx) => {
    const idem = await executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey,
      tipoOperacao: TIPO_TRANSFERENCIA,
      fingerprint,
      executar: async () => {
        await exigirEmpresaDoTenant(tx, auth.clienteId, empresaId);
        const produto = await exigirProdutoDaEmpresa(tx, auth.clienteId, produtoId, empresaId);
        const lotes = await listarLotesFifo(tx, auth.clienteId, {
          empresa_id: empresaId,
          produto_id: produtoId,
          local_estoque_id: localOrigemId,
        });

        const fifo = calcularRateioFifo({
          lotesNota: lotes,
          produtoId,
          localEstoqueId: localOrigemId,
          quantidade,
        });
        if (!fifo.sucesso) {
          throw new AppError('ESTOQUE_SALDO_INSUFICIENTE', fifo.erro || 'Transferência inviável', {
            details: { field: 'quantidade', reason: 'insufficient' },
          });
        }

        const lotesDestino = await tx.estoqueLoteNota.findMany({
          where: {
            cliente_id: auth.clienteId,
            empresa_id: empresaId,
            produto_id: produtoId,
            local_estoque_id: localDestinoId,
            status: 'Disponivel',
          },
        });
        const saldoDestino = lotesDestino.reduce((t, l) => t + dec(l.quantidade_disponivel), 0);
        const saldoOrigem = lotes.reduce((t, l) => t + dec(l.quantidade_disponivel), 0);

        const numeroSaida = String(
          await reservarNumero(tx, {
            clienteId: auth.clienteId,
            entidade: ENTIDADE_SEQUENCIA,
            escopoTipo: ESCOPO_TENANT,
          })
        );
        const numeroEntrada = String(
          await reservarNumero(tx, {
            clienteId: auth.clienteId,
            entidade: ENTIDADE_SEQUENCIA,
            escopoTipo: ESCOPO_TENANT,
          })
        );

        const obsRateio = buildRateioObservacao(fifo.rateio);
        const observacoes = [entrada.observacoes, obsRateio ? `[RATEIO_FIFO] ${obsRateio}` : '']
          .filter(Boolean)
          .join('\n');
        const dataMov = dataMovimentacaoDeEntrada(entrada.data_movimentacao);
        const comum = {
          cliente_id: auth.clienteId,
          empresa_id: empresaId,
          data_movimentacao: dataMov,
          produto_id: produtoId,
          produto_nome: produto.nome_produto,
          produto_codigo: produto.codigo_interno || produto.codigo_barras || '',
          produto_categoria: produto.categoria,
          quantidade,
          unidade_medida: produto.unidade_medida || 'KG',
          valor_unitario: fifo.custoMedioPonderado,
          valor_total: fifo.valorTotal,
          local_estoque_origem: localOrigemId,
          local_origem: entrada.local_origem_nome ?? null,
          local_estoque_destino: localDestinoId,
          local_destino: entrada.local_destino_nome ?? null,
          motivo_movimentacao: 'Transferência entre locais de estoque',
          observacoes,
          origem_sistema: 'deposito',
          bloqueado_exclusao_estoque: true,
          exclusao_somente_em: 'deposito',
          custo_medio_antes: dec(produto.preco_custo),
          custo_medio_depois: fifo.custoMedioPonderado,
          usuario_responsavel: auth.login || 'Sistema',
          status: 'Ativa',
        };

        const movimentacaoSaida = await inserirRegistro(tx, {
          ...comum,
          numero_movimentacao: numeroSaida,
          tipo_movimentacao: 'Saída',
          tipo_detalhado: 'transferencia_enviada',
          is_registro_principal: true,
          numero_movimentacao_seq: 1,
          total_movimentacoes_grupo: 2,
          saldo_antes: saldoOrigem,
          saldo_depois: saldoOrigem - quantidade,
        });

        await aplicarBaixaFifo(tx, auth.clienteId, fifo.rateio);

        const movimentacaoEntrada = await inserirRegistro(tx, {
          ...comum,
          numero_movimentacao: numeroEntrada,
          tipo_movimentacao: 'Entrada',
          tipo_detalhado: 'transferencia_recebida',
          movimento_pai_id: movimentacaoSaida.id,
          is_registro_principal: false,
          numero_movimentacao_seq: 2,
          total_movimentacoes_grupo: 2,
          saldo_antes: saldoDestino,
          saldo_depois: saldoDestino + quantidade,
        });

        await atualizarRegistroPorId(tx, auth.clienteId, movimentacaoSaida.id, {
          movimento_filho_id: movimentacaoEntrada.id,
          total_movimentacoes_grupo: 2,
        });

        for (const item of fifo.rateio) {
          await inserirLoteNota(tx, {
            cliente_id: auth.clienteId,
            empresa_id: empresaId,
            produto_id: produtoId,
            produto_nome: produto.nome_produto,
            local_estoque_id: localDestinoId,
            local_estoque_nome: entrada.local_destino_nome ?? null,
            numero_documento: item.numero_documento,
            serie_documento: item.serie_documento,
            data_documento: item.data_documento ? new Date(String(item.data_documento).slice(0, 10)) : dataMov,
            fornecedor_id: item.fornecedor_id,
            fornecedor_nome: item.fornecedor_nome,
            custo_unitario: item.custo_unitario,
            quantidade_entrada: item.quantidade_consumida,
            quantidade_disponivel: item.quantidade_consumida,
            movimentacao_entrada_id: movimentacaoEntrada.id,
            status: 'Disponivel',
          });
        }

        const publicoSaida = comoPublico(movimentacaoSaida);
        const publicoEntrada = comoPublico(movimentacaoEntrada);
        await registrarEvento(
          contexto,
          {
            acao: 'create',
            entidade: 'MovimentacaoEstoque',
            entidadeId: movimentacaoSaida.id,
            dadosNovos: publicoSaida,
          },
          tx
        );
        await registrarEvento(
          contexto,
          {
            acao: 'create',
            entidade: 'MovimentacaoEstoque',
            entidadeId: movimentacaoEntrada.id,
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
          rateio: fifo.rateio,
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
