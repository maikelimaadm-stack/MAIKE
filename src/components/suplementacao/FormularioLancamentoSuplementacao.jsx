import { X, Check, Loader2 } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  registrarLancamento,
  fecharPeriodoSuplementacao,
} from "@/services/suplementacaoService";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { updateMapaCachedData, refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { Progress } from "@/components/ui/progress";
import { normalizeText, obterSaldoProdutoLocal, parseNumber, validarBaixaFIFO } from "./estoqueSuplementacaoUtils";
import { registrarSaidaSuplementacao } from "@/services/suplementacaoEstoqueService";
import { formatDecimal } from "./formatters";
import { calcularDiasPeriodo } from "../utils/consumoUtils";
import { buildTimeWeightedLoteAllocations } from "./timeWeightedAllocation";
import { safeDivide } from "../utils/pecuariaUtils";
import { quantidadeParaKg, produtoSuportaSacos, kgParaSacos } from "./unidadeConversaoUtils";
import { baseDoConsumo, consumoEsperadoPorFormulacao, pesoDeConsumoDoLote, resumoPesoDosLotes } from "./consumoPVUtils";
import { curvaDaProjecaoDePeso } from "@/domain/rebanho/ganhoPelaCurva";
import SobraHerdadaDialog from "./SobraHerdadaDialog";
import { confirmar } from "@/lib/maikeConfirmar";
import { listEmpresas } from "@/services/empresaService";
import { hojeNoFuso } from "@/lib/diaCivil";
import { createPageUrl } from "@/utils";
import { QUERY_FORMULACOES_LANCAMENTO, rotuloDoTipo } from "@/services/formulacaoCadastroService";
import { calcularFechamentoConsumo } from "@/domain/suplementacao/fechamentoConsumo";
import { ResumoFechamentoConsumo } from "./FarolConsumo";

/**
 * `cicloCompartilhado` (D-PROD-206): o nível do cocho marcou o ciclo aberto como compartilhado (os mesmos
 * animais com o mesmo produto em outro cocho). O fechamento desse ciclo vai sem farol ("sem referência"):
 * não se rateia o consumo. Sem a prop, o serviço confere pelo cache do mapa.
 * @param {{ ponto: any, onSubmit?: any, onCancel: () => void, cicloCompartilhado?: boolean }} props
 */
export default function FormularioLancamentoSuplementacao({ ponto, onSubmit, onCancel, cicloCompartilhado }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
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
  const dataLancamentoEditada = useRef(false);
  // O padrão da fazenda é aplicado UMA vez, quando o fuso chega: com o
  // formulário aberto na virada do dia, a data que a pessoa já viu não muda
  // sozinha (nem o `dias_periodo` do ciclo anterior).
  const padraoDoFusoAplicado = useRef(false);
  const [formData, setFormData] = useState({
    data_lancamento: hojeNoFuso(null),
    data_fim_consumo_anterior: "",
    // D-PROD-203: a FORMULAÇÃO é obrigatória; o produto que vai ao cocho (e que se baixa) é o dela.
    formulacao_id: "",
    quantidade_total_kg: "",
    // D-PROD-206: vazio = sobra NÃO medida (o fechamento conta 0 e marca "Aproximado"); 0 digitado = medida.
    sobra_kg: "",
    unidade_lancamento: "KG",
    quantidade_sacos: "",
    observacoes: "",
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
  const operacaoRef = useRef(/** @type {null | { id: string, saida: any, chaveSaida: string | null }} */ (null));

  const { data: ultimoEvento, isLoading: loadingUltimoEvento } = useQuery({
    queryKey: ["ultimo-evento-ponto", empresaSelecionadaId, ponto?.id],
    queryFn: () => ultimoEventoDoPonto({ empresaId: empresaSelecionadaId, pontoId: ponto?.id }),
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
    queryKey: ["lotes-nota-suplementacao", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarLotesNotaDaEmpresa(empresaSelecionadaId);
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
    toast.info(`Sobra de ${sobraPendenteDoCochoKg.toFixed(2)} kg aplicada como saldo inicial. Clique em "Salvar novo ciclo" para registrar.`);
  };

  const handleDescartarSobra = () => {
    setSobraHerdadaKg(0);
    setFormData((prev) => ({ ...prev, sobra_kg: "0" }));
    setSobraHerdadaDecidida(true);
  };

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

  // Consumo estimado do novo lançamento
  const frequenciaMinima = Math.max(0, Number(ponto?.frequencia_esperada_dias_minimo || 0));
  const frequenciaMaxima = Math.max(frequenciaMinima || 0, Number(ponto?.frequencia_esperada_dias_maximo || ponto?.frequencia_esperada_dias || 0));
  const frequenciaMedia = frequenciaMinima > 0 && frequenciaMaxima > 0
    ? (frequenciaMinima + frequenciaMaxima) / 2
    : Math.max(1, Number(ponto?.frequencia_esperada_dias || 1));
  const consumoReferenciaGrupoDia = consumoEsperadoGrupoDiaPV > 0
    ? consumoEsperadoGrupoDiaPV
    : (Number(ponto?.consumo_ideal_por_cabeca_kg || 0) * totalCabecas);
  const totalDisponivelNovo = Math.max(0, quantidadeKg + sobraInformada);
  const consumoEstimadoCabDia = totalCabecas > 0 && frequenciaMedia > 0 ? safeDivide(totalDisponivelNovo, totalCabecas * frequenciaMedia) : 0;
  const consumoEstimadoGramas = consumoEstimadoCabDia * 1000;
  const duracaoDiasNovoPeriodo = consumoReferenciaGrupoDia > 0 ? safeDivide(totalDisponivelNovo, consumoReferenciaGrupoDia) : 0;
  const duracaoDiasInteira = Math.max(0, Math.round(duracaoDiasNovoPeriodo || 0));
  const dataEstimadaProxima = (() => {
    const dataBase = parseDateLocal(formData.data_lancamento);
    if (!dataBase || duracaoDiasInteira <= 0) return null;
    return new Date(dataBase.getTime() + duracaoDiasInteira * 86400000);
  })();

  const statusDuracao = (() => {
    if (duracaoDiasInteira <= 0) return { status: "sem_dados", label: "Sem referência", message: "Não foi possível calcular a duração estimada." };
    if (frequenciaMinima > 0 && duracaoDiasInteira < frequenciaMinima) {
      return { status: "baixo", label: "Abaixo do mínimo", message: `A duração estimada ficou abaixo da frequência mínima (${formatDecimal(frequenciaMinima, 0, true)} dia(s)).` };
    }
    if (frequenciaMaxima > 0 && duracaoDiasInteira > frequenciaMaxima) {
      return { status: "alto", label: "Acima do máximo", message: `A duração estimada ficou acima da frequência máxima (${formatDecimal(frequenciaMaxima, 0, true)} dia(s)).` };
    }
    return { status: "normal", label: "Dentro do limite", message: "A duração estimada ficou dentro da faixa esperada do cocho." };
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

    if (statusDuracao.status === "baixo" || statusDuracao.status === "alto") {
      const confirmarDuracao = await confirmar({ titulo: "Duração fora do esperado", descricao: `${statusDuracao.message}\n\nDeseja salvar mesmo assim?`, textoConfirmar: "Salvar mesmo assim" });
      if (!confirmarDuracao) return;
    }

    if (!operacaoRef.current) {
      operacaoRef.current = {
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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

      let movimentoEstoque = null;
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
        movimentoEstoque = operacao.saida.movimentacao;
        passoAtual += 1;
      } else if (deveBaixarDeposito) {
        // A validação é pura e roda **antes** de qualquer escrita: é ela que
        // produz a frase específica ("Saldo insuficiente neste local.
        // Disponível: …"). O service revalida e recusa com código estável — a
        // mensagem do catálogo é o fallback, não a primeira linha de defesa.
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
        const saidaRegistrada = await registrarSaidaSuplementacao({
          empresaId: empresaSelecionadaId,
          produto: produtoSelecionado,
          quantidade: quantidadeKg,
          localOrigemId: depositoVinculado.local_estoque_id,
          localOrigemNome: depositoVinculado.local_estoque_nome,
          areaId: areaIdsVinculados[0] || ponto.area_vinculada_id,
          areaNome: areaNomesResolvidos.join(", ") || ponto.area_vinculada_nome,
          observacoes: `Saída automática para o cocho ${ponto.nome_ponto}${formData.observacoes ? ` - ${formData.observacoes}` : ""}`,
          lotesNota,
          depositoId: depositoVinculado.id,
          pontoSuplementacaoId: ponto.id,
          dataMovimentacao: formData.data_lancamento,
          operationId,
        });
        movimentoEstoque = saidaRegistrada.movimentacao;
        operacao.saida = {
          movimentacao: saidaRegistrada.movimentacao,
          resumo: `${formatDecimal(quantidadeKg, 2)} kg de ${nomeProduto} em ${formatDateBR(formData.data_lancamento)}`,
        };
        operacao.chaveSaida = chaveSaidaAtual;
        baixaFeitaNestaTentativa = true;
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
        movimentacao_estoque_id: movimentoEstoque?.id || null,
        // D-PROD-206: o fechamento do consumo usa o custo REAL da saída (FIFO), a faixa da formulação vigente no
        // lançamento (null = 15%) e o peso vivo de quem consome (base do %PV real e do esperado).
        custo_unitario_kg: custoUnitarioDaSaida(movimentoEstoque),
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

      // O service cria o evento e, com o id dele, grava os lotes em bloco.
      const novoEvento = await registrarLancamento({ evento: eventoPayload, lotes: lotesPayload, operationId });

      try {
        if (ultimoEvento && ultimoEvento.dias_periodo == null) {
          const diasPeriodoCalculado = calcularDiasPeriodo(
            ultimoEvento.data_lancamento,
            closingDateForPreviousPeriod
          );

          if (diasPeriodoCalculado > 0) {
            await fecharPeriodoSuplementacao({
              evento: ultimoEvento,
              diasPeriodo: diasPeriodoCalculado,
              sobraInicial: ultimoEvento.sobra_kg || 0,
              sobraFinal: parseNumber(formData.sobra_kg || 0),
              sobraInformada: sobraFoiInformada,
              compartilhado: cicloCompartilhado,
            });
          } else {
            toast.warning("Datas inconsistentes — período anterior não foi fechado.");
          }
        }
      } catch {
        // `toast.warn` não existe no sonner: o TypeError caía no catch de fora e a tela
        // dizia "Não foi possível registrar" com o lançamento JÁ gravado (D-PROD-201).
        toast.warning("Falha ao fechar o período anterior, mas o lançamento foi salvo.");
      }
      operacaoRef.current = null;

      await updateMapaCachedData('eventosSuplementacao', empresaSelecionadaId, (items) => [novoEvento, ...(items || [])]);
      await Promise.all([
        refreshMapaCacheEntry('eventosSuplementacao', empresaSelecionadaId, { force: true }),
        refreshMapaCacheEntry('movimentacaoEstoque', empresaSelecionadaId, { force: true }),
        refreshMapaCacheEntry('estoqueLotes', empresaSelecionadaId, { force: true }),
      ]);

      queryClient.setQueryData(["ultimo-evento-ponto", empresaSelecionadaId, ponto?.id], novoEvento);
      queryClient.setQueryData(["eventos-recentes-ponto", empresaSelecionadaId, ponto?.id], (current = []) => [novoEvento, ...current].slice(0, 12));
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (["eventos-ponto", "ultimo-evento-ponto", "eventos-recentes-ponto", "lotes-nota-suplementacao", "mapa-eventos-supl", "movimentacoes", "produtos", "suplementacao-ponto", "saldo-deposito", "movimentacoes-deposito-detalhe", "mapa-eventosSuplementacao"].includes(query.queryKey[0]) || (query.queryKey[0] === "mapa-cache" && query.queryKey[1] === "eventosSuplementacao")) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      setProgresso({ show: true, atual: totalPassos, total: totalPassos, mensagem: "Concluído!" });
      toast.success("Suplementação registrada com sucesso.");
      setTimeout(() => {
        setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
        onCancel();
      }, 400);
    } catch (error) {
      setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
      const motivo = getApiErrorMessage(error, "Não foi possível registrar a suplementação.");
      toast.error(
        operacao.saida
          ? `${motivo} A baixa no estoque ${baixaFeitaNestaTentativa ? "foi registrada" : "já estava registrada"}: clique em salvar de novo para concluir — o estoque não será baixado outra vez.`
          : motivo,
      );
    }
  };

  const botaoHabilitado = totalCabecas > 0 && Boolean(formulacaoSelecionada) && totalDisponivelNovo > 0 && !loadingUltimoEvento;
  const semFormulacao = !!empresaSelecionadaId && !loadingFormulacoes && formulacoes.length === 0;

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
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-emerald-50 border-b border-emerald-200 py-2 px-3"><CardTitle className="text-sm font-bold text-emerald-900">Lançar Suplementação - {ponto?.nome_ponto}</CardTitle></CardHeader>
        <CardContent className="p-2 max-h-[calc(100vh-200px)] overflow-y-auto overflow-x-hidden">
          <div className="space-y-1">
            {/* Resumo do ponto */}
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2 text-[11px] space-y-1">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Áreas: <span className="font-semibold text-slate-900">{areaNomesResolvidos.join(", ") || ponto?.area_vinculada_nome || "-"}</span></div>
                <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Depósito: <span className="font-semibold text-slate-900">{loadingPontoFresh ? "..." : (depositoVinculado?.nome_ponto || depositoOrigemNome || "Não vinculado")}</span></div>
                <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Lotes: <span className="font-semibold text-slate-900">{loadingLotes ? "..." : `${formatDecimal(lotes.length, 0, true)} lote(s) - ${formatDecimal(totalCabecas, 0, true)} cabeças`}</span></div>
                <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Peso médio: <span className="font-semibold text-slate-900">{pesoMedioGeral > 0 ? `${formatDecimal(pesoMedioGeral, 1)} kg` : "-"}</span></div>
              </div>
              <AvisoPesoDoRebanho resumo={resumoPeso} totalCabecas={totalCabecas} baseEmGramas={baseEmGramas} />
              {ultimoEvento && diasPeriodo && <div className="text-[10px] text-slate-600 pt-1 border-t border-emerald-200">Último lançamento: {formatDateBR(ultimoEvento.data_lancamento)} • Período: {formatDecimal(diasPeriodo, 0, true)} dia(s)</div>}
            </div>

            {!depositoVinculado?.local_estoque_id && <div className="rounded border border-slate-200 bg-[#FAFCFE] px-2 py-1 text-[10px] text-slate-600">Este cocho ainda não tem depósito vinculado. Lançamento sem baixa automática.</div>}
            {semFormulacao && (
              <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800" role="alert" data-testid="suplementacao-sem-formulacao">
                Não há formulação ativa nesta fazenda: o lançamento precisa de uma. Cadastre em{" "}
                <a href={createPageUrl("Formulacoes")} className="font-semibold underline">Formulações</a> (menu Manejo) o produto pronto ou a batelada e o consumo (% PV ou g/cab/dia).
              </div>
            )}

            {/* Formulário principal */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <div>
                <label className="text-[12px] text-slate-500 pl-1 leading-none">Data do abastecimento <span className="text-red-500">*</span></label>
                <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors"><Input type="date" aria-label="Data em que o sal foi colocado no cocho" aria-describedby="regra-data-abastecimento" value={formData.data_lancamento} onChange={(e) => { dataLancamentoEditada.current = true; setFormData((prev) => ({ ...prev, data_lancamento: e.target.value })); }} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></div>
                <p id="regra-data-abastecimento" className="mt-1 text-[10px] leading-snug text-slate-500">Informe o dia em que o sal foi colocado, mesmo que esteja registrando depois. A estimativa desconta o consumo por dia, a partir do dia seguinte ao abastecimento.</p>
              </div>
              <div>
                <label className="text-[12px] text-slate-500 pl-1 leading-none">Data fim consumo anterior</label>
                <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors"><Input type="date" value={formData.data_fim_consumo_anterior} onChange={(e) => setFormData((prev) => ({ ...prev, data_fim_consumo_anterior: e.target.value }))} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></div>
              </div>
              <div>
                <label className="text-[12px] text-slate-500 pl-1 leading-none">Formulação <span className="text-red-500">*</span></label>
                <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors"><Select value={formData.formulacao_id} onValueChange={(value) => setFormData((prev) => ({ ...prev, formulacao_id: value }))} disabled={semFormulacao}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="Selecione a formulação" /></SelectTrigger>
                  <SelectContent>
                    {formulacoesDisponiveis.map((f) => {
                      const produto = produtoDaFormulacao(f);
                      return (
                        <SelectItem key={f.id} value={f.id} className="text-xs">
                          {f.nome}
                          {` • ${rotuloDoTipo(f.tipo)}`}
                          {f.base_consumo === "G_CAB_DIA"
                            ? ` (${formatDecimal(Number(f.consumo_objetivo_g_cab_dia || 0), 0, true)} g/cab/dia)`
                            : ` (${formatDecimal(Number(f.percentual_pv_padrao || 0), 3)}% PV)`}
                          {produto?.unidade_principal_estoque === "SACO" ? ` • Saco ${produto.peso_por_saco_kg}kg` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select></div>
                {formulacaoSelecionada && (
                  <div className="text-[10px] text-slate-500 pl-1" data-testid="suplementacao-produto-da-formulacao">Produto no cocho: {nomeProduto}</div>
                )}
              </div>
            </div>

            {/* Campos de quantidade com suporte a sacos */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              {suportaSacos && (
                <div>
                  <label className="text-[12px] text-slate-500 pl-1 leading-none">Unidade de lançamento</label>
                  <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors"><Select value={formData.unidade_lancamento} onValueChange={(value) => setFormData((prev) => ({ ...prev, unidade_lancamento: value }))}>
                    <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KG" className="text-xs">Quilogramas (KG)</SelectItem>
                      <SelectItem value="SACO" className="text-xs">Sacos ({pesoPorSaco} kg/saco)</SelectItem>
                    </SelectContent>
                  </Select></div>
                </div>
              )}

              {formData.unidade_lancamento === "SACO" && suportaSacos ? (
                <>
                  <div>
                    <label className="text-[12px] text-slate-500 pl-1 leading-none">Quantidade de sacos <span className="text-red-500">*</span></label>
                    <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors"><Input type="text" inputMode="decimal" value={formData.quantidade_sacos} onChange={(e) => handleQuantidadeSacosChange(e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0" /></div>
                  </div>
                  <div>
                    <label className="text-[12px] text-slate-500 pl-1 leading-none">Equivalente em kg</label>
                    <div className="h-7 flex items-center px-3 bg-slate-100 rounded-md text-xs font-semibold text-slate-700 border border-slate-300">{formatDecimal(quantidadeKg)} kg</div>
                  </div>
                </>
              ) : (
                <div className={`${suportaSacos ? "" : "lg:col-span-2"}`}>
                  <label className="text-[12px] text-slate-500 pl-1 leading-none">Quantidade total fornecida (kg) <span className="text-red-500">*</span></label>
                  <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors"><Input type="text" inputMode="decimal" value={formData.quantidade_total_kg} onChange={(e) => handleQuantidadeKgChange(e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0,00" /></div>
                  {suportaSacos && pesoPorSaco > 0 && quantidadeKg > 0 && (
                    <div className="text-[10px] text-slate-500">≈ {formatDecimal(kgParaSacos(quantidadeKg, pesoPorSaco), 1)} saco(s)</div>
                  )}
                </div>
              )}

              <div>
                <label className="text-[12px] text-slate-500 pl-1 leading-none">
                  Sobra no cocho (kg)
                  {sobraHerdadaKg > 0 && <span className="ml-1 text-amber-700 font-semibold">• Herdada do ciclo anterior</span>}
                </label>
                <div className={`rounded-md border ${sobraHerdadaKg > 0 ? "border-amber-300 bg-amber-50" : "border-slate-300"} focus-within:border-emerald-500 transition-colors`}>
                  <Input type="text" inputMode="decimal" aria-label="Sobra no cocho (kg)" value={formData.sobra_kg} onChange={(e) => setFormData((prev) => ({ ...prev, sobra_kg: e.target.value }))} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="Não medida" />
                </div>
                {ultimoEvento && ultimoEvento.dias_periodo == null && !sobraFoiInformada && (
                  <div className="text-[10px] text-slate-500" data-testid="suplementacao-sobra-nao-medida">
                    Sem sobra medida, o fechamento conta 0 e fica marcado como aproximado.
                  </div>
                )}
              </div>
            </div>

            {/* Saldo depósito */}
            {depositoVinculado?.local_estoque_id && produtoSelecionado && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Saldo depósito: <span className="font-semibold text-slate-900">{saldoNoDeposito.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {produtoSelecionado.unidade_medida || "KG"}</span></div>
                {suportaSacos && pesoPorSaco > 0 && <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Sacos: <span className="font-semibold text-slate-900">{kgParaSacos(saldoNoDeposito, pesoPorSaco).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} sacos</span></div>}
                <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Baixa automática: <span className="font-semibold text-emerald-700">Ativa</span></div>
              </div>
            )}
            {depositoVinculado?.local_estoque_id && formulacaoSelecionada && produtoSelecionado && saldoNoDeposito <= 0 && (
              <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700">
                Produto sem saldo disponível neste depósito/local de estoque.
              </div>
            )}



            {/* Consumo do fechamento / estimativa */}
            {ultimoEvento && (() => {
              const sobraAnterior = ultimoEvento.sobra_kg || 0;
              const fornecidoAnterior = ultimoEvento.quantidade_total_kg || 0;
              const diasAnterior = ultimoEvento.dias_periodo || diasPeriodo || 0;
              const totalDisponivelAnterior = ultimoEvento.dias_periodo != null ? fornecidoAnterior : fornecidoAnterior + sobraAnterior;
              const sobraFechamento = ultimoEvento.dias_periodo != null ? sobraAnterior : sobraInformada;
              const consumoDiarioAnterior = ultimoEvento.consumo_diario_grupo_kg || safeDivide(Math.max(0, totalDisponivelAnterior - sobraFechamento), diasAnterior);
              const consumoPorCabAnterior = safeDivide(consumoDiarioAnterior, ultimoEvento.total_cabecas_afetadas || 0);
              const consumidoAnterior = Math.max(0, totalDisponivelAnterior - sobraFechamento);
              return (
                <div className="rounded-lg border border-slate-200 bg-[#FAFCFE] p-2 text-[11px] space-y-1">
                  <div className="text-xs font-semibold text-slate-900">Consumo do fechamento / estimativa</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Fornecido</div><div className="font-bold text-slate-900">{fornecidoAnterior.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</div></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Consumido</div><div className="font-bold text-slate-900">{consumidoAnterior.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</div></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Consumo/dia</div><div className="font-bold text-slate-900">{consumoDiarioAnterior.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</div></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Consumo/cab/dia</div><div className="font-bold text-slate-900">{consumoPorCabAnterior.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg</div></div>
                  </div>
                  <div className="text-[10px] text-slate-600">Período analisado: {formatDecimal(diasAnterior, 0, true)} dia(s) • Cabeças: {formatDecimal(ultimoEvento.total_cabecas_afetadas || 0, 0, true)}</div>
                  {/* D-PROD-206: prévia do farol do fechamento (o que será gravado ao salvar). */}
                  {ultimoEvento.dias_periodo == null && diasAnterior > 0 && (
                    <ResumoFechamentoConsumo
                      previa
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
                  )}
                </div>
              );
            })()}

            {/* D-PROD-210: painel da base g/cab/dia — meta fixa por cabeça, sem peso. */}
            {baseEmGramas && consumoPV.cabecasConsomem > 0 && consumoEsperadoGrupoDiaPV > 0 && (
              <div className="rounded-lg border border-slate-200 bg-[#FAFCFE] p-2 text-[11px] space-y-1" data-testid="suplementacao-painel-g">
                <div className="text-xs font-semibold text-slate-900">Consumo esperado em g/cab/dia da formulação</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Meta/cab/dia</div><div className="font-bold text-slate-900" data-testid="suplementacao-meta-g">{formatDecimal(consumoPV.gCabDiaEsperado || 0, 0, true)} g</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Cabeças que consomem</div><div className="font-bold text-slate-900">{formatDecimal(consumoPV.cabecasConsomem, 0, true)}</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Esperado grupo/dia</div><div className="font-bold text-slate-900" data-testid="suplementacao-esperado-grupo">{consumoEsperadoGrupoDiaPV.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</div></div>
                </div>
                {consumoPV.cabecasNaoConsomem > 0 && (
                  <div className="text-[10px] text-slate-600" data-testid="suplementacao-nao-consomem">
                    {formatDecimal(consumoPV.cabecasNaoConsomem, 0, true)} cabeça(s) não consomem esta formulação (regra da categoria): ficam fora do esperado.
                  </div>
                )}
                {consumoPV.porLote.some((l) => l.origem === "regra") && (
                  <div className="text-[10px] text-slate-600">Categorias com g/cab/dia próprio na formulação entram com os gramas delas.</div>
                )}
              </div>
            )}

            {/* Painel %PV - quando disponível */}
            {pctPV > 0 && pesoMedioGeral > 0 && totalCabecas > 0 && (
              <div className="rounded-lg border border-slate-200 bg-[#FAFCFE] p-2 text-[11px] space-y-1" data-testid="suplementacao-painel-pv">
                <div className="text-xs font-semibold text-slate-900">Consumo esperado por %PV da formulação</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">%PV</div><div className="font-bold text-slate-900">{formatDecimal(pctPV, 3)}%</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Peso médio</div><div className="font-bold text-slate-900">{pesoMedioGeral.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Esperado/cab/dia</div><div className="font-bold text-slate-900">{consumoEsperadoCabDiaPV.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Esperado grupo/dia</div><div className="font-bold text-slate-900" data-testid="suplementacao-esperado-grupo">{consumoEsperadoGrupoDiaPV.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</div></div>
                </div>
                {consumoPV.cabecasNaoConsomem > 0 && (
                  <div className="text-[10px] text-slate-600" data-testid="suplementacao-nao-consomem">
                    {formatDecimal(consumoPV.cabecasNaoConsomem, 0, true)} cabeça(s) não consomem esta formulação (regra da categoria): ficam fora do esperado.
                  </div>
                )}
                {consumoPV.porLote.some((l) => l.origem === "regra") && (
                  <div className="text-[10px] text-slate-600">Categorias com % PV próprio na formulação entram com o % delas.</div>
                )}
              </div>
            )}

            {/* Consumo por lote */}
            {quantidadeKg > 0 && totalCabecas > 0 && lotes.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-[#FAFCFE] p-2 text-[11px] space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <div className="text-xs font-semibold text-slate-900">Consumo por Lote (novo lançamento)</div>
                  <Button data-mk-map-action="" type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setMostrarConsumoLote((prev) => !prev)}>
                    {mostrarConsumoLote ? "Ocultar" : "Ver"}
                  </Button>
                </div>
                {mostrarConsumoLote && (
                  <div className="space-y-1">
                    {lotes.map((lote) => {
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
                        <div key={lote.id} className="rounded-lg border border-slate-200 bg-white p-2 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold text-xs text-slate-900">{lote.nome}</div>
                            <Badge variant="outline" className="text-[10px]">{formatDecimal(percentualConsumo, 1)}%</Badge>
                          </div>
                          <div className="text-[10px] text-slate-600">Área: {lote.area_atual_nome || areaNomesResolvidos.join(', ') || ponto.area_vinculada_nome || '-'}</div>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-1 text-[10px]">
                            <div><div className="text-slate-500">Cabeças</div><div className="font-bold text-slate-900">{formatDecimal(lote.quantidade_cabecas || 0, 0, true)}</div></div>
                            <div><div className="text-slate-500">Peso médio</div><div className="font-bold text-slate-900">{pesoMedioLote > 0 ? `${formatDecimal(pesoMedioLote, 0)} kg` : '-'}</div></div>
                            <div><div className="text-slate-500">Qtd. lote</div><div className="font-bold text-slate-900">{formatDecimal(quantidadeLoteKg, 2)} kg</div></div>
                            <div><div className="text-slate-500">Duração</div><div className="font-bold text-slate-900">{duracaoLoteDias > 0 ? `${formatDecimal(duracaoLoteDias, 0, true)} dia(s)` : '-'}</div></div>
                            <div><div className="text-slate-500">Próx. reposição</div><div className="font-bold text-slate-900">{dataReposicaoLote ? dataReposicaoLote.toLocaleDateString('pt-BR') : '-'}</div></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="text-[12px] text-slate-500 pl-1 leading-none">Observações</label>
              <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors"><Textarea value={formData.observacoes} onChange={(e) => setFormData((prev) => ({ ...prev, observacoes: e.target.value }))} className="text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" rows={3} /></div>
            </div>
            <div className="flex justify-end gap-1 pt-1 border-t">
              <Button data-mk-map-action="" type="button" variant="outline" onClick={onCancel} size="sm" className="tb-btn tb-btn-gray h-7 text-xs mk-launch-action" aria-label="Cancelar" title="Cancelar"><X aria-hidden /><span className="mk-launch-action-label">Cancelar</span></Button>
              <Button data-mk-map-action="" type="button" onClick={handleSalvar} size="sm" className="tb-btn tb-btn-green h-7 text-xs mk-launch-action" aria-label={progresso.show ? "Registrando..." : "Salvar novo ciclo"} title="Salvar novo ciclo" aria-busy={progresso.show || undefined} disabled={!botaoHabilitado || progresso.show}>{progresso.show ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}<span className="mk-launch-action-label">{progresso.show ? "Registrando..." : "Salvar novo ciclo"}</span></Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <Dialog open={progresso.show} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Salvando...</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-600">{progresso.mensagem}</p>
            <Progress value={progresso.total ? (progresso.atual / progresso.total) * 100 : 0} className="w-full h-1.5" />
          </div>
        </DialogContent>
      </Dialog>
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
 * D-PROD-201 — de onde vem o peso do consumo por %PV e o aviso de cabeças sem
 * peso (elas não entram na média; antes entravam como 0 kg).
 * D-PROD-210: na base g/cab/dia a meta não usa peso — o aviso de falta de peso não aparece.
 * @param {{ resumo: ReturnType<typeof resumoPesoDosLotes>, totalCabecas: number, baseEmGramas?: boolean }} props
 */
function AvisoPesoDoRebanho({ resumo, totalCabecas, baseEmGramas = false }) {
  if (!(totalCabecas > 0) || baseEmGramas) return null;
  const linhas = [];
  if (resumo.cabecasComPeso > 0) {
    linhas.push(
      <div key="origem" className="text-[10px] text-slate-500" data-testid="suplementacao-peso-origem">
        Peso para o consumo: {resumo.cabecasProjetado === resumo.cabecasComPeso ? "peso projetado de hoje" : resumo.cabecasProjetado > 0 ? "peso projetado de hoje (ou o último peso, sem projeção)" : "último peso (pesagem ou entrada)"}.
      </div>,
    );
  }
  if (resumo.cabecasSemPeso > 0) {
    linhas.push(
      <div key="sem-peso" className="text-[10px] text-amber-700" data-testid="suplementacao-sem-peso">
        {resumo.cabecasComPeso > 0
          ? `${formatDecimal(resumo.cabecasSemPeso, 0, true)} cabeça(s) sem peso (${resumo.lotesSemPeso.map((l) => l.nome).filter(Boolean).join(", ") || "lote sem nome"}): o consumo esperado usa o peso médio dos lotes com peso.`
          : "Nenhum lote do pasto tem peso: o consumo esperado por %PV não é calculado. Registre uma pesagem."}
      </div>,
    );
  }
  return linhas.length ? <div className="pt-1 border-t border-emerald-200 space-y-0.5">{linhas}</div> : null;
}
