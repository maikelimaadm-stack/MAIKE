import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

import { toast } from "sonner";
import ComboboxComNovo from "./ComboboxComNovo";

const TIPOS_MOVIMENTACAO = [
  { value: "Entrada", label: "Entrada", cor: "bg-green-100 text-green-800" },
  { value: "Saída", label: "Saída", cor: "bg-red-100 text-red-800" },
];

const MOTIVOS_ENTRADA = [
  "Compra",
  "Nascimento", 
  "Saldo Inicial",
  "Inventário",
  "Ajuste Positivo",
  "Doação Recebida",
  "Outros"
];

const MOTIVOS_SAIDA = [
  "Venda",
  "Morte",
  "Abate",
  "Transferência entre Setores",
  "Mudança de Categoria",
  "Ajuste Negativo",
  "Doação",
  "Perda/Roubo",
  "Outros"
];

export default function FormularioLancamentoManual({ item, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const [invalidFields, setInvalidFields] = useState([]);

  const [formData, setFormData] = useState({
    tipo: item?.tipo || "",
    data_movimentacao: item?.data_movimentacao?.split('T')[0] || new Date().toISOString().split('T')[0],
    quantidade_animais: item?.quantidade_animais || 1,
    categoria_animal: item?.categoria_animal || "",
    categoria_nova: item?.categoria_nova || "",
    marca: item?.marca || "",
    sexo: item?.sexo || "",
    peso_medio: item?.peso_medio || "",
    peso_total: item?.peso_total || "",
    valor_unitario: item?.valor_unitario || "",
    valor_total: item?.valor_total || "",
    setor_id: item?.setor_id || "",
    setor_origem_id: item?.setor_origem_id || "",
    setor_destino_id: item?.setor_destino_id || "",
    area_origem_id: item?.area_origem_id || "",
    area_destino_id: item?.area_destino_id || "",
    fornecedor_origem: item?.fornecedor_origem || "",
    destino_venda: item?.destino_venda || "",
    nota_fiscal: item?.nota_fiscal || "",
    gta: item?.gta || "",
    motivo: item?.motivo || "",
    causa_morte: item?.causa_morte || "",
    transferencia_origem: item?.transferencia_origem || "",
    transferencia_destino: item?.transferencia_destino || "",
    observacoes: item?.observacoes || ""
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas-pastagem', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: categoriasManejo = [] } = useQuery({
    queryKey: ['categorias-manejo', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CategoriaManejo.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Carregar setores
  const { data: setores = [] } = useQuery({
    queryKey: ['setores', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Setor.list();
      return all.filter(s => s.empresa_id === empresaSelecionadaId && s.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });



  // Carregar todas as movimentações MANUAIS para extrair dados únicos
  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['movimentacoes-pecuaria-dados', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoPecuaria.list();
      // Filtrar APENAS movimentações manuais (sem lote_id E sem lote nome)
      return all.filter(m => 
        m.empresa_id === empresaSelecionadaId && 
        !m.lote_id &&
        !m.lote
      );
    },
    enabled: !!empresaSelecionadaId,
  });

  // Extrair dados únicos das movimentações existentes
  const marcasExistentes = [...new Set(movimentacoes.map(m => m.marca).filter(Boolean))].sort();
  const fornecedoresExistentes = [...new Set(movimentacoes.map(m => m.fornecedor_origem).filter(Boolean))].sort();
  const compradoresExistentes = [...new Set(movimentacoes.map(m => m.destino_venda).filter(Boolean))].sort();
  const causasMorteExistentes = [...new Set(movimentacoes.map(m => m.causa_morte).filter(Boolean))].sort();


  // Extrair categorias já lançadas nas movimentações
  const categoriasLancadas = useMemo(() => {
    const cats = [...new Set(movimentacoes.map(m => m.categoria_animal).filter(Boolean))];
    return cats.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [movimentacoes]);

  // Calcular saldo por categoria GERAL (entradas - saídas)
  const saldoPorCategoria = useMemo(() => {
    const saldos = {};
    
    movimentacoes.forEach(mov => {
      const categoria = mov.categoria_animal;
      if (!categoria) return;
      
      if (!saldos[categoria]) {
        saldos[categoria] = 0;
      }
      
      const qtd = mov.quantidade_animais || 0;
      
      if (mov.tipo === "Entrada") {
        saldos[categoria] += qtd;
      } else if (mov.tipo === "Saída") {
        saldos[categoria] -= qtd;
      }
    });
    
    return saldos;
  }, [movimentacoes]);

  // Calcular saldo por SETOR + CATEGORIA
  const saldoPorSetorCategoria = useMemo(() => {
    const saldos = {};
    
    movimentacoes.forEach(mov => {
      const setorId = mov.setor_id;
      const categoria = mov.categoria_animal;
      if (!setorId || !categoria) return;
      
      const chave = `${setorId}|||${categoria}`;
      if (!saldos[chave]) {
        saldos[chave] = { setorId, categoria, saldo: 0 };
      }
      
      const qtd = mov.quantidade_animais || 0;
      
      if (mov.tipo === "Entrada") {
        saldos[chave].saldo += qtd;
      } else if (mov.tipo === "Saída") {
        saldos[chave].saldo -= qtd;
      }
    });
    
    return saldos;
  }, [movimentacoes]);



  // Calcular saldo por setor
  const saldoPorSetor = useMemo(() => {
    const saldos = {};
    
    movimentacoes.forEach(mov => {
      const setorId = mov.setor_id;
      if (!setorId) return;
      
      if (!saldos[setorId]) {
        saldos[setorId] = 0;
      }
      
      const qtd = mov.quantidade_animais || 0;
      
      if (mov.tipo === "Entrada") {
        saldos[setorId] += qtd;
      } else if (mov.tipo === "Saída") {
        saldos[setorId] -= qtd;
      }
    });
    
    return saldos;
  }, [movimentacoes]);

  // Calcular saldo por setor + categoria + marca
  const saldoPorSetorCategoriaMarca = useMemo(() => {
    const saldos = {};
    
    movimentacoes.forEach(mov => {
      const setorId = mov.setor_id;
      const categoria = mov.categoria_animal;
      const marca = mov.marca;
      if (!setorId || !categoria || !marca) return;
      
      const chave = `${setorId}|||${categoria}|||${marca}`;
      if (!saldos[chave]) {
        saldos[chave] = { setorId, categoria, marca, saldo: 0 };
      }
      
      const qtd = mov.quantidade_animais || 0;
      
      if (mov.tipo === "Entrada") {
        saldos[chave].saldo += qtd;
      } else if (mov.tipo === "Saída") {
        saldos[chave].saldo -= qtd;
      }
    });
    
    return saldos;
  }, [movimentacoes]);

  // Categorias disponíveis no setor selecionado (para saída)
  const categoriasNoSetor = useMemo(() => {
    if (!formData.setor_id) return [];
    
    return Object.values(saldoPorSetorCategoria)
      .filter(item => item.setorId === formData.setor_id && item.saldo > 0)
      .map(item => ({ categoria: item.categoria, saldo: item.saldo }))
      .sort((a, b) => a.categoria.localeCompare(b.categoria));
  }, [saldoPorSetorCategoria, formData.setor_id]);

  // Marcas disponíveis no setor + categoria selecionados (para saída)
  const marcasNoSetorCategoria = useMemo(() => {
    if (!formData.setor_id || !formData.categoria_animal) return [];
    
    return Object.values(saldoPorSetorCategoriaMarca)
      .filter(item => item.setorId === formData.setor_id && item.categoria === formData.categoria_animal && item.saldo > 0)
      .map(item => ({ marca: item.marca, saldo: item.saldo }))
      .sort((a, b) => a.marca.localeCompare(b.marca));
  }, [saldoPorSetorCategoriaMarca, formData.setor_id, formData.categoria_animal]);

  // Calcular saldo por categoria + marca (para saída)
  const saldoPorCategoriaMarca = useMemo(() => {
    const saldos = {};
    
    movimentacoes.forEach(mov => {
      const categoria = mov.categoria_animal;
      const marca = mov.marca;
      if (!categoria || !marca) return;
      
      const chave = `${categoria}|||${marca}`;
      if (!saldos[chave]) {
        saldos[chave] = { categoria, marca, saldo: 0 };
      }
      
      const qtd = mov.quantidade_animais || 0;
      
      if (mov.tipo === "Entrada") {
        saldos[chave].saldo += qtd;
      } else if (mov.tipo === "Saída") {
        saldos[chave].saldo -= qtd;
      }
    });
    
    return saldos;
  }, [movimentacoes]);

  // Marcas disponíveis para a categoria selecionada (na saída)
  const marcasParaCategoriaSelecionada = useMemo(() => {
    if (!formData.categoria_animal || formData.tipo !== "Saída") return [];
    
    const marcas = Object.values(saldoPorCategoriaMarca)
      .filter(item => item.categoria === formData.categoria_animal && item.saldo > 0)
      .map(item => ({ marca: item.marca, saldo: item.saldo }))
      .sort((a, b) => a.marca.localeCompare(b.marca));
    
    return marcas;
  }, [saldoPorCategoriaMarca, formData.categoria_animal, formData.tipo]);

  // Calcular peso total automaticamente
  useEffect(() => {
    if (formData.peso_medio && formData.quantidade_animais) {
      const pesoTotal = parseFloat(formData.peso_medio) * parseInt(formData.quantidade_animais);
      setFormData(prev => ({ ...prev, peso_total: pesoTotal.toFixed(2) }));
    }
  }, [formData.peso_medio, formData.quantidade_animais]);

  // Calcular valor total automaticamente
  useEffect(() => {
    if (formData.valor_unitario && formData.quantidade_animais) {
      const valorTotal = parseFloat(formData.valor_unitario) * parseInt(formData.quantidade_animais);
      setFormData(prev => ({ ...prev, valor_total: valorTotal.toFixed(2) }));
    }
  }, [formData.valor_unitario, formData.quantidade_animais]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const allMovs = await base44.entities.MovimentacaoPecuaria.list();
      const maxNum = allMovs.reduce((max, m) => Math.max(max, parseInt(m.numero_movimentacao) || 0), 0);

      const areaOrigem = areas.find(a => a.id === data.area_origem_id);
      const areaDestino = areas.find(a => a.id === data.area_destino_id);
      const setor = setores.find(s => s.id === data.setor_id);
      const setorOrigem = setores.find(s => s.id === data.setor_origem_id);
      const setorDestino = setores.find(s => s.id === data.setor_destino_id);

      const results = [];

      // Se é transferência entre setores, criar 2 registros interligados
      if (data.motivo === "Transferência entre Setores" && data.setor_origem_id && data.setor_destino_id) {
        const idVinculo = `TS-${Date.now()}`;
        
        // 1. Saída do setor de origem
        const payloadSaida = {
          empresa_id: empresaSelecionadaId,
          numero_movimentacao: String(maxNum + 1),
          tipo: "Saída",
          data_movimentacao: `${data.data_movimentacao}T12:00:00`,
          quantidade_animais: parseInt(data.quantidade_animais) || 1,
          categoria_animal: data.categoria_animal || null,
          marca: data.marca || null,
          sexo: data.sexo || null,
          peso_medio: parseFloat(data.peso_medio) || null,
          peso_total: parseFloat(data.peso_total) || null,
          setor_id: data.setor_origem_id,
          setor_nome: setorOrigem?.nome || null,
          setor_origem_id: data.setor_origem_id,
          setor_origem_nome: setorOrigem?.nome || null,
          setor_destino_id: data.setor_destino_id,
          setor_destino_nome: setorDestino?.nome || null,
          area_origem_id: data.area_origem_id || null,
          area_origem_nome: areaOrigem?.nome || null,
          nota_fiscal: data.nota_fiscal || null,
          gta: data.gta || null,
          motivo: "Transferência entre Setores",
          transferencia_origem: setorOrigem?.nome || null,
          transferencia_destino: setorDestino?.nome || null,
          vinculo_transferencia_setor: idVinculo,
          observacoes: data.observacoes || null,
        };

        // 2. Entrada no setor de destino
        const payloadEntrada = {
          empresa_id: empresaSelecionadaId,
          numero_movimentacao: String(maxNum + 2),
          tipo: "Entrada",
          data_movimentacao: `${data.data_movimentacao}T12:00:00`,
          quantidade_animais: parseInt(data.quantidade_animais) || 1,
          categoria_animal: data.categoria_animal || null,
          marca: data.marca || null,
          sexo: data.sexo || null,
          peso_medio: parseFloat(data.peso_medio) || null,
          peso_total: parseFloat(data.peso_total) || null,
          setor_id: data.setor_destino_id,
          setor_nome: setorDestino?.nome || null,
          setor_origem_id: data.setor_origem_id,
          setor_origem_nome: setorOrigem?.nome || null,
          setor_destino_id: data.setor_destino_id,
          setor_destino_nome: setorDestino?.nome || null,
          area_destino_id: data.area_destino_id || null,
          area_destino_nome: areaDestino?.nome || null,
          nota_fiscal: data.nota_fiscal || null,
          gta: data.gta || null,
          motivo: "Transferência entre Setores",
          transferencia_origem: setorOrigem?.nome || null,
          transferencia_destino: setorDestino?.nome || null,
          vinculo_transferencia_setor: idVinculo,
          observacoes: data.observacoes || null,
        };

        const resSaida = await base44.entities.MovimentacaoPecuaria.create(payloadSaida);
        const resEntrada = await base44.entities.MovimentacaoPecuaria.create(payloadEntrada);
        return { saida: resSaida, entrada: resEntrada };
      }

      // Se é mudança de categoria, criar 2 registros interligados: saída + entrada
      if (data.motivo === "Mudança de Categoria" && data.categoria_nova) {
        const idVinculo = `MC-${Date.now()}`;
        
        // 1. Saída da categoria atual
        const payloadSaida = {
          empresa_id: empresaSelecionadaId,
          numero_movimentacao: String(maxNum + 1),
          tipo: "Saída",
          data_movimentacao: `${data.data_movimentacao}T12:00:00`,
          quantidade_animais: parseInt(data.quantidade_animais) || 1,
          categoria_animal: data.categoria_animal || null,
          categoria_nova: data.categoria_nova || null,
          marca: data.marca || null,
          sexo: data.sexo || null,
          peso_medio: parseFloat(data.peso_medio) || null,
          peso_total: parseFloat(data.peso_total) || null,
          valor_unitario: null,
          valor_total: null,
          setor_id: data.setor_id || null,
          setor_nome: setor?.nome || null,
          area_origem_id: data.area_origem_id || null,
          area_origem_nome: areaOrigem?.nome || null,
          area_destino_id: null,
          area_destino_nome: null,
          fornecedor_origem: null,
          destino_venda: null,
          nota_fiscal: null,
          gta: null,
          motivo: "Mudança de Categoria",
          causa_morte: null,
          transferencia_origem: data.categoria_animal || null,
          transferencia_destino: data.categoria_nova || null,
          vinculo_mudanca_categoria: idVinculo,
          observacoes: data.observacoes || null,
        };

        // 2. Entrada na nova categoria (MESMO SETOR!)
        const catNova = categoriasManejo.find(c => c.nome === data.categoria_nova);
        const payloadEntrada = {
          empresa_id: empresaSelecionadaId,
          numero_movimentacao: String(maxNum + 2),
          tipo: "Entrada",
          data_movimentacao: `${data.data_movimentacao}T12:00:00`,
          quantidade_animais: parseInt(data.quantidade_animais) || 1,
          categoria_animal: data.categoria_nova || null,
          categoria_nova: null,
          marca: data.marca || null,
          sexo: catNova?.sexo || data.sexo || null,
          peso_medio: parseFloat(data.peso_medio) || null,
          peso_total: parseFloat(data.peso_total) || null,
          valor_unitario: null,
          valor_total: null,
          setor_id: data.setor_id || null,
          setor_nome: setor?.nome || null,
          area_origem_id: null,
          area_origem_nome: null,
          area_destino_id: data.area_destino_id || data.area_origem_id || null,
          area_destino_nome: areaDestino?.nome || areaOrigem?.nome || null,
          fornecedor_origem: null,
          destino_venda: null,
          nota_fiscal: null,
          gta: null,
          motivo: "Mudança de Categoria",
          causa_morte: null,
          transferencia_origem: data.categoria_animal || null,
          transferencia_destino: null,
          vinculo_mudanca_categoria: idVinculo,
          observacoes: data.observacoes || null,
        };

        const resSaida = await base44.entities.MovimentacaoPecuaria.create(payloadSaida);
        const resEntrada = await base44.entities.MovimentacaoPecuaria.create(payloadEntrada);
        return { saida: resSaida, entrada: resEntrada };
      }

      // Lançamento normal (não é mudança de categoria nem transferência entre setores)
      const payload = {
        empresa_id: empresaSelecionadaId,
        numero_movimentacao: String(maxNum + 1),
        tipo: data.tipo,
        data_movimentacao: `${data.data_movimentacao}T12:00:00`,
        quantidade_animais: parseInt(data.quantidade_animais) || 1,
        categoria_animal: data.categoria_animal || null,
        categoria_nova: data.categoria_nova || null,
        marca: data.marca || null,
        sexo: data.sexo || null,
        peso_medio: parseFloat(data.peso_medio) || null,
        peso_total: parseFloat(data.peso_total) || null,
        valor_unitario: parseFloat(data.valor_unitario) || null,
        valor_total: parseFloat(data.valor_total) || null,
        setor_id: data.setor_id || null,
        setor_nome: setor?.nome || null,
        area_origem_id: data.area_origem_id || null,
        area_origem_nome: areaOrigem?.nome || null,
        area_destino_id: data.area_destino_id || null,
        area_destino_nome: areaDestino?.nome || null,
        fornecedor_origem: data.fornecedor_origem || null,
        destino_venda: data.destino_venda || null,
        nota_fiscal: data.nota_fiscal || null,
        gta: data.gta || null,
        motivo: data.motivo || null,
        causa_morte: data.causa_morte || null,
        transferencia_origem: data.transferencia_origem || null,
        transferencia_destino: data.transferencia_destino || null,
        observacoes: data.observacoes || null,
      };

      // Se é duplicação ou não tem id, cria novo
      if (item && item.id && !item._isDuplicate) {
        return base44.entities.MovimentacaoPecuaria.update(item.id, payload);
      }
      return base44.entities.MovimentacaoPecuaria.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria-dados'] });
      toast.success(item ? 'Movimentação atualizada!' : 'Movimentação registrada!');
      onSave();
    },
    onError: () => {
      toast.error('Erro ao salvar movimentação');
    }
  });

  const getFieldClassName = (field, baseClass = "") => {
    return `${baseClass} ${invalidFields.includes(field) ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`.trim();
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const missingFields = [];
    if (formData.motivo !== "Transferência entre Setores" && !formData.setor_id) missingFields.push('setor_id');
    if (!formData.tipo) missingFields.push('tipo');
    if (!formData.motivo) missingFields.push('motivo');
    if (!formData.data_movimentacao) missingFields.push('data_movimentacao');
    if (!formData.quantidade_animais || formData.quantidade_animais < 1) missingFields.push('quantidade_animais');
    if (!formData.categoria_animal) missingFields.push('categoria_animal');
    if (!formData.marca) missingFields.push('marca');
    if (formData.motivo === "Mudança de Categoria" && !formData.categoria_nova) missingFields.push('categoria_nova');
    if (formData.motivo === "Transferência entre Setores" && !formData.setor_origem_id) missingFields.push('setor_origem_id');
    if (formData.motivo === "Transferência entre Setores" && !formData.setor_destino_id) missingFields.push('setor_destino_id');

    if (missingFields.length > 0) {
      setInvalidFields(missingFields);
      toast.error('PREENCHA OS CAMPOS OBRIGATÓRIOS.');
      return;
    }

    // Validar saldo para saídas e mudanças de categoria - AGORA POR SETOR
    if (formData.tipo === "Saída" || formData.motivo === "Mudança de Categoria") {
      const qtdSolicitada = parseInt(formData.quantidade_animais) || 0;

      // Validar saldo no setor + categoria + marca
      const chave = `${formData.setor_id}|||${formData.categoria_animal}|||${formData.marca}`;
      const saldoNoSetor = saldoPorSetorCategoriaMarca[chave]?.saldo || 0;

      if (qtdSolicitada > saldoNoSetor) {
        const setorNome = setores.find(s => s.id === formData.setor_id)?.nome || 'selecionado';
        toast.error(`Saldo insuficiente! No setor "${setorNome}", marca "${formData.marca}" categoria "${formData.categoria_animal}" possui apenas ${saldoNoSetor} cabeça(s).`);
        return;
      }
    }

    setInvalidFields([]);
    createMutation.mutate(formData);
  };

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-slate-50 border-b py-3 px-4">
        <CardTitle className="text-sm font-semibold text-slate-700">
          {item ? 'Editar Movimentação' : 'Novo Lançamento Manual'}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-1">
          {/* Linha 0: Setor - OBRIGATÓRIO */}
          {formData.motivo !== "Transferência entre Setores" && (
            <div className="p-2 bg-indigo-50 border border-indigo-200 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-xs">Setor / Fazenda *</Label>
                  <Select 
                    value={formData.setor_id} 
                    onValueChange={(v) => { setFormData({ ...formData, setor_id: v, categoria_animal: "", marca: "" }); setInvalidFields((prev) => prev.filter((item) => item !== 'setor_id')); }}
                  >
                    <SelectTrigger className={getFieldClassName('setor_id', 'h-8 text-xs')}>
                      <SelectValue placeholder="Selecione o setor primeiro" />
                    </SelectTrigger>
                    <SelectContent>
                      {setores.length > 0 ? (
                        setores.map(setor => {
                          const saldo = saldoPorSetor[setor.id] || 0;
                          return (
                            <SelectItem key={setor.id} value={setor.id} className="text-sm">
                              <div className="flex items-center gap-2">
                                <span>{setor.sigla ? `${setor.sigla} - ` : ''}{setor.nome}</span>
                                <Badge variant={setor.tipo === 'Próprio' ? 'default' : 'secondary'} className="text-[10px]">
                                  {setor.tipo}
                                </Badge>
                                <Badge variant="outline" className="text-[10px]">
                                  {saldo} cab
                                </Badge>
                              </div>
                            </SelectItem>
                          );
                        })
                      ) : (
                        <SelectItem value={null} disabled className="text-sm text-slate-500">
                          Cadastre setores primeiro
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {formData.setor_id && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500">Saldo no setor:</span>
                    <span className="font-bold text-indigo-700">{saldoPorSetor[formData.setor_id] || 0} cab</span>
                  </div>
                )}
              </div>
              {!formData.setor_id && (
                <p className="text-xs text-indigo-600 mt-1">⚠️ Selecione o setor para liberar as demais opções</p>
              )}
            </div>
          )}

          {/* Linha 1: Tipo, Motivo, Data, Quantidade */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-1">
            <div className="space-y-1">
              <Label className="text-xs">Tipo *</Label>
              <Select value={formData.tipo} onValueChange={(v) => { setFormData({ ...formData, tipo: v, motivo: "" }); setInvalidFields((prev) => prev.filter((item) => item !== 'tipo')); }}>
                <SelectTrigger className={getFieldClassName('tipo', 'h-8 text-xs')}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_MOVIMENTACAO.map(tipo => (
                    <SelectItem key={tipo.value} value={tipo.value} className="text-sm">
                      <span className={`px-2 py-0.5 rounded ${tipo.cor}`}>{tipo.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Motivo *</Label>
              <Select value={formData.motivo} onValueChange={(v) => {
                if (v === "Transferência entre Setores" && formData.setor_id) {
                  setFormData({ ...formData, motivo: v, setor_origem_id: formData.setor_id });
                } else {
                  setFormData({ ...formData, motivo: v });
                }
                setInvalidFields((prev) => prev.filter((item) => item !== 'motivo'));
              }}>
                <SelectTrigger className={getFieldClassName('motivo', 'h-8 text-xs')}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {formData.tipo === "Entrada" ? (
                    [...MOTIVOS_ENTRADA, ...(formData.motivo && !MOTIVOS_ENTRADA.includes(formData.motivo) ? [formData.motivo] : [])].map(m => (<SelectItem key={m} value={m} className="text-sm">{m}</SelectItem>))
                  ) : formData.tipo === "Saída" ? (
                    [...MOTIVOS_SAIDA, ...(formData.motivo && !MOTIVOS_SAIDA.includes(formData.motivo) ? [formData.motivo] : [])].map(m => (<SelectItem key={m} value={m} className="text-sm">{m}</SelectItem>))
                  ) : (
                    <SelectItem value={null} disabled className="text-sm">Selecione o tipo primeiro</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Data *</Label>
              <Input
                type="date"
                value={formData.data_movimentacao}
                onChange={(e) => { setFormData({ ...formData, data_movimentacao: e.target.value }); setInvalidFields((prev) => prev.filter((item) => item !== 'data_movimentacao')); }}
                className={getFieldClassName('data_movimentacao', 'h-8 text-xs')}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Qtd Animais *</Label>
              <Input
                type="number"
                min="1"
                value={formData.quantidade_animais}
                onChange={(e) => { setFormData({ ...formData, quantidade_animais: e.target.value }); setInvalidFields((prev) => prev.filter((item) => item !== 'quantidade_animais')); }}
                className={getFieldClassName('quantidade_animais', 'h-8 text-xs')}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Peso Médio (kg)</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.peso_medio}
                onChange={(e) => setFormData({ ...formData, peso_medio: e.target.value })}
                className="h-8 text-xs"
                placeholder="0"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Peso Total</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.peso_total}
                className="h-8 text-xs bg-slate-50"
                readOnly
              />
            </div>
          </div>

          {/* Linha 2: Categoria, Marca, Sexo, Área - DEPENDEM DO SETOR */}
          {/* Ocultar este bloco quando for Mudança de Categoria (tem bloco próprio abaixo) */}
          {formData.motivo !== "Mudança de Categoria" && (
          <div className={`grid grid-cols-2 ${formData.tipo === "Entrada" ? "md:grid-cols-4" : "md:grid-cols-3"} gap-2`}>
            <div className="space-y-1">
              <Label className="text-xs">Categoria *</Label>
              {formData.tipo === "Saída" ? (
                // Na saída, mostrar apenas categorias que têm saldo > 0 NO SETOR SELECIONADO
                <Select 
                  value={formData.categoria_animal} 
                  onValueChange={(v) => {
                    const catEncontrada = categoriasManejo.find(c => c.nome === v);
                    setFormData({ ...formData, categoria_animal: v, marca: "", sexo: catEncontrada?.sexo || "" });
                    setInvalidFields((prev) => prev.filter((item) => item !== 'categoria_animal'));
                  }}
                  disabled={!formData.setor_id && formData.motivo !== "Transferência entre Setores"}
                >
                  <SelectTrigger className={getFieldClassName('categoria_animal', 'h-8 text-xs')}>
                    <SelectValue placeholder={formData.setor_id ? "Selecione" : "Selecione setor primeiro"} />
                  </SelectTrigger>
                  <SelectContent>
                    {categoriasNoSetor.length > 0 ? (
                      categoriasNoSetor.map(item => (
                        <SelectItem key={item.categoria} value={item.categoria} className="text-sm">
                          <div className="flex items-center justify-between w-full gap-2">
                            <span>{item.categoria}</span>
                            <Badge variant="default" className="text-[10px] px-1.5 py-0">
                              {item.saldo} cab
                            </Badge>
                          </div>
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value={null} disabled className="text-sm text-slate-500">
                        {formData.setor_id ? "Nenhuma categoria com saldo neste setor" : "Selecione setor primeiro"}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              ) : (
                // Na entrada, usar Select com categorias de manejo cadastradas
                <Select 
                  value={formData.categoria_animal} 
                  onValueChange={(v) => {
                    const catEncontrada = categoriasManejo.find(c => c.nome === v);
                    setFormData({ ...formData, categoria_animal: v, sexo: catEncontrada?.sexo || formData.sexo });
                    setInvalidFields((prev) => prev.filter((item) => item !== 'categoria_animal'));
                  }}
                  disabled={!formData.setor_id && formData.motivo !== "Transferência entre Setores"}
                >
                  <SelectTrigger className={getFieldClassName('categoria_animal', 'h-8 text-xs')}>
                    <SelectValue placeholder={formData.setor_id ? "Selecione" : "Selecione setor primeiro"} />
                  </SelectTrigger>
                  <SelectContent>
                    {categoriasManejo.length > 0 ? (
                      categoriasManejo.map(cat => (
                        <SelectItem key={cat.id} value={cat.nome} className="text-sm">
                          {cat.nome} {cat.sexo ? `(${cat.sexo})` : ''}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value={null} disabled className="text-sm text-slate-500">
                        Cadastre categorias primeiro
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
              {formData.tipo === "Saída" && formData.categoria_animal && formData.setor_id && (
                <div className="flex items-center gap-1 text-xs mt-1">
                  <span className="text-slate-500">Saldo no setor:</span>
                  <span className={`font-semibold ${(categoriasNoSetor.find(c => c.categoria === formData.categoria_animal)?.saldo || 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {categoriasNoSetor.find(c => c.categoria === formData.categoria_animal)?.saldo || 0} cab
                  </span>
                </div>
              )}
            </div>

            {/* Marca na Saída - baseado no SETOR + CATEGORIA selecionados */}
            {formData.tipo === "Saída" && (
              <div className="space-y-1">
                <Label className="text-xs">Marca *</Label>
                <Select 
                  value={formData.marca} 
                  onValueChange={(v) => { setFormData({ ...formData, marca: v }); setInvalidFields((prev) => prev.filter((item) => item !== 'marca')); }}
                  disabled={!formData.categoria_animal || !formData.setor_id}
                >
                  <SelectTrigger className={getFieldClassName('marca', 'h-8 text-xs')}>
                    <SelectValue placeholder={formData.categoria_animal ? "Selecione" : "Selecione categoria primeiro"} />
                  </SelectTrigger>
                  <SelectContent>
                    {marcasNoSetorCategoria.length > 0 ? (
                      marcasNoSetorCategoria.map(item => (
                        <SelectItem key={item.marca} value={item.marca} className="text-sm">
                          <div className="flex items-center justify-between w-full gap-2">
                            <span>{item.marca}</span>
                            <Badge variant="default" className="text-[10px] px-1.5 py-0">
                              {item.saldo} cab
                            </Badge>
                          </div>
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value={null} disabled className="text-sm text-slate-500">
                        {formData.categoria_animal ? "Nenhuma marca com saldo" : "Selecione categoria primeiro"}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {formData.marca && formData.categoria_animal && formData.setor_id && (
                  <div className="flex items-center gap-1 text-xs mt-1">
                    <span className="text-slate-500">Saldo:</span>
                    <span className="font-semibold text-blue-600">
                      {marcasNoSetorCategoria.find(m => m.marca === formData.marca)?.saldo || 0} cab
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Marca e Sexo apenas na Entrada */}
            {formData.tipo === "Entrada" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Marca *</Label>
                  <ComboboxComNovo
                                        value={formData.marca}
                                        onChange={(v) => { setFormData({ ...formData, marca: v }); setInvalidFields((prev) => prev.filter((item) => item !== 'marca')); }}
                                        options={marcasExistentes}
                                        placeholder="Selecione ou digite..."
                                        inputClassName="h-8 text-xs pr-2"
                                        hideIcons
                                        disabled={!formData.setor_id}
                                      />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Sexo</Label>
                  <Input
                    value={formData.sexo || ""}
                    readOnly
                    disabled
                    className="h-8 text-xs bg-slate-100 cursor-not-allowed"
                    placeholder="Definido pela categoria"
                  />
                  <p className="text-[10px] text-slate-500">Auto-preenchido</p>
                </div>
              </>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Área</Label>
              <Select 
                value={formData.tipo === "Entrada" ? formData.area_destino_id : formData.area_origem_id} 
                onValueChange={(v) => {
                  if (formData.tipo === "Entrada") {
                    setFormData({ ...formData, area_destino_id: v });
                  } else {
                    setFormData({ ...formData, area_origem_id: v });
                  }
                }}
                disabled={!formData.setor_id && formData.motivo !== "Transferência entre Setores"}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {areas.map(area => (
                    <SelectItem key={area.id} value={area.id} className="text-sm">
                      {area.sigla ? `${area.sigla} - ` : ''}{area.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          )}

          {/* Campos para Mudança de Categoria */}
          {formData.motivo === "Mudança de Categoria" && (
            <div className="p-2 bg-purple-50 border border-purple-200 rounded-lg space-y-3">
              {/* Linha 1: Categoria, Marca e Área */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Categoria Atual (De) *</Label>
                  <Select 
                    value={formData.categoria_animal} 
                    onValueChange={(v) => { setFormData({ ...formData, categoria_animal: v, marca: "" }); setInvalidFields((prev) => prev.filter((item) => item !== 'categoria_animal')); }}
                    disabled={!formData.setor_id}
                  >
                    <SelectTrigger className={getFieldClassName('categoria_animal', 'h-8 text-xs')}>
                      <SelectValue placeholder={formData.setor_id ? "De qual categoria?" : "Selecione setor primeiro"} />
                    </SelectTrigger>
                    <SelectContent>
                      {categoriasNoSetor.length > 0 ? (
                        categoriasNoSetor.map(item => (
                          <SelectItem key={item.categoria} value={item.categoria} className="text-sm">
                            <div className="flex items-center justify-between w-full gap-2">
                              <span>{item.categoria}</span>
                              <Badge variant="default" className="text-[10px] px-1.5 py-0">
                                {item.saldo} cab
                              </Badge>
                            </div>
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value={null} disabled className="text-sm text-slate-500">
                          {formData.setor_id ? "Nenhuma categoria com saldo neste setor" : "Selecione setor primeiro"}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {formData.categoria_animal && formData.setor_id && (
                    <div className="text-xs text-slate-500">
                      Saldo no setor: <span className="font-semibold">{categoriasNoSetor.find(c => c.categoria === formData.categoria_animal)?.saldo || 0} cab</span>
                    </div>
                  )}
                </div>
                
                <div className="space-y-1">
                  <Label className="text-xs">Marca *</Label>
                  <Select 
                    value={formData.marca} 
                    onValueChange={(v) => { setFormData({ ...formData, marca: v }); setInvalidFields((prev) => prev.filter((item) => item !== 'marca')); }}
                    disabled={!formData.categoria_animal || !formData.setor_id}
                  >
                    <SelectTrigger className={getFieldClassName('marca', 'h-8 text-xs')}>
                      <SelectValue placeholder={formData.categoria_animal ? "Selecione" : "Selecione categoria primeiro"} />
                    </SelectTrigger>
                    <SelectContent>
                      {marcasNoSetorCategoria.length > 0 ? (
                        marcasNoSetorCategoria.map(item => (
                          <SelectItem key={item.marca} value={item.marca} className="text-sm">
                            <div className="flex items-center justify-between w-full gap-2">
                              <span>{item.marca}</span>
                              <Badge variant="default" className="text-[10px] px-1.5 py-0">
                                {item.saldo} cab
                              </Badge>
                            </div>
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value={null} disabled className="text-sm text-slate-500">
                          {formData.categoria_animal ? "Nenhuma marca com saldo" : "Selecione categoria primeiro"}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Área</Label>
                  <Select 
                    value={formData.area_origem_id} 
                    onValueChange={(v) => setFormData({ ...formData, area_origem_id: v })}
                    disabled={!formData.setor_id}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-sm">
                          {area.sigla ? `${area.sigla} - ` : ''}{area.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Linha 2: Nova Categoria */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Nova Categoria (Para) *</Label>
                  <Select value={formData.categoria_nova} onValueChange={(v) => { setFormData({ ...formData, categoria_nova: v }); setInvalidFields((prev) => prev.filter((item) => item !== 'categoria_nova')); }}>
                    <SelectTrigger className={getFieldClassName('categoria_nova', 'h-8 text-xs')}>
                      <SelectValue placeholder="Para qual categoria?" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoriasManejo.filter(c => c.nome !== formData.categoria_animal).map(cat => (
                        <SelectItem key={cat.id} value={cat.nome} className="text-sm">
                          {cat.nome} {cat.sexo ? `(${cat.sexo})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Campos para Compra/Venda */}
          {(formData.motivo === "Compra" || formData.motivo === "Venda") && (
            <div className={`p-2 ${formData.tipo === "Entrada" ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"} border rounded-lg`}>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">{formData.tipo === "Entrada" ? "Fornecedor" : "Comprador"}</Label>
                  <ComboboxComNovo
                    value={formData.tipo === "Entrada" ? formData.fornecedor_origem : formData.destino_venda}
                    onChange={(v) => {
                      if (formData.tipo === "Entrada") {
                        setFormData({ ...formData, fornecedor_origem: v });
                      } else {
                        setFormData({ ...formData, destino_venda: v });
                      }
                    }}
                    options={formData.tipo === "Entrada" ? fornecedoresExistentes : compradoresExistentes}
                    placeholder="Selecione ou digite..."
                    inputClassName="h-8 text-xs pr-2"
                    hideIcons
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vlr Unit. (R$)</Label>
                  <Input type="number" step="0.01" value={formData.valor_unitario} onChange={(e) => setFormData({ ...formData, valor_unitario: e.target.value })} className="h-8 text-xs" placeholder="0,00" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vlr Total</Label>
                  <Input type="number" value={formData.valor_total} className="h-8 text-xs bg-slate-50" readOnly />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nota Fiscal</Label>
                  <Input value={formData.nota_fiscal} onChange={(e) => setFormData({ ...formData, nota_fiscal: e.target.value })} className="h-8 text-xs" placeholder="Nº" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">GTA</Label>
                  <Input value={formData.gta} onChange={(e) => setFormData({ ...formData, gta: e.target.value })} className="h-8 text-xs" placeholder="Nº" />
                </div>
              </div>
            </div>
          )}

          {/* Campos para Abate */}
          {formData.motivo === "Abate" && (
            <div className="p-2 bg-orange-50 border border-orange-200 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Comprador/Frigorífico</Label>
                  <ComboboxComNovo
                    value={formData.destino_venda}
                    onChange={(v) => setFormData({ ...formData, destino_venda: v })}
                    options={compradoresExistentes}
                    placeholder="Selecione ou digite..."
                    inputClassName="h-8 text-xs pr-2"
                    hideIcons
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vlr/@ (R$)</Label>
                  <Input type="number" step="0.01" value={formData.valor_unitario} onChange={(e) => setFormData({ ...formData, valor_unitario: e.target.value })} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vlr Total</Label>
                  <Input type="number" value={formData.valor_total} className="h-8 text-xs bg-slate-50" readOnly />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nota Fiscal</Label>
                  <Input value={formData.nota_fiscal} onChange={(e) => setFormData({ ...formData, nota_fiscal: e.target.value })} className="h-8 text-xs" placeholder="Nº" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">GTA</Label>
                  <Input value={formData.gta} onChange={(e) => setFormData({ ...formData, gta: e.target.value })} className="h-8 text-xs" placeholder="Nº" />
                </div>
              </div>
            </div>
          )}

          {/* Campos para Transferência entre Setores */}
          {formData.motivo === "Transferência entre Setores" && (
            <div className="p-2 bg-indigo-50 border border-indigo-200 rounded-lg">
              <p className="text-xs text-indigo-700 font-semibold mb-2">Transferência entre Setores/Fazendas (cria saída + entrada automaticamente)</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Setor de Origem *</Label>
                  <Select value={formData.setor_origem_id} onValueChange={(v) => { setFormData({ ...formData, setor_origem_id: v }); setInvalidFields((prev) => prev.filter((item) => item !== 'setor_origem_id')); }}>
                    <SelectTrigger className={getFieldClassName('setor_origem_id', 'h-8 text-xs')}>
                      <SelectValue placeholder="De onde sai" />
                    </SelectTrigger>
                    <SelectContent>
                      {setores.map(setor => {
                        const saldo = saldoPorSetor[setor.id] || 0;
                        return (
                          <SelectItem key={setor.id} value={setor.id} className="text-sm" disabled={saldo <= 0}>
                            <div className="flex items-center gap-2">
                              <span>{setor.sigla ? `${setor.sigla} - ` : ''}{setor.nome}</span>
                              <Badge variant={saldo > 0 ? 'default' : 'destructive'} className="text-[10px]">
                                {saldo} cab
                              </Badge>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {formData.setor_origem_id && (
                    <p className="text-xs text-slate-500">Saldo: <span className="font-semibold">{saldoPorSetor[formData.setor_origem_id] || 0} cab</span></p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Setor de Destino *</Label>
                  <Select value={formData.setor_destino_id} onValueChange={(v) => { setFormData({ ...formData, setor_destino_id: v }); setInvalidFields((prev) => prev.filter((item) => item !== 'setor_destino_id')); }}>
                    <SelectTrigger className={getFieldClassName('setor_destino_id', 'h-8 text-xs')}>
                      <SelectValue placeholder="Para onde vai" />
                    </SelectTrigger>
                    <SelectContent>
                      {setores.filter(s => s.id !== formData.setor_origem_id).map(setor => (
                        <SelectItem key={setor.id} value={setor.id} className="text-sm">
                          <div className="flex items-center gap-2">
                            <span>{setor.sigla ? `${setor.sigla} - ` : ''}{setor.nome}</span>
                            <Badge variant={setor.tipo === 'Próprio' ? 'default' : 'secondary'} className="text-[10px]">
                              {setor.tipo}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nota Fiscal</Label>
                  <Input value={formData.nota_fiscal} onChange={(e) => setFormData({ ...formData, nota_fiscal: e.target.value })} className="h-8 text-xs" placeholder="Nº" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">GTA</Label>
                  <Input value={formData.gta} onChange={(e) => setFormData({ ...formData, gta: e.target.value })} className="h-8 text-xs" placeholder="Nº" />
                </div>
              </div>
            </div>
          )}

          {/* Campos para Morte */}
          {formData.motivo === "Morte" && (
            <div className="p-2 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="space-y-1">
                <Label className="text-xs">Causa da Morte</Label>
                <ComboboxComNovo
                  value={formData.causa_morte}
                  onChange={(v) => setFormData({ ...formData, causa_morte: v })}
                  options={causasMorteExistentes}
                  placeholder="Selecione ou digite a causa..."
                  inputClassName="h-8 text-xs pr-2"
                  hideIcons
                />
              </div>
            </div>
          )}

          {/* Observações */}
          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={formData.observacoes}
              onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
              className="text-xs"
              placeholder="OBSERVAÇÕES ADICIONAIS..."
              rows={2}
            />
          </div>

          {/* Botões */}
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Salvando...' : (item ? 'Atualizar' : 'Salvar')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}