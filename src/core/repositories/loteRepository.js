import { base44 } from "@/api/base44Client";
import { ensureDeleteAllowed as ensureEntityDeleteAllowed } from "@/lib/entityDeleteGuards";

const ORIGENS_SISTEMA = [
  "MOVIMENTAÇÃO",
  "REVERSÃO MOVIMENTAÇÃO",
  "Nascimento",
  "Mudança de Categoria",
  "NASCIMENTO",
  "MUDANÇA DE CATEGORIA"
];

const filterByEmpresa = (items, empresaId) => {
  if (!empresaId) return items;
  return items.filter((item) => item.empresa_id === empresaId);
};

const getNextNumeroLote = (lotes) => {
  const maxNum = lotes.reduce((max, lote) => Math.max(max, parseInt(lote.numero_lote) || 0), 0);
  return String(maxNum + 1);
};

export const loteRepository = {
  async list({ empresaId, incluirSistema = true } = {}) {
    const all = await base44.entities.Lote.list();
    return filterByEmpresa(all, empresaId).filter((lote) => incluirSistema || !ORIGENS_SISTEMA.includes(lote.origem));
  },

  async getById(id) {
    const all = await base44.entities.Lote.list();
    return all.find((lote) => lote.id === id) || null;
  },

  async create(data, { empresaId } = {}) {
    const allLotes = await base44.entities.Lote.list();
    return base44.entities.Lote.create({
      ...data,
      empresa_id: empresaId || data.empresa_id,
      numero_lote: data.numero_lote || getNextNumeroLote(allLotes),
      status: data.status || "Ativo",
      campos_personalizados: data.campos_personalizados || {}
    });
  },

  async update(id, data, { oldData } = {}) {
    const updated = await base44.entities.Lote.update(id, {
      ...data,
      campos_personalizados: data.campos_personalizados || {}
    });

    await base44.functions.invoke("syncEntityReferences", {
      event: { type: "update", entity_name: "Lote" },
      data: updated,
      old_data: oldData
    });

    return updated;
  },

  async delete(id) {
    return base44.entities.Lote.delete(id);
  },

  async ensureDeleteAllowed(id) {
    return ensureEntityDeleteAllowed(base44, "Lote", id);
  },

  async listAreasAtivas(empresaId) {
    const all = await base44.entities.AreaPastagem.list();
    return filterByEmpresa(all, empresaId).filter((area) => area.ativo !== false);
  },

  async listLotesComMovimentacoes(empresaId) {
    const [movsPecuaria, movsMapa] = await Promise.all([
      base44.entities.MovimentacaoPecuaria.list(),
      base44.entities.MovimentacaoMapa.list()
    ]);

    const idsPecuaria = filterByEmpresa(movsPecuaria, empresaId).filter((mov) => mov.lote_id).map((mov) => mov.lote_id);
    const idsMapa = filterByEmpresa(movsMapa, empresaId).filter((mov) => mov.lote_id).map((mov) => mov.lote_id);

    return [...new Set([...idsPecuaria, ...idsMapa])];
  },

  async listCategoriasManejo(empresaId) {
    const all = await base44.entities.CategoriaManejo.list();
    return filterByEmpresa(all, empresaId).filter((categoria) => categoria.ativo !== false);
  },

  async listFornecedores(empresaId) {
    const all = await base44.entities.Fornecedor.list();
    return filterByEmpresa(all, empresaId);
  }
};

export default loteRepository;