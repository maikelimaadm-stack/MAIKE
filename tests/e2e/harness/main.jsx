import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { MemoryRouter } from "react-router-dom";
import "../../../src/index.css";
import MapaDesenho from "@/components/mapa/MapaDesenho";
import MapaGeral from "@/pages/MapaGeral";
import { AREAS } from "./dados.js";
import { lerAreasSalvas } from "./stubs/mapaService.js";
import maplibregl from "maplibre-gl";

// Só no harness: registra instâncias MapLibre para provas visuais
// (queryRenderedFeatures / project). Código de produção não expõe nada.
window.__E2E_MAPS__ = [];
const addLayerOrig = maplibregl.Map.prototype.addLayer;
maplibregl.Map.prototype.addLayer = function (...a) {
  if (!window.__E2E_MAPS__.includes(this)) window.__E2E_MAPS__.push(this);
  return addLayerOrig.apply(this, a);
};

const cena = new URLSearchParams(location.search).get("cena") || "desenho";
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
window.__E2E__ = { salvos: 0, cancelados: 0 };

function App() {
  // Como `MapaCadastro`: salvar ou cancelar fecha o editor (volta à listagem).
  const [fechado, setFechado] = React.useState(null);
  if (cena === "geral") return <div style={{ height: "100vh" }}><MapaGeral /></div>;
  if (fechado) return <div data-testid="harness-listagem">listagem ({fechado})</div>;
  // GEO-08: "editar-salva" reabre a última área gravada no store local.
  const editar = cena === "editar" ? AREAS[1] : cena === "editar-salva" ? lerAreasSalvas().at(-1) || null : null;
  return (
    <MapaDesenho
      tipoDesenho="area"
      itemEditando={editar}
      onSalvar={() => { window.__E2E__.salvos += 1; setFechado("salvo"); }}
      onCancelar={() => { window.__E2E__.cancelados += 1; setFechado("cancelado"); }}
    />
  );
}
createRoot(document.getElementById("root")).render(<MemoryRouter><QueryClientProvider client={qc}><App /><Toaster /></QueryClientProvider></MemoryRouter>);
