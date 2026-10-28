import React, { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { projetarPayloadEmpresa } from "@/services/empresaWritePayload";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import Base1PanelTabs from "@/components/cadastro/base1/Base1PanelTabs";
import { MgSelect, PillBtn } from "@/components/cadastro/base1/Base1Ui";
import { enviarArquivo } from "@/services/arquivoService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { notifyWarning } from "@/lib/maikeNotify";
import { toast } from "sonner";

export const FORMULARIO_EMPRESA_ID = "formulario-empresa-base1";

const ESTADOS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

const TIPO_OPTIONS = [
  { value: "Física", label: "Pessoa Física" },
  { value: "Jurídica", label: "Pessoa Jurídica" },
];

const UF_OPTIONS = ESTADOS.map((uf) => ({ value: uf, label: uf }));

const PANEL_TABS = [
  { id: "documentos", label: "Documentos" },
  { id: "contato", label: "Contato e endereço" },
  { id: "outros", label: "Observações e logotipo" },
];

const emptyForm = () => ({
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
  logotipo_url: "",
});

function mapInitialToForm(initialData) {
  if (!initialData) return emptyForm();
  return {
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
  };
}

export default function FormularioEmpresa({
  onSubmit,
  onCancel,
  initialData,
  isEditing = false,
  variant = "standalone",
  toolbarActions = false,
  isSubmitting = false,
  readOnly = false,
}) {
  const embedded = variant === "embedded";
  const isExistingRecord = Boolean(initialData?.id);
  const [activePanel, setActivePanel] = useState("documentos");
  const [formData, setFormData] = useState(() => mapInitialToForm(initialData));
  const [invalidFields, setInvalidFields] = useState([]);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setInvalidFields((prev) => prev.filter((f) => f !== field));
  };

  const numeroLabel = () => {
    if (isExistingRecord && initialData?.numero_empresa > 0) {
      return String(initialData.numero_empresa);
    }
    if (
      initialData?._isOffline ||
      String(initialData?.id || "").startsWith("offline_")
    ) {
      return "Atribuído após sincronizar";
    }
    return "Automático ao salvar";
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || readOnly) return;
    setUploadingLogo(true);
    try {
      const file_url = await enviarArquivo(file);
      handleChange("logotipo_url", file_url);
      toast.success("Logotipo enviado com sucesso!");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Não foi possível enviar o logotipo."));
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    if (!formData.apelido?.trim() || !formData.nome?.trim()) {
      const missing = [];
      if (!formData.apelido?.trim()) missing.push("apelido");
      if (!formData.nome?.trim()) missing.push("nome");
      setInvalidFields(missing);
      notifyWarning("Atenção", "Preencha Apelido e Nome/Razão Social.");
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

  const renderDocumentos = () => (
    <div className="mg-b1-form-grid col-span-12 grid grid-cols-12 gap-x-3 gap-y-2">
      {formData.tipo_pessoa === "Física" ? (
        <>
          <B1Field
            label="CPF"
            span={4}
            hasValue={Boolean(formData.cpf?.trim())}
            locked={readOnly}
            disabled={readOnly}
          >
            <input
              type="text"
              value={formData.cpf}
              onChange={(e) => handleChange("cpf", e.target.value)}
              placeholder="000.000.000-00"
              className={B1_FIELD_CTL_CLS}
              readOnly={readOnly}
            />
          </B1Field>
          <B1Field
            label="RG"
            span={8}
            hasValue={Boolean(formData.rg?.trim())}
            locked={readOnly}
            disabled={readOnly}
          >
            <input
              type="text"
              value={formData.rg}
              onChange={(e) => handleChange("rg", e.target.value)}
              placeholder="00.000.000-0"
              className={B1_FIELD_CTL_CLS}
              readOnly={readOnly}
            />
          </B1Field>
        </>
      ) : (
        <>
          <B1Field
            label="CNPJ"
            span={4}
            hasValue={Boolean(formData.cnpj?.trim())}
            locked={readOnly}
            disabled={readOnly}
          >
            <input
              type="text"
              value={formData.cnpj}
              onChange={(e) => handleChange("cnpj", e.target.value)}
              placeholder="00.000.000/0000-00"
              className={B1_FIELD_CTL_CLS}
              readOnly={readOnly}
            />
          </B1Field>
          <B1Field
            label="Inscrição Estadual"
            span={8}
            hasValue={Boolean(formData.inscricao_estadual?.trim())}
            locked={readOnly}
            disabled={readOnly}
          >
            <input
              type="text"
              value={formData.inscricao_estadual}
              onChange={(e) => handleChange("inscricao_estadual", e.target.value)}
              placeholder="000.000.000.000"
              className={B1_FIELD_CTL_CLS}
              readOnly={readOnly}
            />
          </B1Field>
        </>
      )}
    </div>
  );

  const renderContato = () => (
    <div className="mg-b1-form-grid col-span-12 grid grid-cols-12 gap-x-3 gap-y-2">
      <B1Field
        label="Telefone"
        span={4}
        hasValue={Boolean(formData.telefone?.trim())}
        locked={readOnly}
        disabled={readOnly}
      >
        <input
          type="text"
          value={formData.telefone}
          onChange={(e) => handleChange("telefone", e.target.value)}
          placeholder="(00) 00000-0000"
          className={B1_FIELD_CTL_CLS}
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="E-mail"
        span={8}
        hasValue={Boolean(formData.email?.trim())}
        locked={readOnly}
        disabled={readOnly}
      >
        <input
          type="email"
          value={formData.email}
          onChange={(e) => handleChange("email", e.target.value)}
          placeholder="exemplo@email.com"
          className={B1_FIELD_CTL_CLS}
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Endereço completo"
        span={12}
        hasValue={Boolean(formData.endereco?.trim())}
        locked={readOnly}
        disabled={readOnly}
      >
        <input
          type="text"
          value={formData.endereco}
          onChange={(e) => handleChange("endereco", e.target.value)}
          placeholder="RUA, NÚMERO, BAIRRO"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Cidade"
        span={4}
        hasValue={Boolean(formData.cidade?.trim())}
        locked={readOnly}
        disabled={readOnly}
      >
        <input
          type="text"
          value={formData.cidade}
          onChange={(e) => handleChange("cidade", e.target.value)}
          placeholder="CIDADE"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field label="Estado/UF" span={4} hasValue={Boolean(formData.estado)} locked={readOnly} disabled={readOnly}>
        <MgSelect
          value={formData.estado}
          onChange={readOnly ? () => {} : (v) => handleChange("estado", v)}
          options={UF_OPTIONS}
          disabled={readOnly}
          ariaLabel="Estado"
        />
      </B1Field>
      <B1Field
        label="CEP"
        span={4}
        hasValue={Boolean(formData.cep?.trim())}
        locked={readOnly}
        disabled={readOnly}
      >
        <input
          type="text"
          value={formData.cep}
          onChange={(e) => handleChange("cep", e.target.value)}
          placeholder="00000-000"
          className={B1_FIELD_CTL_CLS}
          readOnly={readOnly}
        />
      </B1Field>
    </div>
  );

  const renderOutros = () => (
    <div className="mg-b1-form-grid col-span-12 grid grid-cols-12 gap-x-3 gap-y-2">
      <B1Field
        label="Observações"
        span={12}
        hasValue={Boolean(formData.observacoes?.trim())}
        locked={readOnly}
        disabled={readOnly}
      >
        <textarea
          value={formData.observacoes}
          onChange={(e) => handleChange("observacoes", e.target.value)}
          placeholder="OBSERVAÇÕES GERAIS…"
          rows={3}
          className={`${B1_FIELD_CTL_CLS} min-h-[72px] resize-y uppercase`}
          readOnly={readOnly}
        />
      </B1Field>
      <div className="col-span-12">
        <span className="text-[11px] font-medium text-slate-600">Logotipo</span>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {formData.logotipo_url ? (
            <img
              src={formData.logotipo_url}
              alt="Logotipo"
              className="h-16 max-w-[160px] object-contain border rounded p-1 bg-white"
            />
          ) : null}
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleLogoUpload}
            disabled={readOnly || uploadingLogo}
          />
          {!readOnly ? (
            <>
              <PillBtn
                type="button"
                tone="gray"
                disabled={uploadingLogo}
                onClick={() => logoInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" aria-hidden />
                {uploadingLogo ? "Enviando…" : formData.logotipo_url ? "Alterar" : "Enviar"}
              </PillBtn>
              {formData.logotipo_url ? (
                <PillBtn
                  type="button"
                  tone="gray"
                  disabled={uploadingLogo}
                  onClick={() => handleChange("logotipo_url", "")}
                >
                  <X className="h-4 w-4" aria-hidden />
                  Remover
                </PillBtn>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );

  const formBody = (
    <form
      id={FORMULARIO_EMPRESA_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0 grid grid-cols-12 gap-x-3 gap-y-2"
      noValidate
      data-testid="b1-form-empresa"
    >
      <B1Field label="Nº da Empresa" span={3} hasValue locked disabled>
        <input type="text" readOnly value={numeroLabel()} className={`${B1_FIELD_CTL_CLS} bg-slate-50`} />
      </B1Field>
      <B1Field
        label="Apelido"
        required
        span={3}
        hasValue={Boolean(formData.apelido?.trim())}
        locked={readOnly}
        disabled={readOnly}
        error={invalidFields.includes("apelido") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={formData.apelido}
          onChange={(e) => handleChange("apelido", e.target.value)}
          placeholder="FAZENDA PALMITAL"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Nome/Razão Social"
        required
        span={4}
        hasValue={Boolean(formData.nome?.trim())}
        locked={readOnly}
        disabled={readOnly}
        error={invalidFields.includes("nome") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={formData.nome}
          onChange={(e) => handleChange("nome", e.target.value)}
          placeholder="NOME COMPLETO"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Tipo"
        required
        span={2}
        hasValue={Boolean(formData.tipo_pessoa)}
        locked={readOnly}
        disabled={readOnly}
      >
        <MgSelect
          value={formData.tipo_pessoa}
          onChange={readOnly ? () => {} : (v) => handleChange("tipo_pessoa", v)}
          options={TIPO_OPTIONS}
          disabled={readOnly}
          ariaLabel="Tipo de pessoa"
        />
      </B1Field>

      <div className="col-span-12">
        <Base1PanelTabs
          tabs={PANEL_TABS}
          value={activePanel}
          onChange={setActivePanel}
          preferenceKey="empresa_form_panels_v1"
          animationKey={initialData?.id ?? "nova"}
          renderPanel={(panelId) => {
            if (panelId === "documentos") return renderDocumentos();
            if (panelId === "contato") return renderContato();
            return renderOutros();
          }}
        />
      </div>

      {!toolbarActions ? (
        <div className="col-span-12">
          <CadastroFormActions
            onCancel={onCancel}
            submitLabel={isExistingRecord ? "Atualizar" : "Salvar"}
            isSubmitting={isSubmitting || uploadingLogo}
          />
        </div>
      ) : null}
    </form>
  );

  return (
    <CadastroFormShell
      embedded={embedded}
      title={isExistingRecord ? "Editar Empresa" : "Nova Empresa"}
    >
      <div className={embedded ? "mg-b1-record-form" : undefined}>{formBody}</div>
    </CadastroFormShell>
  );
}
