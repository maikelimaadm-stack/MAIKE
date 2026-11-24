import React from "react";
import { TituloBloco } from "@/components/mapa/detalhes-lote/blocos";
import { TONS, colunasPorChave, fmtInt, ordenarLotes } from "@/components/mapa/detalhes-lote/catalogo";
import { usePasto } from "@/components/mapa/detalhes-lote/pastoContexto";
import { useColunasLote } from "@/components/mapa/detalhes-lote/preferencias";
import { useOrdemLista } from "@/components/mapa/detalhes-lote/useEstadoLotes";
import "@/styles/mk-dp-lotes.css";

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */
/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').CampoDef} CampoDef */
/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').LoteVm} LoteVm */

/**
 * Junta classes, ignorando vazias.
 * @param {...(string | false | null | undefined)} partes
 */
const cls = (...partes) => partes.filter(Boolean).join(" ");

/** A coluna abre uma seção nova (leva a linha vertical à esquerda). @param {CampoDef[]} cols @param {number} i */
const abreSecao = (cols, i) => i > 0 && cols[i - 1].secao !== cols[i].secao;

/**
 * Vista Lista da aba Lotes (v12): "N lotes · N cab" + "Configurar tabela" e a
 * tabela com as colunas que o usuário escolheu (padrão: Alertas, Lotação e
 * Pesagem), agrupadas por seção. Cabeçalho ordenável; Lote, Nome e "Total da
 * área" ficam presos à esquerda ao rolar; tocar no nome abre a tela do lote.
 */
