import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { notifyWarning } from "@/lib/maikeNotify";
import { numeroPtBr } from "@/services/categoriaManejoService";
import B1Select from "@/components/cadastro/base1/B1Select";
import {
  FAIXAS_IDADE_CATEGORIA_MANEJO,
  faixaIdadeDaLista,
  rotuloFaixaIdade,
  sexoOficial,
} from "@/domain/lotes/categoriaOficialDerivada";

export const FORMULARIO_CATEGORIA_MANEJO_ID = "formulario-categoria-manejo-base1";

/**
 * Nome, Sexo e Faixa de idade são obrigatórios (decisão do proprietário,
 * 2026-11-13); a Curva de ganho também, desde a D-PROD-195.
 */
const REQUIRED_FIELDS = ["nome", "sexo", "faixa_idade", "curva_ganho_id"];

/**
 * D-PROD-198: peso objetivo opcional — vazio vale; preenchido precisa ser
 * número > 0 e até 3.000 kg (aceita vírgula).
 * @param {unknown} v
 */
export const pesoObjetivoValido = (v) => {
  const t = String(v ?? "").trim();
  if (!t) return true;
  const n = numeroPtBr(t);
  return Number.isFinite(n) && n > 0 && n <= 3000;
};
const UPPERCASE_FIELDS = ["nome", "sigla"];
const SELECT_EMPTY = "__VAZIO__";
const SEXOS = ["Macho", "Fêmea"];

/** Valor do select para o par gravado fora das cinco faixas (registro legado). */
export const FAIXA_FORA_DA_LISTA = "__FORA_DA_LISTA__";

/** Sufixo da curva gravada que foi inativada depois (D-PROD-195): continua escolhível para manter. */
export const SUFIXO_CURVA_INATIVA = " (INATIVA)";

/** Dica quando a fazenda não tem curva ativa para escolher. */
export const DICA_SEM_CURVA = "Cadastre uma curva em Manejo → Curvas de Ganho";

/** Sem fazenda real selecionada não há curvas para listar (o fallback do tenant não é fazenda). */
export const DICA_SEM_FAZENDA = "Selecione uma fazenda no topo da tela para escolher a curva de ganho.";

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/**
 * Opções do select "Curva de ganho" (D-PROD-195): as curvas ATIVAS da fazenda e
 * mais a gravada no registro, mesmo inativa (com "(INATIVA)"), para que salvar
 * sem trocar mantenha a curva. Gravada fora da lista (lista ainda não carregou
 * ou falhou) aparece pelo nome vindo do registro. Em ordem de nome.
 *
 * @param {Array<{ id?: unknown, nome?: unknown, ativo?: unknown }> | null | undefined} curvas
 * @param {{ id?: unknown, nome?: unknown } | null | undefined} gravada
 * @returns {Array<{ value: string, label: string }>}
 */
