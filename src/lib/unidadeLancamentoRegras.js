/**
 * D-PROD-310 — a quantidade digitada numa UNIDADE DE CONVERSÃO do cadastro do produto (D-PROD-288) no cocho, nas
 * transferências entre depósitos e na linha de produto da atividade (emenda aprovada pelo proprietário em 2026-11-25).
 *
 * A tela oferece a unidade de estoque (kg ou L) e as conversões ATIVAS do produto (com o uso certo) ao lado da
 * quantidade, mostra a conta ("= 250 kg") e manda `unidade_lancamento` + `quantidade_lancamento` (e a quantidade de
 * estoque que mostrou, para o servidor conferir). Quem decide é o servidor, pelo fator do cadastro (o mesmo motor da
 * compra do financeiro); esta conta é só a prévia, com a MESMA regra (uma conta, 4 casas, meio para cima). Os lotes
 * (D-PROD-300) continuam na unidade de estoque. Produto sem conversão: nada muda na tela nem no corpo.
 *
 * Os produtos chegam em formatos diferentes (`GET /produtos`, as opções da atividade, as opções da entrada): a unidade
 * de estoque sai de `unidade_estoque`, `unidade` ou `unidade_principal_estoque` (L → L; o resto, KG); as conversões, de
 * `unidades_conversao`. O SACO legado (produto SACO com `peso_por_saco_kg` e sem a conversão SACO) também aparece.
 */
import { emUnidadeDeEstoque, equivalenciaDaConversao, paraCampo } from '@/lib/estoqueEntradasRegras';
import { lerNumeroLocal } from '@/lib/dinheiroDecimal';

/** @param {any} produto @returns {'KG'|'L'} */
export const unidadeDeEstoqueDoProduto = (produto) => {
  const u = produto?.unidade_estoque ?? produto?.unidade ?? produto?.unidade_principal_estoque;
  return u === 'L' ? 'L' : 'KG';
};

/** "kg" / "L" (a unidade de estoque na frase). @param {any} produto */
export const rotuloDoEstoque = (produto) => (unidadeDeEstoqueDoProduto(produto) === 'L' ? 'L' : 'kg');

/**
 * As conversões que a tela oferece: as ATIVAS, com o uso pedido (`venda` = saída; `null` = qualquer), e o SACO
 * legado. Cada uma com `sigla`, `operacao`, `fator` e `equivalencia` ("1 SACO = 25 KG").
 * @param {any} produto @param {'compra'|'venda'|null} [uso]
 * @returns {Array<{ sigla: string, operacao: string, fator: string, equivalencia: string }>}
 */
export const conversoesOferecidas = (produto, uso = null) => {
  if (!produto) return [];
  const estoque = unidadeDeEstoqueDoProduto(produto);
  const lista = (Array.isArray(produto.unidades_conversao) ? produto.unidades_conversao : [])
    .filter((c) => c && typeof c.sigla === 'string' && c.ativa !== false)
    .filter((c) => !(uso === 'venda' && c.uso_venda === false) && !(uso === 'compra' && c.uso_compra === false))
    .map((c) => ({ sigla: c.sigla, operacao: c.operacao === 'DIVIDE' ? 'DIVIDE' : 'MULTIPLICA', fator: String(c.fator), equivalencia: c.equivalencia || equivalenciaDaConversao(c, estoque) }));
  const peso = Number(produto.peso_por_saco_kg || 0);
  if (estoque === 'KG' && produto.unidade_principal_estoque === 'SACO' && peso > 0 && !lista.some((c) => c.sigla === 'SACO')) {
    lista.push({ sigla: 'SACO', operacao: 'MULTIPLICA', fator: String(produto.peso_por_saco_kg), equivalencia: `1 SACO = ${peso.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} KG` });
  }
  return lista;
};

/**
 * As opções do seletor "Unidade": a de estoque (valor = a sigla, "KG" ou "L") e as conversões (valor = a sigla). Com `gravado` (a edição de um lançamento
 * numa conversão), a sigla gravada continua oferecida, com o fator GRAVADO, mesmo desativada no cadastro.
 * `rotuloEstoque: 'sigla'` mostra a de estoque como "KG"/"L" (o seletor do mapa, como sempre).
 * @param {any} produto @param {{ uso?: 'compra'|'venda'|null, gravado?: { unidade: string, fator: string }|null, rotuloEstoque?: 'nome'|'sigla' }} [o]
 * @returns {Array<{ value: string, label: string }>}
 */
export const opcoesDeUnidade = (produto, { uso = null, gravado = null, rotuloEstoque = 'nome' } = {}) => {
  if (!produto) return [];
  const estoque = unidadeDeEstoqueDoProduto(produto);
  const lista = conversoesComGravado(produto, uso, gravado);
  return [
    { value: estoque, label: rotuloEstoque === 'sigla' ? estoque : estoque === 'L' ? 'Litros (L)' : 'Quilos (kg)' },
    ...lista.map((c) => ({ value: c.sigla, label: `${c.sigla} (${c.equivalencia})` })),
  ];
};

/** @param {any} produto @param {'compra'|'venda'|null} uso @param {{ unidade: string, fator: string }|null} gravado */
const conversoesComGravado = (produto, uso, gravado) => {
  const lista = conversoesOferecidas(produto, uso);
  if (!gravado?.unidade || !gravado.fator) return lista;
  const estoque = unidadeDeEstoqueDoProduto(produto);
  const fixa = { sigla: gravado.unidade, operacao: 'MULTIPLICA', fator: String(gravado.fator), equivalencia: equivalenciaDaConversao({ sigla: gravado.unidade, operacao: 'MULTIPLICA', fator: gravado.fator }, estoque) };
  return [...lista.filter((c) => c.sigla !== gravado.unidade), fixa];
};

