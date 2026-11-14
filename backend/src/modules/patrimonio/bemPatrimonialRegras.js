/**
 * D-PROD-157 — regras PURAS do bem patrimonial (sem banco): normalização do
 * corpo, matriz de natureza (§2), transições do medidor (A2) e validação de
 * aquisição/depreciação sobre o ESTADO FINAL (A6).
 *
 * Estado canônico: as mesmas chaves das colunas de `BemPatrimonial`; textos
 * aparados ou null; decimais como string NA ESCALA DA COLUNA (medidas e
 * dinheiro 4 casas, percentual 6); datas `AAAA-MM-DD`. Comparar dois estados
 * é comparar valores simples — é assim que o PATCH sem mudança efetiva
 * devolve o atual sem gravar, auditar nem incrementar a versão.
 */

import { AppError } from '../../shared/errors/AppError.js';
import { dec, texto } from '../financeiro/decimalFinanceiro.js';
import { invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { simularDepreciacaoLinear } from './depreciacaoLinear.js';
import { comoData, diaDe, diaDoCorpo } from './patrimonioComum.js';
import {
  CAMPOS_POR_CAPACIDADE, FAIXA_ANO_CONCLUSAO, FAIXA_ANO_FABRICACAO, FAIXA_ANO_MODELO, MEDIDOR_OBRIGATORIO, MEDIDOR_PROIBIDO,
  PADRAO_CHASSI, PADRAO_CODIGO_FROTA, PADRAO_PLACA, PADRAO_RENAVAM, PROPRIEDADES, UFS, UNIDADE_DO_MEDIDOR, campoAplicavel, regraDoMedidor,
} from './patrimonioDominio.js';

/** Código de frota: coluna VarChar(16). */
export const TAMANHO_MAXIMO_CODIGO_FROTA = 16;

/** Formatos de decimal do corpo (A1): dinheiro BRL, medida/leitura/potência e percentual. */
export const PADRAO_DINHEIRO = /^\d{1,14}(\.\d{1,2})?$/;
export const PADRAO_MEDIDA = /^\d{1,10}(\.\d{1,4})?$/;
export const PADRAO_PERCENTUAL = /^\d{1,3}(\.\d{1,4})?$/;

/** Escala das colunas decimais do bem (o estado canônico usa a escala da coluna). */
const CASAS_DAS_COLUNAS = Object.freeze({
  potencia_cv: 4,
  medidor_leitura_inicial: 4,
  medidor_leitura_atual: 4,
  valor_aquisicao: 4,
  custo_incorporacao: 4,
  custo_uso_unitario: 4,
  valor_residual: 4,
  residual_percentual: 6,
});
const COLUNAS_DATA = Object.freeze(['medidor_data_leitura', 'data_aquisicao', 'data_disponibilidade', 'garantia_ate', 'data_inicio_depreciacao']);

/** Colunas editáveis do bem (fora: id, cliente_id, empresa_id, numero, natureza, versao, carimbos). */
export const COLUNAS_ESTADO = Object.freeze([
  'familia_id', 'tipo_id', 'nome', 'codigo_frota', 'propriedade', 'proprietario_parceiro_id', 'responsavel_usuario_id', 'centro_custo_id',
  'area_id', 'localizacao_descricao', 'marca', 'modelo', 'ano_fabricacao', 'ano_modelo', 'numero_serie', 'chassi', 'placa', 'placa_uf',
  'renavam', 'potencia_cv', 'material', 'ano_conclusao', 'compatibilidade', 'especificacoes', 'observacoes',
  'medidor_tipo', 'medidor_unidade', 'medidor_leitura_inicial', 'medidor_leitura_atual', 'medidor_data_leitura', 'medidor_origem',
  'data_aquisicao', 'data_disponibilidade', 'valor_aquisicao', 'custo_incorporacao', 'fornecedor_parceiro_id', 'documento_referencia', 'garantia_ate',
  'custo_uso_unitario',
  'depreciavel', 'depreciacao_metodo', 'vida_util_meses', 'residual_modo', 'valor_residual', 'residual_percentual', 'data_inicio_depreciacao',
  'ativo',
]);

/** Estado de um bem novo antes do corpo (defaults do schema). */
export const ESTADO_NOVO = Object.freeze({
  ...Object.fromEntries(COLUNAS_ESTADO.map((c) => [c, null])),
  propriedade: 'PROPRIO',
  depreciavel: false,
  ativo: true,
});

/**
 * Linha do banco → estado canônico.
 * @param {Record<string, any>} r
 * @returns {Record<string, any>}
 */
export const estadoDoRegistro = (r) => {
  /** @type {Record<string, any>} */
  const e = {};
  for (const c of COLUNAS_ESTADO) {
    if (COLUNAS_DATA.includes(c)) e[c] = diaDe(r[c]);
    else if (c in CASAS_DAS_COLUNAS) e[c] = texto(r[c], CASAS_DAS_COLUNAS[c]);
    else e[c] = r[c] ?? null;
  }
  return e;
};

/**
 * Colunas cujo valor muda de `antes` para `depois` (com o valor novo).
 * @param {Record<string, any>} antes
 * @param {Record<string, any>} depois
 */
export const diferencas = (antes, depois) => Object.fromEntries(COLUNAS_ESTADO.filter((c) => (antes[c] ?? null) !== (depois[c] ?? null)).map((c) => [c, depois[c] ?? null]));

/**
 * Estado canônico → dados do Prisma (datas viram Date; decimais seguem string).
 * @param {Record<string, any>} dados
 */
export const paraGravacao = (dados) => Object.fromEntries(Object.entries(dados).map(([c, v]) => [c, COLUNAS_DATA.includes(c) ? comoData(v) : v]));

// ─── erros ──────────────────────────────────────────────────────────────────

const ROTULOS_CAMPOS = Object.freeze({
  medicoes: 'medições físicas',
  tanques: 'tanques de combustível',
  placa: 'placa',
  placa_uf: 'UF da placa',
  renavam: 'RENAVAM',
  chassi: 'chassi',
  numero_serie: 'número de série',
  potencia_cv: 'potência',
  material: 'material',
  ano_conclusao: 'ano de conclusão',
  compatibilidade: 'compatibilidade',
  medidor: 'medidor',
});

/** 422 da matriz de natureza (§2): `null`/`[]` é aceito; valor não vazio, não. */
export const naoAplicavel = (field, natureza) =>
  new AppError('BEM_CAMPO_NAO_APLICAVEL', `${ROTULOS_CAMPOS[field] ?? field} não se aplica a bens desta natureza; nada foi gravado`, {
    details: { field, reason: 'nao_aplicavel', natureza },
  });

/**
 * 422 de referência recusada (família, tipo, parceiro, responsável, centro,
 * área, perfil, combustível, medição ou tanque): o mesmo código para outro
 * tenant, outra empresa e inexistente; `reason` distingue `inativo`.
 * @param {string} field
 * @param {string} reason
 * @param {string} mensagem
 * @param {Record<string, unknown>} [extra]
 */
export const referenciaInvalida = (field, reason, mensagem, extra = {}) =>
  new AppError('BEM_REFERENCIA_INVALIDA', `${mensagem}; nada foi gravado`, { details: { field, reason, ...extra } });

const campoInvalido = (field, reason, mensagem) => new AppError('BEM_CAMPO_INVALIDO', `${mensagem}; nada foi gravado`, { details: { field, reason } });

const parametrosInvalidos = (mensagem, field, reason) =>
  new AppError('DEPRECIACAO_PARAMETROS_INVALIDOS', `${mensagem}; nada foi gravado`, { details: { field, reason } });

const dataInvalida = (mensagem, field, reason) => new AppError('PATRIMONIO_DATA_INVALIDA', `${mensagem}; nada foi gravado`, { details: { field, reason } });

const leituraInvalida = (mensagem, field, reason) => new AppError('MEDIDOR_LEITURA_INVALIDA', `${mensagem}; nada foi gravado`, { details: { field, reason } });

// ─── normalização dos campos do corpo ───────────────────────────────────────

/**
 * Decimal do corpo (string no formato dado) → string na escala da coluna;
 * ausente/null → null. Fora do formato → 400 (o schema HTTP já barra; aqui é
 * a guarda do próprio service).
 * @param {unknown} valor
 * @param {string} campo
 * @param {RegExp} padrao
 * @param {number} casas
 * @returns {string|null}
 */
export const decimalDoCorpo = (valor, campo, padrao, casas) => {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string' || !padrao.test(valor)) throw invalido(`${campo} deve ser um número decimal em texto`, { field: campo, reason: 'formato' });
  return dec(valor).toFixed(casas);
};

/**
 * Código de frota: aparado, MAIÚSCULAS, espaços repetidos → um; vazio → null;
 * fora de `^[A-Z0-9]+([ -][A-Z0-9]+)*$` ou com mais de 16 caracteres → 422.
 * @param {unknown} valor
 * @returns {string|null}
 */
export const codigoFrotaDoCorpo = (valor) => {
  const t = textoDoCorpo(valor, 'codigo_frota');
  if (!t) return null;
  const codigo = t.toUpperCase().replace(/\s+/g, ' ');
  if (codigo.length > TAMANHO_MAXIMO_CODIGO_FROTA || !PADRAO_CODIGO_FROTA.test(codigo)) {
    throw new AppError(
      'BEM_CODIGO_FROTA_INVALIDO',
      `o código de frota aceita até ${TAMANHO_MAXIMO_CODIGO_FROTA} letras e números, separados por hífen ou espaço (ex.: TP-02); nada foi gravado`,
      { details: { field: 'codigo_frota', reason: 'formato' } }
    );
  }
  return codigo;
};

/** @param {unknown} valor */
const placaDoCorpo = (valor) => {
  const t = textoDoCorpo(valor, 'placa');
  if (!t) return null;
  const placa = t.replace(/[\s-]/g, '').toUpperCase();
  if (!PADRAO_PLACA.test(placa)) throw campoInvalido('placa', 'formato', 'a placa deve seguir o formato ABC-1234 ou o Mercosul ABC1D23');
  return placa;
};

/** @param {unknown} valor */
const ufDoCorpo = (valor) => {
  const t = textoDoCorpo(valor, 'placa_uf');
  if (!t) return null;
  const uf = t.toUpperCase();
  if (!UFS.includes(uf)) throw campoInvalido('placa_uf', 'uf_invalida', 'a UF da placa deve ser uma sigla de estado brasileiro');
  return uf;
};

/** @param {unknown} valor */
const renavamDoCorpo = (valor) => {
  const t = textoDoCorpo(valor, 'renavam');
  if (!t) return null;
  if (!PADRAO_RENAVAM.test(t)) throw campoInvalido('renavam', 'formato', 'o RENAVAM tem de 9 a 11 dígitos');
  return t;
};

/** @param {unknown} valor */
const chassiDoCorpo = (valor) => {
  const t = textoDoCorpo(valor, 'chassi');
  if (!t) return null;
  const chassi = t.replace(/\s/g, '').toUpperCase();
  if (!PADRAO_CHASSI.test(chassi)) throw campoInvalido('chassi', 'formato', 'o chassi tem 17 letras e números, sem I, O e Q');
  return chassi;
};

const ANOS = Object.freeze({
  ano_fabricacao: { faixa: FAIXA_ANO_FABRICACAO, rotulo: 'o ano de fabricação' },
  ano_modelo: { faixa: FAIXA_ANO_MODELO, rotulo: 'o ano do modelo' },
  ano_conclusao: { faixa: FAIXA_ANO_CONCLUSAO, rotulo: 'o ano de conclusão' },
});

/** @param {unknown} valor @param {keyof typeof ANOS} campo */
const anoDoCorpo = (valor, campo) => {
  if (valor === null || valor === undefined) return null;
  const { faixa, rotulo } = ANOS[campo];
  if (!Number.isInteger(valor) || /** @type {number} */ (valor) < faixa.min || /** @type {number} */ (valor) > faixa.max) {
    throw campoInvalido(campo, 'fora_da_faixa', `${rotulo} deve estar entre ${faixa.min} e ${faixa.max}`);
  }
  return valor;
};

/** @param {unknown} valor */
const potenciaDoCorpo = (valor) => {
  const potencia = decimalDoCorpo(valor, 'potencia_cv', PADRAO_MEDIDA, CASAS_DAS_COLUNAS.potencia_cv);
  if (potencia !== null && dec(potencia).lte(0)) throw campoInvalido('potencia_cv', 'nao_positivo', 'a potência deve ser maior que zero');
  return potencia;
};

const TEXTOS_LIVRES = Object.freeze(['localizacao_descricao', 'marca', 'modelo', 'numero_serie', 'material', 'compatibilidade', 'especificacoes', 'observacoes']);
/** Referências escalares do topo do corpo (validadas no banco pelo service). */
export const REFERENCIAS_DO_TOPO = Object.freeze(['proprietario_parceiro_id', 'responsavel_usuario_id', 'centro_custo_id', 'area_id']);

/**
 * Escalares PRESENTES no corpo, normalizados para o estado canônico (chave
 * ausente não aparece; `null` limpa). Família e tipo ficam com o service
 * (dependem do banco).
 * @param {Record<string, any>} entrada
 * @returns {Record<string, any>}
 */
export const escalaresDoCorpo = (entrada) => {
  const tem = (c) => Object.prototype.hasOwnProperty.call(entrada, c);
  /** @type {Record<string, any>} */
  const saida = {};
  if (tem('nome')) saida.nome = textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true });
  if (tem('codigo_frota')) saida.codigo_frota = codigoFrotaDoCorpo(entrada.codigo_frota);
  if (tem('propriedade')) {
    if (!PROPRIEDADES.includes(entrada.propriedade)) throw invalido('propriedade inválida', { field: 'propriedade', reason: 'propriedade_invalida' });
    saida.propriedade = entrada.propriedade;
  }
  for (const c of REFERENCIAS_DO_TOPO) if (tem(c)) saida[c] = entrada[c] ?? null;
  for (const c of TEXTOS_LIVRES) if (tem(c)) saida[c] = textoDoCorpo(entrada[c], c) ?? null;
  for (const c of /** @type {Array<keyof typeof ANOS>} */ (Object.keys(ANOS))) if (tem(c)) saida[c] = anoDoCorpo(entrada[c], c);
  if (tem('placa')) saida.placa = placaDoCorpo(entrada.placa);
  if (tem('placa_uf')) saida.placa_uf = ufDoCorpo(entrada.placa_uf);
  if (tem('renavam')) saida.renavam = renavamDoCorpo(entrada.renavam);
  if (tem('chassi')) saida.chassi = chassiDoCorpo(entrada.chassi);
  if (tem('potencia_cv')) saida.potencia_cv = potenciaDoCorpo(entrada.potencia_cv);
  // D-PROD-201: custo por hora ou km de uso (≥ 0; null limpa), snapshot na linha de máquina da atividade.
  if (tem('custo_uso_unitario')) saida.custo_uso_unitario = decimalDoCorpo(entrada.custo_uso_unitario, 'custo_uso_unitario', PADRAO_MEDIDA, CASAS_DAS_COLUNAS.custo_uso_unitario);
  return saida;
};

