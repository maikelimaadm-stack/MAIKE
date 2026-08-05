/**
 * Service de Setores (P1.3, D-PROD-18).
 *
 * A página fazia CRUD direto no SDK e decidia bloqueio de exclusão lendo o
 * texto do erro (`message.includes("não é possível excluir")`). Aqui o bloqueio
 * é código estável e a normalização do payload é regra de domínio.
 */

import { listSetores, createSetor, updateSetor, deleteSetor, sincronizarReferenciasSetor } from '@/apis/setores';
import { listTodasMovimentacoes, listMovimentacoesPecuarias } from '@/apis/lotes';
import { listLancamentos } from '@/apis/tarefas';
import { listAreas } from '@/apis/mapa';
import { API_ERROR_CODES } from '@/apis/_core/ApiError';
import { parseDecimalPtBR, parseInteiroPtBR } from '@/domain/numeroPtBR';
import { assertExclusaoPermitida } from './deleteGuardService';

/** @param {any[]} items @param {string} empresaId @returns {any[]} */
const daEmpresa = (items, empresaId) => items.filter((item) => item.empresa_id === empresaId);

/** @returns {Promise<any[]>} */
export const listarSetoresDaEmpresa = async (empresaId) => daEmpresa(await listSetores(), empresaId);

/** `numero_setor = max + 1`. Mesmo risco de concorrência do lote (R2). */
export const proximoNumeroSetor = (setores) => {
  const maior = (setores || []).reduce(
    (max, setor) => Math.max(max, parseInt(setor.numero_setor, 10) || 0),
    0
  );
  return String(maior + 1);
};

const maiusculoOuNulo = (valor) => {
  const texto = String(valor ?? '').toUpperCase().trim();
  return texto || null;
};

/**
 * Payload normalizado do setor.
 *
 * Preservado exatamente do que a página fazia: nome e campos de texto em
 * maiúsculas, numéricos opcionais como `null` quando vazios.
 */
/**
 * @param {object} dados
 * @param {{empresaId?: string, numeroSetor?: string}} [opcoes]
 * @returns {object}
 */
export const normalizarSetor = (dados, { empresaId, numeroSetor } = {}) => {
  const payload = {
    ...dados,
    nome: dados.nome?.toUpperCase(),
    sigla: maiusculoOuNulo(dados.sigla),
    responsavel: maiusculoOuNulo(dados.responsavel),
    endereco: maiusculoOuNulo(dados.endereco),
    cidade: maiusculoOuNulo(dados.cidade),
    observacoes: maiusculoOuNulo(dados.observacoes),
    // DBT-25 fechado na P1.4: `parseFloat('12,5')` devolvia 12 e a metade
    // decimal sumia sem aviso. `parseDecimalPtBR` entende vírgula e ponto.
    area_total: parseDecimalPtBR(dados.area_total),
    capacidade_animais: parseInteiroPtBR(dados.capacidade_animais),
  };
  if (empresaId) payload.empresa_id = empresaId;
  if (numeroSetor !== undefined) payload.numero_setor = numeroSetor;
  return payload;
};

/**
 * Cria o setor com o próximo número.
 *
 * A numeração é calculada sobre **todos** os setores, não só os da empresa —
 * é o alcance que a página usava, e estreitá-lo geraria números repetidos entre
 * empresas.
 */
/**
 * @param {object} dados
 * @param {{empresaId?: string}} [opcoes]
 */
export const criarSetor = async (dados, { empresaId } = {}) => {
  const todos = await listSetores();
  return createSetor(normalizarSetor(dados, { empresaId, numeroSetor: proximoNumeroSetor(todos) }));
};

/**
 * Atualiza o setor e, **somente quando o nome mudou**, sincroniza as
 * referências denormalizadas. Sincronizar sempre custaria uma chamada de
 * function a cada edição de área ou capacidade, sem nada para propagar.
 */
/**
 * @param {string} id
 * @param {object} dados
 * @param {{registroAnterior?: object}} [opcoes]
 */
export const atualizarSetor = async (id, dados, { registroAnterior } = {}) => {
  const payload = normalizarSetor(dados);
  const atualizado = await updateSetor(id, payload);
  if ((registroAnterior?.nome || '') !== (atualizado?.nome || '')) {
    await sincronizarReferenciasSetor({ registro: atualizado, registroAnterior });
  }
  return atualizado;
};

/** Um carregador por entidade dependente declarada em `deleteRules.Setor`. */
const CARREGADORES = Object.freeze({
  AreaPastagem: () => listAreas(),
  LancamentoTarefa: () => listLancamentos(),
  MovimentacaoMapa: () => listTodasMovimentacoes(),
  MovimentacaoPecuaria: () => listMovimentacoesPecuarias(),
});

export const excluirSetor = async (id) => {
  const setor = (await listSetores()).find((item) => item.id === id) || null;
  await assertExclusaoPermitida({
    entityName: 'Setor',
    id,
    currentRecord: setor,
    carregadores: CARREGADORES,
    blockedCode: API_ERROR_CODES.SETOR_DELETE_BLOCKED,
    operation: 'excluirSetor',
  });
  return deleteSetor(id);
};
