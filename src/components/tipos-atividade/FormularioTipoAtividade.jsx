import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { CampoSelect } from "@/components/gestao/GestaoFormParts";
import { notifyWarning } from "@/lib/maikeNotify";
import { TIPOS_FIXOS_ATIVIDADE, rotuloDoTipoFixo } from "@/lib/tiposFixosAtividade";

export const FORMULARIO_TIPO_ATIVIDADE_ID = "formulario-tipo-atividade-base1";

/** Os 7 tipos fixos (D-PROD-258), com o rótulo da tela. */
export const CATEGORIAS_TIPO_ATIVIDADE = TIPOS_FIXOS_ATIVIDADE;

/**
 * Rótulo legível do tipo fixo; categoria antiga fora dos 7 aparece como Outros.
 * @param {unknown} valor
 */
export const rotuloDaCategoriaTipoAtividade = (valor) => (typeof valor === "string" && valor ? rotuloDoTipoFixo(valor) : "");

/**
 * @typedef {{
 *   id?: string,
 *   nome_tipo?: string,
 *   ativo?: boolean,
 *   categoria?: string | null,
 * }} TipoAtividadeInicial
 * @typedef {{ categoria: string, nome_tipo: string, ativo: boolean }} TipoAtividadeEnvio
 */

/**
 * Formulário da OPERAÇÃO (o "tipo de atividade" de antes; D-PROD-258): só três campos — Tipo fixo (um dos 7, obrigatório),
 * Nome e Ativo. Grupo, centros, unidade, coeficiente e as 8 chaves saíram da tela: o servidor dá o padrão automático na
 * criação e, na edição, não mexe no que não vier no corpo (o corpo leva só estes três).
 *
 * @param {{
 *   initialData?: TipoAtividadeInicial | null,
 *   isEditing?: boolean,
 *   onSubmit: (dados: TipoAtividadeEnvio) => void,
 *   onCancel?: () => void,
 *   variant?: "card" | "embedded",
 *   toolbarActions?: boolean,
 *   isSubmitting?: boolean,
 *   readOnly?: boolean,
 * }} props
 */
export default function FormularioTipoAtividade({
  initialData,
  isEditing,
  onSubmit,
  onCancel,
  variant = "card",
  toolbarActions = false,
  isSubmitting = false,
  readOnly = false,
}) {
  const embedded = variant === "embedded";
  const isExistingRecord = Boolean(initialData?.id);
  const bloqueado = readOnly || isSubmitting;
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [formData, setFormData] = useState(() => ({
    // Operação antiga com categoria fora dos 7 abre sem tipo escolhido: o usuário precisa escolher (é o ajuste que falta).
    categoria: TIPOS_FIXOS_ATIVIDADE.some((t) => t.value === initialData?.categoria) ? String(initialData?.categoria) : "",
    nome_tipo: initialData?.nome_tipo || "",
    ativo: initialData?.ativo ?? true,
  }));

  /** @param {keyof typeof formData} field @param {string | boolean} value */
  const handleChange = (field, value) => {
    const normalizedValue = field === "nome_tipo" && typeof value === "string" ? value.toUpperCase() : value;
    setErros((prev) => (prev[field] ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== field)) : prev));
    setFormData((prev) => ({ ...prev, [field]: normalizedValue }));
  };

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    /** @type {Record<string, string>} */
    const novos = {};
    if (!formData.categoria) novos.categoria = "Obrigatório";
    if (!formData.nome_tipo?.trim()) novos.nome_tipo = "Obrigatório";
    if (Object.keys(novos).length) {
      setErros(novos);
      notifyWarning("Atenção", "Preencha os campos obrigatórios: Tipo e Nome da operação.");
      return;
    }
    onSubmit({
      categoria: formData.categoria,
      nome_tipo: String(formData.nome_tipo || "").trim().toUpperCase(),
      ativo: formData.ativo !== false,
    });
  };

  const formBody = (
    <form
      id={FORMULARIO_TIPO_ATIVIDADE_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-tipo-atividade"
      data-densidade={DENSIDADE_BASE1}
    >
      <CampoSelect
        label="Tipo"
        value={formData.categoria}
        onChange={(v) => handleChange("categoria", v)}
        options={[...TIPOS_FIXOS_ATIVIDADE]}
        placeholder="Escolha o tipo"
        required
        readOnly={bloqueado}
        span={6}
        error={erros.categoria}
      />

      <B1Field
        label="Nome da operação"
        required
        span={6}
        hasValue={Boolean(formData.nome_tipo?.trim())}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
        error={erros.nome_tipo}
      >
        <input
          type="text"
          value={formData.nome_tipo}
          onChange={(e) => handleChange("nome_tipo", e.target.value)}
          placeholder="EX.: GRADEAÇÃO, CALAGEM, ROÇADA"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
          maxLength={255}
        />
      </B1Field>

      <B1ChaveRow
        label="Ativo"
        span={6}
        checked={formData.ativo}
        onChange={readOnly ? undefined : (/** @type {boolean} */ v) => handleChange("ativo", v)}
        disabled={readOnly || isSubmitting}
        ariaLabel="Operação ativa"
      />

      {!toolbarActions ? (
        <div className="col-span-12">
          <CadastroFormActions
            onCancel={onCancel}
            submitLabel={isExistingRecord ? "Atualizar" : "Salvar"}
            isSubmitting={isSubmitting}
          />
        </div>
      ) : null}
    </form>
  );

  return (
    <CadastroFormShell embedded={embedded} title={isEditing ? "Editar Operação" : "Nova Operação"}>
      {formBody}
    </CadastroFormShell>
  );
}
