import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { MobileSheetPortalCtx } from "@/components/common/MobileSheet";
import { AvisoGestao, CampoSelect, CampoTexto } from "@/components/gestao/GestaoFormParts";
import { CampoNumero, EscolhaSegmentada, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import { AvisoEnvioAbastecimento, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { useEmpresaRealSelecionadaId } from "@/hooks/useLancamentoAtividadesSessao";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { rotuloDaUnidade, rotuloDoBem } from "@/lib/abastecimentoRegras";
import { somar } from "@/lib/dinheiroDecimal";
import { LOCALE_ATIVIDADE, STATUS_CANCELADO, STATUS_CONFIRMADO, formatarDiaAtividade } from "@/lib/lancamentoAtividadesRegras";
import { RAIZ_CONSULTAS_ATIVIDADES, normalizarPaginaDeOpcoes, normalizarRespostaDeEscrita, pedeReleitura } from "@/lib/atividadeApontamentoRegras";
import {
  JUSTIFICATIVA_MAXIMA,
  LIMITES_LINHA,
  LINHA_MAO_OBRA,
  LINHA_MAQUINA,
  LINHA_PRODUTO,
  LINHA_SERVICO,
  MAX_DOCUMENTO_SERVICO,
  MAX_OBSERVACAO_LINHA,
  MEDIDAS_MAO_OBRA,
  ROTULO_MEDIDA,
  ROTULO_TIPO_FUNCIONARIO,
  bemEscolhido,
  camposAlteradosDaLinha,
  camposAlteradosDaLinhaMaoObra,
  campoDaLinhaRecusada,
  corpoDaLinhaMaoObra,
  corpoDaLinhaServico,
  custoDaLinhaMaoObra,
  custoDigitado,
  custoMantidoDaLinha,
  ehSemAlteracaoDaLinha,
  formatarCustoLinha,
  formularioDaLinhaMaoObra,
  formularioDaLinhaServico,
  formularioMaoObraVazio,
  formularioServicoVazio,
  funcionarioEscolhido,
  linhasDoTipo,
  medidaSugerida,
  mudancaDoServicoEscolhido,
  parceiroEscolhido,
  rotuloDoFuncionarioDaLinha,
  rotuloDoServicoDaLinha,
  siglaDaUnidade,
  unidadeDaMedida,
  validarLinhaMaoObra,
  validarLinhaServico,
  valorDaLinhaServico,
  chaveLocaisDoProduto,
  chaveMedidor,
  corpoDaLinhaMaquina,
  corpoDaLinhaProduto,
  doseHa,
  ehSaltoDoMedidor,
  formatarDecimalLinha,
  formatarDose,
  formatarUso,
  formularioDaLinhaMaquina,
  formularioDaLinhaProduto,
  formularioMaquinaVazio,
  formularioProdutoVazio,
  linhasDoApontamento,
  medidorDaResposta,
  mensagemDeErroLinha,
  passaDoTeto,
  produtoEscolhido,
  rotuloDoMedidor,
  rotuloDoProdutoDaLinha,
  textoDaLeituraVigente,
  unidadeDoProduto,
  usaSemMedidor,
  usoDaLinha,
  validarLinhaMaquina,
  validarLinhaProduto,
} from "@/lib/atividadeLinhasRegras";
import {
  ACAO_EDITAR_LINHA,
  ACAO_LANCAR_LINHA,
  adicionarLinha,
  alvoDaLinha,
  alvoDasLinhas,
  editarLinha,
  limparPendenciaDaLinha,
  listarLocaisDoProduto,
  listarOpcoesBens,
  listarOpcoesFuncionarios,
  listarOpcoesImplementos,
  listarOpcoesParceirosServico,
  listarOpcoesProdutos,
  listarOpcoesServicos,
  obterApontamento,
  obterMedidorDoBem,
} from "@/services/lancamentoAtividadesService";
import { CODIGO_ENVIO_PENDENTE, codigoDoServidor, ehRecusaDefinitiva, ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

/** Texto auxiliar (o tom das notas dos formulários do motor). */
const NOTA = "col-span-12 min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";

/** @param {{ texto: string|undefined, testId?: string }} props */
function ErroDoCampo({ texto, testId = undefined }) {
  return texto ? (
    <p className="col-span-12 -mt-1 text-[12px] text-red-700" data-testid={testId}>
      {texto}
    </p>
  ) : null;
}

// ─── Envio (um por vez; incerto = repetir o MESMO corpo com a MESMA chave) ─

/**
 * @typedef {{ fase: 'pronto'|'enviando'|'incerto'|'erro', mensagem?: string, consulta?: string|null }} EstadoEnvioLinha
 * @typedef {{ ok: boolean, resposta?: any, erro?: unknown }} ResultadoEnvio
 */

/**
 * Estado do envio da linha — o do abastecimento (`useEnvioAbastecimento`) com as mensagens da linha. "incerto" = sem
 * resposta definitiva: NUNCA vira sucesso; o próximo clique é a RETENTATIVA e reenvia exatamente o corpo daquele envio
 * (mesma `versao`, mesmo conteúdo), que a pendência casa com a MESMA `operation_id` — o servidor devolve o gravado.
 * Mexer na janela depois disso esquece o corpo guardado: o envio novo pergunta antes de abandonar o anterior.
 * @template T
 * @param {(arg: T, opcoes: { retentativa: boolean }) => Promise<any>} enviar
 * @param {(erro: unknown) => string} mensagemDe
 */
export function useEnvioDaLinha(enviar, mensagemDe) {
  const [estado, setEstado] = useState(/** @type {EstadoEnvioLinha} */ ({ fase: "pronto" }));
  const emCurso = useRef(false);
  const repetir = useRef(false);
  const ultimo = useRef(/** @type {T | null} */ (null));
  /** @param {T} arg @returns {Promise<ResultadoEnvio | null>} */
  const disparar = async (arg) => {
    if (emCurso.current) return null;
    emCurso.current = true;
    const aEnviar = repetir.current && ultimo.current !== null ? ultimo.current : arg;
    ultimo.current = aEnviar;
    setEstado({ fase: "enviando" });
    try {
      const resposta = await enviar(aEnviar, { retentativa: repetir.current });
      repetir.current = false;
      ultimo.current = null;
      setEstado({ fase: "pronto" });
      return { ok: true, resposta };
    } catch (erro) {
      // "Manter" o envio anterior sem resposta: nada saiu agora; aquele envio continua incerto.
      const manteve = /** @type {any} */ (erro)?.code === CODIGO_ENVIO_PENDENTE;
      // O MESMO envio ainda em processamento no servidor: pode virar gravado a qualquer momento — segue incerto.
      const processando = codigoDoServidor(erro) === "IDEMPOTENCY_IN_PROGRESS";
      repetir.current = manteve || !ehRecusaDefinitiva(erro);
      if (!repetir.current) ultimo.current = null;
      if (processando) setEstado({ fase: "incerto", consulta: mensagemDe(erro) });
      else if (manteve || ehResultadoIncerto(erro)) setEstado({ fase: "incerto", consulta: null });
      else setEstado({ fase: "erro", mensagem: mensagemDe(erro) });
      return { ok: false, erro };
    } finally {
      emCurso.current = false;
    }
  };
  /** A pessoa mexeu na janela: o próximo envio é o conteúdo NOVO (a pendência pergunta antes de descartar a anterior). */
  const esquecerUltimo = () => {
    ultimo.current = null;
  };
  return { estado, setEstado, disparar, esquecerUltimo };
}

/**
 * Aviso do envio da linha: o do abastecimento para produto (mexe no estoque) e o mesmo bloco, sem estoque, para
 * máquina, mão de obra e serviço (`lancado`: "a máquina PODE ter sido lançada").
 * @param {{ estado: EstadoEnvioLinha, produto: boolean, onRepetir: () => void, onConsultar: () => void, lancado?: string }} props
 */
export function AvisoEnvioDaLinha({ estado, produto, onRepetir, onConsultar, lancado = "a máquina PODE ter sido lançada" }) {
  if (produto || estado.fase !== "incerto") return <AvisoEnvioAbastecimento estado={estado} objeto="o produto" onRepetir={onRepetir} onConsultar={onConsultar} />;
  return (
    <div role="alert" data-testid="resultado-incerto" className="min-w-0 rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle size={16} aria-hidden /> Resultado incerto — consulte antes de repetir
      </p>
      <p className="mt-1 break-words">
        Não recebemos a resposta do servidor: {lancado}. Consulte antes. Se repetir, o MESMO envio é reaproveitado e a linha não é
        lançada duas vezes.
      </p>
      {estado.consulta ? (
        <p className="mt-1 break-words font-medium" data-testid="consulta-resultado">
          {estado.consulta}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={BOTAO_SECUNDARIO} onClick={onConsultar} data-testid="botao-consultar-resultado">
          Consultar
        </button>
        <button type="button" className={BOTAO_SECUNDARIO} onClick={onRepetir} data-testid="botao-repetir-envio">
          Repetir o mesmo envio
        </button>
      </div>
    </div>
  );
}

// ─── Campos da linha de PRODUTO (janela e "Repetir") ─────────────────────

/** @param {any} o */
const detalheDoProduto = (o) => {
  const unidade = rotuloDaUnidade(o?.unidade_principal_estoque);
  const favorito = o?.favorito === true || o?.usado_na_atividade === true || o?.ja_usado === true;
  return [unidade, favorito ? "já usado nesta atividade" : ""].filter(Boolean).join(" · ") || null;
};

/**
 * Saldo do produto escolhido: os locais com saldo (o único vem escolhido; o que sumiu da lista sai do formulário) e o
 * disponível para conferir — na edição, o disponível do local + a quantidade que a própria linha já baixou (o
 * servidor estorna antes de baixar de novo).
 * @param {string|null} empresaId
 * @param {import("@/lib/atividadeLinhasRegras").FormularioLinhaProduto} form
 * @param {(f: (atual: any) => any) => void} setForm
 * @param {any} [original] a linha gravada (edição)
 */
export function useSaldoDoProduto(empresaId, form, setForm, original = null) {
  const produtoId = form.produto?.id ?? null;
  const unidade = unidadeDoProduto(form.produto);
  const consulta = useQuery({
    queryKey: chaveLocaisDoProduto(empresaId, produtoId),
    queryFn: () => listarLocaisDoProduto(produtoId),
    enabled: Boolean(empresaId && produtoId && unidade),
    staleTime: 15 * 1000,
  });
  const locais = /** @type {any[]} */ (Array.isArray(consulta.data?.itens) ? consulta.data.itens : []);
  // Na edição, o local da própria linha continua oferecido mesmo sem saldo sobrando (a quantidade dela volta).
  const daLinha =
    original?.status === STATUS_CONFIRMADO && original?.local_estoque_id && String(original.produto_id) === String(produtoId ?? "")
      ? { local_estoque_id: String(original.local_estoque_id), local_nome: original?.local_estoque?.nome ?? original?.local_nome ?? "", disponivel: "0" }
      : null;
  const todos = daLinha && !locais.some((l) => String(l.local_estoque_id) === daLinha.local_estoque_id) ? [...locais, daLinha] : locais;
  const escolhido = todos.find((l) => String(l.local_estoque_id) === String(form.local_estoque_id ?? "")) ?? null;
  let disponivel = escolhido && typeof escolhido.disponivel === "string" ? escolhido.disponivel : null;
  if (disponivel && daLinha && escolhido && String(escolhido.local_estoque_id) === daLinha.local_estoque_id && typeof original?.quantidade === "string") {
    try {
      disponivel = somar([disponivel, original.quantidade], 4);
    } catch {
      /* fica o disponível do local */
    }
  }

  useEffect(() => {
    if (!produtoId || !consulta.isSuccess) return;
    const atual = form.local_estoque_id ? String(form.local_estoque_id) : null;
    if (atual && !todos.some((l) => String(l.local_estoque_id) === atual)) {
      setForm((f) => (f.produto?.id === produtoId && f.local_estoque_id === atual ? { ...f, local_estoque_id: null } : f));
      return;
    }
    if (!atual && todos.length === 1) {
      const local = String(todos[0].local_estoque_id);
      setForm((f) => (f.produto?.id === produtoId && !f.local_estoque_id ? { ...f, local_estoque_id: local } : f));
    }
  }, [produtoId, form.local_estoque_id, consulta.isSuccess, todos.length]);

  return { consulta, locais: todos, escolhido, disponivel, unidade };
}

/**
 * Campos da linha de produto: produto (favoritos da atividade no topo) → local com o saldo → quantidade na unidade
 * do produto (nunca digitada) → dose/ha calculada (só leitura) → observação.
 * @param {{
 *   form: import("@/lib/atividadeLinhasRegras").FormularioLinhaProduto,
 *   mudar: (mudanca: Record<string, any>, campos: string[]) => void,
 *   erros: Record<string, string>,
 *   aviso: string|null,
 *   saldo: ReturnType<typeof useSaldoDoProduto>,
 *   atividadeId: string,
 *   areaDoDia: string|null,
 *   bloqueado: boolean,
 *   prefixo: string,
 *   comObservacao?: boolean,
 * }} props
 */
export function CamposDaLinhaProduto({ form, mudar, erros, aviso, saldo, atividadeId, areaDoDia, bloqueado, prefixo, comObservacao = true }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const { consulta, locais, escolhido, unidade } = saldo;
  const quantidade = (() => {
    const t = String(form.quantidade ?? "").trim();
    if (!t) return null;
    const corpo = corpoDaLinhaProduto(form);
    return corpo.quantidade;
  })();
  const dose = doseHa(quantidade, areaDoDia);
  const rotuloUnidade = rotuloDaUnidade(unidade);

  let blocoLocal = null;
  if (form.produto?.id && unidade) {
    if (consulta.isError) {
      blocoLocal = (
        <div className="col-span-12">
          <AvisoGestao testId={`${prefixo}-locais-erro`}>
            Não foi possível ler o saldo deste produto. O lançamento confere de novo.{" "}
            <button type="button" className="underline" onClick={() => consulta.refetch()}>
              Tentar novamente
            </button>
          </AvisoGestao>
        </div>
      );
    } else if (consulta.isLoading) {
      blocoLocal = (
        <p role="status" className={NOTA}>
          Conferindo o saldo deste produto…
        </p>
      );
    } else if (!locais.length) {
      blocoLocal = (
        <div className="col-span-12">
          <AvisoGestao testId={`${prefixo}-sem-saldo`}>Sem saldo deste produto nesta fazenda: dê entrada no estoque antes de lançar.</AvisoGestao>
        </div>
      );
    } else {
      blocoLocal = (
        <>
          <CampoSelect
            label="Local do estoque"
            value={form.local_estoque_id ?? ""}
            onChange={(v) => mudar({ local_estoque_id: v || null }, ["local_estoque_id", "quantidade"])}
            options={locais.map((l) => ({ value: String(l.local_estoque_id), label: `${String(l.local_nome ?? "")} (disponível ${formatarDecimalLinha(l.disponivel) || "0"}${rotuloUnidade ? ` ${rotuloUnidade}` : ""})` }))}
            placeholder="— Escolha o local —"
            readOnly={bloqueado}
            required
            span={12}
            error={erros.local_estoque_id}
          />
          {escolhido ? (
            <p className={NOTA} data-testid={`${prefixo}-disponivel`}>
              Disponível neste local: {formatarDecimalLinha(escolhido.disponivel) || "0"}
              {rotuloUnidade ? ` ${rotuloUnidade}` : ""}
            </p>
          ) : null}
        </>
      );
    }
  }

  return (
    <>
      <SeletorPaginadoGestao
        rotulo="Produto"
        testId={`${prefixo}-produto`}
        chave={[RAIZ_CONSULTAS_ATIVIDADES, "produtos", empresaId, atividadeId]}
        buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesProdutos(atividadeId, { q, cursor, limit }))}
        value={form.produto ? { id: form.produto.id, rotulo: form.produto.rotulo } : null}
        onChange={(o) => mudar({ produto: produtoEscolhido(o), local_estoque_id: null }, ["produto", "local_estoque_id", "quantidade"])}
        rotuloDaOpcao={(o) => String(o?.nome ?? "")}
        detalheDaOpcao={detalheDoProduto}
        readOnly={bloqueado}
        obrigatorio
        erro={erros.produto}
        span={12}
        maiusculas={false}
      />
      {blocoLocal}
      <CampoNumero
        label={rotuloUnidade ? `Quantidade (${rotuloUnidade})` : "Quantidade"}
        value={form.quantidade}
        onChange={(v) => mudar({ quantidade: v }, ["quantidade"])}
        locale={LOCALE_ATIVIDADE}
        limites={LIMITES_LINHA}
        readOnly={bloqueado}
        required
        span={6}
        error={erros.quantidade}
        testId={`${prefixo}-quantidade`}
      />
      <ValorCalculado
        label="Dose/ha (quantidade ÷ área do dia)"
        valor={dose ? formatarDose(dose, unidade) : areaDoDia ? "—" : "Sem área do dia"}
        span={6}
        testId={`${prefixo}-dose`}
      />
      {aviso ? (
        <div className="col-span-12">
          <AvisoGestao testId={`${prefixo}-saldo-insuficiente`}>{aviso}</AvisoGestao>
        </div>
      ) : null}
      {comObservacao ? (
        <CampoTextoLongo label="Observação" value={form.observacao} onChange={(v) => mudar({ observacao: v }, ["observacao"])} readOnly={bloqueado} maxLength={MAX_OBSERVACAO_LINHA} />
      ) : null}
    </>
  );
}

// ─── Campos da linha de MÁQUINA (janela e "Repetir") ─────────────────────

/**
 * Medidor do bem escolhido na data do apontamento (tipo e unidade do bem, leitura vigente, teto). A leitura inicial
 * VAZIA é sugerida pela vigente até a pessoa mexer nela; trocar de bem limpa as leituras.
 * @param {string|null} empresaId
 * @param {import("@/lib/atividadeLinhasRegras").FormularioLinhaMaquina} form
 * @param {(f: (atual: any) => any) => void} setForm
 * @param {string|null} dia
 * @param {boolean} [leituraJaInformada] edição: a leitura gravada vale e não é sugerida de novo
 */
export function useMedidorDaLinha(empresaId, form, setForm, dia, leituraJaInformada = false) {
  const bemId = form.bem?.id ?? null;
  const consulta = useQuery({
    queryKey: chaveMedidor(empresaId, bemId, dia),
    queryFn: () => obterMedidorDoBem(bemId, dia),
    enabled: Boolean(empresaId && bemId),
    staleTime: 15 * 1000,
  });
  const medidor = consulta.isSuccess ? medidorDaResposta(consulta.data) : null;
  const sugerida = useRef(leituraJaInformada);
  const bemAnterior = useRef(bemId);
  useEffect(() => {
    if (bemAnterior.current === bemId) return;
    bemAnterior.current = bemId;
    sugerida.current = false;
  }, [bemId]);
  const vigente = medidor?.vigente?.leitura ?? null;
  useEffect(() => {
    if (sugerida.current || !medidor || !medidor.contador || !vigente) return;
    sugerida.current = true;
    setForm((f) => (f.bem?.id === bemId && !String(f.leitura_inicial ?? "").trim() ? { ...f, leitura_inicial: formatarDecimalLinha(vigente) } : f));
  }, [bemId, vigente, medidor?.contador]);
  return { consulta, medidor };
}

/**
 * Campos da linha de máquina: máquina → implemento (se o tipo permitir) → medidor do bem (só leitura) → leitura
 * inicial sugerida, final obrigatória e uso calculado, ou "sem medidor" com o uso direto → justificativa quando o uso
 * passa do teto (ou o servidor pedir) → observação.
 * @param {{
 *   form: import("@/lib/atividadeLinhasRegras").FormularioLinhaMaquina,
 *   mudar: (mudanca: Record<string, any>, campos: string[]) => void,
 *   erros: Record<string, string>,
 *   medidorDaLinha: ReturnType<typeof useMedidorDaLinha>,
 *   permiteImplemento: boolean,
 *   pedeJustificativa: boolean,
 *   bloqueado: boolean,
 *   prefixo: string,
 *   comObservacao?: boolean,
 * }} props
 */
export function CamposDaLinhaMaquina({ form, mudar, erros, medidorDaLinha, permiteImplemento, pedeJustificativa, bloqueado, prefixo, comObservacao = true }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const { consulta, medidor } = medidorDaLinha;
  const unidade = medidor?.unidade ?? "";
  const semMedidor = medidor ? usaSemMedidor(form, medidor) : false;
  const uso = medidor ? usoDaLinha(form, medidor) : null;

  let blocoMedidor = null;
  if (form.bem?.id) {
    if (consulta.isError) {
      blocoMedidor = (
        <div className="col-span-12">
          <AvisoGestao testId={`${prefixo}-medidor-erro`}>
            Não foi possível ler o medidor deste bem.{" "}
            <button type="button" className="underline" onClick={() => consulta.refetch()}>
              Tentar novamente
            </button>
          </AvisoGestao>
        </div>
      );
    } else if (!medidor) {
      blocoMedidor = (
        <p role="status" className={NOTA} data-testid={`${prefixo}-medidor-carregando`}>
          Lendo o medidor deste bem…
        </p>
      );
    } else {
      blocoMedidor = (
        <>
          <ValorCalculado label="Medidor (do cadastro do bem)" valor={rotuloDoMedidor(medidor.tipo)} span={6} testId={`${prefixo}-medidor`} />
          <ValorCalculado label="Uso" valor={uso ? formatarUso(uso, medidor.tipo, unidade) : "—"} span={6} testId={`${prefixo}-uso`} />
          {medidor.contador ? (
            <>
              <p className={NOTA} data-testid={`${prefixo}-leitura-vigente`}>
                {textoDaLeituraVigente(medidor)}
              </p>
              <EscolhaSegmentada
                rotulo="Como informar o uso"
                testId={`${prefixo}-modo-medidor`}
                value={form.sem_medidor ? "sem" : "leitura"}
                onChange={(v) => mudar({ sem_medidor: v === "sem" }, ["leitura_inicial", "leitura_final", "quantidade_uso"])}
                readOnly={bloqueado}
                opcoes={[
                  { value: "leitura", label: "Pela leitura do medidor" },
                  { value: "sem", label: `Sem medidor (informar ${unidade || "o uso"})` },
                ]}
              />
            </>
          ) : (
            <p className={NOTA} data-testid={`${prefixo}-sem-medidor-no-bem`}>
              Este bem não tem medidor que conte: informe o uso direto.
            </p>
          )}
          {semMedidor ? (
            <CampoNumero
              label={unidade ? `Uso (${unidade})` : "Uso (horas ou km)"}
              value={form.quantidade_uso}
              onChange={(v) => mudar({ quantidade_uso: v }, ["quantidade_uso", "justificativa_salto"])}
              locale={LOCALE_ATIVIDADE}
              limites={LIMITES_LINHA}
              readOnly={bloqueado}
              required
              span={6}
              error={erros.quantidade_uso}
              testId={`${prefixo}-quantidade-uso`}
            />
          ) : (
            <>
              <CampoNumero
                label={`Leitura inicial${unidade ? ` (${unidade})` : ""}`}
                value={form.leitura_inicial}
                onChange={(v) => mudar({ leitura_inicial: v }, ["leitura_inicial", "leitura_final", "justificativa_salto"])}
                locale={LOCALE_ATIVIDADE}
                limites={LIMITES_LINHA}
                readOnly={bloqueado}
                required
                span={6}
                error={erros.leitura_inicial}
                testId={`${prefixo}-leitura-inicial`}
              />
              <CampoNumero
                label={`Leitura final${unidade ? ` (${unidade})` : ""}`}
                value={form.leitura_final}
                onChange={(v) => mudar({ leitura_final: v }, ["leitura_final", "justificativa_salto"])}
                locale={LOCALE_ATIVIDADE}
                limites={LIMITES_LINHA}
                readOnly={bloqueado}
                required
                span={6}
                error={erros.leitura_final}
                testId={`${prefixo}-leitura-final`}
              />
            </>
          )}
          {pedeJustificativa ? (
            <>
              <div className="col-span-12">
                <AvisoGestao testId={`${prefixo}-salto`}>
                  O uso{uso ? ` (${formatarUso(uso, medidor.tipo, unidade)})` : ""} passa do teto de salto do medidor
                  {medidor.teto ? ` (${formatarUso(medidor.teto, medidor.tipo, unidade)})` : ""}. Confira as leituras; se estiverem certas, justifique — o lançamento é aceito com a justificativa.
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
              />
            </>
          ) : null}
        </>
      );
    }
  }

  return (
    <>
      <SeletorPaginadoGestao
        rotulo="Máquina"
        testId={`${prefixo}-bem`}
        chave={[RAIZ_CONSULTAS_ATIVIDADES, "bens", empresaId]}
        buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesBens({ q, cursor, limit }))}
        value={form.bem}
        onChange={(o) =>
          mudar({ bem: bemEscolhido(o), leitura_inicial: "", leitura_final: "", quantidade_uso: "", sem_medidor: false, justificativa_salto: "" }, [
            "bem",
            "implemento",
            "leitura_inicial",
            "leitura_final",
            "quantidade_uso",
            "justificativa_salto",
          ])
        }
        rotuloDaOpcao={rotuloDoBem}
        readOnly={bloqueado}
        obrigatorio
        erro={erros.bem}
        span={permiteImplemento ? 6 : 12}
        maiusculas={false}
      />
      {permiteImplemento ? (
        <SeletorPaginadoGestao
          rotulo="Implemento"
          testId={`${prefixo}-implemento`}
          chave={[RAIZ_CONSULTAS_ATIVIDADES, "implementos", empresaId]}
          buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesImplementos({ q, cursor, limit }))}
          value={form.implemento}
          onChange={(o) => mudar({ implemento: bemEscolhido(o) }, ["implemento"])}
          rotuloDaOpcao={rotuloDoBem}
          readOnly={bloqueado}
          permitirLimpar
          erro={erros.implemento}
          span={6}
          maiusculas={false}
        />
      ) : (
        <ErroDoCampo texto={erros.implemento} />
      )}
      {blocoMedidor}
      {comObservacao ? (
        <CampoTextoLongo label="Observação" value={form.observacao} onChange={(v) => mudar({ observacao: v }, ["observacao"])} readOnly={bloqueado} maxLength={MAX_OBSERVACAO_LINHA} />
      ) : null}
    </>
  );
}

