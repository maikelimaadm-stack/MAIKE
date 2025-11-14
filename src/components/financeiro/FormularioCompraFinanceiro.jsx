
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Save, X, Plus, Trash2, MoreVertical, DollarSign } from "lucide-react";
import { toast } from "sonner";
import DialogCadastroRapido from "./DialogCadastroRapido.jsx";
import ComboboxFornecedor from "./ComboboxFornecedor.jsx";
import AutocompleteGenerico from "./AutocompleteGenerico.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const FORMAS_PAGAMENTO_PADRAO = [
  'Dinheiro', 'PIX', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto Bancário',
  'Transferência Bancária', 'Cheque', 'Crédito Loja', 'Vale Alimentação',
  'Vale Refeição', 'Depósito Bancário', 'Outros'
];

const formatarNumero = (num) => {
  if (!num && num !== 0) return '';
  const numStr = String(num).replace('.', ',');
  const [inteiro, decimal] = numStr.split(',');
  const inteiroFormatado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimal !== undefined ? `${inteiroFormatado},${decimal}` : inteiroFormatado;
};

const parseNumero = (str) => {
  if (!str) return 0;
  const cleanedStr = String(str).replace(/[R$ ]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(cleanedStr) || 0;
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const parseMoeda = (str) => {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
};

const calcularDataProximaMes = (dataBase) => {
  if (!dataBase) return new Date().toISOString().split('T')[0];
  try {
    const data = new Date(dataBase + "T00:00:00");
    if (isNaN(data.getTime())) return new Date().toISOString().split('T')[0];
    data.setMonth(data.getMonth() + 1);
    return data.toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
};

export default function FormularioCompraFinanceiro({ onSubmit, onCancel, initialData, fornecedores, produtos, safras, centrosCusto, planosContas, gruposFinanceiros, tipoLancamento }) {
  const [etapa, setEtapa] = useState(1);
  const [mostrarCamposNFe, setMostrarCamposNFe] = useState(false);
  const [formData, setFormData] = useState(() => {
    const defaults = {
      tipo: tipoLancamento || "Pagar",
      tipo_documento: "NF-e",
      fornecedor_id: "",
      data_emissao: new Date().toISOString().split('T')[0],
      data_vencimento: new Date().toISOString().split('T')[0],
      numero_documento: "",
      chave_nfe: "",
      serie_documento: "",
      numero_boleto: "",
      banco_boleto: "",
      cfop: "",
      safra_id: "",
      centro_custo_id: "",
      plano_contas_id: "",
      grupo_id: "",
      forma_pagamento_id: "",
      lancar_produtos: true,
      dar_entrada_estoque: true,
      valor_original: "",
      valor_juros: "0,00",
      valor_multa: "0,00",
      valor_desconto: "0,00",
      conta_paga: false,
      data_pagamento: "",
      valor_pago_total: "",
      forma_pagamento_paga_id: "",
      parcelar: false,
      parcelas: [],
      produtos_selecionados: [],
      observacoes: "",
      observacoes_nfe: "",
      frete: "0,00",
      outras_despesas: "0,00",
      local_estoque: "",
      anexos: [],
      valor_produtos: "",
      valor_frete: "",
      valor_seguro: "",
      valor_outras_despesas: "",
      valor_desconto_total: "",
      valor_ipi: "",
      valor_icms: "",
      valor_pis: "",
      valor_cofins: "",
      base_calculo_icms: "",
      conta_bancaria_id: "",
      conta_bancaria_nome: ""
    };

    if (!initialData) return defaults;

    const temDadosNFeInicial = initialData.valor_produtos || initialData.valor_frete || initialData.valor_seguro || initialData.valor_outras_despesas || initialData.valor_desconto_total || initialData.valor_ipi || initialData.valor_icms || initialData.valor_pis || initialData.valor_cofins || initialData.base_calculo_icms || initialData.observacoes_nfe;
    if (temDadosNFeInicial) {
      setTimeout(() => setMostrarCamposNFe(true), 100);
    }

    let produtosIniciais = [];
    if (initialData.produtos_lancamento && Array.isArray(initialData.produtos_lancamento)) {
      produtosIniciais = initialData.produtos_lancamento.map(pl => ({
        produto_id: pl.produto_id,
        produto_nome: pl.produto_nome,
        quantidade: pl.quantidade || 0,
        valor_total: pl.valor_total || 0,
        desconto_item: pl.desconto_item || 0,
        unidade: pl.unidade
      }));
    } else if (initialData.produtos_selecionados && Array.isArray(initialData.produtos_selecionados)) {
      produtosIniciais = initialData.produtos_selecionados;
    }

    return {
      ...defaults,
      ...initialData,
      lancar_produtos: initialData.lancar_produtos !== false,
      dar_entrada_estoque: initialData.dar_entrada_estoque !== false,
      conta_paga: initialData.conta_paga || false,
      parcelar: initialData.parcelar || false,
      valor_original: initialData.valor_original ? formatarNumero(initialData.valor_original) : "",
      valor_juros: initialData.valor_juros ? formatarNumero(initialData.valor_juros) : defaults.valor_juros,
      valor_multa: initialData.valor_multa ? formatarNumero(initialData.valor_multa) : defaults.valor_multa,
      valor_desconto: initialData.valor_desconto ? formatarNumero(initialData.valor_desconto) : defaults.valor_desconto,
      frete: initialData.valor_frete ? formatarNumero(initialData.valor_frete) : (initialData.frete ? formatarNumero(initialData.frete) : defaults.frete),
      outras_despesas: initialData.valor_outras_despesas ? formatarNumero(initialData.valor_outras_despesas) : (initialData.outras_despesas ? formatarNumero(initialData.outras_despesas) : defaults.outras_despesas),
      valor_pago_total: initialData.valor_pago_total ? formatarNumero(initialData.valor_pago_total) : "",
      valor_produtos: initialData.valor_produtos ? formatarNumero(initialData.valor_produtos) : "",
      valor_frete: initialData.valor_frete ? formatarNumero(initialData.valor_frete) : "",
      valor_seguro: initialData.valor_seguro ? formatarNumero(initialData.valor_seguro) : "",
      valor_outras_despesas: initialData.valor_outras_despesas ? formatarNumero(initialData.valor_outras_despesas) : "",
      valor_desconto_total: initialData.valor_desconto_total ? formatarNumero(initialData.valor_desconto_total) : "",
      valor_ipi: initialData.valor_ipi ? formatarNumero(initialData.valor_ipi) : "",
      valor_icms: initialData.valor_icms ? formatarNumero(initialData.valor_icms) : "",
      valor_pis: initialData.valor_pis ? formatarNumero(initialData.valor_pis) : "",
      valor_cofins: initialData.valor_cofins ? formatarNumero(initialData.valor_cofins) : "",
      base_calculo_icms: initialData.base_calculo_icms ? formatarNumero(initialData.base_calculo_icms) : "",
      produtos_selecionados: produtosIniciais.map(p => ({
        ...p,
        quantidade: formatarNumero(p.quantidade),
        valor_total: formatarNumero(p.valor_total || 0),
        desconto_item: formatarNumero(p.desconto_item || 0)
      })),
      parcelas: initialData.parcelas?.map(p => ({
        data: p.data,
        valor: formatarNumero(p.valor || 0)
      })) || [],
      anexos: initialData.anexos || [],
      observacoes_nfe: initialData.observacoes_nfe || "",
      conta_bancaria_id: initialData.conta_bancaria_id || "",
      conta_bancaria_nome: initialData.conta_bancaria_nome || ""
    };
  });

  const [showDialogCentro, setShowDialogCentro] = useState(false);
  const [showDialogLocal, setShowDialogLocal] = useState(false);
  const [showDialogPlano, setShowDialogPlano] = useState(false);
  const [showDialogGrupo, setShowDialogGrupo] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: locais = [] } = useQuery({
    queryKey: ['locais_compra'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: [],
  });

  const { data: contasBancarias = [] } = useQuery({
    queryKey: ['contas_form', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ContaBancaria.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  useEffect(() => {
    if (formData.conta_paga && !formData.data_pagamento) {
      const valorTotal = calcularValorTotal();
      setFormData(prev => ({
        ...prev,
        data_pagamento: prev.data_emissao,
        valor_pago_total: formatarNumero(valorTotal)
      }));
    }
  }, [formData.conta_paga, formData.data_emissao]);

  useEffect(() => {
    if (formData.data_emissao && !formData.data_vencimento && !initialData) {
      setFormData(prev => ({ ...prev, data_vencimento: prev.data_emissao }));
    }
  }, [formData.data_emissao, initialData]);

  useEffect(() => {
    if (formData.parcelar && formData.parcelas.length === 0 && formData.data_vencimento) {
      const valorTotal = calcularValorTotal();
      const valorParcela = valorTotal > 0 ? valorTotal : 0;
      setFormData(prev => ({
        ...prev,
        parcelas: [{ data: prev.data_vencimento, valor: formatarNumero(valorParcela) }]
      }));
    }
  }, [formData.parcelar, formData.data_vencimento]);

  const calcularValorTotal = () => {
    if (formData.lancar_produtos) {
      const totalProdutosLiquido = formData.produtos_selecionados.reduce((sum, p) => {
        const total = parseNumero(p.valor_total || "0");
        const desc = parseNumero(p.desconto_item || "0");
        return sum + (total - desc);
      }, 0);

      const frete = parseNumero(formData.frete);
      const outras = parseNumero(formData.outras_despesas);
      const ipi = parseNumero(formData.valor_ipi || "0");

      return totalProdutosLiquido + frete + outras + ipi;
    } else {
      return parseNumero(formData.valor_original) + parseNumero(formData.valor_juros) + parseNumero(formData.valor_multa) - parseNumero(formData.valor_desconto);
    }
  };

  const adicionarParcela = () => {
    const ultimaParcela = formData.parcelas[formData.parcelas.length - 1];
    const valorTotal = calcularValorTotal();
    const newNumberOfParcelas = formData.parcelas.length + 1;
    const equalParcelValue = valorTotal / newNumberOfParcelas;

    const updatedParcelas = Array.from({ length: newNumberOfParcelas }, (_, i) => {
      const currentParcel = formData.parcelas[i];
      let date = currentParcel?.data;
      if (!date) {
        if (i === 0) {
          date = formData.data_vencimento;
        } else {
          date = calcularDataProximaMes(formData.parcelas[i - 1]?.data || formData.data_vencimento);
        }
      }
      return { data: date, valor: equalParcelValue.toFixed(2).replace('.', ',') };
    });

    setFormData(prev => ({ ...prev, parcelas: updatedParcelas }));
  };

  const removerParcela = (index) => {
    if (formData.parcelas.length <= 1) {
      toast.error('Mínimo de 1 parcela!');
      return;
    }
    const newParcelas = formData.parcelas.filter((_, i) => i !== index);
    const valorTotal = calcularValorTotal();
    const equalParcelValue = valorTotal / newParcelas.length;
    const updatedParcelas = newParcelas.map(p => ({ ...p, valor: equalParcelValue.toFixed(2).replace('.', ',') }));
    setFormData(prev => ({ ...prev, parcelas: updatedParcelas }));
  };

  const atualizarParcela = (index, campo, valor) => {
    setFormData(prev => ({
      ...prev,
      parcelas: prev.parcelas.map((p, i) => i === index ? { ...p, [campo]: valor } : p)
    }));
  };

  const handleChange = (field, value) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      if (field === 'parcelar' && value === true) {
        updated.conta_paga = false;
      }
      
      if (field === 'conta_paga' && value === true) {
        updated.parcelar = false;
      }
      
      return updated;
    });
  };

  const handleAdicionarProduto = () => {
    setFormData(prev => ({
      ...prev,
      produtos_selecionados: [...prev.produtos_selecionados, { produto_id: "", produto_nome: "", quantidade: "", valor_total: "", desconto_item: "0,00" }]
    }));
  };

  const handleRemoverProduto = (index) => {
    setFormData(prev => ({
      ...prev,
      produtos_selecionados: prev.produtos_selecionados.filter((_, i) => i !== index)
    }));
  };

  const handleAtualizarProduto = (index, campo, valor) => {
    setFormData(prev => ({
      ...prev,
      produtos_selecionados: prev.produtos_selecionados.map((p, i) => {
        if (i === index) {
          const updated = { ...p, [campo]: valor };

          if (campo === 'produto_id') {
            const produto = produtos.find(prod => prod.id === valor);
            if (produto) {
              updated.produto_nome = produto.nome_produto;
              updated.unidade = produto.unidade_medida;
              if (produto.preco_custo && updated.quantidade) {
                const qtd = parseNumero(updated.quantidade);
                updated.valor_total = (produto.preco_custo * qtd).toFixed(2).replace('.', ',');
              }
            }
          }
          return updated;
        }
        return p;
      })
    }));
  };

  const handleUploadAnexo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('Arquivo muito grande! Máximo 10MB');
      return;
    }

    setUploadingFile(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData(prev => ({
        ...prev,
        anexos: [...prev.anexos, { nome: file.name, url: file_url, tipo: file.type, tamanho: file.size }]
      }));
      toast.success('Arquivo anexado!');
    } catch (error) {
      toast.error('Erro ao fazer upload');
    } finally {
      e.target.value = '';
      setUploadingFile(false);
    }
  };

  const handleRemoverAnexo = (index) => {
    setFormData(prev => ({ ...prev, anexos: prev.anexos.filter((_, i) => i !== index) }));
    toast.success('Anexo removido!');
  };

  const handleProximaEtapa = () => {
    if (!formData.conta_bancaria_id) {
      toast.error('Selecione a conta bancária!');
      return;
    }
    if (!formData.fornecedor_id) {
      toast.error('Selecione o fornecedor!');
      return;
    }
    if (!formData.data_emissao) {
      toast.error('Preencha a data de emissão!');
      return;
    }
    if (formData.tipo_documento === 'Boleto') {
      if (!formData.numero_boleto) {
        toast.error('Preencha o número do boleto!');
        return;
      }
    } else {
      if (!formData.numero_documento) {
        toast.error('Preencha o número do documento!');
        return;
      }
    }

    if (formData.lancar_produtos) {
      if (formData.produtos_selecionados.length === 0) {
        toast.error('Adicione pelo menos 1 produto!');
        return;
      }
      const produtosIncompletos = formData.produtos_selecionados.filter(p =>
        !p.produto_id || parseNumero(p.quantidade) <= 0 || parseNumero(p.valor_total) <= 0
      );
      if (produtosIncompletos.length > 0) {
        toast.error('Preencha todos os campos dos produtos!');
        return;
      }
      if (formData.dar_entrada_estoque && !formData.local_estoque) {
        toast.error('Selecione o local de estoque!');
        return;
      }
    } else {
      if (parseNumero(formData.valor_original) <= 0) {
        toast.error('Preencha o valor original!');
        return;
      }
    }

    setEtapa(2);
  };

  const handleSubmitFinal = async (e) => {
    e.preventDefault();

    if (!formData.plano_contas_id) {
      toast.error('Selecione o plano de contas!');
      return;
    }
    if (!formData.grupo_id) {
      toast.error('Selecione o grupo financeiro!');
      return;
    }
    
    if (formData.parcelar) {
      if (!formData.forma_pagamento_id) {
        toast.error('Selecione a forma de pagamento!');
        return;
      }
      if (formData.parcelas.length < 1) {
        toast.error('Adicione pelo menos 1 parcela!');
        return;
      }
      const valorTotal = calcularValorTotal();
      const totalParcelas = formData.parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);
      if (Math.abs(totalParcelas - valorTotal) > 0.01) {
        toast.error('Total das parcelas diferente do valor total!');
        return;
      }
      if (formData.parcelas.some(p => parseNumero(p.valor) <= 0)) {
        toast.error('Todas as parcelas devem ter valor > 0!');
        return;
      }
    } else if (formData.conta_paga) {
      if (!formData.forma_pagamento_paga_id) {
        toast.error('Selecione a forma de pagamento!');
        return;
      }
      if (!formData.data_pagamento) {
        toast.error('Preencha a data de pagamento!');
        return;
      }
      if (parseNumero(formData.valor_pago_total) <= 0) {
        toast.error('Preencha o valor pago!');
        return;
      }
    } else {
      if (!formData.data_vencimento) {
        toast.error('Preencha a data de vencimento!');
        return;
      }
    }

    const fornecedor = fornecedores.find(f => f.id === formData.fornecedor_id);
    const safra = safras.find(s => s.id === formData.safra_id);
    const centro = centrosCusto.find(c => c.id === formData.centro_custo_id);
    const plano = planosContas.find(p => p.id === formData.plano_contas_id);
    const grupo = gruposFinanceiros.find(g => g.id === formData.grupo_id);
    const contaBancaria = contasBancarias.find(cb => cb.id === formData.conta_bancaria_id);

    const data = {
      tipo: formData.tipo,
      tipo_documento: formData.tipo_documento,
      fornecedor_id: formData.fornecedor_id,
      fornecedor_nome: fornecedor?.nome,
      safra_id: formData.safra_id || undefined,
      safra_nome: safra ? `${safra.ano_inicio}/${safra.ano_fim}` : undefined,
      centro_custo_id: formData.centro_custo_id || undefined,
      centro_custo_nome: centro?.nome,
      plano_contas_id: formData.plano_contas_id,
      plano_contas_nome: plano ? `${plano.codigo} - ${plano.descricao}` : undefined,
      grupo_id: formData.grupo_id,
      grupo_nome: grupo?.descricao,
      forma_pagamento_id: formData.parcelar ? formData.forma_pagamento_id : (formData.conta_paga ? formData.forma_pagamento_paga_id : undefined),
      forma_pagamento_nome: formData.parcelar ? formData.forma_pagamento_id : (formData.conta_paga ? formData.forma_pagamento_paga_id : undefined),
      numero_documento: formData.numero_documento?.toUpperCase() || undefined,
      chave_nfe: formData.tipo_documento === 'NF-e' ? formData.chave_nfe : undefined,
      serie_documento: ['NF-e', 'NFC-e'].includes(formData.tipo_documento) ? formData.serie_documento : undefined,
      numero_boleto: formData.tipo_documento === 'Boleto' ? formData.numero_boleto : undefined,
      banco_boleto: formData.tipo_documento === 'Boleto' ? formData.banco_boleto : undefined,
      cfop: formData.tipo_documento === 'NF-e' ? formData.cfop : undefined,
      data_emissao: formData.data_emissao,
      data_vencimento: formData.data_vencimento,
      observacoes: formData.observacoes?.toUpperCase() || undefined,
      observacoes_nfe: formData.observacoes_nfe || undefined,
      lancar_produtos: formData.lancar_produtos,
      dar_entrada_estoque: formData.lancar_produtos ? formData.dar_entrada_estoque : false,
      local_estoque: formData.lancar_produtos && formData.dar_entrada_estoque ? formData.local_estoque : undefined,
      conta_paga: formData.conta_paga,
      data_pagamento: formData.conta_paga ? formData.data_pagamento : undefined,
      valor_pago_total: formData.conta_paga ? parseNumero(formData.valor_pago_total) : undefined,
      forma_pagamento_paga_id: formData.conta_paga ? formData.forma_pagamento_paga_id : undefined,
      forma_pagamento_paga_nome: formData.conta_paga ? formData.forma_pagamento_paga_id : undefined,
      produtos_selecionados: formData.lancar_produtos ? formData.produtos_selecionados.map(p => {
        const qtd = parseNumero(p.quantidade);
        const totalGross = parseNumero(p.valor_total);
        const desconto = parseNumero(p.desconto_item || "0");
        const valorLiquido = totalGross - desconto;
        const valorUnitario = qtd > 0 ? (valorLiquido / qtd) : 0;
        return {
          produto_id: p.produto_id,
          produto_nome: p.produto_nome,
          quantidade: qtd,
          unidade: p.unidade,
          valor_unitario: valorUnitario,
          desconto_item: desconto,
          valor_total: totalGross
        };
      }) : [],
      valor_original: formData.lancar_produtos ? undefined : parseNumero(formData.valor_original),
      valor_juros: formData.lancar_produtos ? undefined : parseNumero(formData.valor_juros),
      valor_multa: formData.lancar_produtos ? undefined : parseNumero(formData.valor_multa),
      valor_desconto: formData.lancar_produtos ? undefined : parseNumero(formData.valor_desconto),
      valor_produtos: formData.valor_produtos ? parseNumero(formData.valor_produtos) : undefined,
      frete: formData.lancar_produtos ? parseNumero(formData.frete) : 0,
      valor_frete: formData.valor_frete ? parseNumero(formData.valor_frete) : parseNumero(formData.frete),
      valor_seguro: formData.valor_seguro ? parseNumero(formData.valor_seguro) : 0,
      valor_outras_despesas: formData.valor_outras_despesas ? parseNumero(formData.valor_outras_despesas) : parseNumero(formData.outras_despesas),
      outras_despesas: formData.lancar_produtos ? parseNumero(formData.outras_despesas) : 0,
      valor_desconto_total: formData.valor_desconto_total ? parseNumero(formData.valor_desconto_total) : 0,
      valor_ipi: formData.valor_ipi ? parseNumero(formData.valor_ipi) : 0,
      valor_icms: formData.valor_icms ? parseNumero(formData.valor_icms) : 0,
      valor_pis: formData.valor_pis ? parseNumero(formData.valor_pis) : 0,
      valor_cofins: formData.valor_cofins ? parseNumero(formData.valor_cofins) : 0,
      base_calculo_icms: formData.base_calculo_icms ? parseNumero(formData.base_calculo_icms) : 0,
      parcelar: !formData.conta_paga && formData.parcelar,
      parcelas: (!formData.conta_paga && formData.parcelar) ? formData.parcelas.map(p => ({ data: p.data, valor: parseNumero(p.valor) })) : undefined,
      anexos: formData.anexos,
      conta_bancaria_id: formData.conta_bancaria_id,
      conta_bancaria_nome: contaBancaria ? `${contaBancaria.banco} - ${contaBancaria.agencia}/${contaBancaria.numero}` : undefined
    };

    await onSubmit(data);
  };

  const totalProdutosLiquido = formData.lancar_produtos ? formData.produtos_selecionados.reduce((sum, p) => {
    const total = parseNumero(p.valor_total || "0");
    const desc = parseNumero(p.desconto_item || "0");
    return sum + (total - desc);
  }, 0) : 0;

  const totalProdutosBruto = formData.lancar_produtos ? formData.produtos_selecionados.reduce((sum, p) => {
    return sum + parseNumero(p.valor_total || "0");
  }, 0) : 0;

  const totalDescontos = formData.lancar_produtos ? formData.produtos_selecionados.reduce((sum, p) => {
    return sum + parseNumero(p.desconto_item || "0");
  }, 0) : 0;

  const valorTotal = calcularValorTotal();
  const totalParcelas = formData.parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);

  return (
    <>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
        <Card className="shadow-xl border-slate-200 bg-white">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200">
            <CardTitle className="flex items-center gap-3 text-slate-900">
              <div className="w-10 h-10 bg-slate-700 rounded-xl flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              {initialData?.id ? 'Editar Lançamento' : 'Novo Lançamento Financeiro'} - Etapa {etapa}/2
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleSubmitFinal} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">Tipo *</Label>
                  <Select value={formData.tipo} onValueChange={(v) => handleChange('tipo', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Pagar">Conta a Pagar</SelectItem>
                      <SelectItem value="Receber">Conta a Receber</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">Conta Bancária *</Label>
                  <Select value={formData.conta_bancaria_id} onValueChange={(v) => {
                    const conta = contasBancarias.find(c => c.id === v);
                    handleChange('conta_bancaria_id', v);
                    handleChange('conta_bancaria_nome', conta ? `${conta.banco} - ${conta.numero}` : '');
                  }} required>
                    <SelectTrigger><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
                    <SelectContent>
                      {contasBancarias.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.banco} - {c.agencia}/{c.numero} ({c.titular})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">Tipo Documento *</Label>
                  <Select value={formData.tipo_documento} onValueChange={(v) => handleChange('tipo_documento', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NF-e">NF-e</SelectItem>
                      <SelectItem value="NFC-e">NFC-e</SelectItem>
                      <SelectItem value="Recibo">Recibo</SelectItem>
                      <SelectItem value="Boleto">Boleto</SelectItem>
                      <SelectItem value="Nota Manual">Nota Manual</SelectItem>
                      <SelectItem value="Outros">Outros</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">Data Emissão *</Label>
                  <Input type="date" value={formData.data_emissao} onChange={(e) => handleChange('data_emissao', e.target.value)} required />
                </div>
              </div>

              {formData.tipo_documento === 'NF-e' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">Número *</Label>
                    <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" required />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">Série</Label>
                    <Input value={formData.serie_documento} onChange={(e) => handleChange('serie_documento', e.target.value)} placeholder="1" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">CFOP</Label>
                    <Input value={formData.cfop} onChange={(e) => handleChange('cfop', e.target.value)} placeholder="5102" maxLength={4} />
                  </div>
                </div>
              )}

              {formData.tipo_documento === 'NFC-e' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">Número *</Label>
                    <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" required />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">Série</Label>
                    <Input value={formData.serie_documento} onChange={(e) => handleChange('serie_documento', e.target.value)} placeholder="1" />
                  </div>
                </div>
              )}

              {formData.tipo_documento === 'Boleto' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">Nº Boleto *</Label>
                    <Input value={formData.numero_boleto} onChange={(e) => handleChange('numero_boleto', e.target.value)} placeholder="000000" required />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">Banco</Label>
                    <Input value={formData.banco_boleto} onChange={(e) => handleChange('banco_boleto', e.target.value)} placeholder="Banco" />
                  </div>
                </div>
              )}

              {['Recibo', 'Nota Manual', 'Outros'].includes(formData.tipo_documento) && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">Número *</Label>
                  <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="0001" required />
                </div>
              )}

              {etapa === 1 && (
                <>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> 
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-slate-700">Fornecedor *</Label>
                        <ComboboxFornecedor 
                          fornecedores={fornecedores}
                          value={formData.fornecedor_id}
                          onChange={(v) => handleChange('fornecedor_id', v)}
                          className="w-full"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-slate-700">Safra</Label>
                        <Select value={formData.safra_id} onValueChange={(v) => handleChange('safra_id', v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                          <SelectContent>
                            {safras.map(s => <SelectItem key={s.id} value={s.id} className="text-xs">{s.ano_inicio}/{s.ano_fim}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 p-1.5 bg-slate-50 rounded border border-slate-200">
                    <Checkbox checked={formData.lancar_produtos} onCheckedChange={(v) => handleChange('lancar_produtos', v)} id="lancar_produtos" />
                    <label htmlFor="lancar_produtos" className="font-medium cursor-pointer text-xs text-slate-700">Lançar Produtos no Estoque</label>
                  </div>

                  {formData.lancar_produtos && (
                    <div className="space-y-1.5 border border-slate-200 rounded p-2 bg-slate-50">
                      <div className="flex justify-between items-center">
                        <h3 className="font-semibold text-xs text-slate-800">Produtos</h3>
                        <Button type="button" size="sm" onClick={handleAdicionarProduto} variant="outline" className="h-6 gap-1 text-xs">
                          <Plus className="w-3 h-3" />
                          Adicionar
                        </Button>
                      </div>

                      {formData.produtos_selecionados.length > 0 && (
                        <div className="border rounded overflow-auto max-h-60 bg-white">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-slate-50">
                                <TableHead className="w-8 text-xs"></TableHead>
                                <TableHead className="w-[180px] text-xs">Produto *</TableHead>
                                <TableHead className="text-right w-[80px] text-xs">Qtd *</TableHead>
                                <TableHead className="text-right w-[90px] text-xs">Total *</TableHead>
                                <TableHead className="text-right w-[80px] text-xs">Desc.</TableHead>
                                <TableHead className="text-right w-[90px] text-xs">Líquido</TableHead>
                                <TableHead className="text-center w-[50px] text-xs">UN</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {formData.produtos_selecionados.map((produto, index) => {
                                const total = parseNumero(produto.valor_total || "0");
                                const desc = parseNumero(produto.desconto_item || "0");
                                const liquido = total - desc;
                                const qtd = parseNumero(produto.quantidade || "0");
                                const unitario = qtd > 0 ? (liquido / qtd) : 0;

                                return (
                                  <TableRow key={index}>
                                    <TableCell className="w-8">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-6 w-6">
                                            <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start">
                                          <DropdownMenuItem onClick={() => handleRemoverProduto(index)} className="text-xs text-red-600">
                                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                                            Excluir
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </TableCell>
                                    <TableCell className="w-[180px]">
                                      <AutocompleteGenerico
                                        items={produtos}
                                        value={produto.produto_id}
                                        onChange={(v) => handleAtualizarProduto(index, 'produto_id', v)}
                                        placeholder="Buscar produto..."
                                        displayField="nome_produto"
                                        searchFields={["nome_produto", "codigo_interno", "codigo_barras"]}
                                        renderSubtext={(p) => p.codigo_interno ? `Cód: ${p.codigo_interno}` : ''}
                                        className="w-full"
                                      />
                                    </TableCell>
                                    <TableCell className="w-[80px]">
                                      <Input 
                                        value={produto.quantidade} 
                                        onChange={(e) => {
                                          const valor = e.target.value.replace(/[^\d,]/g, '');
                                          handleAtualizarProduto(index, 'quantidade', valor);
                                        }} 
                                        placeholder="0,00" 
                                        className="text-right h-6 text-xs" 
                                      />
                                    </TableCell>
                                    <TableCell className="w-[90px]">
                                      <Input 
                                        value={produto.valor_total} 
                                        onChange={(e) => {
                                          const valor = e.target.value.replace(/[^\d,]/g, '');
                                          handleAtualizarProduto(index, 'valor_total', valor);
                                        }} 
                                        placeholder="0,00" 
                                        className="text-right h-6 text-xs" 
                                      />
                                    </TableCell>
                                    <TableCell className="w-[80px]">
                                      <Input 
                                        value={produto.desconto_item || "0,00"} 
                                        onChange={(e) => {
                                          const valor = e.target.value.replace(/[^\d,]/g, '');
                                          handleAtualizarProduto(index, 'desconto_item', valor);
                                        }} 
                                        placeholder="0,00" 
                                        className="text-right h-6 text-xs" 
                                      />
                                    </TableCell>
                                    <TableCell className="text-right w-[90px]">
                                      <div className="font-mono font-semibold text-xs">{formatarMoeda(liquido)}</div>
                                      <div className="text-[10px] text-slate-500">Un: {formatarMoeda(unitario)}</div>
                                    </TableCell>
                                    <TableCell className="text-center w-[50px]">
                                      <span className="text-xs font-mono">{produto.unidade || '-'}</span>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                              {formData.produtos_selecionados.length > 0 && (
                                <TableRow className="bg-slate-100 font-semibold border-t-2">
                                  <TableCell colSpan={3} className="text-xs">TOTAL</TableCell>
                                  <TableCell className="text-right font-mono text-xs">{formatarMoeda(totalProdutosBruto)}</TableCell>
                                  <TableCell className="text-right font-mono text-xs text-red-600">{formatarMoeda(totalDescontos)}</TableCell>
                                  <TableCell className="text-right font-mono text-xs text-emerald-700 font-bold">{formatarMoeda(totalProdutosLiquido)}</TableCell>
                                  <TableCell colSpan={1}></TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      )}

                      <div className="flex items-center space-x-2 p-1.5 bg-white rounded border border-slate-200">
                        <Checkbox checked={formData.dar_entrada_estoque} onCheckedChange={(v) => handleChange('dar_entrada_estoque', v)} id="dar_entrada_estoque" />
                        <label htmlFor="dar_entrada_estoque" className="font-medium cursor-pointer text-xs text-slate-700">Dar entrada no estoque?</label>
                      </div>

                      {formData.dar_entrada_estoque && (
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Local de Estoque *</Label>
                          <div className="flex gap-1">
                            <AutocompleteGenerico
                              items={locais}
                              value={locais.find(l => l.nome === formData.local_estoque)?.id || ""}
                              onChange={(id) => {
                                const local = locais.find(l => l.id === id);
                                handleChange('local_estoque', local?.nome || "");
                              }}
                              placeholder="Buscar local..."
                              displayField="nome"
                              searchFields={["nome", "descricao"]}
                              className="flex-1"
                            />
                            <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogLocal(true)} className="h-7 w-7">
                              <Plus className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Frete</Label>
                          <Input value={formData.frete} onChange={(e) => handleChange('frete', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" className="h-7 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Outras Despesas</Label>
                          <Input value={formData.outras_despesas} onChange={(e) => handleChange('outras_despesas', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" className="h-7 text-xs" />
                        </div>
                      </div>

                      <div className="bg-white border border-slate-300 rounded p-1.5">
                        <div className="space-y-0.5 text-xs">
                          <div className="font-semibold text-slate-800 mb-0.5">Valor a Pagar</div>
                          <div className="flex justify-between">
                            <span className="text-slate-600">Produtos (líquido):</span>
                            <span className="font-mono font-semibold text-slate-800">{formatarMoeda(totalProdutosLiquido)}</span>
                          </div>
                          {parseNumero(formData.frete) > 0 && (
                            <div className="flex justify-between">
                              <span className="text-slate-600">+ Frete:</span>
                              <span className="font-mono text-slate-700">{formatarMoeda(parseNumero(formData.frete))}</span>
                            </div>
                          )}
                          {parseNumero(formData.outras_despesas) > 0 && (
                            <div className="flex justify-between">
                              <span className="text-slate-600">+ Outras Despesas:</span>
                              <span className="font-mono text-slate-700">{formatarMoeda(parseNumero(formData.outras_despesas))}</span>
                            </div>
                          )}
                          {parseNumero(formData.valor_ipi || "0") > 0 && (
                            <div className="flex justify-between">
                              <span className="text-slate-600">+ IPI:</span>
                              <span className="font-mono text-slate-700">{formatarMoeda(parseNumero(formData.valor_ipi || "0"))}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold border-t pt-0.5 mt-0.5 text-slate-900">
                            <span>TOTAL A PAGAR:</span>
                            <span className="font-mono text-base">{formatarMoeda(valorTotal)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!formData.lancar_produtos && (
                    <div className="space-y-1.5 border border-slate-200 rounded p-2 bg-slate-50">
                      <h3 className="font-semibold text-xs text-slate-800">Valores</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Valor *</Label>
                          <Input value={formData.valor_original} onChange={(e) => handleChange('valor_original', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" required className="h-7 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Juros</Label>
                          <Input value={formData.valor_juros} onChange={(e) => handleChange('valor_juros', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" className="h-7 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Multa</Label>
                          <Input value={formData.valor_multa} onChange={(e) => handleChange('valor_multa', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" className="h-7 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Desconto</Label>
                          <Input value={formData.valor_desconto} onChange={(e) => handleChange('valor_desconto', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" className="h-7 text-xs" />
                        </div>
                      </div>
                      <div className="bg-white border border-slate-300 rounded p-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-700">Total:</span>
                          <span className="font-semibold text-slate-900">{formatarMoeda(valorTotal)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {mostrarCamposNFe && (
                    <div className="space-y-1.5 border border-slate-200 rounded p-2 bg-slate-50">
                      <div className="flex justify-between items-center">
                        <h3 className="font-semibold text-xs text-slate-800">Detalhes NF-e (Informativo)</h3>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setMostrarCamposNFe(false)} className="h-6 text-xs">Ocultar</Button>
                      </div>
                      
                      <div className="bg-blue-50 border border-blue-200 rounded p-1 text-[10px] text-blue-800">
                        ℹ️ Campos informativos da NF-e. O valor a pagar é calculado com base nos produtos lançados acima.
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Vlr. Produtos (XML)</Label>
                          <Input value={formData.valor_produtos || ''} className="h-7 text-xs bg-slate-100" readOnly />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Vlr. Frete (XML)</Label>
                          <Input value={formData.valor_frete || ''} className="h-7 text-xs bg-slate-100" readOnly />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Vlr. Seguro (XML)</Label>
                          <Input value={formData.valor_seguro || ''} className="h-7 text-xs bg-slate-100" readOnly />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Outras Desp. (XML)</Label>
                          <Input value={formData.valor_outras_despesas || ''} className="h-7 text-xs bg-slate-100" readOnly />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Desc. Total (XML)</Label>
                          <Input value={formData.valor_desconto_total || ''} className="h-7 text-xs bg-slate-100" readOnly />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">IPI (XML)</Label>
                          <Input value={formData.valor_ipi || ''} className="h-7 text-xs bg-slate-100" readOnly />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">ICMS (XML)</Label>
                          <Input value={formData.valor_icms || ''} className="h-7 text-xs bg-slate-100" readOnly />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">PIS (XML)</Label>
                          <Input value={formData.valor_pis || ''} className="h-7 text-xs bg-slate-100" readOnly />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">COFINS (XML)</Label>
                          <Input value={formData.valor_cofins || ''} className="h-7 text-xs bg-slate-100" readOnly />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Base ICMS (XML)</Label>
                          <Input value={formData.base_calculo_icms || ''} className="h-7 text-xs bg-slate-100" readOnly />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-slate-700">Obs. NF-e</Label>
                        <Textarea value={formData.observacoes_nfe || ''} onChange={(e) => handleChange('observacoes_nfe', e.target.value)} className="min-h-14 bg-white text-xs" placeholder="Observações da nota..." rows={2} />
                      </div>
                    </div>
                  )}

                  {!mostrarCamposNFe && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setMostrarCamposNFe(true)} className="h-7 text-xs w-full">
                      Mostrar Detalhes NF-e
                    </Button>
                  )}

                  <div className="flex justify-end gap-2 pt-1.5 border-t border-slate-200">
                    <Button type="button" variant="outline" onClick={onCancel} className="h-7 text-xs">Cancelar</Button>
                    <Button type="button" onClick={handleProximaEtapa} className="bg-slate-700 hover:bg-slate-800 h-7 text-xs">Próximo</Button>
                  </div>
                </>
              )}

              {etapa === 2 && (
                <>
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-slate-700">Plano de Contas *</Label>
                        <div className="flex gap-1">
                          <AutocompleteGenerico
                            items={planosContas}
                            value={formData.plano_contas_id}
                            onChange={(v) => handleChange('plano_contas_id', v)}
                            placeholder="Buscar plano..."
                            displayField="descricao"
                            searchFields={["codigo", "descricao"]}
                            renderItem={(p) => (
                              <>
                                <div className="text-xs font-medium text-slate-900">{p.codigo} - {p.descricao}</div>
                              </>
                            )}
                            className="flex-1"
                          />
                          <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogPlano(true)} className="h-7 w-7">
                            <Plus className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-slate-700">Grupo Financeiro *</Label>
                        <div className="flex gap-1">
                          <AutocompleteGenerico
                            items={gruposFinanceiros}
                            value={formData.grupo_id}
                            onChange={(v) => handleChange('grupo_id', v)}
                            placeholder="Buscar grupo..."
                            displayField="descricao"
                            searchFields={["codigo", "descricao"]}
                            renderItem={(g) => (
                              <>
                                <div className="text-xs font-medium text-slate-900">{g.codigo} - {g.descricao}</div>
                              </>
                            )}
                            className="flex-1"
                          />
                          <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogGrupo(true)} className="h-7 w-7">
                            <Plus className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-slate-700">Centro de Custo</Label>
                      <div className="flex gap-1">
                        <AutocompleteGenerico
                          items={centrosCusto}
                          value={formData.centro_custo_id}
                          onChange={(v) => handleChange('centro_custo_id', v)}
                          placeholder="Buscar centro..."
                          displayField="nome"
                          searchFields={["nome", "codigo"]}
                          className="flex-1"
                        />
                        <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogCentro(true)} className="h-7 w-7">
                          <Plus className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-100 border border-slate-300 rounded p-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-800">Valor Total a Pagar:</span>
                      <span className="font-mono font-bold text-slate-900 text-base">{formatarMoeda(valorTotal)}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5 border border-slate-200 rounded p-2 bg-slate-50">
                    <h3 className="font-semibold text-xs text-slate-800">Pagamento</h3>
                    
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          checked={formData.parcelar} 
                          onCheckedChange={(v) => handleChange('parcelar', v)} 
                          id="parcelar"
                          disabled={formData.conta_paga}
                        />
                        <label htmlFor="parcelar" className={`font-medium cursor-pointer text-xs ${formData.conta_paga ? 'text-slate-400' : 'text-slate-700'}`}>Parcelar</label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          checked={formData.conta_paga} 
                          onCheckedChange={(v) => handleChange('conta_paga', v)} 
                          id="conta_paga"
                          disabled={formData.parcelar}
                        />
                        <label htmlFor="conta_paga" className={`font-medium cursor-pointer text-xs ${formData.parcelar ? 'text-slate-400' : 'text-slate-700'}`}>Conta já paga</label>
                      </div>
                    </div>

                    {formData.parcelar && (
                      <div className="bg-white border border-slate-300 rounded p-1.5 space-y-1.5">
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Forma de Pagamento *</Label>
                          <Select value={formData.forma_pagamento_id} onValueChange={(v) => handleChange('forma_pagamento_id', v)}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                            <SelectContent>
                              {FORMAS_PAGAMENTO_PADRAO.map(forma => (
                                <SelectItem key={forma} value={forma} className="text-xs">{forma}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex justify-between items-center">
                          <Label className="text-xs font-medium text-slate-700">Parcelas ({formData.parcelas.length})</Label>
                          <Button type="button" size="sm" onClick={adicionarParcela} variant="outline" className="h-6 gap-1 text-xs">
                            <Plus className="w-3 h-3" />
                            Adicionar
                          </Button>
                        </div>

                        <div className="border rounded max-h-48 overflow-auto bg-white">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-slate-50">
                                <TableHead className="w-10 text-xs">Nº</TableHead>
                                <TableHead className="text-xs">Vencimento</TableHead>
                                <TableHead className="text-right text-xs">Valor</TableHead>
                                <TableHead className="w-10"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {formData.parcelas.map((parcela, index) => (
                                <TableRow key={index}>
                                  <TableCell className="font-semibold text-xs">{index + 1}</TableCell>
                                  <TableCell>
                                    <Input type="date" value={parcela.data} onChange={(e) => atualizarParcela(index, 'data', e.target.value)} className="h-6 text-xs" />
                                  </TableCell>
                                  <TableCell>
                                    <Input value={parcela.valor} onChange={(e) => atualizarParcela(index, 'valor', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" className="text-right h-6 text-xs" />
                                  </TableCell>
                                  <TableCell>
                                    <Button type="button" variant="ghost" size="icon" onClick={() => removerParcela(index)} disabled={formData.parcelas.length <= 1} className="h-6 w-6">
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        <div className={`p-1 rounded text-xs ${Math.abs(totalParcelas - valorTotal) > 0.01 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-50 border border-slate-200'}`}>
                          <div className="flex justify-between">
                            <span>Total Parcelas:</span>
                            <span className="font-semibold">{formatarMoeda(totalParcelas)}</span>
                          </div>
                          {Math.abs(totalParcelas - valorTotal) > 0.01 && <p className="text-center mt-0.5 text-[10px]">Valores diferentes!</p>}
                        </div>
                      </div>
                    )}

                    {formData.conta_paga && (
                      <div className="bg-white border border-slate-300 rounded p-1.5 space-y-1.5">
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Forma de Pagamento *</Label>
                          <Select value={formData.forma_pagamento_paga_id} onValueChange={(v) => handleChange('forma_pagamento_paga_id', v)}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                            <SelectContent>
                              {FORMAS_PAGAMENTO_PADRAO.map(forma => (
                                <SelectItem key={forma} value={forma} className="text-xs">{forma}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <div className="space-y-1">
                            <Label className="text-xs font-medium text-slate-700">Data Pgto *</Label>
                            <Input type="date" value={formData.data_pagamento} onChange={(e) => handleChange('data_pagamento', e.target.value)} required className="h-7 text-xs" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-medium text-slate-700">Valor Pago *</Label>
                            <Input value={formData.valor_pago_total} onChange={(e) => handleChange('valor_pago_total', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" required className="h-7 text-xs" />
                          </div>
                        </div>
                      </div>
                    )}

                    {!formData.parcelar && !formData.conta_paga && (
                      <div className="bg-white border border-slate-300 rounded p-1.5">
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Vencimento *</Label>
                          <Input type="date" value={formData.data_vencimento} onChange={(e) => handleChange('data_vencimento', e.target.value)} required className="h-7 text-xs" />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-slate-700">Observações</Label>
                    <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="OBSERVAÇÕES..." className="uppercase text-xs min-h-12" style={{ textTransform: 'uppercase' }} rows={2} />
                  </div>

                  <div className="flex justify-between gap-2 pt-1.5 border-t border-slate-200">
                    <Button type="button" variant="outline" onClick={() => setEtapa(1)} className="h-7 text-xs">Voltar</Button>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={onCancel} className="h-7 text-xs">Cancelar</Button>
                      <Button 
                        type="submit" 
                        className="bg-slate-700 hover:bg-slate-800 gap-2"
                        disabled={!initialData?.id && formData.parcelar && Math.abs(totalParcelas - valorTotal) > 0.01}
                      >
                        <Save className="w-4 h-4" />
                        {initialData?.id ? 'Atualizar' : 'Salvar'}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <DialogCadastroRapido tipo="centro_custo" open={showDialogCentro} onClose={() => setShowDialogCentro(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['centros_compra'] }); handleChange('centro_custo_id', id); setShowDialogCentro(false); }} />
      <DialogCadastroRapido tipo="local_estoque" open={showDialogLocal} onClose={() => setShowDialogLocal(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['locais_compra'] }); const local = locais.find(l => l.id === id); if (local) handleChange('local_estoque', local.nome); setShowDialogLocal(false); }} />
      <DialogCadastroRapido tipo="plano_contas" open={showDialogPlano} onClose={() => setShowDialogPlano(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['planos_compra'] }); handleChange('plano_contas_id', id); setShowDialogPlano(false); }} />
      <DialogCadastroRapido tipo="grupo_financeiro" open={showDialogGrupo} onClose={() => setShowDialogGrupo(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['grupos_compra'] }); handleChange('grupo_id', id); setShowDialogGrupo(false); }} />
    </>
  );
}