const preenchido = (v) => v !== null && v !== undefined && !(typeof v === 'string' && !v.trim()) && !(Array.isArray(v) && v.length === 0);

/**
 * Matriz de natureza (§2) sobre o CORPO: campo/bloco que a natureza não admite
 * só passa vazio (`null`, `''` ou `[]`). Medidor em benfeitoria → 422.
 * @param {string} natureza
 * @param {Record<string, any>} entrada
 */
export const exigirCamposAplicaveis = (natureza, entrada) => {
  for (const campos of Object.values(CAMPOS_POR_CAPACIDADE)) {
    for (const campo of campos) if (preenchido(entrada[campo]) && !campoAplicavel(natureza, campo)) throw naoAplicavel(campo, natureza);
  }
  if (regraDoMedidor(natureza) === MEDIDOR_PROIBIDO && entrada.medidor !== undefined && entrada.medidor !== null) throw naoAplicavel('medidor', natureza);
};

/**
 * A6: só bem de terceiro (≠ PROPRIO) tem parceiro proprietário; mudar para
 * PROPRIO exige limpar o proprietário no mesmo corpo.
 * @param {Record<string, any>} estado
 */
export const exigirProprietarioCoerente = (estado) => {
  if (estado.propriedade === 'PROPRIO' && estado.proprietario_parceiro_id) {
    throw new AppError('BEM_CAMPO_NAO_APLICAVEL', 'bem próprio não tem parceiro proprietário: limpe o proprietário; nada foi gravado', {
      details: { field: 'proprietario_parceiro_id', reason: 'bem_proprio', propriedade: 'PROPRIO' },
    });
  }
};

