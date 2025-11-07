import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Building2, Edit } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import FormularioEmpresa from "../components/empresa/FormularioEmpresa";

export default function Empresa() {
  const [showForm, setShowForm] = useState(false);

  const queryClient = useQueryClient();

  const { data: empresas, isLoading } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => base44.entities.Empresa.list(),
    initialData: [],
  });

  // Pega a primeira empresa (só deve ter uma)
  const empresaAtual = empresas.length > 0 ? empresas[0] : null;

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Empresa.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresas'] });
      setShowForm(false);
      toast.success('Dados da empresa salvos com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao salvar dados da empresa. Tente novamente.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Empresa.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresas'] });
      setShowForm(false);
      toast.success('Dados da empresa atualizados com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao atualizar dados da empresa. Tente novamente.');
    }
  });

  const handleSubmit = async (data) => {
    if (empresaAtual) {
      updateMutation.mutate({ id: empresaAtual.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = () => {
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setShowForm(false);
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
        
        {!showForm && empresaAtual && (
          <Button
            onClick={handleEdit}
            className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 gap-2 shadow-lg"
            size="lg"
          >
            <Edit className="w-5 h-5" />
            Editar Dados
          </Button>
        )}
      </div>

      {/* Formulário - Mostrar se não tem empresa ou está editando */}
      {(showForm || !empresaAtual) && (
        <AnimatePresence>
          <FormularioEmpresa
            onSubmit={handleSubmit}
            onCancel={empresaAtual ? handleCancelForm : null}
            initialData={empresaAtual}
            isEditing={!!empresaAtual}
          />
        </AnimatePresence>
      )}

      {/* Visualização da Empresa Atual */}
      {!showForm && empresaAtual && (
        <Card className="shadow-lg border-green-200 bg-white">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b">
            <CardTitle className="text-green-900">Dados Cadastrados</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {empresaAtual.logotipo_url && (
                <div className="col-span-2">
                  <label className="text-sm font-medium text-slate-600">Logotipo</label>
                  <img 
                    src={empresaAtual.logotipo_url} 
                    alt="Logotipo"
                    className="h-24 object-contain mt-2"
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
              
              {empresaAtual.tipo_pessoa === 'Física' && empresaAtual.rg && (
                <div>
                  <label className="text-sm font-medium text-slate-600">RG</label>
                  <p className="text-slate-900">{empresaAtual.rg}</p>
                </div>
              )}
              
              {empresaAtual.tipo_pessoa === 'Jurídica' && empresaAtual.cnpj && (
                <div>
                  <label className="text-sm font-medium text-slate-600">CNPJ</label>
                  <p className="text-slate-900">{empresaAtual.cnpj}</p>
                </div>
              )}
              
              {empresaAtual.tipo_pessoa === 'Jurídica' && empresaAtual.inscricao_estadual && (
                <div>
                  <label className="text-sm font-medium text-slate-600">Inscrição Estadual</label>
                  <p className="text-slate-900">{empresaAtual.inscricao_estadual}</p>
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
              
              {empresaAtual.endereco && (
                <div className="col-span-2">
                  <label className="text-sm font-medium text-slate-600">Endereço</label>
                  <p className="text-slate-900">{empresaAtual.endereco}</p>
                </div>
              )}
              
              {empresaAtual.cidade && (
                <div>
                  <label className="text-sm font-medium text-slate-600">Cidade/Estado</label>
                  <p className="text-slate-900">{empresaAtual.cidade} - {empresaAtual.estado}</p>
                </div>
              )}
              
              {empresaAtual.cep && (
                <div>
                  <label className="text-sm font-medium text-slate-600">CEP</label>
                  <p className="text-slate-900">{empresaAtual.cep}</p>
                </div>
              )}
              
              {empresaAtual.observacoes && (
                <div className="col-span-2">
                  <label className="text-sm font-medium text-slate-600">Observações</label>
                  <p className="text-slate-900">{empresaAtual.observacoes}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mensagem se não há empresa */}
      {!showForm && !empresaAtual && isLoading && (
        <Card className="shadow-lg border-slate-200 bg-white">
          <CardContent className="p-8 text-center">
            <Building2 className="w-16 h-16 text-slate-400 mx-auto mb-4 animate-pulse" />
            <h3 className="text-xl font-bold text-slate-900 mb-2">Carregando...</h3>
          </CardContent>
        </Card>
      )}
    </div>
  );
}