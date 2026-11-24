import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import PreviaRecalculoExclusao from "@/components/estoque/PreviaRecalculoExclusao";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { DialogoAcao } from "@/components/financeiroGestao/DialogosLancamento";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { MobileSheetPortalCtx, useCelular } from "@/components/common/MobileSheet";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoNumero, EscolhaSegmentada, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import { AvisoEnvioAbastecimento, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { useEmpresaRealSelecionadaId } from "@/hooks/useLancamentoAtividadesSessao";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { rotuloDaUnidade, rotuloDoBem } from "@/lib/abastecimentoRegras";
import { somar } from "@/lib/dinheiroDecimal";
import { LOCALE_ATIVIDADE, MOTIVO_MINIMO, STATUS_CANCELADO, STATUS_CONFIRMADO, formatarDiaAtividade } from "@/lib/lancamentoAtividadesRegras";
import { RAIZ_CONSULTAS_ATIVIDADES, itensDaLista, normalizarPaginaDeOpcoes, normalizarRespostaDeEscrita, pedeReleitura } from "@/lib/atividadeApontamentoRegras";
import {
  COLECAO_DA_LINHA,
  JUSTIFICATIVA_MAXIMA,
  LIMITES_LINHA,
  LINHA_MAO_OBRA,
  LINHA_MAQUINA,
  LINHA_PRODUTO,
  LINHA_SERVICO,
  MAX_DOCUMENTO_SERVICO,
  MAX_OBSERVACAO_LINHA,
  MEDIDAS_MAO_OBRA,
  ORIGEM_TERCEIRO,
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
  linhasDoTipo,
  mudancaDaMaoObraEscolhida,
  mudancaDoServicoEscolhido,
  parceiroEscolhido,
  rotuloDaMaoObraDaLinha,
  rotuloDaMaquinaDaLinha,
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
  chaveTotais,
  formularioDaLinhaProduto,
  formularioMaquinaVazio,
  formularioProdutoVazio,
  linhasDoApontamento,
  medidorDaResposta,
  mensagemDeErroLinha,
  passaDoTeto,
  produtoEscolhido,
  rotuloDoMedidor,
  textoDaLeituraVigente,
  rotuloDoProdutoDaLinha,
  unidadeDoProduto,
  usaSemMedidor,
  usoDaLinha,
  validarLinhaMaquina,
  validarLinhaProduto,
} from "@/lib/atividadeLinhasRegras";
import {
  ACAO_CANCELAR_LINHA,
  ACAO_EDITAR_LINHA,
  ACAO_LANCAR_LINHA,
  adicionarLinha,
  alvoDaLinha,
  alvoDasLinhas,
  alvoDosApontamentos,
  cancelarLinha,
  criarApontamento,
  editarLinha,
  limparPendenciaDaLinha,
  listarApontamentos,
  listarLocaisDoProduto,
  listarOpcoesBens,
  listarOpcoesImplementos,
  listarOpcoesMaoObra,
  listarOpcoesParceirosServico,
  listarOpcoesProdutos,
  listarOpcoesServicos,
  obterApontamento,
  obterMedidorDoBem,
  obterTotaisAtividade,
} from "@/services/lancamentoAtividadesService";
import { bemParaAbastecer } from "@/lib/atividadeFluxoCampo";
import { hectaresParaDose } from "@/lib/lancamentosDaAreaRegras";
import { CODIGO_ENVIO_PENDENTE, codigoDoServidor, ehRecusaDefinitiva, ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

/** Texto auxiliar (o tom das notas dos formulários do motor). */
const NOTA = "col-span-12 min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";

/**
 * O formulário da janela (D-PROD-252, emenda 3): quem o envolve numa janela diz que ele é em seções Base1 (valor não
 * nulo) e pode pôr um campo na frente, no mesmo grupo "Lançamento" (o Dia da janela por tipo). O "Repetir" não
 * provê o contexto: lá os campos continuam sem seção.
 * D-PROD-258: `opcional` marca o formulário "Registrar serviço", em que as quatro seções são sempre oferecidas e todas são
 * opcionais — o campo-chave da seção (Máquina, Produto, Funcionário, Serviço) deixa de levar o asterisco e os campos que
 * dependem dele só o levam depois que ele é escolhido.
 * @type {React.Context<{ topo: React.ReactNode, opcional?: boolean } | null>}
 */
export const SecoesDoFormularioContext = createContext(/** @type {{ topo: React.ReactNode, opcional?: boolean } | null} */ (null));

/** O título do grupo (só na janela) e o campo da frente. @param {{ titulo: string, comTopo?: boolean }} props */
function Grupo({ titulo, comTopo = false }) {
  const ctx = useContext(SecoesDoFormularioContext);
  if (!ctx) return null;
  return (
    <>
      <SecaoForm titulo={titulo} />
      {comTopo ? ctx.topo : null}
    </>
  );
}

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
 *   tituloGrupo?: string|null,
 * }} props
 */
