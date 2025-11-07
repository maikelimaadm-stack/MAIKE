import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Save, X, Upload, Loader2, Image as ImageIcon } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

export default function FormularioEmpresa({ onSubmit, onCancel, initialData = null, isEditing = false }) {
  const [formData, setFormData] = useState({
    apelido: initialData?.apelido?.toUpperCase() || "",
    tipo_pessoa: initialData?.tipo_pessoa || "",
    nome: initialData?.nome?.toUpperCase() || "",
    cpf: initialData?.cpf || "",
    rg: initialData?.rg || "",
    data_nascimento: initialData?.data_nascimento || "",
    cnpj: initialData?.cnpj || "",
    razao_social: initialData?.razao_social?.toUpperCase() || "",
    inscricao_estadual: initialData?.inscricao_estadual || "",
    nome_responsavel: initialData?.nome_responsavel?.toUpperCase() || "",
    logotipo_url: initialData?.logotipo_url || "",
    telefone: initialData?.telefone || "",
    email: initialData?.email || "",
    endereco: initialData?.endereco?.toUpperCase() || "",
    cidade: initialData?.cidade?.toUpperCase() || "",
    estado: initialData?.estado?.toUpperCase() || "",
    cep: initialData?.cep || "",
    observacoes: initialData?.observacoes?.toUpperCase() || ""
  });

  const [uploadingLogo, setUploadingLogo] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleChange = (field, value) => {
    let processedValue = value;
    if (['apelido', 'nome', 'razao_social', 'nome_responsavel', 'endereco', 'cidade', 'estado', 'observacoes'].includes(field) && typeof value === 'string') {
      processedValue = value.toUpperCase();
    }
    setFormData(prev => ({ ...prev, [field]: processedValue }));
  };

  const handleLogoUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validar tipo de arquivo
    if (!file.type.startsWith('image/')) {
      toast.error('Por favor, selecione uma imagem válida!');
      return;
    }

    // Validar tamanho (máx 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 5MB!');
      return;
    }

    setUploadingLogo(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      handleChange('logotipo_url', file_url);
      toast.success('Logotipo carregado com sucesso!');
    } catch (error) {
      console.error('Erro ao fazer upload:', error);
      toast.error('Erro ao fazer upload do logotipo. Tente novamente.');
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="shadow-xl border-slate-200 bg-white">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            {isEditing ? 'Editar Empresa' : 'Cadastrar Empresa'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Upload de Logotipo */}
            <div className="space-y-2">
              <Label className="text-slate-700 font-medium flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-purple-600" />
                Logotipo da Empresa
              </Label>
              <div className="flex items-center gap-4">
                {formData.logotipo_url && (
                  <img 
                    src={formData.logotipo_url} 
                    alt="Logotipo"
                    className="h-20 object-contain border rounded-lg p-2"
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
                    className="gap-2"
                  >
                    {uploadingLogo ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {uploadingLogo ? 'Enviando...' : 'Carregar Logotipo'}
                  </Button>
                  <p className="text-xs text-slate-500 mt-1">PNG, JPG ou JPEG (máx. 5MB)</p>
                </div>
              </div>
            </div>

            {/* Apelido e Tipo de Pessoa */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Apelido/Nome Fantasia *</Label>
                <Input
                  value={formData.apelido}
                  onChange={(e) => handleChange('apelido', e.target.value)}
                  placeholder="FAZENDA PALMITAL"
                  required
                  className="uppercase"
                />
              </div>

              <div className="space-y-2">
                <Label>Tipo de Pessoa *</Label>
                <Select value={formData.tipo_pessoa} onValueChange={(value) => handleChange('tipo_pessoa', value)} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Física">Pessoa Física</SelectItem>
                    <SelectItem value="Jurídica">Pessoa Jurídica</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Nome Completo/Razão Social */}
            <div className="space-y-2">
              <Label>Nome Completo / Razão Social *</Label>
              <Input
                value={formData.nome}
                onChange={(e) => handleChange('nome', e.target.value)}
                placeholder={formData.tipo_pessoa === 'Física' ? 'NOME COMPLETO' : 'RAZÃO SOCIAL'}
                required
                className="uppercase"
              />
            </div>

            {/* Campos específicos para Pessoa Física */}
            {formData.tipo_pessoa === 'Física' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label>CPF</Label>
                  <Input
                    value={formData.cpf}
                    onChange={(e) => handleChange('cpf', e.target.value)}
                    placeholder="000.000.000-00"
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
                <div className="space-y-2">
                  <Label>Data de Nascimento</Label>
                  <Input
                    type="date"
                    value={formData.data_nascimento}
                    onChange={(e) => handleChange('data_nascimento', e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Campos específicos para Pessoa Jurídica */}
            {formData.tipo_pessoa === 'Jurídica' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>CNPJ</Label>
                    <Input
                      value={formData.cnpj}
                      onChange={(e) => handleChange('cnpj', e.target.value)}
                      placeholder="00.000.000/0000-00"
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
                <div className="space-y-2">
                  <Label>Nome do Responsável</Label>
                  <Input
                    value={formData.nome_responsavel}
                    onChange={(e) => handleChange('nome_responsavel', e.target.value)}
                    placeholder="NOME DO RESPONSÁVEL PELA EMPRESA"
                    className="uppercase"
                  />
                </div>
              </div>
            )}

            {/* Contato */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                onChange={(e) => handleChange('endereco', e.target.value)}
                placeholder="RUA, NÚMERO, COMPLEMENTO, BAIRRO"
                className="uppercase"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Input
                  value={formData.cidade}
                  onChange={(e) => handleChange('cidade', e.target.value)}
                  placeholder="VILA BELA DA SANTISSIMA TRINDADE"
                  className="uppercase"
                />
              </div>
              <div className="space-y-2">
                <Label>Estado (UF)</Label>
                <Input
                  value={formData.estado}
                  onChange={(e) => handleChange('estado', e.target.value)}
                  placeholder="MT"
                  maxLength={2}
                  className="uppercase"
                />
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
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="OBSERVAÇÕES GERAIS SOBRE A EMPRESA..."
                className="uppercase min-h-20"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
                  <X className="w-4 h-4" />
                  Cancelar
                </Button>
              )}
              <Button type="submit" className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg">
                <Save className="w-4 h-4" />
                {isEditing ? 'Atualizar' : 'Salvar'} Empresa
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}