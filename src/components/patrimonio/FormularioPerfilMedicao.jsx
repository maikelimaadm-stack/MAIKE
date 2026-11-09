import React, { useState } from "react";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { notifyWarning } from "@/lib/maikeNotify";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { EscolhaMultipla, normalizarCodigoCatalogo } from "@/components/patrimonio/PatrimonioFormParts";
import {
  DIMENSOES,
  FINALIDADES_PERFIL,
  ROTULO_DIMENSAO,
  ROTULO_FINALIDADE,
  rotuloDaUnidade,
  unidadeCanonicaDa,
  unidadesDaDimensao,
} from "@/lib/patrimonioDominio";
import { PADRAO_CODIGO_CATALOGO } from "@/services/patrimonioCatalogoService";

export const FORMULARIO_PERFIL_MEDICAO_ID = "formulario-perfil-medicao-base1";

const OPCOES_DIMENSAO = DIMENSOES.map((d) => ({ value: d, label: ROTULO_DIMENSAO[d] }));
const OPCOES_FINALIDADE = FINALIDADES_PERFIL.map((f) => ({ value: f, label: ROTULO_FINALIDADE[f] }));

/** @param {unknown} dimensao @param {unknown} unidades */
const unidadesIniciais = (dimensao, unidades) => {
  const canonica = unidadeCanonicaDa(dimensao);
  const validas = unidadesDaDimensao(dimensao);
  const escolhidas = (Array.isArray(unidades) ? unidades.map(String) : []).filter((u) => validas.includes(u));
  return canonica && !escolhidas.includes(canonica) ? [canonica, ...escolhidas] : escolhidas;
};

/**
 * Formulário do Perfil de Medição (D-PROD-156).
 *  - criação: dimensão e finalidade escolhidas explicitamente (imutáveis
 *    depois); a unidade padrão vem da dimensão e não vai no corpo;
 *  - unidades permitidas por escolha múltipla dentro da dimensão; a unidade
 *    padrão fica sempre marcada. Retirar unidade já usada em medições de bens
 *    é recusado pelo servidor (409 `PERFIL_UNIDADE_EM_USO`).
 *
 * @param {{ onSubmit: (dados: object) => void, initialData?: any, readOnly?: boolean }} props
 */
export default function FormularioPerfilMedicao({ onSubmit, initialData = null, readOnly = false }) {
  const editando = Boolean(initialData?.id);
  const [form, setForm] = useState(() => ({
    codigo: editando ? String(initialData.codigo ?? "") : "",
    nome: initialData?.nome || "",
    dimensao: DIMENSOES.includes(initialData?.dimensao) ? initialData.dimensao : "",
    finalidade: FINALIDADES_PERFIL.includes(initialData?.finalidade) ? initialData.finalidade : "",
    unidades: unidadesIniciais(initialData?.dimensao, initialData?.unidades_permitidas),
    descricao: initialData?.descricao || "",
  }));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));

  const set = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    setErros((e) => ({ ...e, [campo]: "" }));
  };

  const trocarDimensao = (dimensao) => {
    // Unidades só valem dentro da dimensão: trocar a dimensão recomeça pela unidade padrão.
    setForm((prev) => (prev.dimensao === dimensao ? prev : { ...prev, dimensao, unidades: unidadesIniciais(dimensao, []) }));
    setErros((e) => ({ ...e, dimensao: "" }));
  };

  const canonica = unidadeCanonicaDa(form.dimensao);
  const opcoesUnidade = unidadesDaDimensao(form.dimensao).map((u) => ({ value: u, label: rotuloDaUnidade(u), travada: u === canonica }));

  const enviar = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const codigo = normalizarCodigoCatalogo(form.codigo);
    /** @type {Record<string, string>} */
    const novos = {};
    if (!editando && !PADRAO_CODIGO_CATALOGO.test(codigo)) novos.codigo = "Use de 2 a 32 letras maiúsculas, números ou _";
    if (!form.nome.trim()) novos.nome = "Obrigatório";
    if (!editando && !DIMENSOES.includes(form.dimensao)) novos.dimensao = "Escolha a dimensão";
    if (!editando && !FINALIDADES_PERFIL.includes(form.finalidade)) novos.finalidade = "Escolha a finalidade";
    if (Object.keys(novos).length) {
      setErros(novos);
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    const unidades = unidadesIniciais(form.dimensao, form.unidades);
    const comum = { nome: form.nome.trim(), unidades_permitidas: unidades, descricao: form.descricao };
    onSubmit(editando ? comum : { codigo, dimensao: form.dimensao, finalidade: form.finalidade, ...comum });
  };

  return (
    <CadastroFormShell embedded title={editando ? "Editar perfil de medição" : "Novo perfil de medição"}>
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_PERFIL_MEDICAO_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="b1-form">
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
            placeholder="EX.: AREA"
          />
          <CampoTexto label="Nome" required span={8} value={form.nome} onChange={(v) => set("nome", v)} readOnly={readOnly} maxLength={120} error={erros.nome || undefined} placeholder="NOME DO PERFIL" />
          {editando ? (
            <>
              <CampoTexto label="Dimensão" span={4} value={ROTULO_DIMENSAO[form.dimensao] || ""} onChange={() => {}} readOnly />
              <CampoTexto label="Finalidade" span={8} value={ROTULO_FINALIDADE[form.finalidade] || ""} onChange={() => {}} readOnly />
            </>
          ) : (
            <>
              <CampoSelect
                label="Dimensão"
                required
                span={4}
                value={form.dimensao}
                onChange={trocarDimensao}
                options={OPCOES_DIMENSAO}
                readOnly={readOnly}
                placeholder="— Escolha a dimensão —"
                error={erros.dimensao || undefined}
              />
              <CampoSelect
                label="Finalidade"
                required
                span={8}
                value={form.finalidade}
                onChange={(v) => set("finalidade", v)}
                options={OPCOES_FINALIDADE}
                readOnly={readOnly}
                placeholder="— Escolha a finalidade —"
                error={erros.finalidade || undefined}
              />
            </>
          )}
          <SecaoForm titulo="Unidades" />
          {form.dimensao ? (
            <EscolhaMultipla
              rotulo="Unidades permitidas"
              testId="perfil-unidades-permitidas"
              opcoes={opcoesUnidade}
              valores={form.unidades}
              onChange={(v) => set("unidades", v)}
              readOnly={readOnly}
              ajuda={canonica ? `Unidade padrão: ${rotuloDaUnidade(canonica)} — sempre permitida; os valores são convertidos para ela.` : null}
            />
          ) : (
            <div className="col-span-12">
              <AvisoGestao tone="blue" testId="perfil-escolha-dimensao">
                Escolha a dimensão para ver as unidades.
              </AvisoGestao>
            </div>
          )}
          <CampoTexto label="Descrição" span={12} value={form.descricao} onChange={(v) => set("descricao", v)} readOnly={readOnly} maxLength={500} />
        </form>
      </div>
    </CadastroFormShell>
  );
}
