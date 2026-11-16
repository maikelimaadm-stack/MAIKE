/**
 * Corpos de gravação do bebedouro e do cocho/depósito criados a partir de um
 * ponto do mapa. Um só lugar para o formulário individual (`FormularioPonto`)
 * e o cadastro em lote (`ModalCadastroLotePontos`): antes o lote não criava o
 * bebedouro e montava o cocho com regras próprias.
 *
 * `numero_ponto` do cocho/depósito NÃO é montado aqui: o servidor reserva o
 * número pela sequência do tenant, dentro da transação da criação.
 *
 * Puro: sem React, sem provider.
 */

/** @param {unknown} v */
const numeroOuNulo = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/** @param {unknown} v @param {number} padrao */
const inteiroOu = (v, padrao) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : padrao;
};

/**
 * @param {object} p
 * @param {any} p.data valores do formulário (nome, sigla, setor_id, area_vinculada_ids, tipo_bebedouro, ...)
 * @param {string} p.pontoReferenciaId
 * @param {string} p.empresaId
 * @param {any[]} [p.areas]
 * @param {any[]} [p.setores]
 * @param {any} p.coordenadas
 */
export const montarPayloadBebedouro = ({ data, pontoReferenciaId, empresaId, areas = [], setores = [], coordenadas }) => {
  const ids = Array.isArray(data?.area_vinculada_ids) ? data.area_vinculada_ids : [];
  const areasSelecionadas = (areas || []).filter((area) => ids.includes(area.id));
  const areaSelecionada = areasSelecionadas[0] || null;
  return {
    empresa_id: empresaId,
    ponto_referencia_id: pontoReferenciaId,
    nome: data.nome,
    codigo_interno: data.sigla || null,
    pasto_id: areaSelecionada?.id || null,
    pasto_nome: areaSelecionada?.nome || null,
    area_vinculada_ids: areasSelecionadas.map((area) => area.id),
    area_vinculada_nomes: areasSelecionadas.map((area) => area.nome),
    setor_id: data.setor_id || areaSelecionada?.setor_id || null,
    setor_nome: areaSelecionada?.setor_nome || (setores || []).find((setor) => setor.id === data.setor_id)?.nome || null,
    tipo: data.tipo_bebedouro || 'Bebedouro australiano',
    capacidade_litros: numeroOuNulo(data.capacidade_agua_litros),
    origem_agua: data.origem_agua || 'Poço',
    periodicidade_limpeza: 'Personalizado',
    periodicidade_inspecao: 'Personalizado',
    dias_limpeza_personalizado: inteiroOu(data.dias_limpeza_personalizado, 30),
    dias_inspecao_personalizado: inteiroOu(data.dias_inspecao_personalizado, 7),
    coordenadas,
    status: 'Ativo',
    ativo: true,
    observacoes: data.observacoes || null,
  };
};

/**
 * @param {object} p
 * @param {any} p.data valores do formulário, com `tipo_categoria` 'COCHO' | 'DEPOSITO'
 * @param {string} p.empresaId
 * @param {any[]} [p.areas]
 * @param {any[]} [p.setores]
 * @param {any} [p.depositoOrigem] registro do depósito escolhido para o cocho
 * @param {string|null} [p.localEstoqueId]
 * @param {string|null} [p.localEstoqueNome]
 * @param {any} p.coordenadas
 */
export const montarPayloadSuplementacao = ({
  data,
  empresaId,
  areas = [],
  setores = [],
  depositoOrigem = null,
  localEstoqueId = null,
  localEstoqueNome = null,
  coordenadas,
}) => {
  const categoria = data.tipo_categoria;
  const ehCocho = categoria === 'COCHO';
  const ehDeposito = categoria === 'DEPOSITO';
  const ids = Array.isArray(data?.area_vinculada_ids) ? data.area_vinculada_ids : [];
  const areasVinculadas = ehCocho ? (areas || []).filter((area) => ids.includes(area.id)) : [];
  const principal = areasVinculadas[0] || null;
  const setor = (setores || []).find((s) => s.id === data.setor_id);
  return {
    empresa_id: empresaId,
    setor_id: data.setor_id || null,
    setor_nome: setor?.nome || null,
    nome_ponto: data.nome,
    sigla: data.sigla || null,
    categoria_ponto: categoria,
    tipo: data.tipo,
    produto_padrao: ehCocho ? data.produto_padrao || null : null,
    capacidade_cocho_kg: numeroOuNulo(data.capacidade_cocho_kg),
    metragem_cocho_m: ehCocho ? numeroOuNulo(data.metragem_cocho_m) : null,
    cobertura_cocho: ehCocho ? data.cobertura_cocho || null : null,
    area_vinculada_id: ehCocho ? principal?.id || null : null,
    area_vinculada_nome: ehCocho ? principal?.nome || '' : null,
    area_vinculada_ids: ehCocho ? ids : [],
    area_vinculada_nomes: ehCocho ? areasVinculadas.map((area) => area.nome) : [],
    deposito_origem_id: ehCocho ? data.deposito_origem_id || null : null,
    deposito_origem_nome: ehCocho ? depositoOrigem?.nome_ponto || null : null,
    local_estoque_id: ehDeposito ? localEstoqueId : null,
    local_estoque_nome: ehDeposito ? localEstoqueNome : null,
    coordenadas,
    status: 'Ativo',
    observacoes: data.observacoes || null,
    consumo_ideal_por_cabeca_kg: ehCocho ? numeroOuNulo(data.consumo_ideal_por_cabeca_kg) : null,
    limite_minimo_consumo: ehCocho ? numeroOuNulo(data.limite_minimo_consumo) : null,
    limite_maximo_consumo: ehCocho ? numeroOuNulo(data.limite_maximo_consumo) : null,
    dias_alerta_reposicao: ehCocho ? inteiroOu(data.dias_alerta_reposicao, 3) : 3,
    estoque_minimo_kg: ehDeposito ? numeroOuNulo(data.estoque_minimo_kg) : null,
    alerta_sem_lancamento_dias: ehCocho ? inteiroOu(data.alerta_sem_lancamento_dias, 10) : null,
  };
};
