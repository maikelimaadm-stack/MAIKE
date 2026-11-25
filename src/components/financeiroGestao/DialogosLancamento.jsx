import React, { useRef, useState } from "react";
import { AlertTriangle, Ban, Loader2 } from "lucide-react";
import * as UiDialog from "@/components/ui/dialog";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { useCelular } from "@/components/common/MobileSheet";
import { EscolhaSegmentada } from "@/components/financeiroGestao/CamposLancamento";
import RateioItensLancamento, { nomesDasClassificacoes } from "@/components/financeiroGestao/RateioItensLancamento";

// Os componentes de `ui/dialog` são forwardRef sem tipos: aqui valem como `any`.
const Dialog = /** @type {any} */ (UiDialog.Dialog);
const DialogContent = /** @type {any} */ (UiDialog.DialogContent);
const DialogDescription = /** @type {any} */ (UiDialog.DialogDescription);
const DialogFooter = /** @type {any} */ (UiDialog.DialogFooter);
const DialogHeader = /** @type {any} */ (UiDialog.DialogHeader);
const DialogTitle = /** @type {any} */ (UiDialog.DialogTitle);
import { LIMITES, comparar, ehPositivo, formatarMoeda, lerNumeroLocal, naEscala, paraTextoDeEdicao, somar } from "@/lib/dinheiroDecimal";
import { ehDiaValido, formatarDia } from "@/lib/diaCivil";
import { lerErroGestao, mensagemDoAvisoDoPlano, mensagemDoBloqueio, mensagemDoMotivo, mensagemErroGestao, motivosDoErro } from "@/lib/gestaoErros";
import { CODIGO_ENVIO_PENDENTE, ROTULO_METODO, ehRecusaDefinitiva, ehResultadoIncerto } from "@/services/operacaoFinanceiraService";
import { mensagemNumero } from "@/components/financeiroGestao/lancamentoModelo";
import LotesDaConfirmacao from "@/components/financeiroGestao/LotesDaConfirmacao";
import { lotesDaConfirmacao } from "@/lib/estoqueLotesRegras";

const CTL = "h-10 w-full min-w-0 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white px-3 text-[14px] outline-none focus:border-emerald-500";
const BOTAO_PRIMARIO =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-4 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60";
const BOTAO_PERIGO =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-red-600 px-4 text-[13px] font-semibold text-white hover:bg-red-700 disabled:opacity-60";
const BOTAO_SECUNDARIO =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-4 text-[13px] font-medium hover:bg-slate-50 disabled:opacity-60";

/**
 * Formas permitidas pelo perfil como escolha em botões (sem lista suspensa:
 * painel/folha por cima de diálogo modal não recebe toque no celular).
 * @param {string[]} metodos
 */
const opcoesDeMetodo = (metodos) => metodos.map((m) => ({ value: m, label: ROTULO_METODO[/** @type {keyof typeof ROTULO_METODO} */ (m)] ?? m }));

/**
 * Estado do envio de um comando: "incerto" = sem resposta (rede/prazo/5xx) —
 * NUNCA vira "sucesso"; o usuário consulta o documento ou repete o MESMO envio.
 * `motivos` (D-PROD-158): recusa de correção/exclusão com a lista legível.
 * @typedef {{ fase: 'pronto'|'enviando'|'incerto'|'erro', mensagem?: string, motivos?: string[], tituloMotivos?: string }} EstadoEnvio
 */

/**
 * Executa o envio uma vez por vez (duplo clique = 1 envio). O 2º argumento de
 * `enviar` diz se este clique é a RETENTATIVA do envio que ficou sem resposta
 * definitiva NESTE diálogo ("Repetir o mesmo envio"): só ela reaproveita a
 * chave pendente sem perguntar (§8.7). Diálogo novo = envio novo.
 * @param {(arg: any, opcoes: { retentativa: boolean }) => Promise<unknown>} enviar
 * @param {{ locale: string, moeda: string, casas: number }} c
 * @param {(r: unknown) => void} [aoConcluir]
 * @param {((erro: unknown) => string) | null} [mensagemDoErro] a frase da recusa definitiva no lugar de
 *   `mensagemErroGestao` (o vocabulário da tela que abriu o diálogo). Sem ela, a frase de sempre.
 */
