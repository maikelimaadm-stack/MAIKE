/**
 * Patrimônio e Frota (D-PROD-157) — espelho dos domínios fechados do servidor
 * (`backend/src/modules/patrimonio/patrimonioDominio.js`) só para EXIBIR:
 * rótulos em português e a matriz de capacidades por natureza (quais
 * seções/campos o formulário mostra). Quem valida é o servidor
 * (422 `BEM_CAMPO_NAO_APLICAVEL` etc.); nada aqui decide gravação.
 *
 * D-PROD-162: saíram as medições físicas (dimensões, unidades físicas,
 * finalidades de perfil) e as unidades de combustível. O tanque aceita
 * Produtos do estoque em litros (`L`) ou quilos (`KG`).
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

// ─── Unidade de estoque do Produto no tanque (D-PROD-162) ────────────────

/** Unidades de estoque que um tanque aceita e o abastecimento baixa (`UNIDADES_ABASTECIMENTO` no servidor). */
export const UNIDADES_ESTOQUE_TANQUE = Object.freeze(['L', 'KG']);

/** Produtos aceitos ATIVOS por tanque (P-02; `MAX_PRODUTOS_POR_TANQUE` no servidor). */
export const MAX_PRODUTOS_POR_TANQUE = 20;

/** Selo curto da unidade de estoque do Produto ("120 L", "80 kg"). */
export const ROTULO_UNIDADE_ESTOQUE = Object.freeze({
  L: 'L',
  KG: 'kg',
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
  BENFEITORIA: Object.freeze({ medidor: 'PROIBIDO', tanques: false, identificacaoVeicular: false, chassi: false, numeroSerie: false, potencia: false, construcao: true, compatibilidade: false }),
  MAQUINA: Object.freeze({ medidor: 'OBRIGATORIO', tanques: true, identificacaoVeicular: false, chassi: true, numeroSerie: true, potencia: true, construcao: false, compatibilidade: false }),
  VEICULO: Object.freeze({ medidor: 'OBRIGATORIO', tanques: true, identificacaoVeicular: true, chassi: true, numeroSerie: true, potencia: true, construcao: false, compatibilidade: false }),
  IMPLEMENTO: Object.freeze({ medidor: 'OPCIONAL', tanques: false, identificacaoVeicular: false, chassi: false, numeroSerie: true, potencia: false, construcao: false, compatibilidade: true }),
  EQUIPAMENTO: Object.freeze({ medidor: 'OBRIGATORIO', tanques: true, identificacaoVeicular: false, chassi: false, numeroSerie: true, potencia: true, construcao: false, compatibilidade: false }),
  OUTRO: Object.freeze({ medidor: 'OPCIONAL', tanques: false, identificacaoVeicular: false, chassi: false, numeroSerie: true, potencia: false, construcao: false, compatibilidade: false }),
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
