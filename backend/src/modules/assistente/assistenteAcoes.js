/**
 * Assistente (D-PROD-230) — ação `aplicar_filtro_tela`: o assistente monta um filtro
 * para uma tela do sistema (Mapa Geral ou Cadastro de Lotes) e o cliente o aplica.
 *
 * Não lê nem grava dados: só valida o pedido da IA contra o conjunto FECHADO de
 * filtros que cada tela já oferece e devolve uma "ação" normalizada. Quem aplica é a
 * tela, no navegador, sobre os dados que ela já mostra (do tenant e da fazenda abertos).
 * Os nomes (setor, categoria, área...) são casados pela tela sem acento e sem caixa; o
 * que não casar com nada é ignorado e avisado lá.
 *
 * Contrato de URL (espelho em src/domain/assistente/filtroTela.js — os dois lados têm
 * de aceitar as mesmas chaves): `/<tela minúscula>?af=<JSON {filtros}>`.
 */

import { AppError } from '../../shared/errors/AppError.js';
import { validarEntrada } from './assistenteFiltros.js';

const NOMES = (descricao) => ({ type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 120 }, description: descricao });
const FAIXA = (descricao) => ({ type: 'number', minimum: 0, maximum: 100000, description: descricao });

/** Tipos de uso das áreas no mapa (os mesmos de CORES_TIPO_CULTURA da tela). */
export const TIPOS_CULTURA_MAPA = Object.freeze(['Pastagem', 'Agricultura', 'Reserva', 'APP', 'Infraestrutura']);
/** Modos "Demarcar áreas por" do Mapa Geral (MODOS_COLORACAO da tela). */
export const MODOS_COLORACAO_MAPA = Object.freeze(['padrao', 'tipo_cultura', 'aproveitamento', 'ocupacao', 'categoria_gado', 'tipo_pastagem', 'ua_ha', 'situacao_pasto', 'forragem']);

/**
 * Filtros aceitos por tela. Aplicar um filtro SUBSTITUI os filtros da tela: o que não
 * vier fica sem restrição (filtros vazios = limpar). `colorir_por` só muda se vier.
 */
export const FILTROS_POR_TELA = Object.freeze({
  MapaGeral: {
    type: 'object',
    properties: {
      setores: NOMES('nomes dos setores'),
      tipos_cultura: { type: 'array', maxItems: 5, items: { type: 'string', enum: [...TIPOS_CULTURA_MAPA] }, description: 'uso da área' },
      tipos_pastagem: NOMES('tipos de pastagem (cultura), ex.: Marandu'),
      categorias: NOMES('categorias dos lotes mostrados no mapa'),
      sistemas: NOMES('sistemas produtivos dos lotes'),
      peso_min: FAIXA('peso médio mínimo dos lotes (kg)'),
      peso_max: FAIXA('peso médio máximo dos lotes (kg)'),
      colorir_por: { type: 'string', enum: [...MODOS_COLORACAO_MAPA], description: 'como pintar as áreas; forragem = farol de forragem (pronto, rapado...)' },
    },
    additionalProperties: false,
  },
  CadastroLotes: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['Ativo', 'Inativo'] },
      categorias_manejo: NOMES('categorias de manejo de entrada'),
      categorias: NOMES('categorias de entrada'),
      sexos: NOMES('sexo, ex.: Macho, Fêmea'),
      setores: NOMES('setores'),
      areas: NOMES('áreas de entrada'),
      peso_min: FAIXA('peso de entrada mínimo (kg)'),
      peso_max: FAIXA('peso de entrada máximo (kg)'),
      cabecas_min: FAIXA('quantidade de entrada mínima'),
      cabecas_max: FAIXA('quantidade de entrada máxima'),
    },
    additionalProperties: false,
  },
});

export const TELAS_FILTRAVEIS = Object.freeze(Object.keys(FILTROS_POR_TELA));

const ROTULOS = Object.freeze({
  setores: 'Setor',
  tipos_cultura: 'Uso',
  tipos_pastagem: 'Pastagem',
  categorias: 'Categoria',
  categorias_manejo: 'Categoria de manejo',
  sistemas: 'Sistema',
  sexos: 'Sexo',
  areas: 'Área',
  status: 'Status',
  colorir_por: 'Cores por',
});

const NOME_TELA = Object.freeze({ MapaGeral: 'Mapa Geral', CadastroLotes: 'Lotes' });

