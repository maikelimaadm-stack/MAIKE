import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import GraficoCurvaGanho from "@/components/curvas-ganho/GraficoCurvaGanho";
import { notifyWarning } from "@/lib/maikeNotify";
import {
  CAMPOS_GMD,
  GMD_MAXIMO,
  GMD_MINIMO,
  MESES,
  formatarGmd,
  formatarKg,
  ganhoNoMes,
  lerGmd,
  resumoDaCurva,
} from "@/services/curvaGanhoCadastroService";

export const FORMULARIO_CURVA_GANHO_ID = "formulario-curva-ganho-base1";

const UPPERCASE_FIELDS = ["nome", "observacoes"];
const CTL_NUMERO = B1_FIELD_CTL_CLS.replace(" uppercase", " normal-case tabular-nums");

/**
 * @typedef {{
 *   id?: string,
 *   nome?: string,
 *   observacoes?: string | null,
 *   ativo?: boolean,
 *   [gmd: string]: unknown,
 * }} CurvaGanhoInicial
 * @typedef {{
 *   nome: string,
 *   observacoes: string | null,
 *   ativo: boolean,
 *   [gmd: string]: unknown,
 * }} CurvaGanhoEnvio
 */

/** Ajuda embaixo de cada mês: o ganho do mês em kg, com os dias reais do mês. */
const ajudaDoMes = (/** @type {string} */ texto, /** @type {number} */ dias) => {
  const n = lerGmd(texto);
  if (n === null) return "kg/dia";
  return `≈ ${formatarKg(ganhoNoMes(n, dias))} kg no mês`;
};

/**
 * Formulário do cadastro de Curvas de Ganho de Peso (D-PROD-189; mensal desde a
 * D-PROD-194).
 *
 * Campos, nesta ordem: Nome, os 12 GMD mensais (Jan a Dez), Ativo e
 * Observações. O GMD é em kg/dia, aceita vírgula ou ponto, sinal de menos
 * (perda de peso) e até 3 casas, de -2 a 3. Embaixo de cada mês aparece o ganho
 * do mês com os dias reais do mês, e um atalho repete o valor nos meses
 * seguintes. O resumo mostra o ganho no ano, a média por dia e o gráfico da
 * curva. A fazenda não é campo: é a selecionada no topo da tela. A curva não
 * depende das Estações.
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
    ...Object.fromEntries(CAMPOS_GMD.map((campo) => [campo, formatarGmd(initialData?.[campo])])),
    observacoes: initialData?.observacoes || "",
    ativo: initialData?.ativo ?? true,
  }));
  /** @type {Record<string, any>} */
  const dados = formData;

  /** @param {string} field @param {string | boolean} value */
  const handleChange = (field, value) => {
    const normalizedValue =
      UPPERCASE_FIELDS.includes(field) && typeof value === "string" ? value.toUpperCase() : value;
    setInvalidFields((prev) => prev.filter((f) => f !== field));
    setFormData((prev) => ({ ...prev, [field]: normalizedValue }));
  };

  /** Copia o GMD do mês `indice` para todos os meses seguintes, até dezembro. */
  const repetirNosSeguintes = (/** @type {number} */ indice) => {
    const valor = dados[CAMPOS_GMD[indice]];
    const seguintes = CAMPOS_GMD.slice(indice + 1);
    setInvalidFields((prev) => prev.filter((f) => !seguintes.includes(f)));
    setFormData((prev) => ({ ...prev, ...Object.fromEntries(seguintes.map((campo) => [campo, valor])) }));
  };

  const gmds = CAMPOS_GMD.map((campo) => lerGmd(dados[campo]));
  const resumo = resumoDaCurva(gmds);

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const faltando = [];
    if (!formData.nome?.trim()) faltando.push("nome");
    const gmdInvalidos = CAMPOS_GMD.filter((_, i) => gmds[i] === null);
    if (faltando.length || gmdInvalidos.length) {
      setInvalidFields([...faltando, ...gmdInvalidos]);
      notifyWarning(
        "Atenção",
        `Preencha o nome e o GMD dos 12 meses em kg/dia, de ${formatarGmd(GMD_MINIMO)} a ${formatarGmd(GMD_MAXIMO)}, com até 3 casas.`,
      );
      return;
    }
    const observacoes = String(formData.observacoes || "").trim().toUpperCase();
    onSubmit({
      nome: String(formData.nome || "").trim().toUpperCase(),
      ...Object.fromEntries(CAMPOS_GMD.map((campo, i) => [campo, gmds[i]])),
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

      <section className="col-span-12" aria-labelledby="curva-gmd-titulo" data-testid="curva-meses">
        <p id="curva-gmd-titulo" className="mb-2 text-[13px] font-medium text-[#3D3D3A]">
          GMD por mês (kg/dia)
        </p>
        <div className="grid grid-cols-12 gap-3">
          {MESES.map((mes, i) => {
            const campo = mes.campo;
            const valido = gmds[i] !== null;
            return (
              <B1Field
                key={campo}
                label={mes.curto}
                required
                span={2}
                className="col-span-4"
                hasValue={Boolean(String(dados[campo] ?? "").trim())}
                locked={readOnly}
                disabled={readOnly || isSubmitting}
                error={invalidFields.includes(campo) ? "Inválido" : undefined}
                dica={
                  readOnly ? undefined : (
                    <p className="b1-campo-dica flex-wrap text-[11px]" data-testid={`dica-${campo}`}>
                      <span>{ajudaDoMes(dados[campo], mes.dias)}</span>
                      {valido && i < MESES.length - 1 ? (
                        <button
                          type="button"
                          onClick={() => repetirNosSeguintes(i)}
                          className="text-[#0E7490] hover:underline focus-visible:underline"
                          title={`Repetir o GMD de ${mes.nome} até Dezembro`}
                          aria-label={`Repetir o GMD de ${mes.nome} nos meses seguintes`}
                          data-testid={`repetir-${campo}`}
                        >
                          repetir →
                        </button>
                      ) : null}
                    </p>
                  )
                }
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={dados[campo]}
                  onChange={(e) => handleChange(campo, e.target.value)}
                  placeholder="0,000"
                  className={CTL_NUMERO}
                  autoComplete="off"
                  maxLength={8}
                  readOnly={readOnly}
                  aria-label={`GMD de ${mes.nome} (kg/dia)`}
                  data-testid={`curva-${campo}`}
                />
              </B1Field>
            );
          })}
        </div>
        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:gap-6" data-testid="curva-resumo">
          <dl className="flex gap-6 text-[13px] text-[#3D3D3A]">
            <div>
              <dt className="text-[11px] text-[#73726C]">Ganho estimado no ano</dt>
              <dd className="font-medium tabular-nums" data-testid="curva-ganho-ano">
                {resumo ? `${formatarKg(resumo.ganhoAno)} kg` : "–"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[#73726C]">Média por dia</dt>
              <dd className="font-medium tabular-nums" data-testid="curva-media-dia">
                {resumo ? `${formatarGmd(resumo.mediaDia)} kg/dia` : "–"}
              </dd>
            </div>
          </dl>
          <GraficoCurvaGanho valores={gmds} className="h-auto w-full max-w-[420px]" />
        </div>
      </section>

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
