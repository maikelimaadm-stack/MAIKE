import React, { useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import * as UiDialog from "@/components/ui/dialog";
import { EscolhaSegmentada } from "@/components/financeiroGestao/CamposLancamento";

// Os componentes de `ui/dialog` são forwardRef sem tipos: aqui valem como `any`.
const Dialog = /** @type {any} */ (UiDialog.Dialog);
const DialogContent = /** @type {any} */ (UiDialog.DialogContent);
const DialogDescription = /** @type {any} */ (UiDialog.DialogDescription);
const DialogFooter = /** @type {any} */ (UiDialog.DialogFooter);
const DialogHeader = /** @type {any} */ (UiDialog.DialogHeader);
const DialogTitle = /** @type {any} */ (UiDialog.DialogTitle);
import { LIMITES, comparar, ehPositivo, formatarMoeda, lerNumeroLocal, naEscala, paraTextoDeEdicao } from "@/lib/dinheiroDecimal";
import { ehDiaValido, formatarDia } from "@/lib/diaCivil";
import { mensagemDoAvisoDoPlano, mensagemDoBloqueio, mensagemErroGestao } from "@/lib/gestaoErros";
import { CODIGO_ENVIO_PENDENTE, ROTULO_METODO, ehRecusaDefinitiva, ehResultadoIncerto } from "@/services/operacaoFinanceiraService";
import { mensagemNumero } from "@/components/financeiroGestao/lancamentoModelo";

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
 * @typedef {{ fase: 'pronto'|'enviando'|'incerto'|'erro', mensagem?: string }} EstadoEnvio
 */

/**
 * Executa o envio uma vez por vez (duplo clique = 1 envio). O 2º argumento de
 * `enviar` diz se este clique é a RETENTATIVA do envio que ficou sem resposta
 * definitiva NESTE diálogo ("Repetir o mesmo envio"): só ela reaproveita a
 * chave pendente sem perguntar (§8.7). Diálogo novo = envio novo.
 * @param {(arg: any, opcoes: { retentativa: boolean }) => Promise<unknown>} enviar
 * @param {{ locale: string, moeda: string, casas: number }} c
 * @param {(r: unknown) => void} [aoConcluir]
 */
function useEnvioUnico(enviar, c, aoConcluir) {
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
      else setEstado({ fase: "erro", mensagem: mensagemErroGestao(erro, "Não foi possível concluir. Nada foi gravado.", { ...c, comandoIdempotente: true }) });
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
 *   onConfirmar: (p: { baixa_no_ato: { metodo: string, data: string, referencia?: string } | null }, opcoes: { retentativa: boolean }) => Promise<unknown>,
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
  const nParcelas = resumo.parcelas_n ?? (Array.isArray(plano.parcelas) ? plano.parcelas.length : 0);
  const nEstoque =
    resumo.itens_estoque_n ?? ((plano.efeitos_estoque?.entradas?.length ?? 0) + (plano.efeitos_estoque?.saidas?.length ?? 0));
  const valorTitulos = resumo.valor_titulos ?? plano.valor_total ?? registro?.valor_total;
  const aVista = registro?.condicao === "AVISTA";
  const enviando = estado.fase === "enviando";
  const erroBaixa = baixa ? (!metodo ? "Escolha a forma" : !ehDiaValido(dataBaixa) ? "Informe a data" : dataBaixa > hoje ? "A data não pode ser futura" : null) : null;
  const pagar = registro?.direcao === "PAGAR";

  return (
    <Dialog open={aberto} onOpenChange={(o) => (!o && !enviando ? onFechar() : undefined)}>
      <DialogContent data-permissao-explicita="" data-testid="dialogo-confirmacao" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirmar lançamento {registro?.numero ? `nº ${registro.numero}` : ""}</DialogTitle>
          <DialogDescription data-testid="previa-resumo">
            Isto criará {nParcelas} {nParcelas === 1 ? "parcela" : "parcelas"}, movimentará {nEstoque} {nEstoque === 1 ? "item" : "itens"} no estoque e registrará{" "}
            {formatarMoeda(valorTitulos, c)} em títulos {pagar ? "a pagar" : "a receber"}.
          </DialogDescription>
        </DialogHeader>
        {Array.isArray(plano.avisos) && plano.avisos.length ? (
          // Aviso é INFORMATIVO (os bloqueios vêm à parte, em `bloqueios`).
          <ul className="list-disc space-y-1 pl-5 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="previa-avisos">
            {plano.avisos.map((/** @type {any} */ a, /** @type {number} */ k) => (
              <li key={k}>{mensagemDoAvisoDoPlano(a)}</li>
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
            disabled={enviando || bloqueios.length > 0 || Boolean(erroBaixa)}
            data-testid="botao-confirmar-definitivo"
            onClick={() =>
              disparar({ baixa_no_ato: baixa ? { metodo, data: dataBaixa, ...(referencia.trim() ? { referencia: referencia.trim() } : {}) } : null })
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
 * Ação com motivo obrigatório (estornar baixa, cancelar lançamento) ou sem
 * motivo (descartar rascunho). O erro do servidor fica DENTRO do diálogo.
 * @param {{
 *   aberto: boolean,
 *   titulo: string,
 *   descricao: string,
 *   rotuloBotao: string,
 *   testId: string,
 *   comMotivo?: boolean,
 *   perigo?: boolean,
 *   contexto: { locale: string, moeda: string, casas: number },
 *   onFechar: () => void,
 *   onEnviar: (motivo: string, opcoes: { retentativa: boolean }) => Promise<unknown>,
 *   onConsultar?: (() => void) | null,
 * }} props
 */
export function DialogoAcao({ aberto, titulo, descricao, rotuloBotao, testId, comMotivo = true, perigo = true, contexto, onFechar, onEnviar, onConsultar = null }) {
  const [motivo, setMotivo] = useState("");
  const { estado, disparar } = useEnvioUnico(onEnviar, contexto);
  const enviando = estado.fase === "enviando";
  const semMotivo = comMotivo && !motivo.trim();
  return (
    <Dialog open={aberto} onOpenChange={(o) => (!o && !enviando ? onFechar() : undefined)}>
      <DialogContent data-permissao-explicita="" data-testid={testId} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        {comMotivo ? (
          <label className="min-w-0 text-[12px]">
            Motivo (obrigatório)
            <textarea
              className={`${CTL} h-20 py-2`}
              value={motivo}
              maxLength={500}
              onChange={(e) => setMotivo(e.target.value)}
              aria-label="Motivo"
              data-testid={`${testId}-motivo`}
            />
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
            {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            {enviando ? "Enviando…" : estado.fase === "incerto" ? "Repetir o mesmo envio" : rotuloBotao}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
