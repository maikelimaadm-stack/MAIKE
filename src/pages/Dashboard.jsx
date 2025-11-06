import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, TrendingUp, Package, Truck } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import FormularioPesagem from "../components/pesagens/FormularioPesagem";
import TabelaPesagens from "../components/pesagens/TabelaPesagens";
import TicketPesagem from "../components/pesagens/TicketPesagem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export default function Dashboard() {
  const [showForm, setShowForm] = useState(false);
  const [editingPesagem, setEditingPesagem] = useState(null);
  const [ticketPesagem, setTicketPesagem] = useState(null);

  const queryClient = useQueryClient();

  const { data: pesagens, isLoading } = useQuery({
    queryKey: ['pesagens'],
    queryFn: () => base44.entities.Pesagem.list('-created_date'),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Pesagem.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pesagens'] });
      setShowForm(false);
      setEditingPesagem(null);
      toast.success('Pesagem registrada com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao salvar pesagem. Tente novamente.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Pesagem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pesagens'] });
      setShowForm(false);
      setEditingPesagem(null);
      toast.success('Pesagem atualizada com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao atualizar pesagem. Tente novamente.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Pesagem.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pesagens'] });
      toast.success('Pesagem excluída com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao excluir pesagem. Tente novamente.');
    }
  });

  const handleSubmit = (data) => {
    if (editingPesagem) {
      updateMutation.mutate({ id: editingPesagem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (pesagem) => {
    setEditingPesagem(pesagem);
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Tem certeza que deseja excluir esta pesagem?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleDuplicate = (pesagem) => {
    const { id, created_date, updated_date, created_by, ...dadosSemId } = pesagem;
    setEditingPesagem(dadosSemId);
    setShowForm(true);
    toast.info('Registro duplicado. Edite e salve.');
  };

  const handlePrint = (pesagem) => {
    setTicketPesagem(pesagem);
  };

  const handleNewPesagem = () => {
    setEditingPesagem(null);
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingPesagem(null);
  };

  const totalPesoLiquido = pesagens.reduce((sum, p) => sum + (p.peso_liquido || 0), 0);
  const totalPesagens = pesagens.length;
  const pesagensHoje = pesagens.filter(p => {
    const hoje = new Date().toISOString().split('T')[0];
    return p.data_pesagem === hoje;
  }).length;

  return (
    <div className="p-6 space-y-6">
      {/* Cards de Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Total de Pesagens</CardTitle>
            <Package className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">{totalPesagens}</div>
            <p className="text-xs text-green-600 mt-1">Registros no sistema</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-emerald-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Peso Total Líquido</CardTitle>
            <TrendingUp className="h-5 w-5 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-900">{formatarNumero(totalPesoLiquido)} kg</div>
            <p className="text-xs text-emerald-600 mt-1">Soma de todas as pesagens</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-teal-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Pesagens Hoje</CardTitle>
            <Truck className="h-5 w-5 text-teal-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-teal-900">{pesagensHoje}</div>
            <p className="text-xs text-teal-600 mt-1">Registros de hoje</p>
          </CardContent>
        </Card>
      </div>

      {/* Botão Nova Pesagem */}
      {!showForm && (
        <div className="flex justify-end">
          <Button
            onClick={handleNewPesagem}
            className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg"
            size="lg"
          >
            <Plus className="w-5 h-5" />
            Nova Pesagem
          </Button>
        </div>
      )}

      {/* Formulário */}
      <AnimatePresence>
        {showForm && (
          <FormularioPesagem
            onSubmit={handleSubmit}
            onCancel={handleCancelForm}
            initialData={editingPesagem}
            isEditing={!!editingPesagem}
          />
        )}
      </AnimatePresence>

      {/* Tabela */}
      <TabelaPesagens
        pesagens={pesagens}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onPrint={handlePrint}
        isLoading={isLoading}
      />

      {/* Modal de Ticket */}
      <TicketPesagem
        pesagem={ticketPesagem}
        open={!!ticketPesagem}
        onClose={() => setTicketPesagem(null)}
      />
    </div>
  );
}