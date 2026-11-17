/**
 * Detalhes do Lote v12 (D-PROD-218) — dados de exemplo iguais aos do design
 * (Pasto 07, setor Retiro, 6 lotes, 314 cab, hoje 15/11/2026) e uma CASCA DE
 * TESTE: o mesmo contrato da casca real (`PastoCtx` com todas as chaves de
 * `Pasto`, raiz `.mk-dp[data-modo]`, `Abas`, corpo e o rodapé que serve de
 * `slotRodape`) para testar as abas e as telas sem o `DetalhesLote`.
 * A casca real (`PainelPasto`) é de outra peça; aqui só o mínimo dela.
 */
import React from "react";
import { ArrowRightLeft, LayoutGrid, Scale } from "lucide-react";
import { Abas, CabecalhoProprio, RodapePilulas, idsDaAba } from "@/components/mapa/detalhes-lote/blocos";
import { montarModeloDetalhes } from "@/components/mapa/detalhes-lote/catalogo";
import { PastoCtx } from "@/components/mapa/detalhes-lote/pastoContexto";
import { AbaDetalhes } from "@/components/mapa/detalhes-lote/AbaDetalhes";
import { AbaLotes } from "@/components/mapa/detalhes-lote/AbaLotes";
import { TelaLote } from "@/components/mapa/detalhes-lote/TelaLote";
import { TelaConfigurarTabela } from "@/components/mapa/detalhes-lote/TelaConfigurarTabela";

// ── Dados do v12 ────────────────────────────────────────────────────────────

/** Hoje das capturas do v12. */
export const HOJE_V12 = new Date(2026, 10, 15);

export const AREA_V12 = Object.freeze({
  id: "a-p07",
  nome: "Pasto 07",
  setor_id: "s-retiro",
  tipo_cultura: "Pastagem",
  tipo_pastagem: "Braquiária Brizantha",
  tamanho_hectares: 109.3,
  area_pastejada: 102.7,
  // 2,20 UA/ha × 102,7 ha (UA total, como o cadastro)
  capacidade_maxima: 225.94,
});

/** Categorias de Manejo do v12 (sexo + faixa → subícone). */
export const CATEGORIAS_V12 = Object.freeze([
  { id: "c-bez", nome: "BEZERRO", sexo: "Macho", idade_minima_meses: 0, idade_maxima_meses: 8, ativo: true },
  { id: "c-nov", nome: "NOVILHA", sexo: "Fêmea", idade_minima_meses: 13, idade_maxima_meses: 24, ativo: true },
  { id: "c-bmg", nome: "BOI MAGRO", sexo: "Macho", idade_minima_meses: 25, idade_maxima_meses: 36, ativo: true },
  { id: "c-vac", nome: "VACA", sexo: "Fêmea", idade_minima_meses: 37, idade_maxima_meses: null, ativo: true },
]);

/** Curva (GMD do mês) e objetivo da categoria — os do exemplo do v12. */
const GMD = { "BOI MAGRO": 0.6, NOVILHA: 0.55, BEZERRO: 0.65, VACA: 0.2 };
const OBJETIVO = { "BOI MAGRO": 420, NOVILHA: 330, BEZERRO: 220, VACA: 480 };

/**
 * Os 6 lotes do Pasto 07 (ordem do cadastro do v12, não alfabética).
 * pesagens: [dia, peso]; pesoAtual diferente da última pesagem → origem DERIVADO.
 */