// ─── Campos da linha de MÃO DE OBRA (janela e "Repetir") ─────────────────

/** @param {any} o */
const detalheDoFuncionario = (o) => [typeof o?.cargo === "string" ? o.cargo : "", ROTULO_TIPO_FUNCIONARIO[String(o?.tipo ?? "")] ?? ""].filter(Boolean).join(" · ") || null;

/**
 * Campos da linha de mão de obra: funcionário → medida (sugerida pelo tipo do funcionário) → quantidade → custo
 * unitário (hora/diária: do cadastro, só leitura; tarefa: digitado) → total calculado → observação.
 * @param {{
 *   form: import("@/lib/atividadeLinhasRegras").FormularioLinhaMaoObra,
 *   mudar: (mudanca: Record<string, any>, campos: string[]) => void,
 *   erros: Record<string, string>,
 *   bloqueado: boolean,
 *   prefixo: string,
 *   comObservacao?: boolean,
 * }} props
 */
export function CamposDaLinhaMaoObra({ form, mudar, erros, bloqueado, prefixo, comObservacao = true }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const medida = form.tipo_medida;
  const unidade = unidadeDaMedida(medida);
  const { unitario, total } = custoDaLinhaMaoObra(form);
  const digitado = custoDigitado(medida);
  // Edição com o mesmo funcionário e a mesma medida: o custo é o GRAVADO na linha (o servidor o mantém).
  const mantido = custoMantidoDaLinha(form);
  const deOnde = mantido ? "gravado na linha" : "do cadastro";
  return (
    <>
      <SeletorPaginadoGestao
        rotulo="Funcionário"
        testId={`${prefixo}-funcionario`}
        chave={[RAIZ_CONSULTAS_ATIVIDADES, "funcionarios", empresaId]}
        buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesFuncionarios({ q, cursor, limit }))}
        value={form.funcionario ? { id: form.funcionario.id, rotulo: form.funcionario.rotulo } : null}
        onChange={(o) => {
          const funcionario = funcionarioEscolhido(o);
          mudar({ funcionario, tipo_medida: funcionario ? medidaSugerida(funcionario.tipo) : form.tipo_medida }, ["funcionario", "tipo_medida", "custo_unitario"]);
        }}
        rotuloDaOpcao={(o) => String(o?.nome ?? "")}
        detalheDaOpcao={detalheDoFuncionario}
        readOnly={bloqueado}
        obrigatorio
        erro={erros.funcionario}
        span={12}
        maiusculas={false}
      />
      <EscolhaSegmentada
        rotulo="Medida"
        testId={`${prefixo}-medida`}
        value={medida}
        onChange={(v) => mudar({ tipo_medida: v }, ["tipo_medida", "custo_unitario"])}
        readOnly={bloqueado}
        opcoes={MEDIDAS_MAO_OBRA.map((m) => ({ value: m, label: ROTULO_MEDIDA[m] }))}
      />
      <ErroDoCampo texto={erros.tipo_medida} />
      <CampoNumero
        label={unidade ? `Quantidade (${unidade})` : "Quantidade"}
        value={form.quantidade}
        onChange={(v) => mudar({ quantidade: v }, ["quantidade"])}
        locale={LOCALE_ATIVIDADE}
        limites={LIMITES_LINHA}
        readOnly={bloqueado}
        required
        span={6}
        error={erros.quantidade}
        testId={`${prefixo}-quantidade`}
      />
      {digitado ? (
        <CampoNumero
          label="Custo da tarefa (R$)"
          value={form.custo_unitario}
          onChange={(v) => mudar({ custo_unitario: v }, ["custo_unitario"])}
          locale={LOCALE_ATIVIDADE}
          limites={LIMITES_LINHA}
          readOnly={bloqueado}
          required
          span={6}
          error={erros.custo_unitario}
          testId={`${prefixo}-custo-unitario`}
        />
      ) : (
        <ValorCalculado
          label={medida === "DIARIA" ? `Custo da diária (${deOnde})` : `Custo da hora (${deOnde})`}
          valor={!form.funcionario ? "—" : formatarCustoLinha(unitario) || (mantido ? "Sem custo gravado" : "Sem custo no cadastro")}
          span={6}
          testId={`${prefixo}-custo-unitario`}
        />
      )}
      {!digitado ? <ErroDoCampo texto={erros.custo_unitario} /> : null}
      <ValorCalculado label="Total (quantidade × custo)" valor={formatarCustoLinha(total) || "—"} span={6} testId={`${prefixo}-total`} />
      {!digitado && form.funcionario && !unitario ? (
        <p className={NOTA} data-testid={`${prefixo}-sem-custo`}>
          {mantido
            ? "Esta linha foi gravada sem custo: com o mesmo funcionário e a mesma medida, ela continua sem custo."
            : `Este funcionário não tem custo de ${medida === "DIARIA" ? "diária" : "hora"} no cadastro: a linha entra sem custo.`}
        </p>
      ) : null}
      {comObservacao ? (
        <CampoTextoLongo label="Observação" value={form.observacao} onChange={(v) => mudar({ observacao: v }, ["observacao"])} readOnly={bloqueado} maxLength={MAX_OBSERVACAO_LINHA} />
      ) : null}
    </>
  );
}

