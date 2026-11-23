import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, FlaskConical, Fuel, Loader2, ReceiptText, Tractor, User } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { MobileSheetPortalCtx, useCelular } from "@/components/common/MobileSheet";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { CampoDia } from "@/components/financeiroGestao/CamposLancamento";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { JanelaLinhaMaoObra, JanelaLinhaMaquina, JanelaLinhaProduto, JanelaLinhaServico, SecoesDoFormularioContext } from "@/components/lancamento-atividades/JanelasDaLinha";
import JanelaAbastecimentoDaArea from "@/components/lancamento-atividades/JanelaAbastecimentoDaArea";
import { useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAcoesTelaAbastecimento } from "@/hooks/usePatrimonioSessao";
import { QUERY_RAIZ_ABASTECIMENTOS } from "@/hooks/useFluxoAbastecimento";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import {
  STATUS_ABERTA,
  STATUS_CANCELADA,
  STATUS_CONCLUIDA,
  acoesDaAtividade,
  formatarDiaAtividade,
  mensagemDeErroAtividade,
  mensagemDoAlertaAtividade,
} from "@/lib/lancamentoAtividadesRegras";
import {
  CAMPO_DO_FORMULARIO_APONTAMENTO,
  campoDoFormulario,
  chaveApontamentos,
  confirmadosDoDia,
  corpoDoApontamento,
  foraDoPeriodo,
  formularioApontamentoVazio,
  itensDaLista,
  textoDoPeriodo,
  validarFormularioApontamento,
} from "@/lib/atividadeApontamentoRegras";
import { LINHA_MAO_OBRA, LINHA_MAQUINA, LINHA_PRODUTO, LINHA_SERVICO, chaveTotais } from "@/lib/atividadeLinhasRegras";
import { listarApontamentos } from "@/services/lancamentoAtividadesService";
import { STATUS_AREA, areaDaAtividadePorId, temAreas } from "@/lib/atividadeAreasRegras";

/**
 * Os quatro lançamentos por tipo (D-PROD-232 / D-PROD-233, protótipo do proprietário), cada um com a linha que ele
 * grava no dia: Trabalho de máquinas = linhas de máquina, Aplicação de insumos = linhas de produto, Mão de obra =
 * linhas de mão de obra, Custos extras = linhas de serviço. `flag`: o que o TIPO da atividade precisa permitir
 * (máquina não depende de flag). `aba`: o nome da aba da lista.
 * @type {ReadonlyArray<{ tipo: string, rotulo: string, aba: string, flag: 'permiteProduto'|'permiteMaoObra'|'permiteServico'|null, Icone: any }>}
 */
export const LANCAMENTOS_POR_TIPO = Object.freeze([
  { tipo: LINHA_MAQUINA, rotulo: "Trabalho de máquinas", aba: "Trabalhos de máquinas", flag: null, Icone: Tractor },
  { tipo: LINHA_PRODUTO, rotulo: "Aplicação de insumos", aba: "Insumos aplicados", flag: "permiteProduto", Icone: FlaskConical },
  { tipo: LINHA_MAO_OBRA, rotulo: "Mão de obra", aba: "Lançamentos de mão de obra", flag: "permiteMaoObra", Icone: User },
  { tipo: LINHA_SERVICO, rotulo: "Custos extras", aba: "Custos extras", flag: "permiteServico", Icone: ReceiptText },
]);

/** @param {string} tipo */
export const lancamentoDoTipo = (tipo) => LANCAMENTOS_POR_TIPO.find((l) => l.tipo === tipo) ?? null;

/**
 * D-PROD-278 — os lançamentos que a operação da atividade permite (a mesma regra do `tipoPermitido` da janela: máquina
 * sempre; os outros pela chave do tipo). `flags`: `flagsDoTipoDaAtividade`.
 * @param {{ permiteProduto?: boolean, permiteMaoObra?: boolean, permiteServico?: boolean } | null | undefined} flags
 */
export const lancamentosPermitidos = (flags) => LANCAMENTOS_POR_TIPO.filter((l) => !l.flag || flags?.[l.flag] === true);