// ─── aquisição e depreciação ────────────────────────────────────────────────

/**
 * Bloco `aquisicao` → colunas. Presente SUBSTITUI o bloco (A6): campo omitido
 * vira null; `null` limpa tudo; ausente → undefined (mantém).
 * @param {Record<string, any>|null|undefined} bloco
 */
export const aquisicaoDoCorpo = (bloco) => {
  if (bloco === undefined) return undefined;
  const b = bloco ?? {};
  return {
    data_aquisicao: diaDoCorpo(b.data_aquisicao ?? null, 'aquisicao.data_aquisicao'),
    data_disponibilidade: diaDoCorpo(b.data_disponibilidade ?? null, 'aquisicao.data_disponibilidade'),
    valor_aquisicao: decimalDoCorpo(b.valor_aquisicao, 'aquisicao.valor_aquisicao', PADRAO_DINHEIRO, CASAS_DAS_COLUNAS.valor_aquisicao),
    custo_incorporacao: decimalDoCorpo(b.custo_incorporacao, 'aquisicao.custo_incorporacao', PADRAO_DINHEIRO, CASAS_DAS_COLUNAS.custo_incorporacao),
    fornecedor_parceiro_id: b.fornecedor_parceiro_id ?? null,
    documento_referencia: textoDoCorpo(b.documento_referencia, 'aquisicao.documento_referencia') ?? null,
    garantia_ate: diaDoCorpo(b.garantia_ate ?? null, 'aquisicao.garantia_ate'),
  };
};

