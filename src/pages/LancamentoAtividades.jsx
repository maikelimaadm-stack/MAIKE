import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CalendarPlus, CircleCheck, Copy, List, Pencil, RotateCcw } from "lucide-react";
import { FiltrosDaTelaContext, opcoesDeOrdenacao } from "@/components/cadastro/base1/FiltrosRapidos";
import { B1MenuAcoesDaLinha } from "@/components/cadastro/base1/B1AcoesDaLinha";
import { PillBtn } from "@/components/cadastro/base1/Base1Ui";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { AvisoGestao, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import { DialogoAcao } from "@/components/financeiroGestao/DialogosLancamento";
import { Selo } from "@/components/financeiroGestao/ConsultaLancamento";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import { useCelular } from "@/components/common/MobileSheet";
import AtividadeAberta from "@/components/lancamento-atividades/AtividadeAberta";
import DialogoConcluirAtividade from "@/components/lancamento-atividades/DialogoConcluirAtividade";
import DialogoConcluirServico from "@/components/lancamento-atividades/DialogoConcluirServico";
import { BlocoDoServico, OperacaoDoServico, SituacaoDoServico } from "@/components/lancamento-atividades/ServicoNaLista";
import FormularioAtividade from "@/components/lancamento-atividades/FormularioAtividade";
import JanelaRegistroDeCampo from "@/components/lancamento-atividades/RegistroDeCampo";
import JanelaLancamentoPorTipo, { lancamentoDoTipo } from "@/components/lancamento-atividades/JanelaLancamentoPorTipo";
import { areasDaAtividade, rotuloDaAreaDaAtividade, textoDaColunaArea } from "@/lib/atividadeAreasRegras";
import { situacaoDaAtividade, textoProgressoAreas } from "@/lib/atividadeFluxoCampo";
import {
  OPCOES_DA_SITUACAO,
  capimDoServico,
  filtroDoTipo,
  opcoesDoFiltroTipo,
  rotuloDaSituacaoDoServico,
  rotuloDoTipoDoServico,
  servicoSemArea,
  situacaoDoServico,
  textoDaAreaDoServico,
  textoDaDataDoServico,
  textoDoCapim,
  tipoFixoDoServico,
} from "@/lib/servicoVariosDias";
import { diaPorExtenso } from "@/lib/camposPorTipo";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaAtividades, useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAuth } from "@/lib/AuthContext";
import { flagsDoTipoDaAtividade, formatarMoedaAtividade } from "@/lib/atividadeLinhasRegras";
import { comparar, ehCanonico } from "@/lib/dinheiroDecimal";
import { ehDiaValido, formatarInstante } from "@/lib/diaCivil";
import { confirmar } from "@/lib/maikeConfirmar";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import {
  CHAVE_DO_SELO_ATIVIDADE,
  CODIGOS_RELER_ATIVIDADE,
  LOCALE_ATIVIDADE,
  MAX_OBSERVACAO_ATIVIDADE,
  ROTULO_STATUS_ATIVIDADE,
  STATUS_ABERTA,
  STATUS_CANCELADA,
  STATUS_CONCLUIDA,
  STATUS_ATIVIDADE,
  acoesDaAtividade,
  corDoTipoAtividade,
  codigoDoErroAtividade,
  erroDaDataDeConclusao,
  formatarAreaExecutadaPlanejada,
  formatarDiaAtividade,
  formatarProducaoDaAtividade,
  mensagemDeErroAtividade,
  rotuloDaArea,
  rotuloDaTarefa,
  rotuloDaUnidadeDeProducao,
  rotuloDoBem,
  rotuloDoCentro,
  rotuloDoSetor,
  rotuloDoStatusAtividade,
  rotuloDoUsuario,
  siglaDoTipoAtividade,
} from "@/lib/lancamentoAtividadesRegras";
import { ehResultadoIncerto } from "@/services/operacaoFinanceiraService";
import {
  cancelarAtividade,
  concluirAtividade,
  definirFazendaDaTela,
  duplicarAtividade,
  listarAreasDaFazenda,
  listarAtividades,
  listarTiposAtividade,
  obterAtividade,
  reabrirAtividade,
} from "@/services/lancamentoAtividadesService";

const QUERY_RAIZ = "lancamento-atividades";

/** Formatação das mensagens do diálogo de ação (não há dinheiro nesta tela). */
const CONTEXTO_MENSAGENS = Object.freeze({ locale: LOCALE_ATIVIDADE, moeda: "BRL", casas: 2 });

/** Faixa sem pílulas automáticas das colunas (referência estável). */
const SEM_FILTROS_AUTOMATICOS = /** @type {string[]} */ ([]);
/**
 * D-PROD-267 — a pílula "Situação" (no lugar da "Status"): as 4 situações da lista (o servidor separa Planejada de Em
 * andamento) e, para não perder o filtro de antes, "Abertas" (= status ABERTA: as planejadas e as em andamento).
 */
const SITUACAO_ABERTAS = "ABERTAS";
const OPCOES_SITUACAO = [...OPCOES_DA_SITUACAO, { value: SITUACAO_ABERTAS, label: "Abertas (planejadas e em andamento)" }];

// ─── Lista (colunas da grade Base1) ─────────────────────────────────────

// D-PROD-267: as colunas padrão mudaram (o modelo do dono): a chave nova faz valer o padrão novo para todos.
export const ATIVIDADES_STORAGE_KEY = "colunas_lancamento_atividades_v2";

/**
 * D-PROD-267 (o modelo do dono, "uma linha por serviço"): Nº | Tipo | Operação | Área | Data | Situação | Custo. O Tipo é
 * o tipo fixo da operação (Roçada e tratos…), a Operação é o tipo de atividade GRAVADO na atividade (snapshot), a Área
 * mostra a 1ª e "+N", a Data "28/11 –" (em aberto) ou "01/11 a 10/11" (concluída) e a Situação, em andamento, o
 * andamento com "+ Lançar dia" e "Concluir". Nome, área executada / planejada, início e os demais dados do cabeçalho
 * ficam como colunas opcionais (desligadas; Mais opções → colunas).
 */
export const ATIVIDADES_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, width: 64 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 160 },
  { id: "operacao", label: "Operação", default: true, sortable: true, width: 190 },
  { id: "area", label: "Área", default: true, sortable: true, width: 190 },
  { id: "data", label: "Data", default: true, sortable: true, width: 120 },
  { id: "status", label: "Situação", default: true, sortable: true, width: 280 },
  // D-PROD-234: o custo total da atividade (o mesmo dos totais), que a lista do servidor traz por página.
  { id: "valor_total", label: "Custo", default: true, sortable: true, align: "right", width: 130 },
  { id: "nome", label: "Nome", default: false, sortable: true, width: 200 },
  { id: "area_execucao", label: "Área executada / planejada", default: false, sortable: true, align: "right", width: 160 },
  { id: "data_inicio", label: "Início", default: false, sortable: true, width: 101 },
  { id: "setor", label: "Setor", default: false, sortable: true, width: 140 },
  { id: "bem", label: "Máquina", default: false, sortable: true, width: 160 },
  { id: "safra", label: "Safra", default: false, sortable: true, width: 100 },
  { id: "producao", label: "Produção", default: false, sortable: true, align: "right", width: 110 },
  { id: "data_prevista_fim", label: "Fim previsto", default: false, sortable: true, width: 101 },
  { id: "data_conclusao", label: "Conclusão", default: false, sortable: true, width: 101 },
  { id: "centro_custo", label: "Centro de custo", default: false, sortable: true, width: 160 },
  { id: "centro_resultado", label: "Centro de resultado", default: false, sortable: true, width: 160 },
];

/**
 * Cards (celular): o nome é o título, "Nº 7 · Aberta" o subtítulo e o selo é a sigla do tipo (D-PROD-237); os campos
 * em duas colunas. É o padrão: os campos continuam personalizáveis (Mais opções → campos dos cards).
 */
export const ATIVIDADES_CAMPOS_CARD = ["numero", "tipo", "area", "data_inicio", "valor_total"];

/**
 * Selo do card: a sigla do tipo de atividade (3 letras) na cor do tipo (paleta determinística pelo id do tipo; o
 * cadastro de tipos não tem cor). Sem tipo, as iniciais do nome.
 * @param {any} item
 */