const LOTES = [
  { id: "a", nome: "L-2026-014", categoria: "BOI MAGRO", cm: "c-bmg", cab: 86, sexo: "Macho", sistema: "Recria", entrada: "2026-10-12", cor: "#f59e0b", ident: "Amarelo", sigla: "AM", manejo: "Recria a pasto", pesagens: [["2026-08-12", 341], ["2026-09-13", 361.8], ["2026-10-14", 382.5]] },
  { id: "b", nome: "L-2026-019", categoria: "NOVILHA", cm: "c-nov", cab: 54, sexo: "Fêmea", sistema: "Recria", entrada: "2026-10-25", cor: "#3b82f6", ident: "Azul", sigla: "AZ", manejo: "Recria a pasto", pesagens: [["2026-08-20", 271], ["2026-09-22", 284.6], ["2026-10-25", 298]] },
  { id: "c", nome: "L-2026-022", categoria: "BOI MAGRO", cm: "c-bmg", cab: 41, sexo: "Macho", sistema: "Recria", entrada: "2026-11-02", cor: "#10b981", ident: "Verde", sigla: "VD", manejo: "Recria a pasto", pesagens: [["2026-09-05", 340.1], ["2026-10-05", 352], ["2026-11-02", 360]], pesoAtual: 365.2 },
  { id: "d", nome: "L-2026-008", categoria: "VACA", cm: "c-vac", cab: 38, sexo: "Fêmea", sistema: "Cria", entrada: "2026-09-20", cor: "#ef4444", ident: "Vermelho", sigla: "VM", manejo: "Cria", pesagens: [["2026-07-10", 446], ["2026-08-25", 449.5]] },
  { id: "e", nome: "L-2026-025", categoria: "BEZERRO", cm: "c-bez", cab: 62, sexo: "Macho", sistema: "Cria", entrada: "2026-10-30", cor: "#f97316", ident: "Laranja", sigla: "LR", manejo: "Cria", pesagens: [["2026-09-01", 165.2], ["2026-10-01", 181], ["2026-10-30", 196.4]] },
  { id: "f", nome: "L-2026-027", categoria: "NOVILHA", cm: "c-nov", cab: 33, sexo: "Fêmea", sistema: "Recria", entrada: "2026-11-05", cor: "#8b5cf6", ident: "Roxo", sigla: "RX", manejo: "Recria a pasto", pesagens: [["2026-07-06", 279.4], ["2026-09-05", 300.4], ["2026-11-05", 312.8]] },
];

const DIA = 86400000;
/** @param {string} s */
const dia = (s) => new Date(`${s}T00:00:00`);
/** @param {Date} d */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** @param {Date} a @param {Date} b */
const dias = (a, b) => Math.round((b.getTime() - a.getTime()) / DIA);

/**
 * `projecao_peso` no formato do servidor (D-PROD-198), com as contas do exemplo do v12.
 * @param {(typeof LOTES)[number]} l
 */
const projecaoDe = (l) => {
  // Base = o peso atual na data da última pesagem (no L-2026-022 o peso atual veio de outro manejo).
  const [dU, pesado] = l.pesagens[l.pesagens.length - 1];
  const pU = l.pesoAtual ?? pesado;
  const [dP, pP] = l.pesagens.length > 1 ? l.pesagens[l.pesagens.length - 2] : l.pesagens[0];
  const gmd = GMD[l.categoria];
  const peso = pU + gmd * dias(dia(dU), HOJE_V12);
  const objetivo = OBJETIVO[l.categoria];
  const previsto = pP + gmd * Math.max(0, dias(dia(dP), dia(dU)));
  const atingiu = peso >= objetivo;
  const faltam = atingiu ? null : Math.ceil((objetivo - peso) / gmd);
  const prevista = faltam === null ? null : new Date(HOJE_V12.getTime() + faltam * DIA);
  return {
    disponivel: true,
    dia: iso(HOJE_V12),
    peso_kg: peso,
    arroba: peso / 30,
    sem_curva: false,
    gmd_hoje_kg: gmd,
    base: { dia: dU, tipo: "PESAGEM", peso_gravado_kg: pU, peso_kg: pU, derivado: false, dias: dias(dia(dU), HOJE_V12) },
    peso_objetivo_kg: objetivo,
    falta_kg: Math.max(0, objetivo - peso),
    atingiu_objetivo: atingiu,
    data_prevista_objetivo: prevista ? iso(prevista) : null,
    dias_para_objetivo: faltam,
    ultima_pesagem: { dia: dU, peso_kg: pU, previsto_kg: previsto, percentual_do_previsto: previsto ? (pU / previsto) * 100 : 100 },
    projecao_mensal: [1, 2, 3].map((k) => {
      const fim = new Date(HOJE_V12.getFullYear(), HOJE_V12.getMonth() + k, 0);
      return { mes: iso(fim).slice(0, 7), dia: iso(fim), peso_kg: peso + gmd * dias(HOJE_V12, fim) };
    }),
  };
};

