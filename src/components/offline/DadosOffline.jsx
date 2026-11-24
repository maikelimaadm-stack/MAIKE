import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CloudDownload, CheckCircle2, WifiOff } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogContent as DialogContentUi } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { useEmpresaSelecionadaId } from '@/hooks/useEmpresaSelecionadaId';
import { isAppNativo } from '@/config/runtimeConfig';
import { useBootSplash } from '@/lib/bootSplashContext';
import { baixarDadosParaOffline, estaSemInternet, ultimaBaixaDosDados } from '@/services/dadosOfflineService';

/** @type {React.ComponentType<any>} */ const DialogContent = DialogContentUi;

/** Abre a janela "Dados sem internet" de qualquer lugar (ex.: menu do usuário). */
export const EVENTO_ABRIR_DADOS_OFFLINE = 'maike:abrir-dados-offline';
export const abrirDadosOffline = () => {
  try {
    window.dispatchEvent(new Event(EVENTO_ABRIR_DADOS_OFFLINE));
  } catch {
    // sem window: nada a abrir
  }
};

/** Com internet, o app atualiza sozinho (em segundo plano) depois deste tempo. */
const ATUALIZAR_SOZINHO_APOS_MS = 6 * 60 * 60 * 1000;

const formatarQuando = (ms) =>
  ms
    ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;

/**
 * D-PROD-289 — "Baixar dados para usar sem internet".
 *
 * - A primeira baixa no app é feita pela tela de preparo (`PreparoDoApp`),
 *   antes de o sistema abrir.
 * - Depois, com internet, sincroniza sozinho por baixo a cada 6 h.
 * - O menu do usuário ("Dados sem internet") abre esta janela para atualizar
 *   na hora e ver quando foi a última vez.
 */
export default function DadosOffline() {
  const { isAuthenticated, clienteId } = useAuth();
  const empresaId = useEmpresaSelecionadaId();
  // Só pergunta depois que a tela de abertura sai (senão a janela fica por baixo dela).
  const { layoutBootReady } = useBootSplash();
  const [aberto, setAberto] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [progresso, setProgresso] = useState(/** @type {null | {titulo: string, feitas: number, total: number}} */ (null));
  const [resultado, setResultado] = useState(/** @type {null | {ok: boolean, falhas: number, em: number|null}} */ (null));
  const [ultima, setUltima] = useState(/** @type {number|null} */ (null));
  const emSegundoPlano = useRef(false);

  useEffect(() => {
    setUltima(isAuthenticated ? ultimaBaixaDosDados() : null);
  }, [isAuthenticated, clienteId]);

  const baixar = useCallback(
    async ({ silencioso = false } = {}) => {
      if (baixando || emSegundoPlano.current) return;
      if (!silencioso) {
        setBaixando(true);
        setResultado(null);
      } else {
        emSegundoPlano.current = true;
      }
      try {
        const r = await baixarDadosParaOffline({
          empresaId,
          aoAvancar: silencioso ? undefined : (p) => setProgresso({ titulo: p.titulo, feitas: p.feitas, total: p.total }),
        });
        if (r.em) setUltima(r.em);
        if (!silencioso) setResultado(r);
      } finally {
        if (!silencioso) {
          setBaixando(false);
          setProgresso(null);
        }
        emSegundoPlano.current = false;
      }
    },
    [baixando, empresaId]
  );

  // Abrir pelo menu.
  useEffect(() => {
    const abrir = () => {
      setResultado(null);
      setAberto(true);
    };
    window.addEventListener(EVENTO_ABRIR_DADOS_OFFLINE, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_DADOS_OFFLINE, abrir);
  }, []);

  // Sincronização (D-PROD-289): já preparado, com internet, atualiza por baixo
  // a cada 6 h (na abertura e enquanto o app fica aberto). A PRIMEIRA baixa é
  // da tela de preparo (`PreparoDoApp`), antes de o sistema abrir.
  useEffect(() => {
    if (!isAuthenticated || !clienteId || !layoutBootReady || !isAppNativo()) return undefined;
    const talvezSincronizar = () => {
      const anterior = ultimaBaixaDosDados();
      if (!anterior || estaSemInternet()) return;
      if (Date.now() - anterior > ATUALIZAR_SOZINHO_APOS_MS) baixar({ silencioso: true });
    };
    talvezSincronizar();
    const intervalo = window.setInterval(talvezSincronizar, 15 * 60 * 1000);
    window.addEventListener('online', talvezSincronizar);
    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener('online', talvezSincronizar);
    };
  }, [isAuthenticated, clienteId, layoutBootReady]);

  if (!isAuthenticated) return null;

  const semInternet = estaSemInternet();
  const percentual = progresso && progresso.total > 0 ? Math.round((progresso.feitas / progresso.total) * 100) : 0;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !baixando && setAberto(v)}>
      <DialogContent className="max-w-sm">
        <div className="flex flex-col space-y-1.5 text-left">
          <DialogPrimitive.Title className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
            <CloudDownload className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Dados para usar sem internet
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-slate-500">
            Baixa o mapa, as áreas, os lotes, os cadastros e as telas já abertas para o app funcionar no campo sem sinal.
          </DialogPrimitive.Description>
        </div>

        <p className="text-sm text-slate-600">
          {ultima ? <>Última vez: <strong>{formatarQuando(ultima)}</strong></> : 'Os dados ainda não foram baixados neste aparelho.'}
        </p>

        {baixando && progresso && (
          <div className="space-y-1.5" aria-live="polite">
            <p className="text-sm font-medium text-slate-800">
              Baixando: {progresso.titulo} ({progresso.feitas}/{progresso.total})
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentual}>
              <div className="h-full bg-emerald-600 transition-all" style={{ width: `${percentual}%` }} />
            </div>
          </div>
        )}

        {resultado && !baixando && (
          <p className={`flex items-center gap-1.5 text-sm ${resultado.ok ? 'text-emerald-700' : 'text-amber-700'}`} role="status">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {resultado.ok ? 'Pronto! Dados baixados.' : `Baixado, mas ${resultado.falhas} parte(s) não vieram. Tente de novo depois.`}
          </p>
        )}

        {semInternet && !baixando && (
          <p className="flex items-center gap-1.5 text-sm text-amber-700">
            <WifiOff className="h-4 w-4" aria-hidden="true" />
            Sem internet agora. Conecte para baixar.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" disabled={baixando} onClick={() => setAberto(false)}>
            {resultado ? 'Fechar' : 'Depois'}
          </Button>
          <Button type="button" className="bg-emerald-600 hover:bg-emerald-700" disabled={baixando || semInternet} onClick={() => baixar()}>
            {baixando ? 'Baixando…' : ultima ? 'Atualizar dados' : 'Baixar agora'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