// ─── Campos da linha de SERVIÇO (janela e "Repetir") ─────────────────────

/** @param {any} o */
const detalheDoServico = (o) => {
  const unidade = siglaDaUnidade(o?.unidade) || siglaDaUnidade(o?.unidade_medida);
  const referencia = typeof o?.valor_referencia === "string" ? formatarCustoLinha(o.valor_referencia) : "";
  return [unidade, referencia ? `referência ${referencia}` : ""].filter(Boolean).join(" · ") || null;
};

/**
 * Campos da linha de serviço: serviço → parceiro (opcional, só prestadores de serviço) → quantidade na unidade do
 * serviço → valor unitário (preenchido com o de referência) → total calculado → documento → observação.
 * @param {{
 *   form: import("@/lib/atividadeLinhasRegras").FormularioLinhaServico,
 *   mudar: (mudanca: Record<string, any>, campos: string[]) => void,
 *   erros: Record<string, string>,
 *   bloqueado: boolean,
 *   prefixo: string,
 *   comObservacao?: boolean,
 * }} props
 */
export function CamposDaLinhaServico({ form, mudar, erros, bloqueado, prefixo, comObservacao = true }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const unidade = form.servico?.unidade ?? "";
  const total = valorDaLinhaServico(form);
  return (
    <>
      <SeletorPaginadoGestao
        rotulo="Serviço"
        testId={`${prefixo}-servico`}
        chave={[RAIZ_CONSULTAS_ATIVIDADES, "servicos", empresaId]}
        buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesServicos({ q, cursor, limit }))}
        value={form.servico ? { id: form.servico.id, rotulo: form.servico.rotulo } : null}
        onChange={(o) => mudar(mudancaDoServicoEscolhido(o), ["servico", "quantidade", "valor_unitario"])}
        rotuloDaOpcao={(o) => String(o?.nome ?? "")}
        detalheDaOpcao={detalheDoServico}
        readOnly={bloqueado}
        obrigatorio
        erro={erros.servico}
        span={12}
        maiusculas={false}
      />
      <SeletorPaginadoGestao
        rotulo="Parceiro (prestador do serviço, opcional)"
        testId={`${prefixo}-parceiro`}
        chave={[RAIZ_CONSULTAS_ATIVIDADES, "parceiros-servico", empresaId]}
        buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesParceirosServico({ q, cursor, limit }))}
        value={form.parceiro}
        onChange={(o) => mudar({ parceiro: parceiroEscolhido(o) }, ["parceiro"])}
        rotuloDaOpcao={(o) => String(o?.nome ?? "")}
        readOnly={bloqueado}
        permitirLimpar
        erro={erros.parceiro}
        span={12}
        maiusculas={false}
      />
      <CampoNumero
        label={unidade ? `Quantidade (${unidade})` : "Quantidade"}
        value={form.quantidade}
        onChange={(v) => mudar({ quantidade: v }, ["quantidade"])}
        locale={LOCALE_ATIVIDADE}
        limites={LIMITES_LINHA}
        readOnly={bloqueado}
        required
        span={6}
        error={erros.quantidade}
        testId={`${prefixo}-quantidade`}
      />
      <CampoNumero
        label={unidade ? `Valor unitário (R$ por ${unidade})` : "Valor unitário (R$)"}
        value={form.valor_unitario}
        onChange={(v) => mudar({ valor_unitario: v }, ["valor_unitario"])}
        locale={LOCALE_ATIVIDADE}
        limites={LIMITES_LINHA}
        readOnly={bloqueado}
        required
        span={6}
        error={erros.valor_unitario}
        testId={`${prefixo}-valor-unitario`}
      />
      <ValorCalculado label="Total (quantidade × valor)" valor={formatarCustoLinha(total) || "—"} span={6} testId={`${prefixo}-total`} />
      <CampoTexto
        label="Documento (nota, recibo)"
        value={form.documento_referencia}
        onChange={(v) => mudar({ documento_referencia: v }, ["documento_referencia"])}
        readOnly={bloqueado}
        span={6}
        maxLength={MAX_DOCUMENTO_SERVICO}
        keepCase
        error={erros.documento_referencia}
      />
      {comObservacao ? (
        <CampoTextoLongo label="Observação" value={form.observacao} onChange={(v) => mudar({ observacao: v }, ["observacao"])} readOnly={bloqueado} maxLength={MAX_OBSERVACAO_LINHA} />
      ) : null}
    </>
  );
}

