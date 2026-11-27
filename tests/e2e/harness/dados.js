/** Dados sintéticos (sem banco, sem rede) — tenant fictício emp-e2e. */
const base = { lat: -15.0067, lng: -59.9533 };
const ret = (dLat, dLng, w, h) => [
  [base.lat + dLat, base.lng + dLng],
  [base.lat + dLat, base.lng + dLng + w],
  [base.lat + dLat - h, base.lng + dLng + w],
  [base.lat + dLat - h, base.lng + dLng],
];
export const EMPRESA = "emp-e2e";
/**
 * Fazenda grande para medir desempenho (`?grande=200`): N pastos em grade, um lote em cada, um cocho a cada 4,
 * um ponto de referência (bebedouro) a cada 4 e uma tarefa a cada 5 (D-PROD-353; uma em cada 4 tarefas é Urgente).
 */
const N_GRANDE = (() => {
  try {
    return Math.min(1000, Math.max(0, Number(new URLSearchParams(globalThis.location?.search || "").get("grande")) || 0));
  } catch {
    return 0;
  }
})();
const CORES_GRANDE = ["#0d67ad", "#92ca25", "#efcb19", "#966fe1", "#e4572e", "#17bebb"];
const CATEGORIAS_GRANDE = ["BOI", "VACA", "NOVILHA", "BEZERRO", "GARROTE"];
const LADO_GRANDE = Math.ceil(Math.sqrt(N_GRANDE || 1));
const areasGrandes = Array.from({ length: N_GRANDE }, (_, i) => {
  const lin = Math.floor(i / LADO_GRANDE), col = i % LADO_GRANDE;
  return { id: `g${i}`, empresa_id: "emp-e2e", nome: `PASTO ${String(i + 1).padStart(3, "0")}`, numero_area: i + 1, tamanho_hectares: 20 + (i % 17), ativo: true, coordenadas: { coords: ret(-lin * 0.0042, col * 0.0052, 0.005, 0.004), cor: CORES_GRANDE[i % CORES_GRANDE.length] } };
});
const lotesGrandes = areasGrandes.map((a, i) => ({ id: `gl${i}`, empresa_id: "emp-e2e", nome: `Lote ${i + 1}`, area_atual_id: a.id, quantidade_cabecas: 10 + ((i * 37) % 990), categoria: CATEGORIAS_GRANDE[i % CATEGORIAS_GRANDE.length], status: "Ativo", alertas: [] }));
const pontosGrandes = areasGrandes.filter((_, i) => i % 4 === 0).map((a, i) => ({ id: `gc${i}`, empresa_id: "emp-e2e", nome_ponto: `Cocho ${i + 1}`, categoria_ponto: "COCHO", status: "Ativo", coordenadas: { lat: a.coordenadas.coords[0][0] - 0.001, lng: a.coordenadas.coords[0][1] + 0.001 } }));
const pontosRefGrandes = areasGrandes.filter((_, i) => i % 4 === 2).map((a, i) => ({ id: `gp${i}`, empresa_id: "emp-e2e", nome: i % 2 ? `Porteira ${i + 1}` : `Bebedouro ${i + 1}`, tipo: i % 2 ? "PORTEIRA" : "BEBEDOURO", status: "Ativo", cor: "#0284c7", coordenadas: { lat: a.coordenadas.coords[0][0] - 0.003, lng: a.coordenadas.coords[0][1] + 0.004 } }));
const PRIORIDADES_GRANDE = ["Urgente", "Alta", "Média", "Baixa"];
const HOJE_E2E = new Date().toISOString().slice(0, 10);
/** Prazo da tarefa: de 2 dias atrasada a 4 dias à frente (o indicador mostra "2d", "0d"…). @param {number} i */
const prazoE2E = (i) => new Date(Date.parse(HOJE_E2E) + ((i % 7) - 2) * 86400000).toISOString().slice(0, 10);
const tarefasGrandes = areasGrandes.filter((_, i) => i % 5 === 1).map((a, i) => ({ id: `gt${i}`, empresa_id: "emp-e2e", titulo: `Tarefa ${i + 1}`, prioridade: PRIORIDADES_GRANDE[i % 4], status: i % 3 === 1 ? "Em Andamento" : "Pendente", data_prevista: prazoE2E(i), area_id: a.id, coordenadas: { lat: a.coordenadas.coords[0][0] - 0.0012, lng: a.coordenadas.coords[0][1] + 0.0042 } }));

