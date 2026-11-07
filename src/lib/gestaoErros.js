/**
 * Mensagens em português dos erros dos cadastros de Gestão Rural (D-PROD-145).
 *
 * O transporte nativo (`nativeHttpClient`) só preserva códigos catalogados; os
 * códigos novos de Gestão viajam no corpo do servidor, guardado em `erro.cause`
 * (não enumerável, nunca exibido cru). Aqui lemos SÓ `code`, `field`, `reason` e
 * `details` — a `message` do servidor continua descartada.
 *
 * O errorHandler do servidor sobe `field` e `reason` ao topo do corpo quando os
 * dois existem; senão ficam em `details`. Aceitamos os dois lugares.
 */

import { getApiErrorMessage } from '@/apis/_core/ApiError';

/** @param {unknown} v @returns {v is Record<string, any>} */
const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {unknown} erro
 * @returns {{ code: string|null, field: string|null, reason: string|null, details: Record<string, any> }}
 */
export const lerErroGestao = (erro) => {
  const e = /** @type {any} */ (erro);
  const causa = ehObjeto(e?.cause) ? e.cause : {};
  const detalhesCausa = ehObjeto(causa.details) ? causa.details : {};
  const detalhesErro = ehObjeto(e?.details) ? e.details : {};
  const details = { ...detalhesErro, ...detalhesCausa };
  const code = typeof causa.code === 'string' ? causa.code : typeof e?.code === 'string' ? e.code : null;
  const field = [causa.field, detalhesCausa.field, detalhesErro.field].find((v) => typeof v === 'string') ?? null;
  const reason = [causa.reason, detalhesCausa.reason, detalhesErro.reason].find((v) => typeof v === 'string') ?? null;
  return { code, field, reason, details };
};

const ROTULO_DOCUMENTO = /** @type {Record<string, string>} */ ({ cpf: 'CPF', cnpj: 'CNPJ' });

const HIERARQUIA = /** @type {Record<string, string>} */ ({
  ciclo: 'O centro escolhido como pai está abaixo deste centro na hierarquia (formaria um ciclo).',
  profundidade_maxima: 'A hierarquia ultrapassaria o número máximo de níveis permitido.',
  pai_inativo: 'O centro escolhido como pai está inativo. Escolha um pai ativo.',
  pai_fora_da_empresa: 'O centro escolhido como pai não pertence a esta empresa (ou não existe mais).',
  autorreferencia: 'Um centro não pode ser pai de si mesmo.',
});

/**
 * Mensagem clara por código. Nunca devolve vazio; código desconhecido cai na
 * mensagem pública do `ApiError` (catálogo local) ou no fallback.
 * @param {unknown} erro
 * @param {string} fallback
 */
export const mensagemErroGestao = (erro, fallback) => {
  const { code, field, reason, details } = lerErroGestao(erro);
  switch (code) {
    case 'ACAO_NAO_PERMITIDA':
      return 'Você não tem permissão para esta ação nesta tela. Peça ao administrador para liberar.';
    case 'EMPRESA_NOT_FOUND':
      return 'Empresa não encontrada. Selecione a empresa novamente.';
    case 'PARCEIRO_NOT_FOUND':
      return 'Parceiro não encontrado nesta empresa. A lista será atualizada.';
    case 'PARCEIRO_DOCUMENTO_INVALIDO':
      return `${ROTULO_DOCUMENTO[field ?? ''] ?? 'CPF/CNPJ'} inválido: confira os dígitos. Nada foi gravado.`;
    case 'PARCEIRO_DOCUMENTO_DUPLICADO': {
      const doc = ROTULO_DOCUMENTO[field ?? ''] ?? 'documento';
      const numero = details.numero_cadastro != null ? ` (cadastro nº ${String(details.numero_cadastro)})` : '';
      return `Já existe um parceiro com este ${doc} nesta empresa${numero}. Nada foi gravado.`;
    }
    case 'CENTRO_CUSTO_NOT_FOUND':
      return 'Centro de custo não encontrado nesta empresa. A lista será atualizada.';
    case 'CENTRO_RESULTADO_NOT_FOUND':
      return 'Centro de resultado não encontrado nesta empresa. A lista será atualizada.';
    case 'CENTRO_NOME_CONFLITO':
      return 'Já existe um centro com este nome nesta empresa. Nada foi gravado.';
    case 'CENTRO_HIERARQUIA_INVALIDA':
      return HIERARQUIA[reason ?? ''] ?? 'Pai inválido para este centro. Nada foi gravado.';
    case 'CENTRO_COM_FILHOS_ATIVOS':
      return 'Este centro tem centros filhos ativos. Inative os filhos antes. Nada foi gravado.';
    case 'CENTRO_INATIVO':
      return 'Há centro inativo na seleção: centro inativo não recebe vínculo novo. Nada foi gravado.';
    case 'REQUEST_VALIDATION_FAILED':
      return field ? `Dados inválidos no campo "${field}". Revise e tente novamente.` : 'Dados inválidos. Revise o formulário e tente novamente.';
    default:
      return getApiErrorMessage(erro, fallback);
  }
};

/** Códigos que significam "o registro não existe mais": a tela relê a lista. */
export const ehNaoEncontradoGestao = (erro) =>
  ['PARCEIRO_NOT_FOUND', 'CENTRO_CUSTO_NOT_FOUND', 'CENTRO_RESULTADO_NOT_FOUND'].includes(lerErroGestao(erro).code ?? '');
