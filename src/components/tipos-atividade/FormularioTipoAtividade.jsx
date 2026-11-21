import React, { useMemo, useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import Base1PanelTabs from "@/components/cadastro/base1/Base1PanelTabs";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { CampoSelect, CampoTexto } from "@/components/gestao/GestaoFormParts";
import { ALVOS_DA_APLICACAO } from "@/lib/camposPorTipo";
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
 *   alvo?: string | null,
 * }} TipoAtividadeInicial
 * @typedef {{ categoria: string, nome_tipo: string, ativo: boolean, alvo?: string | null }} TipoAtividadeEnvio
 */

/** D-PROD-271 — o "Outro (escrever)" da lista de alvos. */
const ALVO_OUTRO = "__OUTRO__";

/**
 * Formulário da OPERAÇÃO (o "tipo de atividade" de antes; D-PROD-258): só três campos — Tipo fixo (um dos 7, obrigatório),
 * Nome e Ativo. D-PROD-271: na Aplicação, o ALVO (lista curta + "Outro", que se escreve): vem preenchido na "Nova
 * realização de Aplicação", e o funcionário não escolhe; só vai no corpo da Aplicação (vazio limpa). Grupo, centros, unidade, coeficiente e as 8 chaves saíram da tela: o servidor dá o padrão automático na
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
    // D-PROD-271: o alvo da Aplicação; fora da lista curta, "Outro" com o texto.
    alvoEscolha: !initialData?.alvo ? "" : ALVOS_DA_APLICACAO.includes(String(initialData.alvo)) ? String(initialData.alvo) : ALVO_OUTRO,
    alvoOutro: initialData?.alvo && !ALVOS_DA_APLICACAO.includes(String(initialData.alvo)) ? String(initialData.alvo) : "",
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
    const alvo = formData.alvoEscolha === ALVO_OUTRO ? formData.alvoOutro.trim().replace(/\s+/g, " ").toUpperCase() : formData.alvoEscolha;
    onSubmit({
      categoria: formData.categoria,
      nome_tipo: String(formData.nome_tipo || "").trim().toUpperCase(),
      ativo: formData.ativo !== false,
      ...(formData.categoria === "APLICACAO" ? { alvo: alvo || null } : {}),
    });
  };

  const [abaAtiva, setAbaAtiva] = useState("identificacao");
  const abasTipo = useMemo(() => [{ id: "identificacao", label: "Identificação" }], []);
  const formBody = (
    <form
      id={FORMULARIO_TIPO_ATIVIDADE_ID}
      onSubmit={handleSubmit}
      className="b1 w-full min-h-0 flex flex-col gap-3"
      noValidate
      data-testid="b1-form-tipo-atividade"
      data-densidade={DENSIDADE_BASE1}
    >
      <Base1PanelTabs
        tabs={abasTipo}
        value={abaAtiva}
        onChange={setAbaAtiva}
        animate={!readOnly}
        animationKey={initialData?.id ?? "novo"}
        renderPanel={() => (
          <div className="mg-b1-form-grid w-full min-h-0" data-testid="tipo-atividade-secao-identificacao">
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

            {formData.categoria === "APLICACAO" ? (
              <>
                <CampoSelect
                  label="Alvo"
                  value={formData.alvoEscolha}
                  onChange={(v) => handleChange("alvoEscolha", v)}
                  options={[...ALVOS_DA_APLICACAO.map((a) => ({ value: a, label: a })), { value: ALVO_OUTRO, label: "OUTRO (ESCREVER)" }]}
                  placeholder="Sem alvo"
                  readOnly={bloqueado}
                  span={6}
                  dica={<p className="mt-1 px-1 text-[12px] text-[var(--mg-text-2,#475569)]">vem preenchido na Nova realização de Aplicação</p>}
                />
                {formData.alvoEscolha === ALVO_OUTRO ? (
                  <CampoTexto
                    label="Qual alvo"
                    value={formData.alvoOutro}
                    onChange={(v) => handleChange("alvoOutro", v.toUpperCase())}
                    readOnly={bloqueado}
                    span={6}
                    maxLength={60}
                    placeholder="EX.: CARRAPATO"
                    testId="tipo-atividade-alvo-outro"
                  />
                ) : null}
              </>
            ) : null}

            <B1ChaveRow
              label="Ativo"
              span={6}
              checked={formData.ativo}
              onChange={readOnly ? undefined : (/** @type {boolean} */ v) => handleChange("ativo", v)}
              disabled={readOnly || isSubmitting}
              ariaLabel="Operação ativa"
            />
          </div>
        )}
      />

      {!toolbarActions ? (
        <CadastroFormActions
          onCancel={onCancel}
          submitLabel={isExistingRecord ? "Atualizar" : "Salvar"}
          isSubmitting={isSubmitting}
        />
      ) : null}
    </form>
  );

  return (
    <CadastroFormShell embedded={embedded} title={isEditing ? "Editar Operação" : "Nova Operação"}>
      {formBody}
    </CadastroFormShell>
  );
}
