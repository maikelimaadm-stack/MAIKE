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
import { MessageCircle, Send, X, Loader2, Square, Filter, FilterX } from 'lucide-react';
import { perguntarAssistenteAoVivo } from '@/services/assistenteService';
import { getApiErrorMessage } from '@/apis/_core/ApiError';
import TextoAssistente from '@/components/assistente/TextoAssistente';
import { TELAS_COM_FILTRO, avisarFiltroDoAssistente, urlDoFiltro } from '@/domain/assistente/filtroTela';

/** Quantas falas anteriores vão como contexto (o servidor aceita até 10). */
export const MAX_HISTORICO = 10;

/** O que mostrar enquanto cada consulta roda. */
const STATUS_FERRAMENTA = {
  listar_pastos: 'Consultando os pastos…',
  medicoes_do_pasto: 'Consultando as medições do pasto…',
  rebanho_por_pasto: 'Consultando o rebanho por pasto…',
  resumo_rebanho: 'Consultando o rebanho…',
  leituras_cocho_recentes: 'Consultando as leituras de cocho…',
  resumo_agrupado: 'Somando os dados…',
  calcular: 'Fazendo as contas…',
  aplicar_filtro_tela: 'Montando o filtro…',
};

/** Texto do botão de cada tela filtrável. */
const ROTULO_APLICAR = { MapaGeral: 'Aplicar no Mapa', CadastroLotes: 'Ver lotes filtrados' };

/**
 * Ações de filtro válidas vindas do servidor (o resto é ignorado).
 * @param {any} acoes
 * @returns {Array<{ tela: string, filtros: Record<string, any>, resumo: string, aplicar_agora: boolean, nome_tela: string }>}
 */
const acoesValidas = (acoes) =>
  (Array.isArray(acoes) ? acoes : [])
    .filter((a) => a && a.tipo === 'filtro_tela' && TELAS_COM_FILTRO.includes(a.tela))
    .map((a) => ({
      tela: a.tela,
      filtros: a.filtros && typeof a.filtros === 'object' ? a.filtros : {},
      resumo: typeof a.resumo === 'string' ? a.resumo.slice(0, 300) : '',
      aplicar_agora: a.aplicar_agora === true,
      nome_tela: typeof a.nome_tela === 'string' ? a.nome_tela : a.tela,
    }))
    .slice(-3);

const SUGESTOES = ['Quais pastos estão prontos?', 'Quantas cabeças tenho hoje?', 'Quais pastos estão sem medição recente?'];

/** Sem roteador (testes, telas fora do shell): navegação normal do navegador. @param {string} url */
const navegarPadrao = (url) => window.location.assign(url);

/**
 * @param {{ empresaId: string|null, tela?: string|null, comNavInferior?: boolean, navegar?: (url: string) => void }} props
 */
