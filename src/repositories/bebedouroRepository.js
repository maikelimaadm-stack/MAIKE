import { base44 } from "@/api/base44Client";

const bebedouroRepository = {
  async listBebedouros(empresaId) {
    const all = await base44.entities.Bebedouro.list("-updated_date");
    return all.filter((item) => item.empresa_id === empresaId && item.ativo !== false);
  },

  async createBebedouro(data) {
    return base44.entities.Bebedouro.create(data);
  },

  async updateBebedouro(id, data) {
    return base44.entities.Bebedouro.update(id, data);
  },

  async listHistorico(empresaId, bebedouroId) {
    const all = await base44.entities.BebedouroHistorico.list("-data_lancamento");
    return all.filter((item) => item.empresa_id === empresaId && (!bebedouroId || item.bebedouro_id === bebedouroId));
  },

  async createHistorico(data) {
    return base44.entities.BebedouroHistorico.create(data);
  },

  async listSanidade(empresaId, bebedouroId) {
    const all = await base44.entities.BebedouroSanidade.list("-data_avaliacao");
    return all.filter((item) => item.empresa_id === empresaId && (!bebedouroId || item.bebedouro_id === bebedouroId));
  },

  async createSanidade(data) {
    return base44.entities.BebedouroSanidade.create(data);
  },

  async listAlertas(empresaId, bebedouroId) {
    const all = await base44.entities.BebedouroAlerta.list("-data_alerta");
    return all.filter((item) => item.empresa_id === empresaId && (!bebedouroId || item.bebedouro_id === bebedouroId));
  },
};

export default bebedouroRepository;