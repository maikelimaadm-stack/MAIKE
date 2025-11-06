
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, TrendingUp, Package, Truck, Download, Upload, FileSpreadsheet } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import * as XLSX from 'xlsx';
import { format } from "date-fns";

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
    onError: (error) => {
      console.error("Erro ao salvar pesagem:", error);
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
    onError: (error) => {
      console.error("Erro ao atualizar pesagem:", error);
      toast.error('Erro ao atualizar pesagem. Tente novamente.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Pesagem.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pesagens'] });
      toast.success('Pesagem excluída com sucesso!');
    },
    onError: (error) => {
      console.error("Erro ao excluir pesagem:", error);
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

  const handleExport = () => {
    const dadosExcel = pesagens.map(p => ({
      'Data': format(new Date(p.data_pesagem), 'dd/MM/yyyy'),
      'Tipo': p.tipo_pesagem,
      'Placa': p.placa_caminhao,
      'Motorista': p.nome_motorista,
      'Produto': p.produto,
      'Fornecedor/Destino': p.fornecedor_destino || '',
      'Peso Tara (kg)': p.peso_tara,
      'Peso Bruto (kg)': p.peso_bruto,
      'Peso Líquido (kg)': p.peso_liquido,
      'Observações': p.observacoes || ''
    }));

    const ws = XLSX.utils.json_to_sheet(dadosExcel);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pesagens');
    XLSX.writeFile(wb, `pesagens_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.xlsx`);
    toast.success('Dados exportados com sucesso!');
  };

  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        // raw: false to get formatted values (e.g., dates as strings), dateNF for specific date format
        const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false, dateNF: 'dd/MM/yyyy' });
        
        let importedCount = 0;
        for (const row of jsonData) {
          let parsedDate = null;
          if (row['Data']) {
              const dateStr = String(row['Data']);
              const parts = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // dd/MM/yyyy
              if (parts) {
                  parsedDate = `${parts[3]}-${parts[2]}-${parts[1]}`; // YYYY-MM-DD
              } else {
                  const d = new Date(dateStr);
                  if (!isNaN(d.getTime())) {
                      parsedDate = format(d, 'yyyy-MM-dd');
                  }
              }
          }

          const pesagem = {
            data_pesagem: parsedDate,
            tipo_pesagem: row['Tipo'],
            placa_caminhao: row['Placa'],
            nome_motorista: row['Motorista'],
            produto: row['Produto'],
            fornecedor_destino: row['Fornecedor/Destino'] || null,
            peso_tara: parseFloat(String(row['Peso Tara (kg)']).replace(',', '.')),
            peso_bruto: parseFloat(String(row['Peso Bruto (kg)']).replace(',', '.')),
            peso_liquido: parseFloat(String(row['Peso Líquido (kg)']).replace(',', '.')),
            observacoes: row['Observações'] || null
          };

          // Basic validation for required fields
          if (!pesagem.data_pesagem || !pesagem.tipo_pesagem || !pesagem.placa_caminhao || !pesagem.nome_motorista || !pesagem.produto || isNaN(pesagem.peso_tara) || isNaN(pesagem.peso_bruto) || isNaN(pesagem.peso_liquido)) {
            toast.warning(`Linha ignorada devido a dados inválidos ou incompletos: ${JSON.stringify(row)}`);
            continue;
          }

          try {
            await base44.entities.Pesagem.create(pesagem);
            importedCount++;
          } catch (createError) {
            console.error("Erro ao criar pesagem na linha:", row, createError);
            toast.error(`Falha ao importar pesagem: ${row['Placa']} - ${createError.message}`);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['pesagens'] });
        toast.success(`${importedCount} pesagens importadas com sucesso!`);
      } catch (error) {
        console.error('Erro ao importar dados:', error);
        toast.error('Erro ao importar dados. Verifique o arquivo e o formato das colunas. ' + error.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const downloadTemplate = () => {
    const template = [{
      'Data': format(new Date(), 'dd/MM/yyyy'),
      'Tipo': 'Entrada',
      'Placa': 'ABC1234',
      'Motorista': 'João Silva',
      'Produto': 'Soja',
      'Fornecedor/Destino': 'Fornecedor Exemplo',
      'Peso Tara (kg)': 5000,
      'Peso Bruto (kg)': 25000,
      'Peso Líquido (kg)': 20000,
      'Observações': 'Observações exemplo'
    }];

    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Modelo');
    XLSX.writeFile(wb, 'modelo_pesagens.xlsx');
    toast.info('Modelo de importação baixado.');
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

      {/* Botões */}
      {!showForm && (
        <div className="flex justify-between items-center">
          <div className="flex gap-3">
            <Button
              onClick={handleExport}
              variant="outline"
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              Exportar Excel
            </Button>
            <div>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleImport}
                className="hidden"
                id="import-pesagens"
              />
              <Button
                onClick={() => document.getElementById('import-pesagens').click()}
                variant="outline"
                className="gap-2"
              >
                <Upload className="w-4 h-4" />
                Importar Excel
              </Button>
            </div>
            <Button
              onClick={downloadTemplate}
              variant="outline"
              className="gap-2"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Baixar Modelo
            </Button>
          </div>
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