/**
 * Posições (ledger) do Pasto 07 como o cache do mapa entrega.
 * @param {number} [qtd] quantos lotes (os primeiros do cadastro)
 */
export function posicoesV12(qtd = LOTES.length) {
  return LOTES.slice(0, qtd).map((l) => ({
    id: `p-${l.id}`,
    posicao_id: `p-${l.id}`,
    __posicao: true,
    nome: l.nome,
    categoria: l.categoria,
    sexo: l.sexo,
    categoria_manejo_id: l.cm,
    categoria_manejo_nome: l.manejo,
    quantidade_cabecas: l.cab,
    peso_medio_kg: l.pesoAtual ?? l.pesagens[l.pesagens.length - 1][1],
    area_atual_id: AREA_V12.id,
    area_atual_nome: AREA_V12.nome,
    status: "Ativo",
    data_entrada: l.entrada,
    sistema_produtivo: l.sistema,
    identificador_nome: l.ident,
    identificador_cor: l.cor,
    identificador_sigla: l.sigla,
    empresa_id: "emp-1",
    projecao_peso: projecaoDe(l),
  }));
}

/**
 * Movimentações do cache: as pesagens dos lotes e, se pedido, a saída que põe o
 * pasto em descanso.
 * @param {{ qtd?: number, saidaEm?: string|null }} [opcoes]
 */
export function movimentacoesV12({ qtd = LOTES.length, saidaEm = null } = {}) {
  const pesagens = LOTES.slice(0, qtd).flatMap((l) =>
    l.pesagens.map(([d, peso], i) => ({
      id: `pes-${l.id}-${i}`,
      tipo: "Pesagem",
      empresa_id: "emp-1",
      data_movimentacao: d,
      created_date: `${d}T10:00:00Z`,
      linhas: [{ posicao_id: `p-${l.id}`, lote_id: `p-${l.id}`, lote_nome: l.nome, quantidade_cabecas: l.cab, peso_novo_kg: peso }],
    })),
  );
  const saida = saidaEm
    ? [{ id: "mov-saida", tipo: "Transferência de Área", empresa_id: "emp-1", data_movimentacao: saidaEm, area_origem_id: AREA_V12.id, area_destino_id: "a-p08", linhas: [] }]
    : [];
  return [...pesagens, ...saida];
}

/**
 * Modelo REAL (`montarModeloDetalhes`) do Pasto 07 do v12.
 * @param {{ qtd?: number, area?: any, movimentacoes?: any[] }} [opcoes]
 */
export function modeloV12({ qtd = LOTES.length, area = AREA_V12, movimentacoes } = {}) {
  const posicoes = posicoesV12(qtd);
  return montarModeloDetalhes({
    area,
    lotes: posicoes,
    lotesDaArea: posicoes,
    movimentacoes: movimentacoes ?? movimentacoesV12({ qtd }),
    categoriasManejo: [...CATEGORIAS_V12],
    hoje: HOJE_V12,
  });
}

// ── Casca de teste ──────────────────────────────────────────────────────────

/** @typedef {import('@/components/mapa/detalhes-lote/pastoContexto').TelaPasto} TelaPasto */
/** @typedef {import('@/components/mapa/detalhes-lote/pastoContexto').Pasto} Pasto */

/** Permissões completas (a casca real tira as pílulas sem permissão). */
export const PERMISSOES_TODAS = Object.freeze({
  mover: true, pesar: true, historico: true, supl: true, detalhesCocho: true, lancarSupl: true, historicoCocho: true,
});