export default function AssistenteFlutuante({ empresaId, tela = null, comNavInferior = false, navegar = navegarPadrao }) {
  const [aberto, setAberto] = useState(false);
  const [falas, setFalas] = useState(/** @type {Array<{papel: 'usuario'|'assistente', texto: string, erro?: boolean, acoes?: ReturnType<typeof acoesValidas>, aplicada?: number}>} */ ([]));
  const [texto, setTexto] = useState('');
  const [carregando, setCarregando] = useState(false);
  // Resposta em andamento (texto que já chegou) e a consulta que está rodando.
  const [parcial, setParcial] = useState('');
  const [status, setStatus] = useState('');
  const cancelarRef = useRef(/** @type {AbortController|null} */ (null));
  const fimRef = useRef(/** @type {HTMLDivElement|null} */ (null));

  // A conversa é de UMA fazenda: trocar a fazenda no topo começa outra, e uma resposta
  // ainda em andamento da fazenda anterior é descartada.
  const empresaAtualRef = useRef(empresaId);
  useEffect(() => {
    empresaAtualRef.current = empresaId;
    cancelarRef.current?.abort();
    cancelarRef.current = null;
    setFalas([]);
    setParcial('');
    setStatus('');
    setCarregando(false);
  }, [empresaId]);

  useEffect(() => {
    fimRef.current?.scrollIntoView?.({ block: 'end' });
  }, [falas, carregando, aberto, parcial, status]);

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
    setParcial('');
    setStatus('Pensando…');
    const empresaDaPergunta = empresaId;
    const aindaMesmaFazenda = () => empresaAtualRef.current === empresaDaPergunta;
    const cancelar = new AbortController();
    cancelarRef.current = cancelar;
    let juntou = '';
    try {
      const r = await perguntarAssistenteAoVivo(
        { empresa_id: empresaId, pergunta: p.slice(0, 1000), tela, historico },
        {
          signal: cancelar.signal,
          aoTexto: (pedaco) => {
            if (!aindaMesmaFazenda() || cancelar.signal.aborted) return;
            juntou += pedaco;
            setParcial(juntou);
            setStatus('');
          },
          aoFerramenta: (nome) => {
            if (!aindaMesmaFazenda() || cancelar.signal.aborted) return;
            setStatus(STATUS_FERRAMENTA[nome] ?? 'Consultando os dados…');
          },
        },
      );
      if (aindaMesmaFazenda()) {
        const acoes = acoesValidas(r?.acoes);
        // Pedido explícito ("aplica", "mostra no mapa"): aplica já o último filtro.
        const automatica = acoes.length && acoes[acoes.length - 1].aplicar_agora ? acoes.length - 1 : undefined;
        setFalas((f) => [...f, { papel: 'assistente', texto: r?.resposta || 'Sem resposta.', acoes, aplicada: automatica }]);
        if (automatica !== undefined) irPara(acoes[automatica]);
      }
    } catch (erro) {
      if (!aindaMesmaFazenda()) return;
      if (cancelar.signal.aborted) {
        // Parado por quem perguntou: fica o que já tinha chegado, marcado como interrompido.
        setFalas((f) => [...f, { papel: 'assistente', texto: juntou ? `${juntou}\n\n(resposta interrompida)` : 'Resposta interrompida.', erro: !juntou }]);
      } else {
        setFalas((f) => [...f, { papel: 'assistente', texto: getApiErrorMessage(erro, 'Não consegui consultar agora. Tente de novo.'), erro: true }]);
      }
    } finally {
      if (aindaMesmaFazenda()) {
        if (cancelarRef.current === cancelar) cancelarRef.current = null;
        setParcial('');
        setStatus('');
        setCarregando(false);
      }
    }
  };

  const parar = () => cancelarRef.current?.abort();

  /** Abre a tela com o filtro (ou sem filtro nenhum, para limpar). @param {{ tela: string, filtros: Record<string, any> }} acao */
  const irPara = (acao) => {
    navegar(urlDoFiltro(acao));
    // A tela pode já estar aberta: avisa depois que a URL mudou.
    setTimeout(avisarFiltroDoAssistente, 0);
  };

  /** @param {number} indiceFala @param {number} indiceAcao */
  const aplicar = (indiceFala, indiceAcao) => {
    const acao = falas[indiceFala]?.acoes?.[indiceAcao];
    if (!acao) return;
    setFalas((f) => f.map((fala, i) => (i === indiceFala ? { ...fala, aplicada: indiceAcao } : fala)));
    irPara(acao);
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
                  {f.papel === 'assistente' && !f.erro ? <TextoAssistente texto={f.texto} /> : f.texto}
                  {f.acoes?.length ? (
                    <div className="mt-2 space-y-2" data-testid="assistente-acoes">
                      {f.acoes.map((acao, j) =>
                        f.aplicada === j ? (
                          <div key={j} className="rounded-lg border bg-white px-2 py-1.5 text-xs text-slate-700" data-testid="assistente-filtro-aplicado">
                            <p>
                              <strong>Filtro aplicado em {acao.nome_tela}:</strong> {acao.resumo}
                            </p>
                            <div className="mt-1 flex gap-2">
                              <button type="button" data-testid="assistente-filtro-reaplicar" onClick={() => aplicar(i, j)} className="inline-flex items-center gap-1 font-medium" style={{ color: '#15803D' }}>
                                <Filter size={12} aria-hidden /> Abrir de novo
                              </button>
                              <button type="button" data-testid="assistente-filtro-limpar" onClick={() => irPara({ tela: acao.tela, filtros: {} })} className="inline-flex items-center gap-1 font-medium text-slate-600">
                                <FilterX size={12} aria-hidden /> Limpar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            key={j}
                            type="button"
                            data-testid="assistente-aplicar-filtro"
                            onClick={() => aplicar(i, j)}
                            title={acao.resumo}
                            className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white"
                            style={{ background: '#16A34A' }}>
                            <Filter size={14} aria-hidden /> {ROTULO_APLICAR[acao.tela] ?? `Abrir ${acao.nome_tela}`}
                          </button>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {carregando && parcial ? (
              <div className="flex justify-start">
                <div
                  data-testid="assistente-fala-parcial"
                  aria-live="polite"
                  className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm"
                  style={{ background: '#F1F5F9', color: '#0F172A' }}>
                  <TextoAssistente texto={parcial} />
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm align-middle" style={{ background: '#16A34A' }} aria-hidden />
                </div>
              </div>
            ) : null}
            {carregando && !parcial ? (
              <div className="flex items-center gap-2 text-sm text-slate-500" data-testid="assistente-carregando" aria-live="polite">
                <Loader2 size={16} className="animate-spin" aria-hidden /> <span data-testid="assistente-status">{status || 'Consultando os dados…'}</span>
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
            {carregando ? (
              <button
                type="button"
                data-testid="assistente-parar"
                aria-label="Parar a resposta"
                onClick={parar}
                className="flex h-11 w-11 items-center justify-center rounded-full border text-slate-700 hover:bg-slate-50">
                <Square size={16} aria-hidden />
              </button>
            ) : (
              <button
                type="submit"
                data-testid="assistente-enviar"
                aria-label="Enviar"
                disabled={!texto.trim()}
                className="flex h-11 w-11 items-center justify-center rounded-full text-white disabled:opacity-50"
                style={{ background: '#16A34A' }}>
                <Send size={18} aria-hidden />
              </button>
            )}
          </form>
        </section>
      ) : null}
    </>
  );
}