// ─── Janelas ─────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   atividade: any,
 *   apontamento: any,
 *   linha?: any,
 *   escopo: string,
 *   onSalvo: (resultado: { apontamento: any, atividade: any, alertas: any[] }, texto: string) => void,
 *   onCancelar: () => void,
 *   onMudou?: (() => void) | null,
 * }} PropsDaJanela
 */

/** "Lançamento de 12/11/2026 — Atividade nº 3 — Cigarrinha Pasto 01". @param {any} atividade @param {any} apontamento */
const descricaoDaJanela = (atividade, apontamento) =>
  [
    apontamento?.data_operacional ? `Lançamento de ${formatarDiaAtividade(apontamento.data_operacional)}` : "Lançamento",
    atividade?.numero != null ? `Atividade nº ${atividade.numero}` : "",
    typeof atividade?.nome === "string" ? atividade.nome : "",
  ]
    .filter(Boolean)
    .join(" — ");

/**
 * A janela em curso, com o corpo, o rodapé e as folhas do celular dentro dela.
 * @param {{ titulo: string, descricao: string, testId: string, enviando: boolean, rotuloEnvio: string, incerto: boolean,
 *   podeEnviar: boolean, formId: string, onFechar: () => void, onEnviar: () => void, children: React.ReactNode }} props
 */
