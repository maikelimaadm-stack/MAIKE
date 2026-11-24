/**
 * Service dos Bens Patrimoniais (D-PROD-157, simplificado pela D-PROD-162 e
 * pela D-PROD-169).
 *
 * O bem pertence a uma EMPRESA (fazenda): sem empresa real não há leitura nem
 * gravação. O bem é a raiz do agregado — medidor e tanques (com os Produtos
 * aceitos) só mudam pelo POST/PATCH do próprio bem, com `versao`
 * (concorrência otimista). D-PROD-162: saíram as medições físicas e os
 * combustíveis do tanque; cada tanque aceita Produtos do estoque da fazenda.
 *
 * D-PROD-169: o bem tem o "Tipo de bem" (`natureza`, só no POST — ela não muda
 * depois) e o `tipo_id`; a família NÃO vai (o servidor a deriva do tipo). Área
 * e Localização saíram da tela: o corpo não leva `area_id` nem
 * `localizacao_descricao` (o PATCH mínimo nunca os manda, e o que já estiver
 * gravado neles fica como está). Os Produtos aceitos podem estar em L, KG ou
 * SACO.
 *
 * Formas:
 *  - DETALHE (resposta do servidor, A13): referências como objetos
 *    (`tipo{…}`, `proprietario{…}`, `aquisicao.fornecedor{…}`…), medidor e
 *    blocos aninhados, decimais em string canônica; `tanques[i].produtos =
 *    [{produto_id, nome, codigo_interno, unidade_principal_estoque, produto_ativo}]`.
 *  - CORPO (o que a tela monta e o servidor recebe, §4.11): ids planos
 *    (`tipo_id`, `proprietario_parceiro_id`…), `natureza` no POST, `medidor{tipo, leitura_*,
 *    data_leitura}`, `tanques[{id?, identificador, capacidade_litros,
 *    produto_ids, observacao?, ativo?}]` (`produto_ids` sempre presente, pode
 *    ser `[]`: P-01), `aquisicao{…}`, `depreciacao{depreciavel, …}`. Decimais
 *    SEMPRE string.
 *
 * `formaDeEdicaoDoBem(detalhe)` converte o detalhe no corpo, para a tela
 * preencher o formulário e para o PATCH mínimo comparar.
 */

import {
  listBensPatrimoniaisPage,
  getBemPatrimonial,
  createBemPatrimonial,
  updateBemPatrimonial,
  deleteBemPatrimonial,
  previaDepreciacaoBemPatrimonial,
  listOpcoesBemPatrimonial,
  RECURSOS_OPCOES_DA_EMPRESA,
} from '@/apis/patrimonio';
import { exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';

const RESOURCE = 'BemPatrimonial';

/**
 * Campos escalares do corpo (POST e PATCH). `numero`, `natureza` e `empresa_id`
 * não são editáveis (a `natureza` vai só no POST, à parte). D-PROD-169: sem
 * `familia_id` (derivada do tipo no servidor), `area_id` e `localizacao_descricao`.
 */
export const CAMPOS_ESCALARES_BEM = Object.freeze([
  'nome',
  'tipo_id',
  'codigo_frota',
  'propriedade',
  'proprietario_parceiro_id',
  'responsavel_usuario_id',
  'centro_custo_id',
  'marca',
  'modelo',
  'ano_fabricacao',
  'ano_modelo',
  'numero_serie',
  'chassi',
  'placa',
  'placa_uf',
  'renavam',
  'potencia_cv',
  // D-PROD-202: custo por hora ou km de uso (snapshot na linha de máquina da atividade).
  'custo_uso_unitario',
  'material',
  'ano_conclusao',
  'compatibilidade',
  'especificacoes',
  'observacoes',
]);

/** Blocos aninhados: presentes no PATCH, SUBSTITUEM o bloco inteiro (A6). */
export const BLOCOS_BEM = Object.freeze(['medidor', 'aquisicao', 'depreciacao']);

/** Listas sincronizadas por completo no PATCH: os tanques (com os Produtos aceitos). */
export const LISTAS_BEM = Object.freeze(['tanques']);

/** Chaves com decimal em string (comparação ignora zeros à direita: "180.0000" = "180"). */
const CHAVES_DECIMAIS = new Set([
  'potencia_cv',
  'custo_uso_unitario',
  'leitura_inicial',
  'leitura_atual',
  'capacidade_litros',
  'valor_aquisicao',
  'custo_incorporacao',
  'valor_residual',
  'residual_percentual',
]);

/** @param {unknown} v @returns {v is Record<string, any>} */
const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** @param {unknown} v */
const vazio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Texto aparado; vazio = null. @param {unknown} v */
const limpo = (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v === undefined ? null : v);

/** Bloco sem chaves vazias (omitida = null no servidor). @param {Record<string, unknown>} bloco */
const compactar = (bloco) => {
  /** @type {Record<string, any>} */
  const saida = {};
  for (const [chave, valor] of Object.entries(bloco)) {
    if (vazio(valor)) continue;
    saida[chave] = typeof valor === 'string' ? valor.trim() : valor;
  }
  return saida;
};

/** "180.0000" → "180"; "0.50" → "0.5". @param {string} s */
const decimalSemZeros = (s) => (/^\d+\.\d+$/.test(s) ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

/** Forma comparável (texto aparado, vazio = null, decimais sem zeros à direita). @param {unknown} v @param {string} [chave] @returns {unknown} */
const normalizar = (v, chave = '') => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    return CHAVES_DECIMAIS.has(chave) ? decimalSemZeros(t) : t;
  }
  if (Array.isArray(v)) return v.map((item) => normalizar(item, chave === 'produto_ids' ? '' : chave));
  if (ehObjeto(v)) {
    /** @type {Record<string, unknown>} */
    const saida = {};
    for (const k of Object.keys(v).sort()) {
      const n = normalizar(v[k], k);
      if (n !== null) saida[k] = n;
    }
    return saida;
  }
  return v;
};

