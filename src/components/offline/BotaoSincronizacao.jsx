import React, { useEffect, useState } from 'react';
import { AlertTriangle, CloudOff, CloudUpload, Loader2, CheckCircle2 } from 'lucide-react';
import { useFilaDeEnvio } from '@/hooks/useFilaDeEnvio';
import { abrirDadosOffline } from '@/components/offline/DadosOffline';
import { isAppNativo } from '@/config/runtimeConfig';

/** @returns {boolean} */
const semInternetAgora = () => typeof navigator !== 'undefined' && navigator.onLine === false;

function useSemInternet() {
  const [sem, setSem] = useState(semInternetAgora);
  useEffect(() => {
    const atualizar = () => setSem(semInternetAgora());
    window.addEventListener('online', atualizar);
    window.addEventListener('offline', atualizar);
    return () => {
      window.removeEventListener('online', atualizar);
      window.removeEventListener('offline', atualizar);
    };
  }, []);
  return sem;
}

/**
 * D-PROD-301 — o botão da sincronização no topo (ao lado do usuário): um ícone
 * pequeno, sem faixa na tela, que diz como está e abre a janela "Sincronização".
 *  - enviando o que espera: girando (D-PROD-380: a passada de rotina sem nada a enviar não gira; o ícone só diz
 *    quantos faltam, como a faixa do AgriWebb);
 *  - precisa de atenção: triângulo âmbar com o número;
 *  - esperando envio: nuvem com o número;
 *  - sem internet (nada esperando): nuvem cortada;
 *  - tudo certo: ✓ (só no app; no navegador, sem nada a enviar, não aparece).
 *
 * @param {{ className?: string }} props
 */
export default function BotaoSincronizacao({ className = '' }) {
  const fila = useFilaDeEnvio();
  const semInternet = useSemInternet();
  const pendentes = fila.aguardando + fila.atencao;
  if (!isAppNativo() && pendentes === 0 && !fila.enviando) return null;

  let Icone = CheckCircle2;
  let cor = 'text-emerald-600';
  let rotulo = 'Sincronização: tudo enviado';
  if (fila.enviando && pendentes > 0) {
    Icone = Loader2;
    cor = 'text-sky-600 animate-spin';
    rotulo = `Sincronização: enviando ${pendentes} registro(s)`;
  } else if (fila.atencao > 0) {
    Icone = AlertTriangle;
    cor = 'text-amber-600';
    rotulo = `Sincronização: ${fila.atencao} precisa(m) de atenção`;
  } else if (fila.aguardando > 0) {
    Icone = CloudUpload;
    cor = semInternet ? 'text-slate-500' : 'text-sky-600';
    rotulo = `Sincronização: ${fila.aguardando} aguardando envio`;
  } else if (semInternet) {
    Icone = CloudOff;
    cor = 'text-slate-400';
    rotulo = 'Sincronização: sem internet agora';
  }

  return (
    <button
      type="button"
      onClick={abrirDadosOffline}
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100 max-md:h-11 max-md:w-11 ${className}`}
      aria-label={rotulo}
      title={rotulo}
      data-testid="botao-sincronizacao"
    >
      <Icone className={`h-[18px] w-[18px] ${cor}`} aria-hidden="true" />
      {pendentes > 0 ? (
        <span
          className={`absolute right-0.5 top-0.5 min-w-[16px] rounded-full px-1 text-center text-[10px] font-semibold leading-4 text-white ${fila.atencao > 0 ? 'bg-amber-500' : 'bg-sky-600'}`}
          aria-hidden="true"
        >
          {pendentes}
        </span>
      ) : null}
    </button>
  );
}
