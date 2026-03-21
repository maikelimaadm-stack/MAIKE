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
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {isEditing ? 'Editar Empresa' : 'Nova Empresa'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Logotipo</Label>
              <div className="flex items-center gap-4">
                {formData.logotipo_url && (
                  <img 
                    src={formData.logotipo_url} 
                    alt="Logo" 
                    className="h-16 object-contain border rounded p-2"
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
                    size="sm"
                    onClick={() => document.getElementById('logo-upload').click()}
                    disabled={uploadingLogo}
                    className="h-8 text-xs"
                  >
                    {uploadingLogo ? 'Enviando...' : 'Enviar'}
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Apelido *</Label>
                <Input
                  value={formData.apelido}
                  onChange={(e) => handleChange('apelido', e.target.value)}
                  placeholder="FAZENDA PALMITAL"
                  required
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nome/Razão Social *</Label>
                <Input
                  value={formData.nome}
                  onChange={(e) => handleChange('nome', e.target.value)}
                  placeholder="NOME COMPLETO"
                  required
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo *</Label>
                <Select value={formData.tipo_pessoa} onValueChange={(value) => handleChange('tipo_pessoa', value)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Física" className="text-xs">Pessoa Física</SelectItem>
                    <SelectItem value="Jurídica" className="text-xs">Pessoa Jurídica</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.tipo_pessoa === 'Física' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">CPF *</Label>
                  <Input
                    value={formData.cpf}
                    onChange={(e) => handleChange('cpf', e.target.value)}
                    placeholder="000.000.000-00"
                    required
                    className="h-8 text-xs"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">RG</Label>
                  <Input
                    value={formData.rg}
                    onChange={(e) => handleChange('rg', e.target.value)}
                    placeholder="00.000.000-0"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}

            {formData.tipo_pessoa === 'Jurídica' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">CNPJ *</Label>
                  <Input
                    value={formData.cnpj}
                    onChange={(e) => handleChange('cnpj', e.target.value)}
                    placeholder="00.000.000/0000-00"
                    required
                    className="h-8 text-xs"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Inscrição Estadual</Label>
                  <Input
                    value={formData.inscricao_estadual}
                    onChange={(e) => handleChange('inscricao_estadual', e.target.value)}
                    placeholder="000.000.000.000"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Telefone</Label>
                <Input
                  value={formData.telefone}
                  onChange={(e) => handleChange('telefone', e.target.value)}
                  placeholder="(00) 00000-0000"
                  className="h-8 text-xs"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">E-mail</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="exemplo@email.com"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="col-span-3 space-y-1">
                <Label className="text-xs">Endereço Completo</Label>
                <Input
                  value={formData.endereco}
                  onChange={(e) => handleChange('endereco', e.target.value)}
                  placeholder="RUA, NÚMERO, BAIRRO"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Cidade</Label>
                <Input
                  value={formData.cidade}
                  onChange={(e) => handleChange('cidade', e.target.value)}
                  placeholder="CIDADE"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Estado</Label>
                <Select value={formData.estado} onValueChange={(value) => handleChange('estado', value)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESTADOS.map(uf => (
                      <SelectItem key={uf} value={uf} className="text-xs">{uf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CEP</Label>
                <Input
                  value={formData.cep}
                  onChange={(e) => handleChange('cep', e.target.value)}
                  placeholder="00000-000"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Observações</Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="OBSERVAÇÕES GERAIS..."
                className="text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
              )}
              <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                {isEditing ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}