/** @param {unknown} a @param {unknown} b @param {string} chave */
const iguais = (a, b, chave) => JSON.stringify(normalizar(a, chave)) === JSON.stringify(normalizar(b, chave));

// ─── Blocos do corpo ─────────────────────────────────────────────────────

/**
 * Bloco do medidor. Na criação o servidor só aceita `{tipo, leitura_inicial?,
 * data_leitura?}` (a leitura atual nasce igual à inicial); `leitura_atual` só
 * existe no PATCH.
 * @param {unknown} medidor @param {{ novo?: boolean }} [modo] @returns {Record<string, any>|null}
 */
const corpoDoMedidor = (medidor, { novo = false } = {}) => {
  if (!ehObjeto(medidor) || vazio(medidor.tipo)) return null;
  return compactar({
    tipo: medidor.tipo,
    leitura_inicial: medidor.leitura_inicial,
    leitura_atual: novo ? undefined : medidor.leitura_atual,
    data_leitura: medidor.data_leitura,
  });
};

/**
 * Na criação não há `id` nem `ativo`. Os Produtos aceitos vão sem repetição e
 * em ordem de id (`produto_ids`, sempre presente — `[]` é válido, P-01): o
 * aceite é um conjunto, e tirar/recolocar na tela sem mudar o conjunto não
 * gera PATCH.
 * @param {unknown} tanques @param {{ novo: boolean }} modo
 */
const corpoDosTanques = (tanques, { novo }) =>
  (Array.isArray(tanques) ? tanques : []).filter(ehObjeto).map((t) =>
    compactar({
      id: novo ? undefined : t.id,
      identificador: t.identificador,
      capacidade_litros: t.capacidade_litros,
      produto_ids: Array.isArray(t.produto_ids) ? [...new Set(t.produto_ids.map(String))].sort() : [],
      observacao: t.observacao,
      ativo: novo || !t.id ? undefined : t.ativo !== false,
    }),
  );

/** @param {unknown} aquisicao */
const corpoDaAquisicao = (aquisicao) =>
  ehObjeto(aquisicao)
    ? compactar({
        data_aquisicao: aquisicao.data_aquisicao,
        data_disponibilidade: aquisicao.data_disponibilidade,
        valor_aquisicao: aquisicao.valor_aquisicao,
        custo_incorporacao: aquisicao.custo_incorporacao,
        fornecedor_parceiro_id: aquisicao.fornecedor_parceiro_id,
        documento_referencia: aquisicao.documento_referencia,
        garantia_ate: aquisicao.garantia_ate,
      })
    : {};