/** "Setor: KM, MT · Peso 300–400 kg" — o que o balão mostra. @param {Record<string, any>} f */
export const resumoDoFiltro = (f) => {
  const partes = [];
  for (const [chave, valor] of Object.entries(f)) {
    if (chave.endsWith('_min') || chave.endsWith('_max')) continue;
    if (Array.isArray(valor) && valor.length) partes.push(`${ROTULOS[chave] ?? chave}: ${valor.join(', ')}`);
    else if (typeof valor === 'string') partes.push(`${ROTULOS[chave] ?? chave}: ${valor}`);
  }
  for (const [base, rotulo, unidade] of [['peso', 'Peso', ' kg'], ['cabecas', 'Cabeças', '']]) {
    const min = f[`${base}_min`];
    const max = f[`${base}_max`];
    if (min !== undefined && max !== undefined) partes.push(`${rotulo} ${min}–${max}${unidade}`);
    else if (min !== undefined) partes.push(`${rotulo} ≥ ${min}${unidade}`);
    else if (max !== undefined) partes.push(`${rotulo} ≤ ${max}${unidade}`);
  }
  return partes.length ? partes.join(' · ') : 'sem filtro (tudo)';
};

/** Definição enviada à API. */
export const DEFINICAO_APLICAR_FILTRO = Object.freeze({
  name: 'aplicar_filtro_tela',
  description:
    'Aplica um filtro numa tela do sistema para o usuário VER o resultado (não altera dados). Use quando ele pedir para mostrar, filtrar ou ver na tela/mapa/lista. ' +
    'Telas: MapaGeral (filtros: setores, tipos_cultura, tipos_pastagem, categorias, sistemas, peso_min/peso_max dos lotes, colorir_por) e CadastroLotes (status, categorias_manejo, categorias, sexos, setores, areas, peso_min/peso_max, cabecas_min/cabecas_max — valores de ENTRADA do lote). ' +
    'Use os nomes exatamente como as consultas devolvem (consulte antes se não souber). O filtro SUBSTITUI o atual; filtros vazios limpam. ' +
    'aplicar_agora = true só quando o usuário pediu claramente para aplicar/mostrar agora; senão o usuário confirma num botão. Para "pastos prontos" no mapa use colorir_por = forragem (o mapa não esconde por situação).',
  input_schema: {
    type: 'object',
    properties: {
      tela: { type: 'string', enum: [...TELAS_FILTRAVEIS] },
      filtros: { type: 'object', description: 'filtros da tela (ver descrição)' },
      aplicar_agora: { type: 'boolean' },
    },
    required: ['tela', 'filtros'],
    additionalProperties: false,
  },
});

/**
 * Valida o pedido e devolve a ação normalizada. Erro de schema vira AppError, que volta
 * para a IA como erro da ferramenta (a conversa segue).
 * @param {{ tela: string, filtros: unknown, aplicar_agora?: boolean }} entrada
 */
export const montarAcaoFiltro = (entrada) => {
  const schema = FILTROS_POR_TELA[/** @type {keyof typeof FILTROS_POR_TELA} */ (entrada.tela)];
  if (!schema) throw new AppError('REQUEST_VALIDATION_FAILED', `aplicar_filtro_tela: tela não suportada "${entrada.tela}"`);
  const filtros = validarEntrada(schema, entrada.filtros ?? {}, `aplicar_filtro_tela.filtros(${entrada.tela})`);
  /** @type {Record<string, any>} */
  const limpo = {};
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor === undefined || valor === null) continue;
    if (Array.isArray(valor)) {
      const unicos = [...new Set(valor.map((v) => String(v).trim()).filter(Boolean))];
      if (unicos.length) limpo[chave] = unicos;
    } else limpo[chave] = valor;
  }
  for (const base of ['peso', 'cabecas']) {
    const min = limpo[`${base}_min`];
    const max = limpo[`${base}_max`];
    if (min !== undefined && max !== undefined && min > max) throw new AppError('REQUEST_VALIDATION_FAILED', `aplicar_filtro_tela: ${base}_min maior que ${base}_max`);
  }
  return {
    tipo: 'filtro_tela',
    tela: entrada.tela,
    nome_tela: NOME_TELA[/** @type {keyof typeof NOME_TELA} */ (entrada.tela)],
    filtros: limpo,
    resumo: resumoDoFiltro(limpo),
    aplicar_agora: entrada.aplicar_agora === true,
  };
};
