import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ArrowRightLeft, Save, X, Plus, Trash2, MoreVertical, Link2, Package, MapPin, Truck, Pencil } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger } from
"@/components/ui/dropdown-menu";
import DialogCadastroRapido from "../financeiro/DialogCadastroRapido.jsx";

import AutocompleteGenerico from "../financeiro/AutocompleteGenerico.jsx";

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

const TIPOS_DETALHADOS = {
  'Entrada': ['Compra', 'Compra à Vista', 'Compra a Prazo', 'Devolução de Cliente', 'Doação Recebida', 'Bonificação', 'Produção', 'Importação', 'Transferência Recebida', 'Acerto de Estoque', 'Outros'],
  'Saída': ['Venda', 'Venda à Vista', 'Venda a Prazo', 'Devolução ao Fornecedor', 'Doação', 'Perda', 'Quebra', 'Consumo Interno', 'Produção', 'Transferência Enviada', 'Acerto de Estoque', 'Suplementação', 'Aplicação em Área', 'Manutenção de Máquina', 'Outros'],
  'Transferência': ['Entre Locais', 'Entre Empresas', 'Entre Filiais', 'Outros'],
  'Ajuste': ['Ajuste Positivo', 'Ajuste Negativo', 'Inventário', 'Correção', 'Outros']
};