export const AREAS = N_GRANDE ? areasGrandes : [
  { id: "a1", empresa_id: EMPRESA, nome: "PASTO 01", numero_area: 1, tamanho_hectares: 18.4, ativo: true, coordenadas: { coords: ret(0.002, -0.004, 0.004, 0.003), cor: "#0d67ad" } },
  { id: "a2", empresa_id: EMPRESA, nome: "PASTO 02", numero_area: 2, tamanho_hectares: 9.1, ativo: true, coordenadas: { coords: ret(0.002, 0.0003, 0.003, 0.003), cor: "#92ca25" } },
  { id: "a3", empresa_id: EMPRESA, nome: "CURRAL", numero_area: 3, tamanho_hectares: 1.2, ativo: true, tipo_cultura: "Infraestrutura", tipo_infraestrutura: "Curral", coordenadas: { coords: ret(-0.0015, -0.002, 0.002, 0.0012), cor: "#efcb19" } },
];
export const LOTES = N_GRANDE ? lotesGrandes : [
  { id: "l1", empresa_id: EMPRESA, nome: "Lote A", area_atual_id: "a1", quantidade_cabecas: 42, categoria: "BOI", status: "Ativo", alertas: [], identificador_cor: "#dc2626", identificador_sigla: "LA" },
  { id: "l2", empresa_id: EMPRESA, nome: "Lote B", area_atual_id: "a2", quantidade_cabecas: 17, categoria: "VACA", status: "Ativo", alertas: [] },
];
export const PONTOS_SUPL = N_GRANDE ? pontosGrandes : [
  { id: "c1", empresa_id: EMPRESA, nome_ponto: "Cocho 1", categoria_ponto: "COCHO", status: "Ativo", coordenadas: { lat: base.lat - 0.0012, lng: base.lng - 0.0035 } },
  { id: "d1", empresa_id: EMPRESA, nome_ponto: "Depósito", categoria_ponto: "DEPOSITO", status: "Ativo", coordenadas: { lat: base.lat - 0.0021, lng: base.lng + 0.0015 } },
];
/** Ícone do bebedouro (o da porteira fica sem: círculo da cor), como um ícone enviado pela empresa. */
const SVG_BEBEDOURO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40"><rect x="2" y="2" width="36" height="36" rx="8" fill="#fff" stroke="#0284c7" stroke-width="3"/><path d="M20 8C20 8 11 19 11 25a9 9 0 0 0 18 0C29 19 20 8 20 8z" fill="#0ea5e9"/></svg>';
export const ICONES = N_GRANDE ? [{ id: "ic-beb", empresa_id: "emp-e2e", tipo_entidade: "Ponto", categoria: "BEBEDOURO", cor_padrao: "#0284c7", icone_url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG_BEBEDOURO)}` }] : [];
/** Pontos de referência e tarefas só na fazenda grande (o cenário pequeno continua como estava). */
export const PONTOS_REF = N_GRANDE ? pontosRefGrandes : [];
export const TAREFAS = N_GRANDE ? tarefasGrandes : [];
/** Leitura de hoje em 2 de cada 3 cochos da fazenda grande: o farol sai colorido (vazio, adequado; o 3º fica cinza). */
const ESCORES = ["VAZIO", "ADEQUADO"];
export const LEITURAS_COCHO = N_GRANDE ? pontosGrandes.filter((_, i) => i % 3 !== 2).map((c, i) => ({ id: `gr${i}`, empresa_id: "emp-e2e", ponto_suplementacao_id: c.id, data_leitura: HOJE_E2E, escore: ESCORES[i % 2] })) : [];
export const LINHAS = [
  { id: "ln1", empresa_id: EMPRESA, nome: "Cerca", tipo: "Cerca", coordenadas: { coords: [[base.lat + 0.0025, base.lng - 0.004], [base.lat + 0.0025, base.lng + 0.0033]], cor: "#f59e0b" } },
];
export const USUARIO = { id: "u1", login: "e2e@maike.local", email: "e2e@maike.local", administrador_fazenda: true, full_name: "E2E" };

/** Empresa B (GEO-09): áreas em outro lugar e cores diferentes — nunca podem aparecer em A. */
export const EMPRESA_B = "emp-b";
const baseB = { lat: -15.02, lng: -59.97 };
export const AREAS_B = [
  { id: "b1", empresa_id: EMPRESA_B, nome: "RETIRO B1", numero_area: 1, tamanho_hectares: 7.7, ativo: true, coordenadas: { coords: [[baseB.lat, baseB.lng], [baseB.lat, baseB.lng + 0.003], [baseB.lat - 0.002, baseB.lng + 0.003], [baseB.lat - 0.002, baseB.lng]], cor: "#966fe1" } },
];
export const LOTES_B = [{ id: "lb1", empresa_id: EMPRESA_B, nome: "Lote B", area_atual_id: "b1", quantidade_cabecas: 9, categoria: "BOI", status: "Ativo", alertas: [] }];
