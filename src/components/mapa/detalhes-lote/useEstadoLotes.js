import { useCallback, useMemo, useState } from 'react';
import {
  SECOES_LOTE,
  filtrarPorAlerta,
  opcoesDeAlerta,
  ordenarLotes,
} from '@/components/mapa/detalhes-lote/catalogo';

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').LoteVm} LoteVm */
/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */
/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').OpcaoAlerta} OpcaoAlerta */
/** @typedef {'resumo'|'lote'|'lista'} Vista */
/** @typedef {'todos'|'com'|'pesagem'|'intervalo'} FiltroAlerta */
/** @typedef {{ chave: string|null, dir: 1|-1 }} Ordenacao */

/**
 * @typedef {{
 *   vista: Vista, setVista: (v: Vista) => void,
 *   secoes: string[], alternarSecao: (s: string) => void, alternarTodas: () => void,
 *   alerta: FiltroAlerta, setAlerta: (a: FiltroAlerta) => void, opcoesAlerta: OpcaoAlerta[],
 *   alertaAtivo: boolean, textoAlerta: string,
 *   popupAberto: boolean, setPopupAberto: (b: boolean) => void,
 *   ordenar: Ordenacao, ordenarPor: (chave: string) => void,
 *   lotesVisiveis: LoteVm[],
 *   loteAtivo: LoteVm|null, indiceAtivo: number, irLote: (id: string) => void, passoLote: (passo: number) => boolean,
 *   loteExpandido: string|null, alternarExpandido: (id: string) => void, expandido: (id: string) => boolean,
 *   topicosAbertos: Record<string, boolean>, alternarTopico: (titulo: string) => void,
 *   abrirLoteNaVista: (id: string) => void,
 * }} EstadoLotes
 */

/**
 * Estado da aba Lotes (vista, filtro de informações e de alerta, ordenação,
 * lote ativo, acordeão e tópicos). Mesma lógica do mockup v8 (`seletor`,
 * `filtroAlertas`, `ordenados`, `tab.nav`, `tab.escolha`, `vistaCel`).
 *
 * As seções marcadas em INFORMAÇÕES são PREFERÊNCIA DO USUÁRIO (fazenda + conta +
 * empresa, ver ./preferencias.js): chegam de fora em `secoes` e cada mudança vai
 * para `aoMudarSecoes`, que grava. O filtro de alerta e a vista não são
 * preferência: começam sempre em "Todos os lotes" e em Resumo (pedido do dono).
 *
 * @param {{ modelo: ModeloDetalhes, celular?: boolean, secoes: string[], aoMudarSecoes: (secoes: string[]) => void }} params
 * @returns {EstadoLotes}
 */
