import React from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info as IconeInfo,
  Search,
  TriangleAlert,
} from "lucide-react";
import "@/styles/mk-detalhes-pasto.css";

/*
 * Peças visuais do Detalhes do Lote v12 (D-PROD-218). Puras: só props, sem
 * dados, sem consultas e sem PastoCtx. Visual em src/styles/mk-detalhes-pasto.css,
 * sob a raiz `.mk-dp` (fora dela as peças ficam sem estilo).
 *
 * ── Mapa de uso ─────────────────────────────────────────────────────────
 * Props extras (id, data-*, aria-*, role…) vão para a raiz da peça; no
 * `TituloBloco`, `id` vai para o h3 (para `aria-labelledby` de uma seção).
 * Raiz e corpo (classes, sem componente; a casca monta):
 *   <div className="mk-dp" data-modo="desktop">
 *     <Abas … />
 *     <div className="mk-dp__corpo mk-dp__corpo--cards">…blocos…</div>   // ou --lista (fundo branco)
 *     <div className="mk-dp__rodape">…RodapePilulas | RodapeBotoes…</div>
 *   </div>
 *   Troca animada: nova `key` no corpo + `mk-dp-anim--empurrar | --voltar | --aba-dir | --aba-esq | --troca`.
 *
 * <Abas abas={[{ id: "lotes", rotulo: "Lotes", badge: lotes.length }]} ativa="lotes" onMudar={setAba} idBase="pasto" />
 *     badge 0, null, "" ou false → sem badge (pasto sem lote: só "Lotes", como o v12)
 *     painel: <div role="tabpanel" id={idsDaAba("pasto", aba).painel} aria-labelledby={idsDaAba("pasto", aba).aba}>
 * <CabecalhoProprio titulo="L-2026-008" sub="VACA · Pasto 07" onVoltar={voltar} />   // só sem o diálogo
 * <TituloBloco link="Configurar tabela" onLink={abrir}>6 lotes · 314 cab</TituloBloco>
 * <Cartao icone={Sprout} titulo="Pasto 07" sub="Pastagem / Braquiária Brizantha" chip={<Chip tom="ok">Em dia</Chip>}>
 *   <Grade>
 *     <Celula rotulo="UA/ha" valor="2,24" bolinha="#f59e0b" sub="Alta (1,8 - 2,4 UA/ha)" />
 *     <Celula rotulo="% da capacidade" valor="102%" cor="#b45309" barra={100} corBarra="#f59e0b" />
 *   </Grade>
 *   <Linha rotulo="Projeção (fim do mês)" sub="peso projetado…" valor="30/11: 469 · 31/12: 475" quebra />
 * </Cartao>
 * <Linha imagem={<IconeCategoria figura="macho-0-8" tamanho={26} />} rotulo="BEZERRO" sub="20% do pasto" valor="62 cab" />
 * <Aviso tom="atencao">Faz 82 dias sem pesar</Aviso>                    // tom="neutro" → faixa teal com ícone info
 * <Nota>Registros de todas as movimentações…</Nota>
 * <Vazio icone={Beef}>Nenhum lote neste pasto agora.</Vazio>
 * <Chip tom="atencao">Atenção</Chip>                                     // ok | atencao | neutro
 * <CaixaMarcar estado="meio" rotulo="Selecionar todos" onAlternar={fn} desabilitado={false} /> // vazia | marcada | meio (ou boolean)
 * <Segmentado rotulo="Vista" opcoes={[{ valor: "resumo", rotulo: "Resumo" }]} valor="resumo" onMudar={fn} />
 * <Kpis itens={[{ rotulo: "Cabeças", valor: "314", nota: "esperado 75 g", corNota: "#64748b" }]} />
 * <ListaItens titulo="Pasto 07 (314)" marcacao="meio" onMarcarTodos={fn}>
 *   <Item marcado onMarcar={fn} imagem={<IconeCategoria figura="femea-37-mais" tamanho={30} />} cor="#ef4444"
 *     titulo="L-2026-008" meta="38 cb · 38,0 UA · VACA" sub="449,5 kg" chip={<Chip tom="atencao">Atenção</Chip>}
 *     chevron onClick={abrirLote} />
 * </ListaItens>
 * <NavLote titulo="L-2026-008" posicao={1} total={6} onAnterior={fn} onProximo={fn} />
 * <Info linhas={["Marque as colunas que a tabela mostra.", "As colunas ficam agrupadas por seção…"]} />
 * <Busca valor={busca} onMudar={setBusca} placeholder="Filtrar" />
 * <GrupoMarcar titulo="Alertas" itens={[{ chave: "alNivel", rotulo: "Situação", marcado: true }]} onAlternar={fn} onAlternarTodos={fn} />
 * <BotaoFiltro ref={ancora} aria-expanded={aberta} onClick={abrirLista}>Todos os registros</BotaoFiltro>
 * <Nivel figura={<CochoNivel … />} rotulo="Restante do ciclo (estimado)" valor="65%" linhas={["260 kg de 400 kg", "Consumo estimado: 23,4 kg/dia"]} />
 *     (cocho e depósito — D-PROD-220; `figura`: nó pronto ou URL; sem `valor`, só rótulo e linhas)
 * <Acao tom="perigo" onClick={excluir} aria-label="Excluir a leitura de 12/11/2026">Excluir</Acao>   // ação curta dentro de uma Linha/Celula
 * <RodapePilulas itens={[{ rotulo: "Mover lotes", icone: ArrowRightLeft, onClick: fn, desabilitado: !temLote }]} />
 * <RodapeBotoes itens={[{ rotulo: "Redefinir", onClick: fn }, { rotulo: "Aplicar", tom: "verde", onClick: fn }]} />
 */

