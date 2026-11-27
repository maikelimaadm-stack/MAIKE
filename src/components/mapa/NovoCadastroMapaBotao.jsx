import React, { useEffect, useRef, useState } from "react";
import { Plus, X, Hexagon, MapPin, Spline } from "lucide-react";

/**
 * D-PROD-361 — o "+" redondo da aba Pontos do Mapa Geral abre a escolha do que cadastrar, como no AgriWebb:
 * pasto (área), ponto ou linha. Antes ele só criava ponto; área e linha exigiam ir ao menu Cadastro do Mapa.
 *
 * @param {{ onEscolher: (tipo: 'area'|'ponto'|'linha') => void }} props
 */
export default function NovoCadastroMapaBotao({ onEscolher }) {
  const [aberto, setAberto] = useState(false);
  const raizRef = useRef(/** @type {HTMLDivElement|null} */ (null));

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => {
      if (raizRef.current && !raizRef.current.contains(/** @type {Node} */ (e.target))) setAberto(false);
    };
    const tecla = (e) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  const escolher = (tipo) => {
    setAberto(false);
    onEscolher(tipo);
  };

  return (
    <div ref={raizRef} className="mk-mapa-novo-cadastro">
      {aberto && (
        <div role="menu" aria-label="O que cadastrar" className="mk-mapa-novo-menu">
          <button type="button" role="menuitem" className="mk-mapa-novo-opcao" onClick={() => escolher("area")}>
            <Hexagon size={20} aria-hidden /> Novo pasto
          </button>
          <button type="button" role="menuitem" className="mk-mapa-novo-opcao" onClick={() => escolher("ponto")}>
            <MapPin size={20} aria-hidden /> Novo ponto
          </button>
          <button type="button" role="menuitem" className="mk-mapa-novo-opcao" onClick={() => escolher("linha")}>
            <Spline size={20} aria-hidden /> Nova linha
          </button>
        </div>
      )}
      <button
        type="button"
        className="mk-mapa-novo-ponto"
        aria-label="Novo cadastro no mapa"
        title="Novo pasto, ponto ou linha"
        aria-haspopup="menu"
        aria-expanded={aberto}
        data-mk-novo-ponto=""
        onClick={() => setAberto((v) => !v)}
      >
        {aberto ? <X size={28} strokeWidth={2.6} aria-hidden /> : <Plus size={30} strokeWidth={2.6} aria-hidden />}
      </button>
    </div>
  );
}