export const seloDoCardAtividade = (item) => {
  const sigla = siglaDoTipoAtividade(item?.tipo_atividade_nome) || siglaDoTipoAtividade(item?.nome);
  return { texto: sigla, cor: corDoTipoAtividade(item?.tipo_atividade_id || item?.tipo_atividade_nome) };
};

/** Subtítulo do card: várias áreas mostram o progresso; uma área, "Nº 7 · Em andamento". @param {any} item */
export const subtituloDoCardAtividade = (item) => {
  const varias = Array.isArray(item?.areas) && item.areas.length > 1;
  if (varias) {
    const desde = formatarDiaAtividade(item?.data_inicio);
    return [textoProgressoAreas(item), desde ? `desde ${desde}` : ""].filter(Boolean).join(" · ");
  }
  return [item?.numero != null ? `Nº ${item.numero}` : "", situacaoDaAtividade(item)].filter(Boolean).join(" · ");
};

/** @param {any} item @param {string} id */
export const valorDoCampoAtividade = (item, id) => {
  if (id === "numero") return item?.numero != null ? String(item.numero) : "";
  if (id === "nome") return String(item?.nome ?? "");
  // D-PROD-267: o tipo fixo (do servidor) e a operação (o tipo de atividade gravado).
  if (id === "tipo") return rotuloDoTipoDoServico(item);
  // D-PROD-271: no Plantio de pastagem, o capim ao lado ("SEMEADURA DE CAPIM · capim PANICUM CV. MOMBAÇA").
  if (id === "operacao") return [String(item?.tipo_atividade_nome ?? ""), textoDoCapim(capimDoServico(item))].filter(Boolean).join(" · ");
  // D-PROD-267: a 1ª área e "+N" das outras ("Pasto da Aroeira +1").
  if (id === "area") return textoDaAreaDoServico(item) || textoDaColunaArea(item);
  if (id === "data") return textoDaDataDoServico(item);
  if (id === "setor") return rotuloDoSetor(item);
  if (id === "bem") return rotuloDoBem(item?.bem);
  if (id === "safra") return String(item?.safra_ciclo ?? "");
  if (id === "status") return rotuloDaSituacaoDoServico(item) || rotuloDoStatusAtividade(item?.status);
  if (id === "area_execucao") return formatarAreaExecutadaPlanejada(item);
  if (id === "producao") return formatarProducaoDaAtividade(item);
  if (id === "data_inicio" || id === "data_prevista_fim" || id === "data_conclusao") return formatarDiaAtividade(item?.[id]);
  if (id === "centro_custo") return rotuloDoCentro(item?.centro_custo);
  if (id === "centro_resultado") return rotuloDoCentro(item?.centro_resultado);
  if (id === "valor_total") return formatarMoedaAtividade(item?.custo_total);
  return "";
};

/** Ordens da pílula "Ordenar" em palavras da tela (D-PROD-237: "Nº (mais recentes primeiro)", como no protótipo). */
const PALAVRAS_DA_ORDEM = Object.freeze(
  /** @type {Record<string, { asc: string, desc: string }>} */ ({
    numero: { asc: "Nº (mais antigas primeiro)", desc: "Nº (mais recentes primeiro)" },
    data_inicio: { asc: "Início (mais antigo primeiro)", desc: "Início (mais recente primeiro)" },
    data: { asc: "Data (mais antiga primeiro)", desc: "Data (mais recente primeiro)" },
    data_prevista_fim: { asc: "Fim previsto (mais antigo primeiro)", desc: "Fim previsto (mais recente primeiro)" },
    data_conclusao: { asc: "Conclusão (mais antiga primeiro)", desc: "Conclusão (mais recente primeiro)" },
    area_execucao: { asc: "Área executada (menor primeiro)", desc: "Área executada (maior primeiro)" },
    producao: { asc: "Produção (menor primeiro)", desc: "Produção (maior primeiro)" },
    valor_total: { asc: "Custo (menor primeiro)", desc: "Custo (maior primeiro)" },
  }),
);
/** As mesmas ordens da grade; só o texto muda nas colunas de número, dia e valor (a mais nova / maior primeiro). */
export const ORDENS_DA_LISTA_ATIVIDADES = Object.freeze(
  opcoesDeOrdenacao(ATIVIDADES_COLUNAS).flatMap((o) => {
    const palavras = PALAVRAS_DA_ORDEM[o.key];
    if (!palavras) return [o];
    // Nas colunas reescritas, a mais nova / a maior vem primeiro na lista.
    if (o.dir === "asc") return [{ key: o.key, dir: /** @type {const} */ ("desc"), label: palavras.desc }, { ...o, label: palavras.asc }];
    return [];
  }),
);

/** Colunas ordenadas pelo valor CANÔNICO do servidor (nunca pelo texto formatado). */
const CANONICO_DA_COLUNA = Object.freeze(
  /** @type {Record<string, string>} */ ({ numero: "numero", area_execucao: "area_executada", producao: "quantidade_produzida", valor_total: "custo_total" }),
);
const COLUNAS_DE_DIA = Object.freeze(["data_inicio", "data_prevista_fim", "data_conclusao"]);

/**
 * Número, área, produção e dias pelo valor do servidor; vazio por último.
 * @param {any} a @param {any} b @param {string} colId
 * @returns {number|null}
 */
export const compararAtividadesParaOrdenar = (a, b, colId) => {
  if (COLUNAS_DE_DIA.includes(colId) || colId === "data") {
    // D-PROD-267: a coluna "Data" ordena pelo início do serviço.
    const campo = colId === "data" ? "data_inicio" : colId;
    const va = ehDiaValido(a?.[campo]) ? String(a[campo]) : null;
    const vb = ehDiaValido(b?.[campo]) ? String(b[campo]) : null;
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    return va === vb ? 0 : va < vb ? -1 : 1;
  }
  const campo = CANONICO_DA_COLUNA[colId];
  if (!campo) return null;
  const va = ehCanonico(a?.[campo]) ? String(a[campo]) : null;
  const vb = ehCanonico(b?.[campo]) ? String(b[campo]) : null;
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
  return comparar(va, vb);
};

/** @param {any} atividade */
const textoDoNumero = (atividade) => (atividade?.numero != null ? `nº ${atividade.numero}` : "");

/**
 * Lançamento de Atividades (D-PROD-200, Fatia 2) — a EXECUÇÃO de um Tipo de
 * Atividade na fazenda selecionada, em dois níveis: a ATIVIDADE (o cabeçalho
 * aberto, "Cigarrinha Pasto 01") e os APONTAMENTOS dela, por dia e turno.
 *
 * Lista keyset das atividades (filtros de status, tipo, área e período sobre o
 * início — D-PROD-237: todos como pílulas na faixa do motor; no celular, cards com o selo do tipo) com Nº, nome, tipo, área, status, área executada / planejada e
 * início (e, D-PROD-234, o valor total que a lista do servidor traz). "Abrir atividade" cria (FormularioAtividade). Na linha selecionada
 * (ou na atividade aberta), o menu Mais opções traz o que a permissão e o
 * status deixam: concluir (com a data), reabrir e cancelar (com motivo) e
 * duplicar.
 *
 * Atividade aberta (D-PROD-234, `AtividadeAberta`): abas "Lançamentos" (o
 * Resumo de custo, a tabela dos tipos com o ⚡ que abre a janela do tipo e os
 * "Dias lançados" — a ListaApontamentos de sempre) e "Resumo da atividade" (o
 * totalizador da D-PROD-202 com o detalhe por item e o cabeçalho, SÓ LEITURA,
 * com os campos herdados: setor da área; centros e unidade do tipo — nunca
 * digitados). "Editar" abre o FormularioAtividade só
 * enquanto a atividade está ABERTA; concluída ou cancelada fica toda só
 * leitura (o servidor também recusa).
 *
 * Salvaguardas: sem fazenda real nada é lido; trocar de fazenda fecha a
 * atividade e os diálogos; sem o fuso da fazenda não há "hoje", então abrir,
 * editar, concluir, reabrir, cancelar, duplicar e lançar ficam fechados (o
 * servidor recusaria). Toda ação leva a `versao` lida (CAS no servidor).
 */
