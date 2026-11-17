import React from "react";
import { Check, History } from "lucide-react";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";
import PainelSelecao from "@/components/common/PainelSelecao";
import { LIMITE_CACHE_MOVIMENTACOES } from "@/components/lotes/usePaginasDoHistorico";
import { usePasto } from "./pastoContexto";
import { Aviso, BotaoFiltro, Nota, Vazio } from "./blocos";
import LinhaDoTempo from "./LinhaDoTempo";
import { FILTROS_DO_HISTORICO, FILTRO_PADRAO, filtroValido, rotuloDoFiltro } from "./historicoDoPasto";
import { useHistoricoDoPasto } from "./useHistoricoDoPasto";
import "@/styles/mk-dp-historico.css";

/*
 * Aba Histórico do pasto (Detalhes do Lote v12, D-PROD-218 — número definitivo
 * no PR): filtro "Mostrar" + linha do tempo da área (movimentações do servidor,
 * em ordem H2 por ocorrência — D-PROD-123 —, e lançamentos de suplementação da
 * área), com "Carregar mais" e o aviso offline do histórico de hoje. Só
 * leitura: excluir uma movimentação continua no "Histórico de Movimentação"
 * (Manejos e históricos, D-PROD-110). Tudo vem de `usePasto()`; a casca só
 * monta esta aba quando ela está ativa, e só então a consulta existe.
 *
 * A lista do "Mostrar" é a que o sistema já usa (como o B1Select): o painel
 * preso ao botão no desktop/tablet e a folha de baixo no celular — dentro do
 * diálogo do Detalhes pelo MobileSheetPortalCtx (D-PROD-116). Sem restilo.
 */

/** Filtro "Mostrar": global na sessão (vale para todos os pastos; volta ao padrão ao recarregar a página). */
let filtroDaSessao = FILTRO_PADRAO;

const NOTA = "Registros de todas as movimentações, pesagens e manejos que passaram por este pasto.";
const VAZIO_DO_FILTRO = "Nenhum registro deste tipo neste pasto.";
// Histórico da Área (clique no contorno, D-PROD-220): a área pode ser reserva, curral…
const NOTA_DA_AREA = "Registros de todas as movimentações, pesagens e manejos que passaram por esta área.";
const VAZIO_DA_AREA = "Nenhum registro deste tipo nesta área.";
const SEM_COPIA_NO_APARELHO = "Este aparelho ainda não tem movimentações salvas para consulta sem conexão.";

