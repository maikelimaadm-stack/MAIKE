import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { notifyWarning } from "@/lib/maikeNotify";
import {
  CAMPOS_GMD,
  DIAS_POR_MES,
  GMD_MAXIMO,
  GMD_MINIMO,
  formatarGmd,
  lerGmd,
} from "@/services/curvaGanhoCadastroService";

export const FORMULARIO_CURVA_GANHO_ID = "formulario-curva-ganho-base1";

const UPPERCASE_FIELDS = ["nome", "observacoes"];
const CTL_NUMERO = B1_FIELD_CTL_CLS.replace(" uppercase", " normal-case tabular-nums");

/**
 * @typedef {{
 *   id?: string,
 *   nome?: string,
 *   gmd_aguas?: number,
 *   gmd_transicao?: number,
 *   gmd_seca?: number,
 *   observacoes?: string | null,
 *   ativo?: boolean,
 * }} CurvaGanhoInicial
 * @typedef {{
 *   nome: string,
 *   gmd_aguas: number,
 *   gmd_transicao: number,
 *   gmd_seca: number,
 *   observacoes: string | null,
 *   ativo: boolean,
 * }} CurvaGanhoEnvio
 */

/** Ajuda embaixo do GMD: o equivalente por mês, só como referência. @param {string} texto */
const ajudaPorMes = (texto) => {
  const n = lerGmd(texto);
  if (n === null) return `kg/dia, de ${formatarGmd(GMD_MINIMO)} a ${formatarGmd(GMD_MAXIMO)}`;
  return `≈ ${formatarGmd(Number((n * DIAS_POR_MES).toFixed(2)))} kg/mês (${DIAS_POR_MES} dias)`;
};

/**
 * Formulário do cadastro de Curvas de Ganho de Peso (D-PROD-189).
 *
 * Campos, nesta ordem: Nome, GMD nas Águas, GMD na Transição, GMD na Seca,
 * Ativo e Observações. O GMD é em kg/dia, aceita vírgula ou ponto, sinal de
 * menos (perda de peso na seca) e até 3 casas. A fazenda não é campo: é a
 * selecionada no topo da tela.
 *
 * @param {{
 *   initialData?: CurvaGanhoInicial | null,
 *   isEditing?: boolean,
 *   onSubmit: (dados: CurvaGanhoEnvio) => void,
 *   onCancel?: () => void,
 *   variant?: "card" | "embedded",
 *   toolbarActions?: boolean,
 *   isSubmitting?: boolean,
 *   readOnly?: boolean,
 * }} props
 */
export default function FormularioCurvaGanho({
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
  const [invalidFields, setInvalidFields] = useState(/** @type {string[]} */ ([]));
  const [formData, setFormData] = useState(() => ({
    nome: initialData?.nome || "",
    gmd_aguas: formatarGmd(initialData?.gmd_aguas),
    gmd_transicao: formatarGmd(initialData?.gmd_transicao),
    gmd_seca: formatarGmd(initialData?.gmd_seca),
    observacoes: initialData?.observacoes || "",
    ativo: initialData?.ativo ?? true,
  }));

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
    const faltando = [];
    if (!formData.nome?.trim()) faltando.push("nome");
    const gmdInvalidos = CAMPOS_GMD.map(({ campo }) => campo).filter((campo) => lerGmd(formData[campo]) === null);
    if (faltando.length || gmdInvalidos.length) {
      setInvalidFields([...faltando, ...gmdInvalidos]);
      notifyWarning(
        "Atenção",
        `Preencha o nome e os três GMD em kg/dia, de ${formatarGmd(GMD_MINIMO)} a ${formatarGmd(GMD_MAXIMO)}, com até 3 casas.`,
      );
      return;
    }
    const observacoes = String(formData.observacoes || "").trim().toUpperCase();
    onSubmit({
      nome: String(formData.nome || "").trim().toUpperCase(),
      gmd_aguas: /** @type {number} */ (lerGmd(formData.gmd_aguas)),
      gmd_transicao: /** @type {number} */ (lerGmd(formData.gmd_transicao)),
      gmd_seca: /** @type {number} */ (lerGmd(formData.gmd_seca)),
      observacoes: observacoes || null,
      ativo: formData.ativo !== false,
    });
  };

  const formBody = (
    <form
      id={FORMULARIO_CURVA_GANHO_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-curva-ganho"
      data-densidade={DENSIDADE_BASE1}
    >
      <B1Field
        label="Nome"
        required
        span={12}
        hasValue={Boolean(formData.nome?.trim())}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
        error={invalidFields.includes("nome") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={formData.nome}
          onChange={(e) => handleChange("nome", e.target.value)}
          placeholder="EX.: RECRIA A PASTO"
          maxLength={120}
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>

      {CAMPOS_GMD.map(({ campo, label }) => (
        <B1Field
          key={campo}
          label={label}
          required
          span={4}
          hasValue={Boolean(String(formData[campo] ?? "").trim())}
          locked={readOnly}
          disabled={readOnly || isSubmitting}
          error={invalidFields.includes(campo) ? "GMD inválido" : undefined}
          dica={readOnly ? undefined : ajudaPorMes(formData[campo])}
        >
          <input
            type="text"
            inputMode="decimal"
            value={formData[campo]}
            onChange={(e) => handleChange(/** @type {any} */ (campo), e.target.value)}
            placeholder="0,650"
            className={CTL_NUMERO}
            autoComplete="off"
            maxLength={8}
            readOnly={readOnly}
            aria-label={`${label} (kg/dia)`}
            data-testid={`curva-${campo}`}
          />
        </B1Field>
      ))}

      <B1ChaveRow
        label="Ativo"
        span={4}
        checked={formData.ativo}
        onChange={readOnly ? undefined : (/** @type {boolean} */ v) => handleChange("ativo", v)}
        disabled={readOnly || isSubmitting}
        ariaLabel="Curva ativa"
      />

      <B1Field
        label="Observações"
        span={12}
        hasValue={Boolean(formData.observacoes?.trim())}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
      >
        <textarea
          value={formData.observacoes}
          onChange={(e) => handleChange("observacoes", e.target.value)}
          placeholder="OBSERVAÇÕES DA CURVA"
          maxLength={2000}
          className={`${B1_FIELD_CTL_CLS} uppercase min-h-[3rem] resize-y`}
          rows={2}
          readOnly={readOnly}
        />
      </B1Field>

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
    <CadastroFormShell embedded={embedded} title={isEditing ? "Editar Curva de Ganho" : "Nova Curva de Ganho"}>
      {formBody}
    </CadastroFormShell>
  );
}
