import { useCallback, useSyncExternalStore } from 'react';
import { COLUNAS_PADRAO, normalizarColunas } from '@/components/mapa/detalhes-lote/catalogo';

/**
 * Preferências do Detalhes do Lote — POR USUÁRIO, como os filtros do Mapa Geral
 * (src/lib/mapaGeralFiltrosStorage.js, D-PROD-135).
 *
 * Chave: fazenda (cliente) + conta (login) + empresa — as TRÊS obrigatórias.
 * Sem escopo conhecido (conta ainda carregando) vale o padrão e nada é gravado.
 *
 * O que fica salvo (v12, D-PROD-217): as colunas da Lista da aba Lotes
 * (`colunasLote`, chaves do catálogo), escolhidas em "Configurar tabela".
 * Padrão: Alertas + Lotação + Pesagem (`COLUNAS_PADRAO`). Lista vazia é escolha
 * do usuário e é respeitada. As seções do v8 (`secoesLote`, `secoesArea`) não
 * são mais lidas e somem na próxima gravação.
 *
 * Quem lê fica avisado quando alguém grava: a Lista continua montada por baixo
 * da tela empilhada "Configurar tabela" e troca as colunas ao Aplicar.
 */

const PREFIXO = 'detalhes_lote_pref_u:';

/** @typedef {{ clienteId: string, login: string, empresaId: string }} EscopoPreferencias */
/** @typedef {{ colunasLote: string[] }} PreferenciasDetalhes */

/** @type {Readonly<PreferenciasDetalhes>} */
export const PADRAO_PREFERENCIAS = Object.freeze({ colunasLote: [...COLUNAS_PADRAO] });

/** @param {any} escopo @returns {escopo is EscopoPreferencias} */
export const escopoValido = (escopo) =>
  Boolean(escopo && typeof escopo === 'object' && escopo.clienteId && escopo.login && escopo.empresaId);

/** @param {EscopoPreferencias} escopo */
export const chavePreferencias = (escopo) => `${PREFIXO}${escopo.clienteId}:${escopo.login}:${escopo.empresaId}`;

/**
 * Estado completo: o padrão, sobrescrito só pelo que foi salvo com tipo válido.
 * @param {any} salvo
 * @returns {PreferenciasDetalhes}
 */
export const normalizarPreferencias = (salvo) => {
  const s = salvo && typeof salvo === 'object' && !Array.isArray(salvo) ? salvo : {};
  return { colunasLote: normalizarColunas(s.colunasLote) ?? [...COLUNAS_PADRAO] };
};

/** @param {EscopoPreferencias|null|undefined} escopo */
const textoSalvo = (escopo) => {
  if (typeof window === 'undefined' || !escopoValido(escopo)) return null;
  try {
    return window.localStorage.getItem(chavePreferencias(escopo));
  } catch {
    return null;
  }
};

/** @param {string|null} bruto @returns {PreferenciasDetalhes} */
const lerTexto = (bruto) => {
  try {
    return normalizarPreferencias(JSON.parse(bruto || 'null'));
  } catch {
    return normalizarPreferencias(null);
  }
};

/** @param {EscopoPreferencias|null|undefined} escopo @returns {PreferenciasDetalhes} */
export const lerPreferencias = (escopo) => lerTexto(textoSalvo(escopo));

/**
 * Grava (só com escopo completo). Fica salvo só o que é preferência hoje.
 * @param {EscopoPreferencias|null|undefined} escopo
 * @param {PreferenciasDetalhes} pref
 */
export const salvarPreferencias = (escopo, pref) => {
  if (typeof window === 'undefined' || !escopoValido(escopo)) return;
  try {
    window.localStorage.setItem(chavePreferencias(escopo), JSON.stringify(normalizarPreferencias(pref)));
  } catch {
    /* localStorage pode lançar (modo privado, cota): a tela segue com o que estava */
  }
};

// ─── Assinantes (todas as telas abertas leem o mesmo valor) ─────────────────

/** @type {Set<() => void>} */
const assinantes = new Set();

/** @param {() => void} avisar */
const assinar = (avisar) => {
  assinantes.add(avisar);
  return () => {
    assinantes.delete(avisar);
  };
};

const avisarTodos = () => {
  for (const avisar of [...assinantes]) avisar();
};

/**
 * Sem escopo (conta carregando) a escolha vale só nesta sessão, em memória:
 * nada vai para o localStorage.
 * @type {string[] | null}
 */
let colunasSemEscopo = null;

/** Último valor lido por chave (o mesmo array enquanto o texto salvo não muda). */
/** @type {Map<string, { bruto: string|null, colunas: string[] }>} */
const lidas = new Map();

/** @param {EscopoPreferencias|null|undefined} escopo @returns {string[]} */
const colunasDe = (escopo) => {
  if (!escopoValido(escopo)) return colunasSemEscopo ?? PADRAO_PREFERENCIAS.colunasLote;
  const chave = chavePreferencias(escopo);
  const bruto = textoSalvo(escopo);
  const ultima = lidas.get(chave);
  if (ultima && ultima.bruto === bruto) return ultima.colunas;
  const colunas = lerTexto(bruto).colunasLote;
  lidas.set(chave, { bruto, colunas });
  return colunas;
};

/**
 * Grava as colunas da Lista do usuário deste escopo e avisa quem está lendo.
 * @param {EscopoPreferencias|null|undefined} escopo
 * @param {readonly string[]} colunas
 */
export function gravarColunasLote(escopo, colunas) {
  const limpas = normalizarColunas([...colunas]) ?? [...COLUNAS_PADRAO];
  if (escopoValido(escopo)) salvarPreferencias(escopo, { ...lerPreferencias(escopo), colunasLote: limpas });
  else colunasSemEscopo = limpas;
  avisarTodos();
}

/**
 * Colunas da Lista (chaves, na ordem do catálogo) do usuário deste escopo, e a
 * função que grava. Troca de conta/empresa → relê; outro leitor gravou → relê.
 * @param {EscopoPreferencias|null|undefined} escopo
 * @returns {[string[], (colunas: readonly string[]) => void]}
 */
export function useColunasLote(escopo) {
  const colunas = useSyncExternalStore(assinar, () => colunasDe(escopo), () => PADRAO_PREFERENCIAS.colunasLote);
  const gravar = useCallback((/** @type {readonly string[]} */ novas) => gravarColunasLote(escopo, novas), [escopo]);
  return [colunas, gravar];
}
