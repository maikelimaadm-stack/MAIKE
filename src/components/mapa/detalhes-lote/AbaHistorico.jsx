import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, History } from "lucide-react";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";
import PainelSelecao from "@/components/common/PainelSelecao";
import { LIMITE_CACHE_MOVIMENTACOES } from "@/components/lotes/usePaginasDoHistorico";
import ExcluirMovimentacao from "@/components/lotes/ExcluirMovimentacao";
import CancelarLancamentoCocho, { usePermissaoCancelarCocho } from "@/components/suplementacao/CancelarLancamentoCocho";
import { invalidarCachesDoMapa } from "@/components/mapa/invalidarCachesMapa";
import { tipoTemExclusao } from "@/domain/lotes/situacaoMovimento";
import { usePasto } from "./pastoContexto";
import { Aviso, BotaoFiltro, Nota, Vazio } from "./blocos";
import LinhaDoTempo from "./LinhaDoTempo";
import { FILTROS_DO_HISTORICO, FILTRO_PADRAO, filtroValido, rotuloDoFiltro } from "./historicoDoPasto";
import { useHistoricoDoPasto } from "./useHistoricoDoPasto";
import "@/styles/mk-dp-historico.css";
import "@/styles/mk-dp-tl-acoes.css";

/*
 * Aba Histórico do pasto (Detalhes do Lote v12, D-PROD-218 — número definitivo
 * no PR): filtro "Mostrar" + linha do tempo da área (movimentações do servidor,
 * em ordem H2 por ocorrência — D-PROD-123 —, e lançamentos de suplementação da
 * área), com "Carregar mais" e o aviso offline do histórico de hoje. Tudo
 * vem de `usePasto()`; a casca só monta esta aba quando ela está ativa, e só
 * então a consulta existe.
 *
 * Excluir (D-PROD-266, etapa 1): o MESMO "Excluir movimentação" do Histórico de
 * Movimentação (D-PROD-110, `ExcluirMovimentacao`: elegibilidade conferida no
 * servidor, motivo, confirmação, só online, nunca na fila offline) no pé do
 * cartão, com as mesmas condições dele: dados do servidor (nunca a cópia do
 * aparelho), movimento não cancelado e de tipo com exclusão. Um movimento vira
 * vários cartões (um por lote) e a exclusão apaga o registro INTEIRO: a ação
 * fica só no primeiro cartão do movimento, com o aviso do alcance. Quem vê a
 * ação decide o próprio `ExcluirMovimentacao`. Ao excluir, histórico e mapa relêem.
 *
 * Cancelar lançamento (D-PROD-267, etapa 2): o cartão de suplementação MAIS RECENTE de cada
 * cocho ganha "Cancelar lançamento" no pé (`CancelarLancamentoCocho`: comando do servidor, só
 * com a permissão `cancelar_lancamentos_estoque`, motivo obrigatório, só online, elegibilidade
 * antes de habilitar). Só o mais recente é dica: quem decide é o servidor. Cancelado, o cartão
 * some (o lançamento sai dos históricos do cocho, do pasto e do lote).
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

/**
 * Quantos OUTROS pastos o movimento toca além deste (origem/destino do registro
 * e das linhas). Sem ids gravados, 0: o aviso não afirma o que não sabe.
 * @param {any} mov @param {string | null | undefined} areaId
 */
export function outrosPastosDoMovimento(mov, areaId) {
  const ids = new Set();
  const somar = (/** @type {any} */ v) => {
    if (typeof v === "string" && v && v !== areaId) ids.add(v);
  };
  somar(mov?.area_origem_id);
  somar(mov?.area_destino_id);
  for (const l of Array.isArray(mov?.linhas) ? mov.linhas : []) {
    somar(l?.area_origem_id);
    somar(l?.area_destino_id);
  }
  return ids.size;
}

/**
 * Aviso do alcance, ao lado do botão: a exclusão apaga o registro inteiro. Só
 * cita outro pasto quando o registro de fato envolve outro pasto.
 * @param {number} cartoes quantos cartões deste movimento a aba mostra
 * @param {number} [outrosPastos] quantos outros pastos o registro toca
 */
export const textoDoAlcance = (cartoes, outrosPastos = 0) => {
  const base =
    cartoes > 1
      ? `Exclui o registro inteiro: os ${cartoes} cartões deste registro saem juntos, com todos os lotes dele.`
      : "Exclui o registro inteiro, com todos os lotes dele, não só este cartão.";
  if (outrosPastos <= 0) return base;
  return `${base} ${outrosPastos === 1 ? "Desfaz também o que ele mudou no outro pasto do registro." : "Desfaz também o que ele mudou nos outros pastos do registro."}`;
};

/**
 * Põe "Excluir movimentação" no pé do PRIMEIRO cartão de cada movimento que
 * pode ser excluído (mesmas condições do Histórico de Movimentação: servidor,
 * não cancelado, `tipoTemExclusao`). Os outros cartões ficam como estão.
 * @param {import("./historicoDoPasto").DiaHistorico[]} dias
 * @param {{ doServidor: boolean, areaId?: string | null, aoExcluir?: () => void }} opcoes
 * @returns {import("./historicoDoPasto").DiaHistorico[]}
 */
