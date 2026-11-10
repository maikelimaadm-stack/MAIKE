import React, { useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import * as UiDialog from "@/components/ui/dialog";
import { mensagemDoBloqueioAbastecimento, mensagemErroAbastecimento } from "@/lib/patrimonioErros";
import {
  UNIDADE_MEDIDOR,
  formatarCusto,
  formatarDiaAbastecimento,
  formatarFator,
  formatarKg,
  formatarLeitura,
  formatarLitros,
  rotuloDoBem,
} from "@/lib/abastecimentoRegras";
import { CODIGO_ENVIO_PENDENTE, ehRecusaDefinitiva, ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

// Os componentes de `ui/dialog` são forwardRef sem tipos: aqui valem como `any`.
const Dialog = /** @type {any} */ (UiDialog.Dialog);
const DialogContent = /** @type {any} */ (UiDialog.DialogContent);
const DialogDescription = /** @type {any} */ (UiDialog.DialogDescription);
const DialogFooter = /** @type {any} */ (UiDialog.DialogFooter);
const DialogHeader = /** @type {any} */ (UiDialog.DialogHeader);
const DialogTitle = /** @type {any} */ (UiDialog.DialogTitle);

export const CTL_DIALOGO = "w-full min-w-0 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white px-3 text-[14px] outline-none focus:border-emerald-500";
export const BOTAO_PRIMARIO =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-4 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60";
export const BOTAO_PERIGO =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-red-600 px-4 text-[13px] font-semibold text-white hover:bg-red-700 disabled:opacity-60";
export const BOTAO_SECUNDARIO =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-4 text-[13px] font-medium hover:bg-slate-50 disabled:opacity-60";

/**
 * Estado do envio: "incerto" = sem resposta definitiva (rede/prazo/5xx) — NUNCA
 * vira "sucesso"; o usuário consulta ou repete o MESMO envio (mesma chave).
 * @typedef {{ fase: 'pronto'|'enviando'|'incerto'|'erro', mensagem?: string, consulta?: string|null }} EstadoEnvio
 */

/**
 * Um envio por vez (duplo clique = 1 envio). O 2º argumento de `enviar` diz se
 * este clique é a RETENTATIVA do envio que ficou sem resposta NESTE diálogo
 * ("Repetir o mesmo envio"): só ela reaproveita a chave pendente sem perguntar.
 * @param {(arg: any, opcoes: { retentativa: boolean }) => Promise<unknown>} enviar
 * @param {string} fallback
 */
export function useEnvioAbastecimento(enviar, fallback) {
  const [estado, setEstado] = useState(/** @type {EstadoEnvio} */ ({ fase: "pronto" }));
  const emCurso = useRef(false);
  const repetir = useRef(false);
  const disparar = async (/** @type {any} */ arg) => {
    if (emCurso.current) return;
    emCurso.current = true;
    setEstado({ fase: "enviando" });
    try {
      await enviar(arg, { retentativa: repetir.current });
      repetir.current = false;
      setEstado({ fase: "pronto" });
    } catch (erro) {
      // "Manter" o envio anterior sem resposta: nada saiu agora; aquele envio continua incerto.
      const manteve = /** @type {any} */ (erro)?.code === CODIGO_ENVIO_PENDENTE;
      repetir.current = manteve || !ehRecusaDefinitiva(erro);
      if (manteve || ehResultadoIncerto(erro)) setEstado({ fase: "incerto", consulta: null });
      else setEstado({ fase: "erro", mensagem: mensagemErroAbastecimento(erro, fallback) });
    } finally {
      emCurso.current = false;
    }
  };
  return { estado, disparar, setEstado };
}

/**
 * Aviso do envio: resultado incerto (com "Repetir o mesmo envio" e "Consultar")
 * ou a recusa legível do servidor.
 * @param {{ estado: EstadoEnvio, onRepetir?: (() => void) | null, onConsultar?: (() => void) | null, objeto: string }} props
 */
export function AvisoEnvioAbastecimento({ estado, onRepetir = null, onConsultar = null, objeto }) {
  if (estado.fase === "incerto") {
    return (
      <div role="alert" data-testid="resultado-incerto" className="min-w-0 rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
        <p className="flex items-center gap-1.5 font-semibold">
          <AlertTriangle size={16} aria-hidden /> Resultado incerto — consulte antes de repetir
        </p>
        <p className="mt-1 break-words">
          Não recebemos a resposta do servidor: {objeto} PODE ter sido gravado. Consulte antes. Se repetir, o MESMO envio é reaproveitado e o estoque não é
          baixado duas vezes.
        </p>
        {estado.consulta ? (
          <p className="mt-1 break-words font-medium" data-testid="consulta-resultado">
            {estado.consulta}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {onConsultar ? (
            <button type="button" className={BOTAO_SECUNDARIO} onClick={onConsultar} data-testid="botao-consultar-resultado">
              Consultar
            </button>
          ) : null}
          {onRepetir ? (
            <button type="button" className={BOTAO_SECUNDARIO} onClick={onRepetir} data-testid="botao-repetir-envio">
              Repetir o mesmo envio
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  if (estado.fase === "erro") {
    return (
      <p role="alert" data-testid="erro-envio" className="min-w-0 break-words rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
        {estado.mensagem}
      </p>
    );
  }
  return null;
}

/** @param {{ rotulo: string, valor: React.ReactNode, testId?: string }} props */
function Linha({ rotulo, valor, testId = undefined }) {
  return (
    <div className="flex min-w-0 flex-wrap justify-between gap-x-3 border-b border-slate-100 py-1">
      <dt className="text-[12px] text-[var(--mg-text-2,#475569)]">{rotulo}</dt>
      <dd className="min-w-0 break-words text-right text-[13px] font-medium" data-testid={testId}>
        {valor}
      </dd>
    </div>
  );
}

/**
 * Prévia (sem escrita) + confirmação do abastecimento. Mostra KG, fator e
 * versão, lotes FIFO, custo ESTIMADO e o medidor; com bloqueio não há
 * "Confirmar". `onConsultar` devolve o texto do resultado da consulta (ou null
 * quando achou e o diálogo fecha).
 * @param {{
 *   aberto: boolean,
 *   previa: { plano: any, bloqueios: any[] } | null,
 *   podeConfirmar: boolean,
 *   podeConfigurarFator: boolean,
 *   onFechar: () => void,
 *   onConfirmar: (arg: unknown, opcoes: { retentativa: boolean }) => Promise<unknown>,
 *   onConsultar: () => Promise<string|null>,
 *   onConfigurarFator: () => void,
 * }} props
 */
export function DialogoPreviaAbastecimento({ aberto, previa, podeConfirmar, podeConfigurarFator, onFechar, onConfirmar, onConsultar, onConfigurarFator }) {
  const { estado, disparar, setEstado } = useEnvioAbastecimento(onConfirmar, "Não foi possível confirmar o abastecimento. Nada foi gravado.");
  const enviando = estado.fase === "enviando";
  const plano = previa?.plano ?? null;
  const bloqueios = Array.isArray(previa?.bloqueios) ? previa.bloqueios : [];
  const semFator = bloqueios.some((/** @type {any} */ b) => b?.code === "ABASTECIMENTO_CONVERSAO_AUSENTE");
  const fifo = plano?.fifo ?? null;
  const fatias = Array.isArray(fifo?.fatias) ? fifo.fatias : [];
  const medidor = plano?.medidor ?? null;
  const unidade = UNIDADE_MEDIDOR[String(medidor?.tipo ?? "")] ?? "";

  const consultar = async () => {
    const texto = await onConsultar();
    if (texto) setEstado((e) => ({ ...e, consulta: texto }));
  };

  return (
    <Dialog open={aberto} onOpenChange={(/** @type {boolean} */ o) => (!o && !enviando ? onFechar() : undefined)}>
      <DialogContent data-permissao-explicita="" data-testid="dialogo-previa-abastecimento" className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prévia do abastecimento</DialogTitle>
          <DialogDescription data-testid="previa-resumo">
            {plano?.quantidade_kg
              ? `${formatarLitros(plano.quantidade_litros)} L de ${plano.tipo_combustivel?.nome ?? "combustível"} em ${rotuloDoBem(plano.bem)}: baixa de ${formatarKg(
                  plano.quantidade_kg,
                )} kg de ${plano.produto?.nome ?? "produto"} do estoque em ${plano.local_estoque?.nome ?? "local"}.`
              : "Nada foi gravado: confira abaixo o que impede a confirmação."}
          </DialogDescription>
        </DialogHeader>
        <dl className="min-w-0">
          <Linha rotulo="Data" valor={formatarDiaAbastecimento(plano?.data_operacional)} />
          <Linha rotulo="Litros informados" valor={plano?.quantidade_litros ? `${formatarLitros(plano.quantidade_litros)} L` : "—"} />
          <Linha
            rotulo="Fator kg/L"
            testId="previa-fator"
            valor={plano?.conversao ? `${formatarFator(plano.conversao.kg_por_litro)} kg/L (versão ${plano.conversao.sequencia ?? plano.conversao.versao})` : "Sem fator kg/L configurado"}
          />
          <Linha rotulo="Quantidade baixada" testId="previa-kg" valor={plano?.quantidade_kg ? `${formatarKg(plano.quantidade_kg)} kg` : "—"} />
          <Linha
            rotulo="Custo"
            testId="previa-custo"
            valor={
              fifo?.custo_total_estimado ? (
                <>
                  {formatarCusto(fifo.custo_total_estimado)}
                  {fifo.custo_unitario_estimado ? ` (${formatarCusto(fifo.custo_unitario_estimado)}/kg)` : ""}
                  <span className="block text-[11px] font-normal text-[var(--mg-text-2,#475569)]">estimativa; o custo final é calculado na confirmação</span>
                </>
              ) : (
                "—"
              )
            }
          />
          {plano?.estoque ? (
            <Linha rotulo="Saldo no local" valor={`${formatarKg(plano.estoque.saldo_local_kg)} kg`} />
          ) : null}
          {medidor?.leitura ? (
            <Linha rotulo="Leitura do medidor" valor={`${formatarLeitura(medidor.leitura)}${unidade ? ` ${unidade}` : ""}`} />
          ) : null}
          <Linha rotulo="Tanque cheio" valor={plano?.tanque_cheio ? "Sim" : "Não"} />
        </dl>
        {fatias.length ? (
          <div className="min-w-0 overflow-x-auto">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">Lotes consumidos (FIFO)</p>
            <table className="w-full text-[12px]" data-testid="previa-fatias">
              <thead>
                <tr className="text-left text-[var(--mg-text-2,#475569)]">
                  <th className="py-1 pr-2">Lote de</th>
                  <th className="py-1 pr-2 text-right">KG</th>
                  <th className="py-1 pr-2 text-right">Custo/kg</th>
                  <th className="py-1 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {fatias.map((/** @type {any} */ f) => (
                  <tr key={`${f.ordem}-${f.lote_id}`} className="border-t border-slate-100">
                    <td className="py-1 pr-2">{formatarDiaAbastecimento(f.data_lote)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{formatarKg(f.quantidade_kg)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{formatarCusto(f.custo_unitario)}</td>
                    <td className="py-1 text-right tabular-nums">{formatarCusto(f.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {bloqueios.length ? (
          <div role="alert" data-testid="previa-bloqueios" className="min-w-0 rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
            <p className="font-semibold">Não dá para confirmar agora:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {bloqueios.map((/** @type {any} */ b, /** @type {number} */ k) => (
                <li key={k} className="break-words" data-codigo={b?.code}>
                  {mensagemDoBloqueioAbastecimento(b)}
                </li>
              ))}
            </ul>
            {semFator && podeConfigurarFator ? (
              <button type="button" className={`${BOTAO_SECUNDARIO} mt-2`} onClick={onConfigurarFator} data-testid="abastecimento-configurar-fator">
                Configurar fator
              </button>
            ) : null}
          </div>
        ) : null}
        <AvisoEnvioAbastecimento
          estado={estado}
          objeto="o abastecimento"
          onConsultar={consultar}
          onRepetir={podeConfirmar && !bloqueios.length ? () => disparar(null) : null}
        />
        <DialogFooter className="gap-2 sm:gap-2">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando}>
            Voltar
          </button>
          {podeConfirmar && !bloqueios.length && plano ? (
            <button type="button" className={BOTAO_PRIMARIO} disabled={enviando} data-testid="abastecimento-confirmar" onClick={() => disparar(null)}>
              {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              {enviando ? "Confirmando…" : estado.fase === "incerto" ? "Repetir o mesmo envio" : "Confirmar abastecimento"}
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "1.550,5 h em 10/06/2027" (ou o texto do cadastro). @param {any} ponto @param {string} unidade */
const textoDoPonto = (ponto, unidade) =>
  ponto && ponto.leitura ? `${formatarLeitura(ponto.leitura)}${unidade ? ` ${unidade}` : ""} (${formatarDiaAbastecimento(ponto.data)})` : null;

/**
 * Cancelamento com estorno exato: motivo (3..500) e ciência obrigatórios; avisa
 * quando a leitura operacional do medidor vai mudar.
 * @param {{
 *   aberto: boolean,
 *   registro: any,
 *   onFechar: () => void,
 *   onEnviar: (motivo: string, opcoes: { retentativa: boolean }) => Promise<unknown>,
 *   onConsultar: () => Promise<string|null>,
 * }} props
 */
export function DialogoCancelarAbastecimento({ aberto, registro, onFechar, onEnviar, onConsultar }) {
  const [motivo, setMotivo] = useState("");
  const [ciente, setCiente] = useState(false);
  const { estado, disparar, setEstado } = useEnvioAbastecimento(onEnviar, "Não foi possível cancelar o abastecimento. Nada foi alterado.");
  const enviando = estado.fase === "enviando";
  const motivoLimpo = motivo.trim();
  const motivoCurto = motivoLimpo.length > 0 && motivoLimpo.length < 3;
  const bloqueado = motivoLimpo.length < 3 || motivoLimpo.length > 500 || !ciente;
  const efeito = registro?.efeito_cancelamento_medidor ?? null;
  const unidade = UNIDADE_MEDIDOR[String(registro?.medidor?.tipo ?? "")] ?? "";
  const antes = textoDoPonto(efeito?.leitura_operacional_antes, unidade);
  const depois = efeito?.leitura_operacional_depois ?? null;
  const textoDepois =
    !depois || depois.origem === "CADASTRO"
      ? `para a leitura do cadastro${depois?.leitura ? `, ${textoDoPonto(depois, unidade)}` : ""}`
      : `para ${textoDoPonto(depois, unidade)}`;

  const consultar = async () => {
    const texto = await onConsultar();
    if (texto) setEstado((e) => ({ ...e, consulta: texto }));
  };

  return (
    <Dialog open={aberto} onOpenChange={(/** @type {boolean} */ o) => (!o && !enviando ? onFechar() : undefined)}>
      <DialogContent data-permissao-explicita="" data-testid="dialogo-cancelamento-abastecimento" className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cancelar abastecimento {registro?.numero ? `nº ${registro.numero}` : ""}</DialogTitle>
          <DialogDescription>
            O cancelamento estorna a baixa: o estoque volta exatamente aos lotes de origem ({formatarKg(registro?.quantidade_kg)} kg de{" "}
            {registro?.produto?.nome ?? "produto"}). O abastecimento continua no histórico como cancelado; nada é apagado.
          </DialogDescription>
        </DialogHeader>
        {efeito?.muda ? (
          <p role="status" data-testid="cancelamento-aviso-medidor" className="min-w-0 break-words rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
            A leitura operacional do medidor passará de {antes ?? "—"} {textoDepois}.
          </p>
        ) : null}
        <label className="min-w-0 text-[12px]">
          Motivo (obrigatório, de 3 a 500 caracteres)
          <textarea
            className={`${CTL_DIALOGO} h-20 py-2`}
            value={motivo}
            maxLength={500}
            onChange={(e) => setMotivo(e.target.value)}
            aria-label="Motivo do cancelamento"
            data-testid="cancelamento-motivo"
            disabled={enviando}
          />
        </label>
        {motivoCurto ? <p className="text-[12px] text-red-700">Informe pelo menos 3 caracteres.</p> : null}
        <label className="flex min-w-0 items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0 accent-red-600"
            style={{ width: 20, height: 20 }}
            checked={ciente}
            disabled={enviando}
            onChange={(e) => setCiente(e.target.checked)}
            data-testid="cancelamento-ciente"
          />
          <span className="min-w-0 break-words">Estou ciente: o estoque baixado volta aos lotes de origem e este abastecimento deixa de contar no consumo.</span>
        </label>
        <AvisoEnvioAbastecimento estado={estado} objeto="o cancelamento" onConsultar={consultar} onRepetir={bloqueado ? null : () => disparar(motivoLimpo)} />
        <DialogFooter className="gap-2 sm:gap-2">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando}>
            Voltar
          </button>
          <button type="button" className={BOTAO_PERIGO} disabled={enviando || bloqueado} data-testid="cancelamento-enviar" onClick={() => disparar(motivoLimpo)}>
            {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            {enviando ? "Cancelando…" : estado.fase === "incerto" ? "Repetir o mesmo envio" : "Cancelar abastecimento"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