function Janela({ titulo, descricao, testId, enviando, rotuloEnvio, incerto, podeEnviar, formId, onFechar, onEnviar, children }) {
  const [alvoFolha, setAlvoFolha] = useState(/** @type {HTMLElement | null} */ (null));
  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      podeFechar={!enviando}
      aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
      titulo={titulo}
      descricao={descricao}
      testId={testId}
      // Os botões daqui seguem as ações da tela (lançar/editar apontamento): a heurística de texto do Layout não vale.
      contentProps={{ "data-permissao-explicita": "" }}
      fora={<div ref={setAlvoFolha} className="contents" />}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando} data-testid={`${testId}-voltar`}>
            <X className="h-4 w-4" aria-hidden />
            Voltar
          </button>
          <button type="submit" form={formId} className={BOTAO_PRIMARIO} disabled={enviando || !podeEnviar} data-testid={`${testId}-salvar`}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
            {enviando ? "Salvando…" : incerto ? "Repetir o mesmo envio" : rotuloEnvio}
          </button>
        </>
      }
    >
      <MobileSheetPortalCtx.Provider value={alvoFolha}>
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            onEnviar();
          }}
          className="b1 mg-b1-form-grid b1-form-embutido"
          data-densidade={DENSIDADE_BASE1}
          noValidate
          data-testid={`${testId}-form`}
        >
          {children}
        </form>
      </MobileSheetPortalCtx.Provider>
    </B1Janela>
  );
}

/** Ids das linhas do apontamento (para o "Consultar" achar a linha nova). @param {any} ap @param {'produtos'|'maquinas'|'mao-obra'|'servicos'} tipo */
const idsDasLinhas = (ap, tipo) => new Set(linhasDoTipo(ap, tipo).map((l) => String(l.id)));

/**
 * Janela da linha de PRODUTO (adicionar ou editar). A baixa sai do estoque pelo MESMO motor FIFO do abastecimento, no
 * servidor; editar = estorno exato + nova saída. Toda escrita leva a `versao` do apontamento e o `operation_id`
 * persistente.
 * @param {PropsDaJanela} props
 */
