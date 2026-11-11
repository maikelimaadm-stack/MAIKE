/**
 * D-PROD-157 — domínios FECHADOS do Patrimônio e Frota (P1-01; D-PROD-162).
 *
 * O servidor é a fonte: o navegador espelha só os RÓTULOS. Cada lista aqui tem
 * o seu CHECK na migration (P1-01 `20261110100000_patrimonio_p1_01_cadastros`,
 * recriada pela D-PROD-162 `20261110300000_patrimonio_simplifica`; sem enum
 * Prisma); mudar uma lista exige migration nova.
 *
 * D-PROD-162: saem perfis de medição, medições físicas, catálogo de
 * combustíveis e fator kg/L. D-PROD-169: cada tanque aceita Produtos do
 * estoque em qualquer unidade (L, KG ou SACO); o abastecimento é em L ou KG.
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
 * @type {Readonly<Record<string, Readonly<{ medidor: string, tanques: boolean,
 *   identificacao_veicular: boolean, chassi: boolean, numero_serie: boolean, potencia_cv: boolean,
 *   construcao: boolean, compatibilidade: boolean }>>>}
 */
export const CAPACIDADES_POR_NATUREZA = Object.freeze({
  BENFEITORIA: Object.freeze({ medidor: MEDIDOR_PROIBIDO, tanques: false, identificacao_veicular: false, chassi: false, numero_serie: false, potencia_cv: false, construcao: true, compatibilidade: false }),
  MAQUINA: Object.freeze({ medidor: MEDIDOR_OBRIGATORIO, tanques: true, identificacao_veicular: false, chassi: true, numero_serie: true, potencia_cv: true, construcao: false, compatibilidade: false }),
  VEICULO: Object.freeze({ medidor: MEDIDOR_OBRIGATORIO, tanques: true, identificacao_veicular: true, chassi: true, numero_serie: true, potencia_cv: true, construcao: false, compatibilidade: false }),
  IMPLEMENTO: Object.freeze({ medidor: MEDIDOR_OPCIONAL, tanques: false, identificacao_veicular: false, chassi: false, numero_serie: true, potencia_cv: false, construcao: false, compatibilidade: true }),
  EQUIPAMENTO: Object.freeze({ medidor: MEDIDOR_OBRIGATORIO, tanques: true, identificacao_veicular: false, chassi: false, numero_serie: true, potencia_cv: true, construcao: false, compatibilidade: false }),
  OUTRO: Object.freeze({ medidor: MEDIDOR_OPCIONAL, tanques: false, identificacao_veicular: false, chassi: false, numero_serie: true, potencia_cv: false, construcao: false, compatibilidade: false }),
});

/** Campos (ou blocos) do corpo do bem governados por cada capacidade booleana da matriz. */
export const CAMPOS_POR_CAPACIDADE = Object.freeze({
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

export const RESIDUAL_MODOS = Object.freeze(['VALOR', 'PERCENTUAL']);
export const METODOS_DEPRECIACAO = Object.freeze(['LINEAR']);
export const VIDA_UTIL_MINIMA_MESES = 1;
export const VIDA_UTIL_MAXIMA_MESES = 1200;

export const UFS = Object.freeze([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

/** Código de catálogo (família, tipo): CHECK `*_codigo_check`. */
export const PADRAO_CODIGO_CATALOGO = /^[A-Z0-9_]{2,32}$/;
/** Código de frota normalizado (CHECK `BemPatrimonial_codigo_frota_check`). */
export const PADRAO_CODIGO_FROTA = /^[A-Z0-9]+([ -][A-Z0-9]+)*$/;
/** Placa antiga (ABC1234) ou Mercosul (ABC1D23), já sem hífen/espaços e em maiúsculas. */
export const PADRAO_PLACA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
export const PADRAO_CHASSI = /^[A-HJ-NPR-Z0-9]{17}$/;
export const PADRAO_RENAVAM = /^\d{9,11}$/;

/** Limites por agregado. */
/** Conta só tanques ATIVOS; o identificador de tanque inativo continua reservado. */
export const MAX_TANQUES_ATIVOS_POR_BEM = 10;
/** D-PROD-162 (P-02) — Produtos aceitos ATIVOS por tanque (o mesmo teto do antigo `combustivel_ids`). */
export const MAX_PRODUTOS_POR_TANQUE = 20;
/**
 * D-PROD-162 — unidades do ABASTECIMENTO (`AbastecimentoBem.unidade`, CHECK do
 * banco): a unidade EFETIVA do estoque do Produto. O abastecimento baixa
 * exatamente a quantidade digitada nessa unidade, sem conversão. A capacidade
 * do tanque (litros) só é conferida para Produto em L.
 */
export const UNIDADES_ABASTECIMENTO = Object.freeze(['L', 'KG']);
/**
 * D-PROD-169 (SIMPLIFICA-02) — unidades de estoque do Produto que um tanque
 * ACEITA: qualquer unidade do cadastro de Produtos (L, KG e SACO). SACO guarda
 * estoque em kg (`estoqueFisicoMotor.js`), então abastece em KG.
 */
export const UNIDADES_PRODUTO_TANQUE = Object.freeze(['L', 'KG', 'SACO']);
/**
 * Unidade EFETIVA do estoque do Produto (a do abastecimento): `L` para L; `KG`
 * para KG e SACO; `null` para unidade que o tanque não aceita.
 * @param {unknown} u  `Produto.unidade_principal_estoque`
 * @returns {'L'|'KG'|null}
 */
export const unidadeEfetivaDoEstoque = (u) => (u === 'L' ? 'L' : u === 'KG' || u === 'SACO' ? 'KG' : null);

/** Rótulo pt-BR do "Tipo de bem" (natureza) nas mensagens do servidor (o navegador tem os seus). */
export const ROTULO_NATUREZA = Object.freeze({
  BENFEITORIA: 'Benfeitoria',
  MAQUINA: 'Máquina',
  VEICULO: 'Veículo',
  IMPLEMENTO: 'Implemento',
  EQUIPAMENTO: 'Equipamento',
  OUTRO: 'Outro',
});

/** Faixas inteiras do cadastro (CHECKs da migration). */
export const FAIXA_ORDEM_FAMILIA = Object.freeze({ min: 0, max: 9999 });
export const FAIXA_ANO_FABRICACAO = Object.freeze({ min: 1900, max: 2100 });
export const FAIXA_ANO_MODELO = Object.freeze({ min: 1900, max: 2101 });
export const FAIXA_ANO_CONCLUSAO = Object.freeze({ min: 1800, max: 2100 });
