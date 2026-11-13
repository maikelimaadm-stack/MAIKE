import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { notifyWarning } from "@/lib/maikeNotify";
import B1Select from "@/components/cadastro/base1/B1Select";

export const FORMULARIO_TIPO_ATIVIDADE_ID = "formulario-tipo-atividade-base1";

const SELECT_EMPTY = "__VAZIO__";
const UPPERCASE_FIELDS = ["nome_tipo", "descricao"];

/**
 * @typedef {{ id: string, nome_grupo?: string, ativo?: boolean }} GrupoOpcao
 * @typedef {{
 *   id?: string,
 *   nome_tipo?: string,
 *   grupo_atividade_id?: string,
 *   grupo_atividade_nome?: string,
 *   ativo?: boolean,
 *   descricao?: string | null,
 * }} TipoAtividadeInicial
 * @typedef {{
 *   grupo_atividade_id: string,
 *   nome_tipo: string,
 *   descricao: string,
 *   ativo: boolean,
 * }} TipoAtividadeEnvio
 */

/**
 * Formulário do cadastro de tipos de atividade (D-PROD-181).
 *
 * Exatamente quatro campos, nesta ordem: Grupo de atividade, Nome do tipo de
 * atividade, Descrição e Ativo. O seletor oferece só grupos ativos; no modo
 * leitura, um grupo já inativado continua visível pelo nome em cache.
 *
 * @param {{
 *   initialData?: TipoAtividadeInicial | null,
 *   grupos?: GrupoOpcao[],
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
  grupos = [],
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
  const [invalidFields, setInvalidFields] = useState(/** @type {string[]} */ ([]));
  const [formData, setFormData] = useState(() => ({
    grupo_atividade_id: initialData?.grupo_atividade_id || "",
    nome_tipo: initialData?.nome_tipo || "",
    descricao: initialData?.descricao || "",
    ativo: initialData?.ativo ?? true,
  }));

  // Só grupos ATIVOS são oferecidos. Exceção: o grupo atual de um tipo já
  // existente continua na lista (marcado INATIVO), senão o select mostraria
  // "SELECIONE" enquanto o registro segue gravado nele.
  const grupoAtualId = initialData?.grupo_atividade_id || "";
  const gruposAtivos = grupos.filter(
    (grupo) => grupo.ativo !== false || (grupoAtualId && grupo.id === grupoAtualId),
  );

  /** @param {keyof typeof formData} field @param {string | boolean} value */
  const handleChange = (field, value) => {
    const normalizedValue =
      UPPERCASE_FIELDS.includes(field) && typeof value === "string" ? value.toUpperCase() : value;
    setInvalidFields((prev) => prev.filter((f) => f !== field));
    setFormData((prev) => ({ ...prev, [field]: normalizedValue }));
  };

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const missing = [];
    if (!formData.grupo_atividade_id?.trim()) missing.push("grupo_atividade_id");
    if (!formData.nome_tipo?.trim()) missing.push("nome_tipo");
    if (missing.length) {
      setInvalidFields(missing);
      notifyWarning("Atenção", "Preencha os campos obrigatórios: Grupo e Nome do tipo.");
      return;
    }
    onSubmit({
      grupo_atividade_id: formData.grupo_atividade_id,
      nome_tipo: String(formData.nome_tipo || "").toUpperCase(),
      descricao: String(formData.descricao || "").toUpperCase(),
      ativo: formData.ativo !== false,
    });
  };

  const grupoLabel =
    grupos.find((g) => g.id === formData.grupo_atividade_id)?.nome_grupo ||
    initialData?.grupo_atividade_nome ||
    "";

  const formBody = (
    <form
      id={FORMULARIO_TIPO_ATIVIDADE_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-tipo-atividade"
      data-densidade={DENSIDADE_BASE1}
    >
      <B1Field
        label="Grupo de atividade"
        required
        span={6}
        hasValue={Boolean(formData.grupo_atividade_id)}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
        error={invalidFields.includes("grupo_atividade_id") ? "Obrigatório" : undefined}
      >
        {readOnly ? (
          <input type="text" readOnly value={grupoLabel.toUpperCase()} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            value={formData.grupo_atividade_id || SELECT_EMPTY}
            onChange={(/** @type {React.ChangeEvent<HTMLSelectElement>} */ e) =>
              handleChange("grupo_atividade_id", e.target.value === SELECT_EMPTY ? "" : e.target.value)
            }
            className={B1_FIELD_CTL_CLS}
          >
            <option value={SELECT_EMPTY}>SELECIONE</option>
            {gruposAtivos.map((grupo) => (
              <option key={grupo.id} value={grupo.id}>
                {String(grupo.nome_grupo || "").toUpperCase()}
                {grupo.ativo === false ? " (INATIVO)" : ""}
              </option>
            ))}
          </B1Select>
        )}
      </B1Field>

      <B1Field
        label="Nome do tipo de atividade"
        required
        span={6}
        hasValue={Boolean(formData.nome_tipo?.trim())}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
        error={invalidFields.includes("nome_tipo") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={formData.nome_tipo}
          onChange={(e) => handleChange("nome_tipo", e.target.value)}
          placeholder="NOME DO TIPO DE ATIVIDADE"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Descrição"
        span={12}
        hasValue={Boolean(formData.descricao?.trim())}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
      >
        <textarea
          value={formData.descricao}
          onChange={(e) => handleChange("descricao", e.target.value)}
          placeholder="DESCRIÇÃO DO TIPO DE ATIVIDADE"
          className={`${B1_FIELD_CTL_CLS} uppercase min-h-[3rem] resize-y`}
          rows={2}
          readOnly={readOnly}
        />
      </B1Field>

      <B1ChaveRow
        label="Ativo"
        span={6}
        checked={formData.ativo}
        onChange={readOnly ? undefined : (/** @type {boolean} */ v) => handleChange("ativo", v)}
        disabled={readOnly || isSubmitting}
        ariaLabel="Tipo de atividade ativo"
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
    <CadastroFormShell
      embedded={embedded}
      title={isEditing ? "Editar Tipo de Atividade" : "Novo Tipo de Atividade"}
    >
      {formBody}
    </CadastroFormShell>
  );
}