export function JanelaLinhaProduto({ atividade, apontamento, linha = null, escopo, onSalvo, onCancelar, onMudou = null }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const editando = Boolean(linha?.id);
  const atividadeId = String(atividade?.id ?? "");
  const [form, setForm] = useState(() => (editando ? formularioDaLinhaProduto(linha) : formularioProdutoVazio()));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const saldo = useSaldoDoProduto(empresaId, form, setForm, editando ? linha : null);
  const antes = useRef(idsDasLinhas(apontamento, LINHA_PRODUTO));
  const fallback = editando ? "Não foi possível alterar o produto. Nada foi alterado." : "Não foi possível lançar o produto. Nada foi gravado.";

  /** @param {{ dados: Record<string, any>, versao: number }} arg @param {{ retentativa: boolean }} o */
  const enviar = (arg, o) => {
    const ap = { id: String(apontamento.id), versao: arg.versao };
    return editando ? editarLinha(LINHA_PRODUTO, atividadeId, ap, linha, arg.dados, { escopo, retentativa: o.retentativa }) : adicionarLinha(LINHA_PRODUTO, atividadeId, ap, arg.dados, { escopo, retentativa: o.retentativa });
  };
  const { estado, setEstado, disparar, esquecerUltimo } = useEnvioDaLinha(enviar, (e) => mensagemDeErroLinha(e, fallback, { unidade: saldo.unidade }));
  const enviando = estado.fase === "enviando";

  /** @param {Record<string, any>} mudanca @param {string[]} campos */
  const mudar = (mudanca, campos) => {
    setForm((f) => ({ ...f, ...mudanca }));
    setErros((e) => (campos.some((c) => e[c]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !campos.includes(k))) : e));
    esquecerUltimo();
    setEstado((e) => (e.fase === "erro" ? { fase: "pronto" } : e));
  };

  const { aviso } = validarLinhaProduto(form, { disponivel: saldo.disponivel });
  const nome = form.produto?.rotulo ?? "Produto";

  const salvar = async () => {
    if (enviando) return;
    const v = validarLinhaProduto(form, { disponivel: saldo.disponivel });
    setErros(v.erros);
    if (Object.keys(v.erros).length) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    /** @type {Record<string, any>} */
    let dados = corpoDaLinhaProduto(form);
    if (editando) {
      dados = camposAlteradosDaLinha(linha, dados);
      if (!Object.keys(dados).length) {
        notifyInfo("Sem alterações", "Nada foi alterado.");
        onCancelar();
        return;
      }
    }
    const r = await disparar({ dados, versao: apontamento.versao });
    if (!r) return;
    if (r.ok) {
      onSalvo(
        normalizarRespostaDeEscrita(r.resposta),
        editando ? `Produto ${nome} alterado: o estoque anterior foi estornado e a nova quantidade baixada.` : `Produto ${nome} lançado: a quantidade saiu do estoque.`,
      );
      return;
    }
    const campo = campoDaLinhaRecusada(r.erro);
    const mensagem = mensagemDeErroLinha(r.erro, fallback, { unidade: saldo.unidade });
    if (campo) setErros((e) => ({ ...e, [campo]: mensagem }));
    if (codigoDoServidor(r.erro) === "ESTOQUE_SALDO_INSUFICIENTE") saldo.consulta.refetch();
    if (ehResultadoIncerto(r.erro) || pedeReleitura(r.erro)) onMudou?.();
    if (!ehResultadoIncerto(r.erro) && /** @type {any} */ (r.erro)?.code !== CODIGO_ENVIO_PENDENTE) notifyWarning("Atenção", mensagem);
  };

  /** "Consultar" depois de um envio sem resposta: o apontamento relido mostra o efeito? */
  const consultar = async () => {
    try {
      const lido = /** @type {any} */ (await obterApontamento(atividadeId, String(apontamento.id)));
      const { produtos } = linhasDoApontamento(lido);
      const gravou = editando
        ? produtos.some((l) => String(l.id) === String(linha.id) && l.status === STATUS_CANCELADO)
        : produtos.some((l) => !antes.current.has(String(l.id)) && l.status === STATUS_CONFIRMADO && String(l.produto_id) === String(form.produto?.id ?? ""));
      if (gravou) {
        limparPendenciaDaLinha(escopo, editando ? ACAO_EDITAR_LINHA : ACAO_LANCAR_LINHA, editando ? alvoDaLinha(LINHA_PRODUTO, String(linha.id)) : alvoDasLinhas(LINHA_PRODUTO, String(apontamento.id)));
        notifySuccess("Gravado", `O envio anterior do produto ${nome} foi gravado.`);
        onSalvo({ apontamento: lido, atividade: null, alertas: [] }, `Produto ${nome} gravado.`);
        return;
      }
      setEstado((e) => ({ ...e, consulta: "O envio ainda não aparece gravado. Repita o mesmo envio: ele não será duplicado." }));
    } catch {
      setEstado((e) => ({ ...e, consulta: "Não foi possível consultar agora. Tente de novo." }));
    }
  };

  return (
    <Janela
      titulo={editando ? `Editar produto ${rotuloDoProdutoDaLinha(linha)}`.trim() : "Adicionar produto"}
      descricao={`${descricaoDaJanela(atividade, apontamento)}.${editando ? " Salvar estorna exatamente a baixa anterior e baixa a nova quantidade." : ""}`}
      testId="janela-linha-produto"
      formId="formulario-linha-produto"
      enviando={enviando}
      incerto={estado.fase === "incerto"}
      podeEnviar
      rotuloEnvio={editando ? "Salvar alterações" : "Lançar produto"}
      onFechar={onCancelar}
      onEnviar={() => void salvar()}
    >
      <CamposDaLinhaProduto
        form={form}
        mudar={mudar}
        erros={erros}
        aviso={aviso}
        saldo={saldo}
        atividadeId={atividadeId}
        areaDoDia={typeof apontamento?.area_executada_dia === "string" ? apontamento.area_executada_dia : null}
        bloqueado={enviando}
        prefixo="linha-produto"
      />
      <p className={NOTA}>Sai do estoque exatamente a quantidade digitada, na unidade do produto. O custo vem dos lotes (FIFO) e aparece depois de lançar.</p>
      <div className="col-span-12 min-w-0">
        <AvisoEnvioDaLinha estado={estado} produto onRepetir={() => void salvar()} onConsultar={() => void consultar()} />
      </div>
    </Janela>
  );
}

/**
 * Janela da linha de MÁQUINA (adicionar ou editar). A máquina do cabeçalho vem como sugestão; o medidor (tipo e
 * unidade) é do bem; a leitura inicial é sugerida pela vigente e a final é obrigatória; "sem medidor" informa o uso.
 * Passou do teto (ou o servidor respondeu ATIVIDADE_SALTO_MEDIDOR): a justificativa aparece e o envio repete com ela.
 * @param {PropsDaJanela & { permiteImplemento: boolean }} props
 */