/** @typedef {import("lucide-react").LucideIcon} IconeLucide */
/** @typedef {"vazia" | "marcada" | "meio"} EstadoCaixa */
/** @typedef {"ok" | "atencao" | "neutro"} TomChip */

/**
 * Junta classes, ignorando vazias.
 * @param {...(string | false | null | undefined)} partes
 * @returns {string}
 */
const cls = (...partes) => partes.filter(Boolean).join(" ");

/**
 * @param {boolean | EstadoCaixa | null | undefined} valor
 * @returns {EstadoCaixa}
 */
function estadoDaCaixa(valor) {
  if (valor === true || valor === "marcada") return "marcada";
  if (valor === "meio") return "meio";
  return "vazia";
}

/** @type {Record<EstadoCaixa, boolean | "mixed">} */
const ARIA_CAIXA = { vazia: false, marcada: true, meio: "mixed" };

/**
 * @param {EstadoCaixa} estado
 * @param {string} [extra]
 */
const classesCaixa = (estado, extra) =>
  cls("mk-dp-cx", estado === "marcada" && "is-on", estado === "meio" && "is-meio", extra);

/**
 * Texto simples de um nó (para rótulos acessíveis montados).
 * @param {React.ReactNode} no
 * @returns {string}
 */
const textoDe = (no) => (typeof no === "string" || typeof no === "number" ? String(no) : "");

/**
 * Imagem de subícone: URL (fundo `contain`, como o v12) ou um nó pronto
 * (ex.: `<IconeCategoria figura tamanho />` de pecas.jsx).
 * @param {{ imagem: React.ReactNode, className: string }} props
 */
function Imagem({ imagem, className }) {
  if (typeof imagem === "string") {
    return <span className={className} style={{ backgroundImage: `url("${imagem}")` }} aria-hidden="true" />;
  }
  return (
    <span className={className} aria-hidden="true">
      {imagem}
    </span>
  );
}

/**
 * Ids da aba e do painel (para `aria-controls` / `aria-labelledby`).
 * @param {string} idBase
 * @param {string} id
 * @returns {{ aba: string, painel: string }}
 */
export function idsDaAba(idBase, id) {
  return { aba: `${idBase}-aba-${id}`, painel: `${idBase}-painel-${id}` };
}

/**
 * @typedef {{ id: string, rotulo: React.ReactNode, badge?: React.ReactNode }} AbaDef
 */

/**
 * Badge da aba: 0 (ex.: `lotes.length` de um pasto vazio), null, "" e false
 * não desenham nada — no v12 o pasto sem lote mostra só "Lotes".
 * @param {React.ReactNode} badge
 * @returns {boolean}
 */
const temBadgeAba = (badge) => badge != null && badge !== "" && badge !== false && badge !== 0;

/**
 * Faixa de abas v12: larguras iguais, traço verde de 3 px na ativa, badge teal
 * opcional (0 = sem badge). Acessível: tablist/tab, `aria-selected`, `aria-controls` (só na
 * ativa: os painéis inativos não existem no DOM), tabindex móvel; ← → Home End
 * mudam de aba (ativação automática). No celular passe "Supl." e sem badge (o
 * CSS também esconde o badge abaixo de 768 px).
 * @param {{ abas: AbaDef[], ativa: string, onMudar: (id: string) => void, idBase?: string, rotulo?: string, className?: string }} props
 */
