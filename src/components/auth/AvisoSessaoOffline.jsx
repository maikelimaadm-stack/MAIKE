import React from 'react';
import { WifiOff } from 'lucide-react';

/**
 * Aviso de que o app abriu sem confirmar a sessão no servidor (D-PROD-288):
 * sem internet, mostrando os dados salvos no aparelho. Some sozinho quando a
 * rede volta e o servidor confirma.
 */
export default function AvisoSessaoOffline() {
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-0 z-[1000] flex justify-center"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 6px)' }}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900/85 px-3 py-1 text-xs font-semibold text-white shadow">
        <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
        Sem internet — mostrando dados salvos
      </span>
    </div>
  );
}
