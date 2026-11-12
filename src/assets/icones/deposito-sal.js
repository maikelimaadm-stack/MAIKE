import { COCHO_APARENCIA, envolverMarcadorSvg } from "./cocho-descoberto";

const CORPO = "M19 39C19 27 40 20 69 20S119 28 119 39V147C119 162 99 171 69 171S19 162 19 147Z";
const MODELO = "<g id=\"pes\" fill=\"#555754\"><path d=\"M23 153H36V172L23 176ZM58 158H71V178H58ZM95 155H108V173L95 177Z\"/></g>\n<path id=\"corpo\" d=\"M19 39C19 27 40 20 69 20S119 28 119 39V147C119 162 99 171 69 171S19 162 19 147Z\" fill=\"#fff\" stroke=\"#555754\" stroke-width=\"4\"/>\n<ellipse id=\"tampa\" cx=\"69\" cy=\"38\" rx=\"49\" ry=\"17\" fill=\"#555754\"/>\n<g id=\"cintas\" fill=\"none\" stroke=\"#555754\" stroke-width=\"3.5\" stroke-linecap=\"round\"><path d=\"M26 65C46 80 95 80 112 65M26 91C46 106 95 106 112 91M26 115C46 130 95 130 112 115M26 139C46 154 95 154 112 139\"/></g>\n<g id=\"bocais\" fill=\"#fff\" stroke=\"#737570\" stroke-width=\"1.5\" stroke-linejoin=\"round\"><path d=\"M42 17 57 23V35L43 40 30 34V23Z\"/><path d=\"M30 23 43 29 57 23M43 29V40\"/><path d=\"M80 20 94 16 105 23V35L92 41 80 34Z\"/><path d=\"M80 20 92 27 105 23M92 27V41\"/><path d=\"M39 17 48 14 55 18V23L47 26 39 22Z\"/><path d=\"M88 13 98 16V23L90 26 83 22V17Z\"/></g>\n<ellipse id=\"tampa-central\" cx=\"69\" cy=\"17\" rx=\"27\" ry=\"10\" fill=\"#555754\" stroke=\"#777975\" stroke-width=\"1\"/>";

/** Usa o SVG fornecido, com preenchimento interno proporcional ao estoque mínimo. */
export function criarSvgDeposito(percent = 0, marcador = false) {
  const fracao = Number.isFinite(percent) ? Math.max(0, Math.min(1, percent)) : 0;
  const estilo = marcador ? COCHO_APARENCIA.marcador : COCHO_APARENCIA.subicone;
  const y = 167 - 112 * fracao;
  const onda = Math.min(3, fracao * 10);
  const produto = fracao > 0 ? `<defs><clipPath id="interior-deposito"><path d="${CORPO}"/></clipPath></defs><path data-deposito-nivel="${Math.round(fracao * 100)}" d="M19 ${y} Q31 ${y - onda} 44 ${y} T69 ${y} T94 ${y} T119 ${y} V173 H19Z" fill="${estilo.sal}" clip-path="url(#interior-deposito)"/>` : "";
  const desenho = MODELO
    .replaceAll("#555754", estilo.cor).replaceAll("#737570", estilo.cor).replaceAll("#777975", estilo.cor)
    .replace('stroke-width="4"', `stroke-width="${marcador ? 5.5 : 4}"`)
    .replace(/(<path id="corpo"[^>]*\/>)/, `$1${produto}`);
  if (marcador) return envolverMarcadorSvg(desenho, "10 0 120 180", 17, 7, 30, 45);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 0 120 180" width="120" height="180">${desenho}</svg>`;
}

export function urlIconeDeposito(percent = 0, marcador = false) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(criarSvgDeposito(percent, marcador))}`;
}
