import { Outlet } from "react-router-dom";

/**
 * Conteúdo de rota no AppShell. Mapa Geral monta/desmonta com a rota — sem mapa
 * persistente oculto (#94). Não cancela queries globalmente na troca de URL: isso
 * atingia fetches compartilhados sem delimitar a rota anterior.
 */
export default function AppRouteContent() {
  return <Outlet />;
}
