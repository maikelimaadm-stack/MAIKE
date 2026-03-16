import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { normalizeText, obterSaldoProdutoLocal, parseNumber, registrarSaidaSuplementacao } from "./estoqueSuplementacaoUtils";
import { formatDecimal } from "./formatters";
import { calcularDiasPeriodo } from "../utils/consumoUtils";
import { safeDivide } from "../utils/pecuariaUtils";
import { evaluateConsumoFaixa, getSupplementRule } from "./suplementacaoRules";
import { quantidadeParaKg, produtoSuportaSacos, formatQuantidadeComUnidade, kgParaSacos } from "./unidadeConversaoUtils";
import { consumoEsperadoPorCabecaDia, consumoEsperadoGrupoDia, pesoMedioPonderadoLotes, avaliarConsumoPV } from "./consumoPVUtils";

export default function FormularioLancamentoSuplementacao({ ponto, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const getTodayLocalYMD = () => {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, "0");
    const dia = String(hoje.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  };
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
  const [formData, setFormData] = useState({
    data_lancamento: getTodayLocalYMD(),
    produto: ponto?.produto_padrao || "",
    quantidade_total_kg: "",
    sobra_kg: "0",
    unidade_lancamento: "KG",
    quantidade_sacos: "",
    observacoes: "",
  });

  const { data: user } = useQuery({ queryKey: ["user-suplementacao-form"], queryFn: () => base44.auth.me() });

  const areaIdsVinculados = useMemo(() => {
    const ids = Array.isArray(ponto?.area_vinculada_ids) ? ponto.area_vinculada_ids.filter(Boolean) : [];
    return ids.length ? ids : (ponto?.area_vinculada_id ? [ponto.area_vinculada_id] : []);
  }, [ponto]);

  const areaNomesVinculados = useMemo(() => {
    const nomes = Array.isArray(ponto?.area_vinculada_nomes) ? ponto.area_vinculada_nomes.filter(Boolean) : [];
    return nomes.length ? nomes : (ponto?.area_vinculada_nome ? [ponto.area_vinculada_nome] : []);
  }, [ponto]);

  const { data: lotes = [], isLoading: loadingLotes } = useQuery({
    queryKey: ["lotes-area", areaIdsVinculados.join("|")],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && areaIdsVinculados.includes(lote.area_atual_id) && lote.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId && areaIdsVinculados.length > 0,
  });

  const fatores = [];

  const { data: ultimoEvento } = useQuery({
    queryKey: ["ultimo-evento-ponto", empresaSelecionadaId, ponto?.id],
    queryFn: async () => {
      const eventos = await base44.entities.SuplementacaoEvento.filter({
        empresa_id: empresaSelecionadaId,
        ponto_suplementacao_id: ponto?.id,
      }, "-data_lancamento", 1);
      return eventos[0] || null;
    },
    enabled: !!empresaSelecionadaId && !!ponto?.id,
  });

  const { data: produtosSuplementacao = [] } = useQuery({
    queryKey: ["produtos-suplementacao-lancamento", empresaSelecionadaId, ponto?.produto_padrao],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((produto) => {
        const categoriaSuplementacao = normalizeText(produto.categoria).includes("SUPLEMENTAC");
        const produtoMarcadoNoPonto = ponto?.produto_padrao && normalizeText(produto.nome_produto) === normalizeText(ponto.produto_padrao);
        return produto.empresa_id === empresaSelecionadaId && (categoriaSuplementacao || produtoMarcadoNoPonto);
      });
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: depositoVinculado = null } = useQuery({
    queryKey: ["deposito-vinculado-cocho", ponto?.deposito_origem_id, ponto?.deposito_origem_nome],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.find((item) => item.id === ponto?.deposito_origem_id)
        || all.find((item) => normalizeText(item.nome_ponto) === normalizeText(ponto?.deposito_origem_nome) && normalizeText(item.categoria_ponto) === "DEPOSITO")
        || null;
    },
    enabled: !!ponto,
  });

  const { data: lotesNota = [] } = useQuery({
    queryKey: ["lotes-nota-suplementacao", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.EstoqueLoteNota.list();
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && lote.status === "Disponivel");
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: eventosRecentes = [] } = useQuery({
    queryKey: ["eventos-recentes-ponto", empresaSelecionadaId, ponto?.id],
    queryFn: async () => {
      return await base44.entities.SuplementacaoEvento.filter({
        empresa_id: empresaSelecionadaId,
        ponto_suplementacao_id: ponto?.id,
      }, "-data_lancamento", 12);
    },
    enabled: !!empresaSelecionadaId && !!ponto?.id,
  });

  // === CÁLCULOS ===
  const totalCabecas = lotes.reduce((total, lote) => total + (lote.quantidade_cabecas || 0), 0);
  const pesoMedioGeral = pesoMedioPonderadoLotes(lotes);
  const diasPeriodo = ultimoEvento ? calcularDiasPeriodo(ultimoEvento.data_lancamento, formData.data_lancamento) : null;

  const produtoSelecionado = useMemo(() => {
    return produtosSuplementacao.find((produto) => normalizeText(produto.nome_produto) === normalizeText(formData.produto)) || null;
  }, [produtosSuplementacao, formData.produto]);

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

  // Fator legado (compatibilidade)
  const getFatorLote = (lote) => {
    const match = fatores.find((item) =>
      normalizeText(item.categoria) === normalizeText(lote.categoria) ||
      normalizeText(item.categoria) === normalizeText(lote.categoria_manejo_nome) ||
      normalizeText(item.categoria) === normalizeText(lote.categoria_manejo_id)
    );
    return match?.fator || 1;
  };

  const lotesSemFator = lotes.filter((lote) => !fatores.some((item) =>
    normalizeText(item.categoria) === normalizeText(lote.categoria) ||
    normalizeText(item.categoria) === normalizeText(lote.categoria_manejo_nome) ||
    normalizeText(item.categoria) === normalizeText(lote.categoria_manejo_id)
  ));

  const pesoTotalConsumo = lotes.reduce((total, lote) => {
    const fator = getFatorLote(lote);
    return total + ((lote.quantidade_cabecas || 0) * fator);
  }, 0);

  // %PV consumo esperado
  const pctPV = Number(produtoSelecionado?.percentual_consumo_pv || 0);
  const consumoEsperadoCabDiaPV = pctPV > 0 && pesoMedioGeral > 0
    ? consumoEsperadoPorCabecaDia(pesoMedioGeral, pctPV)
    : 0;
  const consumoEsperadoGrupoDiaPV = consumoEsperadoCabDiaPV * totalCabecas;

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

  const regraProduto = getSupplementRule(formData.produto);
  const avaliacaoPV = pctPV > 0 && pesoMedioGeral > 0
    ? avaliarConsumoPV(consumoEstimadoCabDia, pesoMedioGeral, produtoSelecionado)
    : null;
  const avaliacaoFallback = evaluateConsumoFaixa(consumoEstimadoCabDia, formData.produto, {
    min: ponto?.limite_minimo_consumo || undefined,
    idealMin: ponto?.consumo_ideal_por_cabeca_kg || undefined,
    idealMax: ponto?.limite_maximo_consumo || undefined,
  });
  const avaliacaoTecnica = avaliacaoPV || avaliacaoFallback;

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

  // Produtos disponíveis - filtrar apenas os que têm saldo no depósito vinculado
  const produtosDisponiveis = useMemo(() => {
    if (!depositoVinculado?.local_estoque_id) return produtosSuplementacao;
    // Only show products that have saldo in the linked deposit
    return produtosSuplementacao
      .filter((p) => {
        const saldo = obterSaldoProdutoLocal(lotesNota, p.id, depositoVinculado.local_estoque_id);
        const ehProdutoPadrao = normalizeText(p.nome_produto) === normalizeText(ponto?.produto_padrao || "");
        return saldo > 0 || ehProdutoPadrao;
      })
      .sort((a, b) => {
        const saldoA = obterSaldoProdutoLocal(lotesNota, a.id, depositoVinculado.local_estoque_id);
        const saldoB = obterSaldoProdutoLocal(lotesNota, b.id, depositoVinculado.local_estoque_id);
        if (saldoA > 0 && saldoB <= 0) return -1;
        if (saldoB > 0 && saldoA <= 0) return 1;
        return a.nome_produto.localeCompare(b.nome_produto);
      });
  }, [depositoVinculado, produtosSuplementacao, lotesNota, ponto]);

  const saldoNoDeposito = useMemo(() => {
    if (!depositoVinculado?.local_estoque_id || !produtoSelecionado) return 0;
    return obterSaldoProdutoLocal(lotesNota, produtoSelecionado.id, depositoVinculado.local_estoque_id);
  }, [depositoVinculado, produtoSelecionado, lotesNota]);

  // Auto-selecionar produto único
  useEffect(() => {
    if (!formData.produto && produtosDisponiveis.length === 1) {
      setFormData((prev) => ({ ...prev, produto: produtosDisponiveis[0].nome_produto }));
    }
  }, [formData.produto, produtosDisponiveis]);

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

    if (!formData.produto) return toast.error("Selecione um produto.");
    if (quantidadeKg <= 0) return toast.error("Informe a quantidade fornecida.");
    if (sobraInformada < 0) return toast.error("A sobra informada não pode ser negativa.");
    if (totalCabecas <= 0) return toast.error("Não há cabeças ativas nas áreas vinculadas.");
    if (depositoVinculado?.local_estoque_id && !produtoSelecionado) return toast.error("O produto selecionado não foi encontrado no cadastro.");
    if (depositoVinculado?.local_estoque_id && quantidadeKg > saldoNoDeposito) return toast.error("Saldo insuficiente no depósito vinculado.");

    if (ultimoEvento) {
      const saldoFisicoMaximo = (ultimoEvento.quantidade_total_kg || 0) + (ultimoEvento.sobra_kg || 0);
      if (sobraInformada > saldoFisicoMaximo) {
        return toast.error("A sobra informada é maior que o total fisicamente disponível no período anterior.");
      }
    }

    if (["critico_baixo", "critico_alto"].includes(avaliacaoTecnica.status)) {
      const confirmarCritico = window.confirm(`${avaliacaoTecnica.message}\n\nDeseja salvar mesmo assim?`);
      if (!confirmarCritico) return;
    }

    if (statusDuracao.status === "baixo" || statusDuracao.status === "alto") {
      const confirmarDuracao = window.confirm(`${statusDuracao.message}\n\nDeseja salvar mesmo assim?`);
      if (!confirmarDuracao) return;
    }

    if (["abaixo_ideal", "acima_ideal"].includes(avaliacaoTecnica.status)) {
      const confirmar = window.confirm(`${avaliacaoTecnica.message}\n\nDeseja salvar mesmo assim?`);
      if (!confirmar) return;
    }

    try {
      const totalPassos = (ultimoEvento ? 1 : 0) + (depositoVinculado?.local_estoque_id ? 1 : 0) + 1 + lotes.length;
      let passoAtual = 0;
      setProgresso({ show: true, atual: 0, total: totalPassos, mensagem: "Iniciando lançamento..." });

      if (ultimoEvento && diasPeriodo > 0) {
        setProgresso({ show: true, atual: ++passoAtual, total: totalPassos, mensagem: "Fechando período anterior..." });
        const { fecharPeriodoSupplementacao } = await import("../utils/consumoUtils");
        await fecharPeriodoSupplementacao({
          evento: ultimoEvento,
          diasPeriodo,
          sobraInicial: ultimoEvento.sobra_kg || 0,
          sobraFinal: parseNumber(formData.sobra_kg || 0),
        });
      }

      let movimentoEstoque = null;
      if (depositoVinculado?.local_estoque_id && produtoSelecionado) {
        setProgresso({ show: true, atual: ++passoAtual, total: totalPassos, mensagem: "Baixando saldo do depósito..." });
        const saidaRegistrada = await registrarSaidaSuplementacao({
          empresaId: empresaSelecionadaId,
          userEmail: user?.email,
          produto: produtoSelecionado,
          quantidade: quantidadeKg,
          localOrigemId: depositoVinculado.local_estoque_id,
          localOrigemNome: depositoVinculado.local_estoque_nome,
          areaId: areaIdsVinculados[0] || ponto.area_vinculada_id,
          areaNome: areaNomesVinculados.join(", ") || ponto.area_vinculada_nome,
          observacoes: `Saída automática para o cocho ${ponto.nome_ponto}${formData.observacoes ? ` - ${formData.observacoes}` : ""}`,
          lotesNota,
          depositoId: depositoVinculado.id,
          pontoSuplementacaoId: ponto.id,
        });
        movimentoEstoque = saidaRegistrada.movimentacao;
      }

      setProgresso({ show: true, atual: ++passoAtual, total: totalPassos, mensagem: "Criando evento de suplementação..." });
      const sacosLancamento = formData.unidade_lancamento === "SACO" ? parseNumber(formData.quantidade_sacos || 0) : null;
      
      const novoEvento = await base44.entities.SuplementacaoEvento.create({
        empresa_id: empresaSelecionadaId,
        ponto_suplementacao_id: ponto.id,
        ponto_nome: ponto.nome_ponto,
        area_id: areaIdsVinculados[0] || ponto.area_vinculada_id,
        area_nome: areaNomesVinculados.join(", ") || ponto.area_vinculada_nome,
        area_ids: areaIdsVinculados,
        area_nomes: areaNomesVinculados,
        data_lancamento: formData.data_lancamento,
        produto: formData.produto,
        produto_id: produtoSelecionado?.id || null,
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
        peso_total_consumo: pesoTotalConsumo,
        consumo_esperado_pv_kg: consumoEsperadoGrupoDiaPV > 0 ? consumoEsperadoGrupoDiaPV : null,
        percentual_consumo_pv_usado: pctPV > 0 ? pctPV : null,
        movimentacao_estoque_id: movimentoEstoque?.id || null,
        observacoes: formData.observacoes || null,
      });

      for (let index = 0; index < lotes.length; index++) {
        const lote = lotes[index];
        const fator = getFatorLote(lote);
        const pesoMedioLote = Number(lote.peso_medio_kg || 0);
        const consumoEsperadoLotePV = pctPV > 0 && pesoMedioLote > 0
          ? consumoEsperadoPorCabecaDia(pesoMedioLote, pctPV) * (lote.quantidade_cabecas || 0)
          : null;

        setProgresso({ show: true, atual: ++passoAtual, total: totalPassos, mensagem: `Registrando lote ${index + 1}/${lotes.length}...` });
        await base44.entities.SuplementacaoLote.create({
          empresa_id: empresaSelecionadaId,
          suplementacao_evento_id: novoEvento.id,
          lote_id: lote.id,
          lote_nome: lote.nome,
          categoria: lote.categoria,
          fator_consumo: fator,
          peso_medio_lote_kg: pesoMedioLote || null,
          consumo_esperado_pv_lote_kg: consumoEsperadoLotePV,
          data_lancamento: formData.data_lancamento,
          produto: formData.produto,
          cabecas_na_area: lote.quantidade_cabecas,
          peso_consumo_lote: (lote.quantidade_cabecas || 0) * fator,
          dias_periodo: null,
          consumo_unitario_dia: null,
          consumo_por_cabeca_dia_kg: null,
          consumo_total_lote_periodo_kg: null,
        });
      }

      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["eventos-ponto", "ultimo-evento-ponto", "eventos-recentes-ponto", "lotes-nota-suplementacao", "mapa-eventos-supl", "movimentacoes", "produtos"].includes(query.queryKey[0]) });
      setProgresso({ show: true, atual: totalPassos, total: totalPassos, mensagem: "Concluído!" });
      toast.success("Suplementação registrada com sucesso.");
      setTimeout(() => {
        setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
        onCancel();
      }, 400);
    } catch (error) {
      setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
      toast.error(error.message || "Erro ao registrar suplementação.");
    }
  };

  const botaoHabilitado = totalCabecas > 0 && formData.produto && quantidadeKg > 0;

  return (
    <>
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-emerald-50 border-b border-emerald-200 py-2 px-3"><CardTitle className="text-sm font-bold text-emerald-900">Lançar Suplementação - {ponto?.nome_ponto}</CardTitle></CardHeader>
        <CardContent className="p-2 max-h-[calc(100vh-200px)] overflow-y-auto overflow-x-hidden">
          <div className="space-y-1">
            {/* Resumo do ponto */}
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2 text-[11px] space-y-1">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Áreas: <span className="font-semibold text-slate-900">{areaNomesVinculados.join(", ") || ponto?.area_vinculada_nome || "-"}</span></div>
                <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Depósito: <span className="font-semibold text-slate-900">{depositoVinculado?.nome_ponto || "Não vinculado"}</span></div>
                <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Lotes: <span className="font-semibold text-slate-900">{loadingLotes ? "..." : `${formatDecimal(lotes.length, 0, true)} lote(s) - ${formatDecimal(totalCabecas, 0, true)} cabeças`}</span></div>
                <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Peso médio: <span className="font-semibold text-slate-900">{pesoMedioGeral > 0 ? `${formatDecimal(pesoMedioGeral, 1)} kg` : "-"}</span></div>
              </div>
              {ultimoEvento && diasPeriodo && <div className="text-[10px] text-slate-600 pt-1 border-t border-emerald-200">Último lançamento: {formatDateBR(ultimoEvento.data_lancamento)} • Período: {formatDecimal(diasPeriodo, 0, true)} dia(s)</div>}
            </div>

            {!depositoVinculado?.local_estoque_id && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">Este cocho ainda não tem depósito vinculado. O lançamento será salvo sem baixa automática de estoque.</div>}

            {/* Formulário principal */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Data do lançamento *</Label>
                <Input type="date" value={formData.data_lancamento} onChange={(e) => setFormData((prev) => ({ ...prev, data_lancamento: e.target.value }))} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Produto *</Label>
                <Select value={formData.produto} onValueChange={(value) => setFormData((prev) => ({ ...prev, produto: value }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione o produto" /></SelectTrigger>
                  <SelectContent>
                    {produtosDisponiveis.map((produto) => (
                      <SelectItem key={produto.id} value={produto.nome_produto} className="text-xs">
                        {produto.nome_produto}
                        {produto.percentual_consumo_pv ? ` (${produto.percentual_consumo_pv}% PV)` : ""}
                        {produto.unidade_principal_estoque === "SACO" ? ` • Saco ${produto.peso_por_saco_kg}kg` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Campos de quantidade com suporte a sacos */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
              {suportaSacos && (
                <div className="space-y-1">
                  <Label className="text-xs">Unidade de lançamento</Label>
                  <Select value={formData.unidade_lancamento} onValueChange={(value) => setFormData((prev) => ({ ...prev, unidade_lancamento: value }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KG" className="text-xs">Quilogramas (KG)</SelectItem>
                      <SelectItem value="SACO" className="text-xs">Sacos ({pesoPorSaco} kg/saco)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formData.unidade_lancamento === "SACO" && suportaSacos ? (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Quantidade de sacos *</Label>
                    <Input type="text" inputMode="decimal" value={formData.quantidade_sacos} onChange={(e) => handleQuantidadeSacosChange(e.target.value)} className="h-8 text-xs" placeholder="0" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Equivalente em kg</Label>
                    <div className="h-8 flex items-center px-3 bg-slate-100 rounded-md text-xs font-semibold text-slate-700 border">{formatDecimal(quantidadeKg)} kg</div>
                  </div>
                </>
              ) : (
                <div className={`space-y-1 ${suportaSacos ? "" : "lg:col-span-2"}`}>
                  <Label className="text-xs">Quantidade total fornecida (kg) *</Label>
                  <Input type="text" inputMode="decimal" value={formData.quantidade_total_kg} onChange={(e) => handleQuantidadeKgChange(e.target.value)} className="h-8 text-xs" placeholder="0,00" />
                  {suportaSacos && pesoPorSaco > 0 && quantidadeKg > 0 && (
                    <div className="text-[10px] text-slate-500">≈ {formatDecimal(kgParaSacos(quantidadeKg, pesoPorSaco), 1)} saco(s)</div>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Sobra no cocho (kg)</Label>
                <Input type="text" inputMode="decimal" value={formData.sobra_kg} onChange={(e) => setFormData((prev) => ({ ...prev, sobra_kg: e.target.value }))} className="h-8 text-xs" placeholder="0,00" />
              </div>
            </div>

            {/* Saldo depósito */}
            {depositoVinculado?.local_estoque_id && produtoSelecionado && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-500">Saldo disponível no depósito</div>
                  <div className="text-sm font-semibold text-slate-900">
                    {formatDecimal(saldoNoDeposito)} {produtoSelecionado.unidade_medida || "KG"}
                    {suportaSacos && pesoPorSaco > 0 && <span className="text-xs text-slate-500 ml-2">({formatDecimal(kgParaSacos(saldoNoDeposito, pesoPorSaco), 1)} sacos)</span>}
                  </div>
                </div>
                <Badge variant="outline" className="text-xs">Baixa automática ativa</Badge>
              </div>
            )}
            {depositoVinculado?.local_estoque_id && formData.produto && produtoSelecionado && saldoNoDeposito <= 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                O produto foi localizado, mas não possui saldo disponível neste depósito/local de estoque.
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
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] space-y-2">
                  <div className="text-xs font-semibold text-slate-900">Consumo do fechamento / estimativa</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Fornecido</div><div className="font-bold text-slate-900">{formatDecimal(fornecidoAnterior)} kg</div></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Consumido</div><div className="font-bold text-slate-900">{formatDecimal(consumidoAnterior)} kg</div></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Consumo/dia</div><div className="font-bold text-slate-900">{formatDecimal(consumoDiarioAnterior)} kg</div></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Consumo/cab/dia</div><div className="font-bold text-slate-900">{formatDecimal(consumoPorCabAnterior, 3)} kg</div></div>
                  </div>
                  <div className="text-[10px] text-slate-600">Período analisado: {formatDecimal(diasAnterior, 0, true)} dia(s) • Cabeças: {formatDecimal(ultimoEvento.total_cabecas_afetadas || 0, 0, true)}</div>
                </div>
              );
            })()}

            {/* Painel %PV - quando disponível */}
            {pctPV > 0 && pesoMedioGeral > 0 && totalCabecas > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] space-y-2">
                <div className="text-xs font-semibold text-slate-900">Consumo esperado por %PV do produto</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">%PV</div><div className="font-bold text-slate-900">{formatDecimal(pctPV, 3)}%</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Peso médio</div><div className="font-bold text-slate-900">{formatDecimal(pesoMedioGeral, 1)} kg</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Esperado/cab/dia</div><div className="font-bold text-slate-900">{formatDecimal(consumoEsperadoCabDiaPV, 3)} kg</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Esperado grupo/dia</div><div className="font-bold text-slate-900">{formatDecimal(consumoEsperadoGrupoDiaPV, 1)} kg</div></div>
                </div>
              </div>
            )}

            {/* Validação técnica */}
            {quantidadeKg > 0 && totalCabecas > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs font-semibold text-slate-900">Validação técnica do novo lançamento</div>
                  <Badge variant="outline" className="text-xs">{statusDuracao.label}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Freq. média</div><div className="font-bold text-slate-900">{frequenciaMedia > 0 ? `${formatDecimal(frequenciaMedia, 0, true)} dia(s)` : '-'}</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Duração estimada</div><div className="font-bold text-slate-900">{duracaoDiasInteira > 0 ? `${formatDecimal(duracaoDiasInteira, 0, true)} dia(s)` : '-'}</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1 col-span-2"><div className="text-slate-500">Próxima suplementação</div><div className="font-bold text-slate-900">{dataEstimadaProxima ? dataEstimadaProxima.toLocaleDateString('pt-BR') : '-'}</div></div>
                </div>
                <div className="text-[10px] text-slate-600">
                  {statusDuracao.message}
                  {avaliacaoTecnica?.message ? ` • ${avaliacaoTecnica.message}` : ""}
                  {avaliacaoPV && consumoEsperadoCabDiaPV > 0 ? ` • Esperado (%PV): ${formatDecimal(consumoEsperadoCabDiaPV, 3)} kg/cab/dia` : ""}
                  {!avaliacaoPV && regraProduto?.label ? ` • Regra: ${regraProduto.label}` : ""}
                </div>
              </div>
            )}

            {/* Consumo por lote */}
            {quantidadeKg > 0 && totalCabecas > 0 && lotes.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-900">Consumo por Lote (novo lançamento)</div>
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setMostrarConsumoLote((prev) => !prev)}>
                    {mostrarConsumoLote ? "Ocultar" : "Ver"}
                  </Button>
                </div>
                {mostrarConsumoLote && (
                  <div className="space-y-1">
                    {lotes.map((lote) => {
                      const fator = getFatorLote(lote);
                      const pesoConsumoLote = (lote.quantidade_cabecas || 0) * fator;
                      const percentualConsumo = pesoTotalConsumo > 0 ? (pesoConsumoLote / pesoTotalConsumo) * 100 : 0;
                      const pesoMedioLote = Number(lote.peso_medio_kg || 0);
                      const quantidadeLoteKg = totalDisponivelNovo * (percentualConsumo / 100);
                      const consumoPlanejadoLoteCabDia = lote.quantidade_cabecas > 0 && frequenciaMedia > 0 ? safeDivide(quantidadeLoteKg, lote.quantidade_cabecas * frequenciaMedia) : 0;
                      const avaliacaoLotePV = pctPV > 0 && pesoMedioLote > 0 ? avaliarConsumoPV(consumoPlanejadoLoteCabDia, pesoMedioLote, produtoSelecionado) : null;
                      const avaliacaoLoteFallback = evaluateConsumoFaixa(consumoPlanejadoLoteCabDia, formData.produto, {
                        min: ponto?.limite_minimo_consumo || undefined,
                        idealMin: ponto?.consumo_ideal_por_cabeca_kg || undefined,
                        idealMax: ponto?.limite_maximo_consumo || undefined,
                      });
                      const avaliacaoLote = avaliacaoLotePV || avaliacaoLoteFallback;
                      return (
                        <div key={lote.id} className="rounded-lg border border-slate-200 bg-white p-2 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold text-xs text-slate-900">{lote.nome}</div>
                            <Badge variant="outline" className="text-[10px]">{avaliacaoLote?.status === 'dentro_ideal' ? 'Dentro do ideal' : 'Validar'}</Badge>
                          </div>
                          <div className="text-[10px] text-slate-600">Área: {lote.area_atual_nome || areaNomesVinculados.join(', ') || ponto.area_vinculada_nome || '-'}</div>
                          <div className="grid grid-cols-3 gap-1 text-[10px]">
                            <div><div className="text-slate-500">Cabeças</div><div className="font-bold text-slate-900">{formatDecimal(lote.quantidade_cabecas || 0, 0, true)}</div></div>
                            <div><div className="text-slate-500">Peso médio</div><div className="font-bold text-slate-900">{pesoMedioLote > 0 ? `${formatDecimal(pesoMedioLote, 0)} kg` : '-'}</div></div>
                            <div><div className="text-slate-500">% Consumo</div><div className="font-bold text-slate-900">{formatDecimal(percentualConsumo, 1)}%</div></div>
                          </div>
                          <div className="text-[10px] text-slate-600">Validação técnica do novo lançamento: {avaliacaoLote?.message || 'Sem referência técnica.'}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Observações</Label>
              <Textarea value={formData.observacoes} onChange={(e) => setFormData((prev) => ({ ...prev, observacoes: e.target.value }))} className="text-xs" rows={3} />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">Cancelar</Button>
              <Button type="button" onClick={handleSalvar} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={!botaoHabilitado || progresso.show}>{progresso.show ? "Registrando..." : "Salvar"}</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={progresso.show} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="text-sm">Salvando...</DialogTitle></DialogHeader><div className="space-y-2"><p className="text-xs text-slate-600">{progresso.mensagem}</p><Progress value={progresso.total ? (progresso.atual / progresso.total) * 100 : 0} className="w-full h-1.5" /></div></DialogContent>
      </Dialog>
    </>
  );
}