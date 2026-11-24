import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { baixarDadosParaOffline, estaSemInternet, garantirEmpresaSelecionada } from '@/services/dadosOfflineService';

const ETAPAS = [
  { id: 'mapa', titulo: 'Mapa, áreas e lotes' },
  { id: 'cadastros', titulo: 'Cadastros' },
  { id: 'telas', titulo: 'Telas do sistema' },
];

/**
 * D-PROD-291 — primeira entrada no app: baixa tudo ANTES de abrir o sistema.
 *
 * Tela cheia, com o andamento por etapa. Termina sozinha e abre o app. Sem
 * internet ou com falha, explica e deixa tentar de novo ou abrir assim mesmo.
 * Depois desta vez, o app abre direto e só sincroniza por baixo.
 *
 * @param {{ aoConcluir: () => void }} props
 */
export default function PreparoDoApp({ aoConcluir }) {
  const { clienteId } = useAuth();
  const [etapaAtual, setEtapaAtual] = useState(/** @type {string|null} */ (null));
  const [feitas, setFeitas] = useState({ feitas: 0, total: 0 });
  const [situacao, setSituacao] = useState(/** @type {'baixando'|'sem-internet'|'parcial'} */ ('baixando'));
  const [falhas, setFalhas] = useState(0);
  const rodando = useRef(false);

  const preparar = useCallback(async () => {
    if (rodando.current) return;
    if (estaSemInternet()) {
      setSituacao('sem-internet');
      return;
    }
    rodando.current = true;
    setSituacao('baixando');
    setEtapaAtual('mapa');
    try {
      const empresaId = await garantirEmpresaSelecionada(clienteId);
      const r = await baixarDadosParaOffline({
        empresaId,
        aoAvancar: (p) => {
          setEtapaAtual(p.etapa);
          setFeitas({ feitas: p.feitas, total: p.total });
        },
      });
      if (!r.em) {
        setSituacao('sem-internet');
        return;
      }
      if (r.ok) {
        aoConcluir();
        return;
      }
      setFalhas(r.falhas);
      setSituacao('parcial');
    } finally {
      rodando.current = false;
    }
  }, [clienteId, aoConcluir]);

  useEffect(() => {
    preparar();
  }, [preparar]);

  const indiceAtual = ETAPAS.findIndex((e) => e.id === etapaAtual);
  const percentualEtapa = feitas.total > 0 ? feitas.feitas / feitas.total : 0;
  const percentual = Math.round(((Math.max(indiceAtual, 0) + percentualEtapa) / ETAPAS.length) * 100);

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-white px-6" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <img src="/brand/mak-gestao-logo.png" alt="MAK Gestão" className="mb-6 h-24 w-auto" />
      <h1 className="text-center text-lg font-semibold text-slate-900">Preparando o app para usar no campo</h1>
      <p className="mt-1 max-w-xs text-center text-sm text-slate-500">
        Só desta vez: baixando os dados para o app funcionar também sem internet.
      </p>

      <ul className="mt-6 w-full max-w-xs space-y-2.5">
        {ETAPAS.map((etapa, i) => {
          const feita = situacao !== 'sem-internet' && (i < indiceAtual || (situacao === 'parcial' && i <= indiceAtual));
          const agora = situacao === 'baixando' && i === indiceAtual;
          return (
            <li key={etapa.id} className="flex items-center gap-2.5 text-sm">
              {feita ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
              ) : agora ? (
                <Loader2 className="h-5 w-5 animate-spin text-emerald-600" aria-hidden="true" />
              ) : (
                <Circle className="h-5 w-5 text-slate-300" aria-hidden="true" />
              )}
              <span className={agora ? 'font-semibold text-slate-900' : 'text-slate-600'}>
                {etapa.titulo}
                {agora && feitas.total > 0 ? ` (${feitas.feitas}/${feitas.total})` : ''}
              </span>
            </li>
          );
        })}
      </ul>

      {situacao === 'baixando' && (
        <div
          className="mt-6 h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentual}
          aria-label="Andamento do preparo"
        >
          <div className="h-full bg-emerald-600 transition-all" style={{ width: `${percentual}%` }} />
        </div>
      )}

      {situacao === 'sem-internet' && (
        <p className="mt-6 flex max-w-xs items-center gap-2 text-sm text-amber-700" role="status">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          Sem internet. Conecte para preparar o app.
        </p>
      )}
      {situacao === 'parcial' && (
        <p className="mt-6 max-w-xs text-center text-sm text-amber-700" role="status">
          {falhas} parte(s) não vieram. Tente de novo ou abra assim mesmo.
        </p>
      )}

      {situacao !== 'baixando' && (
        <div className="mt-4 flex w-full max-w-xs flex-col gap-2">
          <Button type="button" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => preparar()}>
            Tentar de novo
          </Button>
          <Button type="button" variant="outline" onClick={aoConcluir}>
            Abrir assim mesmo
          </Button>
        </div>
      )}
    </div>
  );
}
