import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Download, Upload, FileSpreadsheet } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format } from "date-fns";

import FormularioGado from "../components/pecuaria/FormularioGado";
import TabelaGado from "../components/pecuaria/TabelaGado";

const getNextSystemNumber = async () => {
  try {
    const [pesagens, fornecedores, produtos, gado] = await Promise.all([
      base44.entities.Pesagem.list(),
      base44.entities.Fornecedor.list(),
      base44.entities.Produto.list(),
      base44.entities.Gado.list()
    ]);

    const numeros = [
      ...pesagens.map(p => parseInt(p.numero_registro) || 0),
      ...fornecedores.map(f => parseInt(f.numero_cadastro) || 0),
      ...produtos.map(p => parseInt(p.numero_produto) || 0),
      ...gado.map(g => parseInt(g.numero_animal) || 0)
    ].filter(n => n > 0 && n < 1000000000);

    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch (error) {
    console.error('Erro:', error);
    return 1;
  }
};

export default function CadastroGado() {
  const [showForm, setShowForm] = useState(false);
  const [editingGado, setEditingGado] = useState(null);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: gado, isLoading } = useQuery({
    queryKey: ['gado', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Gado.list('-created_date');
      return all.filter(g => g.empresa_id === empresaSelecionadaId && g.status === 'Ativo');
    },
    initialData: [],
    enabled: !!empresaSelecionadaId,
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo);
    },
    enabled: !!empresaSelecionadaId,
  });

  useEffect(() => {
    const numerarGado = async () => {
      const gadoSemNumero = gado.filter(g => !g.numero_animal || g.numero_animal === '');
      
      if (gadoSemNumero.length > 0) {
        for (const animal of gadoSemNumero) {
          try {
            const proximoNumero = await getNextSystemNumber();
            await base44.entities.Gado.update(animal.id, {
              numero_animal: String(proximoNumero)
            });
          } catch (error) {
            console.error(`Erro:`, error);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['gado', empresaSelecionadaId] });
      }
    };

    if (!isLoading && gado.length > 0) {
      numerarGado();
    }
  }, [gado, queryClient, isLoading, empresaSelecionadaId]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Gado.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gado', empresaSelecionadaId] });
      queryClient.invalidateQueries({ queryKey: ['areas', empresaSelecionadaId] });
      setShowForm(false);
      setEditingGado(null);
      toast.success('Animal cadastrado!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao salvar.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Gado.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gado', empresaSelecionadaId] });
      queryClient.invalidateQueries({ queryKey: ['areas', empresaSelecionadaId] });
      setShowForm(false);
      setEditingGado(null);
      toast.success('Animal atualizado!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Gado.update(id, { status: 'Morto' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gado', empresaSelecionadaId] });
      toast.success('Animal removido!');
    },
    onError: () => {
      toast.error('Erro.');
    }
  });

  const handleSubmit = async (data) => {
    try {
      data.empresa_id = empresaSelecionadaId;
      
      if (!editingGado) {
        const proximoNumero = await getNextSystemNumber();
        data.numero_animal = String(proximoNumero);
      }
      
      if (editingGado) {
        await updateMutation.mutateAsync({ id: editingGado.id, data });
      } else {
        await createMutation.mutateAsync(data);
      }
    } catch (error) {
      console.error('Erro:', error);
    }
  };

  const handleEdit = (animal) => {
    setEditingGado(animal);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm('⚠️ Remover animal?')) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const handleExport = () => {
    const csvRows = [];
    const headers = ['Nº', 'Nome', 'Categoria', 'Sexo', 'Idade', 'Peso', 'Lote', 'Área', 'Sistema'];
    csvRows.push(headers.join(';'));

    gado.forEach(g => {
      const area = areas.find(a => a.id === g.area_atual_id);
      const row = [
        g.numero_animal,
        g.nome,
        g.categoria,
        g.sexo,
        g.idade_meses || '',
        g.peso_kg || '',
        g.lote || '',
        area?.nome || '',
        g.sistema_produtivo || ''
      ];
      csvRows.push(row.join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `gado_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    toast.success('Exportado!');
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Cadastro de Gado</h1>
              <p className="text-xs text-slate-600">Gerenciar animais e lotes</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleExport} variant="outline" size="sm" className="h-8 gap-1 text-xs">
                <Download className="w-3.5 h-3.5" />
                Exportar
              </Button>
              <Button onClick={() => { setEditingGado(null); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-slate-700 hover:bg-slate-800">
                <Plus className="w-3.5 h-3.5" />
                Novo Animal
              </Button>
            </div>
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <FormularioGado
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingGado(null); }}
            initialData={editingGado}
            isEditing={!!editingGado}
            areas={areas}
          />
        )}
      </AnimatePresence>

      {!showForm && (
        <TabelaGado
          gado={gado}
          areas={areas}
          onEdit={handleEdit}
          onDelete={handleDelete}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}