/**
 * Service de produtos (P1.4).
 *
 * Reúne o que estava espalhado entre `Produtos.jsx` (numeração, unicidade,
 * sync de referências, bloqueio por movimentação, importação CSV) e
 * `FormularioProduto.jsx` (montagem do payload, fontes de opção).
 *
 * O que **não** mudou: filtro por empresa, unicidade de nome por empresa,
 * `numero_produto` por `max + 1`, autonumeração dos registros antigos, número
 * como string, `syncEntityReferences` no update, bloqueio por
 * `MovimentacaoEstoque`, campos de nutrição e saco/peso por saco.
 *
 * D-PROD-161 (Estoque P0): o payload do cadastro NUNCA leva o saldo de
 * estoque — nem no cadastro novo (o servidor grava 0), nem na edição. O saldo é
 * cache do motor físico e só muda por Entradas/Movimentações.
 *
 * `max + 1` continua sem segurança de concorrência — dívida aberta até a P3.
 */

import {
  listProdutos,
  listProdutosPage,
  createProduto,
  updateProduto,
  deleteProduto,
  sincronizarReferenciasProduto,
} from '@/apis/produtos';
import { listCategorias } from '@/apis/categorias';
import { listUnidades } from '@/apis/unidades-medida';
import { listLocais } from '@/apis/estoque';
import { ApiError, API_ERROR_CODES, hasApiErrorCode, getApiErrorMessage } from '@/apis/_core/ApiError';
import { lerErroGestao } from '@/lib/gestaoErros';
import { parseDecimalPtBR } from '@/domain/numeroPtBR';
import { listarMarcasAtivas } from './marcaService';

const chaveDeNome = (valor) => String(valor ?? '').trim().toUpperCase();
const maiusculoOuIndefinido = (valor) => {
  const texto = String(valor ?? '').trim();
  return texto ? texto.toUpperCase() : undefined;
};

/** Produtos da empresa via GET /produtos (lista completa — exportação, dropdowns). */
export const listarProdutosDaEmpresa = async (empresaId) => {
  if (!empresaId) return [];
  return listProdutos({ order: '-created_date' }).then((todos) =>
    todos.filter((produto) => produto.empresa_id === empresaId),
  );
};

/**
 * Adapter de domínio → motor Base1 (keyset).
 * @param {string} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, ativo?: boolean }} [opts]
 */
export const listarProdutosPagina = async (empresaId, opts = {}) => {
  if (!empresaId) {
    return { items: [], next_cursor: null, has_more: false, total: 0, limit: opts.limit ?? 100 };
  }
  return listProdutosPage({
    empresa_id: empresaId,
    limit: opts.limit,
    cursor: opts.cursor ?? undefined,
    q: opts.q,
    ativo: opts.ativo,
  });
};

/**
 * Próximo `numero_produto`.
 *
 * Olha todos os produtos e descarta valores acima de 1e9 — timestamps
 * acidentais de uma numeração antiga que ainda vivem na base.
 */
export const proximoNumeroDeProduto = async () => {
  const todos = await listProdutos();
  const numeros = todos
    .map((produto) => Number.parseInt(produto.numero_produto, 10) || 0)
    .filter((n) => n > 0 && n < 1000000000);
  return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
};

/**
 * @param {object} p
 * @param {Array<any>} p.produtos
 * @param {string} p.nome
 * @param {string} p.empresaId
 * @param {string} [p.ignorarId] id a ignorar na comparação (o próprio, na edição)
 */
const assertNomeLivre = ({ produtos, nome, empresaId, ignorarId }) => {
  const alvo = chaveDeNome(nome);
  const conflito = produtos.some(
    (produto) =>
      produto.id !== ignorarId &&
      produto.empresa_id === empresaId &&
      chaveDeNome(produto.nome_produto) === alvo
  );
  if (conflito) {
    throw new ApiError(API_ERROR_CODES.PRODUTO_NAME_CONFLICT, {
      operation: 'salvarProduto',
      resource: 'Produto',
      details: { campo: 'nome_produto' },
    });
  }
};

/**
 * Monta o payload de persistência a partir do formulário.
 *
 * Saiu inteiro de `FormularioProduto.handleSubmit`. A validação **visual** —
 * quais campos ficam vermelhos e para qual deles a tela rola — continua na UI;
 * o que veio para cá é a montagem e a coerção de valor.
 *
 * D-PROD-161: o saldo de estoque não entra no payload em modo nenhum; o estado
 * da edição espalha o registro lido (com o cache), e ele não volta ao servidor.
 *
 * @param {object} formData estado do formulário
 * @param {{isEditing?: boolean}} [opcoes] mantido por compatibilidade: novo e edição montam o mesmo payload
 */
