import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { AvisoGestao, CampoTexto } from "@/components/gestao/GestaoFormParts";
import { CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import { BOTAO_PRIMARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { AvisoEnvioDaLinha, useEnvioDaLinha } from "@/components/lancamento-atividades/JanelasDaLinha";
import { useEmpresaRealSelecionadaId } from "@/hooks/useLancamentoAtividadesSessao";
import { apontamentoDeHoje } from "@/lib/cargaInsumoRegras";
import {
  apontamentosDaFrente,
  formatarHorimetro,
  marcadorDaAbertura,
  ultimoHorimetroLidoDaFrente,
} from "@/lib/aberturaServicoRegras";
import {
  JUSTIFICATIVA_MAXIMA,
  LIMITES_LINHA,
  LINHA_MAQUINA,
  campoDaLinhaRecusada,
  chaveMedidor,
  corpoDaLinhaMaquina,
  ehSaltoDoMedidor,
  formatarUso,
  formularioMaquinaVazio,
  medidorDaResposta,
  mensagemDeErroLinha,
  passaDoTeto,
  usoDaLinha,
  validarLinhaMaquina,
} from "@/lib/atividadeLinhasRegras";
import { LOCALE_ATIVIDADE } from "@/lib/lancamentoAtividadesRegras";
import { chaveApontamentos, itensDaLista, normalizarRespostaDeEscrita } from "@/lib/atividadeApontamentoRegras";
import { comparar, ehCanonico, lerNumeroLocal } from "@/lib/dinheiroDecimal";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import {
  ACAO_LANCAR_LINHA,
  adicionarLinha,
  alvoDasLinhas,
  criarApontamento,
  limparPendenciaDaLinha,
  listarApontamentos,
  obterMedidorDoBem,
} from "@/services/lancamentoAtividadesService";

/** O id do formulário: o botão "Salvar horas" fica no rodapé da janela (fora do <form>) e o referencia por `form=`. */
const ID_FORMULARIO = "formulario-maquina-frente";
/** A mensagem de falha quando as horas nem começaram (nada gravado ainda). */
const FALLBACK_LINHA = "Não foi possível lançar as horas da máquina. Nada foi gravado.";
/** O nome do contador no rótulo (Horímetro/Odômetro/Ciclos), como o Abastecimento da frente. */
const ROTULO_CONTADOR = /** @type {Record<string, string>} */ ({ HORIMETRO: "Horímetro", ODOMETRO: "Odômetro", CICLOS: "Ciclos" });
/** Dois valores canônicos iguais (sem casas a mais). @param {unknown} a @param {unknown} b */
const mesmoValor = (a, b) => ehCanonico(a) && ehCanonico(b) && comparar(/** @type {string} */ (a), /** @type {string} */ (b)) === 0;
/** De onde veio o último horímetro lido (a linha "Último horímetro lido: …"). */
const ORIGEM_DA_LEITURA = /** @type {Record<string, string>} */ ({
  vigente: "leitura do medidor",
  abertura: "abertura do serviço",
  lancamento: "último lançamento",
  encerramento: "encerramento anterior",
});

/**
 * D-PROD-365 — a opção "Máquina" do serviço, na MESMA janela (como a Carga de insumo e o Abastecimento): só as HORAS DO DIA
 * (sem abas, sem parada, sem trocar implemento, sem corrigir horímetro). Grava a linha de máquina que já existe
 * (`AtividadeApontamentoMaquina`), pelo fluxo que já existe (`adicionarLinha` com o apontamento de hoje da frente; sem ele,
 * `criarApontamento` com `maquinas[]`, atômico, como a carga faz com `produtos`). Nada de tabela nova nem de baixa.
 *
 * Tela: o cabeçalho (Máquina · "Lançar as horas do <máquina>"); o horímetro INICIAL do dia (só leitura: o MAIOR entre a
 * leitura vigente do medidor e o último horímetro lido pela frente, `ultimoHorimetroLidoDaFrente`); o FINAL (obrigatório);
 * as horas trabalhadas (final − inicial, calculadas); o Responsável (só leitura: o da frente). Máquina sem contador: um
 * campo "Horas trabalhadas" (uso > 0) com `sem_medidor`. Teto do salto: a justificativa aparece e o envio repete com ela.
 *
 * Idempotência (a mesma da carga): um `operation_id` persistente por envio (no service); "Repetir o mesmo envio" reaproveita
 * o envio; "Consultar" relê o dia e acha a linha gravada. Recusas do servidor aparecem na própria janela (sem popup).
 *
 * @param {{
 *   atividadeId: string,
 *   atividadeAreaId: string | null,
 *   filtrarPorArea?: boolean,              // a atividade tem VÁRIAS áreas: o destino é só o apontamento deste pasto
 *   onEnviando?: (enviando: boolean) => void, // as horas estão saindo (o pai trava o voltar e o fechar)
 *   itens: any[],                          // os apontamentos da ATIVIDADE inteira (a base e o encerramento leem todos)
 *   frente: { chave: string, abertura: any }, // a frente tocada (máquina + implemento) e a sua abertura
 *   hoje: string,                          // o "hoje" da fazenda (AAAA-MM-DD)
 *   podeGravar: boolean,
 *   escopo: string,
 *   alvoRodape: HTMLElement | null,        // o lugar do botão "Salvar horas" no rodapé da janela
 *   onSalvo: (resposta: any) => void,
 * }} props
 */
export default function MaquinaDaFrente({
  atividadeId,
  atividadeAreaId,
  filtrarPorArea = false,
  onEnviando = undefined,
  itens,
  frente,
  hoje,
  podeGravar,
  escopo,
  alvoRodape,
  onSalvo,
}) {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const abertura = frente.abertura;
  const bemId = String(abertura?.bemId ?? "");
  const bemNome = String(abertura?.bemNome ?? "");
  const areaDoDestino = filtrarPorArea ? atividadeAreaId : null;

  // ─── A máquina: o medidor do bem na data (tipo, unidade, leitura vigente e teto) ──────────
  const consultaMedidor = useQuery({
    queryKey: chaveMedidor(empresaId, bemId, hoje),
    queryFn: () => obterMedidorDoBem(bemId, hoje),
    enabled: Boolean(empresaId && bemId && hoje),
    staleTime: 15 * 1000,
  });
  const medidor = consultaMedidor.isSuccess ? medidorDaResposta(consultaMedidor.data) : null;
  const contador = Boolean(medidor?.contador);

  // ─── O horímetro inicial do dia: o maior entre a vigente e o último lido pela frente (só leitura) ──────────
  const ultimo = useMemo(() => ultimoHorimetroLidoDaFrente(itens, frente.chave, hoje, abertura?.horimetro ?? null), [itens, frente.chave, hoje, abertura?.horimetro]);
  const vigente = medidor?.vigente?.leitura ?? null;
  /** @type {string | null} o canônico do inicial: a maior das leituras conhecidas (nunca abaixo da vigente) */
  const inicial = useMemo(() => {
    const cands = [vigente, ultimo?.horimetro ?? null].filter((v) => typeof v === "string");
    if (!cands.length) return null;
    return cands.reduce((maior, v) => (comparar(v, maior) > 0 ? v : maior));
  }, [vigente, ultimo]);
  const origemDoInicial = ultimo && inicial === ultimo.horimetro ? ultimo.origem : "vigente";

  // ─── O formulário (a máquina e o implemento são da frente; o inicial é calculado) ──────────
  const [form, setForm] = useState(() => ({
    ...formularioMaquinaVazio(),
    bem: bemId ? { id: bemId, rotulo: bemNome } : null,
    implemento: abertura?.implementoId ? { id: String(abertura.implementoId), rotulo: String(abertura.implementoNome ?? "") } : null,
  }));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [saltoPedido, setSaltoPedido] = useState(false);
  /** A linha de máquina de hoje: o apontamento criado nesta janela (uma nova tentativa, sem a lista ter chegado, acha esse). */
  const progressoRef = useRef(/** @type {{ apontamentoId: string | null, versao: number | null }} */ ({ apontamentoId: null, versao: null }));
  /** As linhas de máquina que JÁ existiam hoje na frente (a consulta do "resultado incerto" só aceita as novas). */
  const antesRef = useRef(/** @type {Set<string> | null} */ (null));
  if (antesRef.current === null) {
    antesRef.current = new Set(
      itens
        .filter((ap) => ap?.status === "CONFIRMADO" && String(ap.data_operacional ?? "") === hoje)
        .flatMap((ap) => (Array.isArray(ap.maquinas) ? ap.maquinas : []))
        .map((l) => String(l?.id)),
    );
  }

  /** O formulário completo para validar e montar o corpo: o inicial vem do cálculo, não do que a pessoa digitou. */
  const formCompleto = { ...form, leitura_inicial: inicial ? formatarHorimetro(inicial) : "" };
  const uso = medidor ? usoDaLinha(formCompleto, medidor) : null;
  const pedeJustificativa = saltoPedido || passaDoTeto(uso, medidor?.teto ?? null);
  const finalLido = lerNumeroLocal(form.leitura_final, LOCALE_ATIVIDADE, LIMITES_LINHA);
  const finalCanonico = contador && finalLido.ok ? finalLido.valor : null;

  const { estado, setEstado, disparar, esquecerUltimo } = useEnvioDaLinha(gravarHoras, (erro) => mensagemDeErroLinha(erro, FALLBACK_LINHA, { medidorUnidade: medidor?.unidade ?? null }));
  const enviando = estado.fase === "enviando";
  // O pai trava o voltar e o fechar enquanto as horas estão saindo (senão a janela some com o envio no ar).
  useEffect(() => {
    onEnviando?.(enviando);
    return () => onEnviando?.(false);
  }, [enviando]);

  /** @param {Record<string, any>} mudanca @param {string[]} campos */
  const mudar = (mudanca, campos) => {
    setForm((f) => ({ ...f, ...mudanca }));
    setErros((e) => (campos.some((c) => e[c]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !campos.includes(k))) : e));
    esquecerUltimo();
    setEstado((e) => (e.fase === "erro" ? { fase: "pronto" } : e));
  };

  /**
   * O envio: com o apontamento CONFIRMADO de hoje da frente, `adicionarLinha` (a `versao` dele); sem ele, `criarApontamento`
   * com a linha em `maquinas[]` (um só pedido: o dia e a linha nascem juntos).
   * @param {any} arg @param {{ retentativa: boolean }} o
   */
  async function gravarHoras(arg, { retentativa }) {
    const opcoes = { escopo, retentativa };
    if (!arg.apontamentoId) {
      const resposta = /** @type {any} */ (
        await criarApontamento(
          arg.atividadeId,
          {
            data_operacional: arg.dia,
            ...(arg.atividadeAreaId ? { atividade_area_id: arg.atividadeAreaId } : {}),
            observacao: arg.observacao,
            maquinas: [arg.corpo],
          },
          opcoes,
        )
      );
      const norma = normalizarRespostaDeEscrita(resposta);
      if (norma.apontamento?.id != null) progressoRef.current = { apontamentoId: String(norma.apontamento.id), versao: norma.apontamento.versao ?? null };
      return { ...resposta, avisos: Array.isArray(resposta?.avisos) ? resposta.avisos : [] };
    }
    const resposta = /** @type {any} */ (await adicionarLinha(LINHA_MAQUINA, arg.atividadeId, { id: arg.apontamentoId, versao: arg.versao }, arg.corpo, opcoes));
    return resposta;
  }

  /** Depois de gravar (ou de confirmar pela consulta): aviso padrão, lista atualizada e volta ao serviço. @param {any} resposta */
  const concluir = async (resposta) => {
    notifySuccess("Sucesso", "Horas da máquina lançadas.");
    await queryClient.invalidateQueries({ queryKey: chaveApontamentos(empresaId, atividadeId) });
    onSalvo(normalizarRespostaDeEscrita(resposta));
  };

  /** "Salvar horas": valida, monta o corpo (o da linha de máquina) e envia. Recusa do servidor fica na janela. */
  const salvar = async () => {
    if (enviando || !podeGravar || !medidor || !inicial || !bemId) return;
    const v = validarLinhaMaquina(formCompleto, { medidor, permiteImplemento: true, pedeJustificativa });
    setErros(v);
    if (Object.keys(v).length) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    const corpo = corpoDaLinhaMaquina(formCompleto, medidor, { comJustificativa: pedeJustificativa });
    const p = progressoRef.current;
    const apontamentoDia = p.apontamentoId ? null : apontamentoDeHoje(apontamentosDaFrente(itens, frente.chave), hoje, areaDoDestino);
    const arg = {
      atividadeId: String(atividadeId),
      atividadeAreaId,
      dia: hoje,
      observacao: marcadorDaAbertura(abertura),
      corpo,
      apontamentoId: p.apontamentoId ?? (apontamentoDia?.id != null ? String(apontamentoDia.id) : null),
      versao: p.apontamentoId ? p.versao : (apontamentoDia?.versao ?? null),
    };
    const r = await disparar(arg);
    if (!r) return;
    if (r.ok) {
      await concluir(r.resposta);
      return;
    }
    // O salto pede a justificativa (o campo aparece); a frase da recusa fica no aviso da janela, não repetida no campo.
    if (ehSaltoDoMedidor(r.erro)) {
      setSaltoPedido(true);
      return;
    }
    const campo = campoDaLinhaRecusada(r.erro);
    if (campo) setErros((e) => ({ ...e, [campo]: mensagemDeErroLinha(r.erro, FALLBACK_LINHA, { medidorUnidade: medidor.unidade }) }));
  };

  /** "Consultar" depois de um envio sem resposta: uma linha NOVA de máquina, desta máquina, com as mesmas leituras, conta como gravada. */
  const consultar = async () => {
    try {
      const lista = itensDaLista(await listarApontamentos(atividadeId));
      const ap = apontamentoDeHoje(apontamentosDaFrente(lista, frente.chave), hoje, areaDoDestino);
      // A linha nova, desta máquina, com o MESMO valor que foi enviado (o uso sem medidor; as leituras com contador).
      const gravou = (ap?.maquinas ?? []).some(
        (/** @type {any} */ l) =>
          l?.status === "CONFIRMADO" &&
          !antesRef.current?.has(String(l.id)) &&
          String(l.bem_id ?? "") === bemId &&
          (contador
            ? mesmoValor(l.leitura_inicial, inicial) && mesmoValor(l.leitura_final, finalCanonico)
            : mesmoValor(l.quantidade_uso, uso)),
      );
      if (ap && gravou) {
        progressoRef.current = { apontamentoId: String(ap.id), versao: ap.versao ?? progressoRef.current.versao };
        limparPendenciaDaLinha(escopo, ACAO_LANCAR_LINHA, alvoDasLinhas(LINHA_MAQUINA, String(ap.id)));
        notifySuccess("Gravado", "O envio anterior das horas foi gravado.");
        await concluir({ apontamento: ap, atividade: null, avisos: [] });
        return;
      }
      setEstado((e) => ({ ...e, consulta: "O envio ainda não aparece gravado. Repita o mesmo envio: ele não será duplicado." }));
    } catch {
      setEstado((e) => ({ ...e, consulta: "Não foi possível consultar agora. Tente de novo." }));
    }
  };

  const pronto = Boolean(medidor && inicial && bemId);
  const bloqueado = enviando;
  const rotuloContador = ROTULO_CONTADOR[String(medidor?.tipo ?? "")] ?? "Horímetro";
  const unidade = medidor?.unidade ?? "";
  const textoHoras = uso ? `${formatarUso(uso, medidor?.tipo, unidade)}${finalCanonico && inicial ? ` (${formatarHorimetro(finalCanonico)} - ${formatarHorimetro(inicial)})` : ""}` : "—";

  const formulario = (
    <form
      id={ID_FORMULARIO}
      className="grid grid-cols-12 gap-3 b1-form-embutido b1-realizacao__abertura"
      data-densidade={DENSIDADE_BASE1}
      noValidate
      data-testid="maquina-form"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      <div className="col-span-12 b1-carga-cab" data-testid="maquina-cabecalho">
        <strong>Máquina</strong>
        <span>{`Lançar as horas do ${bemNome}`}</span>
      </div>

      {contador ? (
        <>
          <CampoTexto label={`${rotuloContador} inicial do dia`} value={inicial ? formatarHorimetro(inicial) : ""} onChange={() => {}} readOnly required span={12} testId="maquina-horimetro-inicial" />
          <p className="b1-carga-nota col-span-12" data-testid="maquina-ultima-leitura">
            {`Último ${rotuloContador.toLowerCase()} lido: ${inicial ? formatarHorimetro(inicial) : "—"}${inicial ? ` (${ORIGEM_DA_LEITURA[origemDoInicial] ?? "abertura do serviço"})` : ""}`}
          </p>
          <CampoNumero
            label={`${rotuloContador} final do dia`}
            value={form.leitura_final}
            onChange={(v) => mudar({ leitura_final: v }, ["leitura_final", "justificativa_salto"])}
            locale={LOCALE_ATIVIDADE}
            limites={LIMITES_LINHA}
            required
            span={12}
            readOnly={bloqueado}
            error={erros.leitura_final}
            testId="maquina-horimetro-final"
          />
          <p className="b1-carga-nota col-span-12" data-testid="maquina-horas">
            {`Horas trabalhadas: ${textoHoras}`}
          </p>
        </>
      ) : (
        <>
          <p className="b1-carga-nota col-span-12" data-testid="maquina-sem-medidor">
            Esta máquina não tem contador: informe as horas trabalhadas no dia.
          </p>
          <CampoNumero
            label="Horas trabalhadas"
            value={form.quantidade_uso}
            onChange={(v) => mudar({ quantidade_uso: v }, ["quantidade_uso", "justificativa_salto"])}
            locale={LOCALE_ATIVIDADE}
            limites={LIMITES_LINHA}
            required
            span={12}
            readOnly={bloqueado}
            error={erros.quantidade_uso}
            testId="maquina-horas-uso"
          />
        </>
      )}

      {pedeJustificativa ? (
        <>
          <div className="col-span-12">
            <AvisoGestao testId="maquina-salto">
              {`O uso${uso ? ` (${formatarUso(uso, medidor?.tipo, unidade)})` : ""} passa do teto de salto do medidor${
                medidor?.teto ? ` (${formatarUso(medidor.teto, medidor?.tipo, unidade)})` : ""
              }. Confira as leituras; se estiverem certas, justifique — o lançamento é aceito com a justificativa.`}
            </AvisoGestao>
          </div>
          <CampoTexto
            label="Justificativa do salto"
            value={form.justificativa_salto}
            onChange={(v) => mudar({ justificativa_salto: v }, ["justificativa_salto"])}
            readOnly={bloqueado}
            required
            span={12}
            maxLength={JUSTIFICATIVA_MAXIMA}
            keepCase
            error={erros.justificativa_salto}
            testId="maquina-justificativa"
          />
        </>
      ) : null}

      {/* Só leitura: a máquina e o responsável vêm da frente (não há campo de operador nesta tela). */}
      <CampoTexto label="Responsável" value={String(abertura?.responsavelNome ?? "")} onChange={() => {}} readOnly span={12} testId="maquina-responsavel" />

      <div className="col-span-12 min-w-0">
        <AvisoEnvioDaLinha estado={estado} produto={false} onRepetir={() => void salvar()} onConsultar={() => void consultar()} />
      </div>
    </form>
  );

  // Antes da máquina do servidor: a leitura (ou o aviso de falha, com nova tentativa); o formulário não aparece ainda.
  const carregando = (
    <div className="b1-realizacao__passo" data-testid="maquina-carregando">
      {consultaMedidor.isError ? (
        <AvisoGestao testId="maquina-medidor-erro">
          Não foi possível ler a máquina desta frente.{" "}
          <button type="button" className="underline" onClick={() => consultaMedidor.refetch()}>
            Tentar novamente
          </button>
        </AvisoGestao>
      ) : (
        <p role="status" className="b1-realizacao__ajuda">
          Carregando a máquina…
        </p>
      )}
    </div>
  );

  return (
    <>
      {pronto ? formulario : carregando}
      {alvoRodape
        ? createPortal(
            <button type="submit" form={ID_FORMULARIO} className={`${BOTAO_PRIMARIO} b1-aberto-rodape-unico`} disabled={enviando || !podeGravar || !pronto} data-testid="maquina-salvar">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              {enviando ? "Salvando…" : "Salvar horas"}
            </button>,
            alvoRodape,
          )
        : null}
    </>
  );
}
