/**
 * Identificador da empresa ativa para filtros e gravação.
 *
 * Hoje a lista de empresas ainda vem da Base44 (`Layout`), mas cadastros nativos
 * (Marcas, Setor, …) precisam de um `empresa_id` mesmo quando o provider legado
 * falha ou ainda não carregou. O tenant nativo (`cliente_id` do JWT) é o
 * fallback de produção enquanto Empresa não migra (D-PROD-36, BASE44-EXIT-PLAN).
 */

import { useAuth } from '@/lib/AuthContext';

const chave = 'empresa_selecionada_id';

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
  const armazenado = lerArmazenamento();
  return armazenado || clienteId || null;
};