/**
 * D-PROD-274 — a carência do formulário: campo ausente (formulário antigo) não vai; vazio vai `null` (limpa); número
 * inteiro vai como número.
 * @param {unknown} valor @returns {{ carencia_dias?: number|null }}
 */
const carenciaDoFormulario = (valor) => {
  if (valor === undefined) return {};
  const t = String(valor ?? '').trim();
  if (!t) return { carencia_dias: null };
  const n = Number(t);
  return Number.isInteger(n) ? { carencia_dias: n } : {};
};

/**
 * D-PROD-286 — linhas de "Unidades" do formulário → `unidades_conversao` (ausente: não vai; linhas vazias saem).
 * @param {unknown} linhas @returns {{ unidades_conversao?: any[] }}
 */
export const conversoesDoFormulario = (linhas) => {
  if (!Array.isArray(linhas)) return {};
  const lista = linhas
    .filter((l) => l && String(l.sigla ?? '').trim())
    .map((l, i) => ({
      ...(l.id ? { id: String(l.id) } : {}),
      sigla: String(l.sigla).trim().toUpperCase(),
      operacao: l.operacao === 'DIVIDE' ? 'DIVIDE' : 'MULTIPLICA',
      fator: typeof l.fator === 'number' ? l.fator : parseDecimalPtBR(l.fator) ?? 0,
      uso_compra: l.uso_compra !== false,
      uso_venda: l.uso_venda !== false,
      ...(l.codigo_barras ? { codigo_barras: String(l.codigo_barras).trim() } : {}),
      ativa: l.ativa !== false,
      ordem: i + 1,
    }));
  return { unidades_conversao: lista };
};

export const normalizarProduto = (formData, opcoes = {}) => {
  const unidadePrincipal = formData.unidade_principal_estoque || 'KG';

  const payload = {
    nome_produto: maiusculoOuIndefinido(formData.nome_produto),
    tipo_uso: formData.tipo_uso || undefined,
    // D-PROD-286: código interno automático (= número do cadastro), preços, local de estoque, consumo e peso por saco
    // saíram da tela: não vão no payload (o servidor ignoraria). O consumo fica nas Formulações; o saco vira conversão.
    codigo_barras: formData.codigo_barras || undefined,
    categoria: maiusculoOuIndefinido(formData.categoria),
    marca: maiusculoOuIndefinido(formData.marca),
    descricao: maiusculoOuIndefinido(formData.descricao),
    unidade_medida: maiusculoOuIndefinido(formData.unidade_medida),
    estoque_minimo: parseDecimalPtBR(formData.estoque_minimo) ?? 0,
    unidade_principal_estoque: unidadePrincipal,
    // D-PROD-286: as unidades de conversão (sigla, multiplica/divide, fator, compra/saída).
    ...conversoesDoFormulario(formData.unidades_conversao),
    // D-PROD-274: a carência da bula em dias (vazio = sem carência: null limpa na edição; ausente fica como estava).
    ...carenciaDoFormulario(formData.carencia_dias),
    // D-PROD-282: controle de lote e de validade (validade só com lote).
    controla_lote: formData.controla_lote === true,
    controla_validade: formData.controla_lote === true && formData.controla_validade === true,
    observacoes: maiusculoOuIndefinido(formData.observacoes),
    ativo: formData.ativo,
  };

  return payload;
};

/** Cria o produto com empresa; numeração é do backend nativo (P5.2). */
export const criarProduto = async ({ dados, empresaId, produtos = [] }) => {
  assertNomeLivre({ produtos, nome: dados?.nome_produto, empresaId });
  return createProduto({ ...dados, empresa_id: empresaId });
};

/** Atualiza o produto e sincroniza as referências denormalizadas. */
export const atualizarProduto = async ({ id, dados, oldData, empresaId, produtos = [] }) => {
  assertNomeLivre({ produtos, nome: dados?.nome_produto, empresaId, ignorarId: id });
  const atualizado = await updateProduto(id, { ...dados, empresa_id: empresaId });
  await sincronizarReferenciasProduto({ data: atualizado, oldData });
  return atualizado;
};

/**
 * Preenche `numero_produto` nos registros antigos.
 *
 * @returns {Promise<{numerados: string[], falhas: string[]}>}
 */
