import React, { useEffect, useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { EVENTO_PROGRESSO_DA_SINCRONIA, lerProgressoDaSincronia } from '@/services/sincronizacaoCompletaService';
import { abrirDadosOffline } from '@/components/offline/DadosOffline';
import '@/styles/mk-sincronia.css';

const RAIO = 20;
const VOLTA = 2 * Math.PI * RAIO;

/**
 * D-PROD-329 — o círculo pequeno no canto com a porcentagem da sincronização (envia e baixa). A pessoa continua
 * usando o app; tocar abre a janela "Sincronização". No fim mostra ✓ (ou ! se parte não veio) e some.
 */
export default function CirculoDeSincronizacao() {
  const [p, setP] = useState(lerProgressoDaSincronia);

  useEffect(() => {
    const ouvir = (/** @type {Event} */ e) => setP({ .../** @type {CustomEvent} */ (e).detail });
    window.addEventListener(EVENTO_PROGRESSO_DA_SINCRONIA, ouvir);
    setP(lerProgressoDaSincronia());
    return () => window.removeEventListener(EVENTO_PROGRESSO_DA_SINCRONIA, ouvir);
  }, []);

  if (!p.ativo) return null;
  const pronto = p.fase === 'pronto';
  const incompleto = p.fase === 'incompleto';
  const cor = incompleto ? '#d97706' : '#059669';
  const rotulo = pronto || incompleto ? p.titulo : `${p.titulo} — ${p.percentual}%`;

  return (
    <button
      type="button"
      className="mk-circulo-sincronia"
      onClick={abrirDadosOffline}
      title={rotulo}
      aria-label={`Sincronização: ${rotulo}. Toque para ver.`}
      data-fase={p.fase ?? ''}
    >
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r={RAIO} fill="none" stroke="#e2e8f0" strokeWidth="5" />
        <circle
          cx="26"
          cy="26"
          r={RAIO}
          fill="none"
          stroke={cor}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={VOLTA}
          strokeDashoffset={VOLTA * (1 - p.percentual / 100)}
          transform="rotate(-90 26 26)"
          style={{ transition: 'stroke-dashoffset 300ms ease' }}
        />
      </svg>
      <span className="mk-circulo-sincronia__texto" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percentual}>
        {pronto ? <Check size={18} color={cor} aria-hidden="true" /> : incompleto ? <AlertTriangle size={16} color={cor} aria-hidden="true" /> : `${p.percentual}%`}
      </span>
    </button>
  );
}
