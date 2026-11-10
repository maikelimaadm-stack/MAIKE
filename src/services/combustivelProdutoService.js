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
 *
 * UX-02 (D-PROD-160): na tela o vínculo se chama "associação". Associar vários
 * Produtos de uma vez é um POST por Produto, em sequência, com resultado por
 * Produto (`associarProdutosAoCombustivel`, nunca lança); repetir nunca
 * duplica (par único: 409 `ja_vinculado` = associado depois de reler). Antes
 * de criar, a tela confere se o código já existe (`buscarCombustivelPorCodigo`);
 * a criação incerta do combustível é recuperada pelo código único
 * (`localizarCombustivelCriado`), nunca recriando às cegas nem dando como
 * criado um combustível que já existia.
 */

import {
  listProdutosDoCombustivelPage,
  createVinculoCombustivelProduto,
  updateVinculoCombustivelProduto,
  listOpcoesProdutosCombustivel,
} from '@/apis/patrimonio';
import { lerErroGestao } from '@/lib/gestaoErros';
import { mensagemErroPatrimonio } from '@/lib/patrimonioErros';
import { exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';
import { ehResultadoIncerto } from './operacaoFinanceiraService.js';
import { RECURSOS_CATALOGO, listarCatalogoPagina } from './patrimonioCatalogoService.js';

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
 * Situação legível do vínculo ("Associado", "Associação inativa"…) e o que a
 * tela pode oferecer.
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
  const partes = [ativo ? 'Associado' : 'Associação inativa'];
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
 * Como a opção do seletor se apresenta para o combustível: livre, já associada
 * a ESTE combustível, ou presa a OUTRO (não pode ser escolhida). Com
 * `tipoId = null` (combustível ainda não criado) qualquer associação ativa
 * bloqueia: o Produto já é de outro combustível nesta fazenda.
 * @param {any} opcao item de `/patrimonio-combustiveis-opcoes/produtos`
 * @param {string|null} tipoId combustível aberto (ou `null` na criação)
 * @returns {{ livre: boolean, detalhe: string|null, motivo: string|null }}
 */
export const disponibilidadeDoProduto = (opcao, tipoId) => {
  const unidade = typeof opcao?.unidade_principal_estoque === 'string' && opcao.unidade_principal_estoque ? opcao.unidade_principal_estoque : null;
  const vinculo = opcao?.vinculo_ativo && typeof opcao.vinculo_ativo === 'object' ? opcao.vinculo_ativo : null;
  const nome = String(opcao?.nome ?? 'O produto');
  if (!vinculo) return { livre: true, detalhe: unidade, motivo: null };
  if (tipoId != null && String(vinculo.tipo_combustivel_id) === String(tipoId)) {
    return {
      livre: false,
      detalhe: [unidade, 'já associado a este combustível'].filter(Boolean).join(' · '),
      motivo: `${nome} já está associado a este combustível nesta fazenda.`,
    };
  }
  const outro = String(vinculo.tipo_nome ?? 'outro combustível');
  return {
    livre: false,
    detalhe: [unidade, `já associado a ${outro} — não pode`].filter(Boolean).join(' · '),
    motivo: `${nome} já está associado a ${outro} nesta fazenda: um Produto só pode ter um combustível ativo. Inative aquela associação antes.`,
  };
};

// ─── Associação de vários Produtos (UX-02, D-PROD-160) ─────────────────────

/** Páginas lidas, no máximo, para confirmar uma associação (100 por página). */
const PAGINAS_PARA_CONFIRMAR = 20;
const POR_PAGINA_CONFIRMAR = 100;

/** Erro local de "não deu para saber" (lista longa demais para confirmar). */
const erroIndeterminado = () => Object.assign(new Error('associacao_indeterminada'), { code: 'ASSOCIACAO_INDETERMINADA' });

/**
 * Percorre os vínculos ATIVOS do tipo na empresa (até 20 páginas) e diz se o
 * produto está lá. Lança se a leitura falhar ou se a lista não couber nas 20
 * páginas (resposta indeterminada — nunca "não está").
 * @param {string} empresaId @param {string} tipoId @param {string} produtoId
 * @returns {Promise<boolean>}
 */
export const confirmarVinculoAtivo = async (empresaId, tipoId, produtoId) => {
  let cursor = /** @type {string|null} */ (null);
  for (let pagina = 0; pagina < PAGINAS_PARA_CONFIRMAR; pagina += 1) {
    const r = await listarProdutosDoCombustivel(empresaId, tipoId, { ativo: true, cursor, limit: POR_PAGINA_CONFIRMAR });
    const itens = Array.isArray(r?.items) ? r.items : [];
    if (itens.some((v) => v && v.ativo !== false && String(v.produto?.id ?? '') === String(produtoId))) return true;
    if (!r?.has_more || !r.next_cursor) return false;
    cursor = r.next_cursor;
  }
  throw erroIndeterminado();
};

const MENSAGEM_INCERTA =
  'A resposta do servidor não chegou e não foi possível confirmar a associação. Tente de novo: repetir não duplica.';
const MENSAGEM_SUMIU =
  'O servidor informou que este Produto já estava associado, mas a associação não está mais ativa. Confira a lista e tente de novo.';

/** @param {any} p */
const comoProduto = (p) => ({ id: String(p?.id ?? ''), nome: String(p?.nome ?? '') });

/**
 * Associa vários produtos ao combustível NA empresa, um POST por produto, EM
 * SEQUÊNCIA (corpo EXATO `{empresa_id, produto_id}`). NUNCA lança:
 *  - 201 → associado;
 *  - 409 `COMBUSTIVEL_PRODUTO_DUPLICADO` reason `ja_vinculado` → relê; ativo (ou
 *    releitura indisponível: o 409 do servidor já é a prova) → associado;
 *  - resultado incerto (rede/prazo/falha interna) → relê; ativo → associado,
 *    senão falha `incerto` (repetir é seguro: o par é único);
 *  - qualquer outro erro → falha com o código e a mensagem do patrimônio.
 * Produto repetido na entrada é enviado uma vez só.
 * @param {string|null} empresaId @param {string} tipoId @param {Array<{ id: string, nome: string }>} produtos
 * @returns {Promise<{ associados: Array<{ id: string, nome: string }>, falhas: Array<{ id: string, nome: string, codigo: string|null, mensagem: string }> }>}
 */
export const associarProdutosAoCombustivel = async (empresaId, tipoId, produtos) => {
  /** @type {Array<{ id: string, nome: string }>} */
  const associados = [];
  /** @type {Array<{ id: string, nome: string, codigo: string|null, mensagem: string }>} */
  const falhas = [];
  /** @type {Map<string, { id: string, nome: string }>} */
  const unicos = new Map();
  for (const p of (Array.isArray(produtos) ? produtos : []).map(comoProduto)) {
    if (p.id && !unicos.has(p.id)) unicos.set(p.id, p);
  }
  const lista = [...unicos.values()];
  if (!empresaId || !tipoId) {
    for (const p of lista) {
      falhas.push({ ...p, codigo: 'SEM_EMPRESA', mensagem: 'Selecione uma fazenda no topo da tela para associar Produtos. Nada foi gravado.' });
    }
    return { associados, falhas };
  }
  for (const p of lista) {
    try {
      await vincularProdutoAoCombustivel(empresaId, tipoId, p.id);
      associados.push(p);
      continue;
    } catch (erro) {
      const { code, reason } = lerErroGestao(erro);
      if (code === 'COMBUSTIVEL_PRODUTO_DUPLICADO' && reason === 'ja_vinculado') {
        let ativo = true;
        try {
          ativo = await confirmarVinculoAtivo(empresaId, tipoId, p.id);
        } catch {
          // Releitura indisponível: o 409 "já vinculado" do servidor é a prova.
          ativo = true;
        }
        if (ativo) associados.push(p);
        else falhas.push({ ...p, codigo: code, mensagem: MENSAGEM_SUMIU });
        continue;
      }
      if (ehResultadoIncerto(erro)) {
        let ativo = false;
        try {
          ativo = await confirmarVinculoAtivo(empresaId, tipoId, p.id);
        } catch {
          ativo = false;
        }
        if (ativo) associados.push(p);
        else falhas.push({ ...p, codigo: 'incerto', mensagem: MENSAGEM_INCERTA });
        continue;
      }
      falhas.push({ ...p, codigo: code, mensagem: mensagemErroPatrimonio(erro, 'Não foi possível associar o produto.') });
    }
  }
  return { associados, falhas };
};

/** Páginas da lista do catálogo lidas, no máximo, para achar o combustível pelo código. */
const PAGINAS_PARA_LOCALIZAR = 10;

/**
 * Procura o combustível pelo código EXATO (lista do catálogo, `q=codigo`,
 * ativos e inativos; o código é único no tenant). `null` = não existe. Lança
 * se a leitura falhar ou não couber nas páginas lidas (nunca "não existe" sem
 * saber).
 * @param {string} codigo
 * @returns {Promise<any|null>}
 */
export const buscarCombustivelPorCodigo = async (codigo) => {
  const alvoCodigo = String(codigo ?? '').trim();
  if (!alvoCodigo) return null;
  let cursor = /** @type {string|null} */ (null);
  for (let pagina = 0; pagina < PAGINAS_PARA_LOCALIZAR; pagina += 1) {
    const r = await listarCatalogoPagina(RECURSOS_CATALOGO.COMBUSTIVEIS, { q: alvoCodigo, cursor, limit: 100 });
    const itens = Array.isArray(r?.items) ? r.items : [];
    const mesmoCodigo = itens.find((c) => c && String(c.codigo ?? '') === alvoCodigo);
    if (mesmoCodigo) return mesmoCodigo;
    if (!r?.has_more || !r.next_cursor) return null;
    cursor = r.next_cursor;
  }
  throw erroIndeterminado();
};

/**
 * Depois de uma criação INCERTA: procura o combustível pelo código. Só é o
 * MESMO pedido (`criado`) se a verificação feita ANTES do POST confirmou que o
 * código não existia (`ausenteAntes`), o nome bate (sem caixa) e ele está
 * ativo (o recém-criado nasce ativo). Lança se a leitura falhar: a tela pede
 * conferência, nunca recria às cegas.
 *  - `ausente`: o código não existe → nada foi gravado;
 *  - `outro`: existe, mas não é deste pedido (outro nome ou inativo) → nada foi criado;
 *  - `indeterminado`: existe, mas sem a verificação anterior não dá para provar que é deste pedido.
 * @param {{ codigo: string, nome: string, ausenteAntes: boolean }} dados
 * @returns {Promise<{ situacao: 'criado', combustivel: any } | { situacao: 'ausente' | 'outro' | 'indeterminado', combustivel?: undefined }>}
 */
export const localizarCombustivelCriado = async ({ codigo, nome, ausenteAntes }) => {
  const achado = await buscarCombustivelPorCodigo(codigo);
  if (!achado) return { situacao: 'ausente' };
  const alvoNome = String(nome ?? '').trim().toLowerCase();
  const mesmoPedido = Boolean(achado.id) && achado.ativo !== false && String(achado.nome ?? '').trim().toLowerCase() === alvoNome;
  if (!mesmoPedido) return { situacao: 'outro' };
  return ausenteAntes === true ? { situacao: 'criado', combustivel: achado } : { situacao: 'indeterminado' };
};