/** Depreciação desligada = só `{depreciavel:false}` (o servidor limpa os parâmetros). @param {unknown} depreciacao */
const corpoDaDepreciacao = (depreciacao) => {
  if (!ehObjeto(depreciacao) || depreciacao.depreciavel !== true) return { depreciavel: false };
  return compactar({
    depreciavel: true,
    metodo: depreciacao.metodo || 'LINEAR',
    vida_util_meses: depreciacao.vida_util_meses,
    residual_modo: depreciacao.residual_modo,
    valor_residual: depreciacao.residual_modo === 'VALOR' ? depreciacao.valor_residual : undefined,
    residual_percentual: depreciacao.residual_modo === 'PERCENTUAL' ? depreciacao.residual_percentual : undefined,
    data_inicio_depreciacao: depreciacao.data_inicio_depreciacao,
  });
};

/** @param {string} bloco @param {unknown} valor */
const corpoDoBloco = (bloco, valor) => {
  if (bloco === 'medidor') return corpoDoMedidor(valor);
  if (bloco === 'aquisicao') return corpoDaAquisicao(valor);
  return corpoDaDepreciacao(valor);
};

/** @param {unknown} ref */
const idDe = (ref) => (ehObjeto(ref) && typeof ref.id === 'string' ? ref.id : null);

// ─── Conversão detalhe → corpo ───────────────────────────────────────────

/**
 * Forma de edição (corpo) a partir do DETALHE do servidor. A tela usa para
 * preencher o formulário; o PATCH mínimo compara contra ela.
 * @param {any} detalhe
 * @returns {Record<string, any>}
 */
export const formaDeEdicaoDoBem = (detalhe) => {
  const d = ehObjeto(detalhe) ? detalhe : {};
  /** @type {Record<string, any>} */
  const forma = {};
  for (const campo of CAMPOS_ESCALARES_BEM) forma[campo] = d[campo] ?? null;
  forma.natureza = d.natureza ?? d.familia?.natureza ?? null;
  forma.tipo_id = idDe(d.tipo) ?? d.tipo_id ?? null;
  forma.proprietario_parceiro_id = idDe(d.proprietario) ?? d.proprietario_parceiro_id ?? null;
  forma.responsavel_usuario_id = idDe(d.responsavel) ?? d.responsavel_usuario_id ?? null;
  forma.centro_custo_id = idDe(d.centro_custo) ?? d.centro_custo_id ?? null;
  forma.medidor = ehObjeto(d.medidor)
    ? { tipo: d.medidor.tipo ?? null, leitura_inicial: d.medidor.leitura_inicial ?? null, leitura_atual: d.medidor.leitura_atual ?? null, data_leitura: d.medidor.data_leitura ?? null }
    : null;
  forma.tanques = (Array.isArray(d.tanques) ? d.tanques : []).filter(ehObjeto).map((t) => ({
    id: t.id,
    identificador: t.identificador ?? '',
    capacidade_litros: t.capacidade_litros ?? null,
    produto_ids: (Array.isArray(t.produtos) ? t.produtos : [])
      .filter(ehObjeto)
      .map((p) => (typeof p.produto_id === 'string' ? p.produto_id : idDe(p)))
      .filter(Boolean),
    observacao: t.observacao ?? null,
    ativo: t.ativo !== false,
  }));
  const aq = ehObjeto(d.aquisicao) ? d.aquisicao : {};
  forma.aquisicao = {
    data_aquisicao: aq.data_aquisicao ?? null,
    data_disponibilidade: aq.data_disponibilidade ?? null,
    valor_aquisicao: aq.valor_aquisicao ?? null,
    custo_incorporacao: aq.custo_incorporacao ?? null,
    fornecedor_parceiro_id: idDe(aq.fornecedor) ?? aq.fornecedor_parceiro_id ?? null,
    documento_referencia: aq.documento_referencia ?? null,
    garantia_ate: aq.garantia_ate ?? null,
  };
  const dp = ehObjeto(d.depreciacao) ? d.depreciacao : {};
  forma.depreciacao = {
    depreciavel: dp.depreciavel === true,
    metodo: dp.metodo ?? null,
    vida_util_meses: dp.vida_util_meses ?? null,
    residual_modo: dp.residual_modo ?? null,
    valor_residual: dp.valor_residual ?? null,
    residual_percentual: dp.residual_percentual ?? null,
    data_inicio_depreciacao: dp.data_inicio_depreciacao ?? null,
  };
  return forma;
};

