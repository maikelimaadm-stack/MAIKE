import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import layoutRepository from "@/core/repositories/layoutRepository";
import { getLoteFields, LOTE_LAYOUT_VERSION } from "@/core/schemas/loteSchema";

const normalizeLayoutCampo = (campo) => ({
  id: campo.field_id || campo.id,
  name: campo.field_name,
  field_name: campo.field_name,
  label: campo.label,
  type: campo.tipo,
  origem: campo.origem || "fixo",
  required: !!campo.obrigatorio,
  colSpan: campo.col_span || 12,
  order: campo.ordem || 0,
  placeholder: campo.placeholder,
  uppercase: !!campo.uppercase,
  readOnly: !!campo.read_only,
  rows: campo.rows,
  step: campo.step,
  options: campo.options || [],
  rules: campo.regras || {},
  metadata: campo.metadata || {},
  visible: {
    form: campo.metadata?.visivel_formulario !== false,
    table: campo.metadata?.visivel_tabela !== false,
    report: campo.metadata?.visivel_relatorio !== false,
  },
});

export default function useLoteLayoutSchema(target = "form") {
  const query = useQuery({
    queryKey: ["layout-schema", "CadastroLotes"],
    queryFn: () => layoutRepository.getLayoutSchema("CadastroLotes"),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const schema = useMemo(() => {
    if (!query.data?.layout) return getLoteFields(target);

    return query.data.secoes.map((secao) => ({
      id: secao.section_id,
      title: secao.titulo,
      fields: query.data.campos
        .filter((campo) => campo.section_id === secao.section_id)
        .map(normalizeLayoutCampo)
        .filter((campo) => campo.visible?.[target] !== false)
        .sort((a, b) => (a.order || 0) - (b.order || 0)),
    })).filter((section) => section.fields.length > 0);
  }, [query.data, target]);

  return {
    ...query,
    schema,
    version: query.data?.layout?.versao_ativa || LOTE_LAYOUT_VERSION,
  };
}