export function Abas({ abas, ativa, onMudar, idBase, rotulo = "Seções do pasto", className }) {
  const idAuto = React.useId();
  const base = idBase || `mk-dp-${idAuto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const botoes = React.useRef(/** @type {Record<string, HTMLButtonElement | null>} */ ({}));
  const lista = Array.isArray(abas) ? abas : [];
  const temAtiva = lista.some((a) => a.id === ativa);

  /**
   * @param {React.KeyboardEvent<HTMLButtonElement>} e
   * @param {number} i
   */
  const teclar = (e, i) => {
    const n = lista.length;
    if (!n) return;
    let alvo = -1;
    if (e.key === "ArrowRight") alvo = (i + 1) % n;
    else if (e.key === "ArrowLeft") alvo = (i - 1 + n) % n;
    else if (e.key === "Home") alvo = 0;
    else if (e.key === "End") alvo = n - 1;
    if (alvo < 0) return;
    e.preventDefault();
    const proxima = lista[alvo];
    botoes.current[proxima.id]?.focus();
    if (proxima.id !== ativa) onMudar(proxima.id);
  };

  return (
    <div className={cls("mk-dp-abas", className)} role="tablist" aria-label={rotulo}>
      {lista.map((aba, i) => {
        const on = aba.id === ativa;
        const ids = idsDaAba(base, aba.id);
        const temBadge = temBadgeAba(aba.badge);
        return (
          <button
            key={aba.id}
            ref={(el) => {
              botoes.current[aba.id] = el;
            }}
            type="button"
            role="tab"
            id={ids.aba}
            aria-selected={on}
            aria-controls={on ? ids.painel : undefined}
            tabIndex={on || (!temAtiva && i === 0) ? 0 : -1}
            className={cls("mk-dp-aba", on && "is-on")}
            onClick={() => {
              if (!on) onMudar(aba.id);
            }}
            onKeyDown={(e) => teclar(e, i)}
          >
            {aba.rotulo}
            {temBadge ? (
              <>
                {" "}
                <span className="mk-dp-aba__badge">{aba.badge}</span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Cabeçalho próprio (título, sub e ‹ Voltar) para quando o conteúdo roda sem o
 * `LancLoteDialogo` (ex.: testes). Dentro do diálogo quem desenha é o diálogo.
 * @param {{ titulo: React.ReactNode, sub?: React.ReactNode, onVoltar?: (() => void) | null, children?: React.ReactNode, className?: string }} props
 */
export function CabecalhoProprio({ titulo, sub, onVoltar, children, className }) {
  return (
    <div className={cls("mk-dp-cab", className)}>
      {onVoltar ? (
        <button type="button" className="mk-dp-redondo mk-dp-cab__voltar" aria-label="Voltar" title="Voltar" onClick={onVoltar}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
      ) : null}
      <div className="mk-dp-cab__txt">
        <h2 className="mk-dp-cab__titulo">{titulo}</h2>
        {sub ? <p className="mk-dp-cab__sub">{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Título de seção (h3 15/600) com link opcional à direita, alinhados pela base.
 * @param {{ children: React.ReactNode, link?: React.ReactNode, onLink?: () => void, id?: string, className?: string } & Record<string, any>} props
 */
export function TituloBloco({ children, link, onLink, id, className, ...resto }) {
  return (
    <div className={cls("mk-dp-titulo", className)} {...resto}>
      <h3 className="mk-dp-titulo__h" id={id}>
        {children}
      </h3>
      {link ? (
        <button type="button" className="mk-dp-link" onClick={onLink}>
          {link}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Cartão branco (sombra, raio 12). Cabeçalho opcional: ícone lucide 32 px teal
 * OU imagem 36 px (tamanhos da D-PROD-224), título, sub e chip. Os filhos são as partes (`Grade`,
 * `Linha`); as divisórias entre elas vêm do CSS.
 * @param {{ icone?: IconeLucide, imagem?: React.ReactNode, titulo?: React.ReactNode, sub?: React.ReactNode, chip?: React.ReactNode, children?: React.ReactNode, className?: string } & Record<string, any>} props
 */
export function Cartao({ icone: Icone, imagem, titulo, sub, chip, children, className, ...resto }) {
  const temCab = Boolean(titulo || sub || Icone || imagem || chip);
  return (
    <div className={cls("mk-dp-cartao", className)} {...resto}>
      {temCab ? (
        <div className="mk-dp-cartao__cab">
          {imagem ? (
            <Imagem imagem={imagem} className="mk-dp-cartao__img" />
          ) : Icone ? (
            <Icone className="mk-dp-cartao__ic" size={40} aria-hidden="true" />
          ) : null}
          <div className="mk-dp-cartao__txt">
            {titulo ? <strong className="mk-dp-cartao__titulo">{titulo}</strong> : null}
            {sub ? <span className="mk-dp-cartao__sub">{sub}</span> : null}
          </div>
          {chip || null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Grade de células (5 colunas no desktop, 4 no tablet, 2 no celular), com uma
 * linha de 1 px de ponta a ponta entre as fileiras.
 * @param {{ children?: React.ReactNode, className?: string } & Record<string, any>} props
 */
export function Grade({ children, className, ...resto }) {
  return (
    <dl className={cls("mk-dp-grade", className)} {...resto}>
      {children}
    </dl>
  );
}

/**
 * Célula da grade: rótulo, valor (cor e bolinha opcionais), sub e barra 0–100.
 * @param {{ rotulo: React.ReactNode, valor: React.ReactNode, cor?: string | null, bolinha?: string | null, sub?: React.ReactNode, barra?: number | null, corBarra?: string | null, title?: string, className?: string } & Record<string, any>} props
 */
export function Celula({ rotulo, valor, cor, bolinha, sub, barra, corBarra, title, className, ...resto }) {
  const pct = barra == null || !Number.isFinite(Number(barra)) ? null : Math.max(0, Math.min(100, Number(barra)));
  return (
    <div className={cls("mk-dp-cel", className)} title={title} {...resto}>
      <dt className="mk-dp-cel__rot">{rotulo}</dt>
      <dd className="mk-dp-cel__val" style={cor ? { color: cor } : undefined}>
        {bolinha ? <span className="mk-dp-bolinha" style={{ background: bolinha }} aria-hidden="true" /> : null}
        {valor}
      </dd>
      {sub ? <dd className="mk-dp-cel__sub">{sub}</dd> : null}
      {pct != null ? (
        <dd className="mk-dp-cel__barra" aria-hidden="true">
          <span style={{ width: `${pct.toFixed(1)}%`, background: corBarra || "#3fb5c9" }} />
        </dd>
      ) : null}
    </div>
  );
}

/**
 * Linha (dentro de um `Cartao`): ícone 20 px teal ou imagem 26 px (D-PROD-224), rótulo e
 * sub; no fim bolinha, valor à direita e chevron. `quebra`: o valor ocupa o
 * espaço que sobra e quebra em mais linhas. Com `onClick` vira botão.
 * @param {{ icone?: IconeLucide, imagem?: React.ReactNode, rotulo: React.ReactNode, sub?: React.ReactNode, bolinha?: string | null, valor?: React.ReactNode, cor?: string | null, chevron?: boolean, quebra?: boolean, onClick?: () => void, title?: string, className?: string } & Record<string, any>} props
 */
export function Linha({ icone: Icone, imagem, rotulo, sub, bolinha, valor, cor, chevron = false, quebra = false, onClick, title, className, ...resto }) {
  const temValor = valor != null && valor !== "" && valor !== false;
  const conteudo = (
    <>
      {imagem ? (
        <Imagem imagem={imagem} className="mk-dp-linha__img" />
      ) : Icone ? (
        <Icone className="mk-dp-linha__ic" size={22} aria-hidden="true" />
      ) : null}
      <span className="mk-dp-linha__txt">
        <span className="mk-dp-linha__rot">{rotulo}</span>
        {sub ? <span className="mk-dp-linha__sub">{sub}</span> : null}
      </span>
      <span className="mk-dp-linha__fim">
        {bolinha ? <span className="mk-dp-bolinha" style={{ background: bolinha }} aria-hidden="true" /> : null}
        {temValor ? (
          <span className="mk-dp-linha__val" style={cor ? { color: cor } : undefined}>
            {valor}
          </span>
        ) : null}
        {chevron ? <ChevronRight className="mk-dp-chev" size={18} aria-hidden="true" /> : null}
      </span>
    </>
  );
  const classes = cls("mk-dp-linha", quebra && "mk-dp-linha--quebra", onClick && "mk-dp-linha--toque", className);
  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} title={title} {...resto}>
        {conteudo}
      </button>
    );
  }
  return (
    <div className={classes} title={title} {...resto}>
      {conteudo}
    </div>
  );
}

/**
 * Bloco do nível do cocho/depósito (D-PROD-220, `v11-nivel` do v12): figura de
 * 64 px (D-PROD-224) à esquerda; rótulo em caixa alta, valor grande (ex.: "65%") e linhas
 * curtas à direita. `figura`: nó pronto (ex.: `<CochoNivel …/>`) ou URL de
 * imagem. `children` entra depois das linhas (ex.: uma orientação).
 * @param {{ figura?: React.ReactNode, rotulo: React.ReactNode, valor?: React.ReactNode, linhas?: React.ReactNode[], children?: React.ReactNode, className?: string } & Record<string, any>} props
 */
export function Nivel({ figura, rotulo, valor, linhas = [], children, className, ...resto }) {
  const lista = (Array.isArray(linhas) ? linhas : []).filter((l) => l != null && l !== "" && l !== false);
  return (
    <div className={cls("mk-dp-nivel", className)} {...resto}>
      {figura ? <Imagem imagem={figura} className="mk-dp-nivel__fig" /> : null}
      <div className="mk-dp-nivel__txt">
        <span className="mk-dp-nivel__rot">{rotulo}</span>
        {valor != null && valor !== "" ? <strong className="mk-dp-nivel__val">{valor}</strong> : null}
        {lista.map((l, i) => (
          <small key={i} className="mk-dp-nivel__linha">
            {l}
          </small>
        ))}
        {children}
      </div>
    </div>
  );
}

/**
 * Ação curta em texto (ex.: "Excluir" de uma leitura, "Ver tudo"), para usar
 * dentro de uma `Linha`/`Celula` sem virar pílula. `perigo` = vermelho.
 * Repassa as props do `<button>` (aria-label, disabled…).
 * @param {{ tom?: "link" | "perigo", children: React.ReactNode, className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export function Acao({ tom = "link", children, className, type = "button", ...props }) {
  return (
    <button type={type} className={cls("mk-dp-acao", tom === "perigo" && "mk-dp-acao--perigo", className)} {...props}>
      {children}
    </button>
  );
}

/**
 * Aviso com borda: `atencao` (âmbar, triângulo) ou `neutro` (teal, info).
 * @param {{ tom?: "atencao" | "neutro", children: React.ReactNode, className?: string } & Record<string, any>} props
 */
export function Aviso({ tom = "atencao", children, className, ...resto }) {
  const neutro = tom === "neutro";
  const Icone = neutro ? IconeInfo : TriangleAlert;
  return (
    <div className={cls("mk-dp-aviso", neutro ? "mk-dp-aviso--neutro" : "mk-dp-aviso--atencao", className)} {...resto}>
      <Icone className="mk-dp-aviso__ic" size={18} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/**
 * Nota centralizada 12,5 px cinza (fim do corpo).
 * @param {{ children: React.ReactNode, className?: string } & Record<string, any>} props
 */
export function Nota({ children, className, ...resto }) {
  return (
    <p className={cls("mk-dp-nota", className)} {...resto}>
      {children}
    </p>
  );
}

/**
 * Estado vazio: ícone 28 px cinza-claro e texto.
 * @param {{ icone?: IconeLucide, children: React.ReactNode, className?: string } & Record<string, any>} props
 */
export function Vazio({ icone: Icone, children, className, ...resto }) {
  return (
    <div className={cls("mk-dp-vazio", className)} {...resto}>
      {Icone ? <Icone className="mk-dp-vazio__ic" size={34} aria-hidden="true" /> : null}
      <p>{children}</p>
    </div>
  );
}

/**
 * Chip com bolinha: `ok` ("Em dia"), `atencao` ("Atenção") ou `neutro`.
 * @param {{ tom?: TomChip, children: React.ReactNode, className?: string } & Record<string, any>} props
 */
export function Chip({ tom = "neutro", children, className, ...resto }) {
  const t = tom === "ok" || tom === "atencao" ? tom : "neutro";
  return (
    <span className={cls("mk-dp-chip", `mk-dp-chip--${t}`, className)} {...resto}>
      {children}
    </span>
  );
}

/**
 * Caixa de marcar 18 px (`#32D65E` marcada). Botão `role="checkbox"`; o clique
 * não sobe para o item (marca/desmarca sem abrir). `desabilitado` como nos
 * rodapés (`disabled` vale como apelido).
 * @param {{ estado?: boolean | EstadoCaixa | null, rotulo: string, onAlternar?: () => void, desabilitado?: boolean, disabled?: boolean, className?: string }} props
 */
export function CaixaMarcar({ estado, rotulo, onAlternar, desabilitado = false, disabled = false, className }) {
  const e = estadoDaCaixa(estado);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ARIA_CAIXA[e]}
      aria-label={rotulo}
      disabled={Boolean(desabilitado || disabled)}
      className={classesCaixa(e, className)}
      onClick={(ev) => {
        ev.stopPropagation();
        onAlternar?.();
      }}
    />
  );
}