export function JanelaLinhaMaquina({ atividade, apontamento, linha = null, permiteImplemento, escopo, onSalvo, onCancelar, onMudou = null }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const editando = Boolean(linha?.id);
  const atividadeId = String(atividade?.id ?? "");
  const [form, setForm] = useState(() => (editando ? formularioDaLinhaMaquina(linha) : formularioMaquinaVazio(atividade?.bem ?? null)));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [saltoPedido, setSaltoPedido] = useState(editando && Boolean(linha?.justificativa_salto));
  const dia = typeof apontamento?.data_operacional === "string" ? apontamento.data_operacional : null;
  const medidorDaLinha = useMedidorDaLinha(empresaId, form, setForm, dia, editando);
  const { medidor } = medidorDaLinha;
  const antes = useRef(idsDasLinhas(apontamento, LINHA_MAQUINA));
  const fallback = editando ? "Não foi possível alterar a máquina. Nada foi alterado." : "Não foi possível lançar a máquina. Nada foi gravado.";
  const uso = medidor ? usoDaLinha(form, medidor) : null;
  const pedeJustificativa = saltoPedido || passaDoTeto(uso, medidor?.teto ?? null);

  /** @param {{ dados: Record<string, any>, versao: number }} arg @param {{ retentativa: boolean }} o */
  const enviar = (arg, o) => {
    const ap = { id: String(apontamento.id), versao: arg.versao };
    return editando ? editarLinha(LINHA_MAQUINA, atividadeId, ap, linha, arg.dados, { escopo, retentativa: o.retentativa }) : adicionarLinha(LINHA_MAQUINA, atividadeId, ap, arg.dados, { escopo, retentativa: o.retentativa });
  };
  const { estado, setEstado, disparar, esquecerUltimo } = useEnvioDaLinha(enviar, (e) => mensagemDeErroLinha(e, fallback, { medidorUnidade: medidor?.unidade ?? null }));
  const enviando = estado.fase === "enviando";

  /** @param {Record<string, any>} mudanca @param {string[]} campos */
  const mudar = (mudanca, campos) => {
    setForm((f) => ({ ...f, ...mudanca }));
    setErros((e) => (campos.some((c) => e[c]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !campos.includes(k))) : e));
    if (campos.includes("bem")) setSaltoPedido(false);
    esquecerUltimo();
    setEstado((e) => (e.fase === "erro" ? { fase: "pronto" } : e));
  };

  const nome = form.bem?.rotulo ?? "Máquina";

  const salvar = async () => {
    if (enviando || !medidor) return;
    const v = validarLinhaMaquina(form, { medidor, permiteImplemento, pedeJustificativa });
    setErros(v);
    if (Object.keys(v).length) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    /** @type {Record<string, any>} */
    let dados = corpoDaLinhaMaquina(form, medidor, { comJustificativa: pedeJustificativa });
    if (editando) {
      dados = camposAlteradosDaLinha(linha, dados);
      if (!Object.keys(dados).length) {
        notifyInfo("Sem alterações", "Nada foi alterado.");
        onCancelar();
        return;
      }
    }
    const r = await disparar({ dados, versao: apontamento.versao });
    if (!r) return;
    if (r.ok) {
      onSalvo(normalizarRespostaDeEscrita(r.resposta), editando ? `Máquina ${nome} alterada.` : `Máquina ${nome} lançada${uso ? ` (${formatarUso(uso, medidor.tipo, medidor.unidade)})` : ""}.`);
      return;
    }
    if (ehSaltoDoMedidor(r.erro)) setSaltoPedido(true);
    const campo = campoDaLinhaRecusada(r.erro);
    const mensagem = mensagemDeErroLinha(r.erro, fallback, { medidorUnidade: medidor.unidade });
    if (campo) setErros((e) => ({ ...e, [campo]: mensagem }));
    if (ehResultadoIncerto(r.erro) || pedeReleitura(r.erro)) onMudou?.();
    if (!ehResultadoIncerto(r.erro) && /** @type {any} */ (r.erro)?.code !== CODIGO_ENVIO_PENDENTE) notifyWarning("Atenção", mensagem);
  };

  const consultar = async () => {
    try {
      const lido = /** @type {any} */ (await obterApontamento(atividadeId, String(apontamento.id)));
      const { maquinas } = linhasDoApontamento(lido);
      const gravou = editando
        ? maquinas.some((l) => String(l.id) === String(linha.id) && l.status === STATUS_CANCELADO)
        : maquinas.some((l) => !antes.current.has(String(l.id)) && l.status === STATUS_CONFIRMADO && String(l.bem_id) === String(form.bem?.id ?? ""));
      if (gravou) {
        limparPendenciaDaLinha(escopo, editando ? ACAO_EDITAR_LINHA : ACAO_LANCAR_LINHA, editando ? alvoDaLinha(LINHA_MAQUINA, String(linha.id)) : alvoDasLinhas(LINHA_MAQUINA, String(apontamento.id)));
        notifySuccess("Gravado", `O envio anterior da máquina ${nome} foi gravado.`);
        onSalvo({ apontamento: lido, atividade: null, alertas: [] }, `Máquina ${nome} gravada.`);
        return;
      }
      setEstado((e) => ({ ...e, consulta: "O envio ainda não aparece gravado. Repita o mesmo envio: ele não será duplicado." }));
    } catch {
      setEstado((e) => ({ ...e, consulta: "Não foi possível consultar agora. Tente de novo." }));
    }
  };

  return (
    <Janela
      titulo={editando ? `Editar máquina ${nome}`.trim() : "Adicionar máquina"}
      descricao={`${descricaoDaJanela(atividade, apontamento)}.${editando ? " Salvar cancela esta linha e lança outra com os dados novos." : ""}`}
      testId="janela-linha-maquina"
      formId="formulario-linha-maquina"
      enviando={enviando}
      incerto={estado.fase === "incerto"}
      podeEnviar={Boolean(medidor) || !form.bem?.id}
      rotuloEnvio={editando ? "Salvar alterações" : "Lançar máquina"}
      onFechar={onCancelar}
      onEnviar={() => {
        if (!form.bem?.id) {
          setErros({ bem: "Escolha a máquina." });
          return;
        }
        void salvar();
      }}
    >
      <CamposDaLinhaMaquina
        form={form}
        mudar={mudar}
        erros={erros}
        medidorDaLinha={medidorDaLinha}
        permiteImplemento={permiteImplemento}
        pedeJustificativa={pedeJustificativa}
        bloqueado={enviando}
        prefixo="linha-maquina"
      />
      <p className={NOTA}>
        A leitura fica na linha (o cadastro do bem não muda) e passa a valer como a leitura atual do bem, também para o abastecimento. O custo de uso vem do
        cadastro do bem.
      </p>
      <div className="col-span-12 min-w-0">
        <AvisoEnvioDaLinha estado={estado} produto={false} onRepetir={() => void salvar()} onConsultar={() => void consultar()} />
      </div>
    </Janela>
  );
}

/**
 * Janela de UMA linha que cancela e cria outra na edição (mão de obra e serviço, Fatia 4): o molde da janela de
 * máquina, sem medidor. Valida localmente, manda só o que mudou (edição) com a `versao` do apontamento e o
 * `operation_id` persistente; sem resposta, "Repetir o mesmo envio" reaproveita a chave; "Consultar" relê o apontamento.
 * @template F
 * @param {PropsDaJanela & {
 *   tipo: 'mao-obra'|'servicos',
 *   formInicial: () => F,
 *   validar: (form: F) => Record<string, string>,
 *   corpo: (form: F) => Record<string, any>,
 *   alterados: (linha: any, corpo: Record<string, any>) => Record<string, any>,
 *   idDoCadastro: (form: F) => string|null,
 *   campoDoCadastro: string,
 *   nome: (form: F) => string,
 *   rotulos: { titulo: string, tituloEdicao: string, envio: string, sucesso: string, sucessoEdicao: string, lancado: string, objeto: string, falha: string, falhaEdicao: string },
 *   testId: string,
 *   campos: (p: { form: F, mudar: (mudanca: Record<string, any>, campos: string[]) => void, erros: Record<string, string>, bloqueado: boolean }) => React.ReactNode,
 *   nota: string,
 * }} props
 */
