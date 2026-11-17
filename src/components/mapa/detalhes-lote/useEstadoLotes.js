import { useCallback, useState } from 'react';

/**
 * Estado das vistas da aba Lotes (v12, D-PROD-V12), lembrado NA SESSÃO, em
 * memória do módulo (fechar e reabrir o pasto volta como estava; recarregar a
 * página começa de novo). Não é preferência do usuário (nada vai para o
 * localStorage):
 * - vista (Resumo · Lote · Lista) POR ÁREA. Sem escolha ainda: Lista no
 *   desktop/tablet e Resumo no celular (D5);
 * - posição do lote na vista Lote, POR ÁREA;
 * - ordenação da Lista (global, como no v12): padrão Nome crescente; coluna nova
 *   começa crescente e clicar de novo inverte.
 */

/** @typedef {'resumo'|'lote'|'lista'} Vista */
/** @typedef {'celular'|'tablet'|'desktop'} Modo */
/** @typedef {{ chave: string, dir: 1|-1 }} Ordenacao */

const VISTAS = /** @type {const} */ (['resumo', 'lote', 'lista']);

/** @type {Ordenacao} */
const ORDEM_PADRAO = Object.freeze({ chave: 'nome', dir: 1 });

const memoria = {
  /** @type {Map<string, Vista>} */
  vista: new Map(),
  /** @type {Map<string, number>} */
  indice: new Map(),
  /** @type {Ordenacao} */
  ordem: ORDEM_PADRAO,
};

/** @param {string|null|undefined} areaId */
const chaveDaArea = (areaId) => (areaId == null ? '' : String(areaId));

/**
 * Vista com que a aba Lotes abre quando a área ainda não tem escolha.
 * @param {Modo|string|null|undefined} modo
 * @returns {Vista}
 */
function vistaInicial(modo) {
  return modo === 'celular' ? 'resumo' : 'lista';
}

/**
 * Esquece tudo o que a sessão lembrou (vistas, posições e ordenação).
 * Para começar limpo (ex.: entre testes).
 */
export function esquecerEstadoLotes() {
  memoria.vista.clear();
  memoria.indice.clear();
  memoria.ordem = ORDEM_PADRAO;
}

/**
 * Vista da aba Lotes desta área.
 * @param {string|null|undefined} areaId
 * @param {Modo|string|null|undefined} modo
 * @returns {[Vista, (v: Vista) => void]}
 */
export function useVistaLotes(areaId, modo) {
  const chave = chaveDaArea(areaId);
  const [, renderizar] = useState(0);
  const vista = memoria.vista.get(chave) ?? vistaInicial(modo);
  const mudar = useCallback(
    (/** @type {Vista} */ v) => {
      if (!VISTAS.includes(v)) return;
      memoria.vista.set(chave, v);
      renderizar((n) => n + 1);
    },
    [chave],
  );
  return [vista, mudar];
}

/**
 * Posição (0…total−1) do lote na vista Lote desta área, presa ao total atual.
 * @param {string|null|undefined} areaId
 * @param {number} total
 * @returns {[number, (i: number) => void]}
 */
export function useIndiceLote(areaId, total) {
  const chave = chaveDaArea(areaId);
  const [, renderizar] = useState(0);
  const max = Math.max(0, (Number(total) || 0) - 1);
  const indice = Math.min(max, Math.max(0, memoria.indice.get(chave) ?? 0));
  const mudar = useCallback(
    (/** @type {number} */ i) => {
      memoria.indice.set(chave, Math.min(max, Math.max(0, Math.trunc(Number(i) || 0))));
      renderizar((n) => n + 1);
    },
    [chave, max],
  );
  return [indice, mudar];
}

/**
 * Ordenação da Lista. `ordenarPor(chave)`: coluna nova → crescente; a mesma → inverte.
 * @returns {[Ordenacao, (chave: string) => void]}
 */
export function useOrdemLista() {
  const [ordem, setOrdem] = useState(() => memoria.ordem);
  const ordenarPor = useCallback((/** @type {string} */ chave) => {
    setOrdem((atual) => {
      /** @type {Ordenacao} */
      const nova = atual.chave === chave ? { chave, dir: atual.dir === 1 ? -1 : 1 } : { chave, dir: 1 };
      memoria.ordem = nova;
      return nova;
    });
  }, []);
  return [ordem, ordenarPor];
}