/** Texto auxiliar (o tom das notas dos formulários do motor). */
const NOTA = "min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";

/** O que a janela faz depois de gravar o item: fechar, deixar o formulário vazio ou abrir o abastecimento da máquina. @typedef {'fechar'|'novo'|'abastecer'} DepoisDeSalvar */

/** O rodapé da janela (alvo dos botões do formulário), o "fechar depois de salvar" e o Dia, que entra na grade do formulário. */
const ContextoDados = createContext(
  /** @type {{ alvoRodape: HTMLElement | null, marcarFechar: (depois: DepoisDeSalvar) => void, onCancelar: () => void, topo: React.ReactNode, podeAbastecer: boolean }} */ ({ alvoRodape: null, marcarFechar: () => {}, onCancelar: () => {}, topo: null, podeAbastecer: false }),
);

/**
 * A casca do formulário (D-PROD-252): o formulário da janela de linha (`JanelasDaLinha`: os campos, a validação, o saldo, o
 * medidor, os custos e o `operation_id` são os MESMOS) direto na janela, com os botões no rodapé dela — Cancelar, Salvar
 * (grava e fecha) e Salvar e novo (grava e deixa um formulário vazio para o próximo item).
 * @param {import("@/components/lancamento-atividades/JanelasDaLinha").PropsDaCasca} props
 */
function CascaDoFormulario({ testId, enviando, incerto, podeEnviar, formId, onEnviar, children }) {
  const { alvoRodape, marcarFechar, onCancelar, topo, podeAbastecer } = useContext(ContextoDados);
  /** @param {DepoisDeSalvar} depois */
  const enviar = (depois) => {
    marcarFechar(depois);
    onEnviar();
  };
  const botoes = (
    <>
      <button type="button" className={BOTAO_SECUNDARIO} onClick={onCancelar} disabled={enviando} data-testid="janela-tipo-cancelar">
        Cancelar
      </button>
      <button type="button" className={BOTAO_PRIMARIO} onClick={() => enviar("fechar")} disabled={enviando || !podeEnviar} data-testid="janela-tipo-salvar">
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
        {enviando ? "Salvando…" : incerto ? "Repetir o mesmo envio" : "Salvar"}
      </button>
      <button type="button" className={BOTAO_PRIMARIO} onClick={() => enviar("novo")} disabled={enviando || !podeEnviar} data-testid="janela-tipo-salvar-novo">
        <CheckCheck className="h-4 w-4" aria-hidden />
        Salvar e novo
      </button>
      {podeAbastecer ? (
        <button type="button" className={BOTAO_PRIMARIO} onClick={() => enviar("abastecer")} disabled={enviando || !podeEnviar} data-testid="janela-tipo-salvar-abastecer">
          <Fuel className="h-4 w-4" aria-hidden />
          Salvar e abastecer
        </button>
      ) : null}
    </>
  );
  return (
    <>
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          enviar("fechar");
        }}
        className="b1 mg-b1-form-grid b1-form-embutido"
        data-densidade={DENSIDADE_BASE1}
        noValidate
        data-testid={`${testId}-form`}
      >
        <SecoesDoFormularioContext.Provider value={{ topo }}>{children}</SecoesDoFormularioContext.Provider>
      </form>
      {alvoRodape ? createPortal(botoes, alvoRodape) : null}
    </>
  );
}