/** Coluna de depreciação → caminho no corpo. */
const CAMPO_DE_DEPRECIACAO = Object.freeze({
  depreciacao_metodo: 'depreciacao.metodo',
  vida_util_meses: 'depreciacao.vida_util_meses',
  residual_modo: 'depreciacao.residual_modo',
  valor_residual: 'depreciacao.valor_residual',
  residual_percentual: 'depreciacao.residual_percentual',
  data_inicio_depreciacao: 'depreciacao.data_inicio_depreciacao',
});

/**
 * Bloco `depreciacao` → colunas (sempre traz `depreciavel`). `depreciavel:false`
 * limpa os parâmetros e recusa qualquer parâmetro não nulo no corpo (422
 * `DEPRECIACAO_PARAMETROS_INVALIDOS` reason `nao_depreciavel`). Com `true`, o
 * método omitido é LINEAR (o único). Ausente → undefined (mantém).
 * @param {Record<string, any>|undefined} bloco
 */
export const depreciacaoDoCorpo = (bloco) => {
  if (bloco === undefined) return undefined;
  const parametros = {
    depreciacao_metodo: bloco.metodo ?? null,
    vida_util_meses: bloco.vida_util_meses ?? null,
    residual_modo: bloco.residual_modo ?? null,
    valor_residual: decimalDoCorpo(bloco.valor_residual, 'depreciacao.valor_residual', PADRAO_DINHEIRO, CASAS_DAS_COLUNAS.valor_residual),
    residual_percentual: decimalDoCorpo(bloco.residual_percentual, 'depreciacao.residual_percentual', PADRAO_PERCENTUAL, CASAS_DAS_COLUNAS.residual_percentual),
    data_inicio_depreciacao: diaDoCorpo(bloco.data_inicio_depreciacao ?? null, 'depreciacao.data_inicio_depreciacao'),
  };
  if (bloco.depreciavel !== true) {
    const presente = Object.keys(parametros).find((c) => parametros[c] !== null);
    if (presente) throw parametrosInvalidos('bem não depreciável não leva parâmetros de depreciação', CAMPO_DE_DEPRECIACAO[presente], 'nao_depreciavel');
    return { depreciavel: false, ...parametros };
  }
  return { depreciavel: true, ...parametros, depreciacao_metodo: parametros.depreciacao_metodo ?? 'LINEAR' };
};

