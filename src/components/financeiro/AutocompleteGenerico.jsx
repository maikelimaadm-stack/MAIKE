import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";

/** O `Input` do shadcn não declara props; o cast evita o falso TS2322 em cada uso. */
const CampoTexto = /** @type {any} */ (Input);

/** Teto de itens desenhados na folha do celular — cadastros podem ter milhares. */
const LIMITE_CELULAR = 100;

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
  const [searchTerm, setSearchTerm] = useState("");
  const [dropdownPos, setDropdownPos] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const interactingWithDropdownRef = useRef(false);
  const portalContainerRef = useRef(null);
  const celular = useCelular();
  const [buscaCelular, setBuscaCelular] = useState("");
  const [rotuloCelular, setRotuloCelular] = useState("");

  const itemSelecionado = items.find((item) => item.id === value);

  useEffect(() => {
    if (itemSelecionado) {
      setSearchTerm(itemSelecionado[displayField] || "");
    } else if (!value) {
      setSearchTerm("");
    }
  }, [itemSelecionado, displayField, value]);

  useEffect(() => {
    if (wrapperRef.current) {
      portalContainerRef.current = wrapperRef.current.closest('[role="dialog"]') || null;
    }
  }, []);

  const calcPosition = useCallback(() => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    const dialogEl = wrapperRef.current?.closest('[role="dialog"]');
    const dialogRect = dialogEl?.getBoundingClientRect();
    portalContainerRef.current = dialogEl || null;

    setDropdownPos({
      top: dialogRect ? r.bottom - dialogRect.top + 2 : r.bottom + 2,
      left: dialogRect ? r.left - dialogRect.left : r.left,
      width: r.width,
      inDialog: !!dialogRect
    });
  }, []);

  // Recalcular posição quando abre ou quando rola o scroll
  useEffect(() => {
    if (!open) return;
    calcPosition();

    const handleScroll = (event) => {
      if (dropdownRef.current && dropdownRef.current.contains(event.target)) return;
      calcPosition();
    };
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open, calcPosition]);

  // Fechar ao clicar fora. No celular a lista vive na folha de baixo (portal
  // fora do campo): quem fecha é a própria folha (fundo, alça, Esc). Se este
  // ouvinte valesse ali, o toque na opção fecharia a folha no pointerdown e a
  // escolha se perderia antes do click.
  useEffect(() => {
    if (!open || celular) return;
    function handleClickOutside(event) {
      const isInsideWrapper = wrapperRef.current && wrapperRef.current.contains(event.target);
      const isInsideDropdown = dropdownRef.current && dropdownRef.current.contains(event.target);
      if (interactingWithDropdownRef.current) return;
      if (!isInsideWrapper && !isInsideDropdown) {
        setOpen(false);
        if (itemSelecionado) {
          setSearchTerm(itemSelecionado[displayField] || "");
        } else {
          setSearchTerm("");
        }
      }
    }
    document.addEventListener("pointerdown", handleClickOutside);
    return () => document.removeEventListener("pointerdown", handleClickOutside);
  }, [open, celular, itemSelecionado, displayField]);

  const itensFiltrados = [...items].
  sort((a, b) => String(a?.[displayField] || "").localeCompare(String(b?.[displayField] || ""), "pt-BR", { numeric: true, sensitivity: "base" })).
  filter((item) => {
    const search = searchTerm.toLowerCase();
    return searchFields.some((field) => {
      const fieldValue = item[field];
      return fieldValue && String(fieldValue).toLowerCase().includes(search);
    });
  });

  useEffect(() => {
    if (!open) return;
    const selectedIndex = itensFiltrados.findIndex((item) => item.id === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, searchTerm, value, itensFiltrados.length]);

  const handleSelect = useCallback((item) => {
    if (disabled || readOnly) return;
    onChange(item.id);
    setSearchTerm(item[displayField] || "");
    setOpen(false);
  }, [onChange, displayField, disabled, readOnly]);

  const handleKeyDown = (e) => {
    if (disabled || readOnly) return;

    if (e.key === "Tab") {
      setOpen(false);
      return;
    }

    if (e.key === "Escape") {
      setOpen(false);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((prev) => Math.min(prev + 1, Math.max(itensFiltrados.length - 1, 0)));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (e.key === "Enter" && open && itensFiltrados[activeIndex]) {
      e.preventDefault();
      handleSelect(itensFiltrados[activeIndex]);
    }
  };

  const handleClear = () => {
    if (disabled || readOnly) return;
    onChange("");
    setSearchTerm("");
    calcPosition();
    setOpen(true);
    inputRef.current?.focus();
  };

  const hasResults = itensFiltrados.length > 0;
  const criarNovo = (termo) => {
    setOpen(false);
    onCreateNew?.(String(termo || "").trim());
  };
  const linhaCriarNovo = onCreateNew && !readOnly && !disabled ?
  <button
    type="button"
    className="mk-ac-novo"
    onPointerDown={(e) => e.stopPropagation()}
    onMouseDown={(e) => {e.preventDefault();e.stopPropagation();}}
    onClick={(e) => {e.stopPropagation();criarNovo(itemSelecionado && searchTerm === itemSelecionado[displayField] ? "" : searchTerm);}}>
      <Plus className="h-3.5 w-3.5" aria-hidden />
      {createNewLabel}
    </button> :
  null;
  // Sem resultado também avisa sem pesquisa (lista vazia ou ainda carregando):
  // antes o painel simplesmente não abria e parecia que o campo travou.
  const showEmpty = open && !hasResults;

  const renderDropdownContent = () => {
    if (!open || !dropdownPos) return null;

    const style = dropdownPos.inDialog ?
    { position: 'absolute', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 999999, pointerEvents: 'auto' } :
    { position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 999999, pointerEvents: 'auto' };

    let content = null;

    if (hasResults) {
      content =
      <div
        ref={dropdownRef}
        style={style}
        onPointerDownCapture={() => {
          interactingWithDropdownRef.current = true;
        }}
        onPointerUpCapture={() => {
          setTimeout(() => {
            interactingWithDropdownRef.current = false;
          }, 300);
        }}
        onMouseLeave={() => {}}
        onWheel={(e) => e.stopPropagation()}
        className="mk-ac-pop max-h-60 overflow-auto overscroll-contain">
        
          {itensFiltrados.map((item, index) =>
        <div
          key={item.id}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            handleSelect(item);
          }}
          onWheel={(e) => e.stopPropagation()}
          onMouseEnter={() => setActiveIndex(index)}
          className={`mk-ac-op${activeIndex === index ? ' is-hi' : ''}${value === item.id ? ' is-on' : ''}`}>
          
              {renderItem ? renderItem(item) :
          <>
                  <div className="text-xs font-medium text-slate-900">
                    {item[displayField]}
                  </div>
                  {renderSubtext &&
            <div className="text-[10px] text-slate-500">{renderSubtext(item)}</div>
            }
                </>
          }
            </div>
        )}
          {linhaCriarNovo}
        </div>;

    } else if (showEmpty) {
      content =
      <div
        ref={dropdownRef}
        style={style}
        className="mk-ac-pop">
          <div className="mk-ac-vazio">
            {searchTerm ? "Nenhum item encontrado" : items.length ? "Nenhum item" : "Nenhuma opção disponível"}
          </div>
          {linhaCriarNovo}
        </div>;

    }

    return content;
  };

  const renderDropdown = () => {
    const content = renderDropdownContent();
    if (!content) return null;

    return ReactDOM.createPortal(content, portalContainerRef.current || document.body);
  };

  // Celular: o campo vira um botão de leitura e a escolha acontece na folha
  // de baixo, com a mesma pesquisa das outras aberturas (D-PROD-88).
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

  return (
    <div ref={wrapperRef} className={`relative ${className || ''}`}>
      <div className="relative">
        <CampoTexto
          ref={inputRef}
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            if (!open) setOpen(true);
            calcPosition();
          }}
          onFocus={() => {
            if (disabled || readOnly) return;
            calcPosition();
            setOpen(true);
          }}
          onClick={() => {
            // Já focado (ex.: logo após escolher um item) o foco não dispara de novo.
            if (disabled || readOnly || open) return;
            calcPosition();
            setOpen(true);
          }}
          onBlur={() => {}}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder}
          className={`pr-8 h-8 text-xs rounded-none ${uppercaseDisplay ? 'uppercase' : ''} ${inputClassName}`}
          style={uppercaseDisplay ? { textTransform: 'uppercase' } : undefined} />
        
        {searchTerm && !disabled && !readOnly &&
        <button
          type="button"
          onMouseDown={(e) => {e.preventDefault();e.stopPropagation();handleClear();}}
          className="absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600">
          
            <X className="w-3.5 h-3.5" />
          </button>
        }

      </div>
      {!(searchTerm && !disabled && !readOnly) ? <ChevronDown className="mk-ac-chev" aria-hidden /> : null}
      {renderDropdown()}
    </div>);

}
/** Filtro da folha do celular: mesmos campos de busca do desktop. */
function itensFiltradosCelular(items, displayField, searchFields, termo) {
  return [...items]
    .filter((item) => searchFields.some((f) => item?.[f] != null && String(item[f]).toLowerCase().includes(termo)))
    .sort((a, b) => String(a?.[displayField] || "").localeCompare(String(b?.[displayField] || ""), "pt-BR", { numeric: true, sensitivity: "base" }));
}