/**
 * Caixa só desenhada, dentro de uma linha que já é o `role="checkbox"`.
 * @param {{ estado: EstadoCaixa }} props
 */
function CaixaDesenho({ estado }) {
  return <span className={classesCaixa(estado)} aria-hidden="true" />;
}

/**
 * @typedef {{ valor: string, rotulo: React.ReactNode }} OpcaoSegmentado
 */

/**
 * Seletor segmentado (fundo cinza, opção ativa branca). `role="group"` + `aria-pressed`.
 * @param {{ opcoes: OpcaoSegmentado[], valor: string, onMudar: (valor: string) => void, rotulo?: string, className?: string }} props
 */
export function Segmentado({ opcoes, valor, onMudar, rotulo, className }) {
  const lista = Array.isArray(opcoes) ? opcoes : [];
  return (
    <div className={cls("mk-dp-seg", className)} role="group" aria-label={rotulo}>
      {lista.map((o) => {
        const on = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            className={cls("mk-dp-seg__op", on && "is-on")}
            aria-pressed={on}
            onClick={() => {
              if (!on) onMudar(o.valor);
            }}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

/**
 * @typedef {{ chave?: string, rotulo: React.ReactNode, valor: React.ReactNode, cor?: string | null, nota?: React.ReactNode, corNota?: string | null }} Kpi
 */

/**
 * Números em N colunas (padrão: um por coluna) com divisórias verticais.
 * @param {{ itens: Kpi[], colunas?: number, className?: string }} props
 */
export function Kpis({ itens, colunas, className }) {
  const lista = Array.isArray(itens) ? itens : [];
  const n = Math.max(1, Number(colunas) || lista.length || 1);
  return (
    <dl className={cls("mk-dp-kpis", className)} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      {lista.map((k, i) => (
        <div key={k.chave ?? i} className="mk-dp-kpi">
          <dt className="mk-dp-kpi__rot">{k.rotulo}</dt>
          <dd className="mk-dp-kpi__val" style={k.cor ? { color: k.cor } : undefined}>
            {k.valor}
          </dd>
          {k.nota ? (
            <dd className="mk-dp-kpi__nota" style={{ color: k.corNota || "#64748b" }}>
              {k.nota}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

/**
 * Lista de itens em cartão. Cabeçalho opcional (fundo `#fafbfb`); com
 * `onMarcarTodos` ganha a `CaixaMarcar` e a faixa inteira marca/desmarca.
 * @param {{ titulo?: React.ReactNode, marcacao?: boolean | EstadoCaixa | null, onMarcarTodos?: () => void, rotuloTodos?: string, rotulo?: string, children?: React.ReactNode, className?: string }} props
 */
export function ListaItens({ titulo, marcacao, onMarcarTodos, rotuloTodos = "Selecionar todos", rotulo, children, className }) {
  const temCab = titulo != null && titulo !== "" && titulo !== false;
  return (
    <div className={cls("mk-dp-itens", className)}>
      {temCab ? (
        <div
          className={cls("mk-dp-itens__cab", onMarcarTodos && "is-toque")}
          onClick={onMarcarTodos ? () => onMarcarTodos() : undefined}
        >
          {onMarcarTodos ? <CaixaMarcar estado={marcacao} rotulo={rotuloTodos} onAlternar={onMarcarTodos} /> : null}
          <span className="mk-dp-itens__titulo">{titulo}</span>
        </div>
      ) : null}
      <ul className="mk-dp-itens__lista" aria-label={rotulo || textoDe(titulo) || undefined}>
        {children}
      </ul>
    </div>
  );
}

/**
 * Item da `ListaItens`: caixa, imagem 30 px ou ícone 24 px (D-PROD-224), quadradinho de cor,
 * título (até 2 linhas), meta, sub, chip, bolinha e chevron. Com `onClick` o
 * item inteiro abre (o corpo vira botão para o teclado); a caixa não abre.
 * @param {{ titulo: React.ReactNode, meta?: React.ReactNode, sub?: React.ReactNode, imagem?: React.ReactNode, icone?: IconeLucide, cor?: string | null, chip?: React.ReactNode, bolinha?: string | null, chevron?: boolean, marcado?: boolean | EstadoCaixa | null, onMarcar?: () => void, rotuloMarcar?: string, onClick?: () => void, title?: string, className?: string }} props
 */
export function Item({
  titulo,
  meta,
  sub,
  imagem,
  icone: Icone,
  cor,
  chip,
  bolinha,
  chevron = false,
  marcado,
  onMarcar,
  rotuloMarcar,
  onClick,
  title,
  className,
}) {
  const toque = typeof onClick === "function";
  const conteudo = (
    <>
      {imagem ? (
        <Imagem imagem={imagem} className="mk-dp-item__img" />
      ) : Icone ? (
        <Icone className="mk-dp-item__ic" size={26} aria-hidden="true" />
      ) : null}
      <span className="mk-dp-item__txt">
        <span className="mk-dp-item__tit">
          {cor ? <span className="mk-dp-quad" style={{ background: cor }} aria-hidden="true" /> : null}
          <span className="mk-dp-item__nome">{titulo}</span>
        </span>
        {meta ? <span className="mk-dp-item__meta">{meta}</span> : null}
        {sub ? <span className="mk-dp-item__sub">{sub}</span> : null}
      </span>
      {chip || null}
      {bolinha ? <span className="mk-dp-bolinha mk-dp-bolinha--g" style={{ background: bolinha }} aria-hidden="true" /> : null}
      {chevron ? <ChevronRight className="mk-dp-chev" size={18} aria-hidden="true" /> : null}
    </>
  );
  const nome = textoDe(titulo);
  return (
    <li className={cls("mk-dp-item", toque && "is-toque", className)} onClick={toque ? () => onClick() : undefined}>
      {onMarcar ? (
        <CaixaMarcar estado={marcado} rotulo={rotuloMarcar || (nome ? `Selecionar ${nome}` : "Selecionar")} onAlternar={onMarcar} />
      ) : null}
      {toque ? (
        // O clique (mouse ou teclado) sobe até o <li>, que chama onClick uma vez só.
        <button type="button" className="mk-dp-item__corpo" title={title}>
          {conteudo}
        </button>
      ) : (
        <span className="mk-dp-item__corpo" title={title}>
          {conteudo}
        </span>
      )}
    </li>
  );
}

/**
 * Navegação entre lotes: ‹ "Lote anterior" · nome + "i de N" · › "Próximo lote".
 * Nas pontas o botão fica desabilitado (opacidade .3).
 * @param {{ titulo: React.ReactNode, posicao: number, total: number, sub?: React.ReactNode, onAnterior?: () => void, onProximo?: () => void, className?: string }} props
 */
export function NavLote({ titulo, posicao, total, sub, onAnterior, onProximo, className }) {
  const semAnterior = !(posicao > 1);
  const semProximo = !(posicao < total);
  return (
    <div className={cls("mk-dp-nav", className)}>
      <button type="button" className="mk-dp-redondo" aria-label="Lote anterior" title="Lote anterior" disabled={semAnterior} onClick={onAnterior}>
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <div className="mk-dp-nav__meio" aria-live="polite">
        <strong className="mk-dp-nav__titulo">{titulo}</strong>
        <span className="mk-dp-nav__sub">{sub ?? `${posicao} de ${total}`}</span>
      </div>
      <button type="button" className="mk-dp-redondo" aria-label="Próximo lote" title="Próximo lote" disabled={semProximo} onClick={onProximo}>
        <ChevronRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Explicação com faixa teal à esquerda (ícone info) e um parágrafo por linha.
 * @param {{ linhas?: React.ReactNode[], children?: React.ReactNode, className?: string }} props
 */
export function Info({ linhas, children, className }) {
  const lista = Array.isArray(linhas) ? linhas : children != null ? [children] : [];
  return (
    <div className={cls("mk-dp-info", className)}>
      <span className="mk-dp-info__faixa" aria-hidden="true">
        <IconeInfo size={18} />
      </span>
      <div className="mk-dp-info__txt">
        {lista.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
    </div>
  );
}

/**
 * Busca com lupa (14 px no desktop; 16 px abaixo de 1024 px, sem zoom no iOS).
 * @param {{ valor: string, onMudar: (valor: string) => void, placeholder?: string, rotulo?: string, className?: string }} props
 */
export function Busca({ valor, onMudar, placeholder = "Filtrar", rotulo, className }) {
  return (
    <label className={cls("mk-dp-busca", className)}>
      <Search size={18} aria-hidden="true" />
      <input
        type="search"
        className="mk-dp-busca__in"
        value={valor ?? ""}
        placeholder={placeholder}
        aria-label={rotulo || placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onMudar(e.target.value)}
      />
    </label>
  );
}

/**
 * @typedef {{ chave: string, rotulo: React.ReactNode, marcado: boolean }} ItemMarcar
 */

/**
 * Grupo de marcar (Configurar tabela): cabeçalho cinza em MAIÚSCULAS com caixa
 * (marcada / meio / vazia) e contador n/N; cada item é uma linha inteira de
 * marcar. Linhas e cabeçalho são `role="checkbox"`.
 * @param {{ titulo: React.ReactNode, itens: ItemMarcar[], onAlternar: (chave: string) => void, onAlternarTodos?: () => void, className?: string }} props
 */
export function GrupoMarcar({ titulo, itens, onAlternar, onAlternarTodos, className }) {
  const lista = Array.isArray(itens) ? itens : [];
  const marcados = lista.filter((i) => i.marcado).length;
  /** @type {EstadoCaixa} */
  const estado = lista.length > 0 && marcados === lista.length ? "marcada" : marcados > 0 ? "meio" : "vazia";
  const cabecalho = (
    <>
      <CaixaDesenho estado={estado} />
      <span className="mk-dp-grupo__titulo">{titulo}</span>
      <span className="mk-dp-grupo__n">
        {marcados}/{lista.length}
      </span>
    </>
  );
  return (
    <div className={cls("mk-dp-grupo", className)} role="group" aria-label={textoDe(titulo) || undefined}>
      {onAlternarTodos ? (
        <button type="button" role="checkbox" aria-checked={ARIA_CAIXA[estado]} className="mk-dp-grupo__cab" onClick={onAlternarTodos}>
          {cabecalho}
        </button>
      ) : (
        <div className="mk-dp-grupo__cab">{cabecalho}</div>
      )}
      {lista.map((it) => (
        <button
          key={it.chave}
          type="button"
          role="checkbox"
          aria-checked={Boolean(it.marcado)}
          className="mk-dp-grupo__item"
          onClick={() => onAlternar(it.chave)}
        >
          <CaixaDesenho estado={it.marcado ? "marcada" : "vazia"} />
          <span>{it.rotulo}</span>
        </button>
      ))}
    </div>
  );
}

/** @typedef {React.ComponentPropsWithoutRef<"button">} BotaoFiltroProps */

/** @type {React.ForwardRefRenderFunction<HTMLButtonElement, BotaoFiltroProps>} */
const BotaoFiltroRender = ({ children, className, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cls("mk-dp-filtro", className)} {...props}>
    <span>{children}</span>
    <ChevronDown size={16} aria-hidden="true" />
  </button>
);

/**
 * Botão de filtro (42 px): texto + chevron para baixo. Aceita `ref` (âncora da
 * lista de escolha) e repassa as props do `<button>`.
 */
export const BotaoFiltro = React.forwardRef(BotaoFiltroRender);
BotaoFiltro.displayName = "BotaoFiltro";

/**
 * @typedef {{ chave?: string, rotulo: string, icone?: IconeLucide, onClick?: () => void, desabilitado?: boolean, title?: string }} Pilula
 */

/**
 * Rodapé de pílulas (36 px; 40 px no celular e na tela de toque; até 220 px, ícone 16 px). Desabilitada: `.is-off` + `disabled`.
 * @param {{ itens: Pilula[], rotulo?: string, className?: string }} props
 */
export function RodapePilulas({ itens, rotulo = "Ações", className }) {
  const lista = Array.isArray(itens) ? itens : [];
  return (
    <div className={cls("mk-dp-rodape", "mk-dp-rodape--pilulas", className)} role="group" aria-label={rotulo}>
      {lista.map((p, i) => {
        const Icone = p.icone;
        const off = Boolean(p.desabilitado);
        return (
          <button
            key={p.chave ?? p.rotulo ?? i}
            type="button"
            className={cls("mk-dp-pilula", off && "is-off")}
            disabled={off}
            title={p.title}
            onClick={off ? undefined : p.onClick}
          >
            {Icone ? <Icone size={16} aria-hidden="true" /> : null}
            <span>{p.rotulo}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * @typedef {{ chave?: string, rotulo: string, onClick?: () => void, tom?: "branco" | "verde", desabilitado?: boolean }} BotaoRodape
 */

/**
 * Rodapé de botões (40 px, pílulas): `branco` (ex.: Redefinir) e `verde` `#3fbf5f` (ex.: Aplicar).
 * @param {{ itens: BotaoRodape[], className?: string }} props
 */
export function RodapeBotoes({ itens, className }) {
  const lista = Array.isArray(itens) ? itens : [];
  return (
    <div className={cls("mk-dp-rodape", "mk-dp-rodape--botoes", className)}>
      {lista.map((b, i) => (
        <button
          key={b.chave ?? b.rotulo ?? i}
          type="button"
          className={cls("mk-dp-botao", b.tom === "verde" ? "mk-dp-botao--verde" : "mk-dp-botao--branco")}
          disabled={Boolean(b.desabilitado)}
          onClick={b.onClick}
        >
          {b.rotulo}
        </button>
      ))}
    </div>
  );
}
