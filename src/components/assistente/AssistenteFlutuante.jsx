/**
 * D-PROD-230 — Assistente só de leitura: botão flutuante em TODAS as telas logadas.
 *
 * Montado uma vez no Layout (o shell só existe com sessão: login e telas públicas não
 * têm o botão). A conversa fica no estado deste componente, que vive enquanto o Layout
 * vive: navegar entre telas não apaga; recarregar a página, sim. Nada vai para o banco.
 * Celular: painel de baixo (bottom sheet), acima da navegação inferior. Desktop: painel
 * lateral à direita.
 */
import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X, Loader2 } from 'lucide-react';
import { perguntarAssistente } from '@/services/assistenteService';
import { getApiErrorMessage } from '@/apis/_core/ApiError';

/** Quantas falas anteriores vão como contexto (o servidor aceita até 10). */
export const MAX_HISTORICO = 10;

const SUGESTOES = ['Quais pastos estão prontos?', 'Quantas cabeças tenho hoje?', 'Quais pastos estão sem medição recente?'];

/**
 * @param {{ empresaId: string|null, tela?: string|null, comNavInferior?: boolean }} props
 */
export default function AssistenteFlutuante({ empresaId, tela = null, comNavInferior = false }) {
  const [aberto, setAberto] = useState(false);
  const [falas, setFalas] = useState(/** @type {Array<{papel: 'usuario'|'assistente', texto: string, erro?: boolean}>} */ ([]));
  const [texto, setTexto] = useState('');
  const [carregando, setCarregando] = useState(false);
  const fimRef = useRef(/** @type {HTMLDivElement|null} */ (null));

  // A conversa é de UMA fazenda: trocar a fazenda no topo começa outra, e uma resposta
  // ainda em andamento da fazenda anterior é descartada.
  const empresaAtualRef = useRef(empresaId);
  useEffect(() => {
    empresaAtualRef.current = empresaId;
    setFalas([]);
    setCarregando(false);
  }, [empresaId]);

  useEffect(() => {
    fimRef.current?.scrollIntoView?.({ block: 'end' });
  }, [falas, carregando, aberto]);

  const enviar = async (pergunta) => {
    const p = String(pergunta ?? '').trim();
    if (!p || carregando) return;
    if (!empresaId) {
      setFalas((f) => [...f, { papel: 'usuario', texto: p }, { papel: 'assistente', texto: 'Escolha uma fazenda no topo da tela para eu poder consultar.', erro: true }]);
      setTexto('');
      return;
    }
    const historico = falas.filter((f) => !f.erro).slice(-MAX_HISTORICO).map(({ papel, texto: t }) => ({ papel, texto: t.slice(0, 4000) }));
    setFalas((f) => [...f, { papel: 'usuario', texto: p }]);
    setTexto('');
    setCarregando(true);
    const empresaDaPergunta = empresaId;
    const aindaMesmaFazenda = () => empresaAtualRef.current === empresaDaPergunta;
    try {
      const r = await perguntarAssistente({ empresa_id: empresaId, pergunta: p.slice(0, 1000), tela, historico });
      if (aindaMesmaFazenda()) setFalas((f) => [...f, { papel: 'assistente', texto: r?.resposta || 'Sem resposta.' }]);
    } catch (erro) {
      if (aindaMesmaFazenda()) setFalas((f) => [...f, { papel: 'assistente', texto: getApiErrorMessage(erro, 'Não consegui consultar agora. Tente de novo.'), erro: true }]);
    } finally {
      if (aindaMesmaFazenda()) setCarregando(false);
    }
  };

  const baseBotao = comNavInferior ? 'bottom-[calc(78px+env(safe-area-inset-bottom))]' : 'bottom-5';

  return (
    <>
      {!aberto ? (
        <button
          type="button"
          data-testid="assistente-botao"
          aria-label="Abrir o assistente"
          onClick={() => setAberto(true)}
          className={`fixed right-4 md:bottom-6 md:right-6 ${baseBotao} z-[44] flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg`}
          style={{ background: '#16A34A' }}>
          <MessageCircle size={26} aria-hidden />
        </button>
      ) : null}

      {aberto ? (
        <section
          role="dialog"
          aria-label="Assistente"
          data-testid="assistente-painel"
          className="fixed inset-x-0 bottom-0 z-[60] flex max-h-[80vh] flex-col rounded-t-2xl border bg-white shadow-2xl md:inset-x-auto md:bottom-0 md:right-0 md:top-0 md:max-h-none md:w-[400px] md:rounded-none md:border-l">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Assistente</h2>
              <p className="text-xs text-slate-500">Só consulta os dados da fazenda. Não altera nada.</p>
            </div>
            <button type="button" aria-label="Fechar o assistente" data-testid="assistente-fechar" onClick={() => setAberto(false)} className="rounded-full p-2 text-slate-600 hover:bg-slate-100">
              <X size={20} aria-hidden />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" data-testid="assistente-falas">
            {falas.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-600">Pergunte sobre pastos, rebanho, medições ou cocho. Exemplos:</p>
                {SUGESTOES.map((s) => (
                  <button key={s} type="button" onClick={() => enviar(s)} className="block w-full rounded-lg border px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
            {falas.map((f, i) => (
              <div key={i} className={`flex ${f.papel === 'usuario' ? 'justify-end' : 'justify-start'}`}>
                <div
                  data-testid={f.papel === 'usuario' ? 'assistente-fala-usuario' : 'assistente-fala-resposta'}
                  className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm"
                  style={
                    f.papel === 'usuario'
                      ? { background: '#16A34A', color: '#fff' }
                      : f.erro
                        ? { background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }
                        : { background: '#F1F5F9', color: '#0F172A' }
                  }>
                  {f.texto}
                </div>
              </div>
            ))}
            {carregando ? (
              <div className="flex items-center gap-2 text-sm text-slate-500" data-testid="assistente-carregando">
                <Loader2 size={16} className="animate-spin" aria-hidden /> Consultando os dados…
              </div>
            ) : null}
            <div ref={fimRef} />
          </div>

          <form
            className="flex items-end gap-2 border-t px-3 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]"
            onSubmit={(e) => {
              e.preventDefault();
              enviar(texto);
            }}>
            <textarea
              data-testid="assistente-campo"
              aria-label="Sua pergunta"
              rows={1}
              maxLength={1000}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  enviar(texto);
                }
              }}
              placeholder="Escreva sua pergunta"
              className="min-h-[44px] flex-1 resize-none rounded-xl border px-3 py-2 text-base"
            />
            <button
              type="submit"
              data-testid="assistente-enviar"
              aria-label="Enviar"
              disabled={carregando || !texto.trim()}
              className="flex h-11 w-11 items-center justify-center rounded-full text-white disabled:opacity-50"
              style={{ background: '#16A34A' }}>
              <Send size={18} aria-hidden />
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
