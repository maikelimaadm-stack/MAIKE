import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Upload, X, Save } from "lucide-react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

const ESTADOS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

export default function FormularioEmpresa({ onSubmit, onCancel, initialData, isEditing }) {
  const [formData, setFormData] = useState(initialData || {
    apelido: "",
    nome: "",
    tipo_pessoa: "Jurídica",
    cpf: "",
    rg: "",
    cnpj: "",
    inscricao_estadual: "",
    telefone: "",
    email: "",
    endereco: "",
    cidade: "",
    estado: "MT",
    cep: "",
    observacoes: "",
    logotipo_url: ""
  });

  const [uploadingLogo, setUploadingLogo] = useState(false);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingLogo(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      handleChange('logotipo_url', file_url);
      toast.success('Logotipo enviado com sucesso!');
    } catch (error) {
      toast.error('Erro ao enviar logotipo.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validações básicas
    if (!formData.apelido || !formData.nome) {
      toast.error('Preencha os campos obrigatórios!');
      return;
    }

    if (formData.tipo_pessoa === 'Jurídica' && !formData.cnpj) {
      toast.error('CNPJ é obrigatório para pessoa jurídica!');
      return;
    }

    if (formData.tipo_pessoa === 'Física' && !formData.cpf) {
      toast.error('CPF é obrigatório para pessoa física!');
      return;
    }

    // Transformar tudo em maiúsculas
    const dataToSubmit = {
      ...formData,
      apelido: formData.apelido.toUpperCase(),
      nome: formData.nome.toUpperCase(),
      cpf: formData.cpf?.toUpperCase(),
      rg: formData.rg?.toUpperCase(),
      cnpj: formData.cnpj?.toUpperCase(),
      inscricao_estadual: formData.inscricao_estadual?.toUpperCase(),
      telefone: formData.telefone?.toUpperCase(),
      email: formData.email?.toLowerCase(),
      endereco: formData.endereco?.toUpperCase(),
      cidade: formData.cidade?.toUpperCase(),
      estado: formData.estado?.toUpperCase(),
      cep: formData.cep?.toUpperCase(),
      observacoes: formData.observacoes?.toUpperCase(),
    };

    onSubmit(dataToSubmit);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="shadow-xl border-green-200">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b">
          <CardTitle className="flex items-center gap-2 text-green-900">
            <Building2 className="w-5 h-5" />
            {isEditing ? 'Editar Empresa' : 'Nova Empresa'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Logotipo */}
            <div className="space-y-2">
              <Label>Logotipo</Label>
              <div className="flex items-center gap-4">
                {formData.logotipo_url && (
                  <img 
                    src={formData.logotipo_url} 
                    alt="Logo" 
                    className="h-20 object-contain border rounded p-2"
                  />
                )}
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                    id="logo-upload"
                    disabled={uploadingLogo}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => document.getElementById('logo-upload').click()}
                    disabled={uploadingLogo}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    {uploadingLogo ? 'Enviando...' : 'Enviar Logotipo'}
                  </Button>
                </div>
              </div>
            </div>

            {/* Dados Básicos */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Apelido/Nome Fantasia *</Label>
                <Input
                  value={formData.apelido}
                  onChange={(e) => handleChange('apelido', e.target.value.toUpperCase())}
                  placeholder="FAZENDA PALMITAL"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Nome Completo/Razão Social *</Label>
                <Input
                  value={formData.nome}
                  onChange={(e) => handleChange('nome', e.target.value.toUpperCase())}
                  placeholder="MATEUS TONARQUE BERALDO"
                  required
                />
              </div>
            </div>

            {/* Tipo de Pessoa */}
            <div className="space-y-2">
              <Label>Tipo de Pessoa *</Label>
              <Select value={formData.tipo_pessoa} onValueChange={(value) => handleChange('tipo_pessoa', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Física">Pessoa Física</SelectItem>
                  <SelectItem value="Jurídica">Pessoa Jurídica</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Documentos - Pessoa Física */}
            {formData.tipo_pessoa === 'Física' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>CPF *</Label>
                  <Input
                    value={formData.cpf}
                    onChange={(e) => handleChange('cpf', e.target.value)}
                    placeholder="000.000.000-00"
                    required={formData.tipo_pessoa === 'Física'}
                  />
                </div>
                <div className="space-y-2">
                  <Label>RG</Label>
                  <Input
                    value={formData.rg}
                    onChange={(e) => handleChange('rg', e.target.value)}
                    placeholder="00.000.000-0"
                  />
                </div>
              </div>
            )}

            {/* Documentos - Pessoa Jurídica */}
            {formData.tipo_pessoa === 'Jurídica' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>CNPJ *</Label>
                  <Input
                    value={formData.cnpj}
                    onChange={(e) => handleChange('cnpj', e.target.value)}
                    placeholder="00.000.000/0000-00"
                    required={formData.tipo_pessoa === 'Jurídica'}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Inscrição Estadual</Label>
                  <Input
                    value={formData.inscricao_estadual}
                    onChange={(e) => handleChange('inscricao_estadual', e.target.value)}
                    placeholder="000.000.000.000"
                  />
                </div>
              </div>
            )}

            {/* Contato */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input
                  value={formData.telefone}
                  onChange={(e) => handleChange('telefone', e.target.value)}
                  placeholder="(00) 00000-0000"
                />
              </div>
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="exemplo@email.com"
                />
              </div>
            </div>

            {/* Endereço */}
            <div className="space-y-2">
              <Label>Endereço Completo</Label>
              <Input
                value={formData.endereco}
                onChange={(e) => handleChange('endereco', e.target.value.toUpperCase())}
                placeholder="RUA, NÚMERO, BAIRRO"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Input
                  value={formData.cidade}
                  onChange={(e) => handleChange('cidade', e.target.value.toUpperCase())}
                  placeholder="VILA BELA DA SS. TRINDADE"
                />
              </div>
              <div className="space-y-2">
                <Label>Estado</Label>
                <Select value={formData.estado} onValueChange={(value) => handleChange('estado', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESTADOS.map(uf => (
                      <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>CEP</Label>
                <Input
                  value={formData.cep}
                  onChange={(e) => handleChange('cep', e.target.value)}
                  placeholder="00000-000"
                />
              </div>
            </div>

            {/* Observações */}
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value.toUpperCase())}
                placeholder="OBSERVAÇÕES GERAIS..."
                rows={3}
              />
            </div>

            {/* Botões */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel}>
                  <X className="w-4 h-4 mr-2" />
                  Cancelar
                </Button>
              )}
              <Button type="submit" className="bg-green-600 hover:bg-green-700">
                <Save className="w-4 h-4 mr-2" />
                {isEditing ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}