export function VistaLista() {
  const { modelo, modo, empurrar, escopoPreferencias } = usePasto();
  const m = /** @type {ModeloDetalhes} */ (modelo);
  const [chaves] = useColunasLote(escopoPreferencias);
  const [ordemLembrada, ordenarPor] = useOrdemLista();
  const cols = React.useMemo(() => colunasPorChave(chaves), [chaves]);
  // Ordenada por uma coluna que saiu da tabela: vale o nome (a escolha volta se a coluna voltar).
  const visivel = ordemLembrada.chave === "nome" || cols.some((c) => c.chave === ordemLembrada.chave);
  const ordem = visivel ? ordemLembrada : { chave: "nome", dir: 1 };
  const lotes = React.useMemo(() => ordenarLotes(m.lotes, { chave: ordem.chave, dir: ordem.dir }), [m.lotes, ordem.chave, ordem.dir]);

  /** @type {Array<{ rotulo: string, span: number }>} */
  const grupos = [];
  cols.forEach((c, i) => {
    if (i === 0 || abreSecao(cols, i)) grupos.push({ rotulo: c.secao, span: 1 });
    else grupos[grupos.length - 1].span += 1;
  });

  // Celular (v13): colunas compactas para caberem ~6 sem cortar; as de largura fixa encolhem um pouco.
  const compacta = modo === "celular";
  const larguraNome = compacta ? "116px" : "170px";
  const trilhas = [larguraNome, ...cols.map((c) => larguraDaColuna(c.largura, compacta))].join(" ");
  const [rolo, setRolo] = React.useState(/** @type {HTMLDivElement | null} */ (null));
  const rolaParaOLado = useRolagemLateral(rolo, `${trilhas}|${lotes.length}`);
  const n = m.lotes.length;
  const titulo = `${fmtInt(n)} ${n === 1 ? "lote" : "lotes"} · ${m.resumo.cab} cab`;

  return (
    <>
      <TituloBloco link="Configurar tabela" onLink={() => empurrar({ tipo: "configurarTabela" })}>
        {titulo}
      </TituloBloco>
      <div className={cls("mk-dp-tabela", compacta && "mk-dp-tabela--compacta")}>
        <div className="mk-dp-tabela__rolo" ref={setRolo}>
          <div className="mk-dp-tabela__in" role="table" aria-label="Lotes do pasto" style={{ gridTemplateColumns: trilhas }}>
            <div role="row" className="mk-dp-tabela__linha">
              <div role="columnheader" className="mk-dp-tabela__g mk-dp-fixo">
                Lote
              </div>
              {grupos.map((g, i) => (
                <div
                  key={g.rotulo}
                  role="columnheader"
                  aria-colspan={g.span}
                  className={cls("mk-dp-tabela__g", i > 0 && "mk-dp-sep")}
                  style={{ gridColumn: `span ${g.span}` }}
                >
                  {g.rotulo}
                </div>
              ))}
            </div>
            <div role="row" className="mk-dp-tabela__linha">
              <CabecalhoColuna chave="nome" rotulo="Nome" ordem={ordem} onOrdenar={ordenarPor} className="mk-dp-fixo" />
              {cols.map((c, i) => (
                <CabecalhoColuna
                  key={c.chave}
                  chave={c.chave}
                  rotulo={c.rotulo}
                  dica={c.dica}
                  ordem={ordem}
                  onOrdenar={ordenarPor}
                  className={abreSecao(cols, i) ? "mk-dp-sep" : undefined}
                />
              ))}
            </div>
            {lotes.map((l, i) => (
              <LinhaDaTabela key={l.id} lote={l} cols={cols} zebra={i % 2 === 1} onAbrir={() => empurrar({ tipo: "lote", loteId: l.id })} />
            ))}
            <div role="row" className="mk-dp-tabela__linha">
              <div role="rowheader" className="mk-dp-tabela__tot mk-dp-fixo">
                Total da área
              </div>
              {cols.map((c, i) => (
                <div key={c.chave} role="cell" className={cls("mk-dp-tabela__tot", abreSecao(cols, i) && "mk-dp-sep")}>
                  {m.totais?.[c.chave] || ""}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {rolaParaOLado ? <p className="mk-dp-tabela__dica">Arraste para o lado para ver as outras colunas →</p> : null}
    </>
  );
}

/**
 * Largura de uma coluna: no celular as flexíveis ficam do tamanho do conteúdo até 84 px (o rótulo
 * do cabeçalho quebra em vez de alargar a coluna) e as fixas encolhem 15%.
 * @param {string} largura
 * @param {boolean} compacta
 */
export function larguraDaColuna(largura, compacta) {
  if (!compacta) return largura;
  const fixa = /^(\d+(?:\.\d+)?)px$/.exec(String(largura));
  if (fixa) return `${Math.round(Number(fixa[1]) * 0.85)}px`;
  return "fit-content(84px)";
}

/**
 * A tabela passa da largura visível? (A dica de arrastar só aparece quando há o que ver ao lado.)
 * @param {HTMLElement | null} rolo
 * @param {string} chave muda quando as colunas ou as linhas mudam
 */
function useRolagemLateral(rolo, chave) {
  const [rola, setRola] = React.useState(false);
  React.useEffect(() => {
    if (!rolo) return undefined;
    const medir = () => setRola(rolo.scrollWidth - rolo.clientWidth > 1);
    medir();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(medir);
    ro.observe(rolo);
    return () => ro.disconnect();
  }, [rolo, chave]);
  return rola;
}

/**
 * Cabeçalho focado (Tab) aparece inteiro na rolagem lateral da tabela. O navegador só rola quando
 * ele está todo escondido; em parte visível, o rótulo e o anel de foco ficavam cortados na borda.
 * À esquerda, a borda é a coluna presa (Nome), que fica por cima ao rolar.
 * @param {React.FocusEvent<HTMLButtonElement>} e
 */
function mostrarInteiro(e) {
  const celula = e.currentTarget.closest('[role="columnheader"]');
  const rolo = e.currentTarget.closest(".mk-dp-tabela__rolo");
  if (!(celula instanceof HTMLElement) || !(rolo instanceof HTMLElement) || celula.classList.contains("mk-dp-fixo")) return;
  const r = celula.getBoundingClientRect();
  const c = rolo.getBoundingClientRect();
  const presa = rolo.querySelector('.mk-dp-tabela__th.mk-dp-fixo');
  const esquerda = presa instanceof HTMLElement ? presa.getBoundingClientRect().right : c.left;
  if (r.right > c.right) rolo.scrollLeft += Math.ceil(r.right - c.right);
  else if (r.left < esquerda) rolo.scrollLeft -= Math.ceil(esquerda - r.left);
}

/**
 * Cabeçalho ordenável: clicar ordena pela coluna (nova → crescente; a mesma → inverte).
 * @param {{ chave: string, rotulo: string, dica?: string, ordem: { chave: string, dir: number }, onOrdenar: (chave: string) => void, className?: string }} props
 */
function CabecalhoColuna({ chave, rotulo, dica, ordem, onOrdenar, className }) {
  const ativa = ordem.chave === chave;
  const crescente = ordem.dir > 0;
  return (
    <div role="columnheader" aria-sort={ativa ? (crescente ? "ascending" : "descending") : undefined} className={cls("mk-dp-tabela__th", ativa && "is-on", className)}>
      <button type="button" className="mk-dp-tabela__ordenar" title={dica || undefined} onClick={() => onOrdenar(chave)} onFocus={mostrarInteiro}>
        <span>{rotulo}</span>
        <span className="mk-dp-tabela__seta" aria-hidden="true">
          {ativa ? (crescente ? "▲" : "▼") : ""}
        </span>
      </button>
    </div>
  );
}

/**
 * Uma linha de lote: célula do nome (bolinha da situação, nome e "CATEGORIA ·
 * SEXO"; abre a tela do lote) e uma célula por coluna, com cor, bolinha e
 * mini barra vindas de `lote.valores[chave]`.
 * @param {{ lote: LoteVm, cols: CampoDef[], onAbrir: () => void, zebra?: boolean }} props
 */
function LinhaDaTabela({ lote, cols, onAbrir, zebra = false }) {
  const corSituacao = (TONS[lote.situacao?.tom] || TONS.neutro).texto;
  return (
    <div role="row" className="mk-dp-tabela__linha">
      <div role="rowheader" className={cls("mk-dp-tabela__nome mk-dp-fixo", zebra && "is-zebra")}>
        <button type="button" className="mk-dp-tabela__abrir" onClick={onAbrir}>
          <span className="mk-dp-tabela__bolinha" style={{ background: corSituacao }} aria-hidden="true" />
          <span className="mk-dp-tabela__nome-txt">
            <strong>{lote.nome}</strong>
            <small>{lote.sub}</small>
          </span>
        </button>
      </div>
      {cols.map((c, i) => {
        const cel = lote.valores?.[c.chave];
        const barra = typeof cel?.barra === "number" && Number.isFinite(cel.barra) ? Math.max(0, Math.min(100, cel.barra)) : null;
        return (
          <div
            key={c.chave}
            role="cell"
            className={cls("mk-dp-tabela__td", zebra && "is-zebra", cel?.dot && "com-bolinha", cel?.quebra && "is-quebra", abreSecao(cols, i) && "mk-dp-sep")}
            style={cel?.cor ? { color: cel.cor } : undefined}
          >
            {cel?.dot ? <span className="mk-dp-tabela__bolinha mk-dp-tabela__bolinha--p" style={{ background: cel.dot }} aria-hidden="true" /> : null}
            <span>{cel?.texto ?? "—"}</span>
            {barra !== null ? (
              <span className="mk-dp-tabela__mini" aria-hidden="true">
                <span style={{ width: `${barra.toFixed(0)}%` }} />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default VistaLista;
