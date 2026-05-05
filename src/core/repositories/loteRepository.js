import { base44 } from "@/api/base44Client";
import { ensureDeleteAllowed } from "@/lib/entityDeleteGuards";

const ORIGENS_SISTEMA = ['MOVIMENTAÇÃO', 'REVERSÃO MOVIMENTAÇÃO', 'Nascimento', 'Mudança de Categoria', 'NASCIMENTO', 'MUDANÇA DE CATEGORIA'];

export const loteRepository = {
  async list({ empresaId, includeSystemOrigins = false } = {}) {
    const all = await base44.entities.Lote.list();
    return all.filter((lote) => {
      if (empresaId && lote.empresa_id !== empresaId) return false;
      if (!includeSystemOrigins && ORIGENS_SISTEMA.includes(lote.origem)) return false;
      return true;
    });
  },

  async getNextNumeroLote() {
    const allLotes = await base44.entities.Lote.list();
    const maxNum = allLotes.reduce((max, lote) => Math.max(max, parseInt(lote.numero_lote) || 0), 0);
    return String(maxNum + 1);
  },

  async create(data, { empresaId } = {}) {
    const numero_lote = data.numero_lote || await this.getNextNumeroLote();
    return base44.entities.Lote.create({
      ...data,
      empresa_id: data.empresa_id || empresaId,
      numero_lote,
      status: data.status || 'Ativo',
      campos_personalizados: data.campos_personalizados || {},
    });
  },

  async update(id, data) {
    return base44.entities.Lote.update(id, {
      ...data,
      campos_personalizados: data.campos_personalizados || {},
    });
  },

  async delete(id) {
    await ensureDeleteAllowed(base44, 'Lote', id);
    return base44.entities.Lote.delete(id);
  },

  async listIdsComMovimentacoes(empresaId) {
    const [movsPecuaria, movsMapa] = await Promise.all([
      base44.entities.MovimentacaoPecuaria.list(),
      base44.entities.MovimentacaoMapa.list(),
    ]);
    const idsPecuaria = movsPecuaria.filter((mov) => mov.empresa_id === empresaId && mov.lote_id).map((mov) => mov.lote_id);
    const idsMapa = movsMapa.filter((mov) => mov.empresa_id === empresaId && mov.lote_id).map((mov) => mov.lote_id);
    return [...new Set([...idsPecuaria, ...idsMapa])];
  },

  async syncReferences({ data, oldData }) {
    return base44.functions.invoke('syncEntityReferences', {
      event: { type: 'update', entity_name: 'Lote' },
      data,
      old_data: oldData,
    });
  },
};

export default loteRepository;