/** @param {string | null} iso */
const formatarDataHora = (iso) => {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/**
 * Mesmo aviso do histórico de hoje (D-PROD-123): cópia parcial do aparelho.
 * @param {{ aviso: import("./useHistoricoDoPasto").AvisoOffline }} props
 */
function AvisoOffline({ aviso }) {
  const n = aviso.quantidade;
  const quando = formatarDataHora(aviso.atualizadoEm);
  return (
    <div role="status" className="mk-dp-hist__aviso">
      <Aviso tom="atencao">
        {aviso.falha ? `Não foi possível consultar o servidor (${aviso.falha}). ` : "Sem conexão. "}
        <strong>Histórico offline parcial</strong>: {n} movimentaç{n === 1 ? "ão salva" : "ões salvas"} neste aparelho
        {quando ? `, atualizado em ${quando}` : ", sem data de atualização"}; cópia parcial ordenada pelas datas disponíveis no
        aparelho (data da ocorrência gravada e hora de cadastro), que pode diferir da ordem do servidor; podem estar desatualizadas
        {aviso.limiteAtingido ? ` e limitadas às ${LIMITE_CACHE_MOVIMENTACOES} mais recentes da conta` : ""}. A lista será atualizada
        quando a conexão voltar.
      </Aviso>
    </div>
  );
}

export default function AbaHistorico() {
  const { dados } = usePasto();
  const daArea = dados?.tipoLocal === "area";
  const celular = useCelular();
  const [filtro, setFiltro] = React.useState(() => filtroValido(filtroDaSessao));
  const [aberta, setAberta] = React.useState(false);
  const botao = React.useRef(/** @type {HTMLButtonElement | null} */ (null));
  const controle = React.useRef(/** @type {null | { tecla: (e: React.KeyboardEvent) => void }} */ (null));
  const ancora = React.useCallback(() => botao.current, []);

  const h = useHistoricoDoPasto({
    empresaId: dados?.empresaId,
    areaId: dados?.areaId,
    areaNome: dados?.areaNome,
    eventos: dados?.suplementacao?.eventos ?? null,
    filtro,
  });

  /** @param {string} valor */
  const escolher = (valor) => {
    const v = filtroValido(valor);
    filtroDaSessao = v;
    setFiltro(v);
    setAberta(false);
  };

  // Celular: Esc com a folha aberta fecha só a folha (a folha se fecha sozinha);
  // marcado aqui, antes do diálogo do Detalhes ver a tecla, ele não fecha junto.
  React.useEffect(() => {
    if (!aberta || !celular) return undefined;
    /** @param {KeyboardEvent} e */
    const segurar = (e) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", segurar, true);
    return () => window.removeEventListener("keydown", segurar, true);
  }, [aberta, celular]);

  // Folha fechada: o foco volta ao botão (no desktop o painel já devolve).
  const estavaAberta = React.useRef(false);
  React.useEffect(() => {
    if (celular && estavaAberta.current && !aberta) botao.current?.focus({ preventScroll: true });
    estavaAberta.current = aberta;
  }, [aberta, celular]);

  const rotulo = rotuloDoFiltro(filtro);
  const gatilho = (
    <BotaoFiltro
      ref={botao}
      aria-haspopup="listbox"
      aria-expanded={aberta}
      aria-label={`Mostrar: ${rotulo}`}
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
      {rotulo}
    </BotaoFiltro>
  );

  const semCopiaNoAparelho = Boolean(h.offline && !h.offline.atualizadoEm && filtro !== "sup");
  let conteudo;
  if (h.carregando) {
    conteudo = (
      <div role="status" className="mk-dp-hist__estado">
        Carregando histórico...
      </div>
    );
  } else if (h.erro) {
    conteudo = (
      <div role="alert" className="mk-dp-hist__estado">
        <p>Não foi possível carregar o histórico.</p>
        <p className="mk-dp-hist__detalhe">{getApiErrorMessage(h.erro, "Tente novamente em instantes.")}</p>
        <button type="button" className="mk-dp-hist__botao" onClick={h.tentarDeNovo}>
          Tentar novamente
        </button>
      </div>
    );
  } else if (h.dias.length) {
    conteudo = <LinhaDoTempo dias={h.dias} />;
  } else {
    conteudo = <Vazio icone={History}>{semCopiaNoAparelho ? SEM_COPIA_NO_APARELHO : daArea ? VAZIO_DA_AREA : VAZIO_DO_FILTRO}</Vazio>;
  }

  // "Carregar mais" só pede movimentações: com "Suplementação" (tudo do aparelho) não aparece.
  const mostrarMais = !h.carregando && !h.erro && h.haMaisPaginas && filtro !== "sup";

  return (
    <div className="mk-dp-hist">
      <div className="mk-dp-botoes">
        {celular ? (
          gatilho
        ) : (
          <PainelSelecao
            open={aberta}
            onOpenChange={setAberta}
            ancora={ancora}
            itens={FILTROS_DO_HISTORICO.map((f) => ({ value: f.valor, label: f.rotulo, texto: f.rotulo }))}
            valor={filtro}
            onEscolher={escolher}
            pesquisavel={false}
            rotulo="Mostrar"
            controleRef={controle}
          >
            {gatilho}
          </PainelSelecao>
        )}
      </div>
      {h.offline ? <AvisoOffline aviso={h.offline} /> : null}
      {conteudo}
      {mostrarMais ? (
        <div className="mk-dp-hist__mais">
          <button type="button" className="mk-dp-hist__botao" disabled={h.carregandoMais} onClick={h.carregarMais}>
            {h.carregandoMais ? "Carregando..." : "Carregar mais"}
          </button>
          <p className="mk-dp-hist__contagem">
            {h.total !== null ? `Movimentações: ${h.carregadas} de ${h.total}` : `Movimentações: ${h.carregadas}`}
            {h.adiados > 0
              ? ` · ${h.adiados} registro${h.adiados === 1 ? "" : "s"} mais antigo${h.adiados === 1 ? "" : "s"} aparece${h.adiados === 1 ? "" : "m"} ao carregar mais`
              : ""}
          </p>
          {h.erroAoCarregarMais ? (
            <p role="alert" className="mk-dp-hist__erro">
              Não foi possível carregar a próxima página. {getApiErrorMessage(h.erroAoCarregarMais, "")}
            </p>
          ) : null}
        </div>
      ) : null}
      <Nota>{daArea ? NOTA_DA_AREA : NOTA}</Nota>
      {celular && aberta ? (
        <MobileSheet open onClose={() => setAberta(false)} label="Mostrar" title="Mostrar">
          <div className="mgs__lista" role="listbox" aria-label="Mostrar">
            {FILTROS_DO_HISTORICO.map((f) => {
              const on = f.valor === filtro;
              return (
                <button
                  key={f.valor}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`mgs__op${on ? " is-on" : ""}`}
                  onClick={() => escolher(f.valor)}
                >
                  <span className="mgs__label">{f.rotulo}</span>
                  {on ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </MobileSheet>
      ) : null}
    </div>
  );
}
