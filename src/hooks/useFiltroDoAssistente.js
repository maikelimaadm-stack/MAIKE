/**
 * Pedido de filtro do Assistente para uma tela (D-PROD-230). Lê `?af=` da URL ao abrir
 * a tela e sempre que o assistente avisar (tela já aberta), e tira o parâmetro da barra
 * de endereço para recarregar não reaplicar. A tela decide como aplicar.
 */
import { useCallback, useEffect, useState } from 'react';
import { EVENTO_FILTRO_ASSISTENTE, lerFiltroDaUrl, searchSemFiltro } from '@/domain/assistente/filtroTela';

let sequencia = 0;

/** @param {string} tela */
const lerPedido = (tela) => {
  if (typeof window === 'undefined') return null;
  const filtros = lerFiltroDaUrl(window.location.search, tela);
  if (!filtros) return null;
  sequencia += 1;
  return { id: sequencia, filtros };
};

const tirarDaUrl = () => {
  if (typeof window === 'undefined') return;
  const { pathname, search, hash } = window.location;
  const resto = searchSemFiltro(search);
  if (resto !== search) window.history.replaceState(window.history.state, '', `${pathname}${resto}${hash}`);
};

/**
 * @param {string} tela
 * @returns {{ pedido: { id: number, filtros: Record<string, any> } | null, concluir: () => void }}
 */
export function useFiltroDoAssistente(tela) {
  const [pedido, setPedido] = useState(() => lerPedido(tela));
  useEffect(() => {
    tirarDaUrl();
    const ler = () => {
      const novo = lerPedido(tela);
      if (!novo) return;
      tirarDaUrl();
      setPedido(novo);
    };
    window.addEventListener(EVENTO_FILTRO_ASSISTENTE, ler);
    window.addEventListener('popstate', ler);
    return () => {
      window.removeEventListener(EVENTO_FILTRO_ASSISTENTE, ler);
      window.removeEventListener('popstate', ler);
    };
  }, [tela]);
  const concluir = useCallback(() => setPedido(null), []);
  return { pedido, concluir };
}
