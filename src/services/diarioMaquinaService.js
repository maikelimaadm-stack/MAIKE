/**
 * Service do Diário da máquina (mistura no implemento, aplicação no pasto, sobra e resumo do dia).
 *
 * DEGRADAÇÃO: o servidor de produção pode ainda não ter as rotas novas. `diarioDisponivel(atividadeId)` tenta o
 * `GET /misturas`: qualquer recusa do servidor (rota inexistente, 404/405/501, erro de contrato) vira "indisponível" e
 * a tela mostra o lançamento de hoje. Só a falta de rede (`PROVIDER_UNAVAILABLE`) é lançada de volta, para o react-query
 * tentar de novo — sem marcar o diário como indisponível por causa de uma queda de conexão.
 *
 * Envio: cada escrita leva um `operation_id` persistente (`enviarComPendencia`, o mesmo mecanismo do lançamento): sem
 * resposta definitiva, "Repetir o mesmo envio" reaproveita a chave e o servidor não grava duas vezes.
 */

import { misturaPort } from '@/apis/atividades/misturaPort';
import { API_ERROR_CODES, isApiError } from '@/apis/_core/ApiError';
import { confirmadosDoDia, itensDaLista } from '@/lib/atividadeApontamentoRegras';
import { exigirEmpresa } from './gestaoCadastroComum.js';
import { enviarComPendencia } from './operacaoFinanceiraService';
import { fazendaDaTelaAtual, listarApontamentos } from './lancamentoAtividadesService';

const RECURSO = 'Mistura';
const ESCOPO = 'diario-maquina';

/**
 * O diário está ligado neste servidor? Tenta o `GET /misturas` da atividade (na fazenda da tela). Resposta de dados (com
 * `items`) = ligado; qualquer outra coisa = indisponível. Falta de rede é lançada (não vira "indisponível").
 * @param {string} atividadeId @returns {Promise<boolean>}
 */
export const diarioDisponivel = async (atividadeId) => {
  const empresaId = fazendaDaTelaAtual();
  if (!empresaId || !atividadeId) return false;
  try {
    const resposta = /** @type {any} */ (await misturaPort.listar(String(atividadeId), empresaId));
    return Array.isArray(resposta?.items);
  } catch (erro) {
    if (isApiError(erro) && /** @type {any} */ (erro).code === API_ERROR_CODES.PROVIDER_UNAVAILABLE) throw erro;
    return false;
  }
};

/** As misturas da atividade (todas: abertas e fechadas). @param {string} atividadeId @returns {Promise<any[]>} */
export const listarMisturas = async (atividadeId) => {
  const empresaId = exigirEmpresa(fazendaDaTelaAtual(), 'listarMisturas', RECURSO);
  const resposta = /** @type {any} */ (await misturaPort.listar(String(atividadeId), empresaId));
  return itensDaLista(resposta);
};

/**
 * O envio com `operation_id` persistente, por (ação, alvo) até a resposta definitiva.
 * @param {{ acao: string, empresaId: string, alvo: string, corpo: Record<string, unknown>, enviar: (corpo: Record<string, unknown>) => Promise<any> }} p
 */
const enviarDiario = ({ acao, empresaId, alvo, corpo, enviar }) =>
  enviarComPendencia({
    escopo: ESCOPO,
    acao,
    empresaId,
    alvo,
    conteudo: corpo,
    enviar: (operationId) => enviar({ ...corpo, operation_id: operationId }),
  });

/**
 * Implemento cheio: cria a mistura da atividade na área (Passo 1). Não baixa estoque: só o que for aplicado baixa.
 * @param {string} atividadeId @param {{ implemento_bem_id: string, area_id: string, itens: Array<Record<string, string>> }} corpo
 */
export const criarMistura = (atividadeId, corpo) => {
  const empresaId = exigirEmpresa(fazendaDaTelaAtual(), 'criarMistura', RECURSO);
  const payload = { ...corpo, empresa_id: empresaId };
  return enviarDiario({
    acao: 'mistura',
    empresaId,
    alvo: `mistura:${atividadeId}:${corpo.area_id}`,
    corpo: payload,
    enviar: (c) => misturaPort.criar(String(atividadeId), c),
  });
};

/**
 * Passo 2: aplica a mistura neste pasto (baixa do estoque, pelo motor, o que saiu do implemento).
 * @param {string} atividadeId @param {string} apontamentoId @param {string} misturaId @param {{ esvaziou: boolean, sobra?: string }} dados
 */
export const aplicarMistura = (atividadeId, apontamentoId, misturaId, dados) => {
  const empresaId = exigirEmpresa(fazendaDaTelaAtual(), 'aplicarMistura', RECURSO);
  const corpo = { ...dados, empresa_id: empresaId };
  return enviarDiario({
    acao: 'aplicar',
    empresaId,
    alvo: `aplicar:${apontamentoId}:${misturaId}`,
    corpo,
    enviar: (c) => misturaPort.aplicar(String(atividadeId), String(apontamentoId), String(misturaId), c),
  });
};

/**
 * O destino da sobra: transferência (vai junto para o próximo pasto), devolução (volta ao depósito) ou perda (com motivo).
 * @param {string} atividadeId @param {string} misturaId @param {Record<string, unknown>} dados
 */
export const registrarSobra = (atividadeId, misturaId, dados) => {
  const empresaId = exigirEmpresa(fazendaDaTelaAtual(), 'registrarSobra', RECURSO);
  const corpo = { ...dados, empresa_id: empresaId };
  return enviarDiario({
    acao: 'sobra',
    empresaId,
    alvo: `sobra:${misturaId}`,
    corpo,
    enviar: (c) => misturaPort.sobra(String(atividadeId), String(misturaId), c),
  });
};

/**
 * O lançamento CONFIRMADO do dia na área da atividade (o que a aplicação precisa). `areaAtividadeId` é o id da área DA
 * ATIVIDADE (não o da área do mapa). Sem ele, o primeiro confirmado do dia.
 * @param {string} atividadeId @param {string|null} areaAtividadeId @param {string} dia
 * @returns {Promise<any|null>}
 */
export const apontamentoDoDia = async (atividadeId, areaAtividadeId, dia) => {
  const resposta = await listarApontamentos(String(atividadeId));
  const itens = itensDaLista(resposta);
  const daArea = itens.filter((a) => !areaAtividadeId || String(a?.atividade_area_id ?? '') === String(areaAtividadeId));
  return confirmadosDoDia(daArea, dia)[0] ?? null;
};

/** O resumo do dia por pasto (o servidor manda o R$ só quando calcula). @param {string} atividadeId @param {string} dia */
export const lerResumoDoDia = (atividadeId, dia) => {
  const empresaId = exigirEmpresa(fazendaDaTelaAtual(), 'lerResumoDoDia', RECURSO);
  return misturaPort.resumoDoDia(String(atividadeId), empresaId, dia);
};