export function CamposDaLinhaProduto({ form, mudar, erros, aviso, saldo, atividadeId, areaDoDia, bloqueado, prefixo, comObservacao = true, tituloGrupo = "Lançamento" }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const secoes = useContext(SecoesDoFormularioContext);
  const comTopo = Boolean(secoes?.topo);
  // Na janela (com seções) o formulário é enxuto; no "Repetir" (sem seções) ficam as notas e os campos de leitura de antes.
  const compacto = secoes !== null;
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
          {escolhido && !compacto ? (
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
      {tituloGrupo === null ? null : <Grupo titulo={tituloGrupo} comTopo />}
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
        obrigatorio={!secoes?.opcional}
        erro={erros.produto}
        span={comTopo ? 6 : 12}
        maiusculas={false}
      />
      {blocoLocal}
      <Grupo titulo="Quantidade" />
      <CampoNumero
        label={rotuloUnidade ? `Quantidade (${rotuloUnidade})` : "Quantidade"}
        value={form.quantidade}
        onChange={(v) => mudar({ quantidade: v }, ["quantidade"])}
        locale={LOCALE_ATIVIDADE}
        limites={LIMITES_LINHA}
        readOnly={bloqueado}
        required={!secoes?.opcional || Boolean(form.produto?.id)}
        span={6}
        error={erros.quantidade}
        testId={`${prefixo}-quantidade`}
      />
      <ValorCalculado
        label="Dose por hectare"
        valor={dose ? formatarDose(dose, unidade) : areaDoDia ? "—" : "Sem área"}
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

/** "100" / "1.550,5": a leitura para a frase (sem casas a mais). @param {string|null|undefined} v */
const leituraCurta = (v) => (v ? formatarDecimalLinha(v) : "");

/**
 * D-PROD-281 — o HORÍMETRO simples (maquete "Continuar com horímetro"): só "Horímetro agora" (a leitura final), com
 * "última hora lançada: 100 · hoje dá 8 horas"; a inicial é a última leitura do medidor (sugerida por
 * `useMedidorDaLinha`, como sempre). "Horímetro quebrado?" passa às "Horas corridas de trabalho" (o `sem_medidor` de
 * sempre) e "Voltar a usar o horímetro" volta. Sem leitura anterior, a inicial ainda é pedida. As regras do salto não
 * mudam (a justificativa segue logo abaixo, quando pedida).
 * @param {{ form: any, mudar: (m: Record<string, any>, c: string[]) => void, erros: Record<string, string>, medidor: any,
 *   uso: string|null, bloqueado: boolean, prefixo: string }} props
 */
function HorimetroSimples({ form, mudar, erros, medidor, uso, bloqueado, prefixo }) {
  const LINK = "col-span-12 justify-self-start text-left text-[13px] font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800 disabled:opacity-50";
  const ultima = medidor?.vigente?.leitura ?? null;
  if (form.sem_medidor) {
    return (
      <>
        <p className={NOTA} data-testid={`${prefixo}-horimetro-quebrado`}>horímetro quebrado</p>
        <CampoNumero
          label="Horas corridas de trabalho"
          value={form.quantidade_uso}
          onChange={(v) => mudar({ quantidade_uso: v }, ["quantidade_uso", "justificativa_salto"])}
          locale={LOCALE_ATIVIDADE}
          limites={LIMITES_LINHA}
          readOnly={bloqueado}
          required
          span={12}
          error={erros.quantidade_uso}
          testId={`${prefixo}-quantidade-uso`}
        />
        <p className={NOTA}>quantas horas a máquina trabalhou neste serviço hoje</p>
        <button
          type="button"
          className={LINK}
          disabled={bloqueado}
          onClick={() => mudar({ sem_medidor: false, quantidade_uso: "" }, ["leitura_inicial", "leitura_final", "quantidade_uso"])}
          data-testid={`${prefixo}-voltar-horimetro`}
        >
          Voltar a usar o horímetro
        </button>
      </>
    );
  }
  return (
    <>
      {ultima ? null : (
        <CampoNumero
          label="Horímetro no começo"
          value={form.leitura_inicial}
          onChange={(v) => mudar({ leitura_inicial: v }, ["leitura_inicial", "leitura_final", "justificativa_salto"])}
          locale={LOCALE_ATIVIDADE}
          limites={LIMITES_LINHA}
          readOnly={bloqueado}
          required
          span={12}
          error={erros.leitura_inicial}
          testId={`${prefixo}-leitura-inicial`}
        />
      )}
      <CampoNumero
        label="Horímetro agora"
        value={form.leitura_final}
        onChange={(v) => mudar({ leitura_final: v }, ["leitura_final", "justificativa_salto"])}
        locale={LOCALE_ATIVIDADE}
        limites={LIMITES_LINHA}
        readOnly={bloqueado}
        required
        span={12}
        error={erros.leitura_final ?? (ultima ? erros.leitura_inicial : undefined)}
        testId={`${prefixo}-leitura-final`}
      />
      <p className={NOTA} data-testid={`${prefixo}-horimetro-dica`}>
        {ultima ? <>última hora lançada: <strong>{leituraCurta(ultima)}</strong></> : "sem leitura anterior: informe o horímetro no começo"}
        {uso ? <> · hoje dá <strong>{leituraCurta(uso)} {uso === "1.0000" || uso === "1" ? "hora" : "horas"}</strong></> : null}
      </p>
      <button
        type="button"
        className={LINK}
        disabled={bloqueado}
        onClick={() => mudar({ sem_medidor: true, leitura_final: "" }, ["leitura_inicial", "leitura_final", "quantidade_uso"])}
        data-testid={`${prefixo}-horimetro-quebrado-link`}
      >
        Horímetro quebrado?
      </button>
    </>
  );
}

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
 *   tituloGrupo?: string|null,
 *   soUso?: boolean,
 *   horimetroSimples?: boolean,
 * }} props
 */
export function CamposDaLinhaMaquina({ form, mudar, erros, medidorDaLinha, permiteImplemento, pedeJustificativa, bloqueado, prefixo, comObservacao = true, tituloGrupo = "Lançamento", soUso = false, horimetroSimples = false }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const secoes = useContext(SecoesDoFormularioContext);
  const comTopo = Boolean(secoes?.topo);
  // Na janela (com seções) o formulário é enxuto; no "Repetir" (sem seções) ficam as notas e os campos de leitura de antes.
  const compacto = secoes !== null;
  const { consulta, medidor } = medidorDaLinha;
  const unidade = medidor?.unidade ?? "";
  const semMedidor = medidor ? usaSemMedidor(form, medidor) : false;
  const uso = medidor ? usoDaLinha(form, medidor) : null;
  // D-PROD-281: na janela do registro (`horimetroSimples`), o HORÍMETRO pergunta só "Horímetro agora" (a inicial vem da última leitura) ou, quebrado,
  // as horas corridas (o caminho "sem medidor" de sempre).
  const horimetro = horimetroSimples && medidor?.tipo === "HORIMETRO" && medidor.contador;

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
          {compacto ? null : (
            <>
              <ValorCalculado label="Medidor (do cadastro do bem)" valor={rotuloDoMedidor(medidor.tipo)} span={6} testId={`${prefixo}-medidor`} />
              <ValorCalculado label="Uso" valor={uso ? formatarUso(uso, medidor.tipo, unidade) : "—"} span={6} testId={`${prefixo}-uso`} />
            </>
          )}
          {compacto && horimetro ? (
            <HorimetroSimples form={form} mudar={mudar} erros={erros} medidor={medidor} uso={uso} bloqueado={bloqueado} prefixo={prefixo} />
          ) : null}
          {compacto && horimetro ? null : medidor.contador ? (
            <>
              {compacto ? null : (
                <p className={NOTA} data-testid={`${prefixo}-leitura-vigente`}>
                  {textoDaLeituraVigente(medidor)}
                </p>
              )}
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
          ) : compacto ? null : (
            <p className={NOTA} data-testid={`${prefixo}-sem-medidor-no-bem`}>
              Este bem não tem medidor que conte: informe o uso direto.
            </p>
          )}
          {compacto && horimetro ? null : semMedidor ? (
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
              {compacto ? <ValorCalculado label="Uso" valor={uso ? formatarUso(uso, medidor.tipo, unidade) : "—"} span={6} testId={`${prefixo}-uso`} /> : null}
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

  // D-PROD-281: no "Novo lançamento" curto, só o uso (a máquina vem do último dia; trocar é no "Mudar").
  if (soUso) return <>{blocoMedidor}</>;
  return (
    <>
      {tituloGrupo === null ? null : <Grupo titulo={tituloGrupo} comTopo />}
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
        obrigatorio={!secoes?.opcional}
        erro={erros.bem}
        span={comTopo || permiteImplemento ? 6 : 12}
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
          span={comTopo ? 12 : 6}
          maiusculas={false}
        />
      ) : (
        <ErroDoCampo texto={erros.implemento} />
      )}
      {form.bem?.id ? <Grupo titulo="Uso" /> : null}
      {blocoMedidor}
      {comObservacao ? (
        <CampoTextoLongo label="Observação" value={form.observacao} onChange={(v) => mudar({ observacao: v }, ["observacao"])} readOnly={bloqueado} maxLength={MAX_OBSERVACAO_LINHA} />
      ) : null}
    </>
  );
}

// ─── Campos da linha de MÃO DE OBRA (janela e "Repetir") ─────────────────

/** "Funcionário · Mensalista" / "Terceiro (prestador de serviço)". @param {any} o */
const detalheDaMaoObra = (o) =>
  o?.origem === ORIGEM_TERCEIRO
    ? "Terceiro (prestador de serviço)"
    : ["Funcionário", ROTULO_TIPO_FUNCIONARIO[String(o?.funcionario_tipo ?? "")] ?? ""].filter(Boolean).join(" · ");

/** Rótulo do custo unitário pela medida ("Custo da hora", "Custo da diária", "Custo da tarefa"). @param {string} medida */
const rotuloDoCusto = (medida) => (medida === "DIARIA" ? "Custo da diária" : medida === "TAREFA" ? "Custo da tarefa" : "Custo da hora");

/**
 * Campos da linha de mão de obra (D-PROD-208): funcionário ou terceiro → medida (sugerida pelo tipo do funcionário;
 * terceiro, hora) → quantidade → custo unitário (hora/diária do funcionário: do cadastro, só leitura; tarefa e
 * terceiro: digitado) → total calculado → observação.
 * @param {{
 *   form: import("@/lib/atividadeLinhasRegras").FormularioLinhaMaoObra,
 *   mudar: (mudanca: Record<string, any>, campos: string[]) => void,
 *   erros: Record<string, string>,
 *   bloqueado: boolean,
 *   prefixo: string,
 *   comObservacao?: boolean,
 *   tituloGrupo?: string|null,
 * }} props
 */
export function CamposDaLinhaMaoObra({ form, mudar, erros, bloqueado, prefixo, comObservacao = true, tituloGrupo = "Lançamento" }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const secoes = useContext(SecoesDoFormularioContext);
  const comTopo = Boolean(secoes?.topo);
  // Na janela (com seções) o formulário é enxuto; no "Repetir" (sem seções) ficam as notas e os campos de leitura de antes.
  const compacto = secoes !== null;
  const medida = form.tipo_medida;
  const unidade = unidadeDaMedida(medida);
  const { unitario, total } = custoDaLinhaMaoObra(form);
  const terceiro = form.parceiro?.origem === ORIGEM_TERCEIRO;
  const digitado = custoDigitado(medida, form.parceiro?.origem);
  // Edição com o mesmo funcionário e a mesma medida: o custo é o GRAVADO na linha (o servidor o mantém).
  const mantido = custoMantidoDaLinha(form);
  const deOnde = mantido ? "gravado na linha" : "do cadastro";
  return (
    <>
      {tituloGrupo === null ? null : <Grupo titulo={tituloGrupo} comTopo />}
      <SeletorPaginadoGestao
        rotulo="Funcionário ou terceiro"
        testId={`${prefixo}-parceiro`}
        chave={[RAIZ_CONSULTAS_ATIVIDADES, "mao-obra", empresaId]}
        buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesMaoObra({ q, cursor, limit }))}
        value={form.parceiro ? { id: form.parceiro.id, rotulo: form.parceiro.rotulo } : null}
        onChange={(o) => mudar(mudancaDaMaoObraEscolhida(o, form), ["parceiro", "tipo_medida", "custo_unitario"])}
        rotuloDaOpcao={(o) => String(o?.nome ?? "")}
        detalheDaOpcao={detalheDaMaoObra}
        readOnly={bloqueado}
        obrigatorio={!secoes?.opcional}
        erro={erros.parceiro}
        span={comTopo ? 6 : 12}
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
      <Grupo titulo="Quantidade e custo" />
      <CampoNumero
        label={unidade ? `Quantidade (${unidade})` : "Quantidade"}
        value={form.quantidade}
        onChange={(v) => mudar({ quantidade: v }, ["quantidade"])}
        locale={LOCALE_ATIVIDADE}
        limites={LIMITES_LINHA}
        readOnly={bloqueado}
        required={!secoes?.opcional || Boolean(form.parceiro?.id)}
        span={6}
        error={erros.quantidade}
        testId={`${prefixo}-quantidade`}
      />
      {digitado ? (
        <CampoNumero
          label={`${rotuloDoCusto(medida)} (R$)`}
          value={form.custo_unitario}
          onChange={(v) => mudar({ custo_unitario: v }, ["custo_unitario"])}
          locale={LOCALE_ATIVIDADE}
          limites={LIMITES_LINHA}
          readOnly={bloqueado}
          required={!secoes?.opcional || Boolean(form.parceiro?.id)}
          span={6}
          error={erros.custo_unitario}
          testId={`${prefixo}-custo-unitario`}
        />
      ) : (
        <ValorCalculado
          label={`${rotuloDoCusto(medida)} (${deOnde})`}
          valor={!form.parceiro ? "—" : formatarCustoLinha(unitario) || (mantido ? "Sem custo gravado" : "Sem custo no cadastro")}
          span={6}
          testId={`${prefixo}-custo-unitario`}
        />
      )}
      {!digitado ? <ErroDoCampo texto={erros.custo_unitario} /> : null}
      {terceiro && !compacto ? (
        <p className={NOTA} data-testid={`${prefixo}-terceiro`}>
          Terceiro (prestador de serviço): o custo unitário é sempre digitado.
        </p>
      ) : null}
      <ValorCalculado label="Total" valor={formatarCustoLinha(total) || "—"} span={6} testId={`${prefixo}-total`} />
      {!digitado && form.parceiro && !unitario ? (
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
 *   tituloGrupo?: string|null,
 * }} props
 */
export function CamposDaLinhaServico({ form, mudar, erros, bloqueado, prefixo, comObservacao = true, tituloGrupo = "Lançamento" }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const secoes = useContext(SecoesDoFormularioContext);
  const comTopo = Boolean(secoes?.topo);
  const unidade = form.servico?.unidade ?? "";
  const total = valorDaLinhaServico(form);
  return (
    <>
      {tituloGrupo === null ? null : <Grupo titulo={tituloGrupo} comTopo />}
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
        obrigatorio={!secoes?.opcional}
        erro={erros.servico}
        span={comTopo ? 6 : 12}
        maiusculas={false}
      />
      <SeletorPaginadoGestao
        rotulo="Parceiro (opcional)"
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
      <Grupo titulo="Valores" />
      <CampoNumero
        label={unidade ? `Quantidade (${unidade})` : "Quantidade"}
        value={form.quantidade}
        onChange={(v) => mudar({ quantidade: v }, ["quantidade"])}
        locale={LOCALE_ATIVIDADE}
        limites={LIMITES_LINHA}
        readOnly={bloqueado}
        required={!secoes?.opcional || Boolean(form.servico?.id)}
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
        required={!secoes?.opcional || Boolean(form.servico?.id)}
        span={6}
        error={erros.valor_unitario}
        testId={`${prefixo}-valor-unitario`}
      />
      <ValorCalculado label="Total" valor={formatarCustoLinha(total) || "—"} span={6} testId={`${prefixo}-total`} />
      <CampoTexto
        label="Documento (nota ou recibo)"
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
 * O dia que AINDA NÃO EXISTE (D-PROD-233, janela por tipo): a linha nasce junto com o lançamento do dia, no MESMO
 * envio — `criarApontamento` com a coleção da linha (uma transação no servidor, com o `operation_id` persistente do
 * lançamento com linhas, o mesmo do "Repetir"). `corpo` devolve o corpo do dia já conferido (data, área do dia…) ou
 * `null` quando o cabeçalho da janela tem erro (quem chama avisa); `idsAntes` são os lançamentos que já existiam (o
 * "Consultar" acha o novo); `aoRecusar` recebe a recusa definitiva (ela pode apontar um campo do dia).
 * @typedef {{ corpo: () => Record<string, any> | null, idsAntes: Set<string>, aoRecusar?: (erro: unknown) => void }} NovoDia
 */

/**
 * O que a casca da janela recebe: o padrão é a janela própria (`Janela`, abaixo); a janela por tipo (D-PROD-233) troca
 * por uma casca embutida na aba "Dados", com Voltar / Salvar / Salvar e fechar.
 * @typedef {{ titulo: string, testId: string, enviando: boolean, rotuloEnvio: string, incerto: boolean,
 *   podeEnviar: boolean, formId: string, onFechar: () => void, onEnviar: () => void, children: React.ReactNode }} PropsDaCasca
 */

/**
 * @typedef {{
 *   atividade: any,
 *   apontamento: any,
 *   linha?: any,
 *   escopo: string,
 *   onSalvo: (resultado: { apontamento: any, atividade: any, alertas: any[] }, texto: string, extra?: { bem: ReturnType<typeof bemParaAbastecer> }) => void,
 *   onCancelar: () => void,
 *   onMudou?: (() => void) | null,
 *   novoDia?: NovoDia | null,
 *   atividadeAreaId?: string|null,
 *   Casca?: React.ComponentType<PropsDaCasca>,
 * }} PropsDaJanela `atividadeAreaId` (a área do lançamento; padrão, a do apontamento): a dose/ha do produto usa a Feita dessa área, ou a planejada; `novoDia` (só ao adicionar): `apontamento` é o dia ainda não gravado (`{ id: null, data_operacional,
 *   area_executada_dia }`) e a linha vai no lançamento novo. `Casca`: onde o formulário aparece (padrão: a janela própria).
 */

/**
 * A janela em curso, com o corpo, o rodapé e as folhas do celular dentro dela.
 * @param {PropsDaCasca} props
 */
function Janela({ titulo, testId, enviando, rotuloEnvio, incerto, podeEnviar, formId, onFechar, onEnviar, children }) {
  const [alvoFolha, setAlvoFolha] = useState(/** @type {HTMLElement | null} */ (null));
  // D-PROD-252: no celular a janela de uma linha ocupa a tela (como a do lançamento novo), sem caixa flutuante.
  const celular = useCelular();
  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      podeFechar={!enviando}
      aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
      titulo={titulo}
      testId={testId}
      className={celular ? "b1-janela--tela-cheia" : ""}
      // Os botões daqui seguem as ações da tela (lançar/editar apontamento): a heurística de texto do Layout não vale.
      contentProps={{ "data-permissao-explicita": "", "data-celular": celular ? "" : undefined, className: celular ? "b1-janela__camada--tela-cheia" : undefined }}
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
          <SecoesDoFormularioContext.Provider value={{ topo: null }}>{children}</SecoesDoFormularioContext.Provider>
        </form>
      </MobileSheetPortalCtx.Provider>
    </B1Janela>
  );
}

/** Ids das linhas do apontamento (para o "Consultar" achar a linha nova). @param {any} ap @param {'produtos'|'maquinas'|'mao-obra'|'servicos'} tipo */
const idsDasLinhas = (ap, tipo) => new Set(linhasDoTipo(ap, tipo).map((l) => String(l.id)));

/**
 * @typedef {{ tipo: TipoDeLinha, atividadeId: string, apontamento: any, linha: any, escopo: string, novoDia: NovoDia | null }} DestinoDoEnvio
 * @typedef {{ dados: Record<string, any>, versao: number|null, dia?: Record<string, any> | null }} ArgDoEnvio
 */

/**
 * O envio da linha: editar (cancela e cria outra), adicionar ao dia que existe ou — sem o dia (D-PROD-233) — o
 * lançamento novo do dia com a linha dentro. O `arg` guarda o corpo do dia do PRIMEIRO envio: a retentativa repete
 * exatamente aquele corpo (a pendência casa a chave).
 * @param {DestinoDoEnvio} d
 */
const envioDaLinha = ({ tipo, atividadeId, apontamento, linha, escopo, novoDia }) =>
  /** @param {ArgDoEnvio} arg @param {{ retentativa: boolean }} o */
  (arg, o) => {
    const opcoes = { escopo, retentativa: o.retentativa };
    if (linha?.id) return editarLinha(tipo, atividadeId, { id: String(apontamento.id), versao: /** @type {number} */ (arg.versao) }, linha, arg.dados, opcoes);
    if (novoDia) return criarApontamento(atividadeId, { ...(arg.dia ?? {}), [COLECAO_DA_LINHA[tipo]]: [arg.dados] }, opcoes);
    return adicionarLinha(tipo, atividadeId, { id: String(apontamento.id), versao: /** @type {number} */ (arg.versao) }, arg.dados, opcoes);
  };

/** A chave da pendência do envio (a mesma que o service usou). @param {DestinoDoEnvio} d */
const alvoDoEnvio = ({ tipo, atividadeId, apontamento, linha, novoDia }) =>
  linha?.id ? alvoDaLinha(tipo, String(linha.id)) : novoDia ? alvoDosApontamentos(atividadeId) : alvoDasLinhas(tipo, String(apontamento.id));

/**
 * O argumento do envio: o corpo da linha, a `versao` do dia e, sem o dia, o corpo dele (null = o cabeçalho da janela
 * tem erro: nada sai).
 * @param {NovoDia | null} novoDia @param {any} apontamento @param {Record<string, any>} dados
 * @returns {ArgDoEnvio | null}
 */
const argDoEnvio = (novoDia, apontamento, dados) => {
  if (!novoDia) return { dados, versao: apontamento?.versao ?? null };
  const dia = novoDia.corpo();
  return dia ? { dados, versao: null, dia } : null;
};

/**
 * "Consultar" depois de um envio sem resposta: relê o dia (ou, sem ele, os lançamentos da atividade, à procura do
 * lançamento novo daquele dia que nasceu com a linha) e devolve o apontamento que mostra o efeito, ou null.
 * @param {DestinoDoEnvio & { gravou: (linhas: any[]) => boolean }} p
 */
const lerEfeitoDoEnvio = async ({ tipo, atividadeId, apontamento, novoDia, gravou }) => {
  if (!novoDia) {
    const lido = /** @type {any} */ (await obterApontamento(atividadeId, String(apontamento.id)));
    return gravou(linhasDoTipo(lido, tipo)) ? lido : null;
  }
  const dia = String(apontamento?.data_operacional ?? "");
  const itens = itensDaLista(await listarApontamentos(atividadeId));
  return (
    itens.find(
      (ap) => ap?.status === STATUS_CONFIRMADO && String(ap.data_operacional ?? "") === dia && !novoDia.idsAntes.has(String(ap.id)) && gravou(linhasDoTipo(ap, tipo)),
    ) ?? null
  );
};

/**
 * Janela da linha de PRODUTO (adicionar ou editar). A baixa sai do estoque pelo MESMO motor (custo médio) do abastecimento, no
 * servidor; editar = estorno exato + nova saída. Toda escrita leva a `versao` do apontamento e o `operation_id`
 * persistente.
 * D-PROD-293: `tanque` (o implemento "por jato" do dia ou da atividade) mostra o "Jato nº"; `jatoSugerido`, o número da linha nova.
 * @param {PropsDaJanela & { tanque?: { capacidade: string, unidade: string|null } | null, jatoSugerido?: number|null }} props
 */
export function JanelaLinhaProduto({ atividade, apontamento, linha = null, escopo, onSalvo, onCancelar, onMudou = null, novoDia = null, atividadeAreaId = null, Casca = Janela, tanque = null, jatoSugerido = null }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const editando = Boolean(linha?.id);
  const atividadeId = String(atividade?.id ?? "");
  // A dose/ha divide pelos hectares da área: a Feita (a soma do servidor) ou, sem ela, a planejada. A leitura é a dos totais da tela.
  const totaisQuery = useQuery({
    queryKey: chaveTotais(empresaId, atividadeId),
    queryFn: () => obterTotaisAtividade(atividadeId),
    enabled: Boolean(empresaId && atividadeId),
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  });
  const hectaresDaDose = hectaresParaDose({ atividade, totais: totaisQuery.data ?? null, areaId: atividadeAreaId ?? apontamento?.atividade_area_id ?? null });
  // D-PROD-293: com implemento "por jato", a linha avulsa também diz o jato (a nova já vem com o jato sugerido).
  const [form, setForm] = useState(() =>
    editando ? formularioDaLinhaProduto(linha) : { ...formularioProdutoVazio(), ...(tanque && Number.isInteger(jatoSugerido) && jatoSugerido > 0 ? { jato: jatoSugerido } : {}) },
  );
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const saldo = useSaldoDoProduto(empresaId, form, setForm, editando ? linha : null);
  const antes = useRef(idsDasLinhas(apontamento, LINHA_PRODUTO));
  const fallback = editando ? "Não foi possível alterar o produto. Nada foi alterado." : "Não foi possível lançar o produto. Nada foi gravado.";
  /** @type {DestinoDoEnvio} */
  const destino = { tipo: LINHA_PRODUTO, atividadeId, apontamento, linha, escopo, novoDia: editando ? null : novoDia };

  const { estado, setEstado, disparar, esquecerUltimo } = useEnvioDaLinha(envioDaLinha(destino), (e) => mensagemDeErroLinha(e, fallback, { unidade: saldo.unidade }));
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
      // D-PROD-293: tirar o jato da linha que tinha um.
      if (Number.isInteger(linha?.jato) && !Number.isInteger(form.jato)) dados.jato = null;
      if (!Object.keys(dados).length) {
        notifyInfo("Sem alterações", "Nada foi alterado.");
        onCancelar();
        return;
      }
    }
    const arg = argDoEnvio(destino.novoDia, apontamento, dados);
    if (!arg) return;
    const r = await disparar(arg);
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
    if (!ehResultadoIncerto(r.erro) && /** @type {any} */ (r.erro)?.code !== CODIGO_ENVIO_PENDENTE) {
      destino.novoDia?.aoRecusar?.(r.erro);
      notifyWarning("Atenção", mensagem);
    }
  };

  /** "Consultar" depois de um envio sem resposta: o apontamento relido mostra o efeito? */
  const consultar = async () => {
    try {
      const lido = await lerEfeitoDoEnvio({
        ...destino,
        gravou: (produtos) =>
          editando
            ? produtos.some((l) => String(l.id) === String(linha.id) && l.status === STATUS_CANCELADO)
            : produtos.some((l) => !antes.current.has(String(l.id)) && l.status === STATUS_CONFIRMADO && String(l.produto_id) === String(form.produto?.id ?? "")),
      });
      if (lido) {
        limparPendenciaDaLinha(escopo, editando ? ACAO_EDITAR_LINHA : ACAO_LANCAR_LINHA, alvoDoEnvio(destino));
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
    <Casca
      titulo={editando ? `Editar produto ${rotuloDoProdutoDaLinha(linha)}`.trim() : "Adicionar produto"}
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
        areaDoDia={hectaresDaDose}
        bloqueado={enviando}
        prefixo="linha-produto"
      />
      {tanque || Number.isInteger(form.jato) ? (
        <CampoTexto
          label="Jato nº"
          value={Number.isInteger(form.jato) ? String(form.jato) : ""}
          onChange={(v) => {
            const n = Number(String(v).replace(/\D/g, "").slice(0, 3));
            mudar({ jato: n > 0 ? n : null }, ["jato"]);
          }}
          readOnly={enviando}
          span={6}
          inputMode="numeric"
          maxLength={3}
          keepCase
          dica={<p className="mt-1 px-1 text-[12px] text-[var(--mg-text-2,#475569)]">o jato do dia em que este produto foi (em branco: sem jato)</p>}
          testId="linha-produto-jato"
        />
      ) : null}
      <div className="col-span-12 min-w-0">
        <AvisoEnvioDaLinha estado={estado} produto onRepetir={() => void salvar()} onConsultar={() => void consultar()} />
      </div>
    </Casca>
  );
}

/**
 * Janela da linha de MÁQUINA (adicionar ou editar). A máquina do cabeçalho vem como sugestão; o medidor (tipo e
 * unidade) é do bem; a leitura inicial é sugerida pela vigente e a final é obrigatória; "sem medidor" informa o uso.
 * Passou do teto (ou o servidor respondeu ATIVIDADE_SALTO_MEDIDOR): a justificativa aparece e o envio repete com ela.
 * @param {PropsDaJanela & { permiteImplemento: boolean }} props
 */
export function JanelaLinhaMaquina({ atividade, apontamento, linha = null, permiteImplemento, escopo, onSalvo, onCancelar, onMudou = null, novoDia = null, Casca = Janela }) {
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
  /** @type {DestinoDoEnvio} */
  const destino = { tipo: LINHA_MAQUINA, atividadeId, apontamento, linha, escopo, novoDia: editando ? null : novoDia };

  const { estado, setEstado, disparar, esquecerUltimo } = useEnvioDaLinha(envioDaLinha(destino), (e) => mensagemDeErroLinha(e, fallback, { medidorUnidade: medidor?.unidade ?? null }));
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
    const arg = argDoEnvio(destino.novoDia, apontamento, dados);
    if (!arg) return;
    const r = await disparar(arg);
    if (!r) return;
    if (r.ok) {
      onSalvo(normalizarRespostaDeEscrita(r.resposta), editando ? `Máquina ${nome} alterada.` : `Máquina ${nome} lançada${uso ? ` (${formatarUso(uso, medidor.tipo, medidor.unidade)})` : ""}.`, { bem: bemParaAbastecer({ id: form.bem?.id, rotulo: form.bem?.rotulo, medidorTipo: medidor.tipo }) });
      return;
    }
    if (ehSaltoDoMedidor(r.erro)) setSaltoPedido(true);
    const campo = campoDaLinhaRecusada(r.erro);
    const mensagem = mensagemDeErroLinha(r.erro, fallback, { medidorUnidade: medidor.unidade });
    if (campo) setErros((e) => ({ ...e, [campo]: mensagem }));
    if (ehResultadoIncerto(r.erro) || pedeReleitura(r.erro)) onMudou?.();
    if (!ehResultadoIncerto(r.erro) && /** @type {any} */ (r.erro)?.code !== CODIGO_ENVIO_PENDENTE) {
      destino.novoDia?.aoRecusar?.(r.erro);
      notifyWarning("Atenção", mensagem);
    }
  };

  const consultar = async () => {
    try {
      const lido = await lerEfeitoDoEnvio({
        ...destino,
        gravou: (maquinas) =>
          editando
            ? maquinas.some((l) => String(l.id) === String(linha.id) && l.status === STATUS_CANCELADO)
            : maquinas.some((l) => !antes.current.has(String(l.id)) && l.status === STATUS_CONFIRMADO && String(l.bem_id) === String(form.bem?.id ?? "")),
      });
      if (lido) {
        limparPendenciaDaLinha(escopo, editando ? ACAO_EDITAR_LINHA : ACAO_LANCAR_LINHA, alvoDoEnvio(destino));
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
    <Casca
      titulo={editando ? `Editar máquina ${nome}`.trim() : "Adicionar máquina"}
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
      <div className="col-span-12 min-w-0">
        <AvisoEnvioDaLinha estado={estado} produto={false} onRepetir={() => void salvar()} onConsultar={() => void consultar()} />
      </div>
    </Casca>
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
  novoDia = null,
  Casca = Janela,
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
}) {
  const editando = Boolean(linha?.id);
  const atividadeId = String(atividade?.id ?? "");
  const [form, setForm] = useState(formInicial);
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const antes = useRef(idsDasLinhas(apontamento, tipo));
  const fallback = editando ? rotulos.falhaEdicao : rotulos.falha;
  /** @type {DestinoDoEnvio} */
  const destino = { tipo, atividadeId, apontamento, linha, escopo, novoDia: editando ? null : novoDia };

  const { estado, setEstado, disparar, esquecerUltimo } = useEnvioDaLinha(envioDaLinha(destino), (e) => mensagemDeErroLinha(e, fallback));
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
    const arg = argDoEnvio(destino.novoDia, apontamento, dados);
    if (!arg) return;
    const r = await disparar(arg);
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
    if (!ehResultadoIncerto(r.erro) && /** @type {any} */ (r.erro)?.code !== CODIGO_ENVIO_PENDENTE) {
      destino.novoDia?.aoRecusar?.(r.erro);
      notifyWarning("Atenção", mensagem);
    }
  };

  /** "Consultar" depois de um envio sem resposta: o apontamento relido mostra o efeito? */
  const consultar = async () => {
    try {
      const lido = await lerEfeitoDoEnvio({
        ...destino,
        gravou: (linhas) =>
          editando
            ? linhas.some((l) => String(l.id) === String(linha.id) && l.status === STATUS_CANCELADO)
            : linhas.some((l) => !antes.current.has(String(l.id)) && l.status === STATUS_CONFIRMADO && String(l[campoDoCadastro]) === String(idDoCadastro(form) ?? "")),
      });
      if (lido) {
        limparPendenciaDaLinha(escopo, editando ? ACAO_EDITAR_LINHA : ACAO_LANCAR_LINHA, alvoDoEnvio(destino));
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
    <Casca
      titulo={editando ? rotulos.tituloEdicao.replace("{nome}", nome).trim() : rotulos.titulo}
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
      <div className="col-span-12 min-w-0">
        <AvisoEnvioDaLinha estado={estado} produto={false} lancado={rotulos.lancado} onRepetir={() => void salvar()} onConsultar={() => void consultar()} />
      </div>
    </Casca>
  );
}

/**
 * Janela da linha de MÃO DE OBRA (adicionar ou editar; Fatia 4, D-PROD-208). Funcionário ou terceiro (parceiro).
 * Hora e diária do funcionário: o custo unitário é o do cadastro dele (snapshot no servidor, só mostrado); tarefa e
 * terceiro: digitado. A medida vem sugerida pelo tipo do funcionário.
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
      idDoCadastro={(f) => f.parceiro?.id ?? null}
      campoDoCadastro="parceiro_id"
      nome={(f) => f.parceiro?.rotulo ?? (rotuloDaMaoObraDaLinha(linha) || "Funcionário ou terceiro")}
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
    />
  );
}

// ─── Cancelamento da linha (motivo; o produto volta exatamente aos lotes de origem) ─

/** Formatação das mensagens do diálogo de ação (o custo aparece em reais). */
const CONTEXTO_MENSAGENS = Object.freeze({ locale: LOCALE_ATIVIDADE, moeda: "BRL", casas: 2 });

/**
 * @typedef {'produtos'|'maquinas'|'mao-obra'|'servicos'} TipoDeLinha
 * @typedef {{ tipo: TipoDeLinha, linha: any, apontamento: any }} CancelamentoDaLinha
 */

/** O nome da linha no diálogo de cancelamento e nas mensagens. @param {string} tipo @param {any} l */
export const nomeDaLinhaDoTipo = (tipo, l) => {
  if (tipo === LINHA_PRODUTO) return `o produto ${rotuloDoProdutoDaLinha(l) || ""}`.trim();
  if (tipo === LINHA_MAQUINA) return `a máquina ${rotuloDaMaquinaDaLinha(l) || ""}`.trim();
  if (tipo === LINHA_MAO_OBRA) return `a mão de obra ${rotuloDaMaoObraDaLinha(l) ? `de ${rotuloDaMaoObraDaLinha(l)}` : ""}`.trim();
  return `o serviço ${rotuloDoServicoDaLinha(l) || ""}`.trim();
};

/** O que acontece ao cancelar cada tipo de linha (a descrição do diálogo). */
const EFEITO_DO_CANCELAMENTO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    [LINHA_PRODUTO]: "A quantidade volta aos lotes de onde saiu; se houve outros movimentos do produto no depósito depois, o custo médio deles é recalculado.",
    [LINHA_MAQUINA]: "A leitura desta linha deixa de contar como leitura atual do bem.",
    [LINHA_MAO_OBRA]: "O custo desta mão de obra deixa de contar na atividade.",
    [LINHA_SERVICO]: "O valor deste serviço deixa de contar na atividade.",
  }),
);

/** A frase do sucesso do cancelamento. @param {CancelamentoDaLinha} c */
const textoDoCancelado = (c) => {
  if (c.tipo === LINHA_PRODUTO) return `Produto ${rotuloDoProdutoDaLinha(c.linha)} cancelado: a quantidade voltou ao estoque, aos lotes de origem.`;
  if (c.tipo === LINHA_MAQUINA) return `Máquina ${rotuloDaMaquinaDaLinha(c.linha)} cancelada: a leitura dela deixa de contar.`;
  if (c.tipo === LINHA_MAO_OBRA) return `Mão de obra de ${rotuloDaMaoObraDaLinha(c.linha)} cancelada: o custo dela deixa de contar.`;
  return `Serviço ${rotuloDoServicoDaLinha(c.linha)} cancelado: o valor dele deixa de contar.`;
};

/**
 * Diálogo "Cancelar linha" (motivo de 3 a 500 caracteres, conferido pelo serviço ANTES da rede): a `versao` é a do
 * apontamento lida ao abrir e o `operation_id` é persistente; sem resposta, "Consultar" relê o apontamento. Usado
 * pelos blocos do lançamento (`LinhasDoApontamento`) e pela janela por tipo (D-PROD-233).
 * @param {{
 *   atividade: any,
 *   cancelando: CancelamentoDaLinha,
 *   escopo: string,
 *   onCancelada: (resultado: { apontamento: any, atividade: any, alertas: any[] }, texto: string) => void,
 *   onFechar: () => void,
 *   onMudou: () => void,
 * }} props `onCancelada` recebe a resposta da escrita; `onMudou` relê (sem resposta, recusa que pede releitura, ou o
 *   "Consultar" que achou o cancelamento gravado).
 */
export function DialogoCancelarLinha({ atividade, cancelando, escopo, onCancelada, onFechar, onMudou }) {
  const atividadeId = String(atividade?.id ?? "");
  const apId = String(cancelando.apontamento?.id ?? "");
  const nome = nomeDaLinhaDoTipo(cancelando.tipo, cancelando.linha);
  const empresaId = useEmpresaRealSelecionadaId();
  // D-PROD-273 (fatia 4): a linha de produto mostra a prévia do recálculo do que veio depois antes de confirmar.
  const previa = cancelando.tipo === LINHA_PRODUTO && cancelando.linha?.movimentacao_estoque_id
    ? <PreviaRecalculoExclusao empresaId={empresaId} movimentoIds={[cancelando.linha.movimentacao_estoque_id]} />
    : null;

  /** @param {string} motivo @param {{ retentativa: boolean }} o */
  const enviar = async (motivo, o) => {
    try {
      const r = normalizarRespostaDeEscrita(
        await cancelarLinha(cancelando.tipo, atividadeId, cancelando.apontamento, cancelando.linha, motivo, { escopo, retentativa: o?.retentativa === true }),
      );
      onCancelada(r, textoDoCancelado(cancelando));
    } catch (erro) {
      if (!ehResultadoIncerto(erro)) notifyWarning("Atenção", mensagemDeErroLinha(erro, "Não foi possível cancelar a linha. Nada foi alterado."));
      if (ehResultadoIncerto(erro) || pedeReleitura(erro)) onMudou();
      throw erro;
    }
  };

  /** "Consultar" depois de um cancelamento sem resposta: o apontamento relido mostra a linha cancelada? */
  const consultar = async () => {
    try {
      const lido = /** @type {any} */ (await obterApontamento(atividadeId, apId));
      const atual = linhasDoTipo(lido, cancelando.tipo).find((l) => String(l.id) === String(cancelando.linha.id));
      if (atual?.status === STATUS_CANCELADO) {
        limparPendenciaDaLinha(escopo, ACAO_CANCELAR_LINHA, alvoDaLinha(cancelando.tipo, String(cancelando.linha.id)));
        onFechar();
        notifySuccess("Linha cancelada", `O cancelamento de ${nome} foi gravado.`);
        onMudou();
      } else {
        notifyInfo("Ainda confirmada", "O cancelamento não aparece gravado. Repita o envio: com a mesma chave, ele não é gravado duas vezes.");
      }
    } catch (erro) {
      notifyWarning("Atenção", mensagemDeErroLinha(erro, "Não foi possível consultar agora. Tente de novo."));
    }
  };

  return (
    <DialogoAcao
      aberto
      janelaBase1
      titulo={`Cancelar ${nome} do lançamento de ${formatarDiaAtividade(cancelando.apontamento?.data_operacional)}`}
      descricao={`${EFEITO_DO_CANCELAMENTO[cancelando.tipo] ?? ""} A linha fica no histórico como cancelada. Motivo com pelo menos ${MOTIVO_MINIMO} caracteres.`}
      rotuloBotao="Cancelar linha"
      testId="dialogo-cancelar-linha"
      contexto={CONTEXTO_MENSAGENS}
      onFechar={onFechar}
      onEnviar={enviar}
      onConsultar={consultar}
      conteudo={previa}
    />
  );
}
