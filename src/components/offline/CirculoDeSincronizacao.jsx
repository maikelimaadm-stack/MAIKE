import React, { useEffect, useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { EVENTO_PROGRESSO_DA_SINCRONIA, lerProgressoDaSincronia } from '@/services/sincronizacaoCompletaService';
import { abrirDadosOffline } from '@/components/offline/DadosOffline';
import '@/styles/mk-sincronia.css';

const RAIO = 34;
const VOLTA = 2 * Math.PI * RAIO;

/**
 * D-PROD-329 / D-PROD-331 — a sincronização (envia e baixa) num cartão NO MEIO DA TELA: o círculo grande com a
 * porcentagem e o que está fazendo. Sem fundo escuro: a pessoa continua usando o app em volta. Tocar no cartão abre
 * a janela "Sincronização"; no fim mostra ✓ (ou ! se parte não veio) e some sozinho.
 *
 * D-PROD-380 (como o AgriWebb): só quando a PESSOA pediu ("Sincronizar agora"). A sincronização automática roda por
 * baixo, sem cartão: o ícone do topo mostra quantos registros faltam enviar.
 */
export default function CirculoDeSincronizacao() {
  const [p, setP] = useState(lerProgressoDaSincronia);

  useEffect(() => {
    const ouvir = (/** @type {Event} */ e) => setP({ .../** @type {CustomEvent} */ (e).detail });
    window.addEventListener(EVENTO_PROGRESSO_DA_SINCRONIA, ouvir);
    setP(lerProgressoDaSincronia());
    return () => window.removeEventListener(EVENTO_PROGRESSO_DA_SINCRONIA, ouvir);
  }, []);

  if (!p.ativo || !p.visivel) return null;
  const pronto = p.fase === 'pronto';
  const incompleto = p.fase === 'incompleto';
  const cor = incompleto ? '#d97706' : '#059669';
  const rotulo = pronto || incompleto ? p.titulo : `${p.titulo} — ${p.percentual}%`;

  return (
    <button
      type="button"
      className="mk-circulo-sincronia"
      onClick={abrirDadosOffline}
      aria-label={`Sincronização: ${rotulo}. Toque para ver.`}
      data-fase={p.fase ?? ''}
    >
      <span className="mk-circulo-sincronia__anel">
        <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
          <circle cx="42" cy="42" r={RAIO} fill="none" stroke="#e2e8f0" strokeWidth="7" />
          <circle
            cx="42"
            cy="42"
            r={RAIO}
            fill="none"
            stroke={cor}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={VOLTA}
            strokeDashoffset={VOLTA * (1 - p.percentual / 100)}
            transform="rotate(-90 42 42)"
            style={{ transition: 'stroke-dashoffset 300ms ease' }}
          />
        </svg>
        <span className="mk-circulo-sincronia__texto" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percentual}>
          {pronto ? <Check size={30} color={cor} aria-hidden="true" /> : incompleto ? <AlertTriangle size={26} color={cor} aria-hidden="true" /> : `${p.percentual}%`}
        </span>
      </span>
      <span className="mk-circulo-sincronia__titulo">{pronto || incompleto ? p.titulo : 'Sincronizando'}</span>
      {!pronto && !incompleto ? <span className="mk-circulo-sincronia__etapa">{p.titulo}</span> : null}
    </button>
  );
}
