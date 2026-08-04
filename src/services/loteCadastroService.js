/**
 * Service do cadastro de lotes (P1.3, D-PROD-18).
 *
 * Substitui `src/core/repositories/loteRepository.js`, removido nesta slice.
 * O repositório antigo era um objeto único que falava direto com o SDK e
 * misturava três coisas: leitura de lote, layout configurável e fontes de opção
 * de campo personalizado. Aqui elas continuam juntas por serem o mesmo caso de
 * uso — o cadastro —, mas cada uma passa por API pública explícita.
 *
 * O manejo (movimentação, morte, abate, pesagem) **não** está aqui: vive em
 * `loteManejoService`, criado na P1.2, e é reutilizado (QLT-P13-03).
 */

import {
  listLotes,
  createLote,
  updateLote,
  deleteLote,
  listMovimentacoes,
  listMovimentacoesPecuarias,
  listTodasMovimentacoes,
  listFornecedores,
  listCategoriasManejo,
  listOptionSource,
  isOptionSourceSuportada,
  OPTION_SOURCES,
  listLayoutConfiguracoes,
  createLayoutConfiguracao,
  listLayoutSecoes,
  createLayoutSecao,
  listLayoutCampos,
  createLayoutCampo,
  updateLayoutCampo,
  deleteLayoutCampo,
  sincronizarReferenciasLote,
  listSuplementacaoLotes,
} from '@/apis/lotes';
import { listAreas } from '@/apis/mapa';
import { listLancamentos } from '@/apis/tarefas';
import { listManejosTecnicos } from '@/apis/rebanho';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { assertExclusaoPermitida } from './deleteGuardService';

/**
 * Origens geradas pelo próprio sistema.
 *
 * Um lote com essas origens nasceu de um manejo (movimentação, nascimento,
 * mudança de categoria) e não de um cadastro manual. A tela de cadastro os
 * esconde por padrão. Lista preservada do repositório removido.
 */
export const ORIGENS_SISTEMA = Object.freeze([
  'MOVIMENTAÇÃO',
  'REVERSÃO MOVIMENTAÇÃO',
  'Nascimento',
  'Mudança de Categoria',
  'NASCIMENTO',
  'MUDANÇA DE CATEGORIA',
]);

/** Campo `select` nativo do lote: existe no layout, mas não pode ser excluído. */
const NATIVE_SELECT_FIELDS = Object.freeze([
  {
    field_id: 'lote_native_motivo_entrada',
    field_name: 'motivo_entrada',
    label: 'Motivo da Entrada',
    options: ['COMPRA', 'AJUSTE', 'INVENTÁRIO', 'OUTROS'],
  },
]);

const normalizeOption = (option) =>
  String(option?.label || option?.value || option || '').trim().toUpperCase();

const buildProtectedOptions = (protectedOptions = [], options = []) => {
  const merged = [...protectedOptions, ...options.map(normalizeOption)].filter(Boolean);
  return [...new Set(merged)]
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
    .map((item) => ({ value: item, label: item, protected: protectedOptions.includes(item) }));
};

/**
 * @param {any[]} items
 * @param {string} [empresaId]
 * @returns {any[]}
 */
const daEmpresa = (items, empresaId) =>
  empresaId ? items.filter((item) => item.empresa_id === empresaId) : items;

// ── Leitura ───────────────────────────────────────────────────────────────

/**
 * Lotes da empresa.
 *
 * @param {{empresaId?: string, incluirSistema?: boolean}} [opcoes]
 * @returns {Promise<any[]>}
 */
export const listarLotes = async ({ empresaId, incluirSistema = true } = {}) => {
  const todos = await listLotes();
  return daEmpresa(todos, empresaId).filter(
    (lote) => incluirSistema || !ORIGENS_SISTEMA.includes(lote.origem)
  );
};

/** @returns {Promise<object|null>} */
export const buscarLotePorId = async (id) => {
  const todos = await listLotes();
  return todos.find((lote) => lote.id === id) || null;
};

/** @returns {Promise<any[]>} */
export const listarAreasAtivas = async (empresaId) => {
  const todas = await listAreas();
  return daEmpresa(todas, empresaId).filter((area) => area.ativo !== false);
};

/**
 * Ids de lotes que já têm movimentação — usados para bloquear exclusão na UI.
 * @returns {Promise<string[]>}
 */