export function comAcaoDeExcluir(dias, { doServidor, areaId = null, aoExcluir }) {
  if (!doServidor) return dias;
  /** @type {Map<string, number>} */
  const porMovimento = new Map();
  for (const dia of dias) {
    for (const c of dia.cartoes) {
      const id = c.mov?.id;
      if (id) porMovimento.set(id, (porMovimento.get(id) ?? 0) + 1);
    }
  }
  const vistos = new Set();
  return dias.map((dia) => ({
    ...dia,
    cartoes: dia.cartoes.map((c) => {
      const mov = c.mov;
      if (!mov?.id || vistos.has(mov.id)) return c;
      vistos.add(mov.id);
      if (c.cancelado || !tipoTemExclusao(mov)) return c;
      const alcance = textoDoAlcance(porMovimento.get(mov.id) ?? 1, outrosPastosDoMovimento(mov, areaId));
      return { ...c, acoes: <AcaoExcluir key={mov.id} movimento={mov} alcance={alcance} aoExcluir={aoExcluir} /> };
    }),
  }));
}

/**
 * O botão do `ExcluirMovimentacao` e, só quando ele aparece, o aviso do
 * alcance. Quem vê o botão (permissão, já excluído) é decisão do componente,
 * que então não desenha nada: o aviso some junto e a caixa fica vazia (0 px:
 * o CSS não dá recuo nem divisória a caixa vazia). O observador acompanha o
 * componente aparecer/sumir. Leitor de tela: com o botão, a caixa vira um
 * grupo nomeado pelo aviso — ao focar o botão ouve-se que o registro inteiro
 * sai (o diálogo é do `ExcluirMovimentacao`, sem mudar a API dele).
 * @param {{ movimento: any, alcance: string, aoExcluir?: () => void }} props
 */
function AcaoExcluir({ movimento, alcance, aoExcluir }) {
  const caixa = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const idAlcance = React.useId();
  const [comBotao, setComBotao] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return undefined;
    const conferir = () => setComBotao(Array.from(el.children).some((filho) => !filho.classList.contains("mk-dp-hist__alcance")));
    conferir();
    if (typeof MutationObserver === "undefined") return undefined;
    const observador = new MutationObserver(conferir);
    observador.observe(el, { childList: true });
    return () => observador.disconnect();
  }, []);
  return (
    <div ref={caixa} className="mk-dp-hist__excluir" {...(comBotao ? { role: "group", "aria-labelledby": idAlcance } : {})}>
      <ExcluirMovimentacao movimento={movimento} onExcluido={aoExcluir} />
      {comBotao ? (
        <p id={idAlcance} className="mk-dp-hist__alcance">
          {alcance}
        </p>
      ) : null}
    </div>
  );
}

/**
 * D-PROD-267 — "Cancelar lançamento" no pé do cartão de suplementação mais recente de cada cocho
 * (os cartões chegam do mais novo para o mais antigo). Os outros ficam como estão.
 * @param {import("./historicoDoPasto").DiaHistorico[]} dias
 * @param {{ aoCancelar?: () => void, doServidor?: boolean, autorizado?: boolean }} [opcoes]
 * @returns {import("./historicoDoPasto").DiaHistorico[]}
 */
export function comAcaoDeCancelarCocho(dias, { aoCancelar, doServidor = true, autorizado = true } = {}) {
  // Cópia do aparelho (offline): só leitura, como o "Excluir movimentação". Sem a permissão: sem pé.
  if (!doServidor || !autorizado) return dias;
  const vistos = new Set();
  return dias.map((dia) => ({
    ...dia,
    cartoes: dia.cartoes.map((c) => {
      const ev = c.evento;
      // Lançamento sem cocho (legado) nunca é cancelável (o servidor recusa `sem_recibo`): sem pé
      // e sem ensaio no servidor para cada cartão antigo.
      if (!ev?.id || !ev.ponto_suplementacao_id || c.acoes) return c;
      const cocho = ev.ponto_suplementacao_id;
      if (vistos.has(cocho)) return c;
      vistos.add(cocho);
      return { ...c, acoes: <CancelarLancamentoCocho key={ev.id} evento={ev} onCancelado={aoCancelar} /> };
    }),
  }));
}

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
  const queryClient = useQueryClient();
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
    areas: dados?.areas ?? null,
    eventos: dados?.suplementacao?.eventos ?? null,
    filtro,
  });

  // O ExcluirMovimentacao já relê o rebanho (mapa e consultas); aqui garante a
  // releitura do histórico desta aba e da elegibilidade dos outros cartões.
  const aoExcluir = React.useCallback(() => {
    invalidarCachesDoMapa(queryClient, ["historico-movimentacoes", "elegibilidade-exclusao-movimentacao"]);
  }, [queryClient]);
  const { autorizado: podeCancelarCocho } = usePermissaoCancelarCocho();
  const dias = React.useMemo(
    () => comAcaoDeCancelarCocho(comAcaoDeExcluir(h.dias, { doServidor: h.origem === "servidor", areaId: dados?.areaId ?? null, aoExcluir }), { aoCancelar: aoExcluir, doServidor: h.origem === "servidor", autorizado: podeCancelarCocho }),
    [h.dias, h.origem, dados?.areaId, aoExcluir, podeCancelarCocho],
  );

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
  } else if (dias.length) {
    conteudo = <LinhaDoTempo textoAutomatico dias={dias} rotulo={daArea ? "Registros da área" : undefined} />;
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
