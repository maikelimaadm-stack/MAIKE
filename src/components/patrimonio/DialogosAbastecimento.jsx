import React, { useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { mensagemDoBloqueioAbastecimento, mensagemErroAbastecimento } from "@/lib/patrimonioErros";
import {
  UNIDADE_MEDIDOR,
  dicaDaUnidadeDoProduto,
  formatarCusto,
  formatarDiaAbastecimento,
  formatarLeitura,
  formatarLitrosCurto,
  formatarQuantidade,
  formatarQuantidadeCurta,
  quantidadeDaBaixaNaPrevia,
  ORIGEM_EXTERNO,
  ehExterno,
  rotuloDaUnidade,
  rotuloDoBem,
  snapshotDoMedidor,
  textoDoIntervaloConfiavel,
  unidadeDoAbastecimentoDoProduto,
} from "@/lib/abastecimentoRegras";
import { CODIGO_ENVIO_PENDENTE, codigoDoServidor, ehRecusaDefinitiva, ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

/** Campo de texto das janelas (motivo do cancelamento): o desenho do campo do motor Base1. */
export const CTL_DIALOGO = "b1-janela__ctl";
// Botões do motor Base1 (D-PROD-169): verde = confirmar, vermelho = ação destrutiva (como "Excluir" da barra), neutro.
export const BOTAO_PRIMARIO = "tb-btn tb-btn-green";
export const BOTAO_PERIGO = "tb-btn tb-btn-red";
export const BOTAO_SECUNDARIO = "tb-btn";

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
      // O MESMO envio ainda em processamento no servidor: pode virar gravado a qualquer momento — segue incerto.
      const processando = codigoDoServidor(erro) === "IDEMPOTENCY_IN_PROGRESS";
      repetir.current = manteve || !ehRecusaDefinitiva(erro);
      if (processando) setEstado({ fase: "incerto", consulta: mensagemErroAbastecimento(erro, fallback) });
      else if (manteve || ehResultadoIncerto(erro)) setEstado({ fase: "incerto", consulta: null });
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
    <div className="b1-janela__linha">
      <dt>{rotulo}</dt>
      <dd data-testid={testId}>
        {valor}
      </dd>
    </div>
  );
}

/**
 * Revisão (prévia SEM escrita do servidor) + confirmação do abastecimento
 * (D-PROD-162). Resumo humano: máquina, Produto, quantidade na unidade do
 * Produto, medidor, tanque cheio, data, local e a baixa do estoque (EXATAMENTE
 * a quantidade digitada, "120,0000 L" ou "80,0000 kg"; D-PROD-169: Produto em
 * SACO baixa em kg, a unidade do estoque dele). Os dados técnicos
 * (tanque, custo estimado por L/kg, saldo e lotes FIFO) ficam em "Detalhes do
 * estoque", recolhido. Sem tipo de combustível e sem fator. Com bloqueio não
 * há "Confirmar". `onConsultar` devolve o texto do resultado da consulta (ou
 * null quando achou e o diálogo fecha).
 * D-PROD-210: no posto externo (`origem` do formulário revisado, ou a do
 * plano) não há local nem baixa do estoque: a revisão mostra a origem e o valor
 * da nota (`custoExterno`, o digitado). Com contador, mostra a leitura
 * anterior, o avanço do medidor e se o intervalo é confiável, como o servidor
 * calculou (sem gravar).
 * @param {{
 *   aberto: boolean,
 *   previa: { plano: any, bloqueios: any[] } | null,
 *   origem?: string|null,
 *   custoExterno?: string|null,
 *   podeConfirmar: boolean,
 *   onFechar: () => void,
 *   onConfirmar: (arg: unknown, opcoes: { retentativa: boolean }) => Promise<unknown>,
 *   onConsultar: () => Promise<string|null>,
 * }} props
 */
