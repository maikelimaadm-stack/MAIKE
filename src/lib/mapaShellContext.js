import { createContext, useContext } from "react";

/**
 * Ponte entre o shell (Layout) e o Mapa Geral (D-PROD-131): o mapa é a tela
 * principal, sem cabeçalho do sistema por cima. O botão ☰ do mapa abre o menu
 * lateral e o nome da fazenda troca a empresa — ambos vivem no Layout.
 *
 * Fora do Layout (testes, harness) o valor é `null` e o mapa só não mostra o ☰.
 *
 * @typedef {{ abrirMenu: () => void, trocarEmpresa: (() => void) | null, empresaNome: string }} MapaShell
 */
export const MapaShellContext = createContext(/** @type {MapaShell | null} */ (null));

export const useMapaShell = () => useContext(MapaShellContext);
