import { useCallback, useEffect, useState } from 'react';
import { lerFilaDeEnvio, eventosDaFilaDeEnvio } from '@/services/sincronizacaoService';

/**
 * D-PROD-295 — a fila de envio desta sessão, sempre atual (escuta as mudanças
 * das duas filas e a volta da internet).
 *
 * @returns {{aguardando: number, atencao: number, enviando: boolean, itens: any[], outrosAguardando: number, recarregar: () => void}}
 */
export function useFilaDeEnvio() {
  const [estado, setEstado] = useState({ aguardando: 0, atencao: 0, enviando: false, itens: /** @type {any[]} */ ([]), outrosAguardando: 0 });

  const recarregar = useCallback(() => {
    lerFilaDeEnvio()
      .then(setEstado)
      .catch(() => {});
  }, []);

  useEffect(() => {
    recarregar();
    const eventos = [...eventosDaFilaDeEnvio(), 'online', 'offline'];
    eventos.forEach((e) => window.addEventListener(e, recarregar));
    return () => eventos.forEach((e) => window.removeEventListener(e, recarregar));
  }, [recarregar]);

  return { ...estado, recarregar };
}