// ─── Operações ───────────────────────────────────────────────────────────

/**
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, ativo?: boolean, natureza?: string|null, tipoId?: string|null }} [opts]
 */
export const listarBensPagina = async (empresaId, opts = {}) => {
  if (!empresaId) return paginaVazia(opts.limit);
  return listBensPatrimoniaisPage({
    empresa_id: empresaId,
    limit: opts.limit,
    cursor: opts.cursor ?? undefined,
    q: opts.q,
    ativo: opts.ativo,
    natureza: opts.natureza || undefined,
    tipo_id: opts.tipoId || undefined,
  });
};

/** Detalhe completo (A13). @param {string|null} empresaId @param {string} id */
export const detalharBem = async (empresaId, id) => {
  const empresa = exigirEmpresa(empresaId, 'detalharBem', RESOURCE);
  return getBemPatrimonial(id, empresa);
};

/**
 * Criação: `natureza` (o Tipo de bem) + escalares não vazios + blocos/listas
 * informados, numa transação no servidor. Tanques novos não levam `id` nem `ativo`; o medidor não leva
 * `leitura_atual`; a depreciação só vai quando ligada (desligada é o padrão).
 * @param {string|null} empresaId @param {Record<string, any>} dados corpo (forma de edição)
 */
export const criarBem = async (empresaId, dados) => {
  const empresa = exigirEmpresa(empresaId, 'criarBem', RESOURCE);
  /** @type {Record<string, any>} */
  const corpo = { empresa_id: empresa };
  // D-PROD-169: o Tipo de bem vai no POST (o servidor confere com a natureza do tipo).
  const natureza = limpo(dados?.natureza);
  if (natureza !== null) corpo.natureza = natureza;
  for (const campo of CAMPOS_ESCALARES_BEM) {
    const valor = limpo(dados?.[campo]);
    if (valor !== null) corpo[campo] = valor;
  }
  const medidor = corpoDoMedidor(dados?.medidor, { novo: true });
  if (medidor) corpo.medidor = medidor;
  const tanques = corpoDosTanques(dados?.tanques, { novo: true });
  if (tanques.length) corpo.tanques = tanques;
  const aquisicao = corpoDaAquisicao(dados?.aquisicao);
  if (Object.keys(aquisicao).length) corpo.aquisicao = aquisicao;
  if (ehObjeto(dados?.depreciacao) && dados.depreciacao.depreciavel === true) corpo.depreciacao = corpoDaDepreciacao(dados.depreciacao);
  return createBemPatrimonial(corpo);
};

/**
 * PATCH mínimo do agregado com `versao`:
 *  - escalar alterado vai com o valor novo (vazio = `null`, limpa);
 *  - bloco (`medidor`, `aquisicao`, `depreciacao`) alterado vai INTEIRO;
 *    `medidor: null` só quando a tela retira o medidor (o servidor decide);
 *  - a lista `tanques` alterada vai COMPLETA (sync no servidor: tanque gravado
 *    nunca some — inative-o; Produto que sai dos aceitos é retirado).
 * Sem mudança → nada é enviado.
 * @param {string|null} empresaId @param {any} original detalhe aberto @param {Record<string, any>} dados corpo (forma de edição)
 * @returns {Promise<{ alterado: boolean, registro: any }>}
 */
export const atualizarBem = async (empresaId, original, dados) => {
  const empresa = exigirEmpresa(empresaId, 'atualizarBem', RESOURCE);
  const antes = formaDeEdicaoDoBem(original);
  /** @type {Record<string, any>} */
  const corpo = {};
  const temCampo = (/** @type {string} */ campo) => Object.prototype.hasOwnProperty.call(dados ?? {}, campo);
  for (const campo of CAMPOS_ESCALARES_BEM) {
    if (!temCampo(campo) || iguais(dados[campo], antes[campo], campo)) continue;
    corpo[campo] = limpo(dados[campo]);
  }
  for (const bloco of BLOCOS_BEM) {
    if (!temCampo(bloco)) continue;
    const novo = corpoDoBloco(bloco, dados[bloco]);
    if (iguais(novo, corpoDoBloco(bloco, antes[bloco]), bloco)) continue;
    corpo[bloco] = novo;
  }
  if (temCampo('tanques')) {
    const novos = corpoDosTanques(dados.tanques, { novo: false });
    if (!iguais(novos, corpoDosTanques(antes.tanques, { novo: false }), 'tanques')) corpo.tanques = novos;
  }
  if (!Object.keys(corpo).length) return { alterado: false, registro: original };
  const registro = await updateBemPatrimonial(original.id, { empresa_id: empresa, versao: original.versao, ...corpo });
  return { alterado: true, registro };
};

