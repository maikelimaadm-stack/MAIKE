import { useCallback, useEffect, useRef, useState } from "react";
import { BASEMAP_IDS } from "@/lib/maplibre/basemap.js";
import { createBasemapController } from "@/lib/maplibre/basemapController.js";

/** @typedef {import('@/lib/maplibre/basemapController.js').EstadoBasemap} EstadoBasemap */

/** @type {EstadoBasemap} */
const ESTADO_INICIAL = {
  basemapId: BASEMAP_IDS.RUAS,
  status: "pronto",
  provedor: "openfreemap",
  mensagem: null,
  atribuicao: null,
};

/**
 * Liga o controle Mapa/Satélite à instância MapLibre da superfície (D-PROD-65).
 * Um controlador por instância; troca de base não remonta o mapa.
 *
 * @param {import('maplibre-gl').Map | null} map instância pronta (após `load`) ou null
 * @param {{ inicial?: string, reaplicarCamadas?: () => void, prefixosNegocio?: readonly string[] }} [opts]
 */
export default function useBasemap(map, opts = {}) {
  const [estado, setEstado] = useState(ESTADO_INICIAL);
  const ctrlRef = useRef(/** @type {ReturnType<typeof createBasemapController> | null} */ (null));
  const reaplicarRef = useRef(opts.reaplicarCamadas);
  reaplicarRef.current = opts.reaplicarCamadas;
  const inicialRef = useRef(opts.inicial || BASEMAP_IDS.RUAS);
  const prefixosRef = useRef(opts.prefixosNegocio);

  useEffect(() => {
    if (!map) {
      setEstado(ESTADO_INICIAL);
      return undefined;
    }
    const ctrl = createBasemapController(map, {
      onState: setEstado,
      reaplicarCamadas: () => reaplicarRef.current?.(),
      prefixosNegocio: prefixosRef.current,
    });
    ctrlRef.current = ctrl;
    if (inicialRef.current === BASEMAP_IDS.SATELITE) ctrl.setBasemap(BASEMAP_IDS.SATELITE);
    return () => {
      ctrl.dispose();
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
    };
  }, [map]);

  const setBasemap = useCallback((id) => {
    inicialRef.current = id;
    ctrlRef.current?.setBasemap(id);
  }, []);
  const retry = useCallback(() => ctrlRef.current?.retry(), []);

  return { ...estado, setBasemap, retry };
}
