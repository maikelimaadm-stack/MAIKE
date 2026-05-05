import { base44 } from "@/api/base44Client";

export const layoutRepository = {
  async getLayoutSchema(tela) {
    const [layouts, secoes, campos] = await Promise.all([
      base44.entities.LayoutConfiguracao.list(),
      base44.entities.LayoutSecao.list(),
      base44.entities.LayoutCampo.list(),
    ]);

    const layout = layouts
      .filter((item) => item.tela === tela && item.ativo !== false)
      .sort((a, b) => (b.versao_ativa || 1) - (a.versao_ativa || 1))[0];

    if (!layout) return null;

    const layoutSecoes = secoes
      .filter((secao) => secao.layout_id === layout.id && secao.ativo !== false)
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

    const layoutCampos = campos
      .filter((campo) => campo.layout_id === layout.id && campo.ativo !== false)
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

    return { layout, secoes: layoutSecoes, campos: layoutCampos };
  },
};

export default layoutRepository;