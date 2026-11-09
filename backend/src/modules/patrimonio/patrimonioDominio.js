/**
 * D-PROD-157 — domínios FECHADOS do Patrimônio e Frota (P1-01).
 *
 * O servidor é a fonte: o navegador espelha só os RÓTULOS. Cada lista aqui tem
 * o seu CHECK na migration `20261110100000_patrimonio_p1_01_cadastros` (sem
 * enum Prisma); mudar uma lista exige migration nova.
 */

export const NATUREZAS = Object.freeze(['BENFEITORIA', 'MAQUINA', 'VEICULO', 'IMPLEMENTO', 'EQUIPAMENTO', 'OUTRO']);

/** Regra do medidor por natureza (CHECK `BemPatrimonial_medidor_natureza_check`). */
export const MEDIDOR_OBRIGATORIO = 'OBRIGATORIO';
export const MEDIDOR_OPCIONAL = 'OPCIONAL';
export const MEDIDOR_PROIBIDO = 'PROIBIDO';

/**
 * Matriz de capacidades por natureza (contrato §2). Campo ou bloco enviado para
 * natureza que não o admite → 422 `BEM_CAMPO_NAO_APLICAVEL` (`null`/`[]` é aceito
 * e não grava nada). Nada é obrigatório "por documento": placa, chassi e
 * renavam são sempre opcionais.
 * @type {Readonly<Record<string, Readonly<{ medicoes: boolean, medidor: string, tanques: boolean,
 *   identificacao_veicular: boolean, chassi: boolean, numero_serie: boolean, potencia_cv: boolean,
 *   construcao: boolean, compatibilidade: boolean }>>>}
 */
export const CAPACIDADES_POR_NATUREZA = Object.freeze({
  BENFEITORIA: Object.freeze({ medicoes: true, medidor: MEDIDOR_PROIBIDO, tanques: false, identificacao_veicular: false, chassi: false, numero_serie: false, potencia_cv: false, construcao: true, compatibilidade: false }),
  MAQUINA: Object.freeze({ medicoes: false, medidor: MEDIDOR_OBRIGATORIO, tanques: true, identificacao_veicular: false, chassi: true, numero_serie: true, potencia_cv: true, construcao: false, compatibilidade: false }),
  VEICULO: Object.freeze({ medicoes: false, medidor: MEDIDOR_OBRIGATORIO, tanques: true, identificacao_veicular: true, chassi: true, numero_serie: true, potencia_cv: true, construcao: false, compatibilidade: false }),
  IMPLEMENTO: Object.freeze({ medicoes: false, medidor: MEDIDOR_OPCIONAL, tanques: false, identificacao_veicular: false, chassi: false, numero_serie: true, potencia_cv: false, construcao: false, compatibilidade: true }),
  EQUIPAMENTO: Object.freeze({ medicoes: false, medidor: MEDIDOR_OBRIGATORIO, tanques: true, identificacao_veicular: false, chassi: false, numero_serie: true, potencia_cv: true, construcao: false, compatibilidade: false }),
  OUTRO: Object.freeze({ medicoes: false, medidor: MEDIDOR_OPCIONAL, tanques: false, identificacao_veicular: false, chassi: false, numero_serie: true, potencia_cv: false, construcao: false, compatibilidade: false }),
});

/** Campos (ou blocos) do corpo do bem governados por cada capacidade booleana da matriz. */
export const CAMPOS_POR_CAPACIDADE = Object.freeze({
  medicoes: Object.freeze(['medicoes']),
  tanques: Object.freeze(['tanques']),
  identificacao_veicular: Object.freeze(['placa', 'placa_uf', 'renavam']),
  chassi: Object.freeze(['chassi']),
  numero_serie: Object.freeze(['numero_serie']),
  potencia_cv: Object.freeze(['potencia_cv']),
  construcao: Object.freeze(['material', 'ano_conclusao']),
  compatibilidade: Object.freeze(['compatibilidade']),
});

/**
 * O campo do corpo se aplica à natureza? Campo fora da matriz (nome, marca,
 * aquisição...) vale para todas. O medidor segue `regraDoMedidor`.
 * @param {string} natureza
 * @param {string} campo
 */
export const campoAplicavel = (natureza, campo) => {
  const capacidades = CAPACIDADES_POR_NATUREZA[natureza];
  if (!capacidades) return false;
  for (const [capacidade, campos] of Object.entries(CAMPOS_POR_CAPACIDADE)) {
    if (campos.includes(campo)) return capacidades[capacidade] === true;
  }
  return true;
};

/** @param {string} natureza @returns {string|null} OBRIGATORIO | OPCIONAL | PROIBIDO */
export const regraDoMedidor = (natureza) => CAPACIDADES_POR_NATUREZA[natureza]?.medidor ?? null;

export const MEDIDOR_TIPOS = Object.freeze(['SEM_MEDIDOR', 'HORIMETRO', 'ODOMETRO', 'CICLOS']);
/** Unidade FIXA de cada medidor (CHECK `BemPatrimonial_medidor_check`); SEM_MEDIDOR não tem leitura. */
export const UNIDADE_DO_MEDIDOR = Object.freeze({ SEM_MEDIDOR: null, HORIMETRO: 'h', ODOMETRO: 'km', CICLOS: 'ciclos' });
export const MEDIDOR_ORIGENS = Object.freeze(['CADASTRO_INICIAL', 'AJUSTE_CADASTRO']);

