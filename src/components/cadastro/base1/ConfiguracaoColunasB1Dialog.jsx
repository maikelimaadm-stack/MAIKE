import React from "react";
import { createPortal } from "react-dom";
import { GripVertical, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Configurador de colunas no padrão Portal de Compras / `ColunasDosItens` (CONTROLE-DE-ESTOQUE).
 * Duas listas: ocultas × visíveis, clique ou arraste para mover/reordenar.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onFechar
 * @param {string} [props.titulo]
 * @param {Array<{ id: string; label: string }>} props.colunas ordem canônica
 * @param {Set<string>} props.ocultas ids ocultos
 * @param {(id: string, ocultar: boolean) => void} props.onMudar
 * @param {(ids: string[]) => void} props.onOrdenar
 * @param {() => void} props.onRestaurar
 */
export default function ConfiguracaoColunasB1Dialog({
  open,
  onFechar,
  titulo = "Colunas da tabela",
  colunas,
  ocultas,
  onMudar,
  onOrdenar,
  onRestaurar,
}) {
  const [busca, setBusca] = React.useState("");
  const [arrastada, setArrastada] = React.useState(null);
  const [alvo, setAlvo] = React.useState(null);
  const dialogo = React.useRef(null);
  const fechar = React.useRef(onFechar);
  fechar.current = onFechar;

  React.useEffect(() => {
    if (!open) return;
    const anterior = document.activeElement;
    dialogo.current?.querySelector("input")?.focus();
    const teclado = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        fechar.current();
      }
      if (e.key !== "Tab") return;
      const botoes = dialogo.current?.querySelectorAll(
        'button:not(:disabled), input, [tabindex="0"]',
      );
      if (!botoes?.length) return;
      const primeiro = botoes[0];
      const ultimo = botoes[botoes.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      }
      if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener("keydown", teclado);
    return () => {
      document.removeEventListener("keydown", teclado);
      if (anterior instanceof HTMLElement) anterior.focus();
    };
  }, [open]);

  if (!open) return null;

  const livres = colunas.filter((c) => ocultas.has(c.id));
  const usadas = colunas.filter((c) => !ocultas.has(c.id));

  const soltar = (e, ocultar, antes) => {
    e.preventDefault();
    e.stopPropagation();
    const key = arrastada ?? e.dataTransfer.getData("text/plain");
    if (!colunas.some((c) => c.id === key)) return;
    if (ocultar && !ocultas.has(key) && usadas.length <= 1) return;
    onMudar(key, ocultar);
    const ordem = colunas.map((c) => c.id).filter((k) => k !== key);
    const indice = antes ? ordem.indexOf(antes) : -1;
    if (antes !== key) {
      ordem.splice(indice < 0 ? ordem.length : indice, 0, key);
      onOrdenar(ordem);
    }
    setArrastada(null);
    setAlvo(null);
  };

  const lista = (itens, on, vazio) => (
    <div
      className="dbox-l"
      data-testid={on ? "colunas-na-tabela" : "colunas-disponiveis"}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => soltar(e, !on)}
    >
      {itens
        .filter((c) => c.label.toLowerCase().includes(busca.toLowerCase()))
        .map((c) => {
          const travada = on && usadas.length <= 1;
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              draggable
              data-coluna={c.id}
              aria-label={c.label}
              aria-disabled={travada}
              className={cn(
                "dlin",
                on && "on",
                arrastada === c.id && "indo",
                alvo === c.id && arrastada !== c.id && "mira",
              )}
              title={
                travada
                  ? "Ao menos uma coluna fica na tabela"
                  : on
                    ? "Clique para ocultar · arraste para reordenar"
                    : "Clique para exibir · arraste para a tabela"
              }
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", c.id);
                e.dataTransfer.effectAllowed = "move";
                setArrastada(c.id);
              }}
              onDragEnd={() => {
                setArrastada(null);
                setAlvo(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setAlvo(c.id);
              }}
              onDrop={(e) => soltar(e, !on, c.id)}
              onClick={() => !travada && onMudar(c.id, on)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !travada) {
                  e.preventDefault();
                  onMudar(c.id, on);
                }
                if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                  e.preventDefault();
                  const keys = colunas.map((x) => x.id);
                  const i = keys.indexOf(c.id);
                  const j = i + (e.key === "ArrowUp" ? -1 : 1);
                  if (j >= 0 && j < keys.length) {
                    [keys[i], keys[j]] = [keys[j], keys[i]];
                    onOrdenar(keys);
                  }
                }
              }}
            >
              <span className="dlin-l">{c.label}</span>
              <span className="gripe">
                <GripVertical size={13} />
              </span>
            </div>
          );
        })}
      {!itens.some((c) => c.label.toLowerCase().includes(busca.toLowerCase())) ? (
        <span className="dvaz">{vazio}</span>
      ) : null}
    </div>
  );

  return createPortal(
    <div className="b1ref">
      <div
        className="mdl"
        onClick={(e) => {
          if (e.target === e.currentTarget) onFechar();
        }}
      >
        <div className="mdlc" ref={dialogo} role="dialog" aria-modal="true" aria-label={titulo}>
          <div className="mdl-h">
            <span className="mdl-t">{titulo}</span>
            <span style={{ flexGrow: 1 }} />
            <button type="button" className="tb-btn tb-btn-out sm" onClick={onRestaurar}>
              Restaurar padrão
            </button>
            <button type="button" className="rm" aria-label="Fechar" onClick={onFechar}>
              <X size={14} />
            </button>
          </div>
          <div className="mdl-b">
            <label className="cfgb">
              <Search size={14} />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Procurar coluna nas duas listas…"
                aria-label="Procurar coluna"
              />
              {busca ? (
                <button
                  type="button"
                  className="rm"
                  aria-label="Limpar busca"
                  onClick={() => setBusca("")}
                >
                  <X size={12} />
                </button>
              ) : null}
            </label>
            <div className="dcol">
              <div className="dbox">
                <div className="dbox-h">Disponíveis</div>
                {lista(livres, false, "Nenhuma coluna oculta.")}
              </div>
              <div className="dbox">
                <div className="dbox-h">Na tabela</div>
                {lista(usadas, true, "Nenhuma coluna visível.")}
              </div>
            </div>
          </div>
          <div className="mdl-f">
            <span style={{ flexGrow: 1 }} />
            <button type="button" className="tb-btn tb-btn-out sm" onClick={onFechar}>
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
