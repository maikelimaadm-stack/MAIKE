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
