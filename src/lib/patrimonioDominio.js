/**
 * Patrimônio e Frota (D-PROD-157) — espelho dos domínios fechados do servidor
 * (`backend/src/modules/patrimonio/patrimonioDominio.js`) só para EXIBIR:
 * rótulos em português e a matriz de capacidades por natureza (quais
 * seções/campos o formulário mostra). Quem valida é o servidor
 * (422 `BEM_CAMPO_NAO_APLICAVEL` etc.); nada aqui decide gravação.
 *
 * D-PROD-162: saíram as medições físicas (dimensões, unidades físicas,
 * finalidades de perfil) e as unidades de combustível.
 *
 * D-PROD-163: o tanque aceita Produtos do estoque em QUALQUER unidade de
 * estoque (`L`, `KG` ou `SACO`). A unidade EFETIVA do estoque é litros para
 * `L` e quilos para `KG` e `SACO` (o SACO guarda o estoque em kg). Na tela de
 * Bens, "Natureza" passa a se chamar "Tipo de bem" (mesma lista fixa).
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

// ─── Unidade de estoque do Produto no tanque (D-PROD-162, D-PROD-163) ────

/**
 * Unidades de estoque do Produto que um tanque aceita (D-PROD-163: qualquer
 * unidade de estoque do cadastro de Produtos — litros, quilos ou sacos).
 */
export const UNIDADES_ESTOQUE_TANQUE = Object.freeze(['L', 'KG', 'SACO']);

/**
 * Unidade EFETIVA do estoque (a do abastecimento, `AbastecimentoBem.unidade`):
 * `L` fica em litros; `KG` e `SACO` guardam o estoque em quilos.
 */
export const UNIDADE_EFETIVA_DO_ESTOQUE = Object.freeze({ L: 'L', KG: 'KG', SACO: 'KG' });

/** `L` → `L`; `KG`/`SACO` → `KG`; outra (ou nada) → `null`. @param {unknown} u @returns {'L'|'KG'|null} */
export const unidadeEfetivaDoEstoque = (u) =>
  typeof u === 'string' && Object.prototype.hasOwnProperty.call(UNIDADE_EFETIVA_DO_ESTOQUE, u)
    ? /** @type {'L'|'KG'} */ (/** @type {Record<string, string>} */ (UNIDADE_EFETIVA_DO_ESTOQUE)[u])
    : null;

/** Produtos aceitos ATIVOS por tanque (P-02; `MAX_PRODUTOS_POR_TANQUE` no servidor). */
export const MAX_PRODUTOS_POR_TANQUE = 20;

/** Rótulo curto da unidade de estoque ("120 L", "80 kg"); SACO guarda em kg. */
export const ROTULO_UNIDADE_ESTOQUE = Object.freeze({
  L: 'L',
  KG: 'kg',
  SACO: 'kg',
});

/** Selo do Produto aceito no tanque: a unidade de estoque e, no SACO, que o Produto é em sacos. */
export const SELO_UNIDADE_DO_PRODUTO = Object.freeze({
  L: 'L',
  KG: 'kg',
  SACO: 'kg · saco',
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