function useEnvioUnico(enviar, c, aoConcluir, mensagemDoErro = null) {
  const [estado, setEstado] = useState(/** @type {EstadoEnvio} */ ({ fase: "pronto" }));
  const emCurso = useRef(false);
  // O último clique deixou a pendência guardada (sem resposta, resposta não
  // definitiva do servidor ou "Manter"): o próximo clique repete aquele envio.
  const repetir = useRef(false);
  const disparar = async (/** @type {any} */ arg) => {
    if (emCurso.current) return;
    emCurso.current = true;
    setEstado({ fase: "enviando" });
    try {
      const r = await enviar(arg, { retentativa: repetir.current });
      repetir.current = false;
      setEstado({ fase: "pronto" });
      aoConcluir?.(r);
    } catch (erro) {
      // "Manter" o envio anterior sem resposta: nada saiu agora e aquele envio
      // continua incerto — o diálogo fica como estava, com o "Consultar".
      const manteve = /** @type {any} */ (erro)?.code === CODIGO_ENVIO_PENDENTE;
      repetir.current = manteve || !ehRecusaDefinitiva(erro);
      if (manteve || ehResultadoIncerto(erro)) setEstado({ fase: "incerto" });
      else {
        const motivos = motivosDoErro(erro).map((m) => mensagemDoMotivo(m, c));
        const { code } = lerErroGestao(erro);
        const tituloMotivos =
          code === "OPERACAO_RETIFICACAO_BLOQUEADA"
            ? "A correção foi recusada pelo servidor:"
            : code === "OPERACAO_EXCLUSAO_BLOQUEADA"
              ? "A exclusão foi recusada pelo servidor:"
              : "O servidor recusou:";
        const mensagem = mensagemDoErro
          ? mensagemDoErro(erro)
          : mensagemErroGestao(erro, "Não foi possível concluir. Nada foi gravado.", { ...c, comandoIdempotente: true });
        setEstado({ fase: "erro", mensagem, motivos, tituloMotivos });
      }
    } finally {
      emCurso.current = false;
    }
  };
  return { estado, disparar, setEstado };
}

/** @param {{ estado: EstadoEnvio, onConsultar?: (() => void) | null }} props */
function AvisoDoEnvio({ estado, onConsultar = null }) {
  if (estado.fase === "incerto") {
    return (
      <div role="alert" data-testid="resultado-incerto" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
        <p className="flex items-center gap-1.5 font-semibold">
          <AlertTriangle size={16} aria-hidden /> Resultado incerto — consulte antes de repetir
        </p>
        <p className="mt-1">
          Não recebemos a resposta do servidor: a ação PODE ter sido gravada. Consulte o lançamento. Se repetir, o MESMO envio é reaproveitado e não é
          duplicado.
        </p>
        {onConsultar ? (
          <button type="button" className={`${BOTAO_SECUNDARIO} mt-2`} onClick={onConsultar} data-testid="botao-consultar-resultado">
            Consultar lançamento
          </button>
        ) : null}
      </div>
    );
  }
  if (estado.fase === "erro") {
    // Recusa com motivos (D-PROD-158): cada vínculo que impede numa linha própria.
    if (estado.motivos?.length) {
      return (
        <div role="alert" data-testid="erro-envio" className="min-w-0 rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
          <p className="break-words font-semibold">{estado.tituloMotivos}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {estado.motivos.map((m, k) => (
              <li key={k} className="break-words">
                {m}
              </li>
            ))}
          </ul>
          <p className="mt-1">Nada foi alterado.</p>
        </div>
      );
    }
    return (
      <p role="alert" data-testid="erro-envio" className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
        {estado.mensagem}
      </p>
    );
  }
  return null;
}

/**
 * Diálogo da PRÉVIA + confirmação (§7.6): "Isto criará N parcelas, movimentará X
 * itens no estoque e registrará <total> em títulos", bloqueios do servidor e,
 * no à vista, a baixa no ato (só com a permissão `liquidar`).
 * @param {{
 *   aberto: boolean,
 *   registro: any,
 *   previa: { plano: any, bloqueios: any[] } | null,
 *   perfil: { locale: string, moeda: string, moeda_casas: number, metodos_permitidos: string[] },
 *   hoje: string,
 *   fusoConfigurado: boolean,
 *   podeLiquidar: boolean,
 *   onFechar: () => void,
 *   onConfirmar: (p: { baixa_no_ato: { metodo: string, data: string, referencia?: string } | null, lotes_por_item?: Array<Record<string, unknown>> }, opcoes: { retentativa: boolean }) => Promise<unknown>,
 *   onConsultar: () => void,
 * }} props
 */
