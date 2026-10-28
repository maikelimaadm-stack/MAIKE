import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { notifyWarning } from "@/lib/maikeNotify";

export const FORMULARIO_SETOR_ID = "formulario-setor-base1";

const TIPOS_SETOR = ["Próprio", "Arrendado", "Parceria", "Terceiros"];
const ESTADOS_BR = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];
const UPPERCASE_FIELDS = ["nome", "sigla", "responsavel", "endereco", "cidade", "observacoes"];
const REQUIRED_FIELDS = ["nome", "sigla", "endereco", "cidade", "estado", "tipo"];

export default function FormularioSetor({
  initialData,
  onSubmit,
  onCancel,
  variant = "card",
  toolbarActions = false,
  isSubmitting = false,
  readOnly = false,
}) {
  const embedded = variant === "embedded";
  const [form, setForm] = useState(() => ({
    nome: initialData?.nome || "",
    sigla: initialData?.sigla || "",
    tipo: initialData?.tipo || "Próprio",
    responsavel: initialData?.responsavel || "",
    telefone: initialData?.telefone || "",
    endereco: initialData?.endereco || "",
    cidade: initialData?.cidade || "",
    estado: initialData?.estado || "",
    area_total: initialData?.area_total ?? "",
    capacidade_animais: initialData?.capacidade_animais ?? "",
    observacoes: initialData?.observacoes || "",
    ativo: initialData?.ativo !== false,
  }));
  const [invalidFields, setInvalidFields] = useState([]);

  const handleChange = (field, value) => {
    const nextValue =
      UPPERCASE_FIELDS.includes(field) && typeof value === "string" ? value.toUpperCase() : value;
    setForm((prev) => ({ ...prev, [field]: nextValue }));
    setInvalidFields((prev) => prev.filter((item) => item !== field));
  };

  const isEmptyValue = (value) => {
    if (typeof value === "string") return value.trim() === "";
    return value === undefined || value === null || value === "";
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const missingFields = REQUIRED_FIELDS.filter((field) => isEmptyValue(form[field]));
    if (missingFields.length > 0) {
      setInvalidFields(missingFields);
      notifyWarning("Atenção", "Preencha os campos obrigatórios.");
      return;
    }
    onSubmit(form);
  };

  const selectClass = `${B1_FIELD_CTL_CLS} appearance-none`;

  const formBody = (
    <form
      id={FORMULARIO_SETOR_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-setor"
    >
      <B1Field
        label="Nome do Setor/Fazenda"
        required
        span={6}
        hasValue={Boolean(form.nome?.trim())}
        locked={readOnly}
        disabled={readOnly}
        error={invalidFields.includes("nome") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={form.nome}
          onChange={(e) => handleChange("nome", e.target.value)}
          placeholder="NOME DO SETOR / FAZENDA"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Sigla"
        required
        span={3}
        hasValue={Boolean(form.sigla?.trim())}
        locked={readOnly}
        disabled={readOnly}
        error={invalidFields.includes("sigla") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={form.sigla}
          onChange={(e) => handleChange("sigla", e.target.value)}
          placeholder="SIGLA"
          className={`${B1_FIELD_CTL_CLS} uppercase font-mono`}
          maxLength={10}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Tipo"
        required
        span={3}
        hasValue={Boolean(form.tipo)}
        locked={readOnly}
        disabled={readOnly}
        error={invalidFields.includes("tipo") ? "Obrigatório" : undefined}
      >
        {readOnly ? (
          <input type="text" value={form.tipo} className={B1_FIELD_CTL_CLS} readOnly tabIndex={-1} />
        ) : (
          <select
            value={form.tipo}
            onChange={(e) => handleChange("tipo", e.target.value)}
            className={selectClass}
          >
            {TIPOS_SETOR.map((tipo) => (
              <option key={tipo} value={tipo}>
                {tipo}
              </option>
            ))}
          </select>
        )}
      </B1Field>
      <B1Field label="Responsável" span={4} hasValue={Boolean(form.responsavel?.trim())} locked={readOnly} disabled={readOnly}>
        <input
          type="text"
          value={form.responsavel}
          onChange={(e) => handleChange("responsavel", e.target.value)}
          placeholder="RESPONSÁVEL"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field label="Telefone" span={4} hasValue={Boolean(form.telefone?.trim())} locked={readOnly} disabled={readOnly}>
        <input
          type="text"
          value={form.telefone}
          onChange={(e) => handleChange("telefone", e.target.value)}
          placeholder="(00) 00000-0000"
          className={B1_FIELD_CTL_CLS}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Área Total (ha)"
        span={4}
        hasValue={form.area_total !== "" && form.area_total != null}
        locked={readOnly}
        disabled={readOnly}
      >
        <input
          type="text"
          inputMode="decimal"
          value={form.area_total}
          onChange={(e) => handleChange("area_total", e.target.value)}
          placeholder="0,00"
          className={B1_FIELD_CTL_CLS}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Capacidade (animais)"
        span={4}
        hasValue={form.capacidade_animais !== "" && form.capacidade_animais != null}
        locked={readOnly}
        disabled={readOnly}
      >
        <input
          type="text"
          inputMode="numeric"
          value={form.capacidade_animais}
          onChange={(e) => handleChange("capacidade_animais", e.target.value)}
          placeholder="0"
          className={B1_FIELD_CTL_CLS}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Endereço"
        required
        span={8}
        hasValue={Boolean(form.endereco?.trim())}
        locked={readOnly}
        disabled={readOnly}
        error={invalidFields.includes("endereco") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={form.endereco}
          onChange={(e) => handleChange("endereco", e.target.value)}
          placeholder="ENDEREÇO COMPLETO"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Cidade"
        required
        span={4}
        hasValue={Boolean(form.cidade?.trim())}
        locked={readOnly}
        disabled={readOnly}
        error={invalidFields.includes("cidade") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={form.cidade}
          onChange={(e) => handleChange("cidade", e.target.value)}
          placeholder="CIDADE"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Estado"
        required
        span={4}
        hasValue={Boolean(form.estado?.trim())}
        locked={readOnly}
        disabled={readOnly}
        error={invalidFields.includes("estado") ? "Obrigatório" : undefined}
      >
        {readOnly ? (
          <input type="text" value={form.estado} className={B1_FIELD_CTL_CLS} readOnly tabIndex={-1} />
        ) : (
          <select
            value={form.estado || ""}
            onChange={(e) => handleChange("estado", e.target.value)}
            className={selectClass}
          >
            <option value="">SELECIONE</option>
            {ESTADOS_BR.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
        )}
      </B1Field>
      <B1ChaveRow
        label="Setor Ativo"
        span={4}
        checked={form.ativo}
        onChange={readOnly ? undefined : (v) => handleChange("ativo", v)}
        disabled={readOnly}
        ariaLabel="Setor ativo"
      />
      <B1Field
        label="Observações"
        span={12}
        multiline
        hasValue={Boolean(form.observacoes?.trim())}
        locked={readOnly}
        disabled={readOnly}
      >
        <textarea
          value={form.observacoes}
          onChange={(e) => handleChange("observacoes", e.target.value)}
          placeholder="OBSERVAÇÕES GERAIS..."
          className={`${B1_FIELD_CTL_CLS} uppercase min-h-[4rem]`}
          rows={2}
          readOnly={readOnly}
        />
      </B1Field>
      {!toolbarActions ? (
        <div className="col-span-12">
          <CadastroFormActions
            onCancel={onCancel}
            submitLabel={initialData?.id ? "Atualizar" : "Salvar"}
            isSubmitting={isSubmitting}
          />
        </div>
      ) : null}
    </form>
  );

  return (
    <CadastroFormShell embedded={embedded} title={null}>
      {formBody}
    </CadastroFormShell>
  );
}
