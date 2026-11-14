import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { notifyWarning } from "@/lib/maikeNotify";
import B1Select from "@/components/cadastro/base1/B1Select";
import {
  FAIXAS_IDADE_CATEGORIA_MANEJO,
  faixaIdadeDaLista,
  rotuloFaixaIdade,
  sexoOficial,
} from "@/domain/lotes/categoriaOficialDerivada";

export const FORMULARIO_CATEGORIA_MANEJO_ID = "formulario-categoria-manejo-base1";

/** Nome, Sexo e Faixa de idade são obrigatórios (decisão do proprietário, 2026-11-13). */
const REQUIRED_FIELDS = ["nome", "sexo", "faixa_idade"];
const UPPERCASE_FIELDS = ["nome", "sigla"];
const SELECT_EMPTY = "__VAZIO__";
const SEXOS = ["Macho", "Fêmea"];

/** Valor do select para o par gravado fora das cinco faixas (registro legado). */
export const FAIXA_FORA_DA_LISTA = "__FORA_DA_LISTA__";

/** Valor do select de uma faixa da lista: "mínima-máxima" ("37-" sem máxima). */
const valorDaFaixa = (faixa) => `${faixa.idade_minima_meses}-${faixa.idade_maxima_meses ?? ""}`;

/**
 * Valor do select "Faixa de idade" para o par do formulário: a faixa da lista;
 * par legado fora da lista → `FAIXA_FORA_DA_LISTA`; sem idade → "".
 */
export const valorFaixaIdade = (formData) => {
  const faixa = faixaIdadeDaLista(formData?.idade_minima_meses, formData?.idade_maxima_meses);
  if (faixa) return valorDaFaixa(faixa);
  return rotuloFaixaIdade(formData) ? FAIXA_FORA_DA_LISTA : "";
};

/** Rótulo da opção extra (desabilitada) que mostra o par legado: "De X a Y meses (fora da lista)". */
export const rotuloFaixaForaDaLista = (formData) => {
  const rotulo = rotuloFaixaIdade(formData);
  return `${/^\d/.test(rotulo) ? `De ${rotulo}` : rotulo} (fora da lista)`;
};

/** 'MACHO'/'femea' gravados → 'Macho'/'Fêmea' (a grafia das opções); outro valor fica como está. */
const sexoDoRegistro = (sexo) => {
  const oficial = sexoOficial(sexo);
  if (oficial === "MACHO") return "Macho";
  if (oficial === "FEMEA") return "Fêmea";
  return sexo ?? "";
};

export const getInitialFormData = () => ({
  nome: "",
  sigla: "",
  especie: "Bovinos",
  sexo: "",
  idade_minima_meses: "",
  idade_maxima_meses: "",
});

/**
 * Registro → formulário. `faixa_idade_alterada` começa falso: salvar sem mexer
 * no select NÃO reenvia as idades (o par gravado, mesmo legado, fica intocado).
 * O vínculo com o ícone oficial saiu do cadastro (D-PROD-187): mesmo que um
 * registro antigo em cache ainda o traga, o formulário não o mostra e o
 * service não o envia.
 */
export function buildFormInitialFromRecord(editando) {
  return {
    ...getInitialFormData(),
    ...editando,
    sexo: sexoDoRegistro(editando.sexo),
    idade_minima_meses: editando.idade_minima_meses ?? "",
    idade_maxima_meses: editando.idade_maxima_meses ?? "",
    faixa_idade_alterada: false,
  };
}

