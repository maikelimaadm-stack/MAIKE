import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Save, X, User, Building2, Phone, Mail, MapPin, FileText, Calendar, CreditCard, Hash } from "lucide-react";
import { motion } from "framer-motion";

export default function FormularioFornecedor({ onSubmit, onCancel, initialData = null, isEditing = false }) {
  const [tipoPessoa, setTipoPessoa] = useState(initialData?.tipo_pessoa || "Física");
  const [formData, setFormData] = useState({
    tipo_pessoa: initialData?.tipo_pessoa || "Física",
    nome: initialData?.nome || "",
    cpf: initialData?.cpf || "",
    rg: initialData?.rg || "",
    data_nascimento: initialData?.data_nascimento || "",
    cnpj: initialData?.cnpj || "",
    razao_social: initialData?.razao_social || "",
    inscricao_estadual: initialData?.inscricao_estadual || "",
    nome_responsavel: initialData?.nome_responsavel || "",
    telefone: initialData?.telefone || "",
    email: initialData?.email || "",
    endereco: initialData?.endereco || "",
    cidade: initialData?.cidade || "",
    estado: initialData?.estado || "",
    cep: initialData?.cep || "",
    observacoes: initialData?.observacoes || ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleChange = (field, value) => {
    if (field === 'tipo_pessoa') {
      setTipoPessoa(value);
    }
    
    if (typeof value === 'string' && !['email', 'cep', 'cpf', 'cnpj', 'rg', 'inscricao_estadual', 'data_nascimento', 'telefone'].includes(field)) {
      value = value.toUpperCase();
    }
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const isPessoaFisica = tipoPessoa === "Física";

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
              <Users className="w-5 h-5 text-white" />
            </div>
            {isEditing ? 'Editar Fornecedor/Cliente' : 'Novo Fornecedor/Cliente'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Tipo de Pessoa */}
            <div className="space-y-2">
              <Label className="text-slate-700 font-medium flex items-center gap-2">
                <User className="w-4 h-4 text-green-600" />
                Tipo de Pessoa *
              </Label>
              <Select value={tipoPessoa} onValueChange={(value) => handleChange('tipo_pessoa', value)} required>
                <SelectTrigger className="border-slate-300 focus:border-green-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Física">Pessoa Física</SelectItem>
                  <SelectItem value="Jurídica">Pessoa Jurídica</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Nome */}
            <div className="space-y-2">
              <Label className="text-slate-700 font-medium flex items-center gap-2">
                {isPessoaFisica ? <User className="w-4 h-4 text-blue-600" /> : <Building2 className="w-4 h-4 text-purple-600" />}
                Nome {isPessoaFisica ? 'Completo' : 'Fantasia'} *
              </Label>
              <Input
                value={formData.nome}
                onChange={(e) => handleChange('nome', e.target.value)}
                placeholder={isPessoaFisica ? "Nome completo" : "Nome fantasia"}
                required
                className="border-slate-300 focus:border-green-500 uppercase"
              />
            </div>

            {/* Campos Pessoa Física */}
            {isPessoaFisica && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-blue-600" />
                    CPF
                  </Label>
                  <Input
                    value={formData.cpf}
                    onChange={(e) => handleChange('cpf', e.target.value)}
                    placeholder="000.000.000-00"
                    className="border-slate-300 focus:border-green-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium flex items-center gap-2">
                    <Hash className="w-4 h-4 text-blue-600" />
                    RG
                  </Label>
                  <Input
                    value={formData.rg}
                    onChange={(e) => handleChange('rg', e.target.value)}
                    placeholder="00.000.000-0"
                    className="border-slate-300 focus:border-green-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-blue-600" />
                    Data de Nascimento
                  </Label>
                  <Input
                    type="date"
                    value={formData.data_nascimento}
                    onChange={(e) => handleChange('data_nascimento', e.target.value)}
                    className="border-slate-300 focus:border-green-500"
                  />
                </div>
              </div>
            )}

            {/* Campos Pessoa Jurídica */}
            {!isPessoaFisica && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-slate-700 font-medium flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-purple-600" />
                      Razão Social
                    </Label>
                    <Input
                      value={formData.razao_social}
                      onChange={(e) => handleChange('razao_social', e.target.value)}
                      placeholder="Razão social da empresa"
                      className="border-slate-300 focus:border-green-500 uppercase"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-700 font-medium flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-purple-600" />
                      CNPJ
                    </Label>
                    <Input
                      value={formData.cnpj}
                      onChange={(e) => handleChange('cnpj', e.target.value)}
                      placeholder="00.000.000/0000-00"
                      className="border-slate-300 focus:border-green-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-slate-700 font-medium flex items-center gap-2">
                      <Hash className="w-4 h-4 text-purple-600" />
                      Inscrição Estadual
                    </Label>
                    <Input
                      value={formData.inscricao_estadual}
                      onChange={(e) => handleChange('inscricao_estadual', e.target.value)}
                      placeholder="000.000.000.000"
                      className="border-slate-300 focus:border-green-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-700 font-medium flex items-center gap-2">
                      <User className="w-4 h-4 text-purple-600" />
                      Nome do Responsável
                    </Label>
                    <Input
                      value={formData.nome_responsavel}
                      onChange={(e) => handleChange('nome_responsavel', e.target.value)}
                      placeholder="Nome do responsável legal"
                      className="border-slate-300 focus:border-green-500 uppercase"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Contato */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Phone className="w-4 h-4 text-green-600" />
                  Telefone
                </Label>
                <Input
                  value={formData.telefone}
                  onChange={(e) => handleChange('telefone', e.target.value)}
                  placeholder="(00) 00000-0000"
                  className="border-slate-300 focus:border-green-500"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Mail className="w-4 h-4 text-green-600" />
                  E-mail
                </Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="email@exemplo.com"
                  className="border-slate-300 focus:border-green-500"
                />
              </div>
            </div>

            {/* Endereço */}
            <div className="space-y-2">
              <Label className="text-slate-700 font-medium flex items-center gap-2">
                <MapPin className="w-4 h-4 text-orange-600" />
                Endereço
              </Label>
              <Input
                value={formData.endereco}
                onChange={(e) => handleChange('endereco', e.target.value)}
                placeholder="Rua, número, bairro"
                className="border-slate-300 focus:border-green-500 uppercase"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-orange-600" />
                  Cidade
                </Label>
                <Input
                  value={formData.cidade}
                  onChange={(e) => handleChange('cidade', e.target.value)}
                  placeholder="Cidade"
                  className="border-slate-300 focus:border-green-500 uppercase"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-orange-600" />
                  Estado
                </Label>
                <Input
                  value={formData.estado}
                  onChange={(e) => handleChange('estado', e.target.value)}
                  placeholder="UF"
                  maxLength={2}
                  className="border-slate-300 focus:border-green-500 uppercase"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-orange-600" />
                  CEP
                </Label>
                <Input
                  value={formData.cep}
                  onChange={(e) => handleChange('cep', e.target.value)}
                  placeholder="00000-000"
                  className="border-slate-300 focus:border-green-500"
                />
              </div>
            </div>

            {/* Observações */}
            <div className="space-y-2">
              <Label className="text-slate-700 font-medium flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-600" />
                Observações
              </Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="Informações adicionais..."
                className="border-slate-300 focus:border-green-500 min-h-20 uppercase"
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
                {isEditing ? 'Atualizar' : 'Salvar'} Fornecedor
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}