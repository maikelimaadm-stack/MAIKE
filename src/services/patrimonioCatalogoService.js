/**
 * Service do catálogo de Patrimônio e Frota: os TIPOS de bem do usuário
 * (D-PROD-157; D-PROD-162: dentro do cadastro de Bens; D-PROD-169: a família
 * saiu da tela).
 *
 * D-PROD-169: o bem tem duas escolhas — o "Tipo de bem" (a natureza, lista
 * FIXA: Benfeitoria, Máquina, Veículo, Implemento, Equipamento, Outro) e o
 * "Tipo" (este cadastro, filtrado pelo Tipo de bem). Por trás, o servidor usa
 * uma família padrão por natureza: o tipo novo vai com `{natureza, nome}` e o
 * servidor resolve a família (garantindo o catálogo padrão sozinho). Ninguém
 * cadastra família.
 *
 * As guardas são as da tela de Bens (`acoesDeCatalogoNoBem`). O `codigo` é
 * opcional na criação (P-05: sem ele o servidor o gera a partir do nome).
 * Catálogo do TENANT (sem empresa). Renomear = PATCH mínimo com `versao`;
 * excluir = DELETE com `versao`, só quando nenhum bem usa o tipo (senão 409
 * `PATRIMONIO_TIPO_EM_USO`, com a contagem). Reativar um tipo antigo inativo
 * continua sendo PATCH `{versao, ativo:true}` (ação `inativar` de Bens).
 */

import {
  listPatrimonioCatalogoPage,
  createPatrimonioCatalogo,
  updatePatrimonioCatalogo,
  deletePatrimonioCatalogo,
  listOpcoesBemPatrimonial,
} from '@/apis/patrimonio';

export const RECURSOS_CATALOGO = Object.freeze({
  TIPOS: 'tipos',
});

/** Código de catálogo: maiúsculas, dígitos e sublinhado (2 a 32). */
export const PADRAO_CODIGO_CATALOGO = /^[A-Z0-9_]{2,32}$/;

/** Campos aceitos na criação e na edição do tipo (D-PROD-169: `natureza` no lugar de `familia_id`). */
const CAMPOS = Object.freeze({
  tipos: Object.freeze({
    // D-PROD-202: `salto_maximo_medidor` = teto do salto do medidor por lançamento (texto decimal; null limpa).
    // D-PROD-279: o produto do implemento (`usa_produto`, `forma_produto`, `capacidade` em texto decimal, `capacidade_unidade`).
    criacao: Object.freeze(['natureza', 'codigo', 'nome', 'descricao', 'vida_util_meses_sugerida', 'salto_maximo_medidor', 'usa_produto', 'forma_produto', 'capacidade', 'capacidade_unidade']),
    // D-PROD-291: o produto do implemento também se edita no tipo que já existe (o servidor confere como na criação).
    edicao: Object.freeze(['nome', 'descricao', 'vida_util_meses_sugerida', 'salto_maximo_medidor', 'usa_produto', 'forma_produto', 'capacidade', 'capacidade_unidade']),
  }),
});

/** @param {string} recurso */
const camposDo = (recurso) => {
  const campos = /** @type {Record<string, { criacao: readonly string[], edicao: readonly string[] }>} */ (CAMPOS)[recurso];
  if (!campos) throw new TypeError(`catálogo de patrimônio desconhecido: ${recurso}`);
  return campos;
};

/** Valor comparável de um campo de catálogo: texto aparado (vazio = null). @param {unknown} v */
const comparavel = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  return v;
};

/** Valor como vai no corpo: texto aparado (vazio = null). @param {unknown} v */
const paraCorpo = (v) => {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  return v === undefined ? null : v;
};

/**
 * Página keyset dos tipos (o "Gerenciar tipos"): `natureza` filtra pelo Tipo
 * de bem; sem `ativo`, vêm ativos e inativos.
 * @param {string} recurso
 * @param {{ limit?: number, cursor?: string|null, q?: string, ativo?: boolean, natureza?: string|null }} [opts]
 */
export const listarCatalogoPagina = (recurso, opts = {}) =>
  listPatrimonioCatalogoPage(recurso, {
    limit: opts.limit,
    cursor: opts.cursor ?? undefined,
    q: opts.q,
    ativo: opts.ativo,
    natureza: opts.natureza || undefined,
  });