/**
 * Janela de UM lançamento novo (D-PROD-252, reorganiza a D-PROD-233): o botão "+ Máquina / Produto / Mão de obra /
 * Serviço" da tela da área abre direto o formulário, num nível só de janela — sem abas, sem o dia com setas, sem o campo
 * Área travado e sem "Área do dia". Emenda 3: é a janela padrão do Base1 (680px, a mesma de todas as janelas desta tela),
 * com o título do tipo (sem subtítulo: a área e a atividade já estão no cabeçalho da tela) e o formulário em grupos Base1
 * (Lançamento, e depois Quantidade / Uso / Valores) numa grade só: o Dia (hoje, no fuso da fazenda, por padrão; nunca
 * depois de hoje) é o primeiro campo do grupo Lançamento, e os demais são os MESMOS das janelas de linha (`JanelasDaLinha`).
 *
 * A regra do dia (D-PROD-233) segue: ninguém "cria o dia". Sem lançamento CONFIRMADO da área na data, o primeiro item salvo
 * cria o lançamento do dia no MESMO envio (`criarApontamento` com a linha dentro — uma transação, `operation_id`
 * persistente); com um (ou mais — turnos / passadas — e então o mais recente), o item entra nele. A área vem presa
 * (`areaId`) e é a que o servidor confere. Depois de cada escrita, a lista, os lançamentos e os totais se relêem.
 *
 * No celular a janela ocupa a tela (`b1-janela--tela-cheia`, o mesmo padrão dos outros lançamentos do app): nada de caixa
 * flutuante sobre o fundo escurecido. Editar e Cancelar uma linha são do ⚡ da tabela da área (`LancamentosDaArea`).
 *
 * @param {{
 *   atividade: any,
 *   tipo: string,
 *   acoes: Record<string, any>,
 *   flags: { permiteProduto: boolean, permiteImplemento: boolean, permiteMaoObra: boolean, permiteServico: boolean },
 *   escopo: string,
 *   onFechar: () => void,
 *   onAtividadeAtualizada?: (atividade: any | null) => void,
 *   areaInicial?: string|null,
 * }} props `areaInicial`: a área da atividade onde o lançamento entra (atividade sem áreas: null). `acoes`: as da tela
 *   (`useAcoesTelaAtividades`); `onAtividadeAtualizada`: depois de toda escrita (o cabeçalho com os totais recalculados,
 *   quando o servidor o devolve).
 */
