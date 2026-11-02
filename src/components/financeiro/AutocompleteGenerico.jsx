import React, { useState, useRef, useCallback, useMemo } from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";
import PainelSelecao from "@/components/common/PainelSelecao";

/** Teto de itens desenhados na folha do celular — cadastros podem ter milhares. */
const LIMITE_CELULAR = 100;

const porNome = (displayField) => (a, b) =>
  String(a?.[displayField] || "").localeCompare(String(b?.[displayField] || ""), "pt-BR", { numeric: true, sensitivity: "base" });

/**
 * Campo de escolha num cadastro (Setor, Marca, Categoria…).
 *
 * - Celular: folha de baixo (D-PROD-88/95).
 * - Desktop/tablet (D-PROD-105): o campo inteiro abre o `PainelSelecao` logo
 *   abaixo dele — pesquisa em cima, lista no visual da lista de Marca, "+ Novo"
 *   embaixo. Digitar com o campo focado já abre com a pesquisa preenchida.
 */
export default function AutocompleteGenerico({
  items,
  value,
  onChange,
  // Já usado como `${className || ''}` no corpo: o default não muda render.
  className = "",
  placeholder = "Buscar...",
  displayField = "nome",
  searchFields = ["nome"],
  // Opcionais: o corpo já guarda com `renderItem ? …` e `renderSubtext &&`.
  // Sem o default, o tipo inferido os tornava obrigatórios em todo call site.
  renderItem = null,
  renderSubtext = null,
  inputClassName = "",
  disabled = false,
  readOnly = false,
  uppercaseDisplay = true,
  // Botão + para cadastrar um item novo sem sair do formulário (D-PROD-95).
  // Recebe o texto pesquisado, para já sugerir o nome.
  onCreateNew = undefined,
  createNewLabel = "Cadastrar novo"
}) {
  const [open, setOpen] = useState(false);
  const [buscaInicial, setBuscaInicial] = useState("");
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const celular = useCelular();
  const [buscaCelular, setBuscaCelular] = useState("");
  const [rotuloCelular, setRotuloCelular] = useState("");

  const itemSelecionado = items.find((item) => item.id === value);
  const ordenados = useMemo(() => [...items].sort(porNome(displayField)), [items, displayField]);

  const handleSelect = useCallback((item) => {
    if (disabled || readOnly) return;
    onChange(item.id);
    setOpen(false);
  }, [onChange, disabled, readOnly]);

  const criarNovo = (termo) => {
    setOpen(false);
    onCreateNew?.(String(termo || "").trim());
  };

  const controlePainel = useRef(null);
  // Desktop/tablet: o campo inteiro (o `.mg-field`) é a âncora do painel.
  const ancora = useCallback(() => wrapperRef.current?.closest(".mg-field") ?? wrapperRef.current, []);

  if (celular) {
    const termo = buscaCelular.trim().toLowerCase();
    const encontrados = termo
      ? itensFiltradosCelular(items, displayField, searchFields, termo)
      : [...items].sort((a, b) => String(a?.[displayField] || "").localeCompare(String(b?.[displayField] || ""), "pt-BR", { numeric: true, sensitivity: "base" }));
    const vistos = encontrados.slice(0, LIMITE_CELULAR);
    const fmt = (n) => n.toLocaleString("pt-BR");
    const abrir = () => {
      if (disabled || readOnly) return;
      const rotulo = wrapperRef.current?.closest(".mg-field, .cadastro-b1-form-field")?.querySelector("label")?.textContent || "";
      setRotuloCelular(rotulo.replace(/\s*\*\s*$/, "").trim() || placeholder.replace(/^buscar\s*/i, "").replace(/\.+$/, ""));
      setBuscaCelular("");
      setOpen(true);
    };
    const titulo = rotuloCelular || "Selecione";
    return (
      <div ref={wrapperRef} className={`relative ${className || ''}`}>
        <input
          ref={inputRef}
          value={itemSelecionado ? itemSelecionado[displayField] || "" : ""}
          readOnly
          onClick={abrir}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              abrir();
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`flex w-full bg-transparent pr-8 h-8 text-xs rounded-none cursor-pointer outline-none ${uppercaseDisplay ? 'uppercase' : ''} ${inputClassName}`}
          style={uppercaseDisplay ? { textTransform: 'uppercase', caretColor: 'transparent' } : { caretColor: 'transparent' }} />
        <ChevronDown className="mk-ac-chev" aria-hidden />
        <MobileSheet
          open={open}
          onClose={() => setOpen(false)}
          label={titulo}
          title={titulo}
          headerAction={onCreateNew ?
          <button type="button" className="mk-sheet__new" aria-label={createNewLabel} title={createNewLabel} onClick={() => criarNovo(buscaCelular)}>
              <Plus size={22} aria-hidden />
            </button> :
          null}
          aside={items.length > 8 ? `${fmt(items.length)} registros` : null}
          footer={encontrados.length > LIMITE_CELULAR ? <span className="mgs__mais">Mostrando {LIMITE_CELULAR} de {fmt(encontrados.length)} · refine a pesquisa</span> : null}
        >
          {items.length > 8 ? <div className="mk-pill mgs__busca">
            {buscaCelular ? (
              <button type="button" className="mk-pill__clear" aria-label="Limpar pesquisa" onClick={() => setBuscaCelular("")}>
                <X size={14} />
              </button>
            ) : (
              <span className="mk-pill__icon" aria-hidden>
                <Search size={14} />
              </span>
            )}
            <input
              value={buscaCelular}
              onChange={(e) => setBuscaCelular(e.target.value)}
              placeholder={`Pesquisar ${titulo}…`}
              aria-label={`Pesquisar ${titulo}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && vistos[0]) {
                  e.preventDefault();
                  handleSelect(vistos[0]);
                }
              }} />
          </div> : null}
          {termo ? <div className="mgs__count">{fmt(encontrados.length)} encontrado{encontrados.length === 1 ? "" : "s"}</div> : null}
          <div className="mgs__lista" role="listbox" aria-label={titulo}>
            {!vistos.length ? <div className="mgs__vazio">Nenhum registro encontrado</div> : null}
            {vistos.map((item) => {
              const on = item.id === value;
              return (
                <button key={item.id} type="button" role="option" aria-selected={on} className={`mgs__op${on ? ' is-on' : ''}`} onClick={() => handleSelect(item)}>
                  <span className="mgs__label">
                    {renderItem ? renderItem(item) : item[displayField]}
                    {renderSubtext ? <span className="mgs__sec">{renderSubtext(item)}</span> : null}
                  </span>
                  {on ? <Check size={14} aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </MobileSheet>
      </div>);
  }

  const bloqueado = disabled || readOnly;
  const abrirDesktop = (semente = "") => {
    if (bloqueado) return;
    setBuscaInicial(semente);
    setOpen(true);
  };
  const textoBusca = (item) => searchFields.map((f) => item?.[f]).filter((v) => v != null && v !== "").join(" ");
  const itensPainel = ordenados.map((item) => ({
    value: item.id,
    label: renderItem ? renderItem(item) : item[displayField],
    texto: textoBusca(item) || String(item?.[displayField] ?? ""),
    sub: renderSubtext ? renderSubtext(item) : null
  }));

  return (
    <PainelSelecao
      open={open}
      onOpenChange={setOpen}
      ancora={ancora}
      controleRef={controlePainel}
      itens={itensPainel}
      valor={value ?? null}
      onEscolher={(id) => {
        const item = items.find((i) => i.id === id);
        if (item) handleSelect(item);
      }}
      buscaInicial={buscaInicial}
      rotulo={placeholder.replace(/^buscar\s*/i, "").replace(/\.+$/, "") || "opções"}
      onCriarNovo={onCreateNew && !bloqueado ? criarNovo : undefined}
      rotuloNovo={createNewLabel}
      vazio={items.length ? "Nenhum item" : "Nenhuma opção disponível"}>
      <div
        ref={wrapperRef}
        className={`relative mk-sel-campo ${className || ''}`}
        onClick={() => (open ? setOpen(false) : abrirDesktop(""))}>
        <input
          ref={inputRef}
          readOnly={bloqueado}
          onChange={() => {}}
          value={itemSelecionado ? itemSelecionado[displayField] || "" : ""}
          placeholder={placeholder}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onKeyDown={(e) => {
            if (bloqueado) return;
            if (open && controlePainel.current && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) {
              controlePainel.current.tecla(e);
              return;
            }
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
              e.preventDefault();
              abrirDesktop("");
            } else if ((e.key === "Backspace" || e.key === "Delete") && value) {
              e.preventDefault();
              onChange("");
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault();
              abrirDesktop(e.key);
            }
          }}
          className={`flex w-full bg-transparent pr-8 h-8 text-xs rounded-none outline-none ${uppercaseDisplay ? 'uppercase' : ''} ${inputClassName}`}
          style={uppercaseDisplay ? { textTransform: 'uppercase' } : undefined} />
        {itemSelecionado && !bloqueado ?
        <button
          type="button"
          aria-label="Limpar"
          title="Limpar"
          onClick={(e) => {e.stopPropagation();onChange("");}}
          className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X className="w-3.5 h-3.5" />
          </button> :
        null}
        <ChevronDown className="mk-ac-chev" aria-hidden />
      </div>
    </PainelSelecao>);

}
/** Filtro da folha do celular: mesmos campos de busca do desktop. */
function itensFiltradosCelular(items, displayField, searchFields, termo) {
  return [...items]
    .filter((item) => searchFields.some((f) => item?.[f] != null && String(item[f]).toLowerCase().includes(termo)))
    .sort((a, b) => String(a?.[displayField] || "").localeCompare(String(b?.[displayField] || ""), "pt-BR", { numeric: true, sensitivity: "base" }));
}