/** Campo da função de prévia (corpo da prévia) → caminho no corpo do bem. */
const CAMPO_NO_BEM = Object.freeze({
  valor_aquisicao: 'aquisicao.valor_aquisicao',
  custo_incorporacao: 'aquisicao.custo_incorporacao',
  ...CAMPO_DE_DEPRECIACAO,
});

/**
 * Prévia (§6) dos parâmetros GRAVADOS/finais do bem, ou null se não depreciável.
 * Os erros da função pura saem com o caminho do corpo do bem.
 * @param {Record<string, any>} estado
 */
export const previaDoEstado = (estado) => {
  if (!estado.depreciavel) return null;
  const decimal = (v) => (v === null || v === undefined ? null : dec(v));
  try {
    return simularDepreciacaoLinear({
      valor_aquisicao: decimal(estado.valor_aquisicao),
      custo_incorporacao: decimal(estado.custo_incorporacao),
      residual_modo: estado.residual_modo,
      valor_residual: decimal(estado.valor_residual),
      residual_percentual: decimal(estado.residual_percentual),
      vida_util_meses: estado.vida_util_meses,
      data_inicio_depreciacao: estado.data_inicio_depreciacao,
    });
  } catch (erro) {
    const campo = erro instanceof AppError ? erro.details?.field : null;
    if (erro instanceof AppError && typeof campo === 'string' && CAMPO_NO_BEM[campo]) {
      throw new AppError(erro.code, erro.message, { details: { ...erro.details, field: CAMPO_NO_BEM[campo] } });
    }
    throw erro;
  }
};

/**
 * Aquisição e depreciação sobre o ESTADO FINAL (A6), antes de gravar:
 *  - disponibilidade ≥ aquisição; início da depreciação ≥ (disponibilidade ?? aquisição);
 *  - depreciável exige bem PROPRIO (`DEPRECIACAO_BEM_NAO_PROPRIO`, sem limpeza
 *    automática), vida útil, início, valor de aquisição e o residual em UMA
 *    forma (`DEPRECIACAO_PARAMETROS_INVALIDOS`); vida fora de 1..1200 e
 *    residual acima do custo saem da função de prévia.
 * @param {Record<string, any>} estado
 * @returns {ReturnType<typeof simularDepreciacaoLinear>|null} a prévia dos parâmetros finais
 */
export const validarAquisicaoEDepreciacao = (estado) => {
  if (estado.data_aquisicao && estado.data_disponibilidade && estado.data_disponibilidade < estado.data_aquisicao) {
    throw dataInvalida('a data de disponibilidade não pode ser anterior à data de aquisição', 'aquisicao.data_disponibilidade', 'antes_da_aquisicao');
  }
  if (!estado.depreciavel) return null;
  if (estado.propriedade !== 'PROPRIO') {
    throw new AppError('DEPRECIACAO_BEM_NAO_PROPRIO', 'só bem próprio tem depreciação; desligue a depreciação antes de mudar a propriedade; nada foi gravado', {
      details: { field: 'depreciacao.depreciavel', reason: 'bem_nao_proprio', propriedade: estado.propriedade },
    });
  }
  if (estado.vida_util_meses === null) throw parametrosInvalidos('informe a vida útil em meses', 'depreciacao.vida_util_meses', 'obrigatorio');
  if (estado.data_inicio_depreciacao === null) throw parametrosInvalidos('informe a data de início da depreciação', 'depreciacao.data_inicio_depreciacao', 'obrigatorio');
  if (estado.valor_aquisicao === null) throw parametrosInvalidos('bem depreciável precisa do valor de aquisição', 'aquisicao.valor_aquisicao', 'obrigatorio');
  if (estado.residual_modo === null) throw parametrosInvalidos('informe o residual por VALOR ou por PERCENTUAL', 'depreciacao.residual_modo', 'obrigatorio');
  const base = estado.data_disponibilidade ?? estado.data_aquisicao;
  if (base && estado.data_inicio_depreciacao < base) {
    throw dataInvalida(
      'o início da depreciação não pode ser anterior à disponibilidade (ou à aquisição) do bem',
      'depreciacao.data_inicio_depreciacao',
      'antes_da_disponibilidade'
    );
  }
  return previaDoEstado(estado);
};

