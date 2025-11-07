import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Building2, Upload, Loader2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import FormularioEmpresa from "../components/empresa/FormularioEmpresa";

export default function Empresa() {
  const [showForm, setShowForm] = useState(false);
  const [editingEmpresa, setEditingEmpresa] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const queryClient = useQueryClient();

  const { data: empresas, isLoading } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => base44.entities.Empresa.list(),
    initialData: [],
  });

  // Normalmente só teremos 1 empresa cadastrada
  const empresaAtual = empresas.length > 0 ? empresas[0] : null;

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Empresa.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresas'] });
      setShowForm(false);
      setEditingEmpresa(null);
      toast.success('Empresa cadastrada com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao salvar empresa. Tente novamente.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Empresa.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresas'] });
      setShowForm(false);
      setEditingEmpresa(null);
      toast.success('Empresa atualizada com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao atualizar empresa. Tente novamente.');
    }
  });

  const handleSubmit = async (data) => {
    if (editingEmpresa || empresaAtual) {
      updateMutation.mutate({ id: (editingEmpresa || empresaAtual).id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = () => {
    setEditingEmpresa(empresaAtual);
    setShowForm(true);
  };

  const handleNew = () => {
    setEditingEmpresa(null);
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingEmpresa(null);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center shadow-lg">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-green-900">Dados da Empresa</h1>
            <p className="text-green-700">Configure as informações da sua empresa</p>
          </div>
        </div>
        
        {!showForm && (
          <Button
            onClick={empresaAtual ? handleEdit : handleNew}
            className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg"
            size="lg"
          >
            <Plus className="w-5 h-5" />
            {empresaAtual ? 'Editar Empresa' : 'Cadastrar Empresa'}
          </Button>
        )}
      </div>

      {/* Visualização da Empresa Atual */}
      {!showForm && empresaAtual && (
        <Card className="shadow-lg border-green-200 bg-white">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b">
            <CardTitle className="text-green-900">Empresa Cadastrada</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {empresaAtual.logotipo_url && (
                <div className="col-span-2">
                  <img 
                    src={empresaAtual.logotipo_url} 
                    alt="Logotipo"
                    className="h-24 object-contain"
                  />
                </div>
              )}
              
              <div>
                <label className="text-sm font-medium text-slate-600">Apelido/Nome Fantasia</label>
                <p className="text-lg font-bold text-slate-900">{empresaAtual.apelido}</p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-slate-600">Nome Completo/Razão Social</label>
                <p className="text-lg font-bold text-slate-900">{empresaAtual.nome}</p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-slate-600">Tipo de Pessoa</label>
                <p className="text-slate-900">{empresaAtual.tipo_pessoa}</p>
              </div>
              
              {empresaAtual.tipo_pessoa === 'Física' && empresaAtual.cpf && (
                <div>
                  <label className="text-sm font-medium text-slate-600">CPF</label>
                  <p className="text-slate-900">{empresaAtual.cpf}</p>
                </div>
              )}
              
              {empresaAtual.tipo_pessoa === 'Jurídica' && empresaAtual.cnpj && (
                <div>
                  <label className="text-sm font-medium text-slate-600">CNPJ</label>
                  <p className="text-slate-900">{empresaAtual.cnpj}</p>
                </div>
              )}
              
              {empresaAtual.telefone && (
                <div>
                  <label className="text-sm font-medium text-slate-600">Telefone</label>
                  <p className="text-slate-900">{empresaAtual.telefone}</p>
                </div>
              )}
              
              {empresaAtual.email && (
                <div>
                  <label className="text-sm font-medium text-slate-600">E-mail</label>
                  <p className="text-slate-900">{empresaAtual.email}</p>
                </div>
              )}
              
              {empresaAtual.cidade && (
                <div>
                  <label className="text-sm font-medium text-slate-600">Cidade</label>
                  <p className="text-slate-900">{empresaAtual.cidade} - {empresaAtual.estado}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mensagem se não há empresa */}
      {!showForm && !empresaAtual && (
        <Card className="shadow-lg border-orange-200 bg-orange-50">
          <CardContent className="p-8 text-center">
            <Building2 className="w-16 h-16 text-orange-600 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-orange-900 mb-2">Nenhuma empresa cadastrada</h3>
            <p className="text-orange-700 mb-4">Cadastre os dados da sua empresa para começar</p>
          </CardContent>
        </Card>
      )}

      {/* Formulário */}
      <AnimatePresence>
        {showForm && (
          <FormularioEmpresa
            onSubmit={handleSubmit}
            onCancel={handleCancelForm}
            initialData={editingEmpresa || empresaAtual}
            isEditing={!!(editingEmpresa || empresaAtual)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}