const ABAS = [
  { id: "detalhes", rotulo: "Detalhes" },
  { id: "lotes", rotulo: "Lotes" },
  { id: "historico", rotulo: "Histórico" },
  { id: "supl", rotulo: "Suplementação" },
];

/**
 * Casca de teste do Detalhes v12.
 * - `modo`: celular | tablet | desktop (o que a casca real mede).
 * - `pilhaInicial`: começa já numa tela empilhada (ex.: `[{ tipo: "lote", loteId }]`).
 * - `manterPasto`: deixa a aba do pasto montada (escondida) por baixo das telas
 *   empilhadas, como a casca pode fazer.
 * - `semCabecalho`: as telas empilhadas não desenham o cabeçalho próprio (quem
 *   desenha é o diálogo em volta, como na casca real).
 * - `aoEmpurrar` / `aoVoltar` / `aoSelecionar`: espiões.
 * @param {{
 *   modelo: any, modo?: "celular"|"tablet"|"desktop", abaInicial?: string, pilhaInicial?: TelaPasto[], areaId?: string,
 *   setorNome?: string, movimentacoes?: any[], escopoPreferencias?: Pasto["escopoPreferencias"],
 *   selecaoInicial?: string[], manterPasto?: boolean, semCabecalho?: boolean,
 *   aoEmpurrar?: (t: TelaPasto) => void, aoVoltar?: () => void, aoSelecionar?: (ids: string[]) => void,
 * }} props
 */
