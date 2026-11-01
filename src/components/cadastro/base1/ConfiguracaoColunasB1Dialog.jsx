import React from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  GripVertical,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortalComprasSkin } from "./portalComprasSkinContext";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";
import ToggleSwitch from "@/components/common/ToggleSwitch";

/**
 * Configurador de colunas — paridade `ColunasDosItens` (portal compras / CONTROLE-DE-ESTOQUE).
 * Rascunho até Pronto; ESC e clique no fundo não fecham (só Fechar / ✓ descartam ou aplicam).
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onFechar descarta rascunho
 * @param {string} [props.titulo]
 * @param {Array<{ id: string; label: string }>} props.colunas ordem canônica inicial
 * @param {Set<string>} props.ocultas ids ocultos (estado aplicado ao abrir)
 * @param {(keysVisiveis: string[], ordemCompleta: string[]) => void} props.onAplicar
 * @param {() => void} props.onRestaurar padrão da tela (aplicado ao confirmar com flag interna)
 */
export default function ConfiguracaoColunasB1Dialog({
  open,
  onFechar,
  titulo = "Colunas da tabela",
  colunas,
  ocultas,
  onAplicar,
  onRestaurar,
}) {
  const portalSkin = usePortalComprasSkin();
  const celular = useCelular();
  const ordemInicial = React.useMemo(() => colunas.map((c) => c.id), [colunas]);
  const [qa, setQa] = React.useState("");
  const [qu, setQu] = React.useState("");
  const [sel, setSel] = React.useState(null);
  const [arrastada, setArrastada] = React.useState(null);
  const [alvo, setAlvo] = React.useState(null);
  const [draftOcultas, setDraftOcultas] = React.useState(() => new Set(ocultas));
  const [draftOrdem, setDraftOrdem] = React.useState(() => ordemInicial);
  const [aplicarPadrao, setAplicarPadrao] = React.useState(false);
  const semeado = React.useRef(false);
  const dialogo = React.useRef(null);

  React.useEffect(() => {
    if (!open) {
      semeado.current = false;
      return;
    }
    if (semeado.current) return;
    semeado.current = true;
    setDraftOcultas(new Set(ocultas));
    setDraftOrdem(ordemInicial);
    setQa("");
    setQu("");
    setSel(null);
    setAplicarPadrao(false);
  }, [open, ocultas, ordemInicial]);

  React.useEffect(() => {
    if (!open) return;
    dialogo.current?.querySelector("input")?.focus();
  }, [open]);

  if (!open) return null;

  const porChave = new Map(colunas.map((c) => [c.id, c]));
  const livres = draftOrdem.filter((k) => draftOcultas.has(k)).map((k) => porChave.get(k)).filter(Boolean);
  const usadas = draftOrdem.filter((k) => !draftOcultas.has(k)).map((k) => porChave.get(k)).filter(Boolean);
  const filtra = (itens, q) =>
    itens.filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));

  const mover = (key, ocultar, antes) => {
    if (!porChave.has(key)) return;
    if (ocultar && !draftOcultas.has(key) && usadas.length <= 1) return;
    setAplicarPadrao(false);
    setDraftOcultas((p) => {
      const n = new Set(p);
      if (ocultar) n.add(key);
      else n.delete(key);
      return n;
    });
    setDraftOrdem((ordem) => {
      const sem = ordem.filter((k) => k !== key);
      const indice = antes ? sem.indexOf(antes) : -1;
      if (antes !== key) sem.splice(indice < 0 ? sem.length : indice, 0, key);
      return sem;
    });
  };

  const soltar = (e, ocultar, antes) => {
    e.preventDefault();
    e.stopPropagation();
    const key = arrastada ?? e.dataTransfer.getData("text/plain");
    mover(key, ocultar, antes);
    setArrastada(null);
    setAlvo(null);
  };

  const usarTodas = () => {
    setAplicarPadrao(false);
    setDraftOcultas(new Set());
    setSel(null);
  };
  const removerTodas = () => {
    if (usadas.length <= 1) return;
    setAplicarPadrao(false);
    const manter = usadas[0].id;
    setDraftOcultas(new Set(draftOrdem.filter((k) => k !== manter)));
    setSel(null);
  };
  const usarSel = () => {
    if (sel && draftOcultas.has(sel)) mover(sel, false);
  };
  const removerSel = () => {
    if (sel && !draftOcultas.has(sel)) mover(sel, true);
  };

  const salvar = () => {
    if (aplicarPadrao) {
      onRestaurar();
      onFechar();
      return;
    }
    const visiveis = draftOrdem.filter((k) => !draftOcultas.has(k));
    onAplicar(visiveis, draftOrdem);
    onFechar();
  };

  const restaurarRascunho = () => {
    setDraftOcultas(new Set());
    setDraftOrdem(ordemInicial);
    setSel(null);
    setAplicarPadrao(true);
  };

  // Celular (D-PROD-96): uma lista só, no padrão dos Ajustes do iPhone —
  // chave para mostrar/ocultar, ↑ ↓ para a ordem, pesquisa, Restaurar padrão.
  // ✕ descarta e ✓ aplica, como nas outras folhas.
  if (celular) {
    const termo = qa.trim().toLowerCase();
    const todas = draftOrdem.map((k) => porChave.get(k)).filter(Boolean);
    const vistas = termo ? todas.filter((c) => c.label.toLowerCase().includes(termo)) : todas;
    // A chave só mostra/oculta: a posição da coluna não muda.
    const alternar = (key, ocultar) => {
      if (ocultar && usadas.length <= 1) return;
      setAplicarPadrao(false);
      setDraftOcultas((p) => {
        const n = new Set(p);
        if (ocultar) n.add(key);
        else n.delete(key);
        return n;
      });
    };
    const subirDescer = (key, delta) => {
      setAplicarPadrao(false);
      setDraftOrdem((ordem) => {
        const i = ordem.indexOf(key);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= ordem.length) return ordem;
        const n = [...ordem];
        [n[i], n[j]] = [n[j], n[i]];
        return n;
      });
    };
    return (
      <MobileSheet
        open
        onClose={onFechar}
        label={titulo}
        title={titulo}
        initialLarge
        aside={`${usadas.length} de ${todas.length} visíveis`}
        className="mk-colcfg"
        headerAction={
          <button type="button" className="mk-sheet__new" aria-label="Aplicar" title="Aplicar" onClick={salvar}>
            <Check size={22} aria-hidden />
          </button>
        }
      >
        <div className="mk-pill mgs__busca">
          {qa ? (
            <button type="button" className="mk-pill__clear" aria-label="Limpar pesquisa" onClick={() => setQa("")}>
              <X size={14} />
            </button>
          ) : (
            <span className="mk-pill__icon" aria-hidden>
              <Search size={14} />
            </span>
          )}
          <input value={qa} onChange={(e) => setQa(e.target.value)} placeholder="Pesquisar coluna…" aria-label="Pesquisar coluna" />
        </div>
        <div className="mgs__lista mk-colcfg__lista" role="list" aria-label="Colunas">
          {!vistas.length ? <div className="mgs__vazio">Nenhuma coluna encontrada</div> : null}
          {vistas.map((c) => {
            const visivel = !draftOcultas.has(c.id);
            const travada = visivel && usadas.length <= 1;
            const i = draftOrdem.indexOf(c.id);
            return (
              <div key={c.id} role="listitem" className="mgs__op mk-colcfg__row" data-coluna={c.id}>
                <span className={cn("mk-colcfg__nome", !visivel && "is-off")}>{c.label}</span>
                {!termo ? (
                  <span className="mk-colcfg__ordem">
                    <button type="button" aria-label={`Subir ${c.label}`} disabled={i <= 0} onClick={() => subirDescer(c.id, -1)}>
                      <ChevronUp size={18} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Descer ${c.label}`}
                      disabled={i >= draftOrdem.length - 1}
                      onClick={() => subirDescer(c.id, 1)}
                    >
                      <ChevronDown size={18} aria-hidden />
                    </button>
                  </span>
                ) : null}
                <span title={travada ? "Ao menos uma coluna fica na tabela" : undefined}>
                  <ToggleSwitch checked={visivel} disabled={travada} ariaLabel={`Mostrar ${c.label}`} onChange={() => alternar(c.id, visivel)} />
                </span>
              </div>
            );
          })}
        </div>
        <button type="button" className="mk-colcfg__restaurar" onClick={restaurarRascunho}>
          <RotateCcw size={16} aria-hidden /> Restaurar padrão
        </button>
      </MobileSheet>
    );
  }

  const lista = (itens, on, q, vazio) => {
    const vistas = filtra(itens, q);
    return (
      <div
        className="dbox-l"
        data-testid={on ? "colunas-na-tabela" : "colunas-disponiveis"}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => soltar(e, !on)}
      >
        {vistas.map((c) => {
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
                sel === c.id && "sel",
                arrastada === c.id && "indo",
                alvo === c.id && arrastada !== c.id && "mira",
              )}
              title={
                travada
                  ? "Ao menos uma coluna fica na tabela"
                  : on
                    ? "Clique para selecionar · duplo clique para ocultar · arraste para reordenar"
                    : "Clique para selecionar · duplo clique para usar · arraste para a tabela"
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
              onClick={() => setSel(c.id)}
              onDoubleClick={() => !travada && mover(c.id, on)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !travada) {
                  e.preventDefault();
                  mover(c.id, on);
                }
                if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                  e.preventDefault();
                  setAplicarPadrao(false);
                  setDraftOrdem((keys) => {
                    const i = keys.indexOf(c.id);
                    const j = i + (e.key === "ArrowUp" ? -1 : 1);
                    if (j < 0 || j >= keys.length) return keys;
                    const n = [...keys];
                    [n[i], n[j]] = [n[j], n[i]];
                    return n;
                  });
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
        {vistas.length === 0 ? <span className="dvaz">{vazio}</span> : null}
      </div>
    );
  };

  const busca = (valor, onChange, rotulo) => (
    <label className="cfgb cfgb-lista">
      <Search size={14} aria-hidden />
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Procurar coluna"
        aria-label={rotulo}
      />
      {valor ? (
        <button type="button" className="xlim" aria-label="Limpar busca" onClick={() => onChange("")}>
          <X size={12} />
        </button>
      ) : (
        <span className="xlim" aria-hidden />
      )}
    </label>
  );

  return createPortal(
    <div className={cn("b1ref cadastro-b1", portalSkin && "b1-portal-compras")}>
      <div className="mdl">
        <div className="mdlc" ref={dialogo} role="dialog" aria-modal="true" aria-label={titulo}>
          <div className="mdl-h">
            <span className="mdl-t">{titulo}</span>
            <span style={{ flexGrow: 1 }} />
            <button
              type="button"
              className="tb-btn tb-btn-icon tb-btn-sm"
              aria-label="Restaurar padrão"
              title="Restaurar padrão"
              onClick={restaurarRascunho}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="tb-btn tb-btn-icon tb-btn-sm"
              aria-label="Fechar"
              title="Fechar"
              onClick={onFechar}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mdl-b">
            <div className="dcol">
              <div className="dbox">
                {busca(qa, setQa, "Procurar em disponíveis")}
                <span className="dbox-h">
                  Disponíveis
                  <span className="bd t-plain">{livres.length}</span>
                </span>
                {lista(livres, false, qa, qa ? "Nenhuma coluna com esse texto." : "Todas as colunas estão na tabela.")}
              </div>
              <div className="dmid" aria-label="Mover colunas">
                <button type="button" className="dmid-btn" title="Usar todas" aria-label="Usar todas" onClick={usarTodas}>
                  <ChevronsRight />
                </button>
                <button
                  type="button"
                  className="dmid-btn"
                  title="Usar coluna selecionada"
                  aria-label="Usar coluna selecionada"
                  onClick={usarSel}
                >
                  <ChevronRight />
                </button>
                <button
                  type="button"
                  className="dmid-btn"
                  title="Remover coluna selecionada"
                  aria-label="Remover coluna selecionada"
                  onClick={removerSel}
                >
                  <ChevronLeft />
                </button>
                <button
                  type="button"
                  className="dmid-btn"
                  title="Remover todas (mantém a primeira)"
                  aria-label="Remover todas (mantém a primeira)"
                  onClick={removerTodas}
                >
                  <ChevronsLeft />
                </button>
              </div>
              <div className="dbox">
                {busca(qu, setQu, "Procurar na tabela")}
                <span className="dbox-h">
                  Na tabela
                  <span className="bd t-positive">{usadas.length}</span>
                </span>
                {lista(usadas, true, qu, "Nenhuma coluna com esse texto.")}
              </div>
            </div>
          </div>
          <div className="mdl-f">
            <span style={{ flexGrow: 1 }} />
            <button
              type="button"
              className="tb-btn tb-btn-icon tb-btn-green"
              aria-label="Pronto"
              title="Pronto"
              onClick={salvar}
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
