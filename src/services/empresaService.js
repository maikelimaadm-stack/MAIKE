/**
 * Service do módulo Empresa (P1.1, D-PROD-18, EMPRESA-NUM-01).
 *
 * Duplicidade de nome é autoridade do backend — POST/PATCH não dependem de GET prévio.
 */

import {
  createEmpresa as createEmpresaApi,
  updateEmpresa as updateEmpresaApi,
  deleteEmpresa as deleteEmpresaApi,
  listEmpresas as listEmpresasApi,
  configurarFusoHorarioEmpresa as configurarFusoHorarioEmpresaApi,
} from '@/apis/empresa';

/**
 * Lista empresas na ordem padrão do módulo.
 * @returns {Promise<Array<object>>}
 */
export const listEmpresas = () => listEmpresasApi();

/**
 * Cria uma empresa (conflito de nome vem do backend).
 * @param {object} dados
 * @returns {Promise<object>}
 */
export const createEmpresa = (dados) => createEmpresaApi(dados);

/**
 * Atualiza uma empresa.
 * @param {string} id
 * @param {object} dados
 * @returns {Promise<object>}
 */
export const updateEmpresa = (id, dados) => updateEmpresaApi(id, dados);

/**
 * D-PROD-124: configura o fuso horário da fazenda (administrador; auditado).
 * @param {string} id
 * @param {{fuso_horario: string, motivo?: string}} dados
 * @returns {Promise<object>}
 */
export const configurarFusoHorarioEmpresa = (id, dados) => configurarFusoHorarioEmpresaApi(id, dados);

/**
 * Exclui uma empresa.
 * @param {string} id
 */
export const deleteEmpresa = (id) => deleteEmpresaApi(id);

/** Rótulos dos vínculos que o servidor conta (`details.vinculos[].entidade`). */
const ROTULO_VINCULO = Object.freeze({
  Setor: 'setores',
  AreaPastagem: 'áreas',
  Lote: 'lotes',
  PosicaoRebanho: 'posições do rebanho',
  EventoRebanho: 'movimentos do rebanho',
  Produto: 'produtos',
  PontoSuplementacao: 'cochos/depósitos',
  PontoReferencia: 'pontos do mapa',
  LinhaGeografica: 'linhas do mapa',
  Bebedouro: 'bebedouros',
  LancamentoTarefa: 'tarefas',
  MovimentacaoEstoque: 'movimentações de estoque',
  MovimentacaoMapa: 'movimentações do mapa',
  CategoriaManejo: 'categorias de manejo',
  Fornecedor: 'fornecedores',
  Marca: 'marcas',
});

/**
 * D-PROD-136 (EMP-01): o servidor recusa (409 `EMPRESA_COM_VINCULOS`) a exclusão
 * de empresa com registros e diz quantos, por cadastro. Frase para a tela; null
 * quando o erro é outro.
 * @param {unknown} erro
 * @returns {string|null}
 */
export const descreverVinculosEmpresa = (erro) => {
  const e = /** @type {{ code?: string, details?: { vinculos?: Array<{ entidade?: string, total?: number }> } }} */ (erro);
  if (e?.code !== 'EMPRESA_COM_VINCULOS') return null;
  const vinculos = Array.isArray(e.details?.vinculos) ? e.details.vinculos : [];
  const partes = vinculos
    .filter((v) => v && typeof v.entidade === 'string' && Number(v.total) > 0)
    .map((v) => `${ROTULO_VINCULO[v.entidade] ?? 'outros registros'} (${Number(v.total)})`);
  return partes.length
    ? `Não é possível excluir a empresa: ela tem registros vinculados — ${partes.join(', ')}. Nada foi apagado.`
    : null;
};

/**
 * Exclusão em lote — resultado honesto por id (sem contagem falsa).
 * @param {string[]} ids
 * @returns {Promise<{ excluidos: string[], bloqueados: { id: string, erro: unknown }[] }>}
 */
export const excluirEmpresas = async (ids) => {
  const excluidos = [];
  const bloqueados = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    try {
      await deleteEmpresaApi(id);
      excluidos.push(id);
    } catch (erro) {
      bloqueados.push({ id, erro });
    }
  }
  return { excluidos, bloqueados };
};