export function useEstadoLotes({ modelo, secoes: secoesPref, aoMudarSecoes }) {
  const lotes = useMemo(() => /** @type {LoteVm[]} */ (modelo?.lotes || []), [modelo]);
  const temVarios = !!modelo?.temVarios;

  // Vista: sempre começa em Resumo, nos três modos (o Painel volta para Resumo
  // a cada entrada na aba Lotes).
  const [vista, setVistaEstado] = useState(/** @type {Vista} */ ('resumo'));
  const setVista = useCallback((/** @type {Vista} */ v) => setVistaEstado(v), []);

  // Seções marcadas em INFORMAÇÕES (preferência do usuário; padrão: todas).
  const secoes = useMemo(() => SECOES_LOTE.filter((x) => (secoesPref || []).includes(x)), [secoesPref]);
  const alternarSecao = useCallback((/** @type {string} */ s) => {
    const marcadas = secoes.includes(s) ? secoes.filter((x) => x !== s) : [...secoes, s];
    aoMudarSecoes(SECOES_LOTE.filter((x) => marcadas.includes(x)));
  }, [secoes, aoMudarSecoes]);
  const alternarTodas = useCallback(() => {
    const tudo = SECOES_LOTE.every((x) => secoes.includes(x));
    aoMudarSecoes(tudo ? [] : [...SECOES_LOTE]);
  }, [secoes, aoMudarSecoes]);

  // Filtro de alerta (escolha única).
  const [alertaEscolhido, setAlertaEscolhido] = useState(/** @type {FiltroAlerta} */ ('todos'));
  const opcoesAlerta = useMemo(() => /** @type {OpcaoAlerta[]} */ (opcoesDeAlerta(lotes)), [lotes]);
  // Se o tipo escolhido sumiu dos dados, volta para "todos" (não filtra por algo invisível).
  const opcaoSel = opcoesAlerta.find((o) => o.id === alertaEscolhido) || null;
  const alerta = /** @type {FiltroAlerta} */ (opcaoSel ? alertaEscolhido : 'todos');
  const alertaAtivo = alerta !== 'todos';
  const textoAlerta = opcaoSel && alertaAtivo ? `${opcaoSel.rotulo} (${opcaoSel.qtd})` : 'Todos os lotes';
  const setAlerta = useCallback((/** @type {FiltroAlerta} */ a) => setAlertaEscolhido(a), []);

  const [popupAberto, setPopupAbertoState] = useState(false);
  const setPopupAberto = useCallback((/** @type {boolean} */ b) => setPopupAbertoState(!!b), []);

  // Ordenação por coluna (só a Lista usa): 'nome' começa asc; coluna nova desc; mesma coluna inverte.
  const [ordenar, setOrdenar] = useState(/** @type {Ordenacao} */ ({ chave: 'nome', dir: 1 }));
  const ordenarPor = useCallback((/** @type {string} */ chave) => {
    setOrdenar((o) => {
      if (o.chave === chave) return { chave, dir: o.dir === 1 ? -1 : 1 };
      return { chave, dir: chave === 'nome' ? 1 : -1 };
    });
  }, []);

  const lotesVisiveis = useMemo(() => {
    const filtrados = /** @type {LoteVm[]} */ (filtrarPorAlerta(lotes, alerta));
    const criterio = vista === 'lista'
      ? { porGravidade: false, chave: ordenar.chave, dir: ordenar.dir }
      : { porGravidade: true, chave: 'nome', dir: 1 };
    return /** @type {LoteVm[]} */ (ordenarLotes(filtrados, criterio));
  }, [lotes, alerta, vista, ordenar]);

  // Lote ativo: o escolhido se estiver visível; senão o primeiro.
  const [loteId, setLoteId] = useState(/** @type {string|null} */ (null));
  const indiceEscolhido = loteId == null ? -1 : lotesVisiveis.findIndex((l) => l.id === loteId);
  const indiceAtivo = indiceEscolhido >= 0 ? indiceEscolhido : lotesVisiveis.length ? 0 : -1;
  const loteAtivo = indiceAtivo >= 0 ? lotesVisiveis[indiceAtivo] : null;

  const irLote = useCallback((/** @type {string} */ id) => setLoteId(id), []);
  const passoLote = useCallback((/** @type {number} */ passo) => {
    if (indiceAtivo < 0) return false;
    const alvo = lotesVisiveis[indiceAtivo + (passo > 0 ? 1 : -1)];
    if (!alvo) return false;
    setLoteId(alvo.id);
    return true;
  }, [indiceAtivo, lotesVisiveis]);

  // Acordeão do Resumo: um por vez; com 1 lote só, sempre expandido.
  const [loteExpandido, setLoteExpandido] = useState(/** @type {string|null} */ (null));
  const alternarExpandido = useCallback((/** @type {string} */ id) => {
    setLoteExpandido((atual) => (atual === id ? null : id));
    setLoteId(id);
  }, []);
  const expandido = useCallback(
    (/** @type {string} */ id) => !temVarios || loteExpandido === id,
    [temVarios, loteExpandido],
  );

  // Tópicos recolhíveis do card (vale para todos os lotes).
  const [topicosAbertos, setTopicosAbertos] = useState(/** @type {Record<string, boolean>} */ ({}));
  const alternarTopico = useCallback((/** @type {string} */ titulo) => {
    setTopicosAbertos((t) => ({ ...t, [titulo]: !t[titulo] }));
  }, []);

  // Vindo do Tudo (celular): abre a vista Lote naquele lote. Se o filtro de alerta
  // o esconderia, limpa o filtro para não mostrar outro lote no lugar.
  const abrirLoteNaVista = useCallback((/** @type {string} */ id) => {
    const visivel = /** @type {LoteVm[]} */ (filtrarPorAlerta(lotes, alerta)).some((l) => l.id === id);
    if (!visivel) setAlertaEscolhido('todos');
    setVistaEstado('lote');
    setLoteId(id);
    setPopupAbertoState(false);
  }, [lotes, alerta]);

  return {
    vista, setVista,
    secoes, alternarSecao, alternarTodas,
    alerta, setAlerta, opcoesAlerta, alertaAtivo, textoAlerta,
    popupAberto, setPopupAberto,
    ordenar, ordenarPor,
    lotesVisiveis,
    loteAtivo, indiceAtivo, irLote, passoLote,
    loteExpandido, alternarExpandido, expandido,
    topicosAbertos, alternarTopico,
    abrirLoteNaVista,
  };
}

export default useEstadoLotes;