export const opcoesCurvaGanho = (curvas, gravada) => {
  const lista = Array.isArray(curvas) ? curvas.filter((c) => c && c.id) : [];
  const opcoes = lista
    .filter((c) => c.ativo !== false)
    .map((c) => ({ value: String(c.id), label: String(c.nome ?? "") }));
  const idGravada = gravada?.id ? String(gravada.id) : "";
  if (idGravada && !opcoes.some((o) => o.value === idGravada)) {
    const naLista = lista.find((c) => String(c.id) === idGravada);
    const nome = String(naLista?.nome ?? gravada?.nome ?? "") || "CURVA GRAVADA";
    opcoes.push({ value: idGravada, label: naLista?.ativo === false ? `${nome}${SUFIXO_CURVA_INATIVA}` : nome });
  }
  return opcoes.sort((a, b) => collator.compare(a.label, b.label));
};

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
  curva_ganho_id: "",
  peso_objetivo_kg: "",
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
    curva_ganho_id: editando.curva_ganho_id ?? "",
    peso_objetivo_kg: editando.peso_objetivo_kg === null || editando.peso_objetivo_kg === undefined ? "" : String(editando.peso_objetivo_kg).replace(".", ","),
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
  curvasGanho = [],
  carregandoCurvas = false,
  erroCurvas = false,
  semFazenda = false,
}) {
  const embedded = variant === "embedded";
  const isExistingRecord = Boolean(initialData?.id);
  const [invalidFields, setInvalidFields] = useState([]);
  const [formData, setFormData] = useState(initialData || getInitialFormData());
  // A curva gravada no registro (não a escolha atual): continua na lista mesmo inativa.
  const [curvaGravada] = useState(() =>
    initialData?.curva_ganho_id ? { id: initialData.curva_ganho_id, nome: initialData.curva_ganho_nome } : null,
  );

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
      curva_ganho_id: isEmptyValue(formData?.curva_ganho_id),
      peso_objetivo_kg: !pesoObjetivoValido(formData?.peso_objetivo_kg),
    };
    const missingFields = REQUIRED_FIELDS.filter((field) => faltando[field]);
    if (missingFields.length > 0 || faltando.peso_objetivo_kg) {
      setInvalidFields([...missingFields, ...(faltando.peso_objetivo_kg ? ["peso_objetivo_kg"] : [])]);
      notifyWarning("Atenção", missingFields.length > 0 ? "Preencha os campos obrigatórios." : "Peso objetivo inválido: informe um peso maior que 0 e até 3.000 kg.");
      return;
    }
    onSubmit(formData);
  };

  const locked = readOnly || isSubmitting;
  const faixaValor = valorFaixaIdade(formData);
  const curvaValor = formData.curva_ganho_id ? String(formData.curva_ganho_id) : "";
  const opcoesCurva = opcoesCurvaGanho(curvasGanho, curvaGravada);
  // Nome exibido: o da lista (atual) ou o que veio no registro (`curva_ganho_nome`).
  const nomeCurva =
    (Array.isArray(curvasGanho) ? curvasGanho.find((c) => c && String(c.id) === curvaValor)?.nome : undefined) ??
    (curvaValor && curvaValor === String(initialData?.curva_ganho_id ?? "") ? initialData?.curva_ganho_nome : undefined) ??
    "";
  const semCurvaAtiva =
    !semFazenda && !carregandoCurvas && !erroCurvas && !(Array.isArray(curvasGanho) && curvasGanho.some((c) => c && c.ativo !== false));
  const dicaCurva = (() => {
    if (readOnly) return undefined;
    if (semFazenda) return DICA_SEM_FAZENDA;
    if (erroCurvas) return "Não foi possível carregar as curvas de ganho.";
    if (carregandoCurvas) return "Carregando curvas de ganho…";
    return semCurvaAtiva ? DICA_SEM_CURVA : undefined;
  })();

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

      <B1Field
        label="Curva de ganho"
        required
        span={4}
        hasValue={curvaValor !== ""}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("curva_ganho_id") ? "Obrigatório" : undefined}
        dica={dicaCurva}
      >
        {readOnly ? (
          <input type="text" readOnly value={nomeCurva} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            value={curvaValor}
            onChange={(e) => handleChange("curva_ganho_id", e.target.value)}
            className={B1_FIELD_CTL_CLS}
            pesquisa="sempre"
            data-testid="categoria-curva-ganho"
          >
            {/* D-PROD-195: obrigatória e da mesma fazenda; "SELECIONE" é só o marcador. */}
            <option value="">SELECIONE</option>
            {opcoesCurva.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </B1Select>
        )}
      </B1Field>

      <B1Field
        label="Peso objetivo (kg)"
        span={4}
        hasValue={String(formData.peso_objetivo_kg ?? "").trim() !== ""}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("peso_objetivo_kg") ? "Informe um peso maior que 0 e até 3.000 kg" : undefined}
        dica="Opcional. O lote mostra quando chega a este peso pela curva de ganho."
      >
        <input
          type="text"
          inputMode="decimal"
          aria-label="Peso objetivo (kg)"
          value={formData.peso_objetivo_kg ?? ""}
          onChange={(e) => handleChange("peso_objetivo_kg", e.target.value)}
          placeholder="EX.: 540"
          className={`${B1_FIELD_CTL_CLS} tabular-nums`}
          readOnly={readOnly}
          data-testid="categoria-peso-objetivo"
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
    <CadastroFormShell
      embedded={embedded}
      title={isEditing ? "Editar Categoria de Manejo" : "Nova Categoria de Manejo"}
    >
      {formBody}
    </CadastroFormShell>
  );
}
