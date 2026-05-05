import { base44 } from "@/api/base44Client";

export const cadastroRepository = {
  async listAreasAtivas(empresaId) {
    const all = await base44.entities.AreaPastagem.list();
    return all.filter((area) => area.empresa_id === empresaId && area.ativo !== false);
  },

  async listCategoriasManejo(empresaId) {
    const all = await base44.entities.CategoriaManejo.list();
    return all.filter((categoria) => categoria.empresa_id === empresaId && categoria.ativo !== false);
  },

  async listFornecedores(empresaId) {
    const all = await base44.entities.Fornecedor.list();
    return all.filter((fornecedor) => fornecedor.empresa_id === empresaId);
  },
};

export default cadastroRepository;