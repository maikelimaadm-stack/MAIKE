/**
 * Identificador da empresa ativa para filtros e gravação.
 *
 * Hoje a lista de empresas ainda vem da Base44 (`Layout`), mas cadastros nativos
 * (Marcas, Setor, …) precisam de um `empresa_id` mesmo quando o provider legado
 * falha ou ainda não carregou. O tenant nativo (`cliente_id` do JWT) é o
 * fallback de produção enquanto Empresa não migra (D-PROD-36, BASE44-EXIT-PLAN).
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';

const chave = 'empresa_selecionada_id';
/** Disparado pelo Layout quando `empresa_selecionada_id` muda (mesma aba). */
export const EVENTO_EMPRESA_SELECIONADA = 'maike:empresa-selecionada';

const lerArmazenamento = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
};

/**
 * @returns {string|null}
 */
export const useEmpresaSelecionadaId = () => {
  const { clienteId } = useAuth();
  const [armazenado, setArmazenado] = useState(lerArmazenamento);

  useEffect(() => {
    const sync = () => setArmazenado(lerArmazenamento());
    window.addEventListener('storage', sync);
    window.addEventListener(EVENTO_EMPRESA_SELECIONADA, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(EVENTO_EMPRESA_SELECIONADA, sync);
    };
  }, []);

  return armazenado || clienteId || null;
};
