import React from "react";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { getBemFieldValue } from "@/components/patrimonio/TabelaBens";

const nada = () => {};

/**
 * Ficha somente leitura do bem patrimonial (D-PROD-156), a partir do resumo da
 * listagem: identificação, classificação, propriedade, medidor e situação.
 *
 * @param {{ registro: any }} props
 */
export default function ResumoBemPatrimonial({ registro }) {
  const v = (/** @type {string} */ campo) => (registro ? getBemFieldValue(registro, campo) : "");
  return (
    <CadastroFormShell embedded title="Bem patrimonial">
      <div className="mg-b1-record-form">
        <div className="b1 mg-b1-form-grid w-full min-h-0" data-testid="bem-resumo">
          <SecaoForm titulo="Identificação" />
          <CampoTexto label="Nº patrimonial" span={4} value={v("numero")} onChange={nada} readOnly />
          <CampoTexto label="Código de frota" span={4} value={v("codigo_frota")} onChange={nada} readOnly />
          <CampoTexto label="Situação" span={4} value={registro?.ativo === false ? "Inativo" : "Ativo"} onChange={nada} readOnly />
          <CampoTexto label="Nome" span={12} value={v("nome")} onChange={nada} readOnly />
          <SecaoForm titulo="Classificação" />
          <CampoTexto label="Natureza" span={4} value={v("natureza")} onChange={nada} readOnly />
          <CampoTexto label="Família" span={4} value={v("familia")} onChange={nada} readOnly />
          <CampoTexto label="Tipo" span={4} value={v("tipo")} onChange={nada} readOnly />
          <CampoTexto label="Propriedade" span={6} value={v("propriedade")} onChange={nada} readOnly />
          <CampoTexto label="Medidor" span={6} value={v("medidor")} onChange={nada} readOnly />
        </div>
      </div>
    </CadastroFormShell>
  );
}