export default function JanelaLancamentoPorTipo({ atividade: atividadeRecebida, tipo, acoes, flags, escopo, onFechar, onAtividadeAtualizada = undefined, areaInicial = null }) {
  const [atividade, setAtividadeLocal] = useState(atividadeRecebida);
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const { fuso, hoje } = useFusoDaFazenda(empresaId);
  const celular = useCelular();
  const doTipo = lancamentoDoTipo(tipo) ?? LANCAMENTOS_POR_TIPO[0];
  const atividadeId = atividade?.id ? String(atividade.id) : null;
  const chave = chaveApontamentos(empresaId, atividadeId);

  // ─── Permissões e status ─────────────────────────────────────────────
  const ac = acoesDaAtividade(atividade, acoes);
  const aberta = atividade?.status === STATUS_ABERTA;
  const gravavel = Boolean(empresaId) && Boolean(fuso) && aberta;
  const tipoPermitido = !doTipo.flag || flags?.[doTipo.flag] === true;
  const comAreas = temAreas(atividade);
  const areaId = areaInicial ? String(areaInicial) : "";
  const areaEscolhida = comAreas ? areaDaAtividadePorId(atividade, areaId) : null;
  const areaLanca = !comAreas || areaEscolhida?.status === STATUS_AREA.EM_ANDAMENTO;
  const podeLancar = gravavel && ac.lancarApontamento && tipoPermitido && areaLanca;

  // ─── O dia: hoje por padrão ──────────────────────────────────────────
  const [dia, setDia] = useState(hoje || "");
  // O "hoje" da fazenda pode chegar depois (o fuso lido agora): o dia acompanha até a pessoa mudar.
  const diaMexido = useRef(false);
  useEffect(() => {
    if (!diaMexido.current && hoje) setDia(hoje);
  }, [hoje]);
  const [errosDia, setErrosDia] = useState(/** @type {Record<string, string>} */ ({}));
  const [chaveForm, setChaveForm] = useState(0);
  const [alvoRodape, setAlvoRodape] = useState(/** @type {HTMLElement | null} */ (null));
  const [alvoFolha, setAlvoFolha] = useState(/** @type {HTMLElement | null} */ (null));
  const depoisDeSalvar = useRef(/** @type {DepoisDeSalvar} */ ("fechar"));
  const acoesAbastecimento = useAcoesTelaAbastecimento();
  // Abastecer é da máquina (D-PROD-254, emenda 1): só na janela do Trabalho de máquinas, com a tela Abastecimentos liberada.
  const podeAbastecer = tipo === LINHA_MAQUINA && acoesAbastecimento.ver === true && acoesAbastecimento.criar === true;
  const [abastecendo, setAbastecendo] = useState(/** @type {{ apontamento: any, bem: any } | null} */ (null));

  const consulta = useQuery({
    queryKey: chave,
    queryFn: () => listarApontamentos(/** @type {string} */ (atividadeId)),
    enabled: Boolean(empresaId && atividadeId && acoes?.ver),
    staleTime: 15 * 1000,
  });
  const todosOsItens = useMemo(() => itensDaLista(consulta.data), [consulta.data]);
  // Na atividade com áreas, só os lançamentos da área escolhida.
  const itens = useMemo(() => (comAreas ? todosOsItens.filter((a) => String(a?.atividade_area_id ?? "") === areaId) : todosOsItens), [todosOsItens, comAreas, areaId]);
  const apontamento = useMemo(() => confirmadosDoDia(itens, dia)[0] ?? null, [itens, dia]);

  // O Dia entra na MESMA grade do formulário (grupo "Lançamento", ao lado do item), e não numa grade à parte.
  const campoDia = (
    <CampoDia
      label="Dia"
      value={dia}
      onChange={(v) => {
        if (!v || (hoje && v > hoje)) return;
        diaMexido.current = true;
        setDia(v);
        setErrosDia({});
      }}
      max={hoje || undefined}
      span={6}
      error={errosDia.data_operacional}
      testId="janela-tipo-data"
    />
  );

  // O contexto é refeito a cada render: o Dia (campo) acompanha a data e os erros.
  const contextoDados = {
    alvoRodape,
    marcarFechar: (/** @type {DepoisDeSalvar} */ depois) => {
      depoisDeSalvar.current = depois;
    },
    podeAbastecer,
    onCancelar: onFechar,
    topo: campoDia,
  };

  // ─── Escritas ────────────────────────────────────────────────────────
  /** O lançamento devolvido entra na lista já (a `versao` nova vale para o próximo item); a releitura confirma. @param {any} ap */
  const mesclarNaLista = (ap) => {
    if (!ap || typeof ap !== "object" || ap.id == null) return;
    queryClient.setQueryData(chave, (/** @type {unknown} */ antigo) => {
      if (antigo === undefined) return antigo;
      const lista = itensDaLista(antigo);
      const existe = lista.some((x) => String(x?.id) === String(ap.id));
      const nova = existe ? lista.map((x) => (String(x?.id) === String(ap.id) ? ap : x)) : [...lista, ap];
      return Array.isArray(antigo) ? nova : { .../** @type {Record<string, any>} */ (antigo && typeof antigo === "object" ? antigo : {}), items: nova };
    });
  };

  /** Releitura: lançamentos, totais e a lista de atividades. */
  const releer = () => {
    queryClient.invalidateQueries({ queryKey: chave });
    queryClient.invalidateQueries({ queryKey: chaveTotais(empresaId, atividadeId) });
    onAtividadeAtualizada?.(null);
  };

  /**
   * Escrita concluída: lista, totais e avisos.
   * @param {{ apontamento: any, atividade: any, alertas: any[] }} r @param {string} textoDoServidor
   */
  const aplicarEscrita = (r, textoDoServidor) => {
    mesclarNaLista(r.apontamento);
    queryClient.invalidateQueries({ queryKey: chave });
    queryClient.invalidateQueries({ queryKey: chaveTotais(empresaId, atividadeId) });
    onAtividadeAtualizada?.(r.atividade && String(r.atividade.id) === atividadeId ? r.atividade : null);
    if (r.atividade && String(r.atividade.id) === atividadeId) setAtividadeLocal(r.atividade);
    const diaGravado = formatarDiaAtividade(r.apontamento?.data_operacional);
    const aviso = textoDoServidor;
    notifySuccess("Sucesso", aviso);
    const alertas = Array.isArray(r.alertas) ? r.alertas : [];
    if (alertas.length) notifyWarning("Atenção", `${diaGravado ? `${diaGravado}: ` : ""}${mensagemDoAlertaAtividade(alertas[0])}`);
  };

  // ─── O dia que ainda não existe: nasce com o primeiro item (a área do dia é opcional e fica para o formulário do dia) ──
  const formDoDia = { ...formularioApontamentoVazio(dia), atividade_area_id: comAreas ? areaId : "" };
  const idsAntes = useMemo(() => new Set(todosOsItens.map((a) => String(a?.id))), [todosOsItens]);
  /** @type {import("@/components/lancamento-atividades/JanelasDaLinha").NovoDia | null} */
  const novoDia = apontamento
    ? null
    : {
        idsAntes,
        corpo: () => {
          const v = validarFormularioApontamento(formDoDia, { hoje });
          setErrosDia(v);
          if (Object.keys(v).length) {
            notifyWarning("Atenção", v.data_operacional ?? "Revise o dia do lançamento.");
            return null;
          }
          // Só o que foi informado: a data e a área da atividade.
          return Object.fromEntries(Object.entries(corpoDoApontamento(formDoDia)).filter(([, v2]) => v2 !== null && v2 !== ""));
        },
        aoRecusar: (erro) => {
          const campo = campoDoFormulario(erro, CAMPO_DO_FORMULARIO_APONTAMENTO);
          if (campo === "data_operacional") setErrosDia((e) => ({ ...e, [campo]: mensagemDeErroAtividade(erro, "Revise o dia do lançamento.") }));
        },
      };
  // O destino do formulário: o dia que existe ou o que vai nascer com o item.
  const destino = apontamento ?? { id: null, data_operacional: dia, area_executada_dia: null, versao: null, status: null };

  /** A linha foi gravada: Salvar fecha a janela; Salvar e novo deixa o formulário vazio. */
  const aoSalvarItem = (/** @type {any} */ r, /** @type {string} */ textoDoServidor, /** @type {{ bem?: any } | undefined} */ extra = undefined) => {
    aplicarEscrita(r, textoDoServidor);
    // Máquina e combustível juntos: as horas já estão gravadas; a MESMA janela passa para o abastecimento dessa máquina,
    // ligado ao lançamento do dia que acabou de nascer (ou que recebeu a linha).
    if (depoisDeSalvar.current === "abastecer" && r?.apontamento?.id != null && extra?.bem) {
      setAbastecendo({ apontamento: r.apontamento, bem: extra.bem });
      return;
    }
    if (depoisDeSalvar.current !== "novo") {
      onFechar();
      return;
    }
    setChaveForm((k) => k + 1);
  };

  // ─── Cabeçalho ───────────────────────────────────────────────────────
  const fora = Boolean(dia) && podeLancar && foraDoPeriodo(dia, atividade);
  const periodo = textoDoPeriodo(atividade?.data_inicio, atividade?.data_prevista_fim);

  let avisoStatus = null;
  if (atividade?.status === STATUS_CONCLUIDA) avisoStatus = "Atividade concluída: para lançar ou corrigir, reabra a atividade.";
  else if (atividade?.status === STATUS_CANCELADA) avisoStatus = "Atividade cancelada: os lançamentos ficam no histórico.";
  else if (aberta && !fuso && empresaId) avisoStatus = "Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de lançar: o servidor recusa sem ele.";
  else if (aberta && !tipoPermitido) avisoStatus = `O tipo desta atividade não permite mais ${doTipo.rotulo.toLowerCase()}.`;
  else if (aberta && comAreas && !areaLanca) avisoStatus = "Esta área não está em andamento: inicie a área para lançar nela.";

  // ─── O formulário da linha ───────────────────────────────────────────
  const propsDoFormulario = {
    atividade,
    apontamento: destino,
    escopo,
    novoDia,
    Casca: CascaDoFormulario,
    onSalvo: aoSalvarItem,
    onCancelar: onFechar,
    // Sem resposta (ou o servidor disse que algo mudou): relê. Com o dia ainda nascendo, a lista não é relida aqui —
    // o "Consultar" / "Repetir o mesmo envio" do formulário resolvem sem trocar o formulário de baixo da pessoa.
    onMudou: () => {
      if (apontamento) releer();
      else queryClient.invalidateQueries({ queryKey: chaveTotais(empresaId, atividadeId) });
    },
  };
  const chaveDoFormulario = `${chaveForm}:${dia}:${apontamento?.id ?? "novo"}`;
  let formulario = null;
  if (podeLancar && dia && consulta.isSuccess) {
    if (tipo === LINHA_PRODUTO) formulario = <JanelaLinhaProduto key={chaveDoFormulario} {...propsDoFormulario} atividadeAreaId={comAreas ? areaId : null} />;
    else if (tipo === LINHA_MAO_OBRA) formulario = <JanelaLinhaMaoObra key={chaveDoFormulario} {...propsDoFormulario} />;
    else if (tipo === LINHA_SERVICO) formulario = <JanelaLinhaServico key={chaveDoFormulario} {...propsDoFormulario} />;
    else formulario = <JanelaLinhaMaquina key={chaveDoFormulario} {...propsDoFormulario} permiteImplemento={flags?.permiteImplemento === true} />;
  }

  const titulo = (
    <span className="b1-tipo-titulo">
      <span className="b1-tipo-titulo__icone" aria-hidden>
        <doTipo.Icone size={16} strokeWidth={1.75} />
      </span>
      {doTipo.rotulo}
    </span>
  );

  // Um nível só: o abastecimento ocupa o lugar desta janela (nada de janela sobre janela).
  if (abastecendo) {
    return (
      <JanelaAbastecimentoDaArea
        atividade={atividade}
        apontamento={abastecendo.apontamento}
        bem={abastecendo.bem}
        onFechar={onFechar}
        onGravou={(texto) => {
          queryClient.invalidateQueries({ queryKey: chave });
          queryClient.invalidateQueries({ queryKey: chaveTotais(empresaId, atividadeId) });
          queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ_ABASTECIMENTOS] });
          onAtividadeAtualizada?.(null);
          notifySuccess("Sucesso", texto);
        }}
      />
    );
  }

  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      // Uma folha do celular aberta dentro da janela (seletor) fecha primeiro.
      aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
      titulo={titulo}
      testId="janela-tipo"
      className={celular ? "b1-janela--tela-cheia" : ""}
      // Os botões daqui seguem as ações da tela (lançar apontamento): a heurística de texto do Layout não vale.
      contentProps={{ "data-permissao-explicita": "", "data-tipo": tipo, "data-celular": celular ? "" : undefined, className: celular ? "b1-janela__camada--tela-cheia" : undefined }}
      fora={<div ref={setAlvoFolha} className="contents" />}
      rodape={
        podeLancar ? (
          <div ref={setAlvoRodape} className="contents" data-testid="janela-tipo-rodape-dados" />
        ) : (
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} data-testid="janela-tipo-fechar">
            Fechar
          </button>
        )
      }
    >
      <MobileSheetPortalCtx.Provider value={alvoFolha}>
        {avisoStatus ? <AvisoGestao testId="janela-tipo-aviso">{avisoStatus}</AvisoGestao> : null}
        {fora ? (
          <AvisoGestao testId="janela-tipo-fora-do-periodo">
            Esta data fica fora do período da atividade{periodo ? ` (${periodo})` : ""}. O lançamento é aceito, com aviso.
          </AvisoGestao>
        ) : null}
        {consulta.isError ? (
          <AvisoGestao testId="janela-tipo-erro">
            {mensagemDeErroAtividade(consulta.error, "Não foi possível carregar os lançamentos. Verifique a conexão e tente de novo.")}{" "}
            <button type="button" className="underline" onClick={() => consulta.refetch()}>
              Tentar novamente
            </button>
          </AvisoGestao>
        ) : null}
        {podeLancar && consulta.isLoading ? (
          <p role="status" className={NOTA} data-testid="janela-tipo-carregando">
            Carregando…
          </p>
        ) : null}
        <ContextoDados.Provider value={contextoDados}>{formulario}</ContextoDados.Provider>
      </MobileSheetPortalCtx.Provider>
    </B1Janela>
  );
}
