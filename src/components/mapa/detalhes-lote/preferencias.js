import { useCallback, useEffect, useState } from 'react';
import { SECOES_AREA, SECOES_LOTE } from '@/components/mapa/detalhes-lote/catalogo';

/**
 * Preferências do Detalhes do Lote — POR USUÁRIO, como os filtros do Mapa Geral
 * (src/lib/mapaGeralFiltrosStorage.js, D-PROD-135).
 *
 * Chave: fazenda (cliente) + conta (login) + empresa — as TRÊS obrigatórias.
 * Sem escopo conhecido não há leitura nem gravação: vale o padrão.
 *
 * O que fica salvo: as informações marcadas no "Filtrar" da aba Lotes (Alertas,
 * Lotação, Pesagem, Identificação) e no "Mostrar informações" da aba Área.
 * Padrão (pedido do proprietário): SEM filtro — tudo marcado.
 * O filtro de ALERTA e a vista (Resumo/Lote/Lista) não são preferência: toda
 * abertura começa em "Todos os lotes" e em Resumo.
 *
 * Legado: as chaves antigas sem titular (`mk-dl-v8-secoes`,
 * `mk-dl-v8-secoes-area`) não são herdadas nem apagadas (mesma regra do mapa).
 */

const PREFIXO = 'detalhes_lote_pref_u:';

/** @typedef {{ clienteId: string, login: string, empresaId: string }} EscopoPreferencias */
/** @typedef {{ secoesLote: string[], secoesArea: string[] }} PreferenciasDetalhes */

/** @type {PreferenciasDetalhes} */
export const PADRAO_PREFERENCIAS = Object.freeze({
  secoesLote: [...SECOES_LOTE],
  secoesArea: [...SECOES_AREA],
});

/** @param {any} escopo @returns {escopo is EscopoPreferencias} */
export const escopoValido = (escopo) =>
  Boolean(escopo && typeof escopo === 'object' && escopo.clienteId && escopo.login && escopo.empresaId);

/** @param {EscopoPreferencias} escopo */
export const chavePreferencias = (escopo) => `${PREFIXO}${escopo.clienteId}:${escopo.login}:${escopo.empresaId}`;

/** Mantém só as seções conhecidas, sem repetição, na ordem oficial. */
const filtrarSecoes = (valor, oficiais) =>
  Array.isArray(valor) ? oficiais.filter((s) => valor.includes(s)) : null;

/**
 * Estado completo: o padrão, sobrescrito só pelo que foi salvo com tipo válido.
 * Uma lista salva vazia é escolha do usuário ("Nenhuma") e é respeitada.
 * @param {any} salvo
 * @returns {PreferenciasDetalhes}
 */
export const normalizarPreferencias = (salvo) => {
  const s = salvo && typeof salvo === 'object' && !Array.isArray(salvo) ? salvo : {};
  return {
    secoesLote: filtrarSecoes(s.secoesLote, SECOES_LOTE) ?? [...PADRAO_PREFERENCIAS.secoesLote],
    secoesArea: filtrarSecoes(s.secoesArea, SECOES_AREA) ?? [...PADRAO_PREFERENCIAS.secoesArea],
  };
};

/** @param {EscopoPreferencias|null|undefined} escopo */
export const lerPreferencias = (escopo) => {
  if (typeof window === 'undefined' || !escopoValido(escopo)) return normalizarPreferencias(null);
  try {
    return normalizarPreferencias(JSON.parse(window.localStorage.getItem(chavePreferencias(escopo)) || 'null'));
  } catch {
    return normalizarPreferencias(null);
  }
};

/** @param {EscopoPreferencias|null|undefined} escopo @param {PreferenciasDetalhes} pref */
export const salvarPreferencias = (escopo, pref) => {
  if (typeof window === 'undefined' || !escopoValido(escopo)) return;
  try {
    window.localStorage.setItem(chavePreferencias(escopo), JSON.stringify(normalizarPreferencias(pref)));
  } catch {
    /* localStorage pode lançar (modo privado, cota): a tela segue com o estado em memória */
  }
};

/**
 * Preferências do usuário deste escopo. Troca de conta/empresa → relê (nada do
 * escopo anterior sobrevive). Sem escopo ainda (usuário carregando) → padrão,
 * sem gravar.
 * @param {EscopoPreferencias|null|undefined} escopo
 * @returns {{ preferencias: PreferenciasDetalhes, alterar: (campo: keyof PreferenciasDetalhes, valor: string[]) => void }}
 */
export function usePreferenciasDetalhes(escopo) {
  const chave = escopoValido(escopo) ? chavePreferencias(escopo) : null;
  const [estado, setEstado] = useState(() => ({ chave, preferencias: lerPreferencias(escopo) }));

  useEffect(() => {
    // `escopo` entra só pela `chave`, que o resume (fazenda + conta + empresa).
    if (estado.chave !== chave) setEstado({ chave, preferencias: lerPreferencias(escopo) });
  }, [chave, estado.chave]);

  const preferencias = estado.chave === chave ? estado.preferencias : lerPreferencias(escopo);

  const alterar = useCallback(
    (/** @type {keyof PreferenciasDetalhes} */ campo, /** @type {string[]} */ valor) => {
      setEstado((atual) => {
        const proximas = normalizarPreferencias({ ...atual.preferencias, [campo]: valor });
        salvarPreferencias(escopo, proximas);
        return { chave: atual.chave, preferencias: proximas };
      });
    },
    [chave],
  );

  return { preferencias, alterar };
}