function JanelaLinhaSemMedidor({
  tipo,
  atividade,
  apontamento,
  linha = null,
  escopo,
  onSalvo,
  onCancelar,
  onMudou = null,
  formInicial,
  validar,
  corpo,
  alterados,
  idDoCadastro,
  campoDoCadastro,
  nome: nomeDe,
  rotulos,
  testId,
  campos,
  nota,
}) {
  const editando = Boolean(linha?.id);
  const atividadeId = String(atividade?.id ?? "");
  const [form, setForm] = useState(formInicial);
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const antes = useRef(idsDasLinhas(apontamento, tipo));
  const fallback = editando ? rotulos.falhaEdicao : rotulos.falha;

  /** @param {{ dados: Record<string, any>, versao: number }} arg @param {{ retentativa: boolean }} o */
  const enviar = (arg, o) => {
    const ap = { id: String(apontamento.id), versao: arg.versao };
    return editando ? editarLinha(tipo, atividadeId, ap, linha, arg.dados, { escopo, retentativa: o.retentativa }) : adicionarLinha(tipo, atividadeId, ap, arg.dados, { escopo, retentativa: o.retentativa });
  };
  const { estado, setEstado, disparar, esquecerUltimo } = useEnvioDaLinha(enviar, (e) => mensagemDeErroLinha(e, fallback));
  const enviando = estado.fase === "enviando";

  /** @param {Record<string, any>} mudanca @param {string[]} camposMudados */
  const mudar = (mudanca, camposMudados) => {
    setForm((f) => ({ ...f, ...mudanca }));
    setErros((e) => (camposMudados.some((c) => e[c]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !camposMudados.includes(k))) : e));
    esquecerUltimo();
    setEstado((e) => (e.fase === "erro" ? { fase: "pronto" } : e));
  };

  const nome = nomeDe(form);

  const salvar = async () => {
    if (enviando) return;
    const v = validar(form);
    setErros(v);
    if (Object.keys(v).length) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    /** @type {Record<string, any>} */
    let dados = corpo(form);
    if (editando) {
      dados = alterados(linha, dados);
      if (!Object.keys(dados).length) {
        notifyInfo("Sem alterações", "Nada foi alterado.");
        onCancelar();
        return;
      }
    }
    const r = await disparar({ dados, versao: apontamento.versao });
    if (!r) return;
    if (r.ok) {
      onSalvo(normalizarRespostaDeEscrita(r.resposta), (editando ? rotulos.sucessoEdicao : rotulos.sucesso).replace("{nome}", nome));
      return;
    }
    // O servidor viu que nada muda de fato (a linha e a versão ficaram como estavam): o mesmo "Sem alterações".
    if (editando && ehSemAlteracaoDaLinha(r.erro)) {
      notifyInfo("Sem alterações", "Nada foi alterado.");
      onCancelar();
      return;
    }
    const campo = campoDaLinhaRecusada(r.erro);
    const mensagem = mensagemDeErroLinha(r.erro, fallback);
    if (campo) setErros((e) => ({ ...e, [campo]: mensagem }));
    if (ehResultadoIncerto(r.erro) || pedeReleitura(r.erro)) onMudou?.();
    if (!ehResultadoIncerto(r.erro) && /** @type {any} */ (r.erro)?.code !== CODIGO_ENVIO_PENDENTE) notifyWarning("Atenção", mensagem);
  };

  /** "Consultar" depois de um envio sem resposta: o apontamento relido mostra o efeito? */
  const consultar = async () => {
    try {
      const lido = /** @type {any} */ (await obterApontamento(atividadeId, String(apontamento.id)));
      const linhas = linhasDoTipo(lido, tipo);
      const gravou = editando
        ? linhas.some((l) => String(l.id) === String(linha.id) && l.status === STATUS_CANCELADO)
        : linhas.some((l) => !antes.current.has(String(l.id)) && l.status === STATUS_CONFIRMADO && String(l[campoDoCadastro]) === String(idDoCadastro(form) ?? ""));
      if (gravou) {
        limparPendenciaDaLinha(escopo, editando ? ACAO_EDITAR_LINHA : ACAO_LANCAR_LINHA, editando ? alvoDaLinha(tipo, String(linha.id)) : alvoDasLinhas(tipo, String(apontamento.id)));
        notifySuccess("Gravado", `O envio anterior ${rotulos.objeto} ${nome} foi gravado.`);
        onSalvo({ apontamento: lido, atividade: null, alertas: [] }, `${nome} gravado.`);
        return;
      }
      setEstado((e) => ({ ...e, consulta: "O envio ainda não aparece gravado. Repita o mesmo envio: ele não será duplicado." }));
    } catch {
      setEstado((e) => ({ ...e, consulta: "Não foi possível consultar agora. Tente de novo." }));
    }
  };

  return (
    <Janela
      titulo={editando ? rotulos.tituloEdicao.replace("{nome}", nome).trim() : rotulos.titulo}
      descricao={`${descricaoDaJanela(atividade, apontamento)}.${editando ? " Salvar cancela esta linha e lança outra com os dados novos." : ""}`}
      testId={testId}
      formId={`formulario-${testId.replace(/^janela-/, "")}`}
      enviando={enviando}
      incerto={estado.fase === "incerto"}
      podeEnviar
      rotuloEnvio={editando ? "Salvar alterações" : rotulos.envio}
      onFechar={onCancelar}
      onEnviar={() => void salvar()}
    >
      {campos({ form, mudar, erros, bloqueado: enviando })}
      <p className={NOTA}>{nota}</p>
      <div className="col-span-12 min-w-0">
        <AvisoEnvioDaLinha estado={estado} produto={false} lancado={rotulos.lancado} onRepetir={() => void salvar()} onConsultar={() => void consultar()} />
      </div>
    </Janela>
  );
}

/**
 * Janela da linha de MÃO DE OBRA (adicionar ou editar; Fatia 4). Hora e diária: o custo unitário é o do cadastro do
 * funcionário (snapshot no servidor, só mostrado); tarefa: digitado. A medida vem sugerida pelo tipo do funcionário.
 * @param {PropsDaJanela} props
 */
export function JanelaLinhaMaoObra({ linha = null, ...props }) {
  return (
    <JanelaLinhaSemMedidor
      {...props}
      linha={linha}
      tipo={LINHA_MAO_OBRA}
      testId="janela-linha-mao-obra"
      formInicial={() => (linha?.id ? formularioDaLinhaMaoObra(linha) : formularioMaoObraVazio())}
      validar={validarLinhaMaoObra}
      corpo={corpoDaLinhaMaoObra}
      alterados={camposAlteradosDaLinhaMaoObra}
      idDoCadastro={(f) => f.funcionario?.id ?? null}
      campoDoCadastro="funcionario_id"
      nome={(f) => f.funcionario?.rotulo ?? (rotuloDoFuncionarioDaLinha(linha) || "Funcionário")}
      rotulos={{
        titulo: "Adicionar mão de obra",
        tituloEdicao: "Editar mão de obra de {nome}",
        envio: "Lançar mão de obra",
        sucesso: "Mão de obra de {nome} lançada.",
        sucessoEdicao: "Mão de obra de {nome} alterada.",
        lancado: "a mão de obra PODE ter sido lançada",
        objeto: "da mão de obra de",
        falha: "Não foi possível lançar a mão de obra. Nada foi gravado.",
        falhaEdicao: "Não foi possível alterar a mão de obra. Nada foi alterado.",
      }}
      campos={(p) => <CamposDaLinhaMaoObra {...p} prefixo="linha-mao-obra" />}
      nota="Hora e diária usam o custo do cadastro do funcionário na data do lançamento (editar sem trocar o funcionário nem a medida mantém o custo gravado); tarefa usa o custo digitado. Não é folha de pagamento: nada vai para o financeiro."
    />
  );
}

/**
 * Janela da linha de SERVIÇO (adicionar ou editar; Fatia 4): o serviço (a unidade é a dele), o parceiro prestador
 * (opcional), a quantidade, o valor unitário (preenchido com o de referência) e o documento.
 * @param {PropsDaJanela} props
 */
export function JanelaLinhaServico({ linha = null, ...props }) {
  return (
    <JanelaLinhaSemMedidor
      {...props}
      linha={linha}
      tipo={LINHA_SERVICO}
      testId="janela-linha-servico"
      formInicial={() => (linha?.id ? formularioDaLinhaServico(linha) : formularioServicoVazio())}
      validar={validarLinhaServico}
      corpo={corpoDaLinhaServico}
      alterados={camposAlteradosDaLinha}
      idDoCadastro={(f) => f.servico?.id ?? null}
      campoDoCadastro="servico_id"
      nome={(f) => f.servico?.rotulo ?? (rotuloDoServicoDaLinha(linha) || "Serviço")}
      rotulos={{
        titulo: "Adicionar serviço",
        tituloEdicao: "Editar serviço {nome}",
        envio: "Lançar serviço",
        sucesso: "Serviço {nome} lançado.",
        sucessoEdicao: "Serviço {nome} alterado.",
        lancado: "o serviço PODE ter sido lançado",
        objeto: "do serviço",
        falha: "Não foi possível lançar o serviço. Nada foi gravado.",
        falhaEdicao: "Não foi possível alterar o serviço. Nada foi alterado.",
      }}
      campos={(p) => <CamposDaLinhaServico {...p} prefixo="linha-servico" />}
      nota="O serviço entra no custo da atividade. Nada vai para o financeiro: título ou pagamento ao parceiro são lançados à parte."
    />
  );
}
