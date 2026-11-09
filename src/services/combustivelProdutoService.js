/**
 * Service do vínculo Combustível × Produto POR EMPRESA (D-PROD-157, R2).
 *
 * O `TipoCombustivel` é do tenant (classifica o que o tanque aceita); o
 * `Produto` é o item REAL de uma empresa (fonte única: nada é copiado para
 * outra tabela de estoque). O vínculo diz quais produtos de cada fazenda são
 * daquele tipo — sem preço, custo, saldo ou conversão de unidade (a unidade do
 * produto é exibida como está, ex.: KG).
 *
 * Regras que a tela espelha (quem decide é o servidor):
 *  - sem empresa real não há leitura nem gravação;
 *  - vincular: `POST {empresa_id, produto_id}` (só produto ATIVO da MESMA
 *    empresa; um produto só pode ter UM vínculo ativo na empresa);
 *  - inativar/reativar: `PATCH {empresa_id, versao, ativo}` (exige a ação
 *    `inativar`); tipo, produto e empresa nunca mudam;
 *  - o vínculo inativo, de produto inativo ou de produto movido para outra
 *    empresa continua na lista (rastreabilidade), mas não é oferecido.
 */

import {
  listProdutosDoCombustivelPage,
  createVinculoCombustivelProduto,
  updateVinculoCombustivelProduto,
  listOpcoesProdutosCombustivel,
} from '@/apis/patrimonio';
import { exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';

const RESOURCE = 'TipoCombustivelProduto';

/** Página padrão da lista de vínculos e das opções de produto. */
export const POR_PAGINA_VINCULOS = 50;

/**
 * Uma página dos vínculos do combustível NA empresa (ativos e inativos).
 * @param {string|null} empresaId @param {string} tipoId
 * @param {{ limit?: number, cursor?: string|null, ativo?: boolean }} [opts]
 */
export const listarProdutosDoCombustivel = async (empresaId, tipoId, opts = {}) => {
  const limit = opts.limit ?? POR_PAGINA_VINCULOS;
  if (!empresaId || !tipoId) return paginaVazia(limit);
  return listProdutosDoCombustivelPage(tipoId, {
    empresa_id: empresaId,
    ativo: opts.ativo,
    limit,
    cursor: opts.cursor || undefined,
  });
};

/**
 * Uma página de produtos ATIVOS da empresa para o seletor "Vincular produto".
 * Sem empresa → página vazia (nada é lido).
 * @param {string|null} empresaId @param {{ q?: string, cursor?: string|null, limit?: number }} [opts]
 * @returns {Promise<{ itens: any[], has_more: boolean, next_cursor: string|null }>}
 */
export const listarOpcoesProdutosCombustivel = async (empresaId, opts = {}) => {
  if (!empresaId) return { itens: [], has_more: false, next_cursor: null };
  return listOpcoesProdutosCombustivel({
    empresa_id: empresaId,
    q: opts.q?.trim() || undefined,
    cursor: opts.cursor || undefined,
    limit: opts.limit ?? POR_PAGINA_VINCULOS,
  });
};

/**
 * Vincula um produto da empresa ao combustível. Corpo EXATO `{empresa_id, produto_id}`.
 * @param {string|null} empresaId @param {string} tipoId @param {string} produtoId
 */
export const vincularProdutoAoCombustivel = (empresaId, tipoId, produtoId) => {
  const empresa = exigirEmpresa(empresaId, 'vincularProdutoAoCombustivel', RESOURCE);
  return createVinculoCombustivelProduto(tipoId, { empresa_id: empresa, produto_id: produtoId });
};

/**
 * Inativar (`ativo:false`) ou reativar (`ativo:true`) um vínculo. Corpo EXATO
 * `{empresa_id, versao, ativo}` (CAS pela `versao` lida).
 * @param {string|null} empresaId @param {{ id: string, versao: number }} vinculo @param {boolean} ativo
 */
export const alterarSituacaoVinculoCombustivel = (empresaId, vinculo, ativo) => {
  const empresa = exigirEmpresa(empresaId, 'alterarSituacaoVinculoCombustivel', RESOURCE);
  return updateVinculoCombustivelProduto(vinculo.id, { empresa_id: empresa, versao: vinculo.versao, ativo: ativo === true });
};

/**
 * Situação legível do vínculo e o que a tela pode oferecer.
 *  - `oferecido`: vínculo ativo de produto ativo DA MESMA empresa (só esse
 *    entra nas opções/elegíveis);
 *  - `podeReativar`: vínculo inativo cujo produto continua ativo e da mesma
 *    empresa (o servidor recusa os demais).
 * @param {any} vinculo
 * @returns {{ texto: string, oferecido: boolean, podeInativar: boolean, podeReativar: boolean }}
 */
export const situacaoDoVinculoCombustivel = (vinculo) => {
  const produto = vinculo?.produto && typeof vinculo.produto === 'object' ? vinculo.produto : {};
  const ativo = vinculo?.ativo !== false;
  const produtoInativo = produto.ativo === false;
  const outraEmpresa = produto.empresa_coerente === false;
  const partes = [ativo ? 'Ativo' : 'Vínculo inativo'];
  if (outraEmpresa) partes.push('produto movido para outra fazenda');
  if (produtoInativo) partes.push('produto inativo');
  const oferecido = ativo && !produtoInativo && !outraEmpresa;
  if (ativo && !oferecido) partes.push('não é oferecido');
  return {
    texto: partes.join(' · '),
    oferecido,
    podeInativar: ativo,
    podeReativar: !ativo && !produtoInativo && !outraEmpresa,
  };
};

/**
 * Como a opção do seletor se apresenta para o combustível aberto: livre, já
 * vinculada a ESTE combustível, ou presa a OUTRO (não pode ser escolhida).
 * @param {any} opcao item de `/patrimonio-combustiveis-opcoes/produtos`
 * @param {string} tipoId combustível aberto
 * @returns {{ livre: boolean, detalhe: string|null, motivo: string|null }}
 */
export const disponibilidadeDoProduto = (opcao, tipoId) => {
  const unidade = typeof opcao?.unidade_principal_estoque === 'string' && opcao.unidade_principal_estoque ? opcao.unidade_principal_estoque : null;
  const vinculo = opcao?.vinculo_ativo && typeof opcao.vinculo_ativo === 'object' ? opcao.vinculo_ativo : null;
  const nome = String(opcao?.nome ?? 'O produto');
  if (!vinculo) return { livre: true, detalhe: unidade, motivo: null };
  if (String(vinculo.tipo_combustivel_id) === String(tipoId)) {
    return {
      livre: false,
      detalhe: [unidade, 'já vinculado a este combustível'].filter(Boolean).join(' · '),
      motivo: `${nome} já está vinculado a este combustível nesta fazenda.`,
    };
  }
  const outro = String(vinculo.tipo_nome ?? 'outro combustível');
  return {
    livre: false,
    detalhe: [unidade, `já vinculado a ${outro} — não pode`].filter(Boolean).join(' · '),
    motivo: `${nome} já está vinculado a ${outro} nesta fazenda: um produto só pode ter um combustível ativo. Inative aquele vínculo antes.`,
  };
};
