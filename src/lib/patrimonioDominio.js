/**
 * Patrimônio e Frota (D-PROD-156) — espelho dos domínios fechados do servidor
 * (`backend/src/modules/patrimonio/patrimonioDominio.js`) só para EXIBIR:
 * rótulos em português, unidades por dimensão e a matriz de capacidades por
 * natureza (quais seções/campos o formulário mostra). Quem valida é o servidor
 * (422 `BEM_CAMPO_NAO_APLICAVEL` etc.); nada aqui decide gravação.
 */

export const NATUREZAS_PATRIMONIO = Object.freeze(['BENFEITORIA', 'MAQUINA', 'VEICULO', 'IMPLEMENTO', 'EQUIPAMENTO', 'OUTRO']);

export const ROTULO_NATUREZA = Object.freeze({
  BENFEITORIA: 'Benfeitoria',
  MAQUINA: 'Máquina',
  VEICULO: 'Veículo',
  IMPLEMENTO: 'Implemento',
  EQUIPAMENTO: 'Equipamento',
  OUTRO: 'Outro',
});

/** @param {unknown} v @returns {v is 'BENFEITORIA'|'MAQUINA'|'VEICULO'|'IMPLEMENTO'|'EQUIPAMENTO'|'OUTRO'} */
export const ehNatureza = (v) => typeof v === 'string' && NATUREZAS_PATRIMONIO.includes(v);

// ─── Medidas físicas (benfeitorias) ──────────────────────────────────────

export const DIMENSOES = Object.freeze(['EXTENSAO', 'AREA', 'VOLUME', 'MASSA', 'QUANTIDADE', 'CABECAS']);

export const ROTULO_DIMENSAO = Object.freeze({
  EXTENSAO: 'Extensão',
  AREA: 'Área',
  VOLUME: 'Volume',
  MASSA: 'Massa',
  QUANTIDADE: 'Quantidade',
  CABECAS: 'Cabeças',
});

/** Unidades aceitas em cada dimensão, a canônica primeiro (conversão só dentro da dimensão). */
export const UNIDADES_DA_DIMENSAO = Object.freeze({
  EXTENSAO: Object.freeze(['m', 'km']),
  AREA: Object.freeze(['m2', 'ha']),
  VOLUME: Object.freeze(['L', 'm3']),
  MASSA: Object.freeze(['kg', 't']),
  QUANTIDADE: Object.freeze(['un']),
  CABECAS: Object.freeze(['cab']),
});

/** Unidade canônica da dimensão (derivada no servidor; nunca vai no corpo). */
export const UNIDADE_CANONICA = Object.freeze({
  EXTENSAO: 'm',
  AREA: 'm2',
  VOLUME: 'L',
  MASSA: 'kg',
  QUANTIDADE: 'un',
  CABECAS: 'cab',
});

/** Dimensões contadas em número inteiro (422 `MEDICAO_VALOR_INVALIDO` reason `deve_ser_inteiro`). */
export const DIMENSOES_INTEIRAS = Object.freeze(['QUANTIDADE', 'CABECAS']);

export const ROTULO_UNIDADE = Object.freeze({
  m: 'metros',
  km: 'quilômetros',
  m2: 'm²',
  ha: 'hectares',
  L: 'litros',
  m3: 'm³',
  kg: 'quilogramas',
  t: 'toneladas',
  un: 'unidades',
  cab: 'cabeças',
});

/** Símbolo curto para valores ("1.250 m", "3 ha"). */
export const SIMBOLO_UNIDADE = Object.freeze({
  m: 'm',
  km: 'km',
  m2: 'm²',
  ha: 'ha',
  L: 'L',
  m3: 'm³',
  kg: 'kg',
  t: 't',
  un: 'un',
  cab: 'cab',
});

/** @param {unknown} dimensao @returns {readonly string[]} */
export const unidadesDaDimensao = (dimensao) =>
  typeof dimensao === 'string' && Object.prototype.hasOwnProperty.call(UNIDADES_DA_DIMENSAO, dimensao)
    ? UNIDADES_DA_DIMENSAO[/** @type {keyof typeof UNIDADES_DA_DIMENSAO} */ (dimensao)]
    : [];

/** @param {unknown} dimensao @returns {string|null} */
export const unidadeCanonicaDa = (dimensao) =>
  typeof dimensao === 'string' && Object.prototype.hasOwnProperty.call(UNIDADE_CANONICA, dimensao)
    ? UNIDADE_CANONICA[/** @type {keyof typeof UNIDADE_CANONICA} */ (dimensao)]
    : null;

/** "metros (m)", "hectares (ha)". @param {string} unidade */
export const rotuloDaUnidade = (unidade) => {
  const nome = /** @type {Record<string, string>} */ (ROTULO_UNIDADE)[unidade];
  const simbolo = /** @type {Record<string, string>} */ (SIMBOLO_UNIDADE)[unidade];
  if (!nome) return unidade;
  return nome === simbolo ? nome : `${nome} (${simbolo})`;
};

export const FINALIDADES_PERFIL = Object.freeze(['DIMENSAO', 'CAPACIDADE']);

export const ROTULO_FINALIDADE = Object.freeze({
  DIMENSAO: 'Dimensão (tamanho do bem)',
  CAPACIDADE: 'Capacidade (o que o bem comporta)',
});

// ─── Combustíveis ────────────────────────────────────────────────────────

/** Grafia `m3` em todo o domínio (A9); o tanque só aceita combustível em `L` neste slice. */
export const UNIDADES_COMBUSTIVEL = Object.freeze(['L', 'm3']);