/**
 * A sigla da conversão escolhida: o `valor` do seletor quando é uma conversão oferecida (com a gravada, na edição);
 * '' na unidade de estoque, vazio ou o que o produto não oferece.
 * @param {any} produto @param {unknown} valor @param {{ uso?: 'compra'|'venda'|null, gravado?: { unidade: string, fator: string }|null }} [o]
 */
export const conversaoEscolhida = (produto, valor, { uso = null, gravado = null } = {}) => {
  const v = typeof valor === 'string' ? valor : '';
  if (!v || !produto || v === unidadeDeEstoqueDoProduto(produto)) return '';
  return conversoesComGravado(produto, uso, gravado).some((c) => c.sigla === v) ? v : '';
};

/** O produto oferece alguma conversão? (sem ela, a tela fica como sempre) @param {any} produto @param {'compra'|'venda'|null} [uso] */
export const temConversoes = (produto, uso = null) => conversoesOferecidas(produto, uso).length > 0;

/**
 * A quantidade na unidade de ESTOQUE (texto canônico, 4 casas) da quantidade digitada (`quantidadeCanonica`, texto
 * canônico) na `unidade` ('' = a de estoque); `null` sem dado. A mesma conta do servidor.
 * @param {any} produto @param {string} unidade @param {string|null|undefined} quantidadeCanonica
 * @param {{ uso?: 'compra'|'venda'|null, gravado?: { unidade: string, fator: string }|null }} [o]
 */
export const quantidadeEmEstoque = (produto, unidade, quantidadeCanonica, { uso = null, gravado = null } = {}) => {
  if (!produto || !quantidadeCanonica) return null;
  const estoque = unidadeDeEstoqueDoProduto(produto);
  const u = unidade || estoque;
  const normal = { unidade_estoque: estoque, unidades_conversao: conversoesComGravado(produto, uso, gravado), peso_por_saco_kg: null };
  return emUnidadeDeEstoque(normal, u, quantidadeCanonica);
};

/** "250 kg" / "12,5 L" a partir do texto canônico. @param {string|null} canonico @param {any} produto */
export const formatarEmEstoque = (canonico, produto) =>
  canonico == null ? '' : `${Number(canonico).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} ${rotuloDoEstoque(produto)}`;

/**
 * "= 250 kg" debaixo da quantidade, quando a unidade é uma conversão e a quantidade é legível; '' senão.
 * @param {any} produto @param {string} unidade @param {string|null|undefined} quantidadeCanonica @param {Parameters<typeof quantidadeEmEstoque>[3]} [o]
 */
export const textoDaConversao = (produto, unidade, quantidadeCanonica, o = {}) => {
  if (!unidade || unidade === unidadeDeEstoqueDoProduto(produto)) return '';
  const q = quantidadeEmEstoque(produto, unidade, quantidadeCanonica, o);
  return q == null ? '' : `= ${formatarEmEstoque(q, produto)}`;
};

/**
 * A parte do corpo: `{ unidade_lancamento, quantidade_lancamento }` só com uma conversão escolhida ({} sem ela — o corpo
 * de sempre). `quantidade_lancamento` vai em texto canônico.
 * @param {string} unidade @param {string|null|undefined} quantidadeCanonica
 */
export const corpoDaUnidade = (unidade, quantidadeCanonica) =>
  unidade && quantidadeCanonica ? { unidade_lancamento: unidade, quantidade_lancamento: quantidadeCanonica } : {};

/** A quantidade de estoque no formato do campo (vírgula), para os campos que leem texto digitado (ex.: o "Lote"). @param {string|null} canonico */
export const emEstoqueNoCampo = (canonico) => (canonico == null ? '' : paraCampo(canonico));

/** A frase dos lotes com a unidade de conversão: os lotes são na unidade de estoque. @param {any} produto */
export const avisoLotesEmEstoque = (produto) => `As quantidades dos lotes são em ${rotuloDoEstoque(produto)} (a unidade de estoque).`;

/**
 * D-PROD-313 — a quantidade como foi DIGITADA ("3 SC", "2,5 CX") a partir de um registro gravado (movimento do estoque
 * ou linha da atividade) com `unidade_lancamento` e `quantidade_lancamento`; '' sem conversão (a quantidade do
 * registro, na unidade de estoque, é a que vale e já aparece).
 * @param {any} r
 */
export const textoDaUnidadeDigitada = (r) => {
  const unidade = typeof r?.unidade_lancamento === 'string' ? r.unidade_lancamento.trim() : '';
  const n = Number(r?.quantidade_lancamento);
  if (!unidade || r?.quantidade_lancamento == null || r.quantidade_lancamento === '' || !Number.isFinite(n) || n <= 0) return '';
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} ${unidade}`;
};

/** A unidade gravada na edição (`{ unidade, fator }`) a partir de um registro com as 3 colunas; null sem conversão. @param {any} r */
export const gravadoDe = (r) => (r?.unidade_lancamento && r?.fator_lancamento ? { unidade: String(r.unidade_lancamento), fator: String(r.fator_lancamento) } : null);

/**
 * O texto digitado → texto canônico (até 4 casas), aceitando vírgula ("12,5") ou ponto ("12.5", o campo numérico do
 * navegador); null se ilegível ou vazio.
 * @param {unknown} texto
 * @returns {string|null}
 */
export const canonicoDigitado = (texto) => {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  const pt = lerNumeroLocal(t, 'pt-BR', { inteiros: 10, casas: 4 });
  if (pt.ok && pt.valor) return pt.valor;
  const en = lerNumeroLocal(t, 'en-US', { inteiros: 10, casas: 4 });
  return en.ok && en.valor ? en.valor : null;
};
