import React from "react";
import { Check } from "lucide-react";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";
import PainelSelecao from "@/components/common/PainelSelecao";
import { BotaoFiltro } from "./blocos";

/**
 * Seletor de filtro do histórico (padrão da aba Histórico do pasto):
 * botão com PainelSelecao no desktop/tablet e folha MobileSheet no celular.
 *
 * @param {{
 *   opcoes: Array<{ valor: string, rotulo: string }>,
 *   valor: string,
 *   onMudar: (valor: string) => void,
 *   rotulo?: string,
 * }} props
 */
export default function FiltroHistorico({ opcoes, valor, onMudar, rotulo = "Mostrar" }) {
  const celular = useCelular();
  const [aberta, setAberta] = React.useState(false);
  const botao = React.useRef(/** @type {HTMLButtonElement | null} */ (null));
  const controle = React.useRef(/** @type {null | { tecla: (e: React.KeyboardEvent) => void }} */ (null));
  const ancora = React.useCallback(() => botao.current, []);

  React.useEffect(() => {
    if (!aberta || !celular) return undefined;
    /** @param {KeyboardEvent} e */
    const segurar = (e) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", segurar, true);
    return () => window.removeEventListener("keydown", segurar, true);
  }, [aberta, celular]);

  const estavaAberta = React.useRef(false);
  React.useEffect(() => {
    if (celular && estavaAberta.current && !aberta) botao.current?.focus({ preventScroll: true });
    estavaAberta.current = aberta;
  }, [aberta, celular]);

  const atual = opcoes.find((o) => o.valor === valor) || opcoes[0];
  const rotuloAtual = atual?.rotulo || "";

  /** @param {string} v */
  const escolher = (v) => {
    onMudar(v);
    setAberta(false);
  };

  const gatilho = (
    <BotaoFiltro
      ref={botao}
      aria-haspopup="listbox"
      aria-expanded={aberta}
      aria-label={`${rotulo}: ${rotuloAtual}`}
      onClick={() => setAberta((v) => !v)}
      onKeyDown={(e) => {
        if (celular) return;
        if (aberta && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) {
          controle.current?.tecla(e);
        } else if (!aberta && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          setAberta(true);
        }
      }}
    >
      {rotuloAtual}
    </BotaoFiltro>
  );

  return (
    <>
      <div className="mk-dp-botoes">
        {celular ? (
          gatilho
        ) : (
          <PainelSelecao
            open={aberta}
            onOpenChange={setAberta}
            ancora={ancora}
            itens={opcoes.map((o) => ({ value: o.valor, label: o.rotulo, texto: o.rotulo }))}
            valor={valor}
            onEscolher={escolher}
            pesquisavel={false}
            rotulo={rotulo}
            controleRef={controle}
          >
            {gatilho}
          </PainelSelecao>
        )}
      </div>
      {celular && aberta ? (
        <MobileSheet open onClose={() => setAberta(false)} label={rotulo} title={rotulo}>
          <div className="mgs__lista" role="listbox" aria-label={rotulo}>
            {opcoes.map((o) => {
              const on = o.valor === valor;
              return (
                <button
                  key={o.valor}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`mgs__op${on ? " is-on" : ""}`}
                  onClick={() => escolher(o.valor)}
                >
                  <span className="mgs__label">{o.rotulo}</span>
                  {on ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </MobileSheet>
      ) : null}
    </>
  );
}
