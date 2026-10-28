import React, { useMemo, useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { notifyWarning } from "@/lib/maikeNotify";

export const FORMULARIO_CATEGORIA_ID = "formulario-categoria-produto-base1";

const SELECT_EMPTY = "__VAZIO__";

/** Todos os descendentes de `raizId` (não inclui a raiz). */
export const idsDescendentesDe = (categorias, raizId) => {
  const excluir = new Set();
  const fila = [raizId];
  while (fila.length) {
    const atual = fila.shift();
    for (const c of categorias) {
      if (c.categoria_pai_id === atual && !excluir.has(c.id)) {
        excluir.add(c.id);
        fila.push(c.id);
      }
    }
  }
  return excluir;
};

export default function FormularioCategoriaProduto({
  onSubmit,
  onCancel,
  initialData,
  categoriasExistentes = [],
  variant = "card",
  toolbarActions = false,
  isSubmitting = false,
  readOnly = false,
}) {
  const embedded = variant === "embedded";
  const [invalidFields, setInvalidFields] = useState([]);
  const [formData, setFormData] = useState(() => ({
    nome: initialData?.nome || "",
    categoria_pai_id: initialData?.categoria_pai_id || "",
    descricao: initialData?.descricao || "",
    ativo: initialData?.ativo !== false,
  }));

  const handleChange = (field, value) => {
    setInvalidFields((prev) => prev.filter((f) => f !== field));
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const descendentesDoEditado = initialData?.id
    ? idsDescendentesDe(categoriasExistentes, initialData.id)
    : new Set();

  const categoriasPaiDisponiveis = useMemo(
    () =>
      categoriasExistentes.filter((c) => {
        if (initialData && c.id === initialData.id) return false;
        if (descendentesDoEditado.has(c.id)) return false;
        return true;
      }),
    [categoriasExistentes, initialData, descendentesDoEditado],
  );

  const validateForm = () => {
    if (!formData.nome?.trim()) {
      setInvalidFields(["nome"]);
      notifyWarning("Atenção", "Preencha o campo obrigatório: Nome.");
      return false;
    }
    return true;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    if (!validateForm()) return;

    const siblings = categoriasExistentes.filter((c) => {
      if (formData.categoria_pai_id) return c.categoria_pai_id === formData.categoria_pai_id;
      return !c.categoria_pai_id;
    });
    let ordem = initialData?.ordem ?? 0;
    if (!initialData?.id) {
      const maxOrdem = siblings.reduce((max, c) => Math.max(max, c.ordem ?? 0), 0);
      ordem = maxOrdem + 1;
    }

    const categoriaPai = categoriasExistentes.find((c) => c.id === formData.categoria_pai_id);
    const paiId = formData.categoria_pai_id || null;

    onSubmit({
      nome: formData.nome.toUpperCase(),
      categoria_pai_id: paiId,
      categoria_pai_nome: categoriaPai?.nome || "",
      descricao: formData.descricao?.toUpperCase() || "",
      ativo: formData.ativo,
      ordem,
    });
  };

  const paiSelectClass = `${B1_FIELD_CTL_CLS} uppercase`;

  const formBody = (
    <form
      id={FORMULARIO_CATEGORIA_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-categoria"
    >
      <B1Field
        label="Nome"
        required
        span={6}
        hasValue={Boolean(formData.nome?.trim())}
        locked={readOnly}
        disabled={readOnly}
        error={invalidFields.includes("nome") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={formData.nome}
          onChange={(e) => handleChange("nome", e.target.value)}
          placeholder="NOME DA CATEGORIA"
          className={B1_FIELD_CTL_CLS}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Categoria pai"
        span={6}
        hasValue={Boolean(formData.categoria_pai_id)}
        locked={readOnly}
        disabled={readOnly}
      >
        {readOnly ? (
          <input
            type="text"
            readOnly
            value={
              formData.categoria_pai_id
                ? (categoriasExistentes.find((c) => c.id === formData.categoria_pai_id)?.nome || "").toUpperCase()
                : "NENHUMA (RAIZ)"
            }
            className={B1_FIELD_CTL_CLS}
          />
        ) : (
          <select
            value={formData.categoria_pai_id || SELECT_EMPTY}
            onChange={(e) =>
              handleChange("categoria_pai_id", e.target.value === SELECT_EMPTY ? "" : e.target.value)
            }
            className={paiSelectClass}
          >
            <option value={SELECT_EMPTY}>NENHUMA (RAIZ / PRINCIPAL)</option>
            {categoriasPaiDisponiveis.map((c) => (
              <option key={c.id} value={c.id}>
                {(c.nome || "").toUpperCase()}
              </option>
            ))}
          </select>
        )}
      </B1Field>
      <B1Field
        label="Descrição"
        span={12}
        multiline
        hasValue={Boolean(formData.descricao?.trim())}
        locked={readOnly}
        disabled={readOnly}
      >
        <textarea
          value={formData.descricao}
          onChange={(e) => handleChange("descricao", e.target.value)}
          placeholder="DESCRIÇÃO OPCIONAL..."
          className={`${B1_FIELD_CTL_CLS} uppercase min-h-[4rem]`}
          rows={2}
          readOnly={readOnly}
        />
      </B1Field>
      <B1ChaveRow
        label="Categoria ativa"
        span={4}
        checked={formData.ativo}
        onChange={readOnly ? undefined : (v) => handleChange("ativo", v)}
        disabled={readOnly}
        ariaLabel="Categoria ativa"
      />
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