export function DialogoPreviaAbastecimento({ aberto, previa, origem = null, custoExterno = null, podeConfirmar, onFechar, onConfirmar, onConsultar }) {
  const { estado, disparar, setEstado } = useEnvioAbastecimento(onConfirmar, "Não foi possível confirmar o abastecimento. Nada foi gravado.");
  const [detalhesAbertos, setDetalhesAbertos] = useState(false);
  const enviando = estado.fase === "enviando";
  const plano = previa?.plano ?? null;
  const bloqueios = Array.isArray(previa?.bloqueios) ? previa.bloqueios : [];
  const fifo = plano?.fifo ?? null;
  const fatias = Array.isArray(fifo?.fatias) ? fifo.fatias : [];
  const medidor = plano?.medidor ?? null;
  const unidade = UNIDADE_MEDIDOR[String(medidor?.tipo ?? "")] ?? "";
  // Unidade EFETIVA do estoque do Produto (L ou KG — SACO guarda em kg; null se não for nenhuma delas).
  const unidadeEstoque = unidadeDoAbastecimentoDoProduto(plano?.unidade ?? null);
  const porUnidade = rotuloDaUnidade(unidadeEstoque);
  // Dica pela unidade do PRODUTO (KG: kg, não litros; SACO: kg, não sacos); sem ela no plano, a da unidade efetiva.
  const dicaDaUnidade = dicaDaUnidadeDoProduto(plano?.produto?.unidade_principal_estoque ?? unidadeEstoque);
  // Com bloqueio de quantidade (zero, acima do teto) ou Produto fora de L/KG/SACO a quantidade não é baixa: não aparece como tal.
  const externo = origem === ORIGEM_EXTERNO || ehExterno(plano);
  const baixa = externo ? null : quantidadeDaBaixaNaPrevia(previa);
  const quantidade = plano?.quantidade ? formatarQuantidadeCurta(plano.quantidade, unidadeEstoque) : "—";
  const valorDaNota = plano?.custo_total ?? custoExterno;
  const snapshot = medidor?.leitura ? snapshotDoMedidor(plano) : null;
  let resumo = "Nada foi gravado: confira abaixo o que impede a confirmação.";
  if (externo && !bloqueios.length && plano) {
    resumo = `${rotuloDoBem(plano.bem)} · ${plano.produto?.nome ?? "Produto"} · ${quantidade}. Posto externo: sem baixa do estoque${valorDaNota ? `; nota de ${formatarCusto(valorDaNota)}` : ""}.`;
  } else if (baixa) {
    resumo = `${rotuloDoBem(plano.bem)} · ${plano.produto?.nome ?? "Produto"} · ${quantidade}. Baixa de ${formatarQuantidade(baixa, unidadeEstoque)} do estoque em ${plano.local_estoque?.nome ?? "local"}.`;
  }

  const consultar = async () => {
    const texto = await onConsultar();
    if (texto) setEstado((e) => ({ ...e, consulta: texto }));
  };

  return (
    <B1Janela
      aberto={aberto}
      onFechar={onFechar}
      podeFechar={!enviando}
      titulo="Revisar abastecimento"
      descricao={resumo}
      descricaoProps={{ "data-testid": "previa-resumo" }}
      className="b1-janela--estreita"
      testId="dialogo-previa-abastecimento"
      contentProps={{ "data-permissao-explicita": "" }}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando}>
            Voltar
          </button>
          {podeConfirmar && !bloqueios.length && plano ? (
            <button type="button" className={BOTAO_PRIMARIO} disabled={enviando} data-testid="abastecimento-confirmar" onClick={() => disparar(null)}>
              {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              {enviando ? "Confirmando…" : estado.fase === "incerto" ? "Repetir o mesmo envio" : "Confirmar abastecimento"}
            </button>
          ) : null}
        </>
      }
    >
      {dicaDaUnidade ? (
        <p role="note" className="min-w-0 break-words rounded-md border border-amber-300 bg-amber-50 p-2 text-[12px] text-amber-900" data-testid="previa-dica-kg">
          {dicaDaUnidade}
        </p>
      ) : null}
      <dl className="min-w-0" data-testid="previa-dados">
        <Linha rotulo="Máquina/Veículo" testId="previa-bem" valor={rotuloDoBem(plano?.bem) || "—"} />
        <Linha rotulo="Produto" testId="previa-produto" valor={plano?.produto?.nome ?? "—"} />
        <Linha rotulo="Quantidade" testId="previa-quantidade" valor={quantidade} />
        {medidor?.leitura ? (
          <Linha rotulo="Leitura do medidor" testId="previa-leitura" valor={`${formatarLeitura(medidor.leitura)}${unidade ? ` ${unidade}` : ""}`} />
        ) : null}
        {snapshot ? (
          <>
            <Linha rotulo="Leitura anterior" testId="previa-leitura-anterior" valor={snapshot.anterior ? `${formatarLeitura(snapshot.anterior)}${unidade ? ` ${unidade}` : ""}` : "—"} />
            <Linha rotulo="Avanço do medidor" testId="previa-medidor-delta" valor={snapshot.delta ? `${formatarLeitura(snapshot.delta)}${unidade ? ` ${unidade}` : ""}` : "—"} />
            <Linha rotulo="Intervalo confiável" testId="previa-intervalo-confiavel" valor={textoDoIntervaloConfiavel(snapshot)} />
          </>
        ) : null}
        <Linha rotulo="Completou o tanque" testId="previa-tanque-cheio" valor={plano?.tanque_cheio ? "Sim" : "Não"} />
        <Linha rotulo="Data" testId="previa-data" valor={formatarDiaAbastecimento(plano?.data_operacional)} />
        {externo ? (
          <>
            <Linha rotulo="Origem" testId="previa-origem" valor="Posto externo (sem baixa do estoque)" />
            <Linha rotulo="Valor total da nota" testId="previa-valor-nota" valor={valorDaNota ? formatarCusto(valorDaNota) : "—"} />
          </>
        ) : (
          <>
            <Linha rotulo="Sai do estoque" testId="previa-local" valor={plano?.local_estoque?.nome ?? "—"} />
            <Linha rotulo="Baixa do estoque" testId="previa-baixa" valor={baixa ? formatarQuantidade(baixa, unidadeEstoque) : "—"} />
          </>
        )}
      </dl>
      {externo ? null : (
      <div className="min-w-0">
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-1 rounded-md px-1 text-[13px] font-medium hover:bg-slate-50"
          aria-expanded={detalhesAbertos}
          onClick={() => setDetalhesAbertos((v) => !v)}
          data-testid="previa-detalhes-estoque"
        >
          {detalhesAbertos ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />} Detalhes do estoque
        </button>
        {detalhesAbertos ? (
          <div className="mt-1 min-w-0 rounded-md border border-slate-200 p-2" data-testid="previa-detalhes-conteudo">
            <dl className="min-w-0">
              <Linha
                rotulo="Tanque"
                testId="previa-tanque"
                valor={
                  plano?.tanque
                    ? `${plano.tanque.identificador ?? ""}${plano.tanque.capacidade_litros ? ` (${formatarLitrosCurto(plano.tanque.capacidade_litros)} L)` : ""}`
                    : "—"
                }
              />
              {plano?.tanque ? (
                <Linha
                  rotulo="Capacidade do tanque"
                  testId="previa-capacidade"
                  valor={
                    plano.confere_capacidade
                      ? "conferida (Produto em litros)"
                      : unidadeEstoque === "KG"
                        ? "não conferida (Produto em quilos: a capacidade é em litros)"
                        : "não conferida"
                  }
                />
              ) : null}
              <Linha
                rotulo="Custo estimado"
                testId="previa-custo"
                valor={
                  fifo?.custo_total_estimado ? (
                    <>
                      {formatarCusto(fifo.custo_total_estimado)}
                      {fifo.custo_unitario_estimado && porUnidade ? ` (${formatarCusto(fifo.custo_unitario_estimado)}/${porUnidade})` : ""}
                      <span className="block text-[11px] font-normal text-[var(--mg-text-2,#475569)]">estimativa; o custo final é calculado na confirmação</span>
                    </>
                  ) : (
                    "—"
                  )
                }
              />
              {plano?.estoque ? <Linha rotulo="Saldo no local" testId="previa-saldo" valor={formatarQuantidade(plano.estoque.saldo_local, plano.estoque.unidade)} /> : null}
            </dl>
            {fatias.length ? (
              <div className="mt-2 min-w-0 overflow-x-auto">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">Lotes consumidos (FIFO)</p>
                <table className="w-full text-[12px]" data-testid="previa-fatias">
                  <thead>
                    <tr className="text-left text-[var(--mg-text-2,#475569)]">
                      <th className="py-1 pr-2">Lote de</th>
                      <th className="py-1 pr-2 text-right">{porUnidade ? `Quantidade (${porUnidade})` : "Quantidade"}</th>
                      <th className="py-1 pr-2 text-right">{porUnidade ? `Custo/${porUnidade}` : "Custo"}</th>
                      <th className="py-1 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fatias.map((/** @type {any} */ f) => (
                      <tr key={`${f.ordem}-${f.lote_id}`} className="border-t border-slate-100">
                        <td className="py-1 pr-2">{formatarDiaAbastecimento(f.data_lote)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{formatarQuantidade(f.quantidade, null)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{formatarCusto(f.custo_unitario)}</td>
                        <td className="py-1 text-right tabular-nums">{formatarCusto(f.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      )}
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
        </div>
      ) : null}
      <AvisoEnvioAbastecimento
        estado={estado}
        objeto="o abastecimento"
        onConsultar={consultar}
        onRepetir={podeConfirmar && !bloqueios.length ? () => disparar(null) : null}
      />
    </B1Janela>
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
  // D-PROD-210: o posto externo não baixou estoque — não há o que devolver.
  const externo = ehExterno(registro);
  const textoDepois =
    !depois || depois.origem === "CADASTRO"
      ? `para a leitura do cadastro${depois?.leitura ? `, ${textoDoPonto(depois, unidade)}` : ""}`
      : `para ${textoDoPonto(depois, unidade)}`;

  const consultar = async () => {
    const texto = await onConsultar();
    if (texto) setEstado((e) => ({ ...e, consulta: texto }));
  };

  return (
    <B1Janela
      aberto={aberto}
      onFechar={onFechar}
      podeFechar={!enviando}
      titulo={`Cancelar abastecimento ${registro?.numero ? `nº ${registro.numero}` : ""}`.trim()}
      descricao={
        externo ? (
          <>
            Abastecimento no posto externo ({formatarQuantidade(registro?.quantidade, registro?.unidade)} de {registro?.produto?.nome ?? "produto"}): não houve baixa
            do estoque, então nada volta ao estoque. Ele deixa de contar no consumo e nos custos e continua no histórico como cancelado; nada é apagado.
          </>
        ) : (
          <>
            O cancelamento estorna a baixa: o estoque volta exatamente aos lotes de origem ({formatarQuantidade(registro?.quantidade, registro?.unidade)} de{" "}
            {registro?.produto?.nome ?? "produto"}). O abastecimento continua no histórico como cancelado; nada é apagado.
          </>
        )
      }
      className="b1-janela--estreita"
      testId="dialogo-cancelamento-abastecimento"
      contentProps={{ "data-permissao-explicita": "" }}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando}>
            Voltar
          </button>
          <button type="button" className={BOTAO_PERIGO} disabled={enviando || bloqueado} data-testid="cancelamento-enviar" onClick={() => disparar(motivoLimpo)}>
            {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            {enviando ? "Cancelando…" : estado.fase === "incerto" ? "Repetir o mesmo envio" : "Cancelar abastecimento"}
          </button>
        </>
      }
    >
      {efeito?.muda ? (
        <p role="status" data-testid="cancelamento-aviso-medidor" className="min-w-0 break-words rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
          A leitura operacional do medidor passará de {antes ?? "—"} {textoDepois}.
        </p>
      ) : null}
      <label className="b1-janela__rotulo">
        Motivo (obrigatório, de 3 a 500 caracteres)
        <textarea
          className={CTL_DIALOGO}
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
        <span className="min-w-0 break-words">
          {externo
            ? "Estou ciente: este abastecimento do posto externo deixa de contar no consumo e nos custos."
            : "Estou ciente: o estoque baixado volta aos lotes de origem e este abastecimento deixa de contar no consumo."}
        </span>
      </label>
      <AvisoEnvioAbastecimento estado={estado} objeto="o cancelamento" onConsultar={consultar} onRepetir={bloqueado ? null : () => disparar(motivoLimpo)} />
    </B1Janela>
  );
}