export const listarIdsDeLotesComMovimentacao = async (empresaId) => {
  const [pecuarias, doMapa] = await Promise.all([
    listMovimentacoesPecuarias(),
    listTodasMovimentacoes(),
  ]);
  const ids = [...daEmpresa(pecuarias, empresaId), ...daEmpresa(doMapa, empresaId)]
    .filter((mov) => mov.lote_id)
    .map((mov) => mov.lote_id);
  return [...new Set(ids)];
};

/** @returns {Promise<any[]>} */
export const listarCategoriasManejoAtivas = async (empresaId) => {
  const todas = await listCategoriasManejo();
  return daEmpresa(todas, empresaId).filter((categoria) => categoria.ativo !== false);
};

/** @returns {Promise<any[]>} */
export const listarFornecedores = async (empresaId) => {
  const todos = await listFornecedores();
  return daEmpresa(todos, empresaId);
};

// ── Escrita ───────────────────────────────────────────────────────────────

/**
 * Próximo `numero_lote`.
 *
 * **Risco conhecido (R2):** `max + 1` calculado no cliente não é seguro sob
 * concorrência — duas criações simultâneas podem receber o mesmo número. A
 * regra é preservada porque mudá-la exigiria sequência no servidor, que só
 * existe com persistência nativa (P4). Não há lock aqui e não se declara um.
 *
 * @param {any[]} lotes
 * @returns {string}
 */
export const proximoNumeroLote = (lotes) => {
  const maior = (lotes || []).reduce(
    (max, lote) => Math.max(max, parseInt(lote.numero_lote, 10) || 0),
    0
  );
  return String(maior + 1);
};

/**
 * @param {object} dados
 * @param {{empresaId?: string}} [opcoes]
 */
export const criarLote = async (dados, { empresaId } = {}) => {
  const todos = await listLotes();
  return createLote({
    ...dados,
    empresa_id: empresaId || dados.empresa_id,
    numero_lote: dados.numero_lote || proximoNumeroLote(todos),
    status: dados.status || 'Ativo',
    campos_personalizados: dados.campos_personalizados || {},
  });
};

/**
 * Atualiza o lote e sincroniza as referências denormalizadas.
 *
 * A sincronização acontece **depois** da atualização e usa capacidade nomeada,
 * não `invoke(nomeQualquer)`.
 */
/**
 * @param {string} id
 * @param {object} dados
 * @param {{registroAnterior?: object}} [opcoes]
 */
export const atualizarLote = async (id, dados, { registroAnterior } = {}) => {
  const atualizado = await updateLote(id, {
    ...dados,
    campos_personalizados: dados.campos_personalizados || {},
  });
  await sincronizarReferenciasLote({ registro: atualizado, registroAnterior });
  return atualizado;
};

export const excluirLote = async (id) => deleteLote(id);

/**
 * O lote pode ser excluído?
 *
 * Usa a tabela provider-agnostic da P1.2 com carregadores explícitos por
 * dependência. Bloqueio vira `LOTE_DELETE_BLOCKED` — a UI trata por código e
 * nunca lê texto de erro.
 */
const CARREGADORES_DE_DEPENDENCIA = Object.freeze({
  MovimentacaoMapa: () => listMovimentacoes(),
  MovimentacaoPecuaria: () => listMovimentacoesPecuarias(),
  SuplementacaoLote: () => listSuplementacaoLotes(),
  LancamentoTarefa: () => listLancamentos(),
  ManejoTecnicoRebanho: () => listManejosTecnicos(),
});

export const validarExclusaoDeLote = async (id) => {
  const lote = await buscarLotePorId(id);
  await assertExclusaoPermitida({
    entityName: 'Lote',
    id,
    currentRecord: lote,
    carregadores: CARREGADORES_DE_DEPENDENCIA,
    blockedCode: API_ERROR_CODES.LOTE_DELETE_BLOCKED,
    operation: 'validarExclusaoDeLote',
  });
};

// ── Layout configurável ───────────────────────────────────────────────────

/**
 * Garante layout, seção e campos nativos do cadastro de lote.
 *
 * Idempotente: chamar várias vezes não duplica nada. É pré-condição de
 * `listarCamposPersonalizados`, como era no repositório removido.
 */