export const ROTULO_UNIDADE_COMBUSTIVEL = Object.freeze({
  L: 'Litros (L)',
  m3: 'Metros cúbicos (m³)',
});

// ─── Medidor (máquinas, veículos, equipamentos) ──────────────────────────

export const MEDIDOR_TIPOS = Object.freeze(['SEM_MEDIDOR', 'HORIMETRO', 'ODOMETRO', 'CICLOS']);

export const ROTULO_MEDIDOR = Object.freeze({
  SEM_MEDIDOR: 'Sem medidor',
  HORIMETRO: 'Horímetro',
  ODOMETRO: 'Odômetro',
  CICLOS: 'Contador de ciclos',
});

/** Unidade fixa de cada medidor (nunca derivada de unidade física). */
export const UNIDADE_DO_MEDIDOR = Object.freeze({
  SEM_MEDIDOR: null,
  HORIMETRO: 'h',
  ODOMETRO: 'km',
  CICLOS: 'ciclos',
});

/** Medidores que têm leitura (contadores); `SEM_MEDIDOR` não tem. */
export const MEDIDORES_CONTADORES = Object.freeze(['HORIMETRO', 'ODOMETRO', 'CICLOS']);

/** @param {unknown} tipo */
export const ehMedidorContador = (tipo) => typeof tipo === 'string' && MEDIDORES_CONTADORES.includes(tipo);

// ─── Propriedade, depreciação, UF ────────────────────────────────────────

export const PROPRIEDADES = Object.freeze(['PROPRIO', 'TERCEIRO', 'ARRENDADO', 'CEDIDO']);

export const ROTULO_PROPRIEDADE = Object.freeze({
  PROPRIO: 'Próprio',
  TERCEIRO: 'De terceiro',
  ARRENDADO: 'Arrendado',
  CEDIDO: 'Cedido',
});

export const RESIDUAL_MODOS = Object.freeze(['VALOR', 'PERCENTUAL']);

export const ROTULO_RESIDUAL_MODO = Object.freeze({
  VALOR: 'Valor (R$)',
  PERCENTUAL: 'Percentual (%)',
});

export const METODOS_DEPRECIACAO = Object.freeze(['LINEAR']);

export const UFS = Object.freeze([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

// ─── Matriz de capacidades por natureza (§2 do contrato) ─────────────────

/**
 * @typedef {{
 *   medicoes: boolean,
 *   medidor: 'PROIBIDO'|'OBRIGATORIO'|'OPCIONAL',
 *   tanques: boolean,
 *   identificacaoVeicular: boolean,
 *   chassi: boolean,
 *   numeroSerie: boolean,
 *   potencia: boolean,
 *   construcao: boolean,
 *   compatibilidade: boolean,
 * }} CapacidadesNatureza
 */

/** @type {Readonly<Record<string, Readonly<CapacidadesNatureza>>>} */
export const CAPACIDADES_DA_NATUREZA = Object.freeze({
  BENFEITORIA: Object.freeze({ medicoes: true, medidor: 'PROIBIDO', tanques: false, identificacaoVeicular: false, chassi: false, numeroSerie: false, potencia: false, construcao: true, compatibilidade: false }),
  MAQUINA: Object.freeze({ medicoes: false, medidor: 'OBRIGATORIO', tanques: true, identificacaoVeicular: false, chassi: true, numeroSerie: true, potencia: true, construcao: false, compatibilidade: false }),
  VEICULO: Object.freeze({ medicoes: false, medidor: 'OBRIGATORIO', tanques: true, identificacaoVeicular: true, chassi: true, numeroSerie: true, potencia: true, construcao: false, compatibilidade: false }),
  IMPLEMENTO: Object.freeze({ medicoes: false, medidor: 'OPCIONAL', tanques: false, identificacaoVeicular: false, chassi: false, numeroSerie: true, potencia: false, construcao: false, compatibilidade: true }),
  EQUIPAMENTO: Object.freeze({ medicoes: false, medidor: 'OBRIGATORIO', tanques: true, identificacaoVeicular: false, chassi: false, numeroSerie: true, potencia: true, construcao: false, compatibilidade: false }),
  OUTRO: Object.freeze({ medicoes: false, medidor: 'OPCIONAL', tanques: false, identificacaoVeicular: false, chassi: false, numeroSerie: true, potencia: false, construcao: false, compatibilidade: false }),
});

/** @param {unknown} natureza @returns {Readonly<CapacidadesNatureza>|null} */
export const capacidadesDaNatureza = (natureza) => (ehNatureza(natureza) ? CAPACIDADES_DA_NATUREZA[natureza] : null);

/** Campos do bem controlados por cada capacidade da matriz. */
export const CAMPOS_DA_CAPACIDADE = Object.freeze({
  identificacaoVeicular: Object.freeze(['placa', 'placa_uf', 'renavam']),
  chassi: Object.freeze(['chassi']),
  numeroSerie: Object.freeze(['numero_serie']),
  potencia: Object.freeze(['potencia_cv']),
  construcao: Object.freeze(['material', 'ano_conclusao']),
  compatibilidade: Object.freeze(['compatibilidade']),
});

/**
 * O campo escalar se aplica à natureza? Campos fora da matriz (nome, marca,
 * modelo, aquisição…) valem para todas.
 * @param {unknown} natureza @param {string} campo
 */
export const campoAplicavel = (natureza, campo) => {
  const cap = capacidadesDaNatureza(natureza);
  if (!cap) return false;
  for (const [capacidade, campos] of Object.entries(CAMPOS_DA_CAPACIDADE)) {
    if (campos.includes(campo)) return /** @type {any} */ (cap)[capacidade] === true;
  }
  return true;
};
