/**
 * Service das Saídas do Estoque (D-PROD-264). Sem fazenda real selecionada, nada é lido (página vazia).
 * Decimais são TEXTO canônico: nada aqui faz aritmética de ponto flutuante. Não há valor digitado: o servidor
 * valoriza a saída pelo custo médio do depósito. Os seletores do formulário (produto, depósito, centros) são os
 * da entrada (`estoqueEntradasService`), que aceitam a ação `entrada` OU `saida`.
 */
import {
  listSaidasEstoque,
  getSaidaEstoque,
  createSaidaEstoque,
  updateSaidaEstoque,
  deleteSaidaEstoque,
  listMotivosSaida,
  createMotivoSaida,
  updateMotivoSaida,
} from '@/apis/estoque-saidas';
import { exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';

const RESOURCE = 'SaidaEstoque';
export const POR_PAGINA_SAIDAS = 100;

/** @param {unknown} v */
const textoOuIndefinido = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, status?: string|null, motivoId?: string|null, produtoId?: string|null,
 *   dataDe?: string|null, dataAte?: string|null }} [opts]
 */
export const listarSaidasEstoque = async (empresaId, opts = {}) => {
  const limit = opts.limit ?? POR_PAGINA_SAIDAS;
  if (!empresaId) return paginaVazia(limit);
  return listSaidasEstoque({
    empresa_id: empresaId,
    status: textoOuIndefinido(opts.status),
    motivo_id: textoOuIndefinido(opts.motivoId),
    produto_id: textoOuIndefinido(opts.produtoId),
    data_de: textoOuIndefinido(opts.dataDe),
    data_ate: textoOuIndefinido(opts.dataAte),
    q: textoOuIndefinido(opts.q),
    limit,
    cursor: textoOuIndefinido(opts.cursor),
  });
};

/** @param {string|null} empresaId @param {string} id */
export const detalharSaidaEstoque = async (empresaId, id) => getSaidaEstoque(id, exigirEmpresa(empresaId, 'detalharSaidaEstoque', RESOURCE));

/** Corpo já montado por `montarCorpoSaida`. @param {Record<string, unknown>} corpo */
export const criarSaidaEstoque = async (corpo) => createSaidaEstoque(corpo);

/** @param {string|null} empresaId @param {{ id: string, versao: number }} saida @param {{ motivoEdicao: string, observacao: string|null }} dados */
export const editarSaidaEstoque = async (empresaId, saida, dados) =>
  updateSaidaEstoque(saida.id, {
    empresa_id: exigirEmpresa(empresaId, 'editarSaidaEstoque', RESOURCE),
    versao: saida.versao,
    motivo_edicao: dados.motivoEdicao,
    observacao: dados.observacao,
  });

/** @param {string|null} empresaId @param {{ id: string, versao: number }} saida @param {{ motivo: string, operationId: string }} dados */
export const excluirSaidaEstoque = async (empresaId, saida, dados) =>
  deleteSaidaEstoque(saida.id, {
    empresa_id: exigirEmpresa(empresaId, 'excluirSaidaEstoque', RESOURCE),
    versao: saida.versao,
    motivo: dados.motivo,
    operation_id: dados.operationId,
  });

/** Motivos de saída do cliente (os padrões nascem na 1ª leitura). @param {{ ativos?: boolean }} [opts] */
export const listarMotivosSaida = async (opts = {}) => listMotivosSaida({ ativos: opts.ativos === true });

/** @param {string} nome */
export const criarMotivoSaida = async (nome) => createMotivoSaida({ nome });

/** @param {string} id @param {{ nome?: string, ativo?: boolean }} dados */
export const editarMotivoSaida = async (id, dados) => updateMotivoSaida(id, dados);
