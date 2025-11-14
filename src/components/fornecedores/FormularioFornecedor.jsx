import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Save, X, User, Building2, Phone, Mail, MapPin, FileText, Calendar, CreditCard, Hash } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

// Validação de CPF
const validarCPF = (cpf) => {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  
  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += parseInt(cpf.charAt(i)) * (10 - i);
  }
  let resto = 11 - (soma % 11);
  let digito1 = resto > 9 ? 0 : resto;
  
  if (parseInt(cpf.charAt(9)) !== digito1) return false;
  
  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += parseInt(cpf.charAt(i)) * (11 - i);
  }
  resto = 11 - (soma % 11);
  let digito2 = resto > 9 ? 0 : resto;
  
  return parseInt(cpf.charAt(10)) === digito2;
};

// Validação de CNPJ
const validarCNPJ = (cnpj) => {
  cnpj = cnpj.replace(/\D/g, '');
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  
  let tamanho = cnpj.length - 2;
  let numeros = cnpj.substring(0, tamanho);
  let digitos = cnpj.substring(tamanho);
  let soma = 0;
  let pos = tamanho - 7;
  
  for (let i = tamanho; i >= 1; i--) {
    soma += numeros.charAt(tamanho - i) * pos--;
    if (pos < 2) pos = 9;
  }
  
  let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (resultado != digitos.charAt(0)) return false;
  
  tamanho = tamanho + 1;
  numeros = cnpj.substring(0, tamanho);
  soma = 0;
  pos = tamanho - 7;
  
  for (let i = tamanho; i >= 1; i--) {
    soma += numeros.charAt(tamanho - i) * pos--;
    if (pos < 2) pos = 9;
  }
  
  resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  return resultado == digitos.charAt(1);
};

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
    codigo_ibge: initialData?.codigo_ibge || "",
    estado: initialData?.estado || "",
    cep: initialData?.cep || "",
    observacoes: initialData?.observacoes || ""
  });

  const { data: cidades = [] } = useQuery({
    queryKey: ['cidades'],
    queryFn: async () => {
      const cidadesList = await base44.entities.Cidade.list('nome');
      return cidadesList;
    },
    initialData: [],
  });

  const cidadesFiltradas = cidades.filter(c => c.estado === formData.estado);

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validar CPF para pessoa física
    if (tipoPessoa === "Física" && formData.cpf) {
      const cpfLimpo = formData.cpf.replace(/\D/g, '');
      if (cpfLimpo.length > 0) {
        if (cpfLimpo.length !== 11) {
          toast.error('❌ CPF deve ter 11 dígitos!');
          return;
        }
        if (!validarCPF(cpfLimpo)) {
          toast.error('❌ CPF inválido!');
          return;
        }
      }
    }
    
    // Validar CNPJ para pessoa jurídica
    if (tipoPessoa === "Jurídica" && formData.cnpj) {
      const cnpjLimpo = formData.cnpj.replace(/\D/g, '');
      if (cnpjLimpo.length > 0) {
        if (cnpjLimpo.length !== 14) {
          toast.error('❌ CNPJ deve ter 14 dígitos!');
          return;
        }
        if (!validarCNPJ(cnpjLimpo)) {
          toast.error('❌ CNPJ inválido!');
          return;
        }
      }
    }
    
    onSubmit(formData);
  };

  const handleChange = (field, value) => {
    if (field === 'tipo_pessoa') {
      setTipoPessoa(value);
    }
    
    if (field === 'estado') {
      setFormData(prev => ({ ...prev, estado: value, cidade: "", codigo_ibge: "" }));
      return;
    }

    if (field === 'cidade') {
      const cidadeSelecionada = cidades.find(c => c.nome === value && c.estado === formData.estado);
      setFormData(prev => ({ 
        ...prev, 
        cidade: value,
        codigo_ibge: cidadeSelecionada?.codigo_ibge || ""
      }));
      return;
    }
    
    if (typeof value === 'string' && !['email', 'cep', 'cpf', 'cnpj', 'rg', 'inscricao_estadual', 'data_nascimento', 'telefone', 'codigo_ibge'].includes(field)) {
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
                    maxLength={14}
                    className="border-slate-300 focus:border-green-500"
                  />
                  <p className="text-xs text-slate-500">11 dígitos obrigatórios</p>
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
                      maxLength={18}
                      className="border-slate-300 focus:border-green-500"
                    />
                    <p className="text-xs text-slate-500">14 dígitos obrigatórios</p>
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

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-orange-600" />
                  Estado
                </Label>
                <Select value={formData.estado} onValueChange={(v) => handleChange('estado', v)}>
                  <SelectTrigger className="border-slate-300 focus:border-green-500">
                    <SelectValue placeholder="Selecione o estado" />
                  </SelectTrigger>
                  <SelectContent>
                    {['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'].map(uf => (
                      <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-orange-600" />
                  Cidade
                </Label>
                <Select 
                  value={formData.cidade} 
                  onValueChange={(v) => handleChange('cidade', v)}
                  disabled={!formData.estado}
                >
                  <SelectTrigger className="border-slate-300 focus:border-green-500">
                    <SelectValue placeholder={formData.estado ? "Selecione a cidade" : "Escolha o estado primeiro"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {cidadesFiltradas.length === 0 ? (
                      <SelectItem value="_none" disabled>
                        {cidades.length === 0 ? 'Banco vazio - popule primeiro' : 'Nenhuma cidade neste estado'}
                      </SelectItem>
                    ) : (
                      cidadesFiltradas.map(c => (
                        <SelectItem key={c.id} value={c.nome}>{c.nome}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Hash className="w-4 h-4 text-orange-600" />
                  Código IBGE
                </Label>
                <Input
                  value={formData.codigo_ibge}
                  readOnly
                  placeholder="Automático"
                  className="border-slate-300 bg-slate-50 text-slate-600"
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