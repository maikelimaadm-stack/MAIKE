/**
 * Service da importação de áreas por arquivo (D-PROD-90).
 *
 * Converte a linha da conferência (o que a tela edita) no item que o servidor
 * aceita, e só isso: quem valida de verdade, numera e grava é o backend, numa
 * transação. Aqui não existe laço de `criarArea` — repetir POST por área não é
 * transação e deixaria metade gravada numa falha no meio.
 */

import { conferirImportacaoAreas, importarAreas } from "@/apis/areas";
import { toPersistedCoords } from "@/lib/geografia";
import { lerHectares } from "@/domain/areas/regrasCadastroArea";
import { API_ERROR_CODES } from "@/apis/_core/ApiError";

/** No máximo 100 áreas por confirmação: a gravação é atômica dentro disso. */
export const MAX_AREAS_POR_IMPORTACAO = 100;

/**
 * @typedef {{
 *   ref: string, nome: string, sigla: string, setor_id: string, tipo_cultura: string,
 *   tipo_pastagem: string, tipo_infraestrutura: string, area_pastejada: string,
 *   aproveitamento: string, cor: string, vertices: {lat: number, lng: number}[]
 * }} LinhaImportacao
 */

/**
 * Linha da tela → item do contrato. Infraestrutura grava o tipo em
 * `tipo_pastagem` (mesma convenção do formulário manual) e não tem pastejada.
 * @param {LinhaImportacao} linha
 */
export const itemDeEnvio = (linha) => {
  const infraestrutura = linha.tipo_cultura === "Infraestrutura";
  const pastejada = lerHectares(linha.area_pastejada);
  return {
    ref: linha.ref,
    nome: String(linha.nome ?? "").replace(/\s+/g, " ").trim().toUpperCase(),
    sigla: String(linha.sigla ?? "").trim().toUpperCase() || null,
    setor_id: linha.setor_id || null,
    tipo_cultura: linha.tipo_cultura || null,
    tipo_pastagem: (infraestrutura ? linha.tipo_infraestrutura : linha.tipo_pastagem) || null,
    area_pastejada: infraestrutura || pastejada === null || Number.isNaN(pastejada) ? null : pastejada,
    aproveitamento_classificacao: linha.aproveitamento || "Média",
    cor: linha.cor || null,
    coords: toPersistedCoords(linha.vertices),
  };
};

/** Chave de retentativa: a mesma enquanto o conteúdo enviado não mudar. */
export const novaChaveDeImportacao = () => {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `imp-${aleatorio}`;
};

/** Assinatura do que seria enviado: muda → conferência e chave antigas não valem. */
export const assinaturaDoEnvio = (empresaId, itens) => JSON.stringify([empresaId, itens]);

/**
 * @param {string} empresaId
 * @param {ReturnType<typeof itemDeEnvio>[]} itens
 */
export const conferirNoServidor = (empresaId, itens) => conferirImportacaoAreas({ empresaId, itens });

/**
 * @param {string} operationId
 * @param {string} empresaId
 * @param {ReturnType<typeof itemDeEnvio>[]} itens
 */
export const gravarImportacao = (operationId, empresaId, itens) =>
  importarAreas({ operationId, empresaId, itens });

/**
 * O que uma falha da GRAVAÇÃO prova (D-PROD-90 R1):
 *
 *   recusada        o servidor avaliou ESTE pedido e recusou antes de gravar —
 *                   pendência (422), limite (413), schema (400), empresa fora do
 *                   tenant (404) ou chave já usada com outro conteúdo (409).
 *                   Nada deste lote foi gravado por esta chave;
 *   nao_processada  a sessão foi recusada antes da rota (401): este pedido não
 *                   gravou, mas isso não diz nada sobre um envio anterior;
 *   ambigua         qualquer outra coisa — rede, timeout, 5xx, gateway, corpo
 *                   ilegível, código desconhecido, "ainda em processamento". O
 *                   lote PODE ter sido gravado: só reenviar com a mesma chave.
 *
 * @param {unknown} erro
 * @returns {'recusada' | 'nao_processada' | 'ambigua'}
 */
export const classificarFalhaDeGravacao = (erro) => {
  const codigo = /** @type {any} */ (erro)?.code;
  if (
    [
      API_ERROR_CODES.AREA_IMPORT_VALIDATION_FAILED,
      API_ERROR_CODES.AREA_IMPORT_LIMIT_EXCEEDED,
      API_ERROR_CODES.INVALID_ARGUMENT,
      API_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      API_ERROR_CODES.EMPRESA_NOT_FOUND,
    ].includes(codigo)
  ) {
    return "recusada";
  }
  if (codigo === API_ERROR_CODES.TENANT_CONTEXT_REQUIRED) return "nao_processada";
  return "ambigua";
};

/**
 * Resposta 201 só conta como sucesso se trouxer uma área para cada item
 * enviado. Corpo vazio ou de outro formato é tratado como resultado
 * desconhecido, nunca como sucesso inventado.
 *
 * @param {unknown} resposta
 * @param {{ ref: string }[]} itens
 */
export const respostaDeGravacaoValida = (resposta, itens) => {
  const r = /** @type {any} */ (resposta);
  if (!r || !Array.isArray(r.importadas) || r.importadas.length !== itens.length) return false;
  const refs = new Set(itens.map((i) => i.ref));
  return r.importadas.every((a) => a && typeof a.id === "string" && refs.has(a.ref));
};
