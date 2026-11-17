import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import B1Select from "@/components/cadastro/base1/B1Select";
import { notifyWarning } from "@/lib/maikeNotify";
import {
  ALTURA_MAXIMA_CM,
  TIPOS_CULTURA,
  formatarAlturaCm,
  lerAlturaCm,
  rotuloTipoCultura,
} from "@/services/culturaCadastroService";

export const FORMULARIO_CULTURA_ID = "formulario-cultura-base1";

const SELECT_EMPTY = "__VAZIO__";
/** Mesmos caracteres aceitos pelo servidor no código (D-PROD-215). */
const CODIGO_VALIDO = /^[0-9A-Z][0-9A-Z.-]*$/;
const UPPERCASE_FIELDS = ["codigo", "nome"];

/**
 * @typedef {{
 *   id?: string,
 *   codigo?: string,
 *   nome?: string,
 *   tipo?: string,
 *   especie?: string | null,
 *   cultivar?: string | null,
 *   altura_entrada_cm?: number | null,
 *   altura_saida_cm?: number | null,
 *   observacoes?: string | null,
 *   ativo?: boolean,
 * }} CulturaInicial
 * @typedef {{
 *   codigo?: string,
 *   nome: string,
 *   tipo: string,
 *   especie: string | null,
 *   cultivar: string | null,
 *   altura_entrada_cm: string | null,
 *   altura_saida_cm: string | null,
 *   observacoes: string | null,
 *   ativo: boolean,
 * }} CulturaEnvio
 */

/** @param {unknown} v */
const textoOuNulo = (v) => {
  const t = String(v ?? "").trim();
  return t ? t : null;
};

/**
 * Formulário do Cadastro de Culturas (D-PROD-215).
 *
 * Campos: Código (vazio = o servidor numera "001", "002"…), Nome, Tipo
 * (PASTAGEM / CAPINEIRA / LAVOURA / SILAGEM), Espécie, Cultivar, alturas de
 * referência de entrada e de saída em cm (pt-BR, 1 casa; a de saída é menor),
 * Ativo e Observações. A fazenda não é campo: é a selecionada no topo.
 *
 * @param {{
 *   initialData?: CulturaInicial | null,
 *   isEditing?: boolean,
 *   onSubmit: (dados: CulturaEnvio) => void,
 *   onCancel?: () => void,
 *   variant?: "card" | "embedded",
 *   toolbarActions?: boolean,
 *   isSubmitting?: boolean,
 *   readOnly?: boolean,
 * }} props
 */
