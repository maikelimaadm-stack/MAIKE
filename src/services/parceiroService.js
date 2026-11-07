/**
 * Service de Parceiros (D-PROD-145). O servidor é a fronteira: valida documento,
 * duplicata, empresa e permissão. Aqui só: empresa obrigatória, corpo mínimo.
 * Sem exclusão física: "Excluir" na tela = inativar.
 */

import { listParceirosPage, createParceiro, updateParceiro } from '@/apis/parceiros';
import { camposAlterados, exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';

const RESOURCE = 'Parceiro';

export const PAPEIS_PARCEIRO = Object.freeze([
  Object.freeze({ id: 'fornecedor', label: 'Fornecedor' }),
  Object.freeze({ id: 'cliente', label: 'Cliente' }),
  Object.freeze({ id: 'prestador_servico', label: 'Prestador de serviço' }),
  Object.freeze({ id: 'transportador', label: 'Transportador' }),
  Object.freeze({ id: 'outros', label: 'Outros' }),
]);

export const rotuloPapel = (id) => PAPEIS_PARCEIRO.find((p) => p.id === id)?.label ?? id;

export const CAMPOS_PARCEIRO = Object.freeze([
  'tipo_pessoa', 'nome', 'razao_social', 'cpf', 'cnpj', 'rg', 'data_nascimento', 'inscricao_estadual',
  'nome_responsavel', 'telefone', 'email', 'endereco', 'cidade', 'estado', 'cep', 'observacoes', 'papeis', 'ativo',
]);

/**
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, ativo?: boolean, papel?: string }} [opts]
 */
export const listarParceirosPagina = async (empresaId, opts = {}) => {
  if (!empresaId) return paginaVazia(opts.limit);
  return listParceirosPage({
    empresa_id: empresaId,
    limit: opts.limit,
    cursor: opts.cursor ?? undefined,
    q: opts.q,
    ativo: opts.ativo,
    papel: opts.papel,
  });
};

/** Corpo de criação: só campos preenchidos (o servidor completa o resto). */
export const criarParceiro = async (empresaId, dados) => {
  const empresa = exigirEmpresa(empresaId, 'criarParceiro', RESOURCE);
  const corpo = camposAlterados({}, dados, CAMPOS_PARCEIRO.filter((c) => c !== 'ativo'));
  if (!Array.isArray(corpo.papeis)) corpo.papeis = Array.isArray(dados?.papeis) ? dados.papeis : [];
  return createParceiro({ ...corpo, empresa_id: empresa });
};

/**
 * PATCH só com os campos alterados. Nada alterado → nenhuma chamada.
 * @returns {Promise<{ alterado: boolean, registro: object }>}
 */
export const atualizarParceiro = async (empresaId, original, dados) => {
  const empresa = exigirEmpresa(empresaId, 'atualizarParceiro', RESOURCE);
  const corpo = camposAlterados(original, dados, CAMPOS_PARCEIRO);
  if (!Object.keys(corpo).length) return { alterado: false, registro: original };
  const registro = await updateParceiro(original.id, { empresa_id: empresa, ...corpo });
  return { alterado: true, registro };
};

/** Inativar (ou reativar) um parceiro. */
export const alterarSituacaoParceiro = async (empresaId, id, ativo) => {
  const empresa = exigirEmpresa(empresaId, 'alterarSituacaoParceiro', RESOURCE);
  return updateParceiro(id, { empresa_id: empresa, ativo: ativo === true });
};

/**
 * Inativação em lote (best-effort); cada falha guarda o erro para a mensagem.
 * @returns {Promise<{ ok: string[], falhas: Array<{ id: string, erro: unknown }> }>}
 */
export const inativarParceiros = async (empresaId, ids) => {
  const ok = [];
  const falhas = [];
  for (const id of ids) {
    try {
      await alterarSituacaoParceiro(empresaId, id, false);
      ok.push(id);
    } catch (erro) {
      falhas.push({ id, erro });
    }
  }
  return { ok, falhas };
};