export const numerarProdutosSemNumero = async (produtos) => {
  const semNumero = (Array.isArray(produtos) ? produtos : []).filter(
    (produto) => !produto.numero_produto || produto.numero_produto === ''
  );
  if (semNumero.length === 0) return { numerados: [], falhas: [] };
  return { numerados: [], falhas: semNumero.map((produto) => produto.id) };
};

/**
 * Exclui o produto, bloqueando quando há movimentação de estoque.
 *
 * O legado abria o diálogo de bloqueio a partir da própria mutation, com
 * um `dispatchEvent` montado à mão, e sinalizava com
 * `new Error('DELETE_BLOCKED')` — que a UI reconhecia comparando o texto. Aqui
 * o bloqueio é `PRODUTO_DELETE_BLOCKED`, e `details.quantidade` carrega a
 * contagem para a tela montar a frase.
 */
/** Exclui um produto — guarda de vínculo no backend (`PRODUTO_DELETE_BLOCKED`). */
export const excluirProduto = async (id) => deleteProduto(id);

/**
 * Exclusão em lote com resultado explícito (Motor Base1).
 * @param {string[]} ids
 */
export const excluirProdutos = async (ids) => {
  const lista = Array.isArray(ids) ? ids : [];
  /** @type {string[]} */
  const excluidas = [];
  /** @type {Array<{ id: string, erro: unknown }>} */
  const falhas = [];
  for (const id of lista) {
    try {
      await deleteProduto(id);
      excluidas.push(id);
    } catch (erro) {
      falhas.push({ id, erro });
    }
  }
  return { excluidas, falhas };
};

/**
 * O nativeHttpClient não cataloga `PRODUTO_DELETE_BLOCKED` (vira
 * API_OPERATION_FAILED) e guarda o corpo do servidor em `cause`: o código real
 * é lido de lá (D-PROD-157 R2), sem depender do catálogo do cliente HTTP.
 * @param {unknown} erro
 */
export const isProdutoDeleteBlockedError = (erro) =>
  lerErroGestao(erro).code === API_ERROR_CODES.PRODUTO_DELETE_BLOCKED ||
  hasApiErrorCode(erro, API_ERROR_CODES.PRODUTO_DELETE_BLOCKED);

const VINCULO_ESTOQUE = 'movimentações de estoque';
const VINCULO_TANQUES = 'tanques do patrimônio';

/**
 * D-PROD-162 (padrão P-10): por que a unidade de estoque não muda
 * (409 PRODUTO_UNIDADE_EM_USO, `reason`).
 */
const MOTIVO_UNIDADE_EM_USO = Object.freeze({
  estoque: 'Este produto tem estoque',
  lotes: 'Este produto tem lotes de estoque',
  movimentos: 'Este produto tem movimentações de estoque',
  lancamentos: 'Este produto está em lançamentos financeiros',
});

/**
 * Frase do bloqueio de exclusão com o vínculo REAL que o servidor informou
 * (`details.vinculo`: movimentações de estoque, lançamentos financeiros ou
 * tanques do patrimônio — D-PROD-162) e a quantidade.
 * @param {unknown} erro
 */
export const mensagemExclusaoProdutoBloqueada = (erro) => {
  const { details } = lerErroGestao(erro);
  const quantidade = Number.isFinite(Number(details.quantidade)) ? Number(details.quantidade) : 0;
  const vinculo = typeof details.vinculo === 'string' && details.vinculo.trim() ? details.vinculo.trim() : VINCULO_ESTOQUE;
  if (vinculo === VINCULO_ESTOQUE) {
    return `Este produto já possui ${quantidade} registro(s) lançados em ${VINCULO_ESTOQUE} e não pode ser excluído.`;
  }
  if (vinculo === VINCULO_TANQUES) {
    return `Este produto está nos Produtos aceitos de ${quantidade} tanque(s) de bens patrimoniais e não pode ser excluído. Tire-o dos Produtos aceitos do tanque em Bens Patrimoniais ou inative o produto.`;
  }
  return `Este produto possui ${quantidade} registro(s) em ${vinculo} e não pode ser excluído. Inative o produto em vez de excluí-lo.`;
};

/**
 * Sugestão do 409 PRODUTO_UNIDADE_EM_USO pela direção da troca: entrando em
 * litros, um Produto novo em litros; saindo de litros, um Produto novo na
 * unidade de destino.
 * @param {Record<string, any>} details
 */
