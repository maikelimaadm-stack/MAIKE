import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Download } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format } from "date-fns";

import FormularioArea from "../components/pecuaria/FormularioArea";
import TabelaAreas from "../components/pecuaria/TabelaAreas";

const getNextNumeroArea = async () => {
  try {
    const areas = await base44.entities.AreaPastagem.list();
    const numeros = areas.map(a => parseInt(a.numero_area) || 0).filter(n => n > 0);
    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch (error) {
    return 1;
  }
};

export default function AreasPastagem() {
  const [showForm, setShowForm] = useState(false);
  const [editingArea, setEditingArea] = useState(null);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: areas, isLoading } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list('-created_date');
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo);
    },
    initialData: [],
    enabled: !!empresaSelecionadaId,
  });

  const { data: gado = [] } = useQuery({
    queryKey: ['gado', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Gado.list();
      return all.filter(g => g.empresa_id === empresaSelecionadaId && g.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId,
  });

  useEffect(() => {
    const numerarAreas = async () => {
      const areasSemNumero = areas.filter(a => !a.numero_area || a.numero_area === '');
      
      if (areasSemNumero.length > 0) {
        for (const area of areasSemNumero) {
          try {
            const proximoNumero = await getNextNumeroArea();
            await base44.entities.AreaPastagem.update(area.id, {
              numero_area: String(proximoNumero)
            });
          } catch (error) {
            console.error(`Erro:`, error);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['areas', empresaSelecionadaId] });
      }
    };

    if (!isLoading && areas.length > 0) {
      numerarAreas();
    }
  }, [areas, queryClient, isLoading, empresaSelecionadaId]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.AreaPastagem.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas', empresaSelecionadaId] });
      setShowForm(false);
      setEditingArea(null);
      toast.success('Área cadastrada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao salvar.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AreaPastagem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas', empresaSelecionadaId] });
      setShowForm(false);
      setEditingArea(null);
      toast.success('Área atualizada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.AreaPastagem.update(id, { ativo: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas', empresaSelecionadaId] });
      toast.success('Área removida!');
    },
    onError: () => {
      toast.error('Erro.');
    }
  });

  const handleSubmit = async (data) => {
    try {
      data.empresa_id = empresaSelecionadaId;
      
      // Calcular quantidade atual de animais na área
      const animaisNaArea = gado.filter(g => g.area_atual_id === (editingArea?.id || data.id)).length;
      data.quantidade_atual = animaisNaArea;

      // Calcular status de ocupação
      const capacidade = parseFloat(data.capacidade_maxima) || 0;
      const percentual = capacidade > 0 ? (animaisNaArea / capacidade) * 100 : 0;
      
      if (percentual === 0) data.status_ocupacao = "Disponível";
      else if (percentual <= 60) data.status_ocupacao = "Médio";
      else if (percentual <= 90) data.status_ocupacao = "Alto";
      else data.status_ocupacao = "Sobrepastoreado";
      
      if (!editingArea) {
        const proximoNumero = await getNextNumeroArea();
        data.numero_area = String(proximoNumero);
      }
      
      if (editingArea) {
        await updateMutation.mutateAsync({ id: editingArea.id, data });
      } else {
        await createMutation.mutateAsync(data);
      }
    } catch (error) {
      console.error('Erro:', error);
    }
  };

  const handleEdit = (area) => {
    setEditingArea(area);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    const animaisNaArea = gado.filter(g => g.area_atual_id === id);
    if (animaisNaArea.length > 0) {
      toast.error(`❌ Área possui ${animaisNaArea.length} animal(is). Remova-os primeiro!`);
      return;
    }
    
    if (window.confirm('⚠️ Remover área?')) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const handleExport = () => {
    const csvRows = [];
    const headers = ['Nº', 'Nome', 'Tamanho (ha)', 'Capacidade', 'Atual', 'Status', 'Tipo Pastagem'];
    csvRows.push(headers.join(';'));

    areas.forEach(a => {
      const row = [
        a.numero_area,
        a.nome,
        a.tamanho_hectares,
        a.capacidade_maxima,
        a.quantidade_atual || 0,
        a.status_ocupacao,
        a.tipo_pastagem || ''
      ];
      csvRows.push(row.join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `areas_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    toast.success('Exportado!');
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Áreas e Pastagens</h1>
              <p className="text-xs text-slate-600">Gerenciar piquetes e áreas de pastejo</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleExport} variant="outline" size="sm" className="h-8 gap-1 text-xs">
                <Download className="w-3.5 h-3.5" />
                Exportar
              </Button>
              <Button onClick={() => { setEditingArea(null); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-slate-700 hover:bg-slate-800">
                <Plus className="w-3.5 h-3.5" />
                Nova Área
              </Button>
            </div>
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <FormularioArea
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingArea(null); }}
            initialData={editingArea}
            isEditing={!!editingArea}
          />
        )}
      </AnimatePresence>

      {!showForm && (
        <TabelaAreas
          areas={areas}
          gado={gado}
          onEdit={handleEdit}
          onDelete={handleDelete}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}