export function CascaDeTeste({
  modelo,
  modo = "desktop",
  abaInicial = "lotes",
  areaId = AREA_V12.id,
  pilhaInicial = [],
  setorNome = "Retiro",
  movimentacoes = [],
  escopoPreferencias = null,
  selecaoInicial = [],
  manterPasto = false,
  semCabecalho = false,
  aoEmpurrar,
  aoVoltar,
  aoSelecionar,
}) {
  const [pilha, setPilha] = React.useState(() => /** @type {TelaPasto[]} */ ([{ tipo: "pasto", aba: abaInicial }, ...pilhaInicial]));
  const [selecao, setSelecao] = React.useState(() => new Set(selecaoInicial));
  const [slotRodape, setSlotRodape] = React.useState(/** @type {HTMLElement | null} */ (null));
  const [rodapesProprios, setRodapesProprios] = React.useState(0);

  const empurrar = React.useCallback((/** @type {TelaPasto} */ t) => {
    aoEmpurrar?.(t);
    setPilha((p) => [...p, t]);
  }, [aoEmpurrar]);
  const voltar = React.useCallback(() => {
    aoVoltar?.();
    setPilha((p) => (p.length > 1 ? p.slice(0, -1) : p));
  }, [aoVoltar]);
  const definirSelecao = React.useCallback((/** @type {string[]} */ ids) => {
    aoSelecionar?.(ids);
    setSelecao(new Set(ids));
  }, [aoSelecionar]);
  const alternarSelecao = React.useCallback((/** @type {string} */ id) => {
    setSelecao((s) => {
      const nova = new Set(s);
      if (nova.has(id)) nova.delete(id);
      else nova.add(id);
      aoSelecionar?.([...nova]);
      return nova;
    });
  }, [aoSelecionar]);
  const marcarRodapeProprio = React.useCallback((/** @type {number} */ delta) => setRodapesProprios((n) => n + delta), []);

  /** @type {Pasto} */
  const valor = React.useMemo(() => ({
    modo,
    modelo,
    dados: {
      areaId,
      areaNome: modelo?.area?.nome || AREA_V12.nome,
      setorNome,
      lotesDoPasto: (modelo?.lotes || []).map((/** @type {any} */ l) => l.raw),
      movimentacoes,
      empresaId: "emp-1",
      suplementacao: null,
      onAbrirCocho: null,
    },
    permissoes: { ...PERMISSOES_TODAS },
    escopoPreferencias,
    empurrar,
    voltar,
    selecao,
    alternarSelecao,
    definirSelecao,
    slotRodape,
    marcarRodapeProprio,
  }), [modo, modelo, areaId, setorNome, movimentacoes, escopoPreferencias, empurrar, voltar, selecao, alternarSelecao, definirSelecao, slotRodape, marcarRodapeProprio]);

  const raiz = pilha[0];
  const topo = pilha[pilha.length - 1];
  const naRaiz = pilha.length === 1;
  const aba = raiz.tipo === "pasto" ? raiz.aba : "lotes";
  const ids = idsDaAba("pasto", aba);
  const semLote = !(modelo?.lotes || []).length;
  const loteDoTopo = topo.tipo === "lote" ? (modelo?.lotes || []).find((/** @type {any} */ l) => l.id === topo.loteId) : null;

  const corpoDoPasto = aba === "detalhes" ? <AbaDetalhes /> : aba === "lotes" ? <AbaLotes /> : <p>{aba}</p>;
  let empilhada = null;
  if (topo.tipo === "lote") empilhada = <TelaLote loteId={topo.loteId} />;
  else if (topo.tipo === "configurarTabela") empilhada = <TelaConfigurarTabela />;
  else if (topo.tipo === "manejos") empilhada = <p>Manejos e históricos</p>;
  const lista = topo.tipo === "configurarTabela" || topo.tipo === "manejos";

  const pilulas = topo.tipo === "lote"
    ? [
        { rotulo: "Mover", icone: ArrowRightLeft },
        { rotulo: "Pesar", icone: Scale },
        { rotulo: "Manejos", icone: LayoutGrid, onClick: () => empurrar({ tipo: "manejos", loteId: topo.loteId }) },
      ]
    : [
        { rotulo: "Mover lotes", icone: ArrowRightLeft, desabilitado: semLote },
        { rotulo: "Pesar", icone: Scale, desabilitado: semLote },
        { rotulo: "Manejos", icone: LayoutGrid, desabilitado: semLote, onClick: () => empurrar({ tipo: "manejos" }) },
      ];
  const rodapePadrao = naRaiz || topo.tipo === "lote";

  return (
    <PastoCtx.Provider value={valor}>
      <div className="mk-dp" data-modo={modo} translate="no">
        {naRaiz ? (
          <Abas
            abas={ABAS.map((a) => ({
              ...a,
              rotulo: a.id === "supl" && modo === "celular" ? "Supl." : a.rotulo,
              // Badge só fora do celular e só com lotes (sem badge com 0).
              badge: a.id === "lotes" && modo !== "celular" && !semLote ? modelo.lotes.length : undefined,
            }))}
            ativa={aba}
            onMudar={(id) => setPilha([{ tipo: "pasto", aba: id }])}
            idBase="pasto"
          />
        ) : semCabecalho ? null : (
          <CabecalhoProprio
            titulo={loteDoTopo ? loteDoTopo.nome : topo.tipo === "configurarTabela" ? "Configurar tabela" : "Manejos e históricos"}
            sub={loteDoTopo ? `${loteDoTopo.categoria} · ${modelo.area.nome}` : undefined}
            onVoltar={voltar}
          />
        )}
        {naRaiz || manterPasto ? (
          <div
            className="mk-dp__corpo mk-dp__corpo--cards"
            role="tabpanel"
            id={ids.painel}
            aria-labelledby={ids.aba}
            hidden={!naRaiz}
            data-corpo=""
          >
            {corpoDoPasto}
          </div>
        ) : null}
        {empilhada ? (
          <div key={pilha.length} className={`mk-dp__corpo ${lista ? "mk-dp__corpo--lista" : "mk-dp__corpo--cards"}`} data-corpo="">
            {empilhada}
          </div>
        ) : null}
        <div className="mk-dp__rodape" ref={setSlotRodape}>
          {rodapePadrao && rodapesProprios === 0 ? <RodapePilulas itens={pilulas} /> : null}
        </div>
      </div>
    </PastoCtx.Provider>
  );
}