export default function FormularioCategoriaManejo({
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
  const [invalidFields, setInvalidFields] = useState([]);
  const [formData, setFormData] = useState(initialData || getInitialFormData());

  const handleChange = (field, value) => {
    const nextValue =
      UPPERCASE_FIELDS.includes(field) && typeof value === "string" ? value.toUpperCase() : value;
    setFormData((prev) => ({ ...prev, [field]: nextValue }));
    setInvalidFields((prev) => prev.filter((item) => item !== field));
  };

  /** Escolher no select grava o par da faixa e marca a faixa como alterada (só então as idades são enviadas). */
  const handleFaixaChange = (valor) => {
    const faixa = FAIXAS_IDADE_CATEGORIA_MANEJO.find((f) => valorDaFaixa(f) === valor);
    if (!faixa) return;
    setFormData((prev) => ({
      ...prev,
      idade_minima_meses: faixa.idade_minima_meses,
      idade_maxima_meses: faixa.idade_maxima_meses,
      faixa_idade_alterada: true,
    }));
    setInvalidFields((prev) => prev.filter((item) => item !== "faixa_idade"));
  };

  const isEmptyValue = (value) => {
    if (typeof value === "string") return value.trim() === "";
    return value === undefined || value === null || value === "";
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const faltando = {
      nome: isEmptyValue(formData?.nome),
      sexo: !SEXOS.includes(formData?.sexo),
      faixa_idade: valorFaixaIdade(formData) === "",
    };
    const missingFields = REQUIRED_FIELDS.filter((field) => faltando[field]);
    if (missingFields.length > 0) {
      setInvalidFields(missingFields);
      notifyWarning("Atenção", "Preencha os campos obrigatórios.");
      return;
    }
    onSubmit(formData);
  };

  const locked = readOnly || isSubmitting;
  const faixaValor = valorFaixaIdade(formData);

  const formBody = (
    <form
      id={FORMULARIO_CATEGORIA_MANEJO_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-categoria-manejo"
      data-densidade={DENSIDADE_BASE1}
    >
      <B1Field
        label="Nome da Categoria"
        required
        span={4}
        hasValue={Boolean(formData.nome?.trim())}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("nome") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={formData.nome || ""}
          onChange={(e) => handleChange("nome", e.target.value)}
          placeholder="NOME DA CATEGORIA"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Sigla"
        span={4}
        hasValue={Boolean(formData.sigla?.trim())}
        locked={readOnly}
        disabled={locked}
      >
        <input
          type="text"
          value={formData.sigla || ""}
          onChange={(e) => handleChange("sigla", e.target.value)}
          placeholder="SIGLA"
          maxLength={10}
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Espécie"
        span={4}
        hasValue={Boolean(formData.especie)}
        locked={readOnly}
        disabled={locked}
      >
        {readOnly ? (
          <input type="text" readOnly value={formData.especie || ""} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            value={formData.especie || "Bovinos"}
            onChange={(e) => handleChange("especie", e.target.value)}
            className={B1_FIELD_CTL_CLS}
          >
            <option value="Bovinos">Bovinos</option>
            <option value="Ovinos">Ovinos</option>
            <option value="Suínos">Suínos</option>
          </B1Select>
        )}
      </B1Field>

      <B1Field
        label="Sexo"
        required
        span={4}
        hasValue={Boolean(formData.sexo)}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("sexo") ? "Obrigatório" : undefined}
      >
        {readOnly ? (
          <input type="text" readOnly value={formData.sexo || ""} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            value={formData.sexo || SELECT_EMPTY}
            onChange={(e) => handleChange("sexo", e.target.value === SELECT_EMPTY ? "" : e.target.value)}
            className={B1_FIELD_CTL_CLS}
          >
            <option value={SELECT_EMPTY}>SELECIONE</option>
            <option value="Macho">Macho</option>
            <option value="Fêmea">Fêmea</option>
          </B1Select>
        )}
      </B1Field>

      <B1Field
        label="Faixa de idade"
        required
        span={4}
        hasValue={faixaValor !== ""}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("faixa_idade") ? "Obrigatório" : undefined}
      >
        {readOnly ? (
          <input type="text" readOnly value={rotuloFaixaIdade(formData)} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            value={faixaValor}
            onChange={(e) => handleFaixaChange(e.target.value)}
            className={B1_FIELD_CTL_CLS}
          >
            {/* Obrigatório: o "SELECIONE" (valor vazio) é só o marcador, fora da lista. */}
            <option value="">SELECIONE</option>
            {FAIXAS_IDADE_CATEGORIA_MANEJO.map((faixa) => (
              <option key={valorDaFaixa(faixa)} value={valorDaFaixa(faixa)}>
                {faixa.rotulo}
              </option>
            ))}
            {faixaValor === FAIXA_FORA_DA_LISTA ? (
              <option value={FAIXA_FORA_DA_LISTA} disabled>
                {rotuloFaixaForaDaLista(formData)}
              </option>
            ) : null}
          </B1Select>
        )}
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
    <CadastroFormShell
      embedded={embedded}
      title={isEditing ? "Editar Categoria de Manejo" : "Nova Categoria de Manejo"}
    >
      {formBody}
    </CadastroFormShell>
  );
}