/**
 * Inativar (`false`) ou reativar (`true`) o bem: corpo só com escopo, `versao`
 * e `ativo` (exige a ação `inativar`). Nada é apagado.
 * @param {string|null} empresaId @param {{ id: string, versao: number }} original @param {boolean} ativo
 */
export const alterarSituacaoBem = async (empresaId, original, ativo) => {
  const empresa = exigirEmpresa(empresaId, 'alterarSituacaoBem', RESOURCE);
  return updateBemPatrimonial(original.id, { empresa_id: empresa, versao: original.versao, ativo: ativo === true });
};

/**
 * D-PROD-287 — exclui de vez o bem nunca usado (`original` traz `id` e `versao`).
 * @param {string|null} empresaId @param {{ id: string, versao: number }} original
 */
export const excluirBem = async (empresaId, original) => {
  const empresa = exigirEmpresa(empresaId, 'excluirBem', RESOURCE);
  return deleteBemPatrimonial(original.id, empresa, original.versao);
};

/**
 * Prévia gerencial de depreciação linear (§6) — NÃO grava nada.
 * @param {string|null} empresaId
 * @param {{ valor_aquisicao: string, custo_incorporacao?: string|null, residual_modo: string, valor_residual?: string|null,
 *   residual_percentual?: string|null, vida_util_meses: number, data_inicio_depreciacao: string }} parametros
 */
export const simularDepreciacao = async (empresaId, parametros) => {
  const empresa = exigirEmpresa(empresaId, 'simularDepreciacao', RESOURCE);
  const p = parametros ?? /** @type {any} */ ({});
  return previaDepreciacaoBemPatrimonial({
    empresa_id: empresa,
    ...compactar({
      valor_aquisicao: p.valor_aquisicao,
      custo_incorporacao: p.custo_incorporacao,
      residual_modo: p.residual_modo,
      valor_residual: p.residual_modo === 'VALOR' ? p.valor_residual : undefined,
      residual_percentual: p.residual_modo === 'PERCENTUAL' ? p.residual_percentual : undefined,
      vida_util_meses: p.vida_util_meses,
      data_inicio_depreciacao: p.data_inicio_depreciacao,
    }),
  });
};

/**
 * Uma página de opções ATIVAS para os seletores do bem. Responsáveis,
 * parceiros, centros de custo e `produtos` pedem a empresa (sem ela não há
 * busca); `tipos` (catálogo do tenant) não depende dela e aceita `natureza`
 * (D-PROD-169: os tipos do "Tipo de bem"). `produtos` (D-PROD-162;
 * D-PROD-169) = Produtos ativos da fazenda, em L, KG ou SACO, que um tanque
 * pode aceitar; `unidade` (`L` | `KG` | `SACO`) filtra.
 * @param {'tipos'|'produtos'|'responsaveis'|'parceiros'|'centros-custo'} recurso
 * @param {string|null} empresaId
 * @param {{ q?: string, cursor?: string|null, limit?: number, natureza?: string|null, unidade?: 'L'|'KG'|'SACO'|null }} [opts]
 */
export const listarOpcoesBem = async (recurso, empresaId, opts = {}) => {
  if (RECURSOS_OPCOES_DA_EMPRESA.includes(recurso) && !empresaId) return { itens: [], has_more: false, next_cursor: null };
  return listOpcoesBemPatrimonial(recurso, {
    empresa_id: empresaId || undefined,
    q: opts.q?.trim() || undefined,
    cursor: opts.cursor || undefined,
    limit: opts.limit ?? 50,
    ...(recurso === 'tipos' && opts.natureza ? { natureza: opts.natureza } : {}),
    ...(recurso === 'produtos' && opts.unidade ? { unidade: opts.unidade } : {}),
  });
};
