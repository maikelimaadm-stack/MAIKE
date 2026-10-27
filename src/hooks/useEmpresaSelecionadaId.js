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
const chaveTenant = 'empresa_selecionada_cliente_id';
/** Disparado pelo Layout quando `empresa_selecionada_id` muda (mesma aba). */
export const EVENTO_EMPRESA_SELECIONADA = 'maike:empresa-selecionada';

/**
 * @param {string|null|undefined} clienteIdAtual
 * @returns {string|null}
 */
const lerArmazenamento = (clienteIdAtual) => {
  if (typeof window === 'undefined') return null;
  try {
    const id = window.localStorage.getItem(chave);
    if (!id) return null;
    const tenantSalvo = window.localStorage.getItem(chaveTenant);
    if (tenantSalvo && clienteIdAtual && tenantSalvo !== clienteIdAtual) {
      return null;
    }
    return id;
  } catch {
    return null;
  }
};

/** Remove seleção de empresa ao encerrar sessão (evita vazamento entre logins). */
export const limparEmpresaSelecionadaSessao = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(chave);
    window.localStorage.removeItem(chaveTenant);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENTO_EMPRESA_SELECIONADA));
};

/**
 * @param {string} empresaId
 * @param {string|null|undefined} clienteId
 */
export const persistirEmpresaSelecionada = (empresaId, clienteId) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(chave, empresaId);
    if (clienteId) {
      window.localStorage.setItem(chaveTenant, clienteId);
    } else {
      window.localStorage.removeItem(chaveTenant);
    }
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENTO_EMPRESA_SELECIONADA));
};

/**
 * @returns {string|null}
 */
export const useEmpresaSelecionadaId = () => {
  const { clienteId } = useAuth();
  const [armazenado, setArmazenado] = useState(() => lerArmazenamento(clienteId));

  useEffect(() => {
    setArmazenado(lerArmazenamento(clienteId));
  }, [clienteId]);

  useEffect(() => {
    const sync = () => setArmazenado(lerArmazenamento(clienteId));
    window.addEventListener('storage', sync);
    window.addEventListener(EVENTO_EMPRESA_SELECIONADA, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(EVENTO_EMPRESA_SELECIONADA, sync);
    };
  }, [clienteId]);

  return armazenado || clienteId || null;
};
