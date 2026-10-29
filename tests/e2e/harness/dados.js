/** Dados sintéticos (sem banco, sem rede) — tenant fictício emp-e2e. */
const base = { lat: -15.0067, lng: -59.9533 };
const ret = (dLat, dLng, w, h) => [
  [base.lat + dLat, base.lng + dLng],
  [base.lat + dLat, base.lng + dLng + w],
  [base.lat + dLat - h, base.lng + dLng + w],
  [base.lat + dLat - h, base.lng + dLng],
];
export const EMPRESA = "emp-e2e";
export const AREAS = [
  { id: "a1", empresa_id: EMPRESA, nome: "PASTO 01", numero_area: 1, tamanho_hectares: 18.4, ativo: true, coordenadas: { coords: ret(0.002, -0.004, 0.004, 0.003), cor: "#0d67ad" } },
  { id: "a2", empresa_id: EMPRESA, nome: "PASTO 02", numero_area: 2, tamanho_hectares: 9.1, ativo: true, coordenadas: { coords: ret(0.002, 0.0003, 0.003, 0.003), cor: "#92ca25" } },
  { id: "a3", empresa_id: EMPRESA, nome: "CURRAL", numero_area: 3, tamanho_hectares: 1.2, ativo: true, tipo_cultura: "Infraestrutura", tipo_infraestrutura: "Curral", coordenadas: { coords: ret(-0.0015, -0.002, 0.002, 0.0012), cor: "#efcb19" } },
];
export const LOTES = [
  { id: "l1", empresa_id: EMPRESA, nome: "Lote A", area_atual_id: "a1", quantidade_cabecas: 42, categoria: "BOI", status: "Ativo", alertas: [], identificador_cor: "#dc2626", identificador_sigla: "LA" },
  { id: "l2", empresa_id: EMPRESA, nome: "Lote B", area_atual_id: "a2", quantidade_cabecas: 17, categoria: "VACA", status: "Ativo", alertas: [] },
];
export const PONTOS_SUPL = [
  { id: "c1", empresa_id: EMPRESA, nome_ponto: "Cocho 1", categoria_ponto: "COCHO", status: "Ativo", coordenadas: { lat: base.lat - 0.0012, lng: base.lng - 0.0035 } },
  { id: "d1", empresa_id: EMPRESA, nome_ponto: "Depósito", categoria_ponto: "DEPOSITO", status: "Ativo", coordenadas: { lat: base.lat - 0.0021, lng: base.lng + 0.0015 } },
];
export const LINHAS = [
  { id: "ln1", empresa_id: EMPRESA, nome: "Cerca", tipo: "Cerca", coordenadas: { coords: [[base.lat + 0.0025, base.lng - 0.004], [base.lat + 0.0025, base.lng + 0.0033]], cor: "#f59e0b" } },
];
export const USUARIO = { id: "u1", email: "e2e@maike.local", role: "admin", full_name: "E2E" };

/** Empresa B (GEO-09): áreas em outro lugar e cores diferentes — nunca podem aparecer em A. */
export const EMPRESA_B = "emp-b";
const baseB = { lat: -15.02, lng: -59.97 };
export const AREAS_B = [
  { id: "b1", empresa_id: EMPRESA_B, nome: "RETIRO B1", numero_area: 1, tamanho_hectares: 7.7, ativo: true, coordenadas: { coords: [[baseB.lat, baseB.lng], [baseB.lat, baseB.lng + 0.003], [baseB.lat - 0.002, baseB.lng + 0.003], [baseB.lat - 0.002, baseB.lng]], cor: "#966fe1" } },
];
export const LOTES_B = [{ id: "lb1", empresa_id: EMPRESA_B, nome: "Lote B", area_atual_id: "b1", quantidade_cabecas: 9, categoria: "BOI", status: "Ativo", alertas: [] }];