export function DialogoConfirmacao({ aberto, registro, previa, perfil, hoje, fusoConfigurado, podeLiquidar, onFechar, onConfirmar, onConsultar }) {
  const c = { locale: perfil.locale, moeda: registro?.moeda || perfil.moeda, casas: Number.isInteger(registro?.moeda_casas) ? registro.moeda_casas : perfil.moeda_casas };
  const { estado, disparar } = useEnvioUnico(onConfirmar, c);
  const [baixa, setBaixa] = useState(false);
  const metodos = perfil.metodos_permitidos ?? [];
  const [metodo, setMetodo] = useState(() => (metodos.includes(registro?.metodo_preferido) ? registro.metodo_preferido : metodos[0] ?? ""));
  const [dataBaixa, setDataBaixa] = useState(hoje);
  const [referencia, setReferencia] = useState("");
  const plano = previa?.plano ?? {};
  const resumo = plano.resumo ?? {};
  const bloqueios = previa?.bloqueios ?? [];
  // `plano: null` = o servidor recusou o PLANEJAMENTO (os bloqueios dizem por quê):
  // não há parcelas, estoque nem títulos a anunciar.
  const semPlano = previa != null && previa.plano == null && bloqueios.length > 0;
  const nParcelas = resumo.parcelas_n ?? (Array.isArray(plano.parcelas) ? plano.parcelas.length : 0);
  const nEstoque =
    resumo.itens_estoque_n ?? ((plano.efeitos_estoque?.entradas?.length ?? 0) + (plano.efeitos_estoque?.saidas?.length ?? 0));
  const valorTitulos = resumo.valor_titulos ?? plano.valor_total ?? registro?.valor_total;
  const aVista = registro?.condicao === "AVISTA";
  const enviando = estado.fase === "enviando";
  const erroBaixa = baixa ? (!metodo ? "Escolha a forma" : !ehDiaValido(dataBaixa) ? "Informe a data" : dataBaixa > hoje ? "A data não pode ser futura" : null) : null;
  const pagar = registro?.direcao === "PAGAR";
  // D-PROD-282 em todas as telas: produto com lote — lote e validade na compra, escolha do lote na venda. O servidor só
  // recebe o lote na confirmação (`lotes_por_item`); sem pendência de lote, o botão confirma.
  const [estadoLotes, setEstadoLotes] = useState(/** @type {Record<string, any>} */ ({}));
  const efeitosDoLado = (pagar ? plano.efeitos_estoque?.entradas : plano.efeitos_estoque?.saidas) ?? [];
  const conferenciaLotes = lotesDaConfirmacao(registro?.direcao, efeitosDoLado, estadoLotes);
  const mudarLote = (/** @type {number} */ n, /** @type {Record<string, unknown>} */ patch) =>
    setEstadoLotes((atual) => ({ ...atual, [n]: { ...(atual[n] ?? {}), ...patch } }));
  // Rateio do cabeçalho por item (rodada 4): nomes vêm do rascunho; valores, do plano.
  const itensDoRascunho = Array.isArray(registro?.itens) ? registro.itens : [];
  // Rateio POR ITEM (D-PROD-156): as linhas de cada item vêm do plano (o rascunho, se faltarem).
  const itensDoPlano = (registro?.conteudo === "COM_PRODUTOS" && Array.isArray(plano.itens) ? plano.itens : []).map((/** @type {any} */ i) =>
    Array.isArray(i?.rateios) ? i : { ...i, rateios: itensDoRascunho.find((/** @type {any} */ r) => r?.ordem === i?.ordem)?.rateios ?? [] },
  );
  const nomes = new Map(itensDoRascunho.map((/** @type {any} */ i) => [i.ordem, i.tipo_item === "SERVICO" ? i.descricao || "Serviço" : i.produto_nome || ""]));
  const escopoRateio = plano.rateio_escopo ?? registro?.rateio_escopo ?? "GERAL";
  const consolidado = Array.isArray(plano.rateio_consolidado) ? plano.rateio_consolidado : Array.isArray(registro?.rateio_consolidado) ? registro.rateio_consolidado : null;
  const residuos = itensDoPlano.map((/** @type {any} */ i) => i?.residuo_custo).filter((/** @type {unknown} */ r) => typeof r === "string" && /^-?\d+(?:\.\d+)?$/.test(r));
  let residuoTotal = null;
  try {
    residuoTotal = residuos.length ? somar(residuos, 8) : null;
  } catch {
    residuoTotal = null;
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => (!o && !enviando ? onFechar() : undefined)}>
      <DialogContent data-permissao-explicita="" data-testid="dialogo-confirmacao" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirmar lançamento {registro?.numero ? `nº ${registro.numero}` : ""}</DialogTitle>
          <DialogDescription data-testid="previa-resumo">
            {semPlano ? (
              "Este lançamento ainda não pode ser confirmado: nada será criado enquanto houver a pendência abaixo."
            ) : (
              <>
                Isto criará {nParcelas} {nParcelas === 1 ? "parcela" : "parcelas"}, movimentará {nEstoque} {nEstoque === 1 ? "item" : "itens"} no estoque e registrará{" "}
                {formatarMoeda(valorTitulos, c)} em títulos {pagar ? "a pagar" : "a receber"}.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {itensDoPlano.length ? (
          <RateioItensLancamento
            itens={itensDoPlano}
            nomes={nomes}
            valorTotal={plano.valor_total ?? registro?.valor_total}
            c={c}
            escopo={escopoRateio}
            consolidado={consolidado}
            nomesRateio={nomesDasClassificacoes(registro)}
          />
        ) : null}
        {Array.isArray(plano.avisos) && plano.avisos.length ? (
          // Aviso é INFORMATIVO (os bloqueios vêm à parte, em `bloqueios`).
          <ul className="list-disc space-y-1 pl-5 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="previa-avisos">
            {plano.avisos.map((/** @type {any} */ a, /** @type {number} */ k) => (
              <li key={k}>{mensagemDoAvisoDoPlano(a, { ...c, direcao: registro?.direcao, residuoTotal, semEstoque: nEstoque === 0 })}</li>
            ))}
          </ul>
        ) : null}
        {bloqueios.length ? (
          <div role="alert" data-testid="previa-bloqueios" className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
            <p className="font-semibold">Não dá para confirmar agora:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {bloqueios.map((/** @type {any} */ b, /** @type {number} */ k) => (
                <li key={k}>{mensagemDoBloqueio(b, c)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {!bloqueios.length ? (
          <LotesDaConfirmacao
            empresaId={registro?.empresa_id}
            direcao={registro?.direcao}
            efeitos={efeitosDoLado}
            estado={estadoLotes}
            onMudar={mudarLote}
            desabilitado={enviando}
            pendencia={conferenciaLotes.pendencia}
          />
        ) : null}
        {aVista && podeLiquidar && !bloqueios.length ? (
          <div className="rounded-md border border-[var(--mg-divider,#cbd5e1)] p-3 text-[13px]">
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 shrink-0 accent-emerald-600" style={{ width: 20, height: 20 }} checked={baixa} disabled={!fusoConfigurado || enviando} onChange={(e) => setBaixa(e.target.checked)} data-testid="baixa-no-ato" />
              <span>
                {pagar ? "Registrar o pagamento agora" : "Registrar o recebimento agora"} (baixa do valor total — registro gerencial, sem conciliação bancária)
                {!fusoConfigurado ? <span className="block text-[12px] text-amber-800">Exige o fuso horário da empresa configurado.</span> : null}
              </span>
            </label>
            {baixa ? (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="min-w-0 sm:col-span-2">
                  <EscolhaSegmentada rotulo="Forma da baixa" value={metodo} onChange={setMetodo} opcoes={opcoesDeMetodo(metodos)} />
                </div>
                <label className="min-w-0 text-[12px]">
                  Data
                  <input type="date" className={CTL} value={dataBaixa} max={hoje} onChange={(e) => setDataBaixa(e.target.value)} aria-label="Data da baixa" />
                </label>
                <label className="min-w-0 text-[12px]">
                  Referência
                  <input type="text" className={CTL} value={referencia} maxLength={120} onChange={(e) => setReferencia(e.target.value)} aria-label="Referência da baixa" />
                </label>
                {erroBaixa ? <p className="text-[12px] text-red-700 sm:col-span-3">{erroBaixa}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <AvisoDoEnvio estado={estado} onConsultar={onConsultar} />
        <DialogFooter className="gap-2 sm:gap-2">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando}>
            Voltar
          </button>
          <button
            type="button"
            className={BOTAO_PRIMARIO}
            disabled={enviando || bloqueios.length > 0 || Boolean(erroBaixa) || Boolean(conferenciaLotes.pendencia)}
            data-testid="botao-confirmar-definitivo"
            onClick={() =>
              disparar({
                baixa_no_ato: baixa ? { metodo, data: dataBaixa, ...(referencia.trim() ? { referencia: referencia.trim() } : {}) } : null,
                ...(conferenciaLotes.lotes_por_item.length ? { lotes_por_item: conferenciaLotes.lotes_por_item } : {}),
              })
            }
          >
            {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            {enviando ? "Confirmando…" : estado.fase === "incerto" ? "Repetir o mesmo envio" : "Confirmar lançamento"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Troca do rateio GERAL → POR ITEM (D-PROD-156): pergunta EXPLICITAMENTE como
 * cada item começa — com a classificação geral, nas mesmas proporções sobre o
 * líquido de cada item (maiores restos), ou em branco. O rateio geral fica
 * guardado no formulário até o rascunho ser salvo: voltar para "Geral" antes
 * disso o traz de volta como estava (o documento POR_ITEM salvo não tem geral).
 * @param {{
 *   aberto: boolean,
 *   proporcional: { possivel: boolean, motivo: string|null },
 *   onProporcional: () => void,
 *   onEmBranco: () => void,
 *   onCancelar: () => void,
 * }} props
 */
export function DialogoEscopoPorItem({ aberto, proporcional, onProporcional, onEmBranco, onCancelar }) {
  return (
    <Dialog open={aberto} onOpenChange={(o) => (!o ? onCancelar() : undefined)}>
      <DialogContent data-permissao-explicita="" data-testid="dialogo-escopo-por-item" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Rateio por item</DialogTitle>
          <DialogDescription>
            Como começar a classificação de cada item? O rateio geral continua guardado enquanto o rascunho não for salvo: se voltar para “Geral”
            antes de salvar, ele volta como está. Ao salvar por item, o rateio geral deixa de existir no documento.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-[13px]">
          <div className="rounded-md border border-[var(--mg-divider,#cbd5e1)] p-3">
            <p className="font-semibold">Usar a classificação geral (proporcional)</p>
            <p className="mt-1 text-[12px] text-[var(--mg-text-2,#475569)]">
              Cada item recebe as mesmas naturezas e centros do rateio geral, nas mesmas proporções, sobre o valor líquido do item (o arredondamento vai pelos
              maiores restos, ao centavo).
            </p>
            {!proporcional.possivel && proporcional.motivo ? (
              <p className="mt-1 text-[12px] text-amber-800" data-testid="escopo-por-item-motivo">
                {proporcional.motivo}
              </p>
            ) : null}
            <button type="button" className={`${BOTAO_PRIMARIO} mt-2`} disabled={!proporcional.possivel} onClick={onProporcional} data-testid="escopo-por-item-proporcional">
              Usar a classificação geral
            </button>
          </div>
          <div className="rounded-md border border-[var(--mg-divider,#cbd5e1)] p-3">
            <p className="font-semibold">Começar em branco</p>
            <p className="mt-1 text-[12px] text-[var(--mg-text-2,#475569)]">Cada item começa com uma linha vazia para você escolher a natureza e os centros.</p>
            <button type="button" className={`${BOTAO_SECUNDARIO} mt-2`} onClick={onEmBranco} data-testid="escopo-por-item-branco">
              Começar em branco
            </button>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onCancelar} data-testid="escopo-por-item-cancelar">
            Continuar no rateio geral
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Registrar pagamento/recebimento de UMA parcela (valor ≤ saldo, data ≤ hoje da
 * fazenda, forma permitida pelo perfil). Aviso: sem conciliação bancária.
 * @param {{
 *   aberto: boolean,
 *   titulo: any,
 *   registro: any,
 *   perfil: { locale: string, moeda: string, moeda_casas: number, metodos_permitidos: string[] },
 *   hoje: string,
 *   fusoConfigurado: boolean,
 *   onFechar: () => void,
 *   onRegistrar: (p: { valor: string, data: string, metodo: string, referencia?: string, observacao?: string }, opcoes: { retentativa: boolean }) => Promise<unknown>,
 *   onConsultar: () => void,
 * }} props
 */
export function DialogoLiquidacao({ aberto, titulo, registro, perfil, hoje, fusoConfigurado, onFechar, onRegistrar, onConsultar }) {
  const locale = perfil.locale;
  const casas = Number.isInteger(registro?.moeda_casas) ? registro.moeda_casas : perfil.moeda_casas;
  const c = { locale, moeda: registro?.moeda || perfil.moeda, casas };
  const metodos = perfil.metodos_permitidos ?? [];
  const [valor, setValor] = useState(() => (titulo?.saldo ? paraTextoDeEdicao(String(titulo.saldo), locale, { casasMin: casas, casasMax: casas }) : ""));
  const [data, setData] = useState(hoje);
  const [metodo, setMetodo] = useState(() => (metodos.includes(registro?.metodo_preferido) ? registro.metodo_preferido : metodos[0] ?? ""));
  const [referencia, setReferencia] = useState("");
  const [observacao, setObservacao] = useState("");
  const { estado, disparar } = useEnvioUnico(onRegistrar, c);
  const pagar = registro?.direcao === "PAGAR";
  const lido = lerNumeroLocal(valor, locale, { casas, inteiros: LIMITES.DINHEIRO.inteiros });
  let erroValor = null;
  if (!lido.ok) erroValor = mensagemNumero(lido.motivo, casas);
  else if (!ehPositivo(lido.valor)) erroValor = "Precisa ser maior que zero";
  else if (titulo?.saldo && comparar(lido.valor, String(titulo.saldo)) > 0) erroValor = `Maior que o saldo (${formatarMoeda(String(titulo.saldo), c)})`;
  const erroData = !ehDiaValido(data) ? "Informe a data" : data > hoje ? "A data não pode ser futura" : null;
  const enviando = estado.fase === "enviando";
  const invalido = Boolean(erroValor || erroData || !metodo || !fusoConfigurado);

  return (
    <Dialog open={aberto} onOpenChange={(o) => (!o && !enviando ? onFechar() : undefined)}>
      <DialogContent data-permissao-explicita="" data-testid="dialogo-liquidacao" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{pagar ? "Registrar pagamento" : "Registrar recebimento"}</DialogTitle>
          <DialogDescription>
            Parcela {titulo?.numero_parcela}/{titulo?.total_parcelas}, vencimento {formatarDia(titulo?.vencimento, locale)} — saldo {formatarMoeda(titulo?.saldo, c)}.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-md border border-sky-200 bg-sky-50 p-2 text-[12px] text-sky-900" data-testid="aviso-liquidacao-gerencial">
          Registro gerencial: não há conciliação bancária. Isto não confirma o pagamento no banco.
        </p>
        {!fusoConfigurado ? (
          <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[12px] text-amber-900">
            A empresa não tem fuso horário configurado: o registro de baixa exige o fuso (Administração › Empresa).
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="min-w-0 text-[12px]">
            Valor ({c.moeda})
            <input type="text" inputMode="decimal" className={CTL} value={valor} onChange={(e) => setValor(e.target.value)} aria-label="Valor da baixa" data-testid="liquidacao-valor" />
            {erroValor ? <span className="text-red-700">{erroValor}</span> : null}
          </label>
          <label className="min-w-0 text-[12px]">
            Data
            <input type="date" className={CTL} value={data} max={hoje} onChange={(e) => setData(e.target.value)} aria-label="Data da baixa" data-testid="liquidacao-data" />
            {erroData ? <span className="text-red-700">{erroData}</span> : null}
          </label>
          <div className="min-w-0 sm:col-span-2">
            <EscolhaSegmentada rotulo="Forma da baixa" testId="liquidacao-metodo" value={metodo} onChange={setMetodo} opcoes={opcoesDeMetodo(metodos)} />
          </div>
          <label className="min-w-0 text-[12px]">
            Referência
            <input type="text" className={CTL} value={referencia} maxLength={120} onChange={(e) => setReferencia(e.target.value)} aria-label="Referência" />
          </label>
          <label className="min-w-0 text-[12px] sm:col-span-2">
            Observação
            <textarea className={`${CTL} h-16 py-2`} value={observacao} maxLength={500} onChange={(e) => setObservacao(e.target.value)} aria-label="Observação" />
          </label>
        </div>
        <AvisoDoEnvio estado={estado} onConsultar={onConsultar} />
        <DialogFooter className="gap-2 sm:gap-2">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando}>
            Voltar
          </button>
          <button
            type="button"
            className={BOTAO_PRIMARIO}
            disabled={enviando || invalido}
            data-testid="botao-registrar-liquidacao"
            onClick={() =>
              disparar({
                valor: lido.ok ? naEscala(lido.valor, casas) : "",
                data,
                metodo,
                ...(referencia.trim() ? { referencia: referencia.trim() } : {}),
                ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
              })
            }
          >
            {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            {enviando ? "Registrando…" : estado.fase === "incerto" ? "Repetir o mesmo envio" : pagar ? "Registrar pagamento" : "Registrar recebimento"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Ação com motivo obrigatório (estornar baixa, cancelar, corrigir ou excluir
 * lançamento) ou sem motivo (descartar rascunho). O erro do servidor fica
 * DENTRO do diálogo. `conteudo`: o efeito da ação, abaixo da descrição.
 * `confirmacaoExplicita` (D-PROD-158, exclusão): caixa que precisa ser marcada
 * além do motivo — o primeiro clique nunca envia nada.
 * @param {{
 *   aberto: boolean,
 *   titulo: string,
 *   descricao: string,
 *   rotuloBotao: string,
 *   testId: string,
 *   comMotivo?: boolean,
 *   perigo?: boolean,
 *   contexto: { locale: string, moeda: string, casas: number, direcao?: string|null },
 *   onFechar: () => void,
 *   onEnviar: (motivo: string, opcoes: { retentativa: boolean }) => Promise<unknown>,
 *   onConsultar?: (() => void) | null,
 *   conteudo?: React.ReactNode,
 *   confirmacaoExplicita?: string | null,
 *   icone?: React.ReactNode,
 *   iconeBotao?: React.ReactNode,
 *   janelaBase1?: boolean,
 *   mensagemDoErro?: ((erro: unknown) => string) | null,
 *   rotuloEnviando?: string,
 *   rotuloMotivo?: string,
 * }} props `icone` (opcional): o selo ao lado do título (o "Concluir atividade" da D-PROD-232); `iconeBotao`: o ícone
 *   do botão de envio. Sem eles, o diálogo fica como sempre foi. `janelaBase1` (D-PROD-252, emenda 3): o diálogo vira a
 *   janela padrão do Base1 (`B1Janela`: 680px, corpo que rola, título e ✕ em cima, botões embaixo; tela cheia no
 *   celular), do mesmo tamanho das janelas de lançamento, em vez da caixa pequena do shadcn. Vocabulário da tela que
 *   abre o diálogo (todos opcionais; sem eles, o diálogo fica como sempre foi): `mensagemDoErro` dá a frase da recusa
 *   definitiva no lugar de `mensagemErroGestao`; `rotuloEnviando` é o texto do botão durante o envio ("Enviando…");
 *   `rotuloMotivo` é o rótulo do campo de motivo ("Motivo", exibido como "<rótulo> (obrigatório)").
 */
export function DialogoAcao({
  aberto,
  titulo,
  descricao,
  rotuloBotao,
  testId,
  comMotivo = true,
  perigo = true,
  contexto,
  onFechar,
  onEnviar,
  onConsultar = null,
  conteudo = null,
  confirmacaoExplicita = null,
  icone = null,
  iconeBotao = null,
  janelaBase1 = false,
  mensagemDoErro = null,
  rotuloEnviando = "Enviando…",
  rotuloMotivo = "Motivo",
}) {
  const celular = useCelular();
  const [motivo, setMotivo] = useState("");
  const [ciente, setCiente] = useState(false);
  const { estado, disparar } = useEnvioUnico(onEnviar, contexto, undefined, mensagemDoErro);
  const enviando = estado.fase === "enviando";
  const semMotivo = (comMotivo && !motivo.trim()) || (Boolean(confirmacaoExplicita) && !ciente);
  if (janelaBase1) {
    return (
      <B1Janela
        aberto={aberto}
        onFechar={onFechar}
        podeFechar={!enviando}
        titulo={
          icone ? (
            <span className="b1-tipo-titulo">
              <span className="b1-tipo-titulo__icone" aria-hidden>
                {icone}
              </span>
              {titulo}
            </span>
          ) : (
            titulo
          )
        }
        descricao={descricao || null}
        testId={testId}
        className={celular ? "b1-janela--tela-cheia" : ""}
        contentProps={{ "data-permissao-explicita": "", "data-celular": celular ? "" : undefined, className: celular ? "b1-janela__camada--tela-cheia" : undefined }}
        rodape={
          <>
            <button type="button" className="tb-btn" onClick={onFechar} disabled={enviando} data-testid={`${testId}-voltar`}>
              Voltar
            </button>
            <button
              type="button"
              className={perigo ? "tb-btn tb-btn-red" : "tb-btn tb-btn-green"}
              disabled={enviando || semMotivo}
              data-testid={`${testId}-enviar`}
              onClick={() => disparar(motivo.trim())}
            >
              {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : iconeBotao}
              {enviando ? rotuloEnviando : estado.fase === "incerto" ? "Repetir o mesmo envio" : rotuloBotao}
            </button>
          </>
        }
      >
        {conteudo ? <div className="min-w-0 text-[13px]">{conteudo}</div> : null}
        {comMotivo ? (
          <label className="b1-janela__rotulo">
            {rotuloMotivo} (obrigatório)
            <textarea
              className="b1-janela__ctl"
              value={motivo}
              maxLength={500}
              onChange={(e) => setMotivo(e.target.value)}
              aria-label={rotuloMotivo}
              data-testid={`${testId}-motivo`}
            />
          </label>
        ) : null}
        {confirmacaoExplicita ? (
          <label className="flex min-w-0 items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0 accent-red-600"
              style={{ width: 20, height: 20 }}
              checked={ciente}
              disabled={enviando}
              onChange={(e) => setCiente(e.target.checked)}
              data-testid={`${testId}-ciente`}
            />
            <span className="min-w-0 break-words">{confirmacaoExplicita}</span>
          </label>
        ) : null}
        <AvisoDoEnvio estado={estado} onConsultar={onConsultar} />
      </B1Janela>
    );
  }
  return (
    <Dialog open={aberto} onOpenChange={(o) => (!o && !enviando ? onFechar() : undefined)}>
      <DialogContent data-permissao-explicita="" data-testid={testId} className="max-w-lg">
        {icone ? (
          <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-emerald-100 bg-emerald-50 text-emerald-600" aria-hidden>
              {icone}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <DialogTitle>{titulo}</DialogTitle>
              <DialogDescription className="break-words">{descricao}</DialogDescription>
            </span>
          </DialogHeader>
        ) : (
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription>{descricao}</DialogDescription>
          </DialogHeader>
        )}
        {conteudo ? <div className="min-w-0 text-[13px]">{conteudo}</div> : null}
        {comMotivo ? (
          <label className="min-w-0 text-[12px]">
            {rotuloMotivo} (obrigatório)
            <textarea
              className={`${CTL} h-20 py-2`}
              value={motivo}
              maxLength={500}
              onChange={(e) => setMotivo(e.target.value)}
              aria-label={rotuloMotivo}
              data-testid={`${testId}-motivo`}
            />
          </label>
        ) : null}
        {confirmacaoExplicita ? (
          <label className="flex min-w-0 items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0 accent-red-600"
              style={{ width: 20, height: 20 }}
              checked={ciente}
              disabled={enviando}
              onChange={(e) => setCiente(e.target.checked)}
              data-testid={`${testId}-ciente`}
            />
            <span className="min-w-0 break-words">{confirmacaoExplicita}</span>
          </label>
        ) : null}
        <AvisoDoEnvio estado={estado} onConsultar={onConsultar} />
        <DialogFooter className="gap-2 sm:gap-2">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando}>
            Voltar
          </button>
          <button
            type="button"
            className={perigo ? BOTAO_PERIGO : BOTAO_PRIMARIO}
            disabled={enviando || semMotivo}
            data-testid={`${testId}-enviar`}
            onClick={() => disparar(motivo.trim())}
          >
            {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : iconeBotao}
            {enviando ? rotuloEnviando : estado.fase === "incerto" ? "Repetir o mesmo envio" : rotuloBotao}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bloqueio de editar/excluir (D-PROD-158): os motivos LEGÍVEIS que a
 * elegibilidade do servidor devolveu — nada é aberto nem enviado. Sem
 * permissão aparece como sem permissão; vínculo aparece como vínculo.
 * @param {{
 *   aberto: boolean,
 *   titulo: string,
 *   descricao: string,
 *   motivos: any[],
 *   contexto?: { locale?: string, moeda?: string, casas?: number, direcao?: string|null },
 *   onFechar: () => void,
 *   rodape?: React.ReactNode,
 * }} props
 */
export function DialogoMotivos({ aberto, titulo, descricao, motivos, contexto = {}, onFechar, rodape = null }) {
  const lista = Array.isArray(motivos) ? motivos : [];
  return (
    <Dialog open={aberto} onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent data-permissao-explicita="" data-testid="dialogo-bloqueio" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-1.5">
              <Ban size={18} aria-hidden /> {titulo}
            </span>
          </DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <ul role="alert" className="min-w-0 list-disc space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-3 pl-7 text-[13px] text-amber-900" data-testid="dialogo-bloqueio-motivos">
          {lista.length ? (
            lista.map((m, k) => (
              <li key={k} className="break-words" data-codigo={typeof m?.codigo === "string" ? m.codigo : undefined}>
                {mensagemDoMotivo(m, contexto)}
              </li>
            ))
          ) : (
            <li className="break-words">O servidor não liberou esta ação agora. Recarregue o lançamento e tente de novo.</li>
          )}
        </ul>
        {rodape ? <div className="min-w-0 text-[12px] text-[var(--mg-text-2,#475569)]">{rodape}</div> : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} data-testid="dialogo-bloqueio-fechar">
            Entendi
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