export const garantirLayoutBase = async () => {
  const configuracoes = await listLayoutConfiguracoes();
  let layout = configuracoes.find((item) => item.tela === 'CadastroLotes' && item.ativo !== false);

  if (!layout) {
    layout = await createLayoutConfiguracao({
      tela: 'CadastroLotes',
      nome: 'Cadastro de Lotes',
      descricao: 'Layout configurável dos campos do cadastro de lotes',
      escopo: 'sistema',
      versao_ativa: 1,
      ativo: true,
    });
  }

  const secoes = await listLayoutSecoes();
  let secao = secoes.find(
    (item) => item.layout_id === layout.id && item.section_id === 'campos_personalizados'
  );

  if (!secao) {
    secao = await createLayoutSecao({
      layout_id: layout.id,
      section_id: 'campos_personalizados',
      titulo: 'Campos Personalizados',
      ordem: 99,
      ativo: true,
    });
  }

  const camposLayout = await listLayoutCampos();
  await Promise.all(
    NATIVE_SELECT_FIELDS.map(async (nativo) => {
      const existente = camposLayout.find(
        (campo) => campo.layout_id === layout.id && campo.field_name === nativo.field_name
      );
      const opcoes = buildProtectedOptions(nativo.options, existente?.options || []);
      const payload = {
        layout_id: layout.id,
        section_id: secao.section_id,
        field_id: nativo.field_id,
        entity_name: 'Lote',
        field_name: nativo.field_name,
        origem: 'sistema',
        label: nativo.label,
        tipo: 'select',
        ativo: true,
        visivel_form: false,
        visivel_tabela: false,
        visivel_relatorio: false,
        options: opcoes,
        options_text: opcoes.map((option) => option.label).join('\n'),
        metadata: { ...(existente?.metadata || {}), native_select: true, protected_options: nativo.options },
      };
      if (existente) await updateLayoutCampo(existente.id, payload);
      else await createLayoutCampo(payload);
    })
  );

  return { layout, secao };
};

/** @returns {Promise<any[]>} */
export const listarCamposPersonalizados = async () => {
  const { layout } = await garantirLayoutBase();
  const campos = await listLayoutCampos();
  return campos
    .filter(
      (campo) =>
        campo.layout_id === layout.id &&
        campo.entity_name === 'Lote' &&
        (campo.origem === 'customizado' || campo.metadata?.native_select)
    )
    .sort(
      (a, b) =>
        Number(!!b.metadata?.native_select) - Number(!!a.metadata?.native_select) ||
        (a.ordem || 0) - (b.ordem || 0)
    );
};

export const criarCampoPersonalizado = async (dados) => {
  const { layout, secao } = await garantirLayoutBase();
  const campos = await listarCamposPersonalizados();
  const fieldName = dados.field_name;

  return createLayoutCampo({
    layout_id: layout.id,
    section_id: secao.section_id,
    field_id: `lote_custom_${fieldName}`,
    entity_name: 'Lote',
    field_name: fieldName,
    origem: 'customizado',
    label: dados.label,
    placeholder: dados.placeholder || '',
    descricao: dados.descricao || '',
    tipo: dados.tipo,
    col_span: dados.col_span || 6,
    ordem: campos.length + 1,
    obrigatorio: !!dados.obrigatorio,
    read_only: dados.tipo === 'calculado',
    ativo: true,
    visivel_form: dados.visivel_form !== false,
    visivel_tabela: dados.visivel_tabela !== false,
    visivel_relatorio: dados.visivel_relatorio !== false,
    ordenavel: dados.ordenavel !== false,
    filtravel: dados.filtravel !== false,
    alinhamento: dados.alinhamento || 'left',
    largura_coluna: dados.largura_coluna || 160,
    ordem_tabela: dados.ordem_tabela || campos.length + 1,
    agregacao: dados.agregacao || dados.agregacao_tipo || undefined,
    agregacao_tipo: dados.agregacao_tipo || dados.agregacao || undefined,
    agregacao_campo_base: '',
    options: dados.options || [],
    options_source: dados.options_source || dados.options_source_entity || '',
    options_source_entity: dados.options_source_entity || '',
    options_label_field: dados.options_label_field || 'nome',
    options_value_field: dados.options_value_field || 'id',
    relation_entity: dados.relation_entity || '',
    relation_display_field: dados.relation_display_field || 'nome',
    regras: dados.regras || {},
    formula: dados.formula || '',
    calculation_builder: dados.calculation_builder || { items: [] },
    usar_decimal: !!dados.usar_decimal && !dados.usar_mascara,
    decimal_places: dados.decimal_places ?? 2,
    usar_mascara: !!dados.usar_mascara && !dados.usar_decimal,
    mascaras_text: dados.mascaras_text || '',
    dependencias: dados.dependencias || dados.campos_dependentes || [],
    campos_dependentes: dados.campos_dependentes || dados.dependencias || [],
  });
};

