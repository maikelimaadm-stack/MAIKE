import React, { useState } from "react";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { notifyWarning } from "@/lib/maikeNotify";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { normalizarCodigoCatalogo } from "@/components/patrimonio/PatrimonioFormParts";
import { ROTULO_UNIDADE_COMBUSTIVEL, UNIDADES_COMBUSTIVEL } from "@/lib/patrimonioDominio";
import { PADRAO_CODIGO_CATALOGO } from "@/services/patrimonioCatalogoService";

export const FORMULARIO_COMBUSTIVEL_ID = "formulario-combustivel-base1";

const OPCOES_UNIDADE = UNIDADES_COMBUSTIVEL.map((u) => ({ value: u, label: ROTULO_UNIDADE_COMBUSTIVEL[u] }));

/**
 * Formulário do Combustível (D-PROD-157) — catálogo CLASSIFICATÓRIO: sem preço,
 * custo, saldo ou produto de estoque. Unidade escolhida na criação (padrão
 * litros) e imutável depois.
 *
 * @param {{ onSubmit: (dados: object) => void, initialData?: any, readOnly?: boolean }} props
 */
export default function FormularioCombustivel({ onSubmit, initialData = null, readOnly = false }) {
  const editando = Boolean(initialData?.id);
  const [form, setForm] = useState(() => ({
    codigo: editando ? String(initialData.codigo ?? "") : "",
    nome: initialData?.nome || "",
    unidade: UNIDADES_COMBUSTIVEL.includes(initialData?.unidade) ? initialData.unidade : "L",
    descricao: initialData?.descricao || "",
  }));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));

  const set = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    setErros((e) => ({ ...e, [campo]: "" }));
  };

  const enviar = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const codigo = normalizarCodigoCatalogo(form.codigo);
    /** @type {Record<string, string>} */
    const novos = {};
    if (!editando && !PADRAO_CODIGO_CATALOGO.test(codigo)) novos.codigo = "Use de 2 a 32 letras maiúsculas, números ou _";
    if (!form.nome.trim()) novos.nome = "Obrigatório";
    if (Object.keys(novos).length) {
      setErros(novos);
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    const comum = { nome: form.nome.trim(), descricao: form.descricao };
    onSubmit(editando ? comum : { codigo, unidade: form.unidade, ...comum });
  };

  return (
    <CadastroFormShell embedded title={editando ? "Editar combustível" : "Novo combustível"}>
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_COMBUSTIVEL_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="b1-form">
          <SecaoForm titulo="Identificação" />
          <CampoTexto
            label="Código"
            required={!editando}
            span={4}
            value={form.codigo}
            onChange={(v) => set("codigo", v)}
            readOnly={readOnly || editando}
            maxLength={32}
            error={erros.codigo || undefined}
            placeholder="EX.: DIESEL_S10"
          />
          <CampoTexto label="Nome" required span={8} value={form.nome} onChange={(v) => set("nome", v)} readOnly={readOnly} maxLength={120} error={erros.nome || undefined} placeholder="NOME DO COMBUSTÍVEL" />
          {editando ? (
            <CampoTexto label="Unidade" span={4} value={ROTULO_UNIDADE_COMBUSTIVEL[form.unidade] || form.unidade} onChange={() => {}} readOnly />
          ) : (
            <CampoSelect label="Unidade" required span={4} value={form.unidade} onChange={(v) => set("unidade", v)} options={OPCOES_UNIDADE} readOnly={readOnly} />
          )}
          <CampoTexto label="Descrição" span={8} value={form.descricao} onChange={(v) => set("descricao", v)} readOnly={readOnly} maxLength={500} />
          <div className="col-span-12">
            <AvisoGestao tone="blue" testId="combustivel-nota-unidade">
              Combustível aqui só classifica o que cada tanque aceita: não tem preço, custo nem saldo. Tanques aceitam apenas combustíveis em
              litros; combustível em m³ (como o GNV) fica no catálogo sem vínculo a tanque.
            </AvisoGestao>
          </div>
        </form>
      </div>
    </CadastroFormShell>
  );
}
