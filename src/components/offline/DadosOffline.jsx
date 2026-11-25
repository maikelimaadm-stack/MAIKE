import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogContent as DialogContentUi } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { useEmpresaSelecionadaId } from '@/hooks/useEmpresaSelecionadaId';
import { isAppNativo } from '@/config/runtimeConfig';
import { useBootSplash } from '@/lib/bootSplashContext';
import { baixarDadosParaOffline, estaSemInternet, situacaoDaBaixa, ultimaBaixaDosDados } from '@/services/dadosOfflineService';
import { enviarAgora, ligarEnvioDaSessao } from '@/services/sincronizacaoService';
import FilaDeEnvio from '@/components/offline/FilaDeEnvio';

/** @type {React.ComponentType<any>} */ const DialogContent = DialogContentUi;

/** Abre a janela "Sincronização" de qualquer lugar (menu do usuário, ícone do topo). */
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
 * D-PROD-294 — "Baixar dados para usar sem internet".
 *
 * - A primeira baixa no app é feita pela tela de preparo (`PreparoDoApp`),
 *   antes de o sistema abrir.
 * - Depois, com internet, sincroniza sozinho por baixo a cada 6 h.
 * - D-PROD-301: virou a janela "Sincronização" (menu do usuário e ícone do
 *   topo): internet, o que espera envio, como veio cada parte da última baixa
 *   e "Sincronizar agora" (envia e baixa).
 */
export default function DadosOffline() {
  const { isAuthenticated, clienteId, user } = useAuth();
  const empresaId = useEmpresaSelecionadaId();
  // Só pergunta depois que a tela de abertura sai (senão a janela fica por baixo dela).
  const { layoutBootReady } = useBootSplash();
  const [aberto, setAberto] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [progresso, setProgresso] = useState(/** @type {null | {titulo: string, feitas: number, total: number}} */ (null));
  const [resultado, setResultado] = useState(/** @type {null | {ok: boolean, falhas: number, em: number|null}} */ (null));
  const [ultima, setUltima] = useState(/** @type {number|null} */ (null));
  const [partes, setPartes] = useState(/** @type {ReturnType<typeof situacaoDaBaixa>} */ (null));
  const [semInternet, setSemInternet] = useState(estaSemInternet);
  const emSegundoPlano = useRef(false);

  useEffect(() => {
    setUltima(isAuthenticated ? ultimaBaixaDosDados() : null);
    setPartes(isAuthenticated ? situacaoDaBaixa() : null);
  }, [isAuthenticated, clienteId]);

  useEffect(() => {
    const atualizar = () => setSemInternet(estaSemInternet());
    window.addEventListener('online', atualizar);
    window.addEventListener('offline', atualizar);
    return () => {
      window.removeEventListener('online', atualizar);
      window.removeEventListener('offline', atualizar);
    };
  }, []);

  // D-PROD-295: a fila de envio é desta conta nesta fazenda; sem sessão, nada vai ao servidor.
  const usuarioId = user?.id ? String(user.id) : null;
  useEffect(() => {
    ligarEnvioDaSessao(isAuthenticated && clienteId ? { clienteId, usuarioId } : null);
    return () => ligarEnvioDaSessao(null);
  }, [isAuthenticated, clienteId, usuarioId]);

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
        setPartes(situacaoDaBaixa());
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

  // D-PROD-301: "Sincronizar agora" = envia o que está no celular e baixa tudo de novo.
  const sincronizarAgora = useCallback(async () => {
    try {
      await enviarAgora();
    } catch {
      // o que não subiu fica na fila, com o motivo
    }
    await baixar();
  }, [baixar]);

  // Abrir pelo menu.
  useEffect(() => {
    const abrir = () => {
      setResultado(null);
      setAberto(true);
    };
    window.addEventListener(EVENTO_ABRIR_DADOS_OFFLINE, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_DADOS_OFFLINE, abrir);
  }, []);

  // Sincronização (D-PROD-294): já preparado, com internet, atualiza por baixo
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

  const percentual = progresso && progresso.total > 0 ? Math.round((progresso.feitas / progresso.total) * 100) : 0;

  /** @type {Array<[string, string]>} */
  const NOMES_DAS_PARTES = [
    ['mapa', 'Mapa (áreas, lotes, cochos, depósitos, estoque)'],
    ['cadastros', 'Cadastros'],
    ['telas', 'Telas e formulários'],
  ];

  return (
    <Dialog open={aberto} onOpenChange={(v) => !baixando && setAberto(v)}>
      <DialogContent className="max-w-sm">
        <div className="flex flex-col space-y-1.5 text-left">
          <DialogPrimitive.Title className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
            <RefreshCw className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Sincronização
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-slate-500">
            O que foi feito sem internet sobe sozinho quando o sinal volta. Aqui você vê o que falta e atualiza os dados do celular.
          </DialogPrimitive.Description>
        </div>

        <p className={`flex items-center gap-1.5 text-sm font-medium ${semInternet ? 'text-slate-600' : 'text-emerald-700'}`} data-testid="sincronizacao-conexao">
          {semInternet ? <WifiOff className="h-4 w-4" aria-hidden="true" /> : <Wifi className="h-4 w-4" aria-hidden="true" />}
          {semInternet ? 'Sem internet agora: o app guarda tudo no celular.' : 'Com internet.'}
        </p>

        <div className="space-y-1.5 border-t border-slate-100 pt-3">
          <p className="text-sm font-semibold text-slate-800">Envio</p>
          <FilaDeEnvio />
        </div>

        <div className="space-y-1.5 border-t border-slate-100 pt-3">
          <p className="text-sm font-semibold text-slate-800">Dados no celular</p>
          {!ultima ? (
            <p className="text-sm text-slate-600">Os dados ainda não foram baixados neste aparelho.</p>
          ) : (
            <ul className="space-y-1" data-testid="sincronizacao-partes">
              {NOMES_DAS_PARTES.map(([chave, nome]) => {
                const parte = partes?.[/** @type {'mapa'|'cadastros'|'telas'} */ (chave)];
                const ok = parte ? parte.falhas === 0 : true;
                const quando = formatarQuando(parte?.em ?? ultima);
                return (
                  <li key={chave} className="flex items-start gap-1.5 text-sm text-slate-700">
                    {ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                    )}
                    <span>
                      {nome}
                      <span className="block text-xs text-slate-500">
                        {ok ? `Baixado em ${quando}` : `${parte?.falhas} de ${parte?.total} não vieram em ${quando}`}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

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
            {resultado.ok ? 'Pronto! Sincronizado.' : `Sincronizado, mas ${resultado.falhas} parte(s) não vieram. Tente de novo depois.`}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" disabled={baixando} onClick={() => setAberto(false)}>
            Fechar
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={baixando || semInternet}
            onClick={() => {
              void sincronizarAgora();
            }}
            data-testid="sincronizar-agora"
          >
            {baixando ? 'Sincronizando…' : semInternet ? 'Sem internet' : 'Sincronizar agora'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
