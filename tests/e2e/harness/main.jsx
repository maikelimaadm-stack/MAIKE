import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { MemoryRouter } from "react-router-dom";
import "../../../src/index.css";
import MapaDesenho from "@/components/mapa/MapaDesenho";
import MapaGeral from "@/pages/MapaGeral";
import { AREAS } from "./dados.js";

const cena = new URLSearchParams(location.search).get("cena") || "desenho";
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
window.__E2E__ = { salvos: 0, cancelados: 0 };

function App() {
  if (cena === "geral") return <div style={{ height: "100vh" }}><MapaGeral /></div>;
  const editar = cena === "editar" ? AREAS[1] : null;
  return (
    <MapaDesenho
      tipoDesenho="area"
      itemEditando={editar}
      onSalvar={() => { window.__E2E__.salvos += 1; }}
      onCancelar={() => { window.__E2E__.cancelados += 1; }}
    />
  );
}
createRoot(document.getElementById("root")).render(<MemoryRouter><QueryClientProvider client={qc}><App /><Toaster /></QueryClientProvider></MemoryRouter>);