// ─── medidor (A2) ───────────────────────────────────────────────────────────

const SEM_LEITURA = Object.freeze({
  medidor_unidade: null,
  medidor_leitura_inicial: null,
  medidor_leitura_atual: null,
  medidor_data_leitura: null,
  medidor_origem: null,
});

const medidorObrigatorio = (natureza) =>
  new AppError('MEDIDOR_OBRIGATORIO', 'esta natureza de bem exige medidor (pode ser "sem medidor"); nada foi gravado', {
    details: { field: 'medidor', reason: 'obrigatorio', natureza },
  });
const tipoImutavel = (tipoAtual) =>
  new AppError('MEDIDOR_TIPO_IMUTAVEL', 'o medidor já tem leitura ajustada: o tipo não muda mais (troca de painel é operação futura); nada foi gravado', {
    details: { field: 'medidor.tipo', reason: 'medidor_com_ajuste', tipo_atual: tipoAtual },
  });

/** Correção de cadastro (A2): só enquanto a leitura é a do cadastro inicial, sem ajuste. */
const corrigivel = (e) => e.medidor_origem === 'CADASTRO_INICIAL' && dec(e.medidor_leitura_atual).eq(dec(e.medidor_leitura_inicial));

/** @param {unknown} valor @param {string} campo @returns {string|null} 4 casas */
const leituraDoCorpo = (valor, campo) => {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string' || !PADRAO_MEDIDA.test(valor)) throw leituraInvalida('a leitura deve ser um número não negativo com até 4 casas', campo, 'formato');
  return dec(valor).toFixed(CASAS_DAS_COLUNAS.medidor_leitura_inicial);
};

const contador = (tipo, inicial, atual, data, origem) => ({
  medidor_tipo: tipo,
  medidor_unidade: UNIDADE_DO_MEDIDOR[tipo],
  medidor_leitura_inicial: inicial,
  medidor_leitura_atual: atual,
  medidor_data_leitura: data,
  medidor_origem: origem,
});

/**
 * Transição do medidor (A2). Devolve as colunas novas do medidor (só as que o
 * pedido define) ou null quando nada muda, e se é CORREÇÃO de cadastro
 * (auditada como `bem_patrimonial.corrigir_medidor`).
 *
 *  - BENFEITORIA: medidor não nulo → 422 `BEM_CAMPO_NAO_APLICAVEL`;
 *  - MAQUINA/VEICULO/EQUIPAMENTO: criação sem medidor ou PATCH `null` → 422 `MEDIDOR_OBRIGATORIO`;
 *  - NULL ↔ SEM_MEDIDOR (IMPLEMENTO/OUTRO); SEM_MEDIDOR não leva leitura;
 *  - NULL/SEM_MEDIDOR → contador: `leitura_inicial` e `data_leitura` (≤ hoje
 *    da fazenda) obrigatórias; atual = inicial; origem CADASTRO_INICIAL;
 *  - contador → outro tipo ou `null`: 409 `MEDIDOR_TIPO_IMUTAVEL`; `leitura_inicial`
 *    diferente: 409 `MEDIDOR_LEITURA_INICIAL_IMUTAVEL` — EXCETO correção de
 *    cadastro (origem CADASTRO_INICIAL e atual = inicial);
 *  - ajuste: `leitura_atual` nova exige `data_leitura` no corpo; menor que a
 *    atual → 422 `MEDIDOR_LEITURA_REGRESSIVA`; data anterior → 422
 *    `MEDIDOR_DATA_REGRESSIVA`; futura → 422 `MEDIDOR_DATA_FUTURA`; origem
 *    passa a AJUSTE_CADASTRO. Mesma leitura e mesma data → nada muda.
 * No bloco do PATCH, `leitura_inicial`/`leitura_atual`/`data_leitura` omitidas
 * num contador do MESMO tipo valem "como está".
 *
 * `estado` é o estado ATUAL (na criação, `ESTADO_NOVO`); `hoje` devolve o
 * "hoje" da fazenda (lança `EMPRESA_FUSO_NAO_CONFIGURADO` sem fuso) e só é
 * chamado quando uma data de leitura precisa ser conferida.
 *
 * D-PROD-159 (X2): `piso` = maior leitura de abastecimento CONFIRMADO do bem
 * (`{leitura, data, abastecimento_id}`) ou null. D-PROD-201: ou da linha de
 * máquina confirmada do Lançamento de Atividades (`origem: 'ATIVIDADE'`,
 * `linha_maquina_id`), a que for maior. Com piso o medidor deixa de ser
 * corrigível (tipo e leitura inicial imutáveis) e o ajuste não pode ficar abaixo
 * da leitura nem antes da data do piso. Sem `piso`: idêntico ao comportamento P1-01.
 *
 * @param {{ natureza: string, estado: Record<string, any>, pedido: Record<string, any>|null|undefined, criacao: boolean,
 *   hoje: () => Promise<string>, piso?: { leitura: string, data: string, abastecimento_id: string|null, origem?: string, linha_maquina_id?: string }|null }} entrada
 * @returns {Promise<{ colunas: Record<string, any>|null, correcao: boolean }>}
 */
