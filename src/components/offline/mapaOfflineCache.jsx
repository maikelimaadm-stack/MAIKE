import { base44 } from '@/api/base44Client';
import { getEntityCacheItems, setEntityCacheItems } from '@/components/offline/IndexedDBManager';

const MAPA_ENTITIES = {
  areas: 'AreaPastagem',
  pontos: 'PontoReferencia',
  pontosSuplementacao: 'PontoSuplementacao',
  linhas: 'LinhaGeografica',
  lotes: 'Lote',
  icones: 'ConfiguracaoIcone',
  eventosSuplementacao: 'SuplementacaoEvento',
  estoqueLotes: 'EstoqueLoteNota',
  tarefas: 'LancamentoTarefa',
  movimentacoes: 'MovimentacaoMapa',
  permissoes: 'Permissao',
  historicoTarefa: 'HistoricoLancamentoTarefa',
  suplementacaoLote: 'SuplementacaoLote',
  aplicacaoMedicamento: 'AplicacaoMedicamento',
  eventoSanitario: 'EventoSanitario',
  manejoTecnico: 'ManejoTecnicoRebanho',
  movimentacaoEstoque: 'MovimentacaoEstoque',
};

const CACHE_KEYS = Object.keys(MAPA_ENTITIES);

const getEmpresaFilter = (items, empresaId) => items.filter((item) => item.empresa_id === empresaId);

const mapFetchers = {
  areas: async (empresaId) => getEmpresaFilter(await base44.entities.AreaPastagem.list(), empresaId).filter((a) => a.ativo !== false),
  pontos: async (empresaId) => getEmpresaFilter(await base44.entities.PontoReferencia.list(), empresaId).filter((p) => p.ativo !== false),
  pontosSuplementacao: async (empresaId) => getEmpresaFilter(await base44.entities.PontoSuplementacao.list(), empresaId).filter((p) => p.status === 'Ativo'),
  linhas: async (empresaId) => getEmpresaFilter(await base44.entities.LinhaGeografica.list(), empresaId).filter((l) => l.ativo !== false),
  lotes: async (empresaId) => getEmpresaFilter(await base44.entities.Lote.list(), empresaId).filter((l) => l.status === 'Ativo'),
  icones: async () => (await base44.entities.ConfiguracaoIcone.list()).filter((i) => i.ativo !== false),
  eventosSuplementacao: async (empresaId) => getEmpresaFilter(await base44.entities.SuplementacaoEvento.list(), empresaId),
  estoqueLotes: async (empresaId) => getEmpresaFilter(await base44.entities.EstoqueLoteNota.list(), empresaId).filter((item) => item.status === 'Disponivel'),
  tarefas: async (empresaId) => getEmpresaFilter(await base44.entities.LancamentoTarefa.list(), empresaId).filter((t) => t.coordenadas && (t.status === 'Pendente' || t.status === 'Em Andamento')),
  movimentacoes: async (empresaId) => getEmpresaFilter(await base44.entities.MovimentacaoMapa.list('-data_movimentacao', 500), empresaId),
  permissoes: async () => base44.entities.Permissao.list(),
  historicoTarefa: async (empresaId) => getEmpresaFilter(await base44.entities.HistoricoLancamentoTarefa.list('-created_date', 500), empresaId),
  suplementacaoLote: async (empresaId) => getEmpresaFilter(await base44.entities.SuplementacaoLote.list('-data_lancamento', 500), empresaId),
  aplicacaoMedicamento: async (empresaId) => getEmpresaFilter(await base44.entities.AplicacaoMedicamento.list('-data_aplicacao', 500), empresaId),
  eventoSanitario: async (empresaId) => getEmpresaFilter(await base44.entities.EventoSanitario.list('-data_evento', 500), empresaId),
  manejoTecnico: async (empresaId) => getEmpresaFilter(await base44.entities.ManejoTecnicoRebanho.list('-data_evento', 500), empresaId),
  movimentacaoEstoque: async (empresaId) => getEmpresaFilter(await base44.entities.MovimentacaoEstoque.list('-data_movimentacao', 500), empresaId),
};

export async function getMapaCachedData(cacheKey, empresaId) {
  return getEntityCacheItems(`mapa_${cacheKey}`, empresaId || '__GLOBAL__');
}

export async function refreshMapaCacheEntry(cacheKey, empresaId) {
  const fetcher = mapFetchers[cacheKey];
  if (!fetcher) return [];
  const items = await fetcher(empresaId);
  await setEntityCacheItems(`mapa_${cacheKey}`, empresaId || '__GLOBAL__', items);
  return items;
}

export async function warmMapaCache(empresaId) {
  await Promise.all(CACHE_KEYS.map((cacheKey) => refreshMapaCacheEntry(cacheKey, cacheKey === 'icones' || cacheKey === 'permissoes' ? '__GLOBAL__' : empresaId)));
}