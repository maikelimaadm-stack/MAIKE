import { base44 } from "@/api/base44Client";

export function criarSnapshotLote(lote, overrides = {}) {
  return {
    id: lote?.id || overrides.id || null,
    nome: lote?.nome || "",
    categoria: lote?.categoria || "",
    quantidade_cabecas: Number(lote?.quantidade_cabecas || 0),
    peso_medio_kg: lote?.peso_medio_kg ?? null,
    idade_media_meses: lote?.idade_media_meses ?? null,
    area_atual_id: lote?.area_atual_id || null,
    area_atual_nome: lote?.area_atual_nome || "",
    raca_predominante: lote?.raca_predominante || null,
    sistema_produtivo: lote?.sistema_produtivo || null,
    sexo: lote?.sexo || null,
    data_entrada: lote?.data_entrada || null,
    status: lote?.status || "Ativo",
    ...overrides,
  };
}

export function getIdsAfetados(movimentacao) {
  return [
    ...(movimentacao?.lotes_antes || []).map((item) => item?.id),
    ...(movimentacao?.lotes_depois || []).map((item) => item?.id),
  ].filter(Boolean);
}

export function movimentacaoAfetaIds(movimentacao, ids = []) {
  const conjunto = new Set(ids);
  return getIdsAfetados(movimentacao).some((id) => conjunto.has(id));
}

export async function aplicarSnapshotsLote(snapshots = []) {
  for (const snapshot of snapshots) {
    if (!snapshot?.id) continue;
    await base44.entities.Lote.update(snapshot.id, {
      nome: snapshot.nome,
      categoria: snapshot.categoria,
      quantidade_cabecas: snapshot.quantidade_cabecas,
      peso_medio_kg: snapshot.peso_medio_kg,
      idade_media_meses: snapshot.idade_media_meses,
      area_atual_id: snapshot.area_atual_id,
      area_atual_nome: snapshot.area_atual_nome,
      raca_predominante: snapshot.raca_predominante,
      sistema_produtivo: snapshot.sistema_produtivo,
      sexo: snapshot.sexo,
      data_entrada: snapshot.data_entrada,
      status: snapshot.status,
    });
  }
}

export function calcularPesoMedioPonderado(destino, quantidadeEntrada, pesoEntrada) {
  const quantidadeDestino = Number(destino?.quantidade_cabecas || 0);
  const pesoDestino = Number(destino?.peso_medio_kg || 0);
  const qtdEntrada = Number(quantidadeEntrada || 0);
  const pesoNovo = Number(pesoEntrada || pesoDestino || 0);
  const totalCabecas = quantidadeDestino + qtdEntrada;
  if (totalCabecas <= 0) return pesoNovo || 0;
  return Number((((quantidadeDestino * pesoDestino) + (qtdEntrada * pesoNovo)) / totalCabecas).toFixed(2));
}