export const PROPRIEDADES = Object.freeze(['PROPRIO', 'TERCEIRO', 'ARRENDADO', 'CEDIDO']);

/**
 * Dimensões físicas: unidade canônica e unidades aceitas, com fator EXATO
 * (string) para a canônica. Conversão só dentro da dimensão.
 */
export const DIMENSOES = Object.freeze({
  EXTENSAO: Object.freeze({ canonica: 'm', unidades: Object.freeze(['m', 'km']) }),
  AREA: Object.freeze({ canonica: 'm2', unidades: Object.freeze(['m2', 'ha']) }),
  VOLUME: Object.freeze({ canonica: 'L', unidades: Object.freeze(['L', 'm3']) }),
  MASSA: Object.freeze({ canonica: 'kg', unidades: Object.freeze(['kg', 't']) }),
  QUANTIDADE: Object.freeze({ canonica: 'un', unidades: Object.freeze(['un']) }),
  CABECAS: Object.freeze({ canonica: 'cab', unidades: Object.freeze(['cab']) }),
});
export const NOMES_DIMENSOES = Object.freeze(Object.keys(DIMENSOES));
/** Dimensões em que a medida é contagem (valor inteiro). */
export const DIMENSOES_INTEIRAS = Object.freeze(['QUANTIDADE', 'CABECAS']);

/** Unidade física → dimensão, fator exato para a canônica e rótulo pt-BR. */
export const UNIDADES_FISICAS = Object.freeze({
  m: Object.freeze({ dimensao: 'EXTENSAO', fator: '1', rotulo: 'metros' }),
  km: Object.freeze({ dimensao: 'EXTENSAO', fator: '1000', rotulo: 'quilômetros' }),
  m2: Object.freeze({ dimensao: 'AREA', fator: '1', rotulo: 'm²' }),
  ha: Object.freeze({ dimensao: 'AREA', fator: '10000', rotulo: 'hectares' }),
  L: Object.freeze({ dimensao: 'VOLUME', fator: '1', rotulo: 'litros' }),
  m3: Object.freeze({ dimensao: 'VOLUME', fator: '1000', rotulo: 'm³' }),
  kg: Object.freeze({ dimensao: 'MASSA', fator: '1', rotulo: 'quilogramas' }),
  t: Object.freeze({ dimensao: 'MASSA', fator: '1000', rotulo: 'toneladas' }),
  un: Object.freeze({ dimensao: 'QUANTIDADE', fator: '1', rotulo: 'unidades' }),
  cab: Object.freeze({ dimensao: 'CABECAS', fator: '1', rotulo: 'cabeças' }),
});
export const NOMES_UNIDADES_FISICAS = Object.freeze(Object.keys(UNIDADES_FISICAS));

export const FINALIDADES_PERFIL = Object.freeze(['DIMENSAO', 'CAPACIDADE']);

/** Unidade do combustível (grafia `m3` em todo o domínio; rótulo "m³"). */
export const UNIDADES_COMBUSTIVEL = Object.freeze(['L', 'm3']);
/** Tanque só aceita combustível medido em litros neste slice (GNV fica no catálogo sem tanque). */
export const UNIDADE_COMBUSTIVEL_DO_TANQUE = 'L';

export const RESIDUAL_MODOS = Object.freeze(['VALOR', 'PERCENTUAL']);
export const METODOS_DEPRECIACAO = Object.freeze(['LINEAR']);
export const VIDA_UTIL_MINIMA_MESES = 1;
export const VIDA_UTIL_MAXIMA_MESES = 1200;

export const UFS = Object.freeze([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

/** Código de catálogo (família, tipo, perfil, combustível): CHECK `*_codigo_check`. */
export const PADRAO_CODIGO_CATALOGO = /^[A-Z0-9_]{2,32}$/;
/** Código de frota normalizado (CHECK `BemPatrimonial_codigo_frota_check`). */
export const PADRAO_CODIGO_FROTA = /^[A-Z0-9]+([ -][A-Z0-9]+)*$/;
/** Placa antiga (ABC1234) ou Mercosul (ABC1D23), já sem hífen/espaços e em maiúsculas. */
export const PADRAO_PLACA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
export const PADRAO_CHASSI = /^[A-HJ-NPR-Z0-9]{17}$/;
export const PADRAO_RENAVAM = /^\d{9,11}$/;

/** Limites por agregado. */
export const MAX_PERFIS_POR_TIPO = 10;
export const MAX_MEDICOES_POR_BEM = 20;
/** Conta só tanques ATIVOS; o identificador de tanque inativo continua reservado. */
export const MAX_TANQUES_ATIVOS_POR_BEM = 10;

/** Faixas inteiras do cadastro (CHECKs da migration). */
export const FAIXA_ORDEM_FAMILIA = Object.freeze({ min: 0, max: 9999 });
export const FAIXA_ANO_FABRICACAO = Object.freeze({ min: 1900, max: 2100 });
export const FAIXA_ANO_MODELO = Object.freeze({ min: 1900, max: 2101 });
export const FAIXA_ANO_CONCLUSAO = Object.freeze({ min: 1800, max: 2100 });