/** Campo nativo só aceita edição das opções; o resto do payload é ignorado. */
export const atualizarCampoPersonalizado = async (id, dados) => {
  const campos = await listLayoutCampos();
  const atual = campos.find((campo) => campo.id === id);

  if (atual?.metadata?.native_select) {
    const protegidas = atual.metadata.protected_options || [];
    const opcoes = buildProtectedOptions(protegidas, dados.options || []);
    return updateLayoutCampo(id, {
      options: opcoes,
      options_text: opcoes.map((option) => option.label).join('\n'),
      metadata: atual.metadata,
    });
  }

  return updateLayoutCampo(id, {
    ...dados,
    read_only: dados.tipo === 'calculado',
    agregacao_campo_base: '',
    filtravel: dados.filtravel !== false,
    options_source: dados.options_source || dados.options_source_entity || '',
    agregacao: dados.agregacao || dados.agregacao_tipo || undefined,
    dependencias: dados.dependencias || dados.campos_dependentes || [],
  });
};

/**
 * Exclui um campo personalizado.
 *
 * Dois bloqueios, ambos com código estável — antes eram `throw new Error` com
 * texto que a UI exibia cru:
 *  - campo nativo do sistema nunca some;
 *  - campo com dado em algum lote não some, porque a exclusão perderia o valor.
 */
export const excluirCampoPersonalizado = async (campo) => {
  const contexto = { operation: 'excluirCampoPersonalizado', resource: 'LayoutCampo' };

  if (campo?.metadata?.native_select) {
    throw new ApiError(API_ERROR_CODES.LOTE_NATIVE_FIELD_PROTECTED, {
      ...contexto,
      details: { campo: campo.field_name || null },
    });
  }

  const fieldName = campo.field_name;
  const lotes = await listLotes();
  const possuiDados = lotes.some((lote) => {
    const valor = lote.campos_personalizados?.[fieldName];
    return valor !== undefined && valor !== null && String(valor).trim() !== '';
  });

  if (possuiDados) {
    throw new ApiError(API_ERROR_CODES.LOTE_FIELD_HAS_DATA, {
      ...contexto,
      details: { campo: fieldName || null },
    });
  }

  return deleteLayoutCampo(campo.id);
};

// ── Fontes de opção ───────────────────────────────────────────────────────

export { OPTION_SOURCES, isOptionSourceSuportada };

/**
 * Carrega as fontes de opção pedidas por campos personalizados.
 *
 * O legado fazia `base44.entities[source.entity]` com nome vindo de dado
 * editável. Aqui cada nome é validado contra o catálogo fechado; fonte
 * desconhecida lança `LOTE_OPTION_SOURCE_UNSUPPORTED` em vez de devolver lista
 * vazia — vazio silencioso faria a configuração inválida parecer "sem
 * cadastros".
 *
 * @param {Array<string|{entity: string, labelField?: string, valueField?: string}>} fontes
 * @returns {Promise<Record<string, any[]>>}
 */
export const listarFontesDeOpcoes = async (fontes = []) => {
  const configs = (fontes || [])
    .map((fonte) => (typeof fonte === 'string' ? { entity: fonte } : fonte))
    .filter((fonte) => fonte?.entity);
  const unicas = Array.from(new Map(configs.map((fonte) => [fonte.entity, fonte])).values());

  const entradas = await Promise.all(
    unicas.map(async (fonte) => {
      const registros = await listOptionSource(fonte.entity);
      const labelField = fonte.labelField || OPTION_SOURCES[fonte.entity] || 'nome';
      const valueField = fonte.valueField || 'id';
      return [
        fonte.entity,
        registros.map((registro) => ({
          ...registro,
          value: registro[valueField] ?? registro.id,
          label:
            registro[labelField] ||
            registro.nome ||
            registro.nome_produto ||
            registro.apelido ||
            registro.descricao ||
            registro.razao_social ||
            registro.full_name ||
            registro.email ||
            registro.id,
        })),
      ];
    })
  );

  return Object.fromEntries(entradas);
};
