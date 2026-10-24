import React, { useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const dois = (n) => String(n).padStart(2, "0");
const isoDe = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
const brDe = (d) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
const lerIso = (v) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00`) : null);

/**
 * Quadro de calendário da central de vendas (port de `calendario-do-sistema.tsx`).
 *
 * @param {object} props
 * @param {string} props.valor ISO AAAA-MM-DD
 * @param {(iso: string) => void} props.escolher
 * @param {Date} [props.inicial]
 */
export function B1CalendarioDoSistema({ valor, escolher, inicial }) {
  const hoje = new Date();
  const escolhido = lerIso(valor);
  const base = escolhido ?? inicial ?? hoje;
  const [mes, setMes] = useState(() => new Date(base.getFullYear(), base.getMonth(), 1));
  const [nivel, setNivel] = useState("dia");
  const roda = useRef(0);
  const ano = mes.getFullYear();
  const mesAtual = mes.getMonth();
  const decada = Math.floor(ano / 10) * 10;

  const andar = (p) =>
    setMes((m) =>
      nivel === "dia"
        ? new Date(m.getFullYear(), m.getMonth() + p, 1)
        : new Date(m.getFullYear() + (nivel === "mes" ? p : p * 10), m.getMonth(), 1),
    );

  const titulo =
    nivel === "dia" ? `${MESES[mesAtual]} de ${ano}` : nivel === "mes" ? String(ano) : `${decada} – ${decada + 9}`;

  const aoRodar = (e) => {
    roda.current += e.deltaY;
    let passos = 0;
    while (roda.current >= 48) {
      passos++;
      roda.current -= 48;
    }
    while (roda.current <= -48) {
      passos--;
      roda.current += 48;
    }
    if (passos) andar(passos);
  };

  const primeiro = new Date(ano, mesAtual, 1);
  const dias = Array.from({ length: 42 }, (_, i) => new Date(ano, mesAtual, 1 - primeiro.getDay() + i));
  const mesmoDia = (a, b) => Boolean(a) && isoDe(a) === isoDe(b);

  return (
    <div onWheel={aoRodar}>
      <div className="b1-cal-cabecalho">
        <button
          type="button"
          className="b1-cal-titulo"
          disabled={nivel === "ano"}
          aria-label={nivel === "dia" ? "Ver os meses" : nivel === "mes" ? "Ver os anos" : "Anos"}
          onClick={() => setNivel(nivel === "dia" ? "mes" : "ano")}
        >
          {titulo}
        </button>
        <span className="b1-cal-setas">
          <button type="button" className="b1-cal-seta" aria-label="Anterior" onClick={() => andar(-1)}>
            <ChevronUp aria-hidden />
          </button>
          <button type="button" className="b1-cal-seta" aria-label="Próximo" onClick={() => andar(1)}>
            <ChevronDown aria-hidden />
          </button>
        </span>
      </div>
      {nivel === "dia" ? (
        <div className="b1-cal-dias">
          {SEMANA.map((l, i) => (
            <span key={i} className="b1-cal-semana">{l}</span>
          ))}
          {dias.map((d) => {
            const marcado = mesmoDia(escolhido, d);
            const fora = d.getMonth() !== mesAtual;
            return (
              <button
                type="button"
                key={isoDe(d)}
                className="b1-cal-dia"
                aria-label={brDe(d)}
                aria-pressed={marcado}
                data-fora={fora ? "" : undefined}
                data-hoje={!marcado && mesmoDia(hoje, d) ? "" : undefined}
                onClick={() => escolher(isoDe(d))}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      ) : null}
      {nivel === "mes" ? (
        <div className="b1-cal-grade">
          {MESES.map((m, i) => {
            const marcado = Boolean(escolhido) && escolhido.getFullYear() === ano && escolhido.getMonth() === i;
            return (
              <button
                type="button"
                key={m}
                className="b1-cal-celula"
                aria-label={`${m} de ${ano}`}
                aria-pressed={marcado}
                data-hoje={!marcado && hoje.getFullYear() === ano && hoje.getMonth() === i ? "" : undefined}
                onClick={() => {
                  setMes(new Date(ano, i, 1));
                  setNivel("dia");
                }}
              >
                {m.slice(0, 3)}
              </button>
            );
          })}
        </div>
      ) : null}
      {nivel === "ano" ? (
        <div className="b1-cal-grade">
          {Array.from({ length: 12 }, (_, i) => decada - 1 + i).map((a) => {
            const marcado = Boolean(escolhido) && escolhido.getFullYear() === a;
            const fora = a < decada || a > decada + 9;
            return (
              <button
                type="button"
                key={a}
                className="b1-cal-celula"
                aria-label={String(a)}
                aria-pressed={marcado}
                data-fora={fora ? "" : undefined}
                data-hoje={!marcado && hoje.getFullYear() === a ? "" : undefined}
                onClick={() => {
                  setMes(new Date(a, mesAtual, 1));
                  setNivel("mes");
                }}
              >
                {a}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="b1-cal-rodape">
        <button type="button" className="b1-cal-link" onClick={() => escolher(isoDe(hoje))}>
          Hoje
        </button>
        <button type="button" className="b1-cal-link" onClick={() => escolher("")}>
          Limpar
        </button>
      </div>
    </div>
  );
}

/** Painel vidro padrão para `MgDatePicker` (paridade `painelDoCalendarioPadrao`). */
export const painelCalendarioCentralVendas = {
  className: "mg-b1-glass-pop b1-calendario outline-none",
  desenhar: ({ valor, escolher }) => <B1CalendarioDoSistema valor={valor} escolher={escolher} />,
};