export default function LancamentoAtividades() {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  // A fazenda que o service injeta nas leituras e gravações (inclusive as dos componentes filhos).
  definirFazendaDaTela(empresaId);
  const acoes = useAcoesTelaAtividades();
  const { fuso, fusoOk, semFuso, hoje } = useFusoDaFazenda(empresaId);

  // D-PROD-267: Situação (no lugar do Status) e Tipo (o tipo fixo ou, dentro dele, a operação).
  const [situacaoFiltro, setSituacaoFiltro] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState("");
  const [areaFiltro, setAreaFiltro] = useState("");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const periodoInvertido = Boolean(dataDe && dataAte && dataDe > dataAte);

  /** Diálogo aberto: concluir (com a data), reabrir ou cancelar (com motivo), sobre a atividade lida no clique. */
  const [dialogo, setDialogo] = useState(/** @type {{ tipo: 'concluir'|'reabrir'|'cancelar', atividade: any } | null} */ (null));
  const [dataConclusao, setDataConclusao] = useState("");
  const [erroDataConclusao, setErroDataConclusao] = useState(/** @type {string|null} */ (null));
  const [duplicando, setDuplicando] = useState(false);
  /** Janela de UM tipo de lançamento (D-PROD-233), aberta pelo menu ⚡ da lista sobre a atividade da linha. */
  /** D-PROD-254: "Registrar serviço" — registrar trabalho de campo escolhendo área e tipo (o planejar é a "Nova atividade"). */
  const [registrando, setRegistrando] = useState(false);
  /** D-PROD-267: "+ Lançar dia" (a Nova realização preenchida com o serviço) e o "Concluir" da linha. */
  const [lancandoDia, setLancandoDia] = useState(/** @type {any|null} */ (null));
  const [concluindoServico, setConcluindoServico] = useState(/** @type {any|null} */ (null));
  const [lancando, setLancando] = useState(/** @type {{ atividade: any, tipo: string, aba: 'lista'|'dados', areaId?: string|null, chave: number } | null} */ (null));
  const celular = useCelular();
  const { clienteId } = useAuth();
  // Escopo da pendência de `operation_id` (cliente e login): o mesmo da lista de lançamentos.
  const escopo = `${clienteId || "sem-tenant"}:${acoes?.login || "sem-login"}`;

  const { data: tipos = [] } = useQuery({
    queryKey: [QUERY_RAIZ, "tipos"],
    queryFn: () => listarTiposAtividade(),
    enabled: acoes.ver,
    staleTime: 30 * 1000,
  });
  const { data: areas = [] } = useQuery({
    queryKey: [QUERY_RAIZ, "areas", empresaId],
    queryFn: () => listarAreasDaFazenda(),
    enabled: Boolean(empresaId) && acoes.ver,
    staleTime: 30 * 1000,
  });

  const listEnabled = Boolean(empresaId) && acoes.ver && !periodoInvertido;

  const fetchPage = useCallback(
    (/** @type {{ limit: number, cursor: string|null }} */ { limit, cursor }) =>
      listarAtividades({
        limit,
        cursor,
        status: situacaoFiltro === SITUACAO_ABERTAS ? STATUS_ABERTA : null,
        situacao: situacaoFiltro && situacaoFiltro !== SITUACAO_ABERTAS ? situacaoFiltro : null,
        ...filtroDoTipo(tipoFiltro),
        area_id: areaFiltro || null,
        data_de: dataDe || null,
        data_ate: dataAte || null,
      }),
    // A fazenda vem do service (`definirFazendaDaTela`) e está na chave da lista: trocar de fazenda relê a página.
    [situacaoFiltro, tipoFiltro, areaFiltro, dataDe, dataAte],
  );

  const controller = useCadastroBase1Controller({
    storageKey: ATIVIDADES_STORAGE_KEY,
    columnIds: ATIVIDADES_CAMPOS_CARD,
    listEnabled,
    queryKey: [QUERY_RAIZ, "page", empresaId, situacaoFiltro, tipoFiltro, areaFiltro, dataDe, dataAte],
    fetchPage,
    duplicateLabelField: "nome",
    searchPlaceholder: "Buscar nº, nome, tipo ou área…",
    exportFileName: "lancamento-atividades.csv",
    exportColumns: ATIVIDADES_COLUNAS,
    getExportFieldValue: valorDoCampoAtividade,
    getRecordTitle: (/** @type {any} */ item) => (item?.id ? `Atividade ${textoDoNumero(item)}${item.nome ? ` — ${item.nome}` : ""}` : "Abrir atividade"),
    getRecordCode: (/** @type {any} */ item) => (item?.id && item?.numero != null ? String(item.numero) : undefined),
    getSearchHaystack: (/** @type {any} */ a) =>
      [a.numero, a.nome, a.tipo_atividade_nome, rotuloDoTipoDoServico(a), rotuloDaArea(a.area), ...areasDaAtividade(a).map(rotuloDaAreaDaAtividade)].filter((v) => v != null && v !== "").join(" "),
    mapSearchSuggestion: (/** @type {any} */ a) => ({
      id: String(a.id),
      label: `Nº ${a.numero ?? ""} — ${a.nome ?? ""}`,
      secondary: a.tipo_atividade_nome || undefined,
    }),
    matchRowId: (/** @type {any} */ a, /** @type {string} */ id) => String(a.id) === String(id),
    getRowId: (/** @type {any} */ a) => String(a.id),
    findRowById: (/** @type {any[]} */ rows, /** @type {string} */ id) => rows.find((a) => String(a.id) === String(id)),
    // O FormularioAtividade grava sozinho (service) e devolve a atividade em `onSalvo`.
    onSubmitRecord: () => {},
    // Atividade não se apaga: cancela com motivo (menu Mais opções).
    onRequestDeleteMutation: () => {},
  });

  // ─── Troca de fazenda: nada da fazenda anterior continua na tela ──────
  const empresaAnterior = useRef(empresaId);
  const trocandoEmpresa = empresaAnterior.current !== empresaId;
  const { closeForm } = controller;
  useEffect(() => {
    if (empresaAnterior.current === empresaId) return;
    empresaAnterior.current = empresaId;
    closeForm();
    setDialogo(null);
    setLancando(null);
    setRegistrando(false);
    setLancandoDia(null);
    setConcluindoServico(null);
    setAreaFiltro("");
  }, [empresaId, closeForm]);
  // Resposta que chega depois de trocar a fazenda não mexe na atividade aberta da fazenda nova.
  const empresaAtual = useRef(empresaId);
  empresaAtual.current = empresaId;
  /** @param {string|null|undefined} emp */
  const daEmpresaAtual = (emp) => Boolean(emp) && emp === empresaAtual.current;

  const invalidarLista = () => queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "page"] });
  /** O totalizador (área, produtos, máquinas, custo) se relê depois de toda escrita (D-PROD-202). */
  const invalidarTotais = () => queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "totais"] });
  /** @param {string|null|undefined} emp @param {string} id */
  const chaveDetalhe = (emp, id) => [QUERY_RAIZ, "detalhe", emp ?? null, id];

  // ─── Atividade aberta: o DETALHE (com objetos e totais) ───────────────
  const registroLista = /** @type {any} */ (controller.editingItem);
  const idAberto = controller.showForm && registroLista?.id ? String(registroLista.id) : null;
  const detalheQuery = useQuery({
    queryKey: chaveDetalhe(empresaId, idAberto ?? ""),
    queryFn: () => obterAtividade(/** @type {string} */ (idAberto)),
    enabled: Boolean(empresaId && idAberto && acoes.ver && !trocandoEmpresa),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const detalheBruto = /** @type {any} */ (detalheQuery.data ?? null);
  const detalhe = detalheBruto && idAberto && String(detalheBruto.id) === idAberto ? detalheBruto : null;
  // O detalhe vale quando é da mesma versão (ou mais nova) que a linha aberta; senão, a linha até ele ser relido.
  const registroAberto = /** @type {any} */ (
    idAberto ? (detalhe && Number(detalhe.versao ?? 0) >= Number(registroLista?.versao ?? 0) ? detalhe : registroLista) : null
  );
  useEffect(() => {
    if (!detalheQuery.error) return;
    if (codigoDoErroAtividade(detalheQuery.error) === "ATIVIDADE_NOT_FOUND") {
      invalidarLista();
      closeForm();
    }
    notifyWarning("Atenção", mensagemDeErroAtividade(detalheQuery.error, "Não foi possível ler a atividade."));
  }, [detalheQuery.error]);

  /**
   * Mostra a atividade devolvida pelo servidor (só leitura) e guarda o detalhe
   * no cache. A resposta de toda escrita da atividade é o detalhe (§10).
   * @param {any} atividade @param {string|null} [emp]
   */
  const mostrarAtividade = (atividade, emp = empresaId) => {
    if (!atividade || typeof atividade !== "object" || !atividade.id) {
      controller.recordHelpers.closeForm();
      return;
    }
    queryClient.setQueryData(chaveDetalhe(emp, String(atividade.id)), atividade);
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(atividade);
    controller.setIsEditing(false);
    controller.recordHelpers.setShowForm(true);
    controller.recordHelpers.bumpFormEpoch();
    controller.recordHelpers.chrome.setViewMode("record");
    controller.recordHelpers.chrome.onSelectionChange([String(atividade.id)]);
  };

  /**
   * Escrita concluída (abrir, editar, concluir, reabrir, cancelar, duplicar):
   * a lista é relida (a `versao` mudou) e, na fazenda atual, a atividade
   * devolvida aparece. Os apontamentos se releem sozinhos quando a versão ou o
   * status do cabeçalho muda (ListaApontamentos).
   * @param {any} atividade @param {string|null} emp
   */
  const aplicarAtividade = (atividade, emp) => {
    invalidarLista();
    invalidarTotais();
    if (!daEmpresaAtual(emp)) {
      if (atividade?.id) queryClient.setQueryData(chaveDetalhe(emp, String(atividade.id)), atividade);
      return;
    }
    mostrarAtividade(atividade, emp);
  };

  /**
   * Recusa do servidor: relê o que mudou (atividade sumiu, status ou versão
   * velha) e devolve a mensagem.
   * @param {unknown} erro @param {string} fallback @param {string|null} emp
   */
  const reagirAoErro = (erro, fallback, emp) => {
    const code = codigoDoErroAtividade(erro);
    if (code && CODIGOS_RELER_ATIVIDADE.includes(code)) {
      invalidarLista();
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "detalhe"] });
      if (code === "ATIVIDADE_NOT_FOUND" && daEmpresaAtual(emp)) {
        setDialogo(null);
        closeForm();
      }
    }
    return mensagemDeErroAtividade(erro, fallback);
  };

  // ─── Formulário (abrir e editar o cabeçalho) ──────────────────────────
  /** O formulário gravou (e já avisou o sucesso): a atividade gravada aparece só leitura. @param {any} atividade o detalhe */
  const aoSalvarAtividade = (atividade) => aplicarAtividade(atividade, empresaId);

  /** Totais recalculados depois de lançar, editar ou cancelar um apontamento. @param {any} atividade */
  const aoAtualizarAtividade = (atividade) => {
    if (!atividade?.id) return;
    invalidarLista();
    invalidarTotais();
    queryClient.setQueryData(chaveDetalhe(empresaId, String(atividade.id)), atividade);
  };

  // ─── Ações da atividade (concluir, reabrir, cancelar, duplicar) ───────
  const podeGravar = Boolean(empresaId) && fusoOk;

  // Alvo das ações: a atividade aberta (fora da edição; o detalhe, que tem a versão mais nova) ou a única linha selecionada.
  const alvo = useMemo(() => {
    if (controller.showForm) return idAberto && !controller.isEditing ? registroAberto : null;
    const ids = controller.chrome.selectedIds;
    if (ids.length !== 1) return null;
    return /** @type {any[]} */ (controller.visibleRows).find((a) => String(a.id) === String(ids[0])) ?? null;
  }, [controller.showForm, controller.isEditing, idAberto, registroAberto, controller.chrome.selectedIds, controller.visibleRows]);
  const acoesDoAlvo = acoesDaAtividade(alvo, acoes);
  const versaoValida = Number.isInteger(alvo?.versao);

  /** @param {'concluir'|'reabrir'|'cancelar'} tipo @param {any} atividade */
  const abrirDialogo = (tipo, atividade) => {
    setErroDataConclusao(null);
    setDataConclusao(tipo === "concluir" ? hoje : "");
    setDialogo({ tipo, atividade });
  };

  /**
   * Ação gravada: fecha o diálogo e mostra a atividade devolvida (na fazenda em
   * que a ação foi enviada; se a tela já trocou de fazenda, só avisa).
   * @param {any} atividade @param {string} mensagem @param {string} emp
   */
  const concluirAcao = (atividade, mensagem, emp) => {
    const mesmaFazenda = daEmpresaAtual(emp);
    if (mesmaFazenda) setDialogo(null);
    aplicarAtividade(atividade, emp);
    if (mesmaFazenda) notifySuccess("Sucesso", `${mensagem}.`);
    else notifyInfo("Gravação concluída", `${mensagem}, na fazenda anterior.`);
  };

  /**
   * Envio do diálogo. Concluir confere a data ANTES da rede (o erro fica no
   * campo e nada é enviado); reabrir e cancelar levam o motivo do diálogo.
   * A recusa volta ao diálogo (ele mostra a mensagem).
   * @param {string} motivo
   */
  const enviarDialogo = async (motivo) => {
    const atual = dialogo;
    const emp = empresaId;
    if (!atual || !emp) return;
    const { tipo, atividade } = atual;
    const id = String(atividade.id);
    try {
      if (tipo === "concluir") {
        const erroDaData = erroDaDataDeConclusao(dataConclusao, { hoje, dataInicio: atividade.data_inicio ?? null });
        setErroDataConclusao(erroDaData);
        if (erroDaData) return;
        const r = await concluirAtividade(id, { versao: atividade.versao, data_conclusao: dataConclusao });
        concluirAcao(r, `Atividade ${textoDoNumero(r)} concluída`, emp);
      } else if (tipo === "reabrir") {
        const r = await reabrirAtividade(id, { versao: atividade.versao, motivo });
        concluirAcao(r, `Atividade ${textoDoNumero(r)} reaberta`, emp);
      } else {
        const r = await cancelarAtividade(id, { versao: atividade.versao, motivo });
        concluirAcao(r, `Atividade ${textoDoNumero(r)} cancelada, com os apontamentos confirmados dela (nada foi apagado)`, emp);
      }
    } catch (erro) {
      reagirAoErro(erro, "Não foi possível concluir a ação. Nada foi alterado.", emp);
      throw erro;
    }
  };

  /** Status que cada ação deixa gravado: "Consultar" depois de um envio sem resposta. */
  const STATUS_DEPOIS = /** @type {Record<string, string>} */ ({ concluir: STATUS_CONCLUIDA, reabrir: STATUS_ABERTA, cancelar: STATUS_CANCELADA });

  /** "Consultar" depois de um envio sem resposta: relê a atividade. */
  const consultarDialogo = async () => {
    const atual = dialogo;
    const emp = empresaId;
    if (!atual || !emp) return;
    try {
      const lida = /** @type {any} */ (await obterAtividade(String(atual.atividade.id)));
      const gravou = lida?.status === STATUS_DEPOIS[atual.tipo] && Number(lida?.versao ?? 0) > Number(atual.atividade.versao ?? 0);
      if (gravou) {
        const nomes = /** @type {Record<string, string>} */ ({ concluir: "concluída", reabrir: "reaberta", cancelar: "cancelada" });
        concluirAcao(lida, `Atividade ${textoDoNumero(lida)} ${nomes[atual.tipo]}`, emp);
      } else {
        notifyInfo("Ainda não gravado", "A ação não aparece gravada na atividade. Repita o envio: a atividade só muda uma vez.");
      }
    } catch (erro) {
      notifyWarning("Atenção", mensagemDeErroAtividade(erro, "Não foi possível consultar agora. Tente de novo."));
    }
  };

  /**
   * Duplicar: abertura NOVA a partir da atividade (os padrões do tipo são
   * relidos; os apontamentos não vêm). Sem chave de idempotência: sem resposta
   * do servidor, a tela manda conferir a lista antes de repetir.
   * @param {any} atividade
   */
  const duplicar = async (atividade) => {
    const emp = empresaId;
    if (!emp || !atividade?.id || duplicando) return;
    const ok = await confirmar({
      titulo: `Duplicar a atividade ${textoDoNumero(atividade)}`.trim(),
      descricao:
        "Uma atividade NOVA é aberta com o mesmo nome, tipo, área, máquina, safra, área planejada, tarefa e observação, com início hoje. " +
        "Os apontamentos não são copiados; o setor vem da área e os centros e a unidade vêm do tipo atual. Depois de aberta, ela pode ser editada.",
      textoConfirmar: "Duplicar",
      textoCancelar: "Voltar",
    });
    if (!ok) return;
    setDuplicando(true);
    try {
      const nova = await duplicarAtividade(String(atividade.id));
      aplicarAtividade(nova, emp);
      if (daEmpresaAtual(emp)) notifySuccess("Sucesso", `Atividade ${textoDoNumero(nova)} aberta (cópia da ${textoDoNumero(atividade)}).`);
      else notifyInfo("Gravação concluída", `A cópia da atividade ${textoDoNumero(atividade)} foi aberta na fazenda anterior.`);
    } catch (erro) {
      if (ehResultadoIncerto(erro)) {
        invalidarLista();
        notifyWarning("Resultado incerto", "Não recebemos a resposta do servidor: a cópia PODE ter sido aberta. Confira a lista antes de duplicar de novo.");
      } else {
        notifyWarning("Atenção", reagirAoErro(erro, "Não foi possível duplicar a atividade. Nada foi gravado.", emp));
      }
    } finally {
      setDuplicando(false);
    }
  };

  // ─── D-PROD-267: "+ Lançar dia" e "Concluir" da linha ─────────────────
  /** Os botões da linha seguem a mesma regra do servidor (permissão, status, fuso e versão). @param {any} a */
  const podeLancarDia = (a) => podeGravar && acoesDaAtividade(a, acoes).lancarApontamento && a?.status === STATUS_ABERTA;
  /** @param {any} a */
  const podeConcluirServico = (a) => podeGravar && acoesDaAtividade(a, acoes).concluir && Number.isInteger(a?.versao);

  /**
   * "Concluir" da linha: `POST /atividades/:id/concluir` com o último dia (as áreas em andamento e a atividade, numa
   * transação). A recusa fica no diálogo (ele mostra a frase); a lista e o detalhe se releem.
   * @param {string} dia
   */
  const concluirServico = async (dia) => {
    const alvoDaLinha = concluindoServico;
    const emp = empresaId;
    if (!alvoDaLinha || !emp) return;
    try {
      const r = /** @type {any} */ (await concluirAtividade(String(alvoDaLinha.id), { versao: alvoDaLinha.versao, data_conclusao: dia }));
      invalidarLista();
      invalidarTotais();
      if (r?.id) queryClient.setQueryData(chaveDetalhe(emp, String(r.id)), r);
      if (daEmpresaAtual(emp)) {
        setConcluindoServico(null);
        notifySuccess("Sucesso", `Serviço ${textoDoNumero(r ?? alvoDaLinha)} concluído.`);
      } else {
        notifyInfo("Gravação concluída", "O serviço foi concluído na fazenda anterior.");
      }
    } catch (erro) {
      reagirAoErro(erro, "Não foi possível concluir. Nada foi alterado.", emp);
      throw erro;
    }
  };

  // Na atividade aberta, "Concluir" é o botão à vista na barra (D-PROD-232): o Mais opções não repete.
  const concluirNaBarra = controller.showForm;
  /** @type {Array<{ key: string, label: string, disabled?: boolean, hidden?: boolean, onSelect: () => void }>} */
  const acoesDoMenu = [];
  if (alvo && podeGravar && versaoValida) {
    acoesDoMenu.push(
      { key: "concluir", label: "Concluir atividade", hidden: !acoesDoAlvo.concluir || concluirNaBarra, onSelect: () => abrirDialogo("concluir", alvo) },
      { key: "reabrir", label: "Reabrir atividade", hidden: !acoesDoAlvo.reabrir, onSelect: () => abrirDialogo("reabrir", alvo) },
      { key: "cancelar", label: "Cancelar atividade", hidden: !acoesDoAlvo.cancelar, onSelect: () => abrirDialogo("cancelar", alvo) },
      { key: "duplicar", label: "Duplicar atividade", hidden: !acoesDoAlvo.duplicar, disabled: duplicando, onSelect: () => void duplicar(alvo) },
    );
  }
  const acoesVisiveisDoMenu = acoesDoMenu.filter((a) => !a.hidden);

  // ─── Menu ⚡ da linha (D-PROD-232) ────────────────────────────────────
  /** Abre a atividade já na edição do cabeçalho (o "Editar" da barra, sem passar pela seleção). @param {any} atividade */
  const alterarAtividade = (atividade) => {
    controller.handleEdit(atividade);
    controller.setIsEditing(true);
  };

  /**
   * A janela do tipo (D-PROD-233) sobre a atividade: pelo ⚡ da lista (na lista do dia) ou pela tabela dos tipos da
   * atividade aberta (D-PROD-234: "Inserir" e "+ Lançar" abrem nos Dados). D-PROD-249: pelo ⚡ de uma área (card "Áreas da
   * atividade"), a janela abre FIXA naquela área; sem área, com o seletor das áreas em andamento.
   * @param {any} atividade @param {string} tipo @param {'lista'|'dados'} [aba] @param {string|null} [areaId]
   */
  const lancarDoMenu = (atividade, tipo, aba = "lista", areaId = null) =>
    setLancando({ atividade, tipo, aba, areaId: areaId ? String(areaId) : null, chave: Date.now() });

  /**
   * Escrita feita na janela por tipo (D-PROD-233): a lista (área executada) e o totalizador se relêem; o cabeçalho
   * devolvido pelo servidor (com os totais recalculados) vai para o cache do detalhe.
   * @param {any|null} atividade
   */
  const aoEscreverNaJanelaDoTipo = (atividade) => {
    invalidarLista();
    invalidarTotais();
    if (atividade?.id) queryClient.setQueryData(chaveDetalhe(empresaId, String(atividade.id)), atividade);
  };

  /**
   * Grupos do menu ⚡ de UMA linha, pela permissão e pelo status (a mesma regra do Mais opções) e pelo tipo:
   * lançar (só ABERTA, com a ação de lançar e o fuso), abrir, e alterar / concluir / reabrir / duplicar / cancelar.
   * @param {any} a
   */
  const gruposDoMenu = (a) => {
    const ac = acoesDaAtividade(a, acoes);
    const gravar = podeGravar && Number.isInteger(a?.versao);
    const abrirItem = [{ key: "abrir", label: "Abrir atividade", icon: <List size={16} strokeWidth={1.75} />, onSelect: () => controller.handleEdit(a) }];
    const gerir = gravar
      ? [
          ac.editar ? { key: "alterar", label: "Alterar atividade", icon: <Pencil size={16} strokeWidth={1.75} />, onSelect: () => alterarAtividade(a) } : null,
          ac.concluir ? { key: "concluir", label: "Concluir atividade", icon: <CircleCheck size={16} strokeWidth={1.75} />, onSelect: () => abrirDialogo("concluir", a) } : null,
          ac.reabrir ? { key: "reabrir", label: "Reabrir atividade", icon: <RotateCcw size={16} strokeWidth={1.75} />, onSelect: () => abrirDialogo("reabrir", a) } : null,
          ac.duplicar
            ? { key: "duplicar", label: "Duplicar atividade", icon: <Copy size={16} strokeWidth={1.75} />, disabled: duplicando, onSelect: () => void duplicar(a) }
            : null,
          ac.cancelar ? { key: "cancelar", label: "Cancelar atividade", icon: <Ban size={16} strokeWidth={1.75} />, danger: true, onSelect: () => abrirDialogo("cancelar", a) } : null,
        ].filter((x) => x !== null)
      : [];
    return [abrirItem, /** @type {any[]} */ (gerir)];
  };

  /** O ⚡ da linha (grade e cards). @param {any} a */
  const renderAcoesDaLinha = (a) => (
    <B1MenuAcoesDaLinha
      rotulo={`Ações da atividade ${textoDoNumero(a)}`.trim()}
      titulo={[a?.numero != null ? `Nº ${a.numero}` : "", String(a?.nome ?? "")].filter(Boolean).join(" · ")}
      // D-PROD-234: o valor total vem da lista (o `custo_total` que o servidor soma por página); sem custo, fica de fora.
      subtitulo={[String(a?.tipo_atividade_nome ?? ""), textoDaColunaArea(a), formatarMoedaAtividade(a?.custo_total)].filter(Boolean).join(" · ")}
      grupos={gruposDoMenu(a)}
      testId={`atividade-acoes-${a.id}`}
    />
  );

  // ─── Avisos e filtros ─────────────────────────────────────────────────
  const listErrorMessage = useMemo(
    () => mensagemDeErroAtividade(controller.listaQueryError, "Não foi possível carregar as atividades. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  let aviso = null;
  if (!empresaId) {
    aviso = <AvisoGestao testId="atividades-sem-empresa">Selecione uma fazenda para ver e lançar atividades.</AvisoGestao>;
  } else if (acoes.carregando) {
    aviso = (
      <AvisoGestao tone="blue" testId="atividades-carregando">
        Carregando permissões…
      </AvisoGestao>
    );
  } else if (!acoes.ver) {
    aviso = <AvisoGestao testId="atividades-sem-permissao">Você não tem permissão para ver as atividades desta fazenda.</AvisoGestao>;
  }

  // D-PROD-267: os 7 tipos fixos e, dentro de cada um, as operações (o filtro pela operação continua aqui).
  const opcoesTipoFiltro = useMemo(() => opcoesDoFiltroTipo(/** @type {any[]} */ (tipos)), [tipos]);
  const opcoesAreaFiltro = useMemo(
    () => [{ value: "", label: "Todas as áreas" }, ...(/** @type {any[]} */ (areas)).map((a) => ({ value: String(a.id), label: rotuloDaArea(a) || String(a.id) }))],
    [areas],
  );

  const listaVazia = listEnabled && !controller.showForm && !controller.isLoading && !controller.listaErro && controller.visibleRows.length === 0;

  const banner = (
    <>
      {aviso}
      {semFuso && acoes.ver ? (
        <AvisoGestao testId="atividades-sem-fuso">
          Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de abrir, editar, concluir, reabrir, cancelar ou duplicar atividades e de lançar
          apontamentos: o servidor recusa sem ele.
        </AvisoGestao>
      ) : null}
      {listaVazia ? <AvisoGestao testId="atividades-lista-vazia">Nenhuma atividade encontrada com estes filtros.</AvisoGestao> : null}
    </>
  );

  /**
   * Os filtros da consulta, todos na faixa de pílulas do motor (D-PROD-237: sai a caixa solta de tipo, área e período
   * que ficava acima da grade). D-PROD-267 (o modelo do dono): Tipo (o tipo fixo, ou a operação dentro dele), Situação,
   * Área e Início (uma pílula com "De" e "Até"). Cada um continua indo para a query do SERVIDOR (tipo_fixo ou
   * tipo_atividade_id, situacao — ou status ABERTA em "Abertas" —, area_id, data_de, data_ate) e relendo a lista keyset do
   * começo; "Limpar filtros" volta todos ao padrão. A coluna que cada um cobre não ganha pílula própria (nem em "+ Filtro").
   * @type {import("@/components/cadastro/base1/FiltrosRapidos").FiltroDaTela[]}
   */
  const filtrosDaTela =
    empresaId && acoes.ver
      ? [
          { id: "tipo", rotulo: "Tipo", nome: "Filtrar por tipo", opcoes: opcoesTipoFiltro, valor: tipoFiltro, padrao: "", onChange: setTipoFiltro, coluna: "tipo", ocultarPadrao: true },
          { id: "situacao", rotulo: "Situação", nome: "Filtrar por situação", opcoes: OPCOES_SITUACAO, valor: situacaoFiltro, padrao: "", onChange: setSituacaoFiltro, coluna: "status", ocultarPadrao: true },
          { id: "area", rotulo: "Área", nome: "Filtrar por área", opcoes: opcoesAreaFiltro, valor: areaFiltro, padrao: "", onChange: setAreaFiltro, coluna: "area", ocultarPadrao: true },
          {
            id: "inicio",
            tipo: /** @type {const} */ ("periodo"),
            rotulo: "Início",
            nome: "Filtrar por início",
            de: dataDe,
            ate: dataAte,
            onChange: (/** @type {{ de: string, ate: string }} */ p) => {
              setDataDe(p.de);
              setDataAte(p.ate);
            },
            coluna: "data_inicio",
            testId: "atividades-filtro-inicio",
          },
        ]
      : [];

  // ─── Atividade aberta ─────────────────────────────────────────────────
  const acoesDoAberto = acoesDaAtividade(registroAberto, acoes);
  // Apontamentos: só na atividade ABERTA e com o fuso da fazenda (o "hoje" do lançamento); concluída ou cancelada = só leitura.
  const acoesDosApontamentos = {
    ...acoes,
    lancarApontamento: acoesDoAberto.lancarApontamento && podeGravar,
    editarApontamento: acoesDoAberto.editarApontamento && podeGravar,
    cancelarApontamento: acoesDoAberto.cancelarApontamento && podeGravar,
  };

  /**
   * Os avisos do status (cancelada e concluída; a reabertura fica no histórico, sem aviso), acima das abas da atividade aberta (D-PROD-234: valem para as
   * duas abas).
   * @param {any} a
   */
  const avisosDaAtividade = (a) => (
    <div className="b1-aberta-avisos">
      {a?.status === STATUS_CANCELADA ? (
        <div>
          <AvisoGestao testId="atividade-cancelada">
            Atividade cancelada
            {a.cancelada_em ? ` em ${formatarInstante(a.cancelada_em, LOCALE_ATIVIDADE, fuso)}` : ""}
            {rotuloDoUsuario(a.cancelado_por) ? ` por ${rotuloDoUsuario(a.cancelado_por)}` : ""}.
            {a.motivo_cancelamento ? ` Motivo: ${a.motivo_cancelamento}` : ""} Ela continua no histórico; nada é apagado e nada pode ser alterado.
          </AvisoGestao>
        </div>
      ) : null}
      {a?.status === STATUS_CONCLUIDA ? (
        <div>
          <AvisoGestao tone="blue" testId="atividade-concluida">
            Atividade concluída
            {a.data_conclusao ? ` em ${formatarDiaAtividade(a.data_conclusao)}` : ""}
            {rotuloDoUsuario(a.concluida_por) ? ` por ${rotuloDoUsuario(a.concluida_por)}` : ""}. Ela fica só leitura; para mudar algo, reabra-a.
          </AvisoGestao>
        </div>
      ) : null}
    </div>
  );

  /** Cabeçalho da atividade, SÓ LEITURA: os campos herdados ficam travados (ninguém digita setor, centros ou unidade). @param {any} a */
  const cabecalhoDaAtividade = (a) => {
    const semEdicao = () => {};
    return (
      <form
        className="b1 mg-b1-form-grid w-full min-h-0"
        noValidate
        onSubmit={(e) => e.preventDefault()}
        data-testid="atividade-cabecalho"
        data-densidade={DENSIDADE_BASE1}
        data-somente-leitura=""
        data-status={String(a?.status ?? "")}
      >
        <SecaoForm titulo="Atividade" />
        <CampoTexto label="Nome" value={String(a?.nome ?? "")} onChange={semEdicao} readOnly span={6} />
        <ValorCalculado label="Status" valor={rotuloDoStatusAtividade(a?.status) || "—"} span={3} testId="atividade-status" />
        <ValorCalculado label="Nº" valor={a?.numero != null ? String(a.numero) : "—"} span={3} testId="atividade-numero" />
        <CampoTexto label="Tipo de atividade" value={String(a?.tipo_atividade_nome ?? "")} onChange={semEdicao} readOnly span={6} />

        <SecaoForm titulo="Onde e com o quê" />
        {/* D-PROD-271: o serviço sem área (Manutenção e Outros) mostra o Local onde estaria a Área. */}
        {servicoSemArea(a) ? (
          <CampoTexto label="Local" value={String(a?.local ?? "")} onChange={semEdicao} readOnly span={6} testId="atividade-local" />
        ) : (
          <CampoTexto
            label={areasDaAtividade(a).length > 1 ? `Áreas (${areasDaAtividade(a).length})` : "Área"}
            value={areasDaAtividade(a).length > 1 ? areasDaAtividade(a).map(rotuloDaAreaDaAtividade).join(", ") : textoDaColunaArea(a)}
            onChange={semEdicao}
            readOnly
            span={6}
          />
        )}
        <CampoTexto label="Setor (da área)" value={rotuloDoSetor(a)} onChange={semEdicao} readOnly span={6} />
        <CampoTexto label="Máquina" value={rotuloDoBem(a?.bem)} onChange={semEdicao} readOnly span={6} />
        <CampoTexto label="Safra" value={String(a?.safra_ciclo ?? "")} onChange={semEdicao} readOnly span={6} />
        {/* D-PROD-271: o capim do Plantio de pastagem (da AtividadePlantio). */}
        {capimDoServico(a) ? (
          <CampoTexto label="Capim plantado" value={capimDoServico(a)} onChange={semEdicao} readOnly span={6} testId="atividade-capim" />
        ) : null}

        <SecaoForm titulo="Apropriação (do tipo)" />
        <CampoTexto label="Centro de custo" value={rotuloDoCentro(a?.centro_custo)} onChange={semEdicao} readOnly span={4} />
        <CampoTexto label="Centro de resultado" value={rotuloDoCentro(a?.centro_resultado)} onChange={semEdicao} readOnly span={4} />
        <CampoTexto label="Unidade de produção" value={rotuloDaUnidadeDeProducao(a)} onChange={semEdicao} readOnly span={4} />

        <SecaoForm titulo="Período e execução" />
        <CampoDia label="Data de início" value={String(a?.data_inicio ?? "")} onChange={semEdicao} readOnly span={4} testId="atividade-data-inicio" />
        <CampoDia label="Data prevista de fim" value={String(a?.data_prevista_fim ?? "")} onChange={semEdicao} readOnly span={4} testId="atividade-data-prevista-fim" />
        <CampoDia label="Data de conclusão" value={String(a?.data_conclusao ?? "")} onChange={semEdicao} readOnly span={4} testId="atividade-data-conclusao" />
        <ValorCalculado label="Área executada / planejada" valor={formatarAreaExecutadaPlanejada(a) || "—"} span={6} testId="atividade-area-executada-planejada" />
        <ValorCalculado label="Produção" valor={formatarProducaoDaAtividade(a) || "—"} span={6} testId="atividade-producao" />
        {/* D-PROD-271: Aplicação — "Pasto liberado em" (o último dia lançado + a maior carência dos produtos), calculado
            pelo servidor na leitura do detalhe; nunca gravado. */}
        {tipoFixoDoServico(a, /** @type {any[]} */ (tipos)) === "APLICACAO" ? (
          <ValorCalculado
            label="Pasto liberado em"
            // A linha da lista não traz o cálculo: até o detalhe chegar, "…".
            valor={a && "pasto_liberado_em" in a ? diaPorExtenso(a.pasto_liberado_em) || "—" : "…"}
            span={6}
            testId="atividade-pasto-liberado"
            dica={
              <p className="mt-1 min-w-0 break-words px-1 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="atividade-pasto-liberado-nota">
                {Number.isInteger(a?.carencia_dias)
                  ? `último dia lançado + carência do produto (${a.carencia_dias} ${a.carencia_dias === 1 ? "dia" : "dias"})`
                  : a && "pasto_liberado_em" in a
                    ? "sem produto com carência no cadastro"
                    : "lendo o detalhe"}
              </p>
            }
          />
        ) : null}
        {a?.lancamento_tarefa_id ? (
          <CampoTexto label="Tarefa de origem" value={rotuloDaTarefa(a?.lancamento_tarefa)} onChange={semEdicao} readOnly span={12} />
        ) : null}
        {a?.observacao ? (
          <CampoTextoLongo label="Observação" value={String(a.observacao)} onChange={semEdicao} readOnly maxLength={MAX_OBSERVACAO_ATIVIDADE} />
        ) : null}
      </form>
    );
  };

  const podeConcluirAberta = Boolean(
    controller.showForm && !controller.isEditing && registroAberto && podeGravar && acoesDoAberto.concluir && Number.isInteger(registroAberto?.versao),
  );

  let conteudoRegistro = null;
  // Na renderização da troca de fazenda o registro ainda está aberto (o efeito acima o fecha logo depois): nada dele
  // monta com a fazenda nova, senão os lançamentos da atividade anterior seriam pedidos com o `empresa_id` da nova.
  if (controller.showForm && !trocandoEmpresa) {
    if (controller.isEditing) {
      if (idAberto && !detalhe) {
        conteudoRegistro = (
          <p role="status" className="p-3 text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="atividade-carregando">
            {detalheQuery.isError ? "Não foi possível abrir a atividade." : "Carregando a atividade…"}
          </p>
        );
      } else {
        conteudoRegistro = (
          <FormularioAtividade
            // Entrar na edição, salvar (a versão muda) ou trocar de registro remonta o formulário a partir do GRAVADO.
            key={`${idAberto ?? "atividade-nova"}-${registroAberto?.versao ?? 0}-${controller.formEpoch}`}
            atividade={idAberto ? registroAberto : null}
            onSalvo={aoSalvarAtividade}
            onCancelar={controller.cancelForm}
            // O registro da tela já tem o título e o cartão.
            variant="embedded"
          />
        );
      }
    } else if (registroAberto) {
      // D-PROD-234: a atividade aberta no desenho do protótipo (abas Lançamentos / Resumo da atividade).
      conteudoRegistro = (
        <CadastroFormShell embedded>
          <AtividadeAberta
            atividade={registroAberto}
            empresaId={empresaId}
            acoes={acoesDosApontamentos}
            habilitado={acoes.ver && !trocandoEmpresa}
            cabecalho={cabecalhoDaAtividade(registroAberto)}
            avisos={avisosDaAtividade(registroAberto)}
            onAtividadeAtualizada={aoAtualizarAtividade}
            onLancar={(tipo, aba, areaId) => lancarDoMenu(registroAberto, tipo, aba, areaId ?? null)}
            onFechar={() => controller.onViewModeChange("table")}
            onConcluir={podeConcluirAberta ? () => abrirDialogo("concluir", registroAberto) : null}
          />
        </CadastroFormShell>
      );
    }
  }

  /** @type {any} */
  const Grade = CadastroBase1Grade;
  const renderCell = (/** @type {any} */ item, /** @type {string} */ colId) => {
    if (colId === "numero") return <span className="font-mono" data-testid={`atividade-numero-${item.id}`}>{item.numero ?? "–"}</span>;
    // D-PROD-267: o tipo em negrito (o modelo do dono); sem o tipo do servidor, o da operação na lista de tipos.
    if (colId === "tipo") return <strong className="font-semibold">{rotuloDoTipoDoServico(item, /** @type {any[]} */ (tipos)) || "–"}</strong>;
    // D-PROD-271: a operação com o capim do plantio embaixo (dois plantios na mesma área se distinguem).
    if (colId === "operacao") return <OperacaoDoServico item={item} />;
    if (colId === "status") {
      // D-PROD-267: a situação com o andamento e os botões "+ Lançar dia" e "Concluir".
      return (
        <SituacaoDoServico
          item={item}
          podeLancar={podeLancarDia(item)}
          podeConcluir={podeConcluirServico(item) && situacaoDoServico(item) === "EM_ANDAMENTO"}
          onLancarDia={setLancandoDia}
          onConcluir={setConcluindoServico}
        />
      );
    }
    return valorDoCampoAtividade(item, colId) || "–";
  };
  /** D-PROD-267 — o bloco do serviço no celular (o corpo do card). @param {any} item */
  const blocoDoCard = (item) => (
    <BlocoDoServico
      item={item}
      tipos={/** @type {any[]} */ (tipos)}
      comAcoes={Boolean(empresaId && acoes.ver)}
      podeLancar={podeLancarDia(item)}
      podeConcluir={podeConcluirServico(item) && situacaoDoServico(item) === "EM_ANDAMENTO"}
      onLancarDia={setLancandoDia}
      onConcluir={setConcluindoServico}
    />
  );

  const dialogoAtividade = dialogo?.atividade ?? null;

  // Atividade aberta (fora da edição): "Concluir" à vista na barra, como no protótipo (D-PROD-232); no celular, na
  // cabeça da atividade aberta, no canto de cima (D-PROD-234).
  const botaoConcluir =
    podeConcluirAberta && !celular ? (
      <PillBtn
        type="button"
        tone="outline"
        onClick={() => abrirDialogo("concluir", registroAberto)}
        aria-label="Concluir"
        title="Concluir atividade"
        className="mg-act-concluir"
        data-testid="atividade-concluir"
      >
        <CircleCheck className="h-4 w-4" aria-hidden />
        <span>Concluir</span>
      </PillBtn>
    ) : null;

  // D-PROD-254: registrar trabalho de campo (área + tipo, num formulário só) é diferente de planejar a atividade.
  // D-PROD-265: "Nova realização" (a janela abre nos cartões dos 7 tipos). D-PROD-267 (o modelo do dono): "+ Nova
  // realização" é o botão principal (o de criar da barra) e "Planejar" abre o formulário de planejar (a "Nova atividade").
  const podeRegistrar = podeGravar && acoes.lancarApontamento;
  const botaoPlanejar =
    podeGravar && acoes.criar && !controller.showForm ? (
      <PillBtn
        type="button"
        tone="outline"
        onClick={() => controller.openNew()}
        aria-label="Planejar"
        title="Planejar um serviço (a atividade, antes de lançar os dias)"
        className="mg-act-planejar"
        data-testid="atividade-planejar"
      >
        <CalendarPlus className="h-4 w-4" aria-hidden />
        <span>Planejar</span>
      </PillBtn>
    ) : null;
  const tiposDoRegistro = /** @type {any[]} */ (tipos).filter((t) => t?.ativo !== false);
  const areasDoRegistro = /** @type {any[]} */ (areas).filter((a) => a?.tipo_cultura !== "Infraestrutura");

  const flagsDoLancando = lancando ? flagsDoTipoDaAtividade(lancando.atividade, /** @type {any[]} */ (tipos)) : null;
  const tipoDoLancando = lancando ? lancamentoDoTipo(lancando.tipo) : null;

  return (
    // Os botões seguem a regra EXATA do servidor (permissão e status da
    // atividade): a heurística de texto do Layout não se aplica.
    <div data-permissao-explicita="" className="contents">
      <FiltrosDaTelaContext.Provider value={filtrosDaTela}>
        <CadastroBase1Screen
          permissaoExplicita
          workspaceTitle="Lançamento de Atividades"
          searchPlaceholder="Buscar nº, nome, tipo ou área…"
          createLabel="Nova realização"
          createText="Nova realização"
          columnsForCardsToolbar={ATIVIDADES_COLUNAS}
          controller={controller}
          listErrorMessage={listErrorMessage}
          recordCode={registroAberto?.numero != null ? String(registroAberto.numero) : undefined}
          listBanner={banner}
          showCreate={podeRegistrar}
          onCreate={() => setRegistrando(true)}
          showEdit={podeGravar && Boolean(alvo) && acoesDoAlvo.editar && versaoValida}
          showDuplicate={false}
          showDelete={false}
          additionalMoreActions={acoesVisiveisDoMenu.length ? acoesVisiveisDoMenu : null}
          extraToolbar={
            botaoPlanejar || botaoConcluir ? (
              <>
                {botaoPlanejar}
                {botaoConcluir}
              </>
            ) : null
          }
          deleteDialog={{
            title: "Cancelar atividade",
            confirmText: "Cancelar",
            descriptionOne: "Atividade não se exclui: use Cancelar atividade.",
            descriptionMany: () => "Atividade não se exclui: use Cancelar atividade.",
          }}
          recordForm={conteudoRegistro}
          listSlot={
            <Grade
              rows={controller.visibleRows}
              columns={ATIVIDADES_COLUNAS}
              storageKey={ATIVIDADES_STORAGE_KEY}
              droppableId="colunas-lancamento-atividades"
              getFieldValue={valorDoCampoAtividade}
              compararParaOrdenar={compararAtividadesParaOrdenar}
              renderCell={renderCell}
              defaultSortKey="numero"
              defaultSortDir="desc"
              emptyText={empresaId ? "Nenhuma atividade encontrada com estes filtros." : "Selecione uma fazenda"}
              isLoading={controller.isLoading}
              onOpen={controller.handleEdit}
              showConfigColunas={controller.showConfigColunas}
              setShowConfigColunas={controller.setShowConfigColunas}
              // A busca procura nas linhas JÁ carregadas (a rota da lista não tem busca por texto); a sugestão escolhida filtra pelo id.
              searchQuery={controller.searchPickId ? "" : controller.chrome.appliedSearch}
              resetFiltersKey={controller.chrome.resetFiltersKey}
              onSelectionChange={controller.chrome.onSelectionChange}
              onFiltersActiveChange={controller.chrome.setFiltersActive}
              viewMode={controller.chrome.viewMode === "cards" ? "cards" : "table"}
              cardFields={controller.cardsPrefs.cardFields}
              cardsPerRow={controller.cardsPrefs.cardsPerRow}
              cardsTitleColId="nome"
              cardsCodeColId="status"
              cardsAvatar={seloDoCardAtividade}
              cardsSubtitle={subtituloDoCardAtividade}
              // D-PROD-267: no celular, o bloco do serviço (o modelo V1) no lugar do selo, título e campos.
              cardsBody={blocoDoCard}
              // D-PROD-237: a faixa começa só com os filtros da consulta (Status, Tipo, Área, Início); os demais campos
              // continuam em "+ Filtro".
              quickFilterIds={SEM_FILTROS_AUTOMATICOS}
              quickSortOptions={ORDENS_DA_LISTA_ATIVIDADES}
              renderAcoesDaLinha={empresaId && acoes.ver ? renderAcoesDaLinha : undefined}
              {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
              configureColumnsAnchorRef={controller.configureColumnsAnchorRef}
            />
          }
        />

        {dialogo?.tipo === "concluir" && dialogoAtividade ? (
          <DialogoConcluirAtividade
            key={`concluir-${dialogoAtividade.id}-${dialogoAtividade.versao}`}
            atividade={dialogoAtividade}
            empresaId={empresaId}
            hoje={hoje}
            dataConclusao={dataConclusao}
            onDataConclusao={(v) => {
              setDataConclusao(v);
              setErroDataConclusao(null);
            }}
            erroData={erroDataConclusao}
            onFechar={() => setDialogo(null)}
            onEnviar={enviarDialogo}
            onConsultar={consultarDialogo}
          />
        ) : null}

        {registrando ? (
          <JanelaRegistroDeCampo
            tipos={tiposDoRegistro}
            areas={areasDoRegistro}
            onFechar={() => setRegistrando(false)}
          />
        ) : null}

        {lancandoDia ? (
          <JanelaRegistroDeCampo
            key={`lancar-dia-${lancandoDia.id}`}
            tipos={tiposDoRegistro}
            areas={areasDoRegistro}
            continuar={lancandoDia}
            onGravou={() => invalidarLista()}
            onFechar={() => setLancandoDia(null)}
          />
        ) : null}

        {concluindoServico ? (
          <DialogoConcluirServico
            key={`concluir-servico-${concluindoServico.id}-${concluindoServico.versao}`}
            item={concluindoServico}
            hoje={hoje}
            onFechar={() => setConcluindoServico(null)}
            onConcluir={concluirServico}
          />
        ) : null}

        {lancando && tipoDoLancando && flagsDoLancando ? (
          <JanelaLancamentoPorTipo
            key={lancando.chave}
            atividade={lancando.atividade}
            tipo={lancando.tipo}
            acoes={acoes}
            flags={flagsDoLancando}
            escopo={escopo}
            onFechar={() => setLancando(null)}
            onAtividadeAtualizada={aoEscreverNaJanelaDoTipo}
            areaInicial={lancando.areaId ?? null}
          />
        ) : null}

        {dialogo?.tipo === "reabrir" && dialogoAtividade ? (
          <DialogoAcao
            key={`reabrir-${dialogoAtividade.id}-${dialogoAtividade.versao}`}
            aberto
            janelaBase1
            titulo={`Reabrir a atividade ${textoDoNumero(dialogoAtividade)}`.trim()}
            descricao="A atividade volta a ficar aberta e a conclusão é desfeita. Motivo com pelo menos 3 caracteres."
            rotuloBotao="Reabrir atividade"
            testId="dialogo-reabrir-atividade"
            perigo={false}
            contexto={CONTEXTO_MENSAGENS}
            onFechar={() => setDialogo(null)}
            onEnviar={enviarDialogo}
            onConsultar={consultarDialogo}
          />
        ) : null}

        {dialogo?.tipo === "cancelar" && dialogoAtividade ? (
          <DialogoAcao
            key={`cancelar-${dialogoAtividade.id}-${dialogoAtividade.versao}`}
            aberto
            janelaBase1
            titulo={`Cancelar a atividade ${textoDoNumero(dialogoAtividade)}`.trim()}
            descricao="A atividade e os lançamentos confirmados dela são cancelados juntos e ficam no histórico. Motivo com pelo menos 3 caracteres."
            rotuloBotao="Cancelar atividade"
            testId="dialogo-cancelar-atividade"
            contexto={CONTEXTO_MENSAGENS}
            onFechar={() => setDialogo(null)}
            onEnviar={enviarDialogo}
            onConsultar={consultarDialogo}
          />
        ) : null}
      </FiltrosDaTelaContext.Provider>
    </div>
  );
}
