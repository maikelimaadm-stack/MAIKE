/**
 * D-PROD-122 (S1/H1) — o "hoje" da fazenda para o ledger do rebanho.
 *
 * Regras:
 *  - O dia vem do RELÓGIO DO SERVIDOR convertido para o fuso IANA da Empresa
 *    (`Empresa.fuso_horario`). Nunca o fuso do navegador, nunca o dia UTC do
 *    servidor, nunca uma inferência por UF/cidade.
 *  - A data operacional de um fato é o DIA LOCAL informado (AAAA-MM-DD, a parte
 *    literal da string). Hora/offset eventualmente enviados não deslocam o dia
 *    (mesma semântica de `diaDe` desde a R2A).
 *  - Sem fuso configurado não existe "hoje" confiável: quem pede a guarda falha
 *    fechado com EMPRESA_FUSO_NAO_CONFIGURADO. Não há fuso padrão.
 *
 * Relógio de teste: só com NODE_ENV=test. `comRelogioDeTeste` fixa o instante
 * por CONTEXTO assíncrono (AsyncLocalStorage), isolado entre testes
 * concorrentes e restaurado ao sair. `MAIKE_TESTE_AGORA` é o instante padrão
 * dos testes (o runner o define) e também só vale em NODE_ENV=test. Fora de
 * teste, ambos são ignorados ou recusados: produção usa sempre `new Date()`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { AppError } from '../../shared/errors/AppError.js';

export const TAMANHO_MAXIMO_FUSO = 64;

const emTeste = () => process.env.NODE_ENV === 'test';
const relogioDeTeste = new AsyncLocalStorage();

/** Agora do servidor (ou do relógio de teste, só em NODE_ENV=test). */
export const agoraDoServidor = () => {
  if (emTeste()) {
    const fixo = relogioDeTeste.getStore()?.agora ?? process.env.MAIKE_TESTE_AGORA;
    if (fixo) {
      const d = new Date(fixo);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return new Date();
};

/**
 * Roda `fn` com o relógio fixado em `agora` (apenas NODE_ENV=test).
 * @template T
 * @param {string|Date} agora
 * @param {() => T} fn
 * @returns {T}
 */
export const comRelogioDeTeste = (agora, fn) => {
  if (!emTeste()) throw new Error('relógio de teste só existe em NODE_ENV=test');
  const d = new Date(agora);
  if (Number.isNaN(d.getTime())) throw new Error('instante inválido para o relógio de teste');
  return relogioDeTeste.run({ agora: d.toISOString() }, fn);
};

// Nome IANA: "Area/Local[/Sub]" ou "UTC"; letras, dígitos, _, -, + (Etc/GMT+3).
const FORMATO_IANA = /^(?:UTC|[A-Za-z]+(?:[_-][A-Za-z]+)*(?:\/[A-Za-z0-9]+(?:[_+-][A-Za-z0-9]+)*){1,2})$/;

/**
 * Fuso IANA canônico (como o runtime o resolve) ou null se inválido.
 * Offsets ("+03:00", "-0300") NÃO são fuso: mudam de significado e não
 * descrevem a fazenda.
 * @param {unknown} valor
 * @returns {string|null}
 */
export const normalizarFusoIana = (valor) => {
  if (typeof valor !== 'string') return null;
  const v = valor.trim();
  if (!v || v.length > TAMANHO_MAXIMO_FUSO || !FORMATO_IANA.test(v)) return null;
  try {
    const canonico = new Intl.DateTimeFormat('en-US', { timeZone: v }).resolvedOptions().timeZone;
    return FORMATO_IANA.test(canonico) ? canonico : null;
  } catch {
    return null;
  }
};

/**
 * Dia (AAAA-MM-DD) do instante no fuso dado.
 * @param {Date} instante
 * @param {string} fuso nome IANA válido
 */
export const diaNoFuso = (instante, fuso) => {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instante);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};

/**
 * Fuso configurado da empresa do tenant; falha fechado se ausente/inválido.
 * @param {any} tx
 * @param {string} clienteId do auth_context
 * @param {string} empresaId
 * @returns {Promise<string>}
 */
export const fusoDaEmpresa = async (tx, clienteId, empresaId) => {
  // FOR SHARE (PR190-R2): uma troca de fuso em andamento (PUT, que trava a
  // Empresa FOR UPDATE) termina ANTES de a guarda decidir; o manejo relê a versão
  // confirmada. Sem isto, um fato podia ser aceito pelo fuso antigo e confirmado
  // depois da troca — "futuro" no fuso em vigor. Ordem de travas preservada:
  // Empresa → Área → Posição (a mesma da ativação e do cadastro de lote).
  const [empresa] = /** @type {Array<{fuso_horario: string|null}>} */ (
    await tx.$queryRaw`SELECT fuso_horario FROM "Empresa" WHERE cliente_id = ${clienteId} AND id = ${empresaId} FOR SHARE`
  );
  if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada');
  const fuso = normalizarFusoIana(empresa.fuso_horario);
  if (!fuso) {
    throw new AppError('EMPRESA_FUSO_NAO_CONFIGURADO', 'o fuso horário da fazenda não está configurado: o administrador precisa configurá-lo em Empresa → "Fuso horário da fazenda" antes de registrar manejos e lotes. Nada foi gravado.', {
      details: { empresa_id: empresaId },
    });
  }
  return fuso;
};

/**
 * "Hoje" da fazenda.
 * @returns {Promise<{hoje: string, fuso: string}>}
 */
export const hojeDaEmpresa = async (tx, clienteId, empresaId) => {
  const fuso = await fusoDaEmpresa(tx, clienteId, empresaId);
  return { hoje: diaNoFuso(agoraDoServidor(), fuso), fuso };
};

/**
 * Guarda de fato REALIZADO: o dia operacional não pode ser posterior a hoje.
 * @param {{hoje: string, fuso: string}} referencia
 * @param {string} dia AAAA-MM-DD
 * @param {Record<string, unknown>} [extra] detalhes adicionais (ex.: lotes)
 */
export const exigirDiaNaoFuturo = ({ hoje, fuso }, dia, extra = {}) => {
  if (dia > hoje) {
    throw new AppError('REBANHO_DATA_FUTURA', `a data ${dia} é posterior a hoje (${hoje}) na fazenda; só fatos já realizados entram no rebanho (nada foi gravado)`, {
      details: { data: dia, hoje, fuso, ...extra },
    });
  }
};