export default function FormularioCultura({
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
    codigo: initialData?.codigo || "",
    nome: initialData?.nome || "",
    tipo: initialData?.tipo || "",
    especie: initialData?.especie || "",
    cultivar: initialData?.cultivar || "",
    altura_entrada_cm: formatarAlturaCm(initialData?.altura_entrada_cm),
    altura_saida_cm: formatarAlturaCm(initialData?.altura_saida_cm),
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

  /** @param {string} campo @param {string} [texto] */
  const erroDe = (campo, texto = "Obrigatório") => (invalidFields.includes(campo) ? texto : undefined);

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const missing = [];
    if (!formData.nome?.trim()) missing.push("nome");
    if (!formData.tipo) missing.push("tipo");
    if (isExistingRecord && !formData.codigo?.trim()) missing.push("codigo");
    if (missing.length) {
      setInvalidFields(missing);
      notifyWarning(
        "Atenção",
        isExistingRecord
          ? "Preencha os campos obrigatórios: Código, Nome e Tipo."
          : "Preencha os campos obrigatórios: Nome e Tipo.",
      );
      return;
    }
    const codigo = String(formData.codigo || "").trim().toUpperCase();
    if (codigo && !CODIGO_VALIDO.test(codigo)) {
      setInvalidFields(["codigo"]);
      notifyWarning("Atenção", "O código aceita só letras, números, ponto e hífen.");
      return;
    }
    const entrada = lerAlturaCm(formData.altura_entrada_cm);
    const saida = lerAlturaCm(formData.altura_saida_cm);
    const alturasInvalidas = [
      ...(entrada === undefined ? ["altura_entrada_cm"] : []),
      ...(saida === undefined ? ["altura_saida_cm"] : []),
    ];
    if (alturasInvalidas.length) {
      setInvalidFields(alturasInvalidas);
      notifyWarning("Atenção", `A altura é em cm, maior que 0 e até ${ALTURA_MAXIMA_CM}, com no máximo 1 casa decimal.`);
      return;
    }
    if (entrada != null && saida != null && saida >= entrada) {
      setInvalidFields(["altura_saida_cm"]);
      notifyWarning("Atenção", "A altura de saída precisa ser menor que a altura de entrada.");
      return;
    }
    onSubmit({
      ...(codigo ? { codigo } : {}),
      nome: String(formData.nome || "").trim().toUpperCase(),
      tipo: formData.tipo,
      especie: textoOuNulo(formData.especie),
      cultivar: textoOuNulo(formData.cultivar),
      altura_entrada_cm: entrada == null ? null : String(entrada),
      altura_saida_cm: saida == null ? null : String(saida),
      observacoes: textoOuNulo(formData.observacoes),
      ativo: formData.ativo !== false,
    });
  };

  const travado = readOnly || isSubmitting;

  const formBody = (
    <form
      id={FORMULARIO_CULTURA_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-cultura"
      data-densidade={DENSIDADE_BASE1}
    >
      <B1Field
        label="Código"
        required={isExistingRecord}
        span={2}
        hasValue={Boolean(formData.codigo?.trim())}
        locked={readOnly}
        disabled={travado}
        error={erroDe("codigo", "Informe o código")}
        dica={isExistingRecord ? undefined : "Vazio: o sistema usa o próximo número."}
      >
        <input
          type="text"
          aria-label="Código da cultura"
          value={formData.codigo}
          onChange={(e) => handleChange("codigo", e.target.value)}
          placeholder={isExistingRecord ? "" : "AUTOMÁTICO"}
          maxLength={16}
          className={`${B1_FIELD_CTL_CLS} uppercase tabular-nums`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Nome"
        required
        span={6}
        hasValue={Boolean(formData.nome?.trim())}
        locked={readOnly}
        disabled={travado}
        error={erroDe("nome")}
      >
        <input
          type="text"
          aria-label="Nome da cultura"
          value={formData.nome}
          onChange={(e) => handleChange("nome", e.target.value)}
          placeholder="EX.: BRACHIARIA BRIZANTHA CV. MARANDU"
          maxLength={120}
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Tipo"
        required
        span={4}
        hasValue={Boolean(formData.tipo)}
        locked={readOnly}
        disabled={travado}
        error={erroDe("tipo")}
      >
        {readOnly ? (
          <input type="text" readOnly value={rotuloTipoCultura(formData.tipo)} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            value={formData.tipo || SELECT_EMPTY}
            onChange={(/** @type {React.ChangeEvent<HTMLSelectElement>} */ e) =>
              handleChange("tipo", e.target.value === SELECT_EMPTY ? "" : e.target.value)
            }
            className={B1_FIELD_CTL_CLS}
            aria-label="Tipo da cultura"
          >
            <option value={SELECT_EMPTY}>SELECIONE</option>
            {TIPOS_CULTURA.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </B1Select>
        )}
      </B1Field>

      <B1Field label="Espécie" span={6} hasValue={Boolean(formData.especie?.trim())} locked={readOnly} disabled={travado}>
        <input
          type="text"
          aria-label="Espécie"
          value={formData.especie}
          onChange={(e) => handleChange("especie", e.target.value)}
          placeholder="Ex.: Urochloa brizantha"
          maxLength={120}
          className={B1_FIELD_CTL_CLS}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field label="Cultivar" span={6} hasValue={Boolean(formData.cultivar?.trim())} locked={readOnly} disabled={travado}>
        <input
          type="text"
          aria-label="Cultivar"
          value={formData.cultivar}
          onChange={(e) => handleChange("cultivar", e.target.value)}
          placeholder="Ex.: Marandu"
          maxLength={120}
          className={B1_FIELD_CTL_CLS}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Altura de entrada (cm)"
        span={4}
        hasValue={String(formData.altura_entrada_cm ?? "").trim() !== ""}
        locked={readOnly}
        disabled={travado}
        error={erroDe("altura_entrada_cm", "Altura inválida")}
        dica="Altura do pasto para os animais entrarem."
      >
        <input
          type="text"
          inputMode="decimal"
          aria-label="Altura de entrada (cm)"
          value={formData.altura_entrada_cm}
          onChange={(e) => handleChange("altura_entrada_cm", e.target.value)}
          placeholder="EX.: 25"
          maxLength={8}
          className={`${B1_FIELD_CTL_CLS} tabular-nums`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Altura de saída (cm)"
        span={4}
        hasValue={String(formData.altura_saida_cm ?? "").trim() !== ""}
        locked={readOnly}
        disabled={travado}
        error={erroDe("altura_saida_cm", "Menor que a entrada")}
        dica="Altura do resíduo para os animais saírem."
      >
        <input
          type="text"
          inputMode="decimal"
          aria-label="Altura de saída (cm)"
          value={formData.altura_saida_cm}
          onChange={(e) => handleChange("altura_saida_cm", e.target.value)}
          placeholder="EX.: 15"
          maxLength={8}
          className={`${B1_FIELD_CTL_CLS} tabular-nums`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1ChaveRow
        label="Ativo"
        span={4}
        checked={formData.ativo}
        onChange={readOnly ? undefined : (/** @type {boolean} */ v) => handleChange("ativo", v)}
        disabled={travado}
        ariaLabel="Cultura ativa"
      />

      <B1Field
        label="Observações"
        span={12}
        hasValue={Boolean(formData.observacoes?.trim())}
        locked={readOnly}
        disabled={travado}
      >
        <textarea
          aria-label="Observações"
          value={formData.observacoes}
          onChange={(e) => handleChange("observacoes", e.target.value)}
          placeholder="Observações da cultura"
          maxLength={2000}
          className={`${B1_FIELD_CTL_CLS} min-h-[3rem] resize-y`}
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
    <CadastroFormShell embedded={embedded} title={isEditing ? "Editar Cultura" : "Nova Cultura"}>
      {formBody}
    </CadastroFormShell>
  );
}
