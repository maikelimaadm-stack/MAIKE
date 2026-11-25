import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import LancField from "@/components/cadastro/base1/LancField";
import B1Select from "@/components/cadastro/base1/B1Select";
import {
  LancLoteAviso,
  LancLoteForm,
  LancLoteGrade,
  LancLoteItem,
  LancLoteItens,
  LancLoteRodape,
  LancLoteSegmento,
  LL_CTL,
} from "@/components/lotes/LancamentoLoteUi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/services/sessionService";
import {
  carregarPontoAtualizado,
  listarPontosDaEmpresa,
  listarAreasDaEmpresa,
  listarRebanhoParaSuplementacao,
  listarProdutosDaEmpresa,
  listarFormulacoesParaLancamento,
  listarLotesNotaDaEmpresa,
  listarMovimentacoesPecuariasDaEmpresa,
  listarEventosDoPonto,
  ultimoEventoDoPonto,
  registrarLancamentoDoCocho,
  alterarLancamentoDoCocho,
} from "@/services/suplementacaoService";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { updateMapaCachedData, refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { normalizeText, obterSaldoProdutoLocal, parseNumber, validarBaixaFIFO } from "./estoqueSuplementacaoUtils";
import { montarCorpoDaSaidaSuplementacao } from "@/services/suplementacaoEstoqueService";
import { idDoAnteriorCitado } from "@/services/lancamentoCochoAguardandoService";
import { formatDecimal } from "./formatters";
import { calcularDiasPeriodo } from "../utils/consumoUtils";
import { buildTimeWeightedLoteAllocations } from "./timeWeightedAllocation";
import { safeDivide } from "../utils/pecuariaUtils";
import { quantidadeParaKg, produtoSuportaSacos, kgParaSacos } from "./unidadeConversaoUtils";
import { baseDoConsumo, consumoEsperadoPorFormulacao, pesoDeConsumoDoLote, resumoPesoDosLotes } from "./consumoPVUtils";
import { curvaDaProjecaoDePeso } from "@/domain/rebanho/ganhoPelaCurva";
import SobraHerdadaDialog from "./SobraHerdadaDialog";
import { listEmpresas } from "@/services/empresaService";
import { hojeNoFuso } from "@/lib/diaCivil";
import { createPageUrl } from "@/utils";
import { QUERY_FORMULACOES_LANCAMENTO, rotuloDoTipo } from "@/services/formulacaoCadastroService";
import { calcularFechamentoConsumo } from "@/domain/suplementacao/fechamentoConsumo";
import { ResumoFechamentoConsumo } from "./FarolConsumo";

/** D-PROD-268 — 409 LANCAMENTO_DESATUALIZADO do comando de lançamento. */
export const MENSAGEM_LANCAMENTO_DESATUALIZADO = "O cocho mudou (um lançamento foi excluído ou registrado em outra tela). Confira e salve de novo.";
/**
 * D-PROD-268 — 409 SUPLEMENTACAO_REGISTRO_CANCELADO no reenvio: este lançamento JÁ foi gravado e
 * depois cancelado em outra tela (o estoque já voltou). A operação acabou: a chave é descartada.
 */
export const MENSAGEM_LANCAMENTO_JA_CANCELADO = "Este lançamento já tinha sido salvo e foi excluído em outra tela; o estoque já voltou ao depósito. Nada foi gravado agora. Confira o cocho e, se for o caso, lance de novo.";

/**
 * Lançamento de suplementação no cocho, no desenho do lançamento de manejo do lote (D-PROD-222): quem abre
 * é um `LancLoteDialogo` ("Lançar Suplementação", subtítulo = o cocho); aqui o corpo é o `LancLoteForm`
 * (cada campo num `LancField`, avisos e informações em `LancLoteAviso`, a unidade em `LancLoteSegmento`, o
 * consumo por lote em `LancLoteItens`) e o `LancLoteRodape` vira o ✕/✓ do cabeçalho — o ✓ grava (botão
 * comum: Enter num campo não grava, como antes). Os dados, as contas, as validações e as mensagens são os de
 * antes; enquanto salva, os campos ficam travados, o passo aparece no topo e o ✕ não fecha (como fazia o
 * diálogo de progresso).
 *
 * `cicloCompartilhado` (D-PROD-206): o nível do cocho marcou o ciclo aberto como compartilhado (os mesmos
 * animais com o mesmo produto em outro cocho). O fechamento desse ciclo vai sem farol ("sem referência"):
 * não se rateia o consumo. Sem a prop, o serviço confere pelo cache do mapa.
 *
 * `edicao` (D-PROD-298): corrigir o lançamento feito sem internet que ainda não subiu. O formulário
 * abre preenchido com ele, o "último lançamento" é o de antes dele, o saldo não desconta ele mesmo, e
 * salvar o substitui na fila (mesma posição e mesmo código).
 * @param {{ ponto: any, onSubmit?: any, onCancel: () => void, cicloCompartilhado?: boolean,
 *   edicao?: { operationId: string, payload: any } | null }} props
 */
export default function FormularioLancamentoSuplementacao({ ponto, onSubmit, onCancel, cicloCompartilhado, edicao = null }) {
  const opEmEdicao = edicao?.operationId ?? null;
  const eventoEmEdicao = edicao?.payload?.evento ?? null;
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  // Ajuda da data do abastecimento (aria-describedby do campo).
  const idRegraData = useId();
  const parseDateLocal = (value) => {
    if (!value) return null;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [ano, mes, dia] = value.split("-").map(Number);
      return new Date(ano, mes - 1, dia);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const formatDateBR = (value) => {
    const data = parseDateLocal(value);
    return data ? data.toLocaleDateString("pt-BR") : "-";
  };
  const queryClient = useQueryClient();
  const [progresso, setProgresso] = useState({ show: false, atual: 0, total: 0, mensagem: "" });
  const [mostrarConsumoLote, setMostrarConsumoLote] = useState(false);
  const [sobraHerdadaDecidida, setSobraHerdadaDecidida] = useState(false);
  const [sobraHerdadaKg, setSobraHerdadaKg] = useState(0);
  // D-PROD-178: a data PADRÃO é o dia civil da FAZENDA (`Empresa.fuso_horario`),
  // o mesmo que o nível do cocho usa — com o navegador em outro fuso, perto da
  // meia-noite, o lançamento recém-feito não vira "data futura" nem nasce com um
  // dia consumido. Mesmo resumo de empresas do Layout (`['empresas']`). Sem fuso
  // (ou enquanto ele não chega), o relógio do navegador.
  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas"],
    queryFn: () => listEmpresas(),
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const fusoFazenda = useMemo(() => {
    const empresa = (Array.isArray(empresas) ? empresas : []).find((e) => String(e?.id) === String(empresaSelecionadaId));
    return typeof empresa?.fuso_horario === "string" && empresa.fuso_horario ? empresa.fuso_horario : null;
  }, [empresas, empresaSelecionadaId]);
  // A data que a pessoa escolheu não é trocada quando o fuso chega.
  const dataLancamentoEditada = useRef(Boolean(eventoEmEdicao));
  // O padrão da fazenda é aplicado UMA vez, quando o fuso chega: com o
  // formulário aberto na virada do dia, a data que a pessoa já viu não muda
  // sozinha (nem o `dias_periodo` do ciclo anterior).
  const padraoDoFusoAplicado = useRef(false);
  const [formData, setFormData] = useState(() => {
    const campo = (/** @type {unknown} */ v) => (v === null || v === undefined ? "" : String(v));
    return {
      data_lancamento: eventoEmEdicao?.data_lancamento ? String(eventoEmEdicao.data_lancamento).slice(0, 10) : hojeNoFuso(null),
      data_fim_consumo_anterior:
        edicao?.payload?.fechamento?.dataFim && edicao.payload.fechamento.dataFim !== eventoEmEdicao?.data_lancamento ? String(edicao.payload.fechamento.dataFim) : "",
      // D-PROD-203: a FORMULAÇÃO é obrigatória; o produto que vai ao cocho (e que se baixa) é o dela.
      formulacao_id: campo(eventoEmEdicao?.formulacao_id),
      quantidade_total_kg: campo(eventoEmEdicao?.quantidade_total_kg),
      // D-PROD-206: vazio = sobra NÃO medida (o fechamento conta 0 e marca "Aproximado"); 0 digitado = medida.
      sobra_kg: eventoEmEdicao ? (edicao?.payload?.fechamento?.sobraInformada === false ? "" : campo(eventoEmEdicao.sobra_kg)) : "",
      unidade_lancamento: eventoEmEdicao?.unidade_lancamento || "KG",
      quantidade_sacos: campo(eventoEmEdicao?.quantidade_sacos),
      observacoes: campo(eventoEmEdicao?.observacoes),
    };
  });

  useEffect(() => {
    if (!fusoFazenda || padraoDoFusoAplicado.current) return;
    padraoDoFusoAplicado.current = true;
    if (dataLancamentoEditada.current) return;
    const hojeFazenda = hojeNoFuso(fusoFazenda);
    setFormData((prev) => (prev.data_lancamento === hojeFazenda ? prev : { ...prev, data_lancamento: hojeFazenda }));
  }, [fusoFazenda]);

  const { data: user } = useQuery({ queryKey: ["user-suplementacao-form"], queryFn: () => getCurrentUser() });

  // Busca o ponto SEMPRE do banco para garantir deposito_origem_id e area_vinculada_ids corretos (ignora cache)
  const { data: pontoFresh = null, isLoading: loadingPontoFresh } = useQuery({
    queryKey: ["ponto-fresh-lancamento", ponto?.id],
    queryFn: async () => {
      if (!ponto?.id) return null;
      return (await carregarPontoAtualizado(ponto.id)) || ponto;
    },
    enabled: !!ponto?.id,
    staleTime: 0,
    gcTime: 30 * 1000, // limpa cache após 30s para não reter dados antigos entre aberturas
  });
  // pontoAtivo: prioriza sempre os dados frescos do banco
  const pontoAtivo = pontoFresh ?? ponto;

  const areaIdsVinculados = useMemo(() => {
    const ids = Array.isArray(pontoAtivo?.area_vinculada_ids) ? pontoAtivo.area_vinculada_ids.filter(Boolean) : [];
    return ids.length ? ids : (pontoAtivo?.area_vinculada_id ? [pontoAtivo.area_vinculada_id] : []);
  }, [pontoAtivo]);

  const areaNomesVinculados = useMemo(() => {
    const nomes = Array.isArray(pontoAtivo?.area_vinculada_nomes) ? pontoAtivo.area_vinculada_nomes.filter(Boolean) : [];
    return nomes.length ? nomes : (pontoAtivo?.area_vinculada_nome ? [pontoAtivo.area_vinculada_nome] : []);
  }, [pontoAtivo]);

  const { data: areas = [] } = useQuery({
    queryKey: ["areas-vinculadas-suplementacao", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarAreasDaEmpresa(empresaSelecionadaId);
      return all.filter((area) => area.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const areaNomesResolvidos = useMemo(() => {
    const nomesPorId = new Map(areas.map((area) => [area.id, area.nome]));
    const nomes = areaIdsVinculados.map((id) => nomesPorId.get(id)).filter(Boolean);
    if (nomes.length > 0) return nomes;
    if (areaNomesVinculados.length > 0) return areaNomesVinculados;
    return ponto?.area_vinculada_nome ? [ponto.area_vinculada_nome] : [];
  }, [areas, areaIdsVinculados, areaNomesVinculados, ponto?.area_vinculada_nome]);

  // D-PROD-201: o rebanho vem da MESMA fonte do mapa — as posições do ledger
  // (cabeças atuais e peso projetado) ou, no legado, os Lotes ativos.
  const { data: lotes = [], isLoading: loadingLotes } = useQuery({
    queryKey: ["rebanho-area-suplementacao", empresaSelecionadaId, areaIdsVinculados.join("|")],
    queryFn: async () => {
      const ativos = await listarRebanhoParaSuplementacao(empresaSelecionadaId);
      return ativos.filter((lote) => areaIdsVinculados.includes(lote.area_atual_id) && Number(lote.quantidade_cabecas || 0) > 0);
    },
    enabled: !!empresaSelecionadaId && areaIdsVinculados.length > 0,
  });

  // D-PROD-201: uma operação por LANÇAMENTO, não por clique. Salvar de novo
  // depois de uma falha reaproveita o mesmo `operation_id` (o servidor devolve o
  // que já gravou) e a baixa de estoque já feita — nunca baixa duas vezes.
  const operacaoRef = useRef(/** @type {null | { id: string, saida: null | { movimentacao: any, corpo: any, resumo: string }, chaveSaida: string | null }} */ (null));

  const { data: ultimoEvento, isLoading: loadingUltimoEvento } = useQuery({
    queryKey: ["ultimo-evento-ponto", empresaSelecionadaId, ponto?.id, opEmEdicao],
    queryFn: async () => {
      if (!opEmEdicao) return ultimoEventoDoPonto({ empresaId: empresaSelecionadaId, pontoId: ponto?.id });
      // Editando: o "último" é o de ANTES do que está em edição (e o período dele volta a estar aberto,
      // pois quem o fecharia é justamente o lançamento em edição).
      // O anterior é o que o lançamento em edição JÁ cita (não "o mais novo dos outros": com outro
      // lançamento do mesmo cocho na fila depois dele, isso o ligaria ao próprio dependente).
      const citado = idDoAnteriorCitado(edicao?.payload?.evento_anterior_id);
      if (!citado) return null;
      const eventos = await listarEventosDoPonto({ empresaId: empresaSelecionadaId, pontoId: ponto?.id, limit: undefined });
      const anterior = (eventos || []).find((e) => e?.id === citado) || null;
      return anterior && anterior._fechadoPorAguardando === opEmEdicao ? { ...anterior, dias_periodo: null, _fechamentoAguardando: false } : anterior;
    },
    enabled: !!empresaSelecionadaId && !!ponto?.id,
  });

  // D-PROD-203: as formulações ATIVAS da fazenda (rota própria, liberada a quem lança suplementação).
  const { data: formulacoes = [], isLoading: loadingFormulacoes } = useQuery({
    queryKey: [QUERY_FORMULACOES_LANCAMENTO, empresaSelecionadaId],
    queryFn: () => listarFormulacoesParaLancamento(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });

  // O produto de cada formulação (saldo no depósito, sacos e a baixa) vem do cadastro de Produtos.
  const { data: produtosDaEmpresa = [] } = useQuery({
    queryKey: ["produtos-suplementacao-lancamento", empresaSelecionadaId],
    queryFn: () => listarProdutosDaEmpresa(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });

  // Usa sempre o pontoFresh (banco) para resolver o depósito, não o cache
  const depositoOrigemId = pontoFresh?.deposito_origem_id || ponto?.deposito_origem_id;
  const depositoOrigemNome = pontoFresh?.deposito_origem_nome || ponto?.deposito_origem_nome;

  const { data: depositoVinculado = null } = useQuery({
    queryKey: ["deposito-vinculado-cocho", ponto?.id, depositoOrigemId, depositoOrigemNome],
    queryFn: async () => {
      const all = await listarPontosDaEmpresa(empresaSelecionadaId);
      return all.find((item) => item.id === depositoOrigemId)
        || all.find((item) => normalizeText(item.nome_ponto) === normalizeText(depositoOrigemNome) && normalizeText(item.categoria_ponto) === "DEPOSITO")
        || null;
    },
    // Só habilita quando pontoFresh já chegou (garante que os dados são do banco)
    enabled: !!(pontoFresh && (depositoOrigemId || depositoOrigemNome)),
  });

  const { data: lotesNota = [] } = useQuery({
    queryKey: ["lotes-nota-suplementacao", empresaSelecionadaId, opEmEdicao],
    queryFn: async () => {
      // D-PROD-298: editando, o saldo não desconta a baixa do próprio lançamento em edição.
      const all = await listarLotesNotaDaEmpresa(empresaSelecionadaId, { ignorar: opEmEdicao });
      return all.filter((lote) => lote.status === "Disponivel");
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: eventosRecentes = [] } = useQuery({
    queryKey: ["eventos-recentes-ponto", empresaSelecionadaId, ponto?.id],
    queryFn: () => listarEventosDoPonto({ empresaId: empresaSelecionadaId, pontoId: ponto?.id, limit: 12 }),
    enabled: !!empresaSelecionadaId && !!ponto?.id,
  });

  const { data: movimentacoesPecuaria = [] } = useQuery({
    queryKey: ["movimentacoes-pecuaria-suplementacao", empresaSelecionadaId],
    queryFn: () => listarMovimentacoesPecuariasDaEmpresa(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
    staleTime: 2 * 60 * 1000,
  });

  // === SOBRA HERDADA: detecta se o último evento tinha sobra E o cocho ficou sem lote no pasto ===
  // Condição: último evento com sobra_kg > 0 + nenhum lote ativo na área no momento atual seria "fechamento sem reabertura"
  // Mas o usuário pode estar abrindo o form justamente porque retornou lote — então usamos: se último evento foi um fechamento (dias_periodo preenchido) com sobra > 0 e ainda não tem evento de abertura depois.
  const sobraPendenteDoCochoKg = useMemo(() => {
    if (!ultimoEvento) return 0;
    const sobra = Number(ultimoEvento.sobra_kg || 0);
    // Considera sobra pendente apenas se o último evento foi um fechamento (dias_periodo preenchido) com sobra > 0
    if (sobra > 0 && ultimoEvento.dias_periodo != null) return sobra;
    return 0;
  }, [ultimoEvento]);

  const precisaDecidirSobra = sobraPendenteDoCochoKg > 0 && !sobraHerdadaDecidida;

  // Usa a sobra do último fechamento como saldo inicial de um NOVO lançamento aberto.
  // Não reabre nem altera o evento fechado anterior.
  const handleAproveitarSobra = () => {
    setSobraHerdadaKg(sobraPendenteDoCochoKg);
    setFormData((prev) => ({
      ...prev,
      quantidade_total_kg: prev.quantidade_total_kg || "0",
      sobra_kg: sobraPendenteDoCochoKg.toFixed(2),
      observacoes: prev.observacoes || `Novo ciclo iniciado aproveitando sobra anterior de ${sobraPendenteDoCochoKg.toFixed(2)} kg.`,
    }));
    setSobraHerdadaDecidida(true);
    // D-PROD-137 (SUP-02): aqui só se preenche o formulário — nada foi gravado.
    // Antes o toast VERDE dizia "Novo lançamento aberto"; fechar a tela não
    // deixava registro nenhum. O aviso diz o que de fato aconteceu.
    toast.info(`Sobra de ${sobraPendenteDoCochoKg.toFixed(2)} kg aplicada como saldo inicial. Para registrar, confirme no ✓ (Salvar novo ciclo).`);
  };

  const handleDescartarSobra = () => {
    setSobraHerdadaKg(0);
    setFormData((prev) => ({ ...prev, sobra_kg: "0" }));
    setSobraHerdadaDecidida(true);
  };

  // D-PROD-222: decidida a sobra, o foco volta ao lançamento pelo `LancLoteDialogo` da sobra: ao ✕ do
  // lançamento (quem tinha o foco quando ela abriu) ou, se ela abriu junto com ele (dados já em cache), ao
  // primeiro controle do lançamento — a pílula que o abriu fica escondida por baixo.

  // === CÁLCULOS ===
  const totalCabecas = lotes.reduce((total, lote) => total + (lote.quantidade_cabecas || 0), 0);
  // D-PROD-201: peso projetado de hoje (ou o último peso); lote sem peso fica FORA da média.
  const resumoPeso = useMemo(() => resumoPesoDosLotes(lotes), [lotes]);
  const pesoMedioGeral = resumoPeso.pesoMedio;
  const closingDateForPreviousPeriod = formData.data_fim_consumo_anterior || formData.data_lancamento;
  const diasPeriodo = ultimoEvento ? calcularDiasPeriodo(ultimoEvento.data_lancamento, closingDateForPreviousPeriod) : null;

  const formulacaoSelecionada = useMemo(
    () => formulacoes.find((f) => String(f.id) === String(formData.formulacao_id)) || null,
    [formulacoes, formData.formulacao_id],
  );
  /** Produto da formulação: o do cadastro; sem ele (lista ainda carregando), o resumo da formulação. */
  const produtoDaFormulacao = (/** @type {any} */ f) =>
    !f ? null : produtosDaEmpresa.find((p) => String(p.id) === String(f.produto_id)) || { id: f.produto_id, nome_produto: f.produto_nome };
  const produtoSelecionado = useMemo(() => produtoDaFormulacao(formulacaoSelecionada), [formulacaoSelecionada, produtosDaEmpresa]);
  const nomeProduto = produtoSelecionado?.nome_produto || formulacaoSelecionada?.produto_nome || "";

  const suportaSacos = produtoSuportaSacos(produtoSelecionado);
  const pesoPorSaco = Number(produtoSelecionado?.peso_por_saco_kg || 0);
  const tipoConsumo = produtoSelecionado?.tipo_consumo || null;

  // Quantidade em kg (sempre convertida)
  const quantidadeKg = useMemo(() => {
    if (formData.unidade_lancamento === "SACO" && suportaSacos) {
      return quantidadeParaKg(parseNumber(formData.quantidade_sacos || 0), "SACO", pesoPorSaco);
    }
    return parseNumber(formData.quantidade_total_kg || 0);
  }, [formData.unidade_lancamento, formData.quantidade_sacos, formData.quantidade_total_kg, suportaSacos, pesoPorSaco]);

  const sobraInformada = parseNumber(formData.sobra_kg || 0);
  // D-PROD-206: a sobra foi MEDIDA (inclusive 0 digitado)? Vazio = não medida.
  const sobraFoiInformada = String(formData.sobra_kg ?? "").trim() !== "";


  // D-PROD-203: consumo esperado por %PV da FORMULAÇÃO, lote a lote (regra da categoria ou o padrão;
  // categoria que não consome entra com 0; lote sem peso usa a média ponderada dos lotes com peso).
  // D-PROD-210: na base G_CAB_DIA a meta é fixa por cabeça (gramas da regra da categoria, senão o padrão), sem
  // peso e sem %PV; o esperado em kg/dia continua em `consumo_esperado_pv_kg` (a taxa que o nível do cocho lê).
  const baseConsumo = baseDoConsumo(formulacaoSelecionada);
  const baseEmGramas = baseConsumo === "G_CAB_DIA";
  const pctPV = baseEmGramas ? 0 : Number(formulacaoSelecionada?.percentual_pv_padrao || 0);
  const consumoPV = useMemo(
    () => consumoEsperadoPorFormulacao({ lotes, formulacao: formulacaoSelecionada }),
    [lotes, formulacaoSelecionada],
  );
  const consumoEsperadoGrupoDiaPV = consumoPV.totalKgDia;
  const consumoEsperadoCabDiaPV = consumoPV.cabecasConsomem > 0 ? safeDivide(consumoEsperadoGrupoDiaPV, consumoPV.cabecasConsomem) : 0;
  const consumoDoLote = useMemo(() => new Map(consumoPV.porLote.map((l) => [l.id, l])), [consumoPV]);

  // Consumo estimado do novo lançamento.
  // O cocho não tem faixa de frequência esperada (não existe `frequencia_esperada_dias*` em
  // PontoSuplementacao): a confirmação "Duração fora do esperado" lia campos inexistentes e nunca aparecia.
  const consumoReferenciaGrupoDia = consumoEsperadoGrupoDiaPV > 0
    ? consumoEsperadoGrupoDiaPV
    : (Number(ponto?.consumo_ideal_por_cabeca_kg || 0) * totalCabecas);
  const totalDisponivelNovo = Math.max(0, quantidadeKg + sobraInformada);
  const duracaoDiasNovoPeriodo = consumoReferenciaGrupoDia > 0 ? safeDivide(totalDisponivelNovo, consumoReferenciaGrupoDia) : 0;
  const duracaoDiasInteira = Math.max(0, Math.round(duracaoDiasNovoPeriodo || 0));
  const dataEstimadaProxima = (() => {
    const dataBase = parseDateLocal(formData.data_lancamento);
    if (!dataBase || duracaoDiasInteira <= 0) return null;
    return new Date(dataBase.getTime() + duracaoDiasInteira * 86400000);
  })();


  // Médias recentes
  const mediaRecente7Dias = (() => {
    const limite = new Date(formData.data_lancamento || new Date().toISOString().split("T")[0]);
    limite.setDate(limite.getDate() - 7);
    const fechados = eventosRecentes.filter((evento) => evento?.dias_periodo > 0 && new Date(evento.data_lancamento) >= limite && (evento.total_cabecas_afetadas || 0) > 0 && (evento.consumo_diario_grupo_kg || 0) > 0);
    if (!fechados.length) return 0;
    const totalAnimalDias = fechados.reduce((sum, evento) => sum + ((evento.total_cabecas_afetadas || 0) * (evento.dias_periodo || 0)), 0);
    const totalConsumido = fechados.reduce((sum, evento) => sum + ((evento.consumo_diario_grupo_kg || 0) * (evento.dias_periodo || 0)), 0);
    return safeDivide(totalConsumido, totalAnimalDias);
  })();

  const ultimoConsumoCabDia = ultimoEvento?.consumo_diario_grupo_kg
    ? safeDivide(ultimoEvento.consumo_diario_grupo_kg, ultimoEvento.total_cabecas_afetadas || 0)
    : 0;

  const alocacaoTemporalPreview = useMemo(() => {
    if (!ultimoEvento || !diasPeriodo) return [];
    const consumoTotalPreview = Math.max(0, (ultimoEvento.quantidade_total_kg || 0) - sobraInformada + (ultimoEvento.sobra_kg || 0));
    return buildTimeWeightedLoteAllocations({
      lotes,
      movimentacoes: movimentacoesPecuaria,
      areaIds: areaIdsVinculados,
      dataInicio: ultimoEvento.data_lancamento,
      dataFim: closingDateForPreviousPeriod,
      consumoTotalPeriodo: consumoTotalPreview,
    });
  }, [ultimoEvento, diasPeriodo, lotes, movimentacoesPecuaria, areaIdsVinculados, closingDateForPreviousPeriod, sobraInformada]);

  // Formulações disponíveis: com depósito vinculado, só as cujo produto tem saldo nele (ou é o
  // produto padrão do cocho), com saldo primeiro — o mesmo filtro que valia para os produtos.
  const formulacoesDisponiveis = useMemo(() => {
    if (!depositoVinculado?.local_estoque_id) return formulacoes;
    const saldo = (/** @type {any} */ f) => obterSaldoProdutoLocal(lotesNota, f.produto_id, depositoVinculado.local_estoque_id);
    const nomeDoProduto = (/** @type {any} */ f) => produtoDaFormulacao(f)?.nome_produto || f.produto_nome || "";
    return formulacoes
      .filter((f) => saldo(f) > 0 || normalizeText(nomeDoProduto(f)) === normalizeText(ponto?.produto_padrao || ""))
      .sort((a, b) => {
        const saldoA = saldo(a);
        const saldoB = saldo(b);
        if (saldoA > 0 && saldoB <= 0) return -1;
        if (saldoB > 0 && saldoA <= 0) return 1;
        return String(a.nome || "").localeCompare(String(b.nome || ""));
      });
  }, [depositoVinculado, formulacoes, produtosDaEmpresa, lotesNota, ponto]);

  const saldoNoDeposito = useMemo(() => {
    if (!depositoVinculado?.local_estoque_id || !produtoSelecionado) return 0;
    return obterSaldoProdutoLocal(lotesNota, produtoSelecionado.id, depositoVinculado.local_estoque_id);
  }, [depositoVinculado, produtoSelecionado, lotesNota]);

  // Auto-selecionar a formulação única
  useEffect(() => {
    if (!formData.formulacao_id && formulacoesDisponiveis.length === 1) {
      setFormData((prev) => ({ ...prev, formulacao_id: String(formulacoesDisponiveis[0].id) }));
    }
  }, [formData.formulacao_id, formulacoesDisponiveis]);

  // Ajustar unidade ao trocar produto
  useEffect(() => {
    if (produtoSelecionado) {
      if (!suportaSacos) {
        setFormData((prev) => ({ ...prev, unidade_lancamento: "KG", quantidade_sacos: "" }));
      }
    }
  }, [produtoSelecionado?.id]);

  // Sincronizar kg ↔ sacos
  const handleQuantidadeKgChange = (value) => {
    const kg = parseNumber(value);
    setFormData((prev) => ({
      ...prev,
      quantidade_total_kg: value,
      quantidade_sacos: suportaSacos && pesoPorSaco > 0 ? kgParaSacos(kg, pesoPorSaco).toFixed(1) : "",
    }));
  };

  const handleQuantidadeSacosChange = (value) => {
    const sacos = parseNumber(value);
    const kgConvertido = quantidadeParaKg(sacos, "SACO", pesoPorSaco);
    setFormData((prev) => ({
      ...prev,
      quantidade_sacos: value,
      quantidade_total_kg: kgConvertido.toFixed(2),
    }));
  };

  // === SALVAR ===
  const handleSalvar = async () => {
    if (progresso.show) return;

    if (!formulacoes.length) return toast.error("Não há formulação ativa nesta fazenda. Cadastre uma em Formulações antes de lançar.");
    if (!formulacaoSelecionada) return toast.error("Selecione a formulação.");
    if (quantidadeKg <= 0 && sobraInformada <= 0) return toast.error("Informe a quantidade fornecida ou aproveite uma sobra anterior.");
    if (sobraInformada < 0) return toast.error("A sobra informada não pode ser negativa.");
    if (totalCabecas <= 0) return toast.error("Não há cabeças ativas nas áreas vinculadas.");
    if (depositoVinculado?.local_estoque_id && !produtosDaEmpresa.some((p) => String(p.id) === String(formulacaoSelecionada.produto_id))) {
      return toast.error("O produto da formulação não foi encontrado no cadastro de Produtos.");
    }
    // Com a baixa desta operação já feita (salvar de novo após falha), o saldo lido pode já estar sem ela.
    if (!operacaoRef.current?.saida && depositoVinculado?.local_estoque_id && quantidadeKg > 0 && quantidadeKg > saldoNoDeposito) return toast.error("Saldo insuficiente no depósito vinculado.");

    if (loadingUltimoEvento) return toast.error("Aguarde: carregando o último lançamento deste cocho.");
    // D-PROD-201: lançamento fora de ordem fechava o período ERRADO (o mais novo, com 1 dia).
    const erroData = erroDeDataDoLancamento({
      dataLancamento: formData.data_lancamento,
      dataFimAnterior: formData.data_fim_consumo_anterior,
      ultimaData: ultimoEvento?.data_lancamento,
    });
    if (erroData) return toast.error(erroData);

    if (ultimoEvento) {
      const saldoFisicoMaximo = (ultimoEvento.quantidade_total_kg || 0) + (ultimoEvento.sobra_kg || 0);
      if (sobraInformada > saldoFisicoMaximo) {
        return toast.error("A sobra informada é maior que o total fisicamente disponível no período anterior.");
      }
    }

    if (!operacaoRef.current) {
      operacaoRef.current = {
        id: opEmEdicao || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`),
        saida: null,
        chaveSaida: null,
      };
    }
    const operacao = operacaoRef.current;
    let baixaFeitaNestaTentativa = false;
    try {
      const operationId = operacao.id;
      const deveBaixarDeposito = depositoVinculado?.local_estoque_id && produtoSelecionado && quantidadeKg > 0;
      const totalPassos = (deveBaixarDeposito ? 1 : 0) + 1;
      let passoAtual = 0;
      setProgresso({ show: true, atual: 0, total: totalPassos, mensagem: "Iniciando lançamento..." });

      // D-PROD-296: a baixa vai junto do lançamento, num registro só do motor de sincronização
      // (com internet, na hora; sem internet, sobe depois sem duplicar). Aqui só se monta o corpo.
      let saidaCorpo = null;
      const chaveSaidaAtual = deveBaixarDeposito
        ? chaveDaSaida({ produtoId: produtoSelecionado?.id, quantidadeKg, data: formData.data_lancamento, localId: depositoVinculado?.local_estoque_id })
        : null;
      if (operacao.saida && operacao.chaveSaida !== chaveSaidaAtual) {
        // A baixa desta operação JÁ foi feita com outros valores: baixar de novo duplicaria o estoque.
        setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
        toast.error(`A baixa no estoque deste lançamento já foi feita (${operacao.saida.resumo}). Volte a quantidade, o produto e a data para esses valores e salve de novo para concluir.`);
        return;
      }
      if (deveBaixarDeposito && operacao.saida) {
        // A MESMA baixa da tentativa anterior (mesmo corpo): o servidor devolve a que já gravou.
        saidaCorpo = operacao.saida.corpo;
        passoAtual += 1;
      } else if (deveBaixarDeposito) {
        // A validação é pura e roda **antes** de qualquer escrita: é ela que
        // produz a frase específica ("Saldo insuficiente neste local.
        // Disponível: …"). O servidor revalida e recusa com código estável.
        const validacao = validarBaixaFIFO({
          lotesNota,
          produto: produtoSelecionado,
          localEstoqueId: depositoVinculado.local_estoque_id,
          quantidade: quantidadeKg,
        });
        if (!validacao.ok) {
          setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
          toast.error(validacao.mensagem);
          return;
        }

        setProgresso({ show: true, atual: ++passoAtual, total: totalPassos, mensagem: "Baixando saldo do depósito..." });
        saidaCorpo = montarCorpoDaSaidaSuplementacao({
          empresaId: empresaSelecionadaId,
          produto: produtoSelecionado,
          quantidade: quantidadeKg,
          localOrigemId: depositoVinculado.local_estoque_id,
          localOrigemNome: depositoVinculado.local_estoque_nome,
          areaId: areaIdsVinculados[0] || ponto.area_vinculada_id,
          // O movimento guarda o nome em VarChar(255) e a rota recusa (400) texto maior: cocho com
          // muitos pastos impedia o lançamento. O vínculo real é `area_id`/`ponto_suplementacao_id`.
          areaNome: rotuloDeAreasDaSaida(areaNomesResolvidos, ponto.area_vinculada_nome),
          observacoes: `Saída automática para o cocho ${ponto.nome_ponto}${formData.observacoes ? ` - ${formData.observacoes}` : ""}`,
          lotesNota,
          depositoId: depositoVinculado.id,
          pontoSuplementacaoId: ponto.id,
          dataMovimentacao: formData.data_lancamento,
        });
      }

      setProgresso({ show: true, atual: ++passoAtual, total: totalPassos, mensagem: "Criando evento de suplementação..." });
      const sacosLancamento = formData.unidade_lancamento === "SACO" ? parseNumber(formData.quantidade_sacos || 0) : null;
      
      const eventoPayload = {
        empresa_id: empresaSelecionadaId,
        ponto_suplementacao_id: ponto.id,
        ponto_nome: ponto.nome_ponto,
        area_id: areaIdsVinculados[0] || ponto.area_vinculada_id,
        area_nome: areaNomesResolvidos.join(", ") || ponto.area_vinculada_nome,
        area_ids: areaIdsVinculados,
        area_nomes: areaNomesResolvidos,
        data_lancamento: formData.data_lancamento,
        produto: nomeProduto,
        produto_id: formulacaoSelecionada?.produto_id || null,
        // D-PROD-203: a formulação usada (obrigatória desde esta decisão; os lançamentos antigos ficam sem).
        formulacao_id: formulacaoSelecionada?.id || null,
        formulacao_nome: formulacaoSelecionada?.nome || null,
        formulacao_tipo: formulacaoSelecionada?.tipo || null,
        tipo_consumo: tipoConsumo || null,
        quantidade_total_kg: quantidadeKg,
        quantidade_sacos: sacosLancamento,
        peso_por_saco_kg: suportaSacos ? pesoPorSaco : null,
        unidade_lancamento: formData.unidade_lancamento,
        sobra_kg: parseNumber(formData.sobra_kg || 0),
        dias_periodo: null,
        consumo_diario_grupo_kg: null,
        total_cabecas_afetadas: totalCabecas,
        peso_medio_lotes_kg: pesoMedioGeral || null,
        // D-PROD-201: cabeças sem peso não entram na média (o esperado usa a média dos com peso).
        cabecas_sem_peso: resumoPeso.cabecasSemPeso,
        peso_total_consumo: totalCabecas,
        consumo_esperado_pv_kg: consumoEsperadoGrupoDiaPV > 0 ? consumoEsperadoGrupoDiaPV : null,
        // %PV padrão da formulação; as exceções por categoria ficam em cada lote (percentual_pv_lote).
        percentual_consumo_pv_usado: pctPV > 0 ? pctPV : null,
        // D-PROD-210: a base do consumo da formulação e, na base G_CAB_DIA, a meta em gramas por cabeça por dia
        // (média ponderada das cabeças que consomem; as exceções por categoria ficam em cada lote, g_cab_dia_lote).
        base_consumo: formulacaoSelecionada ? baseConsumo : null,
        consumo_esperado_g_cab_dia: baseEmGramas && consumoPV.gCabDiaEsperado ? Number(consumoPV.gCabDiaEsperado.toFixed(2)) : null,
        // Cabeças cuja categoria NÃO consome a formulação (fora do consumo esperado; contam em total_cabecas_afetadas).
        cabecas_nao_consomem: consumoPV.cabecasNaoConsomem,
        // movimentacao_estoque_id e custo_unitario_kg: preenchidos com a baixa no envio (D-PROD-296).
        // D-PROD-206: o fechamento do consumo usa o custo REAL da saída (FIFO), a faixa da formulação vigente no
        // lançamento (null = 15%) e o peso vivo de quem consome (base do %PV real e do esperado).
        faixa_tolerancia_percentual: typeof formulacaoSelecionada?.faixa_tolerancia_percentual === "number" ? formulacaoSelecionada.faixa_tolerancia_percentual : null,
        peso_vivo_consumo_kg: pesoVivoDeQuemConsome(consumoPV.porLote),
        observacoes: formData.observacoes || null,
      };

      const lotesPayload = lotes.map((lote) => {
        const doLote = consumoDoLote.get(lote.id);
        // Peso do próprio lote (null sem peso); o esperado do lote sem peso usa a média dos com peso.
        const pesoMedioLote = doLote && !doLote.pesoExtrapolado ? doLote.peso : 0;
        const consumoEsperadoLotePV = doLote ? doLote.esperadoKgDia : null;
        const percentualLote = totalCabecas > 0 ? (lote.quantidade_cabecas || 0) / totalCabecas : 0;

        return {
          empresa_id: empresaSelecionadaId,
          lote_id: lote.id,
          lote_nome: lote.nome,
          categoria: lote.categoria,
          fator_consumo: 1,
          peso_medio_lote_kg: pesoMedioLote || null,
          // D-PROD-203: %PV deste lote (regra da categoria ou o padrão; 0 = não consome) e o esperado dele.
          percentual_pv_lote: doLote && !baseEmGramas ? doLote.percentualPV : null,
          // D-PROD-210: gramas por cabeça por dia deste lote na base G_CAB_DIA (0 = não consome).
          g_cab_dia_lote: doLote && baseEmGramas ? doLote.gCabDia : null,
          consumo_esperado_pv_lote_kg: consumoEsperadoLotePV,
          // D-PROD-212: a curva de ganho do lote (GMD de cada mês, da projeção de peso D-PROD-198) — o fechamento
          // projeta com ela o peso no fim do período (peso médio). Só quando o peso usado é o projetado.
          gmd_mensal_kg: pesoMedioLote > 0 && pesoDeConsumoDoLote(lote).origem === "projetado" ? curvaDaProjecaoDePeso(lote.projecao_peso) : null,
          data_lancamento: formData.data_lancamento,
          produto: nomeProduto,
          cabecas_na_area: lote.quantidade_cabecas,
          peso_consumo_lote: lote.quantidade_cabecas || 0,
          percentual_consumo_lote: percentualLote,
          dias_periodo: null,
          dias_ativos_periodo: null,
          animal_dias_periodo: null,
          consumo_unitario_dia: null,
          consumo_por_cabeca_dia_kg: null,
          consumo_total_lote_periodo_kg: null,
        };
      });

      // D-PROD-296: um registro só (motor de sincronização) com a baixa, o lançamento e o fechamento
      // do período anterior. D-PROD-268: o último lançamento ATIVO que esta tela viu vai junto — o
      // servidor recusa (409 LANCAMENTO_DESATUALIZADO) se o cocho mudou entre a leitura e o envio.
      /** @type {null | { diasPeriodo: number, sobraInicial: number, sobraFinal: number, sobraInformada: boolean, compartilhado: boolean | undefined, dataFim: string }} */
      let fechamento = null;
      if (ultimoEvento && ultimoEvento.dias_periodo == null) {
        const diasPeriodoCalculado = calcularDiasPeriodo(ultimoEvento.data_lancamento, closingDateForPreviousPeriod);
        if (diasPeriodoCalculado > 0) {
          fechamento = {
            diasPeriodo: diasPeriodoCalculado,
            sobraInicial: ultimoEvento.sobra_kg || 0,
            sobraFinal: parseNumber(formData.sobra_kg || 0),
            sobraInformada: sobraFoiInformada,
            compartilhado: cicloCompartilhado,
            // A data de fim do período anterior: o "Tentar de novo" refaz o fechamento com ela
            // se o cocho mudar antes de o lançamento subir (D-PROD-296).
            dataFim: closingDateForPreviousPeriod,
          };
        } else {
          toast.warning("Datas inconsistentes — período anterior não foi fechado.");
        }
      }
      let resultado;
      try {
        const dadosDoLancamento = { saida: saidaCorpo, evento: eventoPayload, lotes: lotesPayload, eventoAnterior: ultimoEvento ?? null, fechamento };
        const rotuloDaFila = `Lançamento · ${ponto.nome_ponto ?? "cocho"}`;
        resultado = opEmEdicao
          ? await alterarLancamentoDoCocho(opEmEdicao, dadosDoLancamento, { rotulo: rotuloDaFila })
          : await registrarLancamentoDoCocho(dadosDoLancamento, { operationId, rotulo: rotuloDaFila });
      } catch (erroDoLancamento) {
        // A baixa foi gravada e o lançamento não: a próxima tentativa reusa o MESMO corpo da baixa.
        const feita = /** @type {any} */ (erroDoLancamento)?.saidaFeita;
        if (feita && !operacao.saida) {
          operacao.saida = {
            movimentacao: feita,
            corpo: saidaCorpo,
            resumo: `${formatDecimal(quantidadeKg, 2)} kg de ${nomeProduto} em ${formatDateBR(formData.data_lancamento)}`,
          };
          operacao.chaveSaida = chaveSaidaAtual;
          baixaFeitaNestaTentativa = true;
        }
        throw erroDoLancamento;
      }
      const novoEvento = resultado.evento;
      if (resultado.fechamento === "falhou") {
        // `toast.warn` não existe no sonner (D-PROD-201): o lançamento JÁ está gravado.
        toast.warning("Falha ao fechar o período anterior, mas o lançamento foi salvo.");
      }
      operacaoRef.current = null;

      await updateMapaCachedData('eventosSuplementacao', empresaSelecionadaId, (items) => [novoEvento, ...(items || []).filter((i) => i?.id !== novoEvento?.id)]);
      if (!resultado.aguardandoEnvio) {
        await Promise.all([
          refreshMapaCacheEntry('eventosSuplementacao', empresaSelecionadaId, { force: true }),
          refreshMapaCacheEntry('movimentacaoEstoque', empresaSelecionadaId, { force: true }),
          refreshMapaCacheEntry('estoqueLotes', empresaSelecionadaId, { force: true }),
        ]);
      }

      queryClient.setQueryData(["ultimo-evento-ponto", empresaSelecionadaId, ponto?.id], novoEvento);
      queryClient.setQueryData(["eventos-recentes-ponto", empresaSelecionadaId, ponto?.id], (current = []) => [novoEvento, ...current].slice(0, 12));
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (["eventos-ponto", "ultimo-evento-ponto", "eventos-recentes-ponto", "lotes-nota-suplementacao", "mapa-eventos-supl", "movimentacoes", "produtos", "suplementacao-ponto", "saldo-deposito", "movimentacoes-deposito-detalhe", "mapa-eventosSuplementacao"].includes(query.queryKey[0]) || (query.queryKey[0] === "mapa-cache" && query.queryKey[1] === "eventosSuplementacao")) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      setProgresso({ show: true, atual: totalPassos, total: totalPassos, mensagem: "Concluído!" });
      toast.success(opEmEdicao ? "Lançamento corrigido." : "Suplementação registrada com sucesso.");
      setTimeout(() => {
        setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
        onCancel();
      }, 400);
    } catch (error) {
      setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
      // D-PROD-268: o cocho mudou (lançamento cancelado ou registrado em outra tela). Nada foi
      // gravado neste passo; a baixa já feita (operacaoRef) é reaproveitada no reenvio.
      const codigoErro = /** @type {any} */ (error)?.cause?.code;
      if (codigoErro === "SUPLEMENTACAO_REGISTRO_CANCELADO") {
        // O replay da chave desta operação achou o lançamento cancelado: nada a concluir, nem a
        // baixa (já estornada) nem o fechamento do anterior. Uma nova tentativa é outra operação.
        operacaoRef.current = null;
        queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["ultimo-evento-ponto", "eventos-recentes-ponto", "eventos-ponto", "lotes-nota-suplementacao", "saldo-deposito", "movimentacoes", "produtos"].includes(query.queryKey[0]) });
        toast.error(MENSAGEM_LANCAMENTO_JA_CANCELADO);
        return;
      }
      const desatualizado = codigoErro === "LANCAMENTO_DESATUALIZADO";
      if (desatualizado) {
        queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["ultimo-evento-ponto", "eventos-recentes-ponto", "eventos-ponto"].includes(query.queryKey[0]) });
      }
      const motivo = desatualizado
        ? MENSAGEM_LANCAMENTO_DESATUALIZADO
        : getApiErrorMessage(error, "Não foi possível registrar a suplementação.");
      toast.error(
        operacao.saida
          ? `${motivo} A baixa no estoque ${baixaFeitaNestaTentativa ? "foi registrada" : "já estava registrada"}: clique em salvar de novo para concluir — o estoque não será baixado outra vez.`
          : motivo,
      );
    }
  };

  const botaoHabilitado = totalCabecas > 0 && Boolean(formulacaoSelecionada) && totalDisponivelNovo > 0 && !loadingUltimoEvento;
  const semFormulacao = !!empresaSelecionadaId && !loadingFormulacoes && formulacoes.length === 0;
  const salvando = progresso.show;
  const percentualProgresso = progresso.total ? (progresso.atual / progresso.total) * 100 : 0;

  // O ✓ do cabeçalho (ou o do rodapé, fora do diálogo) é um botão comum que chama o `handleSalvar`, com as
  // mesmas validações e mensagens de antes. O <form> não grava sozinho: Enter num campo não envia, como antes
  // (o "Salvar novo ciclo" era `type="button"`). O lançamento do cocho baixa o estoque e fecha o período
  // anterior, e não tem estorno pela tela (D-PROD-94a): um Enter para ir ao próximo campo não pode gravar.
  const naoGravaPeloEnter = (/** @type {React.FormEvent} */ e) => e.preventDefault();

  return (
    <>
      <SobraHerdadaDialog
        open={precisaDecidirSobra}
        sobraKg={sobraPendenteDoCochoKg}
        pontoNome={ponto?.nome_ponto}
        ultimoLancamentoData={ultimoEvento?.data_lancamento}
        onAproveitar={handleAproveitarSobra}
        onDescartar={handleDescartarSobra}
        onCancel={onCancel}
      />
      {/* `noValidate`: quem valida é o `handleSalvar` (as mensagens de sempre), não o navegador. */}
      <LancLoteForm onSubmit={naoGravaPeloEnter} noValidate data-testid="form-lancamento-suplementacao">
        {/* Progresso do salvamento (antes um diálogo por cima): fica no topo enquanto salva. */}
        {salvando ? (
          <div className="sticky top-0 z-10">
            <LancLoteAviso tom="neutro" data-testid="suplementacao-progresso">
              <div className="flex items-center justify-between gap-2">
                <span role="status" aria-live="polite">
                  <strong className="font-semibold">Salvando...</strong> {progresso.mensagem}
                </span>
                <span className="text-[11px] text-slate-500">{progresso.atual}/{progresso.total}</span>
              </div>
              <div
                role="progressbar"
                aria-label="Progresso do salvamento"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(percentualProgresso)}
                className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
              >
                <div className="h-full rounded-full bg-[#40de63] transition-all duration-300" style={{ width: `${percentualProgresso}%` }} />
              </div>
            </LancLoteAviso>
          </div>
        ) : null}

        {/* Enquanto salva, nada muda (o diálogo de progresso cobria a tela): os campos ficam travados. */}
        <fieldset disabled={salvando} className="mk-ll m-0 min-w-0 border-0 p-0">
          {/* Resumo do cocho: o que o lançamento vai usar. */}
          <LancLoteAviso tom="neutro" data-testid="suplementacao-resumo-cocho">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
              <Info rotulo="Áreas">{areaNomesResolvidos.join(", ") || ponto?.area_vinculada_nome || "-"}</Info>
              <Info rotulo="Depósito">{loadingPontoFresh ? "..." : (depositoVinculado?.nome_ponto || depositoOrigemNome || "Não vinculado")}</Info>
              <Info rotulo="Lotes">{loadingLotes ? "..." : `${formatDecimal(lotes.length, 0, true)} lote(s) - ${formatDecimal(totalCabecas, 0, true)} cabeças`}</Info>
              <Info rotulo="Peso médio">{pesoMedioGeral > 0 ? `${formatDecimal(pesoMedioGeral, 1)} kg` : "-"}</Info>
            </div>
            <OrigemDoPeso resumo={resumoPeso} totalCabecas={totalCabecas} baseEmGramas={baseEmGramas} />
            {ultimoEvento && diasPeriodo ? (
              <p className="mt-1 text-[11px] text-slate-500">Último lançamento: {formatDateBR(ultimoEvento.data_lancamento)} • Período: {formatDecimal(diasPeriodo, 0, true)} dia(s)</p>
            ) : null}
          </LancLoteAviso>
          <AvisoSemPeso resumo={resumoPeso} totalCabecas={totalCabecas} baseEmGramas={baseEmGramas} />

          {!depositoVinculado?.local_estoque_id ? (
            <LancLoteAviso tom="neutro" data-testid="suplementacao-sem-deposito">Este cocho ainda não tem depósito vinculado. Lançamento sem baixa automática.</LancLoteAviso>
          ) : null}
          {semFormulacao ? (
            <LancLoteAviso tom="ambar" role="alert" data-testid="suplementacao-sem-formulacao">
              Não há formulação ativa nesta fazenda: o lançamento precisa de uma. Cadastre em{" "}
              <a href={createPageUrl("Formulacoes")} className="font-semibold underline">Formulações</a> (menu Manejo) o produto pronto ou a batelada e o consumo (% PV ou g/cab/dia).
            </LancLoteAviso>
          ) : null}

          <LancLoteGrade className="items-start">
            <LancField label="Data do abastecimento" required>
              <Input
                type="date"
                aria-label="Data em que o sal foi colocado no cocho"
                aria-describedby={idRegraData}
                value={formData.data_lancamento}
                onChange={(e) => {
                  dataLancamentoEditada.current = true;
                  setFormData((prev) => ({ ...prev, data_lancamento: e.target.value }));
                }}
                className={LL_CTL}
              />
            </LancField>
            <LancField label="Data fim consumo anterior">
              <Input type="date" value={formData.data_fim_consumo_anterior} onChange={(e) => setFormData((prev) => ({ ...prev, data_fim_consumo_anterior: e.target.value }))} className={LL_CTL} />
            </LancField>
          </LancLoteGrade>
          <p id={idRegraData} className="mk-ll__item-rodape">Informe o dia em que o sal foi colocado, mesmo que esteja registrando depois. A estimativa desconta o consumo por dia, a partir do dia seguinte ao abastecimento.</p>

          <LancField label="Formulação" required>
            <B1Select
              value={formData.formulacao_id}
              onChange={(e) => {
                const valor = e.target.value;
                setFormData((prev) => ({ ...prev, formulacao_id: valor }));
              }}
              disabled={semFormulacao}
              className={LL_CTL}
            >
              {formulacoesDisponiveis.map((f) => (
                <option key={f.id} value={String(f.id)}>{rotuloDaFormulacao(f, produtoDaFormulacao(f))}</option>
              ))}
            </B1Select>
          </LancField>
          {formulacaoSelecionada ? (
            <p className="mk-ll__item-rodape" data-testid="suplementacao-produto-da-formulacao">Produto no cocho: {nomeProduto}</p>
          ) : null}

          {/* Produto em sacos: a unidade do lançamento (o estoque é sempre em kg). */}
          {suportaSacos ? (
            <LancLoteSegmento
              rotulo="Unidade de lançamento"
              name="unidade_lancamento"
              opcoes={[
                { value: "KG", label: "Quilogramas (KG)" },
                { value: "SACO", label: `Sacos (${pesoPorSaco} kg/saco)` },
              ]}
              valor={formData.unidade_lancamento}
              onChange={(valor) => setFormData((prev) => ({ ...prev, unidade_lancamento: valor }))}
            />
          ) : null}

          <LancLoteGrade className="items-start">
            {formData.unidade_lancamento === "SACO" && suportaSacos ? (
              <>
                <LancField label="Quantidade de sacos" required>
                  <Input type="text" inputMode="decimal" value={formData.quantidade_sacos} onChange={(e) => handleQuantidadeSacosChange(e.target.value)} className={LL_CTL} placeholder="0" />
                </LancField>
                <LancField label="Equivalente em kg">
                  <div className="mg-input" data-testid="suplementacao-equivalente-kg">{formatDecimal(quantidadeKg)} kg</div>
                </LancField>
              </>
            ) : (
              <div className="flex min-w-0 flex-col gap-1">
                <LancField label="Quantidade total fornecida (kg)" required>
                  <Input type="text" inputMode="decimal" value={formData.quantidade_total_kg} onChange={(e) => handleQuantidadeKgChange(e.target.value)} className={LL_CTL} placeholder="0,00" />
                </LancField>
                {suportaSacos && pesoPorSaco > 0 && quantidadeKg > 0 ? (
                  <p className="mk-ll__item-rodape" data-testid="suplementacao-kg-em-sacos">≈ {formatDecimal(kgParaSacos(quantidadeKg, pesoPorSaco), 1)} saco(s)</p>
                ) : null}
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-1">
              <LancField
                label={
                  <>
                    Sobra no cocho (kg)
                    {sobraHerdadaKg > 0 ? <span className="ml-1 font-semibold text-amber-700">• Herdada do ciclo anterior</span> : null}
                  </>
                }
              >
                <Input type="text" inputMode="decimal" aria-label="Sobra no cocho (kg)" value={formData.sobra_kg} onChange={(e) => setFormData((prev) => ({ ...prev, sobra_kg: e.target.value }))} className={LL_CTL} placeholder="Não medida" />
              </LancField>
              {ultimoEvento && ultimoEvento.dias_periodo == null && !sobraFoiInformada ? (
                <p className="mk-ll__item-rodape" data-testid="suplementacao-sobra-nao-medida">Sem sobra medida, o fechamento conta 0 e fica marcado como aproximado.</p>
              ) : null}
            </div>
          </LancLoteGrade>

          {/* Saldo do depósito e a baixa automática. */}
          {depositoVinculado?.local_estoque_id && produtoSelecionado ? (
            <LancLoteAviso tom="neutro" data-testid="suplementacao-saldo-deposito">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
                <Info rotulo="Saldo depósito">{`${saldoNoDeposito.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${produtoSelecionado.unidade_medida || "KG"}`}</Info>
                {suportaSacos && pesoPorSaco > 0 ? (
                  <Info rotulo="Sacos">{`${kgParaSacos(saldoNoDeposito, pesoPorSaco).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} sacos`}</Info>
                ) : null}
                <Info rotulo="Baixa automática"><span className="text-emerald-700">Ativa</span></Info>
              </div>
            </LancLoteAviso>
          ) : null}
          {depositoVinculado?.local_estoque_id && formulacaoSelecionada && produtoSelecionado && saldoNoDeposito <= 0 ? (
            <LancLoteAviso tom="vermelho" data-testid="suplementacao-sem-saldo">Produto sem saldo disponível neste depósito/local de estoque.</LancLoteAviso>
          ) : null}

          {/* Consumo do fechamento / estimativa */}
          {ultimoEvento ? (() => {
            const sobraAnterior = ultimoEvento.sobra_kg || 0;
            const fornecidoAnterior = ultimoEvento.quantidade_total_kg || 0;
            const diasAnterior = ultimoEvento.dias_periodo || diasPeriodo || 0;
            const totalDisponivelAnterior = ultimoEvento.dias_periodo != null ? fornecidoAnterior : fornecidoAnterior + sobraAnterior;
            const sobraFechamento = ultimoEvento.dias_periodo != null ? sobraAnterior : sobraInformada;
            const consumoDiarioAnterior = ultimoEvento.consumo_diario_grupo_kg || safeDivide(Math.max(0, totalDisponivelAnterior - sobraFechamento), diasAnterior);
            const consumoPorCabAnterior = safeDivide(consumoDiarioAnterior, ultimoEvento.total_cabecas_afetadas || 0);
            const consumidoAnterior = Math.max(0, totalDisponivelAnterior - sobraFechamento);
            return (
              <LancLoteAviso tom="neutro" data-testid="suplementacao-fechamento-anterior">
                <p className="font-semibold text-slate-800">Consumo do fechamento / estimativa</p>
                <Kpis
                  itens={[
                    { rotulo: "Fornecido", valor: `${fornecidoAnterior.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg` },
                    { rotulo: "Consumido", valor: `${consumidoAnterior.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg` },
                    { rotulo: "Consumo/dia", valor: `${consumoDiarioAnterior.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg` },
                    { rotulo: "Consumo/cab/dia", valor: `${consumoPorCabAnterior.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg` },
                  ]}
                />
                <p className="mt-1 text-[11px] text-slate-500">Período analisado: {formatDecimal(diasAnterior, 0, true)} dia(s) • Cabeças: {formatDecimal(ultimoEvento.total_cabecas_afetadas || 0, 0, true)}</p>
                {/* D-PROD-206: prévia do farol do fechamento (o que será gravado ao salvar). */}
                {ultimoEvento.dias_periodo == null && diasAnterior > 0 ? (
                  <div className="mt-1.5">
                    <ResumoFechamentoConsumo
                      previa
                      // As células sem borda dos números acima (Fornecido, Consumido…): sem caixa dentro do aviso.
                      desenho="kpis"
                      resumo={calcularFechamentoConsumo({
                        evento: ultimoEvento,
                        consumoTotalKg: consumidoAnterior,
                        diasPeriodo: diasAnterior,
                        sobraInformada: sobraFoiInformada,
                        faixaPercentual: Object.prototype.hasOwnProperty.call(ultimoEvento, "faixa_tolerancia_percentual")
                          ? ultimoEvento.faixa_tolerancia_percentual
                          : formulacoes.find((f) => String(f.id) === String(ultimoEvento.formulacao_id))?.faixa_tolerancia_percentual ?? null,
                        custoUnitarioKg: ultimoEvento.custo_unitario_kg ?? null,
                        compartilhado: cicloCompartilhado === true,
                      })}
                    />
                  </div>
                ) : null}
              </LancLoteAviso>
            );
          })() : null}

          {/* D-PROD-210: painel da base g/cab/dia — meta fixa por cabeça, sem peso. */}
          {baseEmGramas && consumoPV.cabecasConsomem > 0 && consumoEsperadoGrupoDiaPV > 0 ? (
            <LancLoteAviso tom="neutro" data-testid="suplementacao-painel-g">
              <p className="font-semibold text-slate-800">Consumo esperado em g/cab/dia da formulação</p>
              <Kpis
                itens={[
                  { rotulo: "Meta/cab/dia", valor: `${formatDecimal(consumoPV.gCabDiaEsperado || 0, 0, true)} g`, testId: "suplementacao-meta-g" },
                  { rotulo: "Cabeças que consomem", valor: formatDecimal(consumoPV.cabecasConsomem, 0, true) },
                  { rotulo: "Esperado grupo/dia", valor: `${consumoEsperadoGrupoDiaPV.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`, testId: "suplementacao-esperado-grupo" },
                ]}
              />
              {consumoPV.cabecasNaoConsomem > 0 ? (
                <p className="mt-1 text-[11px] text-slate-500" data-testid="suplementacao-nao-consomem">
                  {formatDecimal(consumoPV.cabecasNaoConsomem, 0, true)} cabeça(s) não consomem esta formulação (regra da categoria): ficam fora do esperado.
                </p>
              ) : null}
              {consumoPV.porLote.some((l) => l.origem === "regra") ? (
                <p className="mt-1 text-[11px] text-slate-500">Categorias com g/cab/dia próprio na formulação entram com os gramas delas.</p>
              ) : null}
            </LancLoteAviso>
          ) : null}

          {/* Painel %PV - quando disponível */}
          {pctPV > 0 && pesoMedioGeral > 0 && totalCabecas > 0 ? (
            <LancLoteAviso tom="neutro" data-testid="suplementacao-painel-pv">
              <p className="font-semibold text-slate-800">Consumo esperado por %PV da formulação</p>
              <Kpis
                itens={[
                  { rotulo: "%PV", valor: `${formatDecimal(pctPV, 3)}%` },
                  { rotulo: "Peso médio", valor: `${pesoMedioGeral.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg` },
                  { rotulo: "Esperado/cab/dia", valor: `${consumoEsperadoCabDiaPV.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg` },
                  { rotulo: "Esperado grupo/dia", valor: `${consumoEsperadoGrupoDiaPV.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`, testId: "suplementacao-esperado-grupo" },
                ]}
              />
              {consumoPV.cabecasNaoConsomem > 0 ? (
                <p className="mt-1 text-[11px] text-slate-500" data-testid="suplementacao-nao-consomem">
                  {formatDecimal(consumoPV.cabecasNaoConsomem, 0, true)} cabeça(s) não consomem esta formulação (regra da categoria): ficam fora do esperado.
                </p>
              ) : null}
              {consumoPV.porLote.some((l) => l.origem === "regra") ? (
                <p className="mt-1 text-[11px] text-slate-500">Categorias com % PV próprio na formulação entram com o % delas.</p>
              ) : null}
            </LancLoteAviso>
          ) : null}

          {/* Consumo por lote (novo lançamento): um item por lote, como os itens dos manejos. */}
          {quantidadeKg > 0 && totalCabecas > 0 && lotes.length > 0 ? (
            <LancLoteItens>
              <button
                type="button"
                className="mk-ll__opcao"
                aria-expanded={mostrarConsumoLote}
                data-testid="suplementacao-consumo-por-lote"
                onClick={() => setMostrarConsumoLote((prev) => !prev)}
              >
                <span>Consumo por Lote (novo lançamento)</span>
                <span>{mostrarConsumoLote ? "Ocultar" : "Ver"}</span>
              </button>
              {mostrarConsumoLote
                ? lotes.map((lote) => {
                    const percentualConsumo = totalCabecas > 0 ? ((lote.quantidade_cabecas || 0) / totalCabecas) * 100 : 0;
                    const pesoMedioLote = Number(lote.peso_medio_kg || 0);
                    const quantidadeLoteKg = totalDisponivelNovo * (percentualConsumo / 100);
                    const esperadoLote = consumoDoLote.get(lote.id)?.esperadoKgDia || 0;
                    const duracaoLoteDias = lote.quantidade_cabecas > 0 && esperadoLote > 0
                      ? Math.max(0, Math.round(safeDivide(quantidadeLoteKg, esperadoLote)))
                      : duracaoDiasInteira;
                    const dataReposicaoLote = (() => {
                      const dataBase = parseDateLocal(formData.data_lancamento);
                      if (!dataBase || duracaoLoteDias <= 0) return null;
                      return new Date(dataBase.getTime() + duracaoLoteDias * 86400000);
                    })();
                    return (
                      <LancLoteItem
                        key={lote.id}
                        titulo={lote.nome}
                        sub={`Área: ${lote.area_atual_nome || areaNomesResolvidos.join(", ") || ponto.area_vinculada_nome || "-"} · ${formatDecimal(percentualConsumo, 1)}%`}
                      >
                        <Kpis
                          className="mk-ll__cheio"
                          colunas={5}
                          itens={[
                            { rotulo: "Cabeças", valor: formatDecimal(lote.quantidade_cabecas || 0, 0, true) },
                            { rotulo: "Peso médio", valor: pesoMedioLote > 0 ? `${formatDecimal(pesoMedioLote, 0)} kg` : "-" },
                            { rotulo: "Qtd. lote", valor: `${formatDecimal(quantidadeLoteKg, 2)} kg` },
                            { rotulo: "Duração", valor: duracaoLoteDias > 0 ? `${formatDecimal(duracaoLoteDias, 0, true)} dia(s)` : "-" },
                            { rotulo: "Próx. reposição", valor: dataReposicaoLote ? dataReposicaoLote.toLocaleDateString("pt-BR") : "-" },
                          ]}
                        />
                      </LancLoteItem>
                    );
                  })
                : null}
            </LancLoteItens>
          ) : null}

          <LancField label="Observações">
            <Textarea value={formData.observacoes} onChange={(e) => setFormData((prev) => ({ ...prev, observacoes: e.target.value }))} className={LL_CTL} rows={3} />
          </LancField>
        </fieldset>

        {/* Dentro do diálogo vira o ✕/✓ do cabeçalho; fora dele, o rodapé Cancelar + Salvar. */}
        <LancLoteRodape
          onCancelar={() => {
            // Salvando, o ✕ (e o Esc da tela cheia) não fecha: o diálogo de progresso também não deixava.
            if (!salvando) onCancel();
          }}
          cancelarDesabilitado={salvando}
          tipoAcao="button"
          onAcao={() => handleSalvar()}
          textoAcao="Salvar novo ciclo"
          textoEnviando="Registrando..."
          enviando={salvando}
          disabled={!botaoHabilitado}
        />
      </LancLoteForm>
    </>
  );
}
/**
 * D-PROD-201 — chave dos valores de uma baixa de estoque: mudou a chave depois
 * de a baixa ser feita, salvar de novo NÃO pode baixar outra vez.
 * @param {{ produtoId?: unknown, quantidadeKg: number, data?: string, localId?: unknown }} p
 */
export function chaveDaSaida({ produtoId, quantidadeKg, data, localId }) {
  return [String(produtoId ?? ""), Number(quantidadeKg || 0).toFixed(4), String(data ?? ""), String(localId ?? "")].join("|");
}

/** Tamanho máximo de `area_nome` no comando de saída de estoque (VarChar(255) no movimento). */
export const MAX_ROTULO_AREAS_SAIDA = 255;

/**
 * Rótulo das áreas do cocho para a saída de estoque, cabendo em `max` caracteres: todos os nomes
 * quando cabem; senão os primeiros e "+N" ("PASTO A, PASTO B +10"); em último caso, o texto cortado
 * com "…". Sem nomes, o `fallback` (também limitado). Nada → null.
 * @param {unknown[]} nomes
 * @param {unknown} [fallback]
 * @param {number} [max]
 * @returns {string | null}
 */
export function rotuloDeAreasDaSaida(nomes, fallback, max = MAX_ROTULO_AREAS_SAIDA) {
  const lista = (Array.isArray(nomes) ? nomes : []).map((n) => String(n ?? "").trim()).filter(Boolean);
  const cortar = (/** @type {string} */ t) => (t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1))}…`);
  if (!lista.length) {
    const reserva = String(fallback ?? "").trim();
    return reserva ? cortar(reserva) : null;
  }
  const completo = lista.join(", ");
  if (completo.length <= max) return completo;
  for (let k = lista.length - 1; k >= 1; k -= 1) {
    const rotulo = `${lista.slice(0, k).join(", ")} +${lista.length - k}`;
    if (rotulo.length <= max) return rotulo;
  }
  return cortar(completo);
}

/**
 * D-PROD-206 — R$/kg da saída de estoque (FIFO) do lançamento: `valor_unitario` do movimento; sem saída
 * (cocho sem depósito) ou valor inválido → null ("sem custo").
 * @param {any} movimento
 */
export const custoUnitarioDaSaida = (movimento) => {
  const v = movimento?.valor_unitario;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * D-PROD-206 — peso vivo (kg) de quem CONSOME a formulação: Σ cabeças × peso de cada lote que consome
 * (o lote sem peso entra com a média dos com peso, como no esperado). Sem peso nenhum → null.
 * @param {Array<{ cabecas: number, peso: number, consome: boolean }>} porLote
 */
export const pesoVivoDeQuemConsome = (porLote) => {
  const total = (porLote || []).reduce((soma, l) => soma + (l?.consome && l.peso > 0 ? l.cabecas * l.peso : 0), 0);
  return total > 0 ? Number(total.toFixed(2)) : null;
};

const diaDe = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const brDe = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

/**
 * D-PROD-201 — datas do lançamento. O abastecimento não pode ser ANTERIOR ao
 * último deste cocho (fecharia o período errado), e o fim do consumo anterior,
 * quando informado, fica entre o último abastecimento e o novo. Mesmo dia é
 * aceito. `null` = ok; senão a mensagem para a tela.
 * @param {{ dataLancamento?: string, dataFimAnterior?: string, ultimaData?: string }} p
 */
export function erroDeDataDoLancamento({ dataLancamento, dataFimAnterior, ultimaData }) {
  const nova = diaDe(dataLancamento);
  if (!nova) return "Informe a data do abastecimento.";
  const ultima = diaDe(ultimaData);
  if (ultima && nova < ultima) {
    return `A data do abastecimento (${brDe(nova)}) é anterior ao último abastecimento deste cocho (${brDe(ultima)}). Lançamentos fora de ordem não são aceitos.`;
  }
  const fim = diaDe(dataFimAnterior);
  if (fim && ultima && fim < ultima) {
    return `O fim do consumo anterior (${brDe(fim)}) não pode ser antes do último abastecimento (${brDe(ultima)}).`;
  }
  if (fim && fim > nova) {
    return `O fim do consumo anterior (${brDe(fim)}) não pode ser depois do novo abastecimento (${brDe(nova)}).`;
  }
  return null;
}

/**
 * Texto da formulação na lista: nome • tipo (meta de consumo) • saco do produto — o mesmo de antes.
 * @param {any} f formulação
 * @param {any} produto produto da formulação (cadastro de Produtos)
 */
const rotuloDaFormulacao = (f, produto) =>
  `${f.nome} • ${rotuloDoTipo(f.tipo)}${
    f.base_consumo === "G_CAB_DIA"
      ? ` (${formatDecimal(Number(f.consumo_objetivo_g_cab_dia || 0), 0, true)} g/cab/dia)`
      : ` (${formatDecimal(Number(f.percentual_pv_padrao || 0), 3)}% PV)`
  }${produto?.unidade_principal_estoque === "SACO" ? ` • Saco ${produto.peso_por_saco_kg}kg` : ""}`;

/**
 * Uma informação do resumo ("Áreas: PASTO 07"), dentro de um `LancLoteAviso`.
 * @param {{ rotulo: string, children: React.ReactNode }} props
 */
function Info({ rotulo, children }) {
  return (
    <div className="min-w-0 text-slate-500">
      {rotulo}: <strong className="font-semibold text-slate-800">{children}</strong>
    </div>
  );
}

/**
 * Números de um painel (rótulo em cima, valor embaixo), sem caixa dentro de caixa.
 * @param {{ itens: Array<{ rotulo: string, valor: React.ReactNode, testId?: string }>, colunas?: 4 | 5, className?: string }} props
 */
function Kpis({ itens, colunas = 4, className }) {
  return (
    <dl className={cn("mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5", colunas === 5 ? "sm:grid-cols-5" : "sm:grid-cols-4", className)}>
      {itens.map((item) => (
        <div key={item.rotulo} className="min-w-0">
          <dt className="text-[11px] text-slate-500">{item.rotulo}</dt>
          <dd className="font-semibold text-slate-800" data-testid={item.testId}>{item.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * D-PROD-201 — de onde vem o peso do consumo por %PV (linha do resumo).
 * D-PROD-210: na base g/cab/dia a meta não usa peso — a linha não aparece.
 * @param {{ resumo: ReturnType<typeof resumoPesoDosLotes>, totalCabecas: number, baseEmGramas?: boolean }} props
 */
function OrigemDoPeso({ resumo, totalCabecas, baseEmGramas = false }) {
  if (!(totalCabecas > 0) || baseEmGramas || !(resumo.cabecasComPeso > 0)) return null;
  return (
    <p className="mt-1 text-[11px] text-slate-500" data-testid="suplementacao-peso-origem">
      Peso para o consumo: {resumo.cabecasProjetado === resumo.cabecasComPeso ? "peso projetado de hoje" : resumo.cabecasProjetado > 0 ? "peso projetado de hoje (ou o último peso, sem projeção)" : "último peso (pesagem ou entrada)"}.
    </p>
  );
}

/**
 * D-PROD-201 — aviso de cabeças sem peso (elas não entram na média; antes entravam como 0 kg).
 * D-PROD-210: na base g/cab/dia a meta não usa peso — o aviso de falta de peso não aparece.
 * @param {{ resumo: ReturnType<typeof resumoPesoDosLotes>, totalCabecas: number, baseEmGramas?: boolean }} props
 */
function AvisoSemPeso({ resumo, totalCabecas, baseEmGramas = false }) {
  if (!(totalCabecas > 0) || baseEmGramas || !(resumo.cabecasSemPeso > 0)) return null;
  return (
    <LancLoteAviso tom="ambar" data-testid="suplementacao-sem-peso">
      {resumo.cabecasComPeso > 0
        ? `${formatDecimal(resumo.cabecasSemPeso, 0, true)} cabeça(s) sem peso (${resumo.lotesSemPeso.map((l) => l.nome).filter(Boolean).join(", ") || "lote sem nome"}): o consumo esperado usa o peso médio dos lotes com peso.`
        : "Nenhum lote do pasto tem peso: o consumo esperado por %PV não é calculado. Registre uma pesagem."}
    </LancLoteAviso>
  );
}
