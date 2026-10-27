import React, { useState, useEffect } from "react";
import { projetarPayloadEmpresa } from "@/services/empresaWritePayload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import CadastroFormField, {
  CADASTRO_INPUT_CLS,
  CADASTRO_SELECT_CLS,
  CADASTRO_TEXTAREA_CLS,
} from "@/components/cadastro/base1/CadastroFormField";

const FL = ({ label, required = false, error = false, children, className = "" }) => (
  <CadastroFormField label={label} required={required} error={error} className={className}>
    {children}
  </CadastroFormField>
);
const INPUT_CLS = CADASTRO_INPUT_CLS;
const SELECT_CLS = CADASTRO_SELECT_CLS;
const TEXTAREA_CLS = CADASTRO_TEXTAREA_CLS;
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Upload, X, Save } from "lucide-react";
import { motion } from "framer-motion";
import { enviarArquivo } from "@/services/arquivoService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { toast } from "sonner";

const ESTADOS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

export default function FormularioEmpresa({
  onSubmit,
  onCancel,
  initialData,
  isEditing,
  variant = "standalone",
  saving = false,
}) {
  const embedded = variant === "embedded";
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

  useEffect(() => {
    if (!initialData) return;
    setFormData((prev) => ({
      ...prev,
      apelido: initialData.apelido ?? "",
      nome: initialData.nome ?? "",
      tipo_pessoa: initialData.tipo_pessoa ?? "Jurídica",
      cpf: initialData.cpf ?? "",
      rg: initialData.rg ?? "",
      cnpj: initialData.cnpj ?? "",
      inscricao_estadual: initialData.inscricao_estadual ?? "",
      telefone: initialData.telefone ?? "",
      email: initialData.email ?? "",
      endereco: initialData.endereco ?? "",
      cidade: initialData.cidade ?? "",
      estado: initialData.estado ?? "MT",
      cep: initialData.cep ?? "",
      observacoes: initialData.observacoes ?? "",
      logotipo_url: initialData.logotipo_url ?? "",
    }));
  }, [initialData?.id]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingLogo(true);
    try {
      const file_url = await enviarArquivo(file);
      handleChange('logotipo_url', file_url);
      toast.success('Logotipo enviado com sucesso!');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Não foi possível enviar o logotipo.'));
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

    const dataToSubmit = projetarPayloadEmpresa({
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
    });

    onSubmit(dataToSubmit);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className={`shadow-sm border-slate-300 bg-white ${embedded ? "border-0 shadow-none" : ""}`}>
        {!embedded ? (
          <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
            <CardTitle className="text-sm font-semibold text-slate-900">
              {isEditing ? "Editar Empresa" : "Nova Empresa"}
            </CardTitle>
          </CardHeader>
        ) : null}
        <CardContent
          className="p-4"
          style={{
            maxHeight: embedded ? "none" : "calc(100vh - 150px)",
            overflowY: "auto",
            scrollbarWidth: "thin",
            scrollbarColor: "#cbd5e1 transparent",
          }}
        >
          <form onSubmit={handleSubmit} className="space-y-2" noValidate>
            <FL label="Nº da Empresa">
              <Input
                readOnly
                value={
                  isEditing && initialData?.numero_empresa > 0
                    ? String(initialData.numero_empresa)
                    : initialData?._isOffline || String(initialData?.id || "").startsWith("offline_")
                      ? "Atribuído após sincronizar"
                      : "Automático ao salvar"
                }
                className={`${INPUT_CLS} bg-slate-50 text-slate-600`}
                aria-readonly="true"
              />
            </FL>
            <div className="space-y-1 pl-1">
              <span className="text-[12px] text-slate-500">Logotipo</span>
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

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <FL label="Apelido" required>
                <Input
                  value={formData.apelido}
                  onChange={(e) => handleChange('apelido', e.target.value)}
                  placeholder="FAZENDA PALMITAL"
                  required
                  className={`${INPUT_CLS} uppercase`}
                  style={{ textTransform: 'uppercase' }}
                />
              </FL>
              <FL label="Nome/Razão Social" required>
                <Input
                  value={formData.nome}
                  onChange={(e) => handleChange('nome', e.target.value)}
                  placeholder="NOME COMPLETO"
                  required
                  className={`${INPUT_CLS} uppercase`}
                  style={{ textTransform: 'uppercase' }}
                />
              </FL>
              <FL label="Tipo" required>
                <Select value={formData.tipo_pessoa} onValueChange={(value) => handleChange('tipo_pessoa', value)}>
                  <SelectTrigger className={SELECT_CLS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Física" className="text-xs">Pessoa Física</SelectItem>
                    <SelectItem value="Jurídica" className="text-xs">Pessoa Jurídica</SelectItem>
                  </SelectContent>
                </Select>
              </FL>
            </div>

            {formData.tipo_pessoa === 'Física' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                <FL label="CPF">
                  <Input
                    value={formData.cpf}
                    onChange={(e) => handleChange('cpf', e.target.value)}
                    placeholder="000.000.000-00"
                    className={INPUT_CLS}
                  />
                </FL>
                <FL label="RG" className="lg:col-span-2">
                  <Input
                    value={formData.rg}
                    onChange={(e) => handleChange('rg', e.target.value)}
                    placeholder="00.000.000-0"
                    className={INPUT_CLS}
                  />
                </FL>
              </div>
            )}

            {formData.tipo_pessoa === 'Jurídica' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                <FL label="CNPJ">
                  <Input
                    value={formData.cnpj}
                    onChange={(e) => handleChange('cnpj', e.target.value)}
                    placeholder="00.000.000/0000-00"
                    className={INPUT_CLS}
                  />
                </FL>
                <FL label="Inscrição Estadual" className="lg:col-span-2">
                  <Input
                    value={formData.inscricao_estadual}
                    onChange={(e) => handleChange('inscricao_estadual', e.target.value)}
                    placeholder="000.000.000.000"
                    className={INPUT_CLS}
                  />
                </FL>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <FL label="Telefone">
                <Input
                  value={formData.telefone}
                  onChange={(e) => handleChange('telefone', e.target.value)}
                  placeholder="(00) 00000-0000"
                  className={INPUT_CLS}
                />
              </FL>
              <FL label="E-mail" className="lg:col-span-2">
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="exemplo@email.com"
                  className={INPUT_CLS}
                />
              </FL>
            </div>

            <FL label="Endereço completo">
              <Input
                value={formData.endereco}
                onChange={(e) => handleChange('endereco', e.target.value)}
                placeholder="RUA, NÚMERO, BAIRRO"
                className={`${INPUT_CLS} uppercase`}
                style={{ textTransform: 'uppercase' }}
              />
            </FL>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <FL label="Cidade">
                <Input
                  value={formData.cidade}
                  onChange={(e) => handleChange('cidade', e.target.value)}
                  placeholder="CIDADE"
                  className={`${INPUT_CLS} uppercase`}
                  style={{ textTransform: 'uppercase' }}
                />
              </FL>
              <FL label="Estado">
                <Select value={formData.estado} onValueChange={(value) => handleChange('estado', value)}>
                  <SelectTrigger className={SELECT_CLS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESTADOS.map(uf => (
                      <SelectItem key={uf} value={uf} className="text-xs">{uf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FL>
              <FL label="CEP">
                <Input
                  value={formData.cep}
                  onChange={(e) => handleChange('cep', e.target.value)}
                  placeholder="00000-000"
                  className={INPUT_CLS}
                />
              </FL>
            </div>

            <FL label="Observações">
              <Textarea
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="OBSERVAÇÕES GERAIS..."
                className={`${TEXTAREA_CLS} uppercase`}
                style={{ textTransform: 'uppercase' }}
                rows={2}
              />
            </FL>

            <div className="flex justify-end gap-2 pt-2 border-t">
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
              )}
              <Button
                type="submit"
                size="sm"
                disabled={saving || uploadingLogo}
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                {saving ? "Salvando…" : isEditing ? "Atualizar" : "Salvar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}