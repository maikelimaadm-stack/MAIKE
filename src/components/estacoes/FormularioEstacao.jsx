import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import B1Select from "@/components/cadastro/base1/B1Select";
import { CampoDia } from "@/components/financeiroGestao/CamposLancamento";
import { notifyWarning } from "@/lib/maikeNotify";
import { ehDiaValido } from "@/lib/diaCivil";
import { TIPOS_ESTACAO, rotuloTipoEstacao } from "@/services/estacaoCadastroService";

export const FORMULARIO_ESTACAO_ID = "formulario-estacao-base1";

const SELECT_EMPTY = "__VAZIO__";
/** Mesma faixa de anos aceita pelo servidor (D-PROD-188). */
const ANO_MINIMO = 1900;
const ANO_MAXIMO = 2100;
/** @param {string} dia */
const anoForaDaFaixa = (dia) => {
  const ano = Number(String(dia).slice(0, 4));
  return ano < ANO_MINIMO || ano > ANO_MAXIMO;
};
const UPPERCASE_FIELDS = ["nome", "observacoes"];

/**
 * @typedef {{
 *   id?: string,
 *   nome?: string,
 *   tipo?: string,
 *   data_inicio?: string,
 *   data_fim?: string,
 *   observacoes?: string | null,
 *   ativo?: boolean,
 * }} EstacaoInicial
 * @typedef {{
 *   nome: string,
 *   tipo: string,
 *   data_inicio: string,
 *   data_fim: string,
 *   observacoes: string | null,
 *   ativo: boolean,
 * }} EstacaoEnvio
 */

/**
 * Formulário do cadastro de Estações da fazenda (D-PROD-188).
 *
 * Campos, nesta ordem: Nome, Tipo (ÁGUAS / TRANSIÇÃO / SECA), Data de início,
 * Data de fim, Ativo e Observações. As datas são o TEXTO do dia (AAAA-MM-DD),
 * sem `Date` local, para nunca deslocar com o fuso. A fazenda não é campo: é a
 * selecionada no topo da tela.
 *
 * @param {{
 *   initialData?: EstacaoInicial | null,
 *   isEditing?: boolean,
 *   onSubmit: (dados: EstacaoEnvio) => void,
 *   onCancel?: () => void,
 *   variant?: "card" | "embedded",
 *   toolbarActions?: boolean,
 *   isSubmitting?: boolean,
 *   readOnly?: boolean,
 * }} props
 */
export default function FormularioEstacao({
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
    tipo: initialData?.tipo || "",
    data_inicio: initialData?.data_inicio || "",
    data_fim: initialData?.data_fim || "",
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

  /** @param {string} campo */
  const erroDe = (campo) => (invalidFields.includes(campo) ? "Obrigatório" : undefined);

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const missing = [];
    if (!formData.nome?.trim()) missing.push("nome");
    if (!formData.tipo) missing.push("tipo");
    if (!ehDiaValido(formData.data_inicio)) missing.push("data_inicio");
    if (!ehDiaValido(formData.data_fim)) missing.push("data_fim");
    if (missing.length) {
      setInvalidFields(missing);
      notifyWarning("Atenção", "Preencha os campos obrigatórios: Nome, Tipo, Data de início e Data de fim.");
      return;
    }
    const anosForaDaFaixa = ["data_inicio", "data_fim"].filter((campo) => anoForaDaFaixa(formData[campo]));
    if (anosForaDaFaixa.length) {
      setInvalidFields(anosForaDaFaixa);
      notifyWarning("Atenção", `As datas precisam estar entre os anos ${ANO_MINIMO} e ${ANO_MAXIMO}.`);
      return;
    }
    // Texto AAAA-MM-DD compara na ordem do calendário.
    if (formData.data_fim < formData.data_inicio) {
      setInvalidFields(["data_fim"]);
      notifyWarning("Atenção", "A data de fim não pode ser anterior à data de início.");
      return;
    }
    const observacoes = String(formData.observacoes || "").trim().toUpperCase();
    onSubmit({
      nome: String(formData.nome || "").trim().toUpperCase(),
      tipo: formData.tipo,
      data_inicio: formData.data_inicio,
      data_fim: formData.data_fim,
      observacoes: observacoes || null,
      ativo: formData.ativo !== false,
    });
  };

  const formBody = (
    <form
      id={FORMULARIO_ESTACAO_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-estacao"
      data-densidade={DENSIDADE_BASE1}
    >
      <B1Field
        label="Nome"
        required
        span={6}
        hasValue={Boolean(formData.nome?.trim())}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
        error={erroDe("nome")}
      >
        <input
          type="text"
          value={formData.nome}
          onChange={(e) => handleChange("nome", e.target.value)}
          placeholder="EX.: ÁGUAS 2026/2027"
          maxLength={120}
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Tipo"
        required
        span={6}
        hasValue={Boolean(formData.tipo)}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
        error={erroDe("tipo")}
      >
        {readOnly ? (
          <input type="text" readOnly value={rotuloTipoEstacao(formData.tipo)} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            value={formData.tipo || SELECT_EMPTY}
            onChange={(/** @type {React.ChangeEvent<HTMLSelectElement>} */ e) =>
              handleChange("tipo", e.target.value === SELECT_EMPTY ? "" : e.target.value)
            }
            className={B1_FIELD_CTL_CLS}
            aria-label="Tipo da estação"
          >
            <option value={SELECT_EMPTY}>SELECIONE</option>
            {TIPOS_ESTACAO.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </B1Select>
        )}
      </B1Field>

      <CampoDia
        label="Data de início"
        required
        span={4}
        value={formData.data_inicio}
        onChange={(v) => handleChange("data_inicio", v)}
        readOnly={readOnly || isSubmitting}
        error={erroDe("data_inicio")}
        max={formData.data_fim || undefined}
        testId="estacao-data-inicio"
      />

      <CampoDia
        label="Data de fim"
        required
        span={4}
        value={formData.data_fim}
        onChange={(v) => handleChange("data_fim", v)}
        readOnly={readOnly || isSubmitting}
        error={erroDe("data_fim")}
        min={formData.data_inicio || undefined}
        testId="estacao-data-fim"
      />

      <B1ChaveRow
        label="Ativo"
        span={4}
        checked={formData.ativo}
        onChange={readOnly ? undefined : (/** @type {boolean} */ v) => handleChange("ativo", v)}
        disabled={readOnly || isSubmitting}
        ariaLabel="Estação ativa"
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
          placeholder="OBSERVAÇÕES DA ESTAÇÃO"
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
    <CadastroFormShell embedded={embedded} title={isEditing ? "Editar Estação" : "Nova Estação"}>
      {formBody}
    </CadastroFormShell>
  );
}
