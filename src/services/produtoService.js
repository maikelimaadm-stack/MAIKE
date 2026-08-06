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
 * `MovimentacaoEstoque`, `estoque_atual = 0` no cadastro novo, campos de
 * nutrição e saco/peso por saco.
 *
 * `max + 1` continua sem segurança de concorrência — dívida aberta até a P3.
 */

import {
  listProdutos,
  createProduto,
  updateProduto,
  deleteProduto,
  listMovimentacoesEstoque,
  sincronizarReferenciasProduto,
} from '@/apis/produtos';
import { listCategorias } from '@/apis/categorias';
import { listUnidades } from '@/apis/unidades-medida';
import { listLocais } from '@/apis/estoque';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { parseDecimalPtBR } from '@/domain/numeroPtBR';
import { listarMarcasAtivas } from './marcaService';

const chaveDeNome = (valor) => String(valor ?? '').trim().toUpperCase();
const maiusculoOuIndefinido = (valor) => {
  const texto = String(valor ?? '').trim();
  return texto ? texto.toUpperCase() : undefined;
};

/** Produtos da empresa, mais recentes primeiro. */
export const listarProdutosDaEmpresa = async (empresaId) => {
  const todos = await listProdutos({ order: '-created_date' });
  return todos.filter((produto) => produto.empresa_id === empresaId);
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
 * @param {object} formData estado do formulário
 * @param {{isEditing?: boolean}} [opcoes]
 */
export const normalizarProduto = (formData, { isEditing = false } = {}) => {
  const unidadePrincipal = formData.unidade_principal_estoque || 'KG';
  const pesoPorSaco = parseDecimalPtBR(formData.peso_por_saco_kg);

  const payload = {
    nome_produto: maiusculoOuIndefinido(formData.nome_produto),
    tipo_uso: formData.tipo_uso || undefined,
    codigo_interno: maiusculoOuIndefinido(formData.codigo_interno),
    codigo_barras: formData.codigo_barras || undefined,
    categoria: maiusculoOuIndefinido(formData.categoria),
    marca: maiusculoOuIndefinido(formData.marca),
    descricao: maiusculoOuIndefinido(formData.descricao),
    unidade_medida: maiusculoOuIndefinido(formData.unidade_medida),
    preco_custo: parseDecimalPtBR(formData.preco_custo) ?? 0,
    preco_venda: parseDecimalPtBR(formData.preco_venda) ?? 0,
    estoque_minimo: parseDecimalPtBR(formData.estoque_minimo) ?? 0,
    local_estoque: maiusculoOuIndefinido(formData.local_estoque),
    tipo_consumo: formData.tipo_consumo || undefined,
    percentual_consumo_pv: parseDecimalPtBR(formData.percentual_consumo_pv) || undefined,
    consumo_minimo_pv: parseDecimalPtBR(formData.consumo_minimo_pv) || undefined,
    consumo_maximo_pv: parseDecimalPtBR(formData.consumo_maximo_pv) || undefined,
    unidade_principal_estoque: unidadePrincipal,
    peso_por_saco_kg: unidadePrincipal === 'SACO' ? pesoPorSaco || undefined : undefined,
    observacoes: maiusculoOuIndefinido(formData.observacoes),
    ativo: formData.ativo,
  };

  if (!isEditing) payload.estoque_atual = 0;
  return payload;
};

/** Cria o produto com empresa e número. */
export const criarProduto = async ({ dados, empresaId, produtos = [] }) => {
  assertNomeLivre({ produtos, nome: dados?.nome_produto, empresaId });
  const numero = await proximoNumeroDeProduto();
  return createProduto({ ...dados, empresa_id: empresaId, numero_produto: String(numero) });
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
  const numerados = [];
  const falhas = [];

  for (const produto of semNumero) {
    try {
      const numero = await proximoNumeroDeProduto();
      await updateProduto(produto.id, { numero_produto: String(numero) });
      numerados.push(produto.id);
    } catch {
      falhas.push(produto.id);
    }
  }

  return { numerados, falhas };
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
export const excluirProduto = async (id) => {
  const movimentacoes = await listMovimentacoesEstoque();
  const vinculadas = movimentacoes.filter((movimentacao) => movimentacao.produto_id === id);

  if (vinculadas.length > 0) {
    throw new ApiError(API_ERROR_CODES.PRODUTO_DELETE_BLOCKED, {
      operation: 'excluirProduto',
      resource: 'Produto',
      details: { id, vinculo: 'movimentações de estoque', quantidade: vinculadas.length },
    });
  }

  return deleteProduto(id);
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
