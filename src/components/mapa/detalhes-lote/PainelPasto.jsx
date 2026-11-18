import React from "react";
import { useLancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import { VAZIO } from "./catalogo";
import { PastoCtx, useModoPasto } from "./pastoContexto";
import { Abas, CabecalhoProprio, idsDaAba } from "./blocos";
import RodapePasto from "./RodapePasto";
import AbaDetalhes from "./AbaDetalhes";
import AbaLotes from "./AbaLotes";
import AbaHistorico from "./AbaHistorico";
import AbaSuplementacao from "./AbaSuplementacao";
import TelaLote from "./TelaLote";
import TelaManejos from "./TelaManejos";
import TelaConfigurarTabela from "./TelaConfigurarTabela";

/*
 * Casca do Detalhes do Lote v12 (D-PROD-218). Raiz
 * `.mk-dp[data-modo]`, filha direta do `.mk-ll` do `LancLoteDialogo`:
 *
 *   [Abas]  ·  corpo (só ele rola)  ·  rodapé (padrão ou próprio da aba/tela)
 *
 * Guarda a pilha de telas (pasto › lote › manejos › configurar tabela) e publica
 * o cabeçalho de cada uma no diálogo (`setCabecalho`; na raiz, `null`: valem o
 * título e o sub do próprio diálogo). Sem diálogo (testes), desenha o próprio
 * cabeçalho. As abas e as telas não recebem props: leem tudo de `usePasto()`.
 * Só a aba ativa é montada (as consultas de cada uma esperam a vez dela).
 *
 * Alvo dos manejos (Mover · Pesar · Manejos): tela do lote ou "Manejos" vindo
 * dela → aquele lote; senão os marcados; senão `null` (todos). Avisado por
 * `onAlvo` só quando muda. A seleção nasce vazia e morre com o diálogo.
 */

/** @typedef {import("./pastoContexto").TelaPasto} TelaPasto */
/** @typedef {import("./pastoContexto").Pasto} Pasto */
/** @typedef {import("./pastoContexto").PermissoesPasto} PermissoesPasto */
/** @typedef {import("./pastoContexto").DadosPasto} DadosPasto */
/** @typedef {import("./pastoContexto").ModoPasto} ModoPasto */
/** @typedef {"empurrar" | "voltar" | "aba-dir" | "aba-esq"} Animacao */
/** @typedef {{ pilha: TelaPasto[], anim: Animacao | null }} EstadoPilha */

/** Ordem das abas (a direção da animação sai daqui). */
const ORDEM_ABAS = ["detalhes", "lotes", "historico", "supl"];

/**
 * Resume o alvo numa chave (ordem não importa); "" = todos.
 * @param {string[] | null} ids
 */
const chaveDoAlvo = (ids) => (ids ? [...ids].sort().join("|") : "");

/**
 * @param {{
 *   modelo: any,
 *   setorNome?: string,
 *   abaInicial?: string,
 *   permissoes: PermissoesPasto,
 *   dados: Partial<DadosPasto>,
 *   manejos?: React.ReactNode,
 *   onMover?: () => void,
 *   onPesar?: () => void,
 *   onAlvo?: (ids: string[] | null) => void,
 *   escopoPreferencias?: Pasto["escopoPreferencias"],
 * }} props
 */
export default function PainelPasto({
  modelo,
  setorNome = "",
  abaInicial = "lotes",
  permissoes,
  dados,
  manejos = null,
  onMover,
  onPesar,
  onAlvo,
  escopoPreferencias = null,
}) {
  const modo = useModoPasto();
  const celular = modo === "celular";
  const dialogo = useLancLoteDialogo();
  const setCabecalho = dialogo?.setCabecalho || null;
  const idBase = `mk-dp-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const lotesVm = /** @type {any[]} */ (Array.isArray(modelo?.lotes) ? modelo.lotes : []);
  const qtdLotes = lotesVm.length;

  /** @type {PermissoesPasto} */
  const perm = React.useMemo(
    () => ({
      mover: Boolean(permissoes?.mover),
      pesar: Boolean(permissoes?.pesar),
      historico: Boolean(permissoes?.historico),
      supl: Boolean(permissoes?.supl),
      detalhesCocho: Boolean(permissoes?.detalhesCocho),
      lancarSupl: Boolean(permissoes?.lancarSupl),
      historicoCocho: Boolean(permissoes?.historicoCocho),
    }),
    [
      permissoes?.mover,
      permissoes?.pesar,
      permissoes?.historico,
      permissoes?.supl,
      permissoes?.detalhesCocho,
      permissoes?.lancarSupl,
      permissoes?.historicoCocho,
    ],
  );

  /** @type {DadosPasto} */
  const dadosPasto = React.useMemo(
    () => ({
      areaId: dados?.areaId ?? null,
      areaNome: dados?.areaNome || modelo?.area?.nome || "",
      setorNome: dados?.setorNome ?? setorNome ?? "",
      lotesDoPasto: Array.isArray(dados?.lotesDoPasto) ? dados.lotesDoPasto : [],
      movimentacoes: Array.isArray(dados?.movimentacoes) ? dados.movimentacoes : [],
      empresaId: dados?.empresaId ?? null,
      suplementacao: dados?.suplementacao ?? null,
      onAbrirCocho: dados?.onAbrirCocho ?? null,
      // Áreas do mapa: nome da outra área quando o registro antigo gravou vazio (D-PROD-220).
      areas: Array.isArray(dados?.areas) ? dados.areas : [],
    }),
    [dados, modelo, setorNome],
  );

  // ── Abas ──────────────────────────────────────────────────────────────
  const abas = React.useMemo(
    () => [
      { id: "detalhes", rotulo: "Detalhes" },
      // Badge: nº de lotes, só fora do celular e só quando há lote.
      { id: "lotes", rotulo: "Lotes", badge: !celular && qtdLotes > 0 ? qtdLotes : undefined },
      ...(perm.historico ? [{ id: "historico", rotulo: "Histórico" }] : []),
      ...(perm.supl ? [{ id: "supl", rotulo: celular ? "Supl." : "Suplementação" }] : []),
    ],
    [celular, qtdLotes, perm.historico, perm.supl],
  );

  // ── Pilha de telas ────────────────────────────────────────────────────
  const [estado, setEstado] = React.useState(
    /** @returns {EstadoPilha} */ () => ({ pilha: [{ tipo: "pasto", aba: abaInicial || "lotes" }], anim: null }),
  );
  const { pilha, anim } = estado;
  const raiz = pilha[0];
  const topo = pilha[pilha.length - 1];
  const abaPedida = raiz.tipo === "pasto" ? raiz.aba : "lotes";
  const aba = abas.some((a) => a.id === abaPedida) ? abaPedida : "lotes";

  const empurrar = React.useCallback((/** @type {TelaPasto} */ tela) => {
    setEstado((e) => ({ pilha: [...e.pilha, tela], anim: "empurrar" }));
  }, []);

  const voltar = React.useCallback(() => {
    setEstado((e) => (e.pilha.length > 1 ? { pilha: e.pilha.slice(0, -1), anim: "voltar" } : e));
  }, []);

  const irAba = React.useCallback((/** @type {string} */ id) => {
    setEstado((e) => {
      const primeira = e.pilha[0];
      const atual = primeira.tipo === "pasto" ? primeira.aba : "lotes";
      if (id === atual || e.pilha.length > 1) return e;
      /** @type {Animacao} */
      const dir = ORDEM_ABAS.indexOf(id) > ORDEM_ABAS.indexOf(atual) ? "aba-dir" : "aba-esq";
      return { pilha: [{ tipo: "pasto", aba: id }], anim: dir };
    });
  }, []);

  // ── Seleção (por diálogo; some ao fechar) ─────────────────────────────
  const [selecao, setSelecao] = React.useState(() => /** @type {Set<string>} */ (new Set()));
  const alternarSelecao = React.useCallback((/** @type {string} */ id) => {
    setSelecao((s) => {
      const k = String(id);
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }, []);
  const definirSelecao = React.useCallback((/** @type {string[]} */ ids) => {
    setSelecao(new Set((Array.isArray(ids) ? ids : []).map(String)));
  }, []);

  // ── Rodapé (padrão, ou o próprio de uma aba/tela por portal) ──────────
  const [slotRodape, setSlotRodape] = React.useState(/** @type {HTMLElement | null} */ (null));
  const [rodapesProprios, setRodapesProprios] = React.useState(0);
  const marcarRodapeProprio = React.useCallback((/** @type {number} */ delta) => {
    setRodapesProprios((n) => Math.max(0, n + delta));
  }, []);

  // ── Alvo dos manejos ──────────────────────────────────────────────────
  const loteDaTela = topo.tipo === "lote" ? topo.loteId : topo.tipo === "manejos" ? topo.loteId || null : null;
  const alvo = React.useMemo(() => {
    if (loteDaTela) return [String(loteDaTela)];
    if (selecao.size > 0) return [...selecao].sort();
    return null;
  }, [loteDaTela, selecao]);
  const chaveAlvo = chaveDoAlvo(alvo);
  const alvoAvisado = React.useRef(""); // "" = todos (null), o estado inicial do DetalhesLote
  const ultimoOnAlvo = React.useRef(onAlvo);
  ultimoOnAlvo.current = onAlvo;
  React.useEffect(() => {
    if (alvoAvisado.current === chaveAlvo) return;
    alvoAvisado.current = chaveAlvo;
    ultimoOnAlvo.current?.(alvo);
    // `alvo` muda junto com `chaveAlvo`, que o resume.
  }, [chaveAlvo]);

  // ── Cabeçalho de cada tela ────────────────────────────────────────────
  const areaNome = dadosPasto.areaNome;
  const loteVm = loteDaTela ? lotesVm.find((l) => String(l?.id) === String(loteDaTela)) || null : null;
  const nomeLote = loteVm?.nome && loteVm.nome !== VAZIO ? String(loteVm.nome) : "";
  /** @type {null | { titulo: string, sub: string }} */
  let cab = null;
  if (topo.tipo === "lote") {
    const categoria = loteVm?.categoria && loteVm.categoria !== VAZIO ? String(loteVm.categoria) : "";
    cab = { titulo: nomeLote || "Lote", sub: [categoria, areaNome].filter(Boolean).join(" · ") };
  } else if (topo.tipo === "manejos") {
    cab = { titulo: "Manejos e históricos", sub: topo.loteId ? (nomeLote ? `Lote ${nomeLote}` : "") : areaNome };
  } else if (topo.tipo === "configurarTabela") {
    cab = { titulo: "Configurar tabela", sub: "" };
  }
  const cabTitulo = cab ? cab.titulo : null;
  const cabSub = cab ? cab.sub : "";
  React.useEffect(() => {
    if (!setCabecalho) return undefined;
    setCabecalho(cabTitulo ? { titulo: cabTitulo, sub: cabSub, voltar } : null);
    return () => setCabecalho(null);
  }, [setCabecalho, cabTitulo, cabSub, voltar]);

  // ── Contexto das abas e telas ─────────────────────────────────────────
  /** @type {Pasto} */
  const valor = React.useMemo(
    () => ({
      modo,
      modelo,
      dados: dadosPasto,
      permissoes: perm,
      escopoPreferencias: escopoPreferencias || null,
      empurrar,
      voltar,
      selecao,
      alternarSelecao,
      definirSelecao,
      slotRodape,
      marcarRodapeProprio,
    }),
    [modo, modelo, dadosPasto, perm, escopoPreferencias, empurrar, voltar, selecao, alternarSelecao, definirSelecao, slotRodape, marcarRodapeProprio],
  );

  // ── Corpo ─────────────────────────────────────────────────────────────
  /** @type {React.ReactNode} */
  let conteudo = null;
  let tipoCorpo = "cards";
  if (topo.tipo === "lote") {
    conteudo = <TelaLote loteId={topo.loteId} />;
  } else if (topo.tipo === "manejos") {
    conteudo = <TelaManejos manejos={manejos} />;
    tipoCorpo = "lista";
  } else if (topo.tipo === "configurarTabela") {
    conteudo = <TelaConfigurarTabela />;
    tipoCorpo = "lista";
  } else if (aba === "detalhes") {
    conteudo = <AbaDetalhes />;
  } else if (aba === "historico") {
    conteudo = <AbaHistorico />;
  } else if (aba === "supl") {
    conteudo = <AbaSuplementacao />;
  } else {
    conteudo = <AbaLotes />;
  }
  const naRaiz = pilha.length === 1;
  const ids = idsDaAba(idBase, aba);
  // Nova chave = corpo novo: volta ao topo e toca a animação da troca.
  const chaveTela = naRaiz ? `aba:${aba}` : `${pilha.length}:${topo.tipo}:${loteDaTela || ""}`;
  const classeAnim = anim ? `mk-dp-anim--${anim}` : "";
  const animRodape = anim === "empurrar" || anim === "voltar" ? classeAnim : "";

  const mostrarRodapePadrao = (topo.tipo === "pasto" || topo.tipo === "lote") && rodapesProprios === 0;
  const abrirManejos = () => empurrar({ tipo: "manejos", loteId: topo.tipo === "lote" ? topo.loteId : null });

  return (
    <PastoCtx.Provider value={valor}>
      <div className="mk-dp" data-modo={modo} translate="no">
        {!setCabecalho ? (
          <CabecalhoProprio
            titulo={cab ? cab.titulo : areaNome || "Detalhes do Lote"}
            sub={cab ? cab.sub : dadosPasto.setorNome}
            onVoltar={naRaiz ? null : voltar}
          />
        ) : null}
        {naRaiz ? <Abas abas={abas} ativa={aba} onMudar={irAba} idBase={idBase} /> : null}
        <div
          key={chaveTela}
          className={["mk-dp__corpo", `mk-dp__corpo--${tipoCorpo}`, classeAnim].filter(Boolean).join(" ")}
          {...(naRaiz ? { role: "tabpanel", id: ids.painel, "aria-labelledby": ids.aba } : {})}
        >
          {conteudo}
        </div>
        <div ref={setSlotRodape} className="mk-dp__rodape">
          {mostrarRodapePadrao ? (
            <RodapePasto
              key={chaveTela.startsWith("aba:") ? "pasto" : chaveTela}
              tela={topo.tipo === "lote" ? "lote" : "pasto"}
              temLote={qtdLotes > 0}
              podeMover={perm.mover}
              podePesar={perm.pesar}
              onMover={onMover}
              onPesar={onPesar}
              onManejos={abrirManejos}
              className={animRodape || undefined}
            />
          ) : null}
        </div>
      </div>
    </PastoCtx.Provider>
  );
}