/**
 * Criação: só os campos do catálogo, sem vazios (o servidor aplica os padrões).
 * O tipo vai com `natureza` (o Tipo de bem) e `nome`; sem `codigo` (ou vazio)
 * o servidor o gera do nome (P-05).
 * @param {string} recurso @param {Record<string, any>} dados
 */
export const criarCatalogo = (recurso, dados) => {
  /** @type {Record<string, any>} */
  const corpo = {};
  for (const campo of camposDo(recurso).criacao) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    const valor = paraCorpo(dados[campo]);
    if (valor === null) continue;
    corpo[campo] = valor;
  }
  return createPatrimonioCatalogo(recurso, corpo);
};

/**
 * PATCH mínimo: só o que mudou, com a `versao` do registro aberto. Texto vazio
 * vai como `null` (limpa). Sem mudança → nada é enviado.
 * @param {string} recurso @param {Record<string, any>} original @param {Record<string, any>} dados
 * @returns {Promise<{ alterado: boolean, registro: any }>}
 */
export const atualizarCatalogo = async (recurso, original, dados) => {
  /** @type {Record<string, any>} */
  const corpo = {};
  for (const campo of camposDo(recurso).edicao) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    if (comparavel(dados[campo]) === comparavel(original?.[campo])) continue;
    corpo[campo] = paraCorpo(dados[campo]);
  }
  if (!Object.keys(corpo).length) return { alterado: false, registro: original };
  const registro = await updatePatrimonioCatalogo(recurso, original.id, { versao: original.versao, ...corpo });
  return { alterado: true, registro };
};

/**
 * Reativar (`ativo:true`) um tipo antigo inativo — ou inativar (`false`): o
 * corpo leva só `versao` e `ativo` (o servidor exige a ação `inativar` de Bens).
 * @param {string} recurso @param {{ id: string, versao: number }} original @param {boolean} ativo
 */
export const alterarSituacaoCatalogo = (recurso, original, ativo) =>
  updatePatrimonioCatalogo(recurso, original.id, { versao: original.versao, ativo: ativo === true });

/**
 * Exclui o tipo de verdade (D-PROD-169), com a `versao` lida. O servidor
 * recusa com 409 `PATRIMONIO_TIPO_EM_USO` (`details.bens`) quando algum bem —
 * ativo ou inativo — usa o tipo.
 * @param {string} recurso @param {{ id: string, versao: number }} original
 */
export const excluirCatalogo = (recurso, original) => deletePatrimonioCatalogo(recurso, original.id, original.versao);

/**
 * Uma página de tipos ATIVOS para o seletor do bem — sem empresa (catálogo do
 * tenant). `natureza` (o Tipo de bem) filtra: entram os tipos das famílias
 * daquela natureza, inclusive os de famílias antigas criadas à mão.
 * @param {'tipos'} recurso
 * @param {{ q?: string, cursor?: string|null, limit?: number, natureza?: string|null }} [opts]
 */
export const listarOpcoesCatalogo = (recurso, opts = {}) =>
  listOpcoesBemPatrimonial(recurso, {
    q: opts.q?.trim() || undefined,
    cursor: opts.cursor || undefined,
    limit: opts.limit ?? 50,
    natureza: opts.natureza || undefined,
  });

/** Nome comparável (sem diferenciar maiúsculas nem espaços repetidos), como o servidor. @param {unknown} nome */
const nomeComparavel = (nome) => String(nome ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/**
 * "Usar o existente" depois de um 409 `PATRIMONIO_NOME_DUPLICADO` no cadastro
 * rápido: procura, entre os tipos ATIVOS do Tipo de bem, o de MESMO nome.
 * `null` quando o homônimo está inativo (ele não pode ser escolhido para um
 * bem: reative-o em "Gerenciar tipos").
 * @param {'tipos'} recurso @param {string} nome @param {{ natureza?: string|null }} [opts]
 * @returns {Promise<any|null>}
 */
export const buscarCatalogoPorNome = async (recurso, nome, opts = {}) => {
  const alvo = nomeComparavel(nome);
  if (!alvo) return null;
  const pagina = await listarOpcoesCatalogo(recurso, { q: String(nome).trim(), limit: 50, natureza: opts.natureza ?? null });
  return pagina.itens.find((o) => o && nomeComparavel(o.nome) === alvo) ?? null;
};