export const sugestaoProdutoNovo = (details) => {
  const de = typeof details?.de === 'string' ? details.de : null;
  const para = typeof details?.para === 'string' ? details.para : null;
  if (de === 'L' && para && para !== 'L') {
    return para === 'SACO' ? 'Cadastre um Produto novo em sacos (SACO).' : `Cadastre um Produto novo em quilos (${para === 'KG' ? 'KG' : para}).`;
  }
  return 'Cadastre um Produto novo em litros, ex.: “Diesel S10 (L)”.';
};

/**
 * Mensagem de falha ao salvar o produto (D-PROD-162). Diz o que fazer quando:
 *  - o produto está nos Produtos aceitos de um tanque e muda de fazenda
 *    (409 PRODUTO_EM_TANQUE_PATRIMONIO);
 *  - a unidade de estoque não pode mudar (409 PRODUTO_UNIDADE_EM_USO, por
 *    `reason`: estoque, lotes, movimentos, lançamentos — padrão P-10 — ou
 *    aceito em tanque);
 *  - D-PROD-161 (Estoque P0): o produto com estoque muda de fazenda
 *    (409 PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA) ou o corpo tenta gravar o saldo
 *    (422 PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL);
 * o resto segue a mensagem pública do código.
 * @param {unknown} erro
 */
export const mensagemErroSalvarProduto = (erro) => {
  const { code, reason, details } = lerErroGestao(erro);
  if (code === 'PRODUTO_EM_TANQUE_PATRIMONIO') {
    return 'Este produto está nos Produtos aceitos de um tanque de bem patrimonial: ele não pode mudar de fazenda. Tire-o dos Produtos aceitos do tanque em Bens Patrimoniais antes. Nada foi gravado.';
  }
  if (code === 'PRODUTO_UNIDADE_EM_USO') {
    if (reason === 'aceito_em_tanque') {
      return 'Este produto está nos Produtos aceitos de um tanque de bem patrimonial, que usa estoque em litros (L), quilos (KG) ou sacos (SACO). Tire-o dos Produtos aceitos do tanque antes de mudar a unidade. Nada foi gravado.';
    }
    const motivo = MOTIVO_UNIDADE_EM_USO[/** @type {keyof typeof MOTIVO_UNIDADE_EM_USO} */ (reason)] ?? 'Este produto tem estoque, lotes ou movimentos';
    return `${motivo}: a unidade de estoque não muda de ou para litros. ${sugestaoProdutoNovo(details)} Nada foi gravado.`;
  }
  // D-PROD-161 (Estoque P0): o saldo do produto é do motor físico.
  if (code === 'PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA') {
    return 'Este produto já tem estoque (lotes ou movimentações) nesta fazenda: ele não pode mudar de fazenda. Cadastre um produto na outra fazenda. Nada foi gravado.';
  }
  if (code === 'PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL') {
    return 'Estoque é alterado em Entradas/Movimentações, não no Cadastro de Produtos. Nada foi gravado.';
  }
  return getApiErrorMessage(erro, 'Não foi possível salvar o produto.');
};

/**
 * Fontes de opção do formulário.
 *
 * Nomes fechados: a tela pede as quatro listas de que precisa e não escolhe
 * entidade por nome.
 */
export const carregarFontesDoFormulario = async (empresaId) => {
  const [categorias, unidades, locais, marcas] = await Promise.all([
    listCategorias(),
    listUnidades(),
    listLocais(),
    empresaId ? listarMarcasAtivas(empresaId) : Promise.resolve([]),
  ]);
  return { categorias, unidades, locais, marcas };
};

/**
 * Importa os registros já validados.
 *
 * Best-effort, como antes: um registro que falha não interrompe os demais. A
 * diferença é que o resultado agora é explícito e a tela não precisa deduzir
 * nada de um contador solto.
 *
 * @param {Array<object>} registros
 * @param {(p: {atual: number, total: number}) => void} [onProgresso]
 * @returns {Promise<{importados: number, falhas: number, total: number}>}
 */
export const importarProdutos = async (registros, onProgresso) => {
  const lista = Array.isArray(registros) ? registros : [];
  let importados = 0;
  let falhas = 0;

  for (const registro of lista) {
    try {
      await createProduto(registro);
      importados += 1;
    } catch {
      falhas += 1;
    }
    onProgresso?.({ atual: importados + falhas, total: lista.length });
  }

  return { importados, falhas, total: lista.length };
};
