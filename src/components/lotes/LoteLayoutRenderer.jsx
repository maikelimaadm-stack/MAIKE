import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";
import LegacyTabs from "./LegacyTabs.jsx";

const compactFields = new Set(["numero_lote", "data_entrada", "quantidade_cabecas", "peso_medio_kg", "idade_media_meses", "nota_fiscal", "numero_gta", "valor_total_compra", "valor_por_cabeca", "valor_frete", "estado_origem"]);
const mediumFields = new Set(["identificador_cor"]);

export default function LoteLayoutRenderer({
  sections,
  camposLayout,
  activeTab,
  setActiveTab,
  FL,
  formData,
  errors,
  handleChange,
  renderCampoPersonalizado,
  setores,
  areasDoSetor,
  categoriasManejo,
  fornecedores,
  opcoesSexo,
  opcoesMotivoEntrada,
  opcoesCores,
  parseSistemasProdutivos,
  toggleSistemaProdutivo,
  isReadOnly,
  readOnlyClass,
  isFieldRequired
}) {
  const visibleFields = camposLayout.filter((campo) => campo.visivel_form !== false && campo.ativo !== false);
  const principalFields = visibleFields.filter((campo) => campo.section_id === "principal");
  const tabSections = sections.filter((secao) => secao.ativo !== false && secao.section_id !== "principal");
  const tabs = tabSections
    .filter((secao) => visibleFields.some((campo) => campo.section_id === secao.section_id))
    .map((secao) => ({ id: secao.section_id, label: secao.titulo }));

  React.useEffect(() => {
    if (tabs.length && !tabs.some((tab) => tab.id === activeTab)) setActiveTab(tabs[0].id);
  }, [tabs.map((tab) => tab.id).join("|"), activeTab, setActiveTab]);

  const renderField = (campo) => {
    if (campo.origem === "customizado") {
      return (
        <FL key={campo.id || campo.field_id} label={campo.label} required={isFieldRequired(campo)} error={errors[`campos_personalizados.${campo.field_name}`]} dataField={`campos_personalizados.${campo.field_name}`} wide={campo.tipo === "textarea"} medium={["datetime", "datetime-local", "data_hora", "datahora"].includes(campo.tipo)} compact={["number", "date", "time", "calculado"].includes(campo.tipo)}>
          {renderCampoPersonalizado(campo)}
        </FL>
      );
    }

    const required = isFieldRequired(campo);
    const common = { key: campo.id || campo.field_id, label: campo.label, required, error: errors[campo.field_name], dataField: campo.field_name, compact: compactFields.has(campo.field_name), medium: mediumFields.has(campo.field_name) };
    const inputClass = "h-[22px] text-xs border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1";
    const upperInputClass = `${inputClass} uppercase`;

    if (campo.metadata?.conditional_required === "Compra" && formData.motivo_entrada !== "Compra") return null;
    if (campo.metadata?.conditional_required === "Ajuste" && formData.motivo_entrada !== "Ajuste") return null;
    if (campo.metadata?.conditional_required === "Outros" && formData.motivo_entrada !== "Outros") return null;
    if (campo.field_name === "inventario_info" && formData.motivo_entrada !== "Inventário") return null;

    switch (campo.field_name) {
      case "nome":
        return <FL {...common}><Input value={formData.nome || ""} onChange={(e) => handleChange("nome", e.target.value)} placeholder="NOME DO LOTE" className={upperInputClass} style={{ textTransform: "uppercase" }} /></FL>;
      case "status_visual":
        return <FL {...common}><div className="h-[22px] flex items-center px-1"><span className="w-8 h-4 rounded-full bg-green-500 relative inline-block"><span className="absolute right-0.5 top-0.5 w-3 h-3 rounded-full bg-white" /></span></div></FL>;
      case "numero_lote":
        return <FL {...common}><Input value={formData.numero_lote || ""} readOnly className="h-[22px] text-xs text-left border-0 rounded-none shadow-none focus-visible:ring-0 bg-slate-50 px-1" /></FL>;
      case "data_entrada":
        return <FL {...common}><Input type="date" value={formData.data_entrada || ""} onChange={(e) => handleChange("data_entrada", e.target.value)} className={inputClass} /></FL>;
      case "setor_id":
        return <FL {...common}><AutocompleteGenerico items={setores} value={formData.setor_id} onChange={(value) => handleChange("setor_id", value || "")} placeholder="BUSCAR SETOR..." displayField="nome" searchFields={["nome", "numero_setor"]} className="w-full" inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[22px] text-xs px-1" /></FL>;
      case "area_entrada_id":
        return <FL {...common}><AutocompleteGenerico items={areasDoSetor} value={formData.area_entrada_id} onChange={(value) => handleChange("area_entrada_id", value)} placeholder={formData.setor_id ? "BUSCAR ÁREA..." : "SELECIONE O SETOR PRIMEIRO"} displayField="nome" searchFields={["nome", "numero_area"]} className="w-full" inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[22px] text-xs px-1" /></FL>;
      case "quantidade_cabecas":
        return <FL {...common}><Input type="number" value={formData.quantidade_cabecas || ""} onChange={(e) => handleChange("quantidade_cabecas", e.target.value)} placeholder="0" className={inputClass} /></FL>;
      case "categoria_manejo_id":
        return <FL {...common}><AutocompleteGenerico items={categoriasManejo} value={formData.categoria_manejo_id} onChange={(value) => handleChange("categoria_manejo_id", value)} placeholder="BUSCAR CATEGORIA..." displayField="nome" searchFields={["nome", "categoria_oficial", "sexo", "raca"]} className="w-full" inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[22px] text-xs px-1" renderItem={(item) => <div className="text-xs font-medium text-slate-900">{(item.nome || "").toUpperCase()} {item.categoria_oficial ? `(${item.categoria_oficial})` : ""}</div>} /></FL>;
      case "sexo":
        return <FL {...common}><AutocompleteGenerico items={opcoesSexo} value={formData.sexo} onChange={(value) => handleChange("sexo", value)} placeholder="BUSCAR SEXO..." displayField="nome" searchFields={["nome"]} className="w-full" inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[22px] text-xs px-1" /></FL>;
      case "raca_predominante":
        return <FL {...common}><Input value={formData.raca_predominante || ""} onChange={(e) => handleChange("raca_predominante", e.target.value)} placeholder="RAÇA" className={upperInputClass} style={{ textTransform: "uppercase" }} /></FL>;
      case "peso_medio_kg":
        return <FL {...common}><Input type="number" step="0.1" value={formData.peso_medio_kg || ""} onChange={(e) => handleChange("peso_medio_kg", e.target.value)} placeholder="0.0" className={inputClass} /></FL>;
      case "idade_media_meses":
        return <FL {...common}><Input type="number" value={formData.idade_media_meses || ""} onChange={(e) => handleChange("idade_media_meses", e.target.value)} placeholder="0" className={inputClass} /></FL>;
      case "sistema_produtivo":
        return <FL {...common} wide><div className="px-1 py-1 space-y-1 bg-transparent"><div className="text-[11px] leading-none text-slate-500">{parseSistemasProdutivos(formData.sistema_produtivo).length > 0 ? parseSistemasProdutivos(formData.sistema_produtivo).join(", ") : "SELECIONE UM OU MAIS TIPOS"}</div><div className="border border-slate-300 bg-white p-1 space-y-1">{["Cria", "Recria", "Engorda", "Ciclo Completo"].map((item) => { const checked = parseSistemasProdutivos(formData.sistema_produtivo).includes(item); return <label key={item} className="flex h-[22px] w-full items-center gap-1 text-xs text-slate-700 uppercase text-left bg-white hover:bg-slate-50 px-1 cursor-pointer"><input type="checkbox" checked={checked} onChange={() => toggleSistemaProdutivo(item)} disabled={isReadOnly} className="h-3 w-3 rounded-none border-slate-400 accent-green-500 focus:ring-0" /><span>{item}</span></label>; })}</div></div></FL>;
      case "motivo_entrada":
        return <FL {...common}><AutocompleteGenerico items={opcoesMotivoEntrada} value={formData.motivo_entrada} onChange={(value) => handleChange("motivo_entrada", value)} placeholder="BUSCAR MOTIVO..." displayField="nome" searchFields={["nome"]} className="w-full" inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[22px] text-xs px-1" /></FL>;
      case "fornecedor_id":
        return <FL {...common}><AutocompleteGenerico items={fornecedores} value={formData.fornecedor_id} onChange={(value) => handleChange("fornecedor_id", value)} placeholder="BUSCAR FORNECEDOR..." displayField="nome" searchFields={["nome", "cpf", "cnpj", "cidade", "estado"]} className="w-full" inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[22px] text-xs px-1" /></FL>;
      case "cidade_origem":
      case "estado_origem":
      case "nota_fiscal":
      case "chave_nfe":
      case "numero_gta":
      case "identificador_nome":
      case "identificador_sigla":
        return <FL {...common}><Input value={formData[campo.field_name] || ""} onChange={(e) => handleChange(campo.field_name, campo.field_name === "identificador_sigla" ? e.target.value.slice(0, 2) : e.target.value)} placeholder={campo.label.toUpperCase()} className={upperInputClass} style={{ textTransform: "uppercase" }} maxLength={campo.field_name === "estado_origem" || campo.field_name === "identificador_sigla" ? 2 : undefined} /></FL>;
      case "valor_total_compra":
      case "valor_frete":
        return <FL {...common}><Input type="number" step="0.01" value={formData[campo.field_name] || ""} onChange={(e) => handleChange(campo.field_name, e.target.value)} placeholder="0.00" className={inputClass} /></FL>;
      case "valor_por_cabeca":
        return <FL {...common}><Input type="number" step="0.01" value={formData.valor_por_cabeca || ""} readOnly placeholder="Calculado" className="h-[22px] text-xs border-0 rounded-none shadow-none focus-visible:ring-0 bg-slate-50 px-1" /></FL>;
      case "motivo_ajuste":
      case "motivo_outros":
      case "observacoes":
        return <FL {...common} wide><Textarea value={formData[campo.field_name] || ""} onChange={(e) => handleChange(campo.field_name, e.target.value)} placeholder={(campo.placeholder || campo.label || "").toUpperCase()} className={`text-xs uppercase bg-transparent px-1 ${readOnlyClass}`} style={{ textTransform: "uppercase" }} rows={2} /></FL>;
      case "inventario_info":
        return <div key={campo.field_name} className="ml-[191px] border border-slate-300 p-2 bg-slate-50 text-xs text-slate-600">Registro de inventário para contagem e conferência do rebanho.</div>;
      case "identificador_cor":
        return <FL {...common}><AutocompleteGenerico items={opcoesCores} value={formData.identificador_cor} onChange={(value) => handleChange("identificador_cor", value)} placeholder="BUSCAR COR..." displayField="nome" searchFields={["nome"]} className="w-full" inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[22px] text-xs px-1" renderItem={(item) => <div className="flex items-center gap-2 text-xs font-medium text-slate-900"><span className="w-3 h-3 rounded-full border border-slate-300" style={{ backgroundColor: item.cor }} />{item.nome}</div>} /></FL>;
      default:
        return null;
    }
  };

  return (
    <>
      <fieldset className={isReadOnly ? "pointer-events-none [&_input]:cursor-default [&_textarea]:cursor-default [&_button]:cursor-default" : ""}>
        <div className="px-4 md:px-8 py-1 space-y-1 max-w-[760px]">
          {principalFields.map(renderField)}
        </div>
      </fieldset>
      <LegacyTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      <fieldset className={isReadOnly ? "pointer-events-none [&_input]:cursor-default [&_textarea]:cursor-default [&_button]:cursor-default" : ""}>
        <div className="min-h-[360px] px-4 md:px-8 py-1">
          <div className="max-w-[780px] space-y-1">
            {visibleFields.filter((campo) => campo.section_id === activeTab).map(renderField)}
          </div>
        </div>
      </fieldset>
    </>
  );
}