
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
import { ShoppingCart, Save, X, Plus, Trash2, ChevronRight, ChevronLeft, FileText, Paperclip, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import DialogCadastroRapido from "./DialogCadastroRapido.jsx";

const FORMAS_PAGAMENTO_PADRAO = [
  'Dinheiro',
  'PIX',
  'Cartão de Crédito',
  'Cartão de Débito',
  'Boleto Bancário',
  'Transferência Bancária',
  'Cheque',
  'Crédito Loja',
  'Vale Alimentação',
  'Vale Refeição',
  'Depósito Bancário',
  'Outros'
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
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

export default function FormularioCompraFinanceiro({ onSubmit, onCancel, initialData, fornecedores, produtos }) {
  const [etapa, setEtapa] = useState(1);
  const [mostrarCamposNFe, setMostrarCamposNFe] = useState(false);
  const [formData, setFormData] = useState(() => {
    const defaults = {
      tipo: "Pagar",
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
      base_calculo_icms: ""
    };

    if (!initialData) return defaults;

    // Se tem dados da NF-e, mostrar os campos
    const temDadosNFeInicial = initialData.valor_produtos || initialData.valor_frete || initialData.valor_seguro || initialData.valor_outras_despesas || initialData.valor_desconto_total || initialData.valor_ipi || initialData.valor_icms || initialData.valor_pis || initialData.valor_cofins || initialData.base_calculo_icms || initialData.observacoes_nfe;
    if (temDadosNFeInicial) {
      setTimeout(() => setMostrarCamposNFe(true), 100);
    }

    return {
      ...defaults,
      ...initialData,
      lancar_produtos: initialData.lancar_produtos !== false,
      dar_entrada_estoque: initialData.dar_entrada_estoque !== false,
      conta_paga: initialData.conta_paga || false,
      valor_original: initialData.valor_original ? formatarNumero(initialData.valor_original) : "",
      valor_juros: initialData.valor_juros ? formatarNumero(initialData.valor_juros) : defaults.valor_juros,
      valor_multa: initialData.valor_multa ? formatarNumero(initialData.valor_multa) : defaults.valor_multa,
      valor_desconto: initialData.valor_desconto ? formatarNumero(initialData.valor_desconto) : defaults.valor_desconto,
      frete: initialData.valor_frete ? formatarNumero(initialData.valor_frete) : (initialData.frete ? formatarNumero(initialData.frete) : defaults.frete),
      outras_despesas: initialData.valor_outras_despesas ? formatarNumero(initialData.valor_outras_despesas) : (initialData.outras_despesas ? formatarNumero(initialData.outras_despesas) : defaults.outras_despesas),
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
      produtos_selecionados: initialData.produtos_selecionados?.map(p => ({
        ...p,
        quantidade: formatarNumero(p.quantidade),
        valor_total: formatarNumero(p.valor_total || 0), // Changed this line
        desconto_item: formatarNumero(p.desconto_item || 0)
      })) || [],
      parcelas: initialData.parcelas?.map(p => ({
        data: p.data,
        valor: formatarNumero(p.valor || 0)
      })) || [],
      anexos: initialData.anexos || [],
      observacoes_nfe: initialData.observacoes_nfe || ""
    };
  });

  const [showDialogCentro, setShowDialogCentro] = useState(false);
  const [showDialogLocal, setShowDialogLocal] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: safras = [] } = useQuery({
    queryKey: ['safras_compra', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Safra.list();
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: centros = [] } = useQuery({
    queryKey: ['centros_compra', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: planos = [] } = useQuery({
    queryKey: ['planos_compra', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PlanoContas.list('codigo');
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.ativo !== false && p.tipo === 'Despesa' && p.aceita_lancamento !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: grupos = [] } = useQuery({
    queryKey: ['grupos_compra', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.GrupoFinanceiro.list();
      return all.filter(g => g.empresa_id === empresaSelecionadaId && g.ativo !== false && g.tipo === 'Despesa');
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: locais = [] } = useQuery({
    queryKey: ['locais_compra'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: [],
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
  }, [formData.conta_paga]);

  useEffect(() => {
    if (formData.data_emissao && !formData.data_vencimento && !initialData) {
      setFormData(prev => ({
        ...prev,
        data_vencimento: prev.data_emissao
      }));
    }
  }, [formData.data_emissao]);

  useEffect(() => {
    if (formData.parcelar && formData.parcelas.length === 0 && formData.data_vencimento) {
      const valorTotal = calcularValorTotal();
      // Ensure at least one parcel for initial setup
      const valorParcela = valorTotal > 0 ? valorTotal : 0; 
      
      setFormData(prev => ({
        ...prev,
        parcelas: [
          { data: prev.data_vencimento, valor: formatarNumero(valorParcela) }
        ]
      }));
    }
  }, [formData.parcelar, formData.data_vencimento]); // Added data_vencimento as dependency

  const calcularValorTotal = () => {
    if (formData.lancar_produtos) {
      // SOMA DOS VALORES LÍQUIDOS DOS PRODUTOS (Total - Desconto)
      const totalProdutos = formData.produtos_selecionados.reduce((sum, p) => {
        const total = parseNumero(p.valor_total || "0");
        const desc = parseNumero(p.desconto_item || "0");
        return sum + (total - desc);
      }, 0);
      // TOTAL = Produtos Líquido + Frete + Outras Despesas
      return totalProdutos + parseNumero(formData.frete) + parseNumero(formData.outras_despesas);
    } else {
      return parseNumero(formData.valor_original) + parseNumero(formData.valor_juros) + parseNumero(formData.valor_multa) - parseNumero(formData.valor_desconto);
    }
  };

  const adicionarParcela = () => {
    const ultimaParcela = formData.parcelas[formData.parcelas.length - 1];
    const proximaData = ultimaParcela ? calcularDataProximaMes(ultimaParcela.data) : formData.data_vencimento;
    const valorTotal = calcularValorTotal();
    const newNumberOfParcelas = formData.parcelas.length + 1;
    const equalParcelValue = valorTotal / newNumberOfParcelas;

    const updatedParcelas = Array.from({ length: newNumberOfParcelas }, (_, i) => {
      const currentParcel = formData.parcelas[i];
      let date = currentParcel?.data || (i === 0 ? formData.data_vencimento : calcularDataProximaMes(formData.parcelas[i-1]?.data || formData.data_vencimento));
      if (i === newNumberOfParcelas - 1 && !ultimaParcela) {
        date = proximaData;
      } else if (i === newNumberOfParcelas - 1 && ultimaParcela) {
        date = calcularDataProximaMes(formData.parcelas[i-1]?.data || formData.data_vencimento);
      }

      return {
        data: date,
        valor: formatarNumero(equalParcelValue)
      };
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

    const updatedParcelas = newParcelas.map(p => ({
      ...p,
      valor: formatarNumero(equalParcelValue)
    }));
    
    setFormData(prev => ({ ...prev, parcelas: updatedParcelas }));
  };

  const atualizarParcela = (index, campo, valor) => {
    setFormData(prev => ({
      ...prev,
      parcelas: prev.parcelas.map((p, i) => i === index ? { ...p, [campo]: valor } : p)
    }));
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleAdicionarProduto = () => {
    setFormData(prev => ({
      ...prev,
      produtos_selecionados: [
        ...prev.produtos_selecionados,
        { produto_id: "", produto_nome: "", quantidade: "", valor_total: "", desconto_item: "0,00" }
      ]
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
                updated.valor_total = formatarNumero(produto.preco_custo * qtd);
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
        anexos: [...prev.anexos, {
          nome: file.name,
          url: file_url,
          tipo: file.type,
          tamanho: file.size
        }]
      }));
      
      toast.success('✅ Arquivo anexado!');
    } catch (error) {
      toast.error('Erro ao fazer upload');
    } finally {
      e.target.value = '';
      setUploadingFile(false);
    }
  };

  const handleRemoverAnexo = (index) => {
    setFormData(prev => ({
      ...prev,
      anexos: prev.anexos.filter((_, i) => i !== index)
    }));
    toast.success('Anexo removido!');
  };

  const handleProximaEtapa = () => {
    if (!formData.fornecedor_id) {
      toast.error('❌ Selecione o fornecedor!');
      return;
    }

    if (!formData.data_emissao) {
      toast.error('❌ Preencha a data de emissão!');
      return;
    }

    if (formData.tipo_documento === 'Boleto') {
      if (!formData.numero_boleto) {
        toast.error('❌ Preencha o número do boleto!');
        return;
      }
    } else {
      if (!formData.numero_documento) {
        toast.error('❌ Preencha o número do documento!');
        return;
      }
    }

    if (formData.lancar_produtos) {
      if (formData.produtos_selecionados.length === 0) {
        toast.error('❌ Adicione pelo menos 1 produto!');
        return;
      }

      const produtosIncompletos = formData.produtos_selecionados.filter(p => 
        !p.produto_id || parseNumero(p.quantidade) <= 0 || parseNumero(p.valor_total) <= 0
      );

      if (produtosIncompletos.length > 0) {
        toast.error('❌ Preencha todos os campos de quantidade e valor total dos produtos com valores válidos!');
        return;
      }

      if (formData.dar_entrada_estoque && !formData.local_estoque) {
        toast.error('❌ Selecione o local de estoque!');
        return;
      }
    } else {
      if (parseNumero(formData.valor_original) <= 0) {
        toast.error('❌ Preencha o valor original com um valor válido!');
        return;
      }
    }

    setEtapa(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.parcelar && !formData.conta_paga && !formData.data_vencimento) { // Updated condition
      toast.error('❌ Preencha a data de vencimento!');
      return;
    }

    if (!formData.plano_contas_id) {
      toast.error('❌ Selecione o plano de contas!');
      return;
    }

    if (!formData.grupo_id) {
      toast.error('❌ Selecione o grupo financeiro!');
      return;
    }

    if (formData.conta_paga) {
      if (!formData.data_pagamento) {
        toast.error('❌ Preencha a data de pagamento!');
        return;
      }
      if (parseNumero(formData.valor_pago_total) <= 0) {
        toast.error('❌ Preencha o valor pago com um valor válido!');
        return;
      }
      if (!formData.forma_pagamento_paga_id) {
        toast.error('❌ Selecione a forma de pagamento!');
        return;
      }
    }

    if (!formData.conta_paga && formData.parcelar && formData.parcelas.length < 1) { // Changed < 2 to < 1
      toast.error('❌ Adicione pelo menos 1 parcela!');
      return;
    }

    if (!formData.conta_paga && formData.parcelar) {
      const valorTotal = calcularValorTotal();
      const totalParcelas = formData.parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);
      
      if (Math.abs(totalParcelas - valorTotal) > 0.01) {
        toast.error('❌ Total das parcelas diferente do valor total!');
        return;
      }
      
      if (formData.parcelas.some(p => parseNumero(p.valor) <= 0)) {
        toast.error('❌ Todas as parcelas devem ter um valor maior que zero!');
        return;
      }
    }

    const fornecedor = fornecedores.find(f => f.id === formData.fornecedor_id);
    const safra = safras.find(s => s.id === formData.safra_id);
    const centro = centros.find(c => c.id === formData.centro_custo_id);
    const plano = planos.find(p => p.id === formData.plano_contas_id);
    const grupo = grupos.find(g => g.id === formData.grupo_id);

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
      forma_pagamento_id: formData.forma_pagamento_id || undefined, // This field is no longer set in the UI directly, but exists in state/initialData
      forma_pagamento_nome: formData.forma_pagamento_id || undefined, // Same as above
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
        const totalGross = parseNumero(p.valor_total); // This is the gross total from the input
        const desconto = parseNumero(p.desconto_item || "0");
        const valorLiquido = totalGross - desconto; // This is the net value per item
        const valorUnitario = qtd > 0 ? (valorLiquido / qtd) : 0; // Calculated unit price based on net total

        return {
          produto_id: p.produto_id,
          produto_nome: p.produto_nome,
          quantidade: qtd,
          unidade: p.unidade,
          valor_unitario: valorUnitario, // Sending the calculated net unit value
          desconto_item: desconto,
          valor_total: totalGross // Added this line
        };
      }) : [],
      valor_original: formData.lancar_produtos ? undefined : parseNumero(formData.valor_original),
      valor_juros: formData.lancar_produtos ? undefined : parseNumero(formData.valor_juros),
      valor_multa: formData.lancar_produtos ? undefined : parseNumero(formData.valor_multa),
      valor_desconto: formData.lancar_produtos ? undefined : parseNumero(formData.valor_desconto), // Used when lancar_produtos is false
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
      parcelas: (!formData.conta_paga && formData.parcelar) ? formData.parcelas.map(p => ({ 
        data: p.data, 
        valor: parseNumero(p.valor) 
      })) : undefined,
      anexos: formData.anexos
    };

    await onSubmit(data);
  };

  const totalProdutos = formData.lancar_produtos ? formData.produtos_selecionados.reduce((sum, p) => {
    const total = parseNumero(p.valor_total || "0");
    const desc = parseNumero(p.desconto_item || "0");
    return sum + (total - desc);
  }, 0) : 0;

  const subtotalBruto = formData.lancar_produtos ? formData.produtos_selecionados.reduce((sum, p) => 
    sum + parseNumero(p.valor_total || "0"), 0
  ) : 0;

  const totalDescontos = formData.lancar_produtos ? formData.produtos_selecionados.reduce((sum, p) => 
    sum + parseNumero(p.desconto_item || "0"), 0
  ) : 0;

  const valorTotal = calcularValorTotal();
  const totalParcelas = formData.parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);

  // The 'temDadosNFe' is still calculated for initial state and other potential uses,
  // but the card for NFe details will always render (controlled by mostrarCamposNFe state)
  const temDadosNFe = formData.valor_produtos || formData.valor_frete || formData.valor_seguro || formData.valor_ipi || formData.valor_icms || formData.valor_pis || formData.valor_cofins || formData.observacoes_nfe;


  return (
    <>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
        <Card className="shadow-xl border-slate-200 bg-white">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200 py-3">
            <CardTitle className="flex items-center gap-3 text-slate-900">
              <div className="w-9 h-9 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center">
                <ShoppingCart className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-base">Novo Lançamento</div>
                <div className="text-xs font-normal text-slate-600">Etapa {etapa} de 2</div>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* ETAPA 1 */}
              {etapa === 1 && (
                <>
                  {/* CARD: DADOS BÁSICOS */}
                  <Card className="bg-blue-50 border-blue-200">
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-sm">Dados Básicos</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Fornecedor *</Label>
                          <Select value={formData.fornecedor_id} onValueChange={(v) => handleChange('fornecedor_id', v)}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                            <SelectContent>
                              {fornecedores.map(f => <SelectItem key={f.id} value={f.id} className="text-xs">{f.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Tipo Documento *</Label>
                          <Select value={formData.tipo_documento} onValueChange={(v) => handleChange('tipo_documento', v)}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NF-e" className="text-xs">NF-e</SelectItem>
                              <SelectItem value="NFC-e" className="text-xs">NFC-e</SelectItem>
                              <SelectItem value="Recibo" className="text-xs">Recibo</SelectItem>
                              <SelectItem value="Boleto" className="text-xs">Boleto</SelectItem>
                              <SelectItem value="Nota Manual" className="text-xs">Nota Manual</SelectItem>
                              <SelectItem value="Outros" className="text-xs">Outros</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Data Emissão *</Label>
                          <Input type="date" value={formData.data_emissao} onChange={(e) => handleChange('data_emissao', e.target.value)} required className="h-9 text-xs" />
                        </div>
                      </div>

                      {formData.tipo_documento === 'NF-e' && (
                        <div className="space-y-3 pt-2 border-t">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Número NF-e *</Label>
                              <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" required className="h-9 text-xs" />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Série</Label>
                              <Input value={formData.serie_documento} onChange={(e) => handleChange('serie_documento', e.target.value)} placeholder="1" className="h-9 text-xs" />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">CFOP</Label>
                              <Input value={formData.cfop} onChange={(e) => handleChange('cfop', e.target.value)} placeholder="5102" className="h-9 text-xs" maxLength={4} />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Chave NF-e (44 dígitos)</Label>
                            <Input 
                              value={formData.chave_nfe} 
                              onChange={(e) => handleChange('chave_nfe', e.target.value)} 
                              placeholder="00000000000000000000000000000000000000000000" 
                              maxLength={44}
                              className="font-mono text-xs h-9"
                            />
                          </div>
                        </div>
                      )}

                      {formData.tipo_documento === 'NFC-e' && (
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Número NFC-e *</Label>
                            <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" required className="h-9 text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Série</Label>
                            <Input value={formData.serie_documento} onChange={(e) => handleChange('serie_documento', e.target.value)} placeholder="1" className="h-9 text-xs" />
                          </div>
                        </div>
                      )}

                      {formData.tipo_documento === 'Recibo' && (
                        <div className="space-y-1.5 pt-2 border-t">
                          <Label className="text-xs">Número do Recibo *</Label>
                          <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="0001" required className="h-9 text-xs" />
                        </div>
                      )}

                      {formData.tipo_documento === 'Boleto' && (
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Número do Boleto *</Label>
                            <Input value={formData.numero_boleto} onChange={(e) => handleChange('numero_boleto', e.target.value)} placeholder="000000000000" required className="h-9 text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Banco</Label>
                            <Input value={formData.banco_boleto} onChange={(e) => handleChange('banco_boleto', e.target.value)} placeholder="Ex: Banco do Brasil" className="h-9 text-xs" />
                          </div>
                        </div>
                      )}

                      {formData.tipo_documento === 'Nota Manual' && (
                        <div className="space-y-1.5 pt-2 border-t">
                          <Label className="text-xs">Número da Nota *</Label>
                          <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="0001" required className="h-9 text-xs" />
                        </div>
                      )}

                      {formData.tipo_documento === 'Outros' && (
                        <div className="space-y-1.5 pt-2 border-t">
                          <Label className="text-xs">Número/Identificação *</Label>
                          <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="Identificação" required className="h-9 text-xs" />
                        </div>
                      )}
                      
                      <div className="space-y-1.5 pt-2">
                        <Label className="text-xs">Safra (Opcional)</Label>
                        <Select value={formData.safra_id} onValueChange={(v) => handleChange('safra_id', v)}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                          <SelectContent>
                            {safras.map(s => <SelectItem key={s.id} value={s.id} className="text-xs">{s.ano_inicio}/{s.ano_fim} - {s.descricao}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </CardContent>
                  </Card>

                  {/* CARD: TIPO DE LANÇAMENTO */}
                  <Card className="bg-slate-50 border-slate-200">
                    <CardContent className="p-3">
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          checked={formData.lancar_produtos} 
                          onCheckedChange={(v) => handleChange('lancar_produtos', v)} 
                          id="lancar_produtos" 
                        />
                        <label htmlFor="lancar_produtos" className="font-semibold cursor-pointer text-sm">
                          Lançar Produtos no Estoque
                        </label>
                      </div>
                    </CardContent>
                  </Card>

                  {/* CARD: PRODUTOS */}
                  {formData.lancar_produtos && (
                    <Card className="bg-green-50 border-green-200">
                      <CardHeader className="py-2 px-3">
                        <div className="flex justify-between items-center">
                          <CardTitle className="text-sm">Produtos</CardTitle>
                          <Button type="button" size="sm" onClick={handleAdicionarProduto} className="h-7 gap-1 text-xs">
                            <Plus className="w-3 h-3" />
                            Adicionar
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="p-3 space-y-3">
                        {formData.produtos_selecionados.length > 0 && (
                          <div className="border rounded overflow-auto max-h-72 bg-white">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs w-[200px]">Produto *</TableHead>
                                  <TableHead className="text-xs text-right w-[80px]">Qtd *</TableHead>
                                  <TableHead className="text-xs text-right w-[100px]">Vlr Total *</TableHead>
                                  <TableHead className="text-xs text-right w-[80px]">Desc.</TableHead>
                                  <TableHead className="text-xs text-right w-[100px]">Líquido</TableHead>
                                  <TableHead className="text-xs text-center w-[60px]">Un.</TableHead>
                                  <TableHead className="w-12"></TableHead>
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
                                      <TableCell className="w-[200px]">
                                        <Select 
                                          value={produto.produto_id} 
                                          onValueChange={(v) => handleAtualizarProduto(index, 'produto_id', v)}
                                        >
                                          <SelectTrigger className="h-8 text-xs">
                                            <SelectValue placeholder="Selecione" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {produtos.map(p => (
                                              <SelectItem key={p.id} value={p.id} className="text-xs">
                                                {p.nome_produto}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </TableCell>
                                      <TableCell className="w-[80px]">
                                        <Input
                                          value={produto.quantidade}
                                          onChange={(e) => handleAtualizarProduto(index, 'quantidade', e.target.value)}
                                          placeholder="0,00"
                                          className="text-right h-8 text-xs"
                                        />
                                      </TableCell>
                                      <TableCell className="w-[100px]">
                                        <Input
                                          value={produto.valor_total}
                                          onChange={(e) => handleAtualizarProduto(index, 'valor_total', e.target.value)}
                                          placeholder="0,00"
                                          className="text-right h-8 text-xs"
                                        />
                                      </TableCell>
                                      <TableCell className="w-[80px]">
                                        <Input
                                          value={produto.desconto_item || "0,00"}
                                          onChange={(e) => handleAtualizarProduto(index, 'desconto_item', e.target.value)}
                                          placeholder="0,00"
                                          className="text-right h-8 text-xs"
                                        />
                                      </TableCell>
                                      <TableCell className="text-right w-[100px]">
                                        <div className="font-mono font-bold text-green-700 text-xs">
                                          {formatarMoeda(liquido)}
                                        </div>
                                        <div className="text-[10px] text-slate-500">
                                          Un: {formatarMoeda(unitario)}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-center w-[60px]">
                                        <span className="text-xs font-mono">{produto.unidade || '-'}</span>
                                      </TableCell>
                                      <TableCell className="w-12">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => handleRemoverProduto(index)}
                                          className="h-7 w-7 text-red-600"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        )}

                        <div className="space-y-2 p-2 bg-amber-50 rounded border border-amber-200">
                          <div className="flex items-center space-x-2">
                            <Checkbox 
                              checked={formData.dar_entrada_estoque} 
                              onCheckedChange={(v) => handleChange('dar_entrada_estoque', v)} 
                              id="dar_entrada_estoque" 
                            />
                            <label htmlFor="dar_entrada_estoque" className="font-semibold cursor-pointer text-xs">
                              Dar entrada no estoque?
                            </label>
                          </div>

                          {formData.dar_entrada_estoque && (
                            <div className="space-y-1.5 pt-1">
                              <Label className="text-xs">Local de Estoque *</Label>
                              <div className="flex gap-1.5">
                                <Select value={formData.local_estoque} onValueChange={(v) => handleChange('local_estoque', v)} className="flex-1">
                                  <SelectTrigger className="h-9 text-xs bg-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                                  <SelectContent>
                                    {locais.map(l => <SelectItem key={l.id} value={l.nome} className="text-xs">{l.nome}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogLocal(true)} className="h-9 w-9">
                                  <Plus className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Frete</Label>
                            <Input value={formData.frete} onChange={(e) => handleChange('frete', e.target.value)} placeholder="0,00" className="h-9 text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Outras Desp.</Label>
                            <Input value={formData.outras_despesas} onChange={(e) => handleChange('outras_despesas', e.target.value)} placeholder="0,00" className="h-9 text-xs" />
                          </div>
                        </div>

                        <Card className="bg-white border-emerald-200">
                          <CardContent className="p-3">
                            <div className="space-y-1.5 text-xs">
                              <div className="font-semibold text-slate-700 mb-2">💰 RESUMO FINANCEIRO</div>
                              <div className="flex justify-between text-slate-600">
                                <span>Subtotal Produtos (bruto):</span>
                                <span className="font-mono">{formatarMoeda(subtotalBruto)}</span>
                              </div>
                              <div className="flex justify-between text-red-600">
                                <span>(-) Descontos nos Produtos:</span>
                                <span className="font-mono">{formatarMoeda(totalDescontos)}</span>
                              </div>
                              <div className="flex justify-between text-blue-700 font-semibold border-t pt-1">
                                <span>= Subtotal Produtos (líquido):</span>
                                <span className="font-mono">{formatarMoeda(totalProdutos)}</span>
                              </div>
                              <div className="flex justify-between text-amber-700">
                                <span>(+) Frete:</span>
                                <span className="font-mono">{formatarMoeda(parseNumero(formData.frete))}</span>
                              </div>
                              <div className="flex justify-between text-amber-700">
                                <span>(+) Outras Despesas:</span>
                                <span className="font-mono">{formatarMoeda(parseNumero(formData.outras_despesas))}</span>
                              </div>
                              <div className="pt-2 border-t-2 border-emerald-300 flex justify-between">
                                <span className="text-sm font-bold">= VALOR TOTAL A PAGAR:</span>
                                <span className="text-lg font-bold text-emerald-700">{formatarMoeda(valorTotal)}</span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </CardContent>
                    </Card>
                  )}

                  {/* CARD: VALORES MANUAIS */}
                  {!formData.lancar_produtos && (
                    <Card className="bg-amber-50 border-amber-200">
                      <CardHeader className="py-2 px-3">
                        <CardTitle className="text-sm">Valores</CardTitle>
                      </CardHeader>
                      <CardContent className="p-3 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Valor Original *</Label>
                            <Input value={formData.valor_original} onChange={(e) => handleChange('valor_original', e.target.value)} placeholder="0,00" required className="h-9 text-xs font-semibold" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Juros</Label>
                            <Input value={formData.valor_juros} onChange={(e) => handleChange('valor_juros', e.target.value)} placeholder="0,00" className="h-9 text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Multa</Label>
                            <Input value={formData.valor_multa} onChange={(e) => handleChange('valor_multa', e.target.value)} placeholder="0,00" className="h-9 text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Desconto</Label>
                            <Input value={formData.valor_desconto} onChange={(e) => handleChange('valor_desconto', e.target.value)} placeholder="0,00" className="h-9 text-xs" />
                          </div>
                        </div>

                        <Card className="bg-white border-emerald-200">
                          <CardContent className="p-2">
                            <div className="text-xs text-slate-600">Valor Total:</div>
                            <div className="text-lg font-bold text-emerald-700">{formatarMoeda(valorTotal)}</div>
                          </CardContent>
                        </Card>
                      </CardContent>
                    </Card>
                  )}

                  {/* CARD: VALORES DETALHADOS DA NF-E - SEMPRE VISÍVEL */}
                  <Card className="bg-purple-50 border-purple-200">
                    <CardHeader className="py-2 px-3">
                      <div className="flex justify-between items-center">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <FileText className="w-4 h-4 text-purple-600" />
                          Valores Detalhados da NF-e (Informativo)
                        </CardTitle>
                        <Button 
                          type="button"
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setMostrarCamposNFe(!mostrarCamposNFe)} 
                          className="h-7 gap-1 text-xs"
                        >
                          {mostrarCamposNFe ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          {mostrarCamposNFe ? 'Ocultar' : 'Mostrar'}
                        </Button>
                      </div>
                    </CardHeader>
                    {mostrarCamposNFe && (
                      <CardContent className="p-3 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">📦 Vlr. Produtos</Label>
                            <Input value={formData.valor_produtos || ''} onChange={(e) => handleChange('valor_produtos', e.target.value)} placeholder="0,00" className="h-9 text-xs bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">🚚 Vlr. Frete</Label>
                            <Input value={formData.valor_frete || ''} onChange={(e) => handleChange('valor_frete', e.target.value)} placeholder="0,00" className="h-9 text-xs bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">🛡️ Vlr. Seguro</Label>
                            <Input value={formData.valor_seguro || ''} onChange={(e) => handleChange('valor_seguro', e.target.value)} placeholder="0,00" className="h-9 text-xs bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">💼 Outras Despesas</Label>
                            <Input value={formData.valor_outras_despesas || ''} onChange={(e) => handleChange('valor_outras_despesas', e.target.value)} placeholder="0,00" className="h-9 text-xs bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">💸 Desconto Total</Label>
                            <Input value={formData.valor_desconto_total || ''} onChange={(e) => handleChange('valor_desconto_total', e.target.value)} placeholder="0,00" className="h-9 text-xs bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">📋 Vlr. IPI</Label>
                            <Input value={formData.valor_ipi || ''} onChange={(e) => handleChange('valor_ipi', e.target.value)} placeholder="0,00" className="h-9 text-xs bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">💵 Vlr. ICMS</Label>
                            <Input value={formData.valor_icms || ''} onChange={(e) => handleChange('valor_icms', e.target.value)} placeholder="0,00" className="h-9 text-xs bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">📊 Vlr. PIS</Label>
                            <Input value={formData.valor_pis || ''} onChange={(e) => handleChange('valor_pis', e.target.value)} placeholder="0,00" className="h-9 text-xs bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">📈 Vlr. COFINS</Label>
                            <Input value={formData.valor_cofins || ''} onChange={(e) => handleChange('valor_cofins', e.target.value)} placeholder="0,00" className="h-9 text-xs bg-white" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">🧮 Base Cálc. ICMS</Label>
                            <Input value={formData.base_calculo_icms || ''} onChange={(e) => handleChange('base_calculo_icms', e.target.value)} placeholder="0,00" className="h-9 text-xs bg-white" />
                          </div>
                        </div>
                        
                        <div className="space-y-1.5 pt-2 border-t border-purple-300">
                          <Label className="text-xs font-semibold">📄 Observações Completas da NF-e</Label>
                          <Textarea 
                            value={formData.observacoes_nfe || ''} 
                            onChange={(e) => handleChange('observacoes_nfe', e.target.value)} 
                            className="text-xs min-h-32 bg-white" 
                            placeholder="Observações extraídas da NF-e..." // Added placeholder
                            rows={6} 
                          />
                          <p className="text-xs text-purple-700 font-medium">✅ Informações extraídas da nota: vendedor, contatos, instruções, etc</p>
                        </div>
                      </CardContent>
                    )}
                  </Card>

                  {/* CARD: ANEXOS */}
                  <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Paperclip className="w-4 h-4" />
                        Anexar Documentos
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 space-y-2">
                      <Input
                        type="file"
                        onChange={handleUploadAnexo}
                        disabled={uploadingFile}
                        accept=".pdf,.xml,.jpg,.jpeg,.png"
                        className="h-9 text-xs"
                      />
                      
                      {formData.anexos.length > 0 && (
                        <div className="space-y-1">
                          {formData.anexos.map((anexo, index) => (
                            <div key={index} className="flex items-center justify-between p-2 bg-white rounded border text-xs">
                              <div className="flex items-center gap-2">
                                <FileText className="w-3 h-3 text-slate-400" />
                                <span className="font-medium">{anexo.nome}</span>
                                <span className="text-slate-500">({(anexo.tamanho / 1024).toFixed(0)} KB)</span>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoverAnexo(index)}
                                className="h-6 w-6 text-red-600"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <div className="flex justify-end gap-3 pt-4 border-t">
                    <Button type="button" variant="outline" onClick={onCancel} className="gap-2 h-9 text-xs">
                      <X className="w-3 h-3" />
                      Cancelar
                    </Button>
                    <Button type="button" onClick={handleProximaEtapa} className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg h-9 text-xs">
                      Próximo
                      <ChevronRight className="w-3 h-3" />
                    </Button>
                  </div>
                </>
              )}

              {/* ETAPA 2: DADOS FINANCEIROS */}
              {etapa === 2 && (
                <>
                  {/* CARD: CLASSIFICAÇÃO */}
                  <Card className="bg-blue-50 border-blue-200">
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-sm">Classificação Financeira</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="flex items-center gap-1 text-xs">Plano de Contas <span className="text-red-600">*</span></Label>
                          <Select value={formData.plano_contas_id} onValueChange={(v) => handleChange('plano_contas_id', v)}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                            <SelectContent>
                              {planos.map(p => <SelectItem key={p.id} value={p.id} className="text-xs">{p.codigo} - {p.descricao}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="flex items-center gap-1 text-xs">Grupo Financeiro <span className="text-red-600">*</span></Label>
                          <Select value={formData.grupo_id} onValueChange={(v) => handleChange('grupo_id', v)}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                            <SelectContent>
                              {grupos.map(g => <SelectItem key={g.id} value={g.id} className="text-xs">{g.codigo} - {g.descricao}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Centro de Custo (Opcional)</Label>
                        <div className="flex gap-1.5">
                          <Select value={formData.centro_custo_id} onValueChange={(v) => handleChange('centro_custo_id', v)} className="flex-1">
                            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Opcional" /></SelectTrigger>
                            <SelectContent>
                              {centros.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogCentro(true)} className="h-9 w-9">
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* CARD: PAGAMENTO - ORDEM PADRONIZADA COM CAMPOS OCULTOS */}
                  <Card className="bg-green-50 border-green-200">
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-sm">Condições de Pagamento</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 space-y-3">
                      {/* CHECKBOXES PRIMEIRO */}
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2">
                          <Checkbox checked={formData.parcelar} onCheckedChange={(v) => handleChange('parcelar', v)} id="parcelar" />
                          <label htmlFor="parcelar" className="font-semibold cursor-pointer text-sm">Parcelar lançamento</label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox checked={formData.conta_paga} onCheckedChange={(v) => handleChange('conta_paga', v)} id="conta_paga" />
                          <label htmlFor="conta_paga" className="font-semibold cursor-pointer text-sm">
                            Conta já está paga?
                          </label>
                        </div>
                      </div>

                      {/* CAMPOS PADRÃO (sempre visível se não marcar nenhuma) */}
                      {!formData.parcelar && !formData.conta_paga && (
                        <>
                          <div className="space-y-1.5 pt-2">
                            <Label className="flex items-center gap-1 text-xs">Data de Vencimento <span className="text-red-600">*</span></Label>
                            <Input type="date" value={formData.data_vencimento} onChange={(e) => handleChange('data_vencimento', e.target.value)} required className="h-9 text-xs" />
                          </div>

                          <div className="space-y-1.5">
                            <Label className="text-xs">Forma de Pagamento</Label>
                            <Select value={formData.forma_pagamento_id} onValueChange={(v) => handleChange('forma_pagamento_id', v)}>
                              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Opcional" /></SelectTrigger>
                              <SelectContent>
                                {FORMAS_PAGAMENTO_PADRAO.map(forma => (
                                  <SelectItem key={forma} value={forma} className="text-xs">{forma}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}

                      {/* PARCELAMENTO - SÓ SE MARCAR */}
                      {formData.parcelar && (
                        <Card className="bg-white border-amber-200 mt-3">
                          <CardContent className="p-3 space-y-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Forma de Pagamento</Label>
                              <Select value={formData.forma_pagamento_id} onValueChange={(v) => handleChange('forma_pagamento_id', v)}>
                                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Opcional" /></SelectTrigger>
                                <SelectContent>
                                  {FORMAS_PAGAMENTO_PADRAO.map(forma => (
                                    <SelectItem key={forma} value={forma} className="text-xs">{forma}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex justify-between items-center pt-2 border-t">
                              <Label className="text-xs">Parcelas ({formData.parcelas.length})</Label>
                              <Button type="button" size="sm" onClick={adicionarParcela} className="h-7 gap-1 text-xs">
                                <Plus className="w-3 h-3" />
                                Adicionar
                              </Button>
                            </div>

                            <div className="border rounded max-h-60 overflow-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-12 text-xs">Nº</TableHead>
                                    <TableHead className="text-xs">Vencimento *</TableHead>
                                    <TableHead className="text-right text-xs">Valor *</TableHead>
                                    <TableHead className="w-12"></TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {formData.parcelas.map((parcela, index) => (
                                    <TableRow key={index}>
                                      <TableCell className="font-bold text-xs">{index + 1}</TableCell>
                                      <TableCell>
                                        <Input type="date" value={parcela.data} onChange={(e) => atualizarParcela(index, 'data', e.target.value)} className="h-8 text-xs" />
                                      </TableCell>
                                      <TableCell>
                                        <Input value={parcela.valor} onChange={(e) => atualizarParcela(index, 'valor', e.target.value)} placeholder="0,00" className="text-right h-8 text-xs" />
                                      </TableCell>
                                      <TableCell>
                                        <Button type="button" variant="ghost" size="icon" onClick={() => removerParcela(index)} disabled={formData.parcelas.length <= 1} className="h-7 w-7">
                                          <Trash2 className="w-3 h-3" />
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>

                            <Card className={`${Math.abs(totalParcelas - valorTotal) > 0.01 ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}`}>
                              <CardContent className="p-2">
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div className="flex justify-between">
                                    <span>Total Parcelas:</span>
                                    <span className="font-bold">{formatarMoeda(totalParcelas)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Valor Total:</span>
                                    <span className="font-bold">{formatarMoeda(valorTotal)}</span>
                                  </div>
                                </div>
                                {Math.abs(totalParcelas - valorTotal) > 0.01 && (
                                  <p className="text-xs text-red-600 mt-1 text-center">⚠️ Valores diferentes!</p>
                                )}
                              </CardContent>
                            </Card>
                          </CardContent>
                        </Card>
                      )}

                      {/* CONTA PAGA - SÓ SE MARCAR */}
                      {formData.conta_paga && (
                        <Card className="bg-white border-green-300 mt-3">
                          <CardContent className="p-3 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label className="text-xs">Data Pgto *</Label>
                                <Input type="date" value={formData.data_pagamento} onChange={(e) => handleChange('data_pagamento', e.target.value)} required className="h-9 text-xs" />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs">Valor Pago *</Label>
                                <Input value={formData.valor_pago_total} onChange={(e) => handleChange('valor_pago_total', e.target.value)} placeholder="0,00" required className="h-9 text-xs" />
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Forma de Pagamento *</Label>
                              <Select value={formData.forma_pagamento_paga_id} onValueChange={(v) => handleChange('forma_pagamento_paga_id', v)}>
                                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                                <SelectContent>
                                  {FORMAS_PAGAMENTO_PADRAO.map(forma => (
                                    <SelectItem key={forma} value={forma} className="text-xs">{forma}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </CardContent>
                  </Card>

                  {/* CARD: OBSERVAÇÕES */}
                  <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-sm">Observações Personalizadas</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3">
                      <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="OBSERVAÇÕES ADICIONAIS..." className="uppercase text-xs" style={{ textTransform: 'uppercase' }} rows={3} />
                      <p className="text-xs text-slate-500 mt-1">Campo para suas anotações pessoais (não confundir com observações da NF-e)</p>
                    </CardContent>
                  </Card>

                  <div className="flex justify-between gap-3 pt-4 border-t">
                    <Button type="button" variant="outline" onClick={() => setEtapa(1)} className="gap-2 h-9 text-xs">
                      <ChevronLeft className="w-3 h-3" />
                      Voltar
                    </Button>
                    <div className="flex gap-3">
                      <Button type="button" variant="outline" onClick={onCancel} className="gap-2 h-9 text-xs">
                        <X className="w-3 h-3" />
                        Cancelar
                      </Button>
                      <Button 
                        type="submit" 
                        className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg h-9 text-xs"
                        disabled={!formData.conta_paga && formData.parcelar && Math.abs(totalParcelas - valorTotal) > 0.01}
                      >
                        <Save className="w-3 h-3" />
                        Salvar
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
    </>
  );
}