export default function FormularioMovimentacao({ onSubmit, onCancel, initialData = null, produtos, fornecedores }) {
  const [formData, setFormData] = useState(() => {
    let produtosSelecionados = initialData?.produtos_selecionados || [];

    if (initialData?.produto_id && produtosSelecionados.length === 0) {
      produtosSelecionados = [{
        produto_id: initialData.produto_id,
        produto_nome: initialData.produto_nome || '',
        quantidade: String(initialData.quantidade || '').replace('.', ','),
        valor_total: String(initialData.valor_total || '').replace('.', ','),
        desconto_item: '0,00',
        unidade: initialData.unidade_medida || ''
      }];
    }

    return {
      tipo_movimentacao: initialData?.tipo_movimentacao || "",
      tipo_detalhado: initialData?.tipo_detalhado || "",
      data_movimentacao: initialData?.data_movimentacao ? (initialData.data_movimentacao.split('T')[0]) : new Date().toISOString().slice(0,10),
      local_estoque_origem_id: initialData?.local_estoque_origem_id || "",
      local_estoque_destino_id: initialData?.local_estoque_destino_id || "",
      empresa_destino_id: initialData?.empresa_destino_id || "",
      tipo_documento: initialData?.tipo_documento || "Nota Fiscal",
      numero_documento: initialData?.numero_documento || "",
      serie_documento: initialData?.serie_documento || "",
      chave_documento: initialData?.chave_documento || "",
      data_documento: initialData?.data_documento || "",
      cfop: initialData?.cfop || "",
      natureza_operacao: initialData?.natureza_operacao || "",
      fornecedor_id: initialData?.fornecedor_id || "",
      cliente_nome: initialData?.cliente_nome || "",
      centro_custo_id: initialData?.centro_custo_id || "",
      motivo_movimentacao: initialData?.motivo_movimentacao || "",
      observacoes: initialData?.observacoes || "",
      produtos_selecionados: produtosSelecionados,
      // Campos de vínculo
      vinculado: initialData?.vinculado || false,
      tipo_vinculo: initialData?.tipo_vinculo || "",
      lote_vinculado_id: initialData?.lote_vinculado_id || "",
      area_vinculada_id: initialData?.area_vinculada_id || "",
      maquina_vinculada_id: initialData?.maquina_vinculada_id || ""
    };
  });

  const [showDialogLocal, setShowDialogLocal] = useState(false);
  const [showDialogCentro, setShowDialogCentro] = useState(false);
  const [showDialogProduto, setShowDialogProduto] = useState(false);
  
  

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: locais = [] } = useQuery({
    queryKey: ['locais_mov'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: []
  });

  const { data: centros = [] } = useQuery({
    queryKey: ['centros_mov', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter((c) => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresas_mov'],
    queryFn: () => base44.entities.Empresa.list(),
    initialData: []
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes_mov', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((l) => l.empresa_id === empresaSelecionadaId && l.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas_mov', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((a) => a.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: maquinas = [] } = useQuery({
    queryKey: ['maquinas_mov', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Maquina.list();
      return all.filter((m) => m.empresa_id === empresaSelecionadaId && m.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: movimentacoesEstoque = [] } = useQuery({
    queryKey: ['movimentacoes_estoque_form', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list();
      return all.filter((m) => m.empresa_id === empresaSelecionadaId && m.status === 'Ativa');
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: locaisEmpresaDestino = [] } = useQuery({
    queryKey: ['locais_empresa_destino', formData.empresa_destino_id],
    queryFn: () => base44.entities.LocalEstoque.list(),
    enabled: !!formData.empresa_destino_id,
    initialData: []
  });

  // Ajuste de IDs a partir de nomes ao carregar edição antiga
  useEffect(() => {
     if (!initialData) return;
     // origem
     if (!formData.local_estoque_origem_id && initialData.local_estoque_origem && locais.length) {
       const local = locais.find(l => l.nome === initialData.local_estoque_origem);
       if (local) setFormData(prev => ({ ...prev, local_estoque_origem_id: local.id }));
     }
     // destino
     if (!formData.local_estoque_destino_id && initialData.local_estoque_destino && locais.length) {
       const local = locais.find(l => l.nome === initialData.local_estoque_destino);
       if (local) setFormData(prev => ({ ...prev, local_estoque_destino_id: local.id }));
     }
     // data
     if (initialData.data_movimentacao && !formData.data_movimentacao) {
       try {
         setFormData(prev => ({ ...prev, data_movimentacao: initialData.data_movimentacao.split('T')[0] }));
       } catch {}
     }
   }, [initialData, locais]);

   // Calcular estoque por local
  const estoquePorLocal = useMemo(() => {
    const estoques = {};

    produtos.forEach((produto) => {
      if (!estoques[produto.id]) {
        estoques[produto.id] = {};
      }
    });

    movimentacoesEstoque.forEach((mov) => {
      if (!mov.produto_id) return;

      if (!estoques[mov.produto_id]) {
        estoques[mov.produto_id] = {};
      }

      const origemId = mov.local_estoque_origem_id || locais.find(l => l.nome === mov.local_estoque_origem)?.id;
      const destinoId = mov.local_estoque_destino_id || locais.find(l => l.nome === mov.local_estoque_destino)?.id;
      const qtd = mov.quantidade || 0;

      if (mov.tipo_movimentacao === 'Entrada' && destinoId) {
        if (!estoques[mov.produto_id][destinoId]) estoques[mov.produto_id][destinoId] = 0;
        estoques[mov.produto_id][destinoId] += qtd;
      } else if (mov.tipo_movimentacao === 'Saída' && origemId) {
        if (!estoques[mov.produto_id][origemId]) estoques[mov.produto_id][origemId] = 0;
        estoques[mov.produto_id][origemId] -= qtd;
      } else if (mov.tipo_movimentacao === 'Transferência') {
        if (origemId) {
          if (!estoques[mov.produto_id][origemId]) estoques[mov.produto_id][origemId] = 0;
          estoques[mov.produto_id][origemId] -= qtd;
        }
        if (destinoId) {
          if (!estoques[mov.produto_id][destinoId]) estoques[mov.produto_id][destinoId] = 0;
          estoques[mov.produto_id][destinoId] += qtd;
        }
      } else if (mov.tipo_movimentacao === 'Ajuste') {
        const localId = destinoId || origemId;
        if (localId) {
          if (!estoques[mov.produto_id][localId]) estoques[mov.produto_id][localId] = 0;
          if (mov.tipo_detalhado?.toUpperCase().includes('POSITIVO')) {
            estoques[mov.produto_id][localId] += qtd;
          } else {
            estoques[mov.produto_id][localId] -= qtd;
          }
        }
      }
    });

    return estoques;
  }, [produtos, movimentacoesEstoque, locais]);

  // Produtos disponíveis no local selecionado (para saída)
  const produtosComEstoqueNoLocal = useMemo(() => {
    const filtraPorLocal = formData.tipo_movimentacao === 'Saída' || formData.tipo_movimentacao === 'Transferência';
    if (!formData.local_estoque_origem_id || !filtraPorLocal) {
      return produtos;
    }

    return produtos
      .map((produto) => {
        const estoqueNoLocal = estoquePorLocal[produto.id]?.[formData.local_estoque_origem_id] || 0;
        return {
          ...produto,
          estoque_no_local: estoqueNoLocal,
          nome_com_estoque: `${produto.nome_produto} (${estoqueNoLocal.toFixed(2)} ${produto.unidade_medida || 'UN'})`
        };
      })
      .filter((p) => p.estoque_no_local > 0);
  }, [produtos, formData.local_estoque_origem_id, formData.tipo_movimentacao, estoquePorLocal]);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleAdicionarProduto = () => {
    setFormData((prev) => ({
      ...prev,
      produtos_selecionados: [...prev.produtos_selecionados, { produto_id: "", produto_nome: "", quantidade: "", valor_total: "", desconto_item: "0,00" }]
    }));
  };

  const handleRemoverProduto = (index) => {
    setFormData((prev) => ({
      ...prev,
      produtos_selecionados: prev.produtos_selecionados.filter((_, i) => i !== index)
    }));
  };

  const handleAtualizarProduto = (index, campo, valor) => {
    setFormData((prev) => ({
      ...prev,
      produtos_selecionados: prev.produtos_selecionados.map((p, i) => {
        if (i === index) {
          const updated = { ...p, [campo]: valor };

          if (campo === 'produto_id') {
            const produto = produtos.find((prod) => prod.id === valor);
            if (produto) {
              updated.produto_nome = produto.nome_produto;
              updated.unidade = produto.unidade_medida;
              updated.preco_custo = produto.preco_custo || 0;
              updated.preco_venda = produto.preco_venda || 0;
              updated.estoque_no_local = estoquePorLocal[valor]?.[formData.local_estoque_origem_id] || 0;

              // Para saídas, preencher automaticamente o valor baseado no custo
              if (formData.tipo_movimentacao === 'Saída' && produto.preco_custo) {








                // Não preencher valor automático por enquanto, deixar usuário definir
              }}} // Calcular valor total baseado na quantidade
          if (campo === 'quantidade') {
            const qtd = parseNumero(valor);
            if (formData.tipo_movimentacao === 'Transferência') {
              updated.valor_total = formatarNumero(qtd * (updated.preco_custo || 0));
            } else if (formData.tipo_movimentacao === 'Saída') {
              const det = (formData.tipo_detalhado || '').toLowerCase();
              if (det.includes('venda') && (updated.preco_venda || 0) > 0) {
                updated.valor_total = formatarNumero(qtd * updated.preco_venda);
              } else if (det.includes('consumo') || det.includes('suplementa') || det.includes('aplica') || det.includes('manuten')) {
                updated.valor_total = formatarNumero(qtd * (updated.preco_custo || 0));
              }
            } else if (formData.tipo_movimentacao === 'Ajuste') {
              // livre
            }
          }
          return updated;
        }
        return p;
      })
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.tipo_movimentacao) {
      toast.error('❌ O campo Tipo de Movimentação é obrigatório!');
      return;
    }

    if (!formData.tipo_detalhado) {
      toast.error('❌ O campo Tipo Detalhado é obrigatório!');
      return;
    }

    if (formData.produtos_selecionados.length === 0) {
      toast.error('❌ Adicione pelo menos um produto!');
      return;
    }

    if (formData.tipo_movimentacao === 'Ajuste' && !formData.motivo_movimentacao) {
      toast.error('❌ Informe o motivo do ajuste!');
      return;
    }

    const produtosIncompletos = formData.produtos_selecionados.filter((p) =>
    !p.produto_id || parseNumero(p.quantidade) <= 0
    );
    if (produtosIncompletos.length > 0) {
      toast.error('❌ Preencha todos os campos dos produtos (produto e quantidade)!');
      return;
    }

    // Validar estoque para saídas
    if (formData.tipo_movimentacao === 'Saída') {
      for (const prod of formData.produtos_selecionados) {
        const estoqueDisponivel = estoquePorLocal[prod.produto_id]?.[formData.local_estoque_origem_id] || 0;
        const qtdSaida = parseNumero(prod.quantidade);
        if (qtdSaida > estoqueDisponivel) {
          toast.error(`❌ Estoque insuficiente de ${prod.produto_nome}. Disponível: ${estoqueDisponivel.toFixed(2)}`);
          return;
        }
      }
    }

    if (formData.tipo_movimentacao === 'Entrada' && !formData.local_estoque_destino_id) {
      toast.error('❌ Selecione o local de estoque de destino!');
      return;
    }
    if (formData.tipo_movimentacao === 'Saída' && !formData.local_estoque_origem_id) {
      toast.error('❌ Selecione o local de estoque de origem!');
      return;
    }

    if (formData.tipo_movimentacao === 'Transferência' && (!formData.local_estoque_origem_id || !formData.local_estoque_destino_id)) {
      toast.error('❌ Defina local de origem e destino para transferência!');
      return;
    }

    if (formData.tipo_movimentacao === 'Transferência' && formData.tipo_detalhado === 'Entre Empresas' && !formData.empresa_destino_id) {
      toast.error('❌ Selecione a empresa de destino!');
      return;
    }

    if (formData.tipo_movimentacao === 'Entrada' && !formData.fornecedor_id) {
      toast.error('❌ O campo Fornecedor é obrigatório!');
      return;
    }

    // Regras de vínculo obrigatório (Saída com consumo/aplicação/manutenção/suplementação)
  if (formData.tipo_movimentacao === 'Saída') {
    const det = (formData.tipo_detalhado || '').toLowerCase();
    const obrigatorio = det.includes('consumo') || det.includes('suplementa') || det.includes('aplica') || det.includes('manuten');
    if (obrigatorio && !formData.vinculado) {
      toast.error('❌ Para este tipo de saída, é obrigatório informar um vínculo (lote, área, máquina, etc).');
      return;
    }
  }

  // Validar vínculo
    if (formData.vinculado && !formData.tipo_vinculo) {
      toast.error('❌ Selecione o tipo de vínculo!');
      return;
    }

    if (formData.vinculado) {
      if (formData.tipo_vinculo === 'lote' && !formData.lote_vinculado_id) {
        toast.error('❌ Selecione o lote vinculado!');
        return;
      }
      if (formData.tipo_vinculo === 'area' && !formData.area_vinculada_id) {
        toast.error('❌ Selecione a área vinculada!');
        return;
      }
      if (formData.tipo_vinculo === 'maquina' && !formData.maquina_vinculada_id) {
        toast.error('❌ Selecione a máquina vinculada!');
        return;
      }
    }

    const centro = centros.find((c) => c.id === formData.centro_custo_id);
    const fornecedor = fornecedores.find((f) => f.id === formData.fornecedor_id);
    const empresaDestino = empresas.find((e) => e.id === formData.empresa_destino_id);
    const loteVinculado = lotes.find((l) => l.id === formData.lote_vinculado_id);
    const areaVinculada = areas.find((a) => a.id === formData.area_vinculada_id);
    const maquinaVinculada = maquinas.find((m) => m.id === formData.maquina_vinculada_id);

    const produtosProcessados = (formData.produtos_selecionados || []).map((p) => {
      const qtd = parseNumero(p.quantidade);
      const totalGross = parseNumero(p.valor_total);
      const desconto = parseNumero(p.desconto_item || "0");
      const valorLiquido = totalGross - desconto;
      const valorUnitario = qtd > 0 ? valorLiquido / qtd : 0;

      return {
         produto_id: p.produto_id,
         produto_nome: p.produto_nome,
         produto_codigo: p.produto_codigo,
         unidade_medida: p.unidade,
         quantidade: qtd,
         valor_unitario: valorUnitario,
         desconto: desconto,
         valor_total: valorLiquido,
         observacao_item: p.observacao_item || undefined
       };
    });

    const dadosComuns = {
      tipo_movimentacao: formData.tipo_movimentacao,
      tipo_detalhado: formData.tipo_detalhado,
      local_estoque_origem_id: (formData.tipo_movimentacao === 'Saída' || formData.tipo_movimentacao === 'Transferência' || (formData.tipo_movimentacao === 'Ajuste' && !(formData.tipo_detalhado || '').toUpperCase().includes('POSITIVO'))) ? formData.local_estoque_origem_id : undefined,
      local_estoque_origem_nome: (formData.tipo_movimentacao === 'Saída' || formData.tipo_movimentacao === 'Transferência' || (formData.tipo_movimentacao === 'Ajuste' && !(formData.tipo_detalhado || '').toUpperCase().includes('POSITIVO'))) ? (locais.find(l => l.id === formData.local_estoque_origem_id)?.nome) : undefined,
      local_estoque_destino_id: (formData.tipo_movimentacao === 'Entrada' || formData.tipo_movimentacao === 'Transferência' || (formData.tipo_movimentacao === 'Ajuste' && (formData.tipo_detalhado || '').toUpperCase().includes('POSITIVO'))) ? formData.local_estoque_destino_id : undefined,
      local_estoque_destino_nome: (formData.tipo_movimentacao === 'Entrada' || formData.tipo_movimentacao === 'Transferência' || (formData.tipo_movimentacao === 'Ajuste' && (formData.tipo_detalhado || '').toUpperCase().includes('POSITIVO'))) ? (locais.find(l => l.id === formData.local_estoque_destino_id)?.nome) : undefined,
      empresa_destino_id: formData.tipo_detalhado === 'Entre Empresas' ? formData.empresa_destino_id : undefined,
      empresa_destino_nome: empresaDestino?.nome,
      tipo_documento: formData.tipo_documento || undefined,
      numero_documento: formData.numero_documento || undefined,
      serie_documento: formData.serie_documento || undefined,
      chave_documento: formData.chave_documento || undefined,
      data_documento: formData.data_documento || undefined,
      cfop: formData.cfop || undefined,
      natureza_operacao: formData.natureza_operacao || undefined,
      fornecedor_id: formData.fornecedor_id || undefined,
      fornecedor_nome: fornecedor?.nome,
      cliente_nome: formData.cliente_nome || undefined,
      centro_custo_id: formData.centro_custo_id || undefined,
      centro_custo_nome: centro?.nome,
      motivo_movimentacao: formData.motivo_movimentacao,
      observacoes: formData.observacoes || undefined,
      data_movimentacao: formData.data_movimentacao ? new Date(formData.data_movimentacao).toISOString() : new Date().toISOString(),
      status: 'Ativa',
      // Dados de vínculo
      vinculado: formData.vinculado,
      tipo_vinculo: formData.vinculado ? formData.tipo_vinculo : undefined,
      lote_vinculado_id: formData.tipo_vinculo === 'lote' ? formData.lote_vinculado_id : undefined,
      lote_vinculado_nome: loteVinculado?.identificacao || loteVinculado?.nome,
      area_vinculada_id: formData.tipo_vinculo === 'area' ? formData.area_vinculada_id : undefined,
      area_vinculada_nome: areaVinculada?.nome,
      maquina_vinculada_id: formData.tipo_vinculo === 'maquina' ? formData.maquina_vinculada_id : undefined,
      maquina_vinculada_nome: maquinaVinculada?.nome || maquinaVinculada?.identificacao
    };

    onSubmit({ ...dadosComuns, produtos: produtosProcessados });
  };

  const tiposDetalhadosDisponiveis = TIPOS_DETALHADOS[formData.tipo_movimentacao] || [];
  const mostrarFornecedor = formData.tipo_movimentacao === 'Entrada';
  const mostrarCliente = formData.tipo_movimentacao === 'Saída' && ['Venda', 'Venda à Vista', 'Venda a Prazo'].some((t) => formData.tipo_detalhado.includes(t));
  const mostrarDadosNFe = formData.tipo_movimentacao === 'Entrada' && ['Compra', 'Compra à Vista', 'Compra a Prazo', 'Importação'].some((t) => formData.tipo_detalhado.includes(t)) ||
  formData.tipo_movimentacao === 'Saída' && ['Venda', 'Venda à Vista', 'Venda a Prazo'].some((t) => formData.tipo_detalhado.includes(t));
  const mostrarLocalDestino = formData.tipo_movimentacao === 'Transferência';
  const mostrarEmpresaDestino = formData.tipo_movimentacao === 'Transferência' && formData.tipo_detalhado === 'Entre Empresas';
  const mostrarVinculo = formData.tipo_movimentacao === 'Saída';

  const totalProdutosLiquido = formData.produtos_selecionados.reduce((sum, p) => {
     const total = parseNumero(p.valor_total || "0");
     const desc = parseNumero(p.desconto_item || "0");
     return sum + (total - desc);
   }, 0);

   const canAddProduto = React.useMemo(() => {
     if (formData.tipo_movimentacao === 'Entrada') return !!formData.local_estoque_destino_id;
     if (formData.tipo_movimentacao === 'Saída') return !!formData.local_estoque_origem_id;
     if (formData.tipo_movimentacao === 'Transferência') return !!formData.local_estoque_origem_id && !!formData.local_estoque_destino_id;
     if (formData.tipo_movimentacao === 'Ajuste') return !!(formData.local_estoque_origem_id || formData.local_estoque_destino_id);
     return false;
   }, [formData.tipo_movimentacao, formData.local_estoque_origem_id, formData.local_estoque_destino_id]);

   const isPrecoTravado = React.useMemo(() => {
     if (formData.tipo_movimentacao === 'Transferência') return true;
     if (formData.tipo_movimentacao === 'Saída') {
       const det = (formData.tipo_detalhado || '').toLowerCase();
       if (det.includes('consumo') || det.includes('suplementa') || det.includes('aplica') || det.includes('manuten')) return true;
     }
     return false;
   }, [formData.tipo_movimentacao, formData.tipo_detalhado]);

  return (
    <>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
        <Card className="shadow-sm border-slate-300 bg-white max-w-5xl mx-auto">
          <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
            <CardTitle className="text-sm font-semibold text-slate-900">
              {initialData?.id ? 'Editar Movimentação' : 'Nova Movimentação de Estoque'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo de Movimentação *</Label>
                  <Select value={formData.tipo_movimentacao} onValueChange={(v) => {handleChange('tipo_movimentacao', v);handleChange('tipo_detalhado', '');handleChange('vinculado', false);handleChange('tipo_vinculo', ''); if (v === 'Entrada') { handleChange('local_estoque_origem_id', ''); } else if (v === 'Saída') { handleChange('local_estoque_destino_id', ''); }}} required>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Entrada" className="text-xs">Entrada</SelectItem>
                      <SelectItem value="Saída" className="text-xs">Saída</SelectItem>
                      <SelectItem value="Transferência" className="text-xs">Transferência</SelectItem>
                      <SelectItem value="Ajuste" className="text-xs">Ajuste</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Tipo Detalhado *</Label>
                  <Select value={formData.tipo_detalhado} onValueChange={(v) => handleChange('tipo_detalhado', v)} required disabled={!formData.tipo_movimentacao}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione o tipo acima" />
                    </SelectTrigger>
                    <SelectContent>
                      {tiposDetalhadosDisponiveis.map((tipo) =>
                      <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Data da Movimentação</Label>
                  <Input type="date" value={formData.data_movimentacao} onChange={(e) => handleChange('data_movimentacao', e.target.value)} className="h-8 text-xs" />
                </div>

                 <div className="space-y-1">
                  <Label className="text-xs">Centro de Custo</Label>
                  <div className="flex gap-2">
                    <AutocompleteGenerico
                      items={centros}
                      value={formData.centro_custo_id}
                      onChange={(v) => handleChange('centro_custo_id', v)}
                      placeholder="Selecione o centro de custo"
                      displayField="nome"
                      searchFields={["nome", "codigo"]}
                      className="flex-1" />

                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogCentro(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">
                    {formData.tipo_movimentacao === 'Entrada' ? 'Local Estoque Destino *' :
                    formData.tipo_movimentacao === 'Saída' ? 'Local Estoque Origem *' :
                    'Local Estoque Origem *'}
                  </Label>
                  <div className="flex gap-2">
                    <AutocompleteGenerico
                      items={locais}
                      value={formData.tipo_movimentacao === 'Entrada' ? (formData.local_estoque_destino_id || "") : (formData.local_estoque_origem_id || "")}
                      onChange={(id) => {
                        if (formData.tipo_movimentacao === 'Entrada') {
                          handleChange('local_estoque_destino_id', id);
                        } else if (formData.tipo_movimentacao === 'Ajuste') {
                          handleChange('local_estoque_origem_id', id);
                          handleChange('local_estoque_destino_id', id);
                        } else {
                          handleChange('local_estoque_origem_id', id);
                          // Limpar produtos selecionados ao mudar o local de origem em Saída
                          if (formData.tipo_movimentacao === 'Saída') {
                            handleChange('produtos_selecionados', []);
                          }
                        }
                      }}
                      placeholder="Selecione o local"
                      displayField="nome"
                      searchFields={["nome", "descricao"]}
                      className="flex-1" />

                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogLocal(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {mostrarLocalDestino && !mostrarEmpresaDestino &&
                <div className="space-y-1">
                    <Label className="text-xs">Local Estoque Destino *</Label>
                    <div className="flex gap-2">
                      <AutocompleteGenerico
                      items={locais}
                      value={formData.local_estoque_destino_id || ""}
                      onChange={(id) => {
                        handleChange('local_estoque_destino_id', id);
                      }}
                      placeholder="Selecione o local"
                      displayField="nome"
                      searchFields={["nome", "descricao"]}
                      className="flex-1" />

                      <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogLocal(true)} className="h-8 w-8">
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                }

                {mostrarEmpresaDestino &&
                <>
                    <div className="space-y-1">
                      <Label className="text-xs">Empresa Destino *</Label>
                      <AutocompleteGenerico
                      items={empresas}
                      value={formData.empresa_destino_id}
                      onChange={(v) => {handleChange('empresa_destino_id', v);handleChange('local_destino', '');}}
                      placeholder="Selecione a empresa"
                      displayField="apelido"
                      searchFields={["apelido", "nome"]}
                      renderSubtext={(item) => item.nome} />

                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Local na Empresa Destino *</Label>
                      <div className="flex gap-2">
                        <AutocompleteGenerico
                        items={locaisEmpresaDestino}
                        value={locaisEmpresaDestino.find((l) => l.nome === formData.local_destino)?.id || ""}
                        onChange={(id) => {
                          const local = locaisEmpresaDestino.find((l) => l.id === id);
                          handleChange('local_destino', local?.nome || "");
                        }}
                        placeholder="Selecione o local"
                        displayField="nome"
                        searchFields={["nome", "descricao"]}
                        className="flex-1" />

                        <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogLocal(true)} className="h-8 w-8">
                          <Plus className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </>
                }

                {mostrarFornecedor &&
                <div className="space-y-1">
                    <Label className="text-xs">Fornecedor *</Label>
                    <AutocompleteGenerico
                    items={fornecedores}
                    value={formData.fornecedor_id}
                    onChange={(v) => handleChange('fornecedor_id', v)}
                    placeholder="Selecione o fornecedor"
                    displayField="nome"
                    searchFields={["nome", "cpf", "cnpj"]}
                    renderSubtext={(item) => item.cpf || item.cnpj} />

                  </div>
                }

                {mostrarCliente &&
                <div className="space-y-1">
                    <Label className="text-xs">Cliente/Destinatário</Label>
                    <Input value={formData.cliente_nome} onChange={(e) => handleChange('cliente_nome', e.target.value)} placeholder="Nome do Cliente" className="h-8 text-xs" />
                  </div>
                }
              </div>

              {/* Seção de Vínculo para Saídas */}
              {mostrarVinculo &&
              <div className="border border-blue-200 rounded-lg p-3 bg-blue-50/50">
                  <div className="flex items-center gap-3 mb-3">
                    <Link2 className="w-4 h-4 text-blue-600" />
                    <Label className="text-xs font-semibold text-blue-900">Vincular Saída</Label>
                    <Switch
                    checked={formData.vinculado}
                    onCheckedChange={(checked) => {
                      handleChange('vinculado', checked);
                      if (!checked) {
                        handleChange('tipo_vinculo', '');
                        handleChange('lote_vinculado_id', '');
                        handleChange('area_vinculada_id', '');
                        handleChange('maquina_vinculada_id', '');
                      }
                    }} />

                  </div>

                  {formData.vinculado &&
                <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Tipo de Vínculo *</Label>
                        <Select value={formData.tipo_vinculo} onValueChange={(v) => {
                      handleChange('tipo_vinculo', v);
                      handleChange('lote_vinculado_id', '');
                      handleChange('area_vinculada_id', '');
                      handleChange('maquina_vinculada_id', '');
                    }}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lote" className="text-xs">
                              <div className="flex items-center gap-2">
                                <Package className="w-3 h-3" />
                                Lote (Pecuária)
                              </div>
                            </SelectItem>
                            <SelectItem value="area" className="text-xs">
                              <div className="flex items-center gap-2">
                                <MapPin className="w-3 h-3" />
                                Área / Pasto
                              </div>
                            </SelectItem>
                            <SelectItem value="maquina" className="text-xs">
                              <div className="flex items-center gap-2">
                                <Truck className="w-3 h-3" />
                                Máquina / Veículo
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {formData.tipo_vinculo === 'lote' &&
                  <div className="space-y-1">
                          <Label className="text-xs">Lote *</Label>
                          <Select value={formData.lote_vinculado_id} onValueChange={(v) => handleChange('lote_vinculado_id', v)}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Selecione o lote" />
                            </SelectTrigger>
                            <SelectContent>
                              {lotes.map((lote) =>
                        <SelectItem key={lote.id} value={lote.id} className="text-xs">
                                  {lote.identificacao || lote.nome} - {lote.quantidade_animais || 0} cab
                                </SelectItem>
                        )}
                            </SelectContent>
                          </Select>
                        </div>
                  }

                      {formData.tipo_vinculo === 'area' &&
                  <div className="space-y-1">
                          <Label className="text-xs">Área *</Label>
                          <Select value={formData.area_vinculada_id} onValueChange={(v) => handleChange('area_vinculada_id', v)}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Selecione a área" />
                            </SelectTrigger>
                            <SelectContent>
                              {areas.map((area) =>
                        <SelectItem key={area.id} value={area.id} className="text-xs">
                                  {area.nome} {area.tamanho_hectares ? `(${area.tamanho_hectares} ha)` : ''}
                                </SelectItem>
                        )}
                            </SelectContent>
                          </Select>
                        </div>
                  }

                      {formData.tipo_vinculo === 'maquina' &&
                  <div className="space-y-1">
                          <Label className="text-xs">Máquina *</Label>
                          <Select value={formData.maquina_vinculada_id} onValueChange={(v) => handleChange('maquina_vinculada_id', v)}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Selecione a máquina" />
                            </SelectTrigger>
                            <SelectContent>
                              {maquinas.map((maq) =>
                        <SelectItem key={maq.id} value={maq.id} className="text-xs">
                                  {maq.nome || maq.identificacao} {maq.placa ? `(${maq.placa})` : ''}
                                </SelectItem>
                        )}
                            </SelectContent>
                          </Select>
                        </div>
                  }
                    </div>
                }
                </div>
              }

              {mostrarDadosNFe &&
              <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Tipo Documento</Label>
                      <Select value={formData.tipo_documento} onValueChange={(v) => handleChange('tipo_documento', v)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Nota Fiscal" className="text-xs">Nota Fiscal</SelectItem>
                          <SelectItem value="NF-e" className="text-xs">NF-e</SelectItem>
                          <SelectItem value="NFC-e" className="text-xs">NFC-e</SelectItem>
                          <SelectItem value="Recibo" className="text-xs">Recibo</SelectItem>
                          <SelectItem value="Outros" className="text-xs">Outros</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Nº Documento</Label>
                      <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" className="h-8 text-xs" />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Série</Label>
                      <Input value={formData.serie_documento} onChange={(e) => handleChange('serie_documento', e.target.value)} placeholder="001" className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Data Documento</Label>
                      <Input type="date" value={formData.data_documento} onChange={(e) => handleChange('data_documento', e.target.value)} className="h-8 text-xs" />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">CFOP</Label>
                      <Input value={formData.cfop} onChange={(e) => handleChange('cfop', e.target.value)} placeholder="0000" className="h-8 text-xs" maxLength={4} />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Natureza da Operação</Label>
                      <Input value={formData.natureza_operacao} onChange={(e) => handleChange('natureza_operacao', e.target.value)} placeholder="Compra para Comercialização" className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Chave NF-e (44 dígitos)</Label>
                    <Input value={formData.chave_documento} onChange={(e) => handleChange('chave_documento', e.target.value)} placeholder="00000000000000000000000000000000000000000000" className="h-8 text-xs" maxLength={44} />
                  </div>
                </>
              }

              {formData.tipo_movimentacao === 'Ajuste' &&
              <div className="space-y-1">
                  <Label className="text-xs">Motivo do Ajuste *</Label>
                  <Input value={formData.motivo_movimentacao} onChange={(e) => handleChange('motivo_movimentacao', e.target.value)} placeholder="Descreva o motivo do ajuste" className="h-8 text-xs" required />
                </div>
              }

              <div className="pt-4 border-t">

                <div className="flex justify-between items-center mb-2">
                  <div>
                    <Label className="text-xs font-semibold">Produtos</Label>
                    {formData.tipo_movimentacao === 'Saída' && formData.local_estoque_origem_id && (
                      <p className="text-[10px] text-blue-600">Origem: {locais.find(l => l.id === formData.local_estoque_origem_id)?.nome}</p>
                    )}
                    {formData.tipo_movimentacao === 'Entrada' && formData.local_estoque_destino_id && (
                      <p className="text-[10px] text-blue-600">Destino: {locais.find(l => l.id === formData.local_estoque_destino_id)?.nome}</p>
                    )}
                  </div>


                </div>

                {/* Formulário Padrão de Produto */}
                <Card className="bg-white border border-slate-300 mb-3">
                  <CardHeader className="py-2">
                    <CardTitle className="text-sm font-semibold text-slate-900">Lançar Produto</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-3 space-y-1">
                        <Label className="text-xs">Produto</Label>
                        <AutocompleteGenerico
                          items={formData.tipo_movimentacao === 'Saída' || formData.tipo_movimentacao === 'Transferência' ? produtosComEstoqueNoLocal : produtos}
                          value={currentItem?.produto_id || ''}
                          onChange={(v) => {
                            const prod = produtos.find(p => p.id === v);
                            setCurrentItem(prev=>({
                              ...(prev||{}),
                              produto_id: v || '',
                              produto_nome: prod?.nome_produto || '',
                              unidade: prod?.unidade_medida || '',
                            }));
                            if (prod) {
                              const det = (formData.tipo_detalhado || '').toLowerCase();
                              let precoBase = 0;
                              if (formData.tipo_movimentacao === 'Entrada') {
                                precoBase = prod.preco_custo || 0;
                              } else if (formData.tipo_movimentacao === 'Saída') {
                                precoBase = det.includes('venda') && (prod.preco_venda || 0) > 0 ? (prod.preco_venda || 0) : (prod.preco_custo || 0);
                              } else {
                                precoBase = prod.preco_custo || 0;
                              }
                              setCurrentItem(prev=>{
                                const qtd = parseNumero(prev?.quantidade||'0');
                                const total = qtd > 0 ? (qtd * precoBase) : 0;
                                return { ...(prev||{}), preco: formatarNumero(precoBase), valor_total: formatarNumero(total) };
                              });
                            }
                          }}
                          placeholder="Selecione o produto"
                          displayField="nome_produto"
                          searchFields={["nome_produto","codigo_interno","codigo_barras"]}
                          className="w-full"
                        />
                        {(formData.tipo_movimentacao === 'Saída' || formData.tipo_movimentacao === 'Transferência') && (currentItem?.produto_id) && (
                          (()=>{
                            const saldo = estoquePorLocal[currentItem.produto_id]?.[formData.local_estoque_origem_id] || 0;
                            const qtd = parseNumero(currentItem.quantidade||'0');
                            const ok = saldo >= qtd;
                            return (
                              <div className="mt-1 text-xs">
                                <Badge className={ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}>
                                  Saldo disponível: {saldo.toFixed(2)} {currentItem.unidade || 'UN'}
                                </Badge>
                              </div>
                            );
                          })()
                        )}
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Quantidade</Label>
                        <Input
                          value={currentItem?.quantidade || ''}
                          onChange={(e)=>{
                            const val = e.target.value;
                            setCurrentItem(prev=>({ ...(prev||{}), quantidade: val }));
                            const prod = produtos.find(p=>p.id=== (currentItem?.produto_id||''));
                            const det = (formData.tipo_detalhado || '').toLowerCase();
                            let precoBase = 0;
                            if (prod) {
                              if (formData.tipo_movimentacao === 'Entrada') {
                                precoBase = parseNumero(currentItem?.preco || '0') || (prod.preco_custo || 0);
                              } else if (formData.tipo_movimentacao === 'Saída') {
                                precoBase = det.includes('venda') && (prod.preco_venda || 0) > 0 ? (prod.preco_venda || 0) : (prod.preco_custo || 0);
                              } else {
                                precoBase = prod.preco_custo || 0;
                              }
                              const qtdNum = parseNumero(val);
                              if ((formData.tipo_movimentacao === 'Saída' || formData.tipo_movimentacao === 'Transferência') && currentItem?.produto_id) {
                                const saldo = estoquePorLocal[currentItem.produto_id]?.[formData.local_estoque_origem_id] || 0;
                                if (qtdNum > saldo) {
                                  toast.error('Quantidade maior que o saldo disponível');
                                }
                              }
                              const total = (qtdNum || 0) * (precoBase || 0);
                              setCurrentItem(prev=>({ ...(prev||{}), valor_total: formatarNumero(total) }));
                            }
                          }}
                          className="h-8 text-xs"
                          placeholder="0,00"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Preço</Label>
                        <Input
                          value={currentItem?.preco || ''}
                          onChange={(e)=>{
                            const val = e.target.value;
                            setCurrentItem(prev=>({ ...(prev||{}), preco: val }));
                            const qtdNum = parseNumero(currentItem?.quantidade||'0');
                            const total = qtdNum * parseNumero(val||'0');
                            setCurrentItem(prev=>({ ...(prev||{}), valor_total: formatarNumero(total) }));
                          }}
                          className="h-8 text-xs"
                          placeholder="0,00"
                          readOnly={formData.tipo_movimentacao !== 'Entrada'}
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Valor Total</Label>
                        <Input value={currentItem?.valor_total || ''} readOnly className="h-8 text-xs" />
                      </div>

                      <div className="md:col-span-3 space-y-1">
                        <Label className="text-xs">Observação do Item</Label>
                        <Textarea value={currentItem?.observacao_item || ''} onChange={(e)=>setCurrentItem(prev=>({ ...(prev||{}), observacao_item: e.target.value }))} className="text-xs" rows={2} />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={()=>{
                        if (!currentItem?.produto_id) { toast.error('Selecione o produto'); return; }
                        const qtdNum = parseNumero(currentItem?.quantidade||'0');
                        if (qtdNum <= 0) { toast.error('Informe a quantidade'); return; }
                        if ((formData.tipo_movimentacao === 'Saída' || formData.tipo_movimentacao === 'Transferência')) {
                          const saldo = estoquePorLocal[currentItem.produto_id]?.[formData.local_estoque_origem_id] || 0;
                          if (qtdNum > saldo) { toast.error('Saldo insuficiente'); return; }
                        }
                        const novo = { ...currentItem };
                        if (editingIndex !== null) {
                          setFormData(prev=>({ ...prev, produtos_selecionados: prev.produtos_selecionados.map((x,i)=> i===editingIndex ? novo : x) }));
                        } else {
                          setFormData(prev=>({ ...prev, produtos_selecionados: [...prev.produtos_selecionados, novo] }));
                        }
                        setCurrentItem({ produto_id: '', produto_nome: '', unidade: '', quantidade: '', preco: '', valor_total: '', observacao_item: '' });
                        setEditingIndex(null);
                      }}>
                        <Plus className="w-3.5 h-3.5 mr-1" /> {editingIndex !== null ? 'Atualizar Produto' : 'Adicionar Produto'}
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={()=> setCurrentItem({ produto_id: '', produto_nome: '', unidade: '', quantidade: '', preco: '', valor_total: '', observacao_item: '' })}>Limpar</Button>
                      {editingIndex !== null && (
                        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{ setEditingIndex(null); setCurrentItem({ produto_id: '', produto_nome: '', unidade: '', quantidade: '', preco: '', valor_total: '', observacao_item: '' }); }}>Cancelar Edição</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {!canAddProduto && (
                  <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-800">
                    {formData.tipo_movimentacao === 'Saída' && '⚠️ Selecione o Local de Origem para visualizar e liberar produtos.'}
                    {formData.tipo_movimentacao === 'Entrada' && '⚠️ Selecione o Local de Destino para lançar produtos.'}
                    {formData.tipo_movimentacao === 'Transferência' && '⚠️ Selecione Origem e Destino para transferir produtos.'}
                    {formData.tipo_movimentacao === 'Ajuste' && '⚠️ Selecione o Local do Ajuste para lançar produtos.'}
                  </div>
                )}

                {formData.produtos_selecionados.length > 0 && (
                  <Table className="w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black">Unid.</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Valor Total</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Desconto</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black w-12 text-center">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {formData.produtos_selecionados.map((p, idx) => (
                        <TableRow key={idx} className="hover:bg-gray-50">
                          <TableCell className="text-xs py-1 border border-gray-300">
                            <AutocompleteGenerico
                              items={formData.tipo_movimentacao === 'Saída' || formData.tipo_movimentacao === 'Transferência' ? produtosComEstoqueNoLocal : produtos}
                              value={p.produto_id}
                              onChange={(v) => handleAtualizarProduto(idx, 'produto_id', v)}
                              placeholder="Selecione o produto"
                              displayField="nome_produto"
                              searchFields={["nome_produto","codigo_interno","codigo_barras"]}
                              className="w-full"
                            />
                          </TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300">{p.unidade || '-'}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right">
                            <Input value={p.quantidade || ''} onChange={(e)=>handleAtualizarProduto(idx,'quantidade', e.target.value)} className="h-8 text-xs text-right" />
                          </TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right">
                            <Input value={p.valor_total || ''} onChange={(e)=>handleAtualizarProduto(idx,'valor_total', e.target.value)} className="h-8 text-xs text-right" />
                          </TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right">
                            <Input value={p.desconto_item || ''} onChange={(e)=>handleAtualizarProduto(idx,'desconto_item', e.target.value)} className="h-8 text-xs text-right" />
                          </TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-center">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6">
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem className="text-xs text-red-600" onClick={() => handleRemoverProduto(idx)}>Remover</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                {formData.produtos_selecionados.length > 0 && (
                  <div className="mt-3 bg-white border border-slate-300 rounded p-3">
                    <div className="space-y-1 text-xs">
                      <div className="font-semibold text-slate-800 mb-1">Resumo</div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Total Produtos:</span>
                        <span className="font-mono font-semibold text-slate-800">{formatarMoeda(totalProdutosLiquido)}</span>
                      </div>
                    </div>
                  </div>
                )}


              </div>

                <div className="space-y-1">
                <Label className="text-xs">Observações</Label>
                <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="Observações Adicionais..." className="text-xs" rows={2} />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
                <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                  {initialData?.id ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <DialogCadastroRapido tipo="local_estoque" open={showDialogLocal} onClose={() => setShowDialogLocal(false)} onSuccess={(id) => {queryClient.invalidateQueries({ queryKey: ['locais_mov'] }); if (formData.tipo_movimentacao === 'Entrada') { handleChange('local_estoque_destino_id', id); } else { handleChange('local_estoque_origem_id', id); } setShowDialogLocal(false);}} />
      <DialogCadastroRapido tipo="centro_custo" open={showDialogCentro} onClose={() => setShowDialogCentro(false)} onSuccess={(id) => {queryClient.invalidateQueries({ queryKey: ['centros_mov'] });handleChange('centro_custo_id', id);setShowDialogCentro(false);}} />
      <DialogCadastroRapido tipo="produto" open={showDialogProduto} onClose={() => setShowDialogProduto(false)} onSuccess={(id) => {queryClient.invalidateQueries({ queryKey: ['produtos'] });setShowDialogProduto(false);}} />
    </>);

}