export const decidirMedidor = async ({ natureza, estado, pedido, criacao, hoje, piso = null }) => {
  const regra = regraDoMedidor(natureza);
  const nada = { colunas: null, correcao: false };
  if (regra === MEDIDOR_PROIBIDO) {
    if (pedido !== undefined && pedido !== null) throw naoAplicavel('medidor', natureza);
    return nada;
  }
  if (pedido === undefined && !criacao) return nada;
  const naoFutura = async (data) => {
    const dia = await hoje();
    if (data > dia) {
      throw new AppError('MEDIDOR_DATA_FUTURA', `a data da leitura (${data}) é posterior a hoje na fazenda (${dia}); nada foi gravado`, {
        details: { field: 'medidor.data_leitura', reason: 'data_futura', hoje: dia },
      });
    }
  };
  const tipoAtual = estado.medidor_tipo;
  const temContador = tipoAtual !== null && tipoAtual !== 'SEM_MEDIDOR';
  const semMedidor = { medidor_tipo: 'SEM_MEDIDOR', ...SEM_LEITURA };
  // D-PROD-159 (X2): com leitura operacional (abastecimento CONFIRMADO com leitura) o medidor deixa de ser
  // corrigível (tipo e leitura inicial imutáveis) e o ajuste respeita o piso. Sem `piso`: idêntico ao atual.
  const podeCorrigirAgora = corrigivel(estado) && !piso;
  const imutavel = () =>
    !corrigivel(estado)
      ? tipoImutavel(tipoAtual)
      : new AppError('MEDIDOR_TIPO_IMUTAVEL', 'o medidor já tem leitura registrada por abastecimento: o tipo não muda; nada foi gravado', {
          details: { field: 'medidor.tipo', reason: 'medidor_com_abastecimento', tipo_atual: tipoAtual },
        });

  if (pedido === undefined || pedido === null) {
    if (regra === MEDIDOR_OBRIGATORIO) throw medidorObrigatorio(natureza);
    if (tipoAtual === null) return nada;
    if (!temContador) return { colunas: { medidor_tipo: null, ...SEM_LEITURA }, correcao: false };
    if (!podeCorrigirAgora) throw imutavel();
    return { colunas: { medidor_tipo: null, ...SEM_LEITURA }, correcao: true };
  }

  const tipo = pedido.tipo;
  const inicialPedida = leituraDoCorpo(pedido.leitura_inicial, 'medidor.leitura_inicial');
  const atualPedida = leituraDoCorpo(pedido.leitura_atual, 'medidor.leitura_atual');
  const dataPedida = diaDoCorpo(pedido.data_leitura ?? null, 'medidor.data_leitura');

  if (tipo === 'SEM_MEDIDOR') {
    if (inicialPedida !== null || atualPedida !== null || dataPedida !== null) {
      throw leituraInvalida('"sem medidor" não tem leitura nem data', inicialPedida !== null ? 'medidor.leitura_inicial' : atualPedida !== null ? 'medidor.leitura_atual' : 'medidor.data_leitura', 'sem_medidor');
    }
    if (tipoAtual === 'SEM_MEDIDOR') return nada;
    if (!temContador) return { colunas: semMedidor, correcao: false };
    if (!podeCorrigirAgora) throw imutavel();
    return { colunas: semMedidor, correcao: true };
  }

  /** Contador novo (do zero ou por correção): inicial e data obrigatórias, atual = inicial. */
  const contadorNovo = async () => {
    if (inicialPedida === null) throw leituraInvalida('informe a leitura inicial do medidor', 'medidor.leitura_inicial', 'obrigatoria');
    if (dataPedida === null) throw leituraInvalida('informe a data da leitura do medidor', 'medidor.data_leitura', 'obrigatoria');
    if (atualPedida !== null && !dec(atualPedida).eq(dec(inicialPedida))) {
      throw leituraInvalida('no cadastro do medidor a leitura atual é a própria leitura inicial', 'medidor.leitura_atual', 'atual_diferente_da_inicial');
    }
    await naoFutura(dataPedida);
    return contador(tipo, inicialPedida, inicialPedida, dataPedida, 'CADASTRO_INICIAL');
  };

  if (!temContador) return { colunas: await contadorNovo(), correcao: false };

  const podeCorrigir = podeCorrigirAgora;
  if (tipo !== tipoAtual) {
    if (!podeCorrigir) throw imutavel();
    return { colunas: await contadorNovo(), correcao: true };
  }

  const inicial = inicialPedida ?? estado.medidor_leitura_inicial;
  if (!dec(inicial).eq(dec(estado.medidor_leitura_inicial))) {
    if (!podeCorrigir) {
      throw new AppError('MEDIDOR_LEITURA_INICIAL_IMUTAVEL', 'a leitura inicial não muda depois de um ajuste de leitura; nada foi gravado', {
        details: {
          field: 'medidor.leitura_inicial',
          reason: piso && corrigivel(estado) ? 'medidor_com_abastecimento' : 'medidor_com_ajuste',
          leitura_inicial: estado.medidor_leitura_inicial,
        },
      });
    }
    if (atualPedida !== null && !dec(atualPedida).eq(dec(inicial))) {
      throw leituraInvalida('na correção do cadastro a leitura atual é a própria leitura inicial', 'medidor.leitura_atual', 'atual_diferente_da_inicial');
    }
    const data = dataPedida ?? estado.medidor_data_leitura;
    await naoFutura(data);
    return { colunas: contador(tipo, inicial, inicial, data, 'CADASTRO_INICIAL'), correcao: true };
  }

  const novaAtual = atualPedida ?? estado.medidor_leitura_atual;
  const data = dataPedida ?? estado.medidor_data_leitura;
  const mesmaLeitura = dec(novaAtual).eq(dec(estado.medidor_leitura_atual));
  if (mesmaLeitura && data === estado.medidor_data_leitura) return nada;
  if (!mesmaLeitura && dataPedida === null) throw leituraInvalida('informe a data da nova leitura', 'medidor.data_leitura', 'obrigatoria');
  if (podeCorrigir && mesmaLeitura) {
    // Só a data da leitura do cadastro inicial muda: correção de cadastro.
    await naoFutura(data);
    return { colunas: { medidor_data_leitura: data }, correcao: true };
  }
  if (dec(novaAtual).lt(dec(estado.medidor_leitura_atual))) {
    throw new AppError('MEDIDOR_LEITURA_REGRESSIVA', `a leitura informada é menor que a registrada (${estado.medidor_leitura_atual}); nada foi gravado`, {
      details: { field: 'medidor.leitura_atual', reason: 'leitura_regressiva', leitura_atual: estado.medidor_leitura_atual },
    });
  }
  if (data < estado.medidor_data_leitura) {
    throw new AppError('MEDIDOR_DATA_REGRESSIVA', `a data da leitura é anterior à da leitura registrada (${estado.medidor_data_leitura}); nada foi gravado`, {
      details: { field: 'medidor.data_leitura', reason: 'data_regressiva', data_leitura: estado.medidor_data_leitura },
    });
  }
  // D-PROD-201: o piso pode vir de uma linha de máquina do Lançamento de Atividades.
  const daAtividade = piso?.origem === 'ATIVIDADE';
  const registradaPor = daAtividade ? 'por lançamento de atividade' : 'por abastecimento';
  const referencia = piso
    ? { origem_referencia: daAtividade ? 'ATIVIDADE' : 'ABASTECIMENTO', abastecimento_id: piso.abastecimento_id ?? null, ...(daAtividade ? { linha_maquina_id: piso.linha_maquina_id ?? null } : {}) }
    : {};
  if (piso && dec(novaAtual).lt(dec(piso.leitura))) {
    throw new AppError('MEDIDOR_LEITURA_REGRESSIVA', `a leitura informada é menor que a registrada ${registradaPor} (${piso.leitura}); nada foi gravado`, {
      details: { field: 'medidor.leitura_atual', reason: 'leitura_regressiva', leitura_atual: piso.leitura, ...referencia },
    });
  }
  if (piso && data < piso.data) {
    throw new AppError('MEDIDOR_DATA_REGRESSIVA', `a data da leitura é anterior à leitura registrada ${registradaPor} (${piso.data}); nada foi gravado`, {
      details: { field: 'medidor.data_leitura', reason: 'data_regressiva', data_leitura: piso.data, ...referencia },
    });
  }
  await naoFutura(data);
  return { colunas: { medidor_leitura_atual: novaAtual, medidor_data_leitura: data, medidor_origem: 'AJUSTE_CADASTRO' }, correcao: false };
};

/** Medidor do estado para a resposta/auditoria (`null` quando o bem não tem medidor). */
export const medidorDoEstado = (e) =>
  e.medidor_tipo === null
    ? null
    : {
        tipo: e.medidor_tipo,
        unidade: e.medidor_unidade,
        leitura_inicial: e.medidor_leitura_inicial,
        leitura_atual: e.medidor_leitura_atual,
        data_leitura: e.medidor_data_leitura,
        origem: e.medidor_origem,
      };
