#!/usr/bin/env node
/**
 * Remendo no plugin `@capacitor/google-maps` (D-PROD-373), aplicado no `postinstall`.
 *
 * O plugin só avisa a câmera quando o mapa começa a mexer (`onCameraMoveStarted`) e quando para (`onCameraIdle`). Os
 * marcadores do Mapa Geral no app ficam num `div` por cima do mapa nativo (D-PROD-372) e precisam da câmera a cada
 * quadro para andar junto com o mapa. O remendo faz o mapa nativo avisar `onCameraMove` (latitude, longitude, zoom,
 * rumo, inclinação):
 *   - Android: no `onCameraMove` que o plugin já ouve (ele só o usava para agrupar marcadores);
 *   - iOS: no `mapView(_:didChange:)` do `GMSMapViewDelegate`.
 *
 * Idempotente: o que já foi remendado fica como está. Se o plugin mudar e o ponto de remendo sumir, avisa e não mexe
 * (o teste `mapaGoogleCameraD373` reprova; o app segue funcionando, com os marcadores escondidos durante o movimento).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLUGIN = join(RAIZ, "node_modules", "@capacitor", "google-maps");
export const MARCA = "MAIKE D-PROD-373: onCameraMove";

export const REMENDOS = [
  {
    arquivo: "android/src/main/java/com/capacitorjs/plugins/googlemaps/CapacitorGoogleMap.kt",
    ancora: "    override fun onCameraMove() {\n",
    inserir: `    override fun onCameraMove() {
        // ${MARCA} (a câmera a cada quadro, para os marcadores do Mapa Geral andarem junto com o mapa)
        val posicao = this@CapacitorGoogleMap.googleMap?.cameraPosition
        if (posicao != null) {
            val dados = JSObject()
            dados.put("mapId", this@CapacitorGoogleMap.id)
            dados.put("bearing", posicao.bearing)
            dados.put("latitude", posicao.target.latitude)
            dados.put("longitude", posicao.target.longitude)
            dados.put("tilt", posicao.tilt)
            dados.put("zoom", posicao.zoom)
            delegate.notify("onCameraMove", dados)
        }
`,
  },
  {
    arquivo: "ios/Sources/CapacitorGoogleMapsPlugin/CapacitorGoogleMapsPlugin.swift",
    ancora: "    // onMapClick\n",
    inserir: `    // ${MARCA} (a câmera a cada quadro, para os marcadores do Mapa Geral andarem junto com o mapa)
    public func mapView(_ mapView: GMSMapView, didChange position: GMSCameraPosition) {
        self.notifyListeners("onCameraMove", data: [
            "mapId": self.findMapIdByMapView(mapView),
            "bearing": position.bearing,
            "latitude": position.target.latitude,
            "longitude": position.target.longitude,
            "tilt": position.viewingAngle,
            "zoom": position.zoom
        ])
    }

    // onMapClick
`,
  },
];

/**
 * Aplica os remendos no plugin instalado em `pasta`. Devolve o que aconteceu com cada arquivo.
 * @param {string} [pasta]
 * @returns {Array<{ arquivo: string, estado: "remendado" | "ja-remendado" | "sem-ancora" | "sem-arquivo" }>}
 */
export function remendar(pasta = PLUGIN) {
  return REMENDOS.map(({ arquivo, ancora, inserir }) => {
    const caminho = join(pasta, arquivo);
    if (!existsSync(caminho)) return { arquivo, estado: "sem-arquivo" };
    const texto = readFileSync(caminho, "utf8");
    if (texto.includes(MARCA)) return { arquivo, estado: "ja-remendado" };
    if (!texto.includes(ancora)) return { arquivo, estado: "sem-ancora" };
    writeFileSync(caminho, texto.replace(ancora, inserir));
    return { arquivo, estado: "remendado" };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(PLUGIN)) process.exit(0); // instalação sem o plugin: nada a fazer
  for (const r of remendar()) {
    if (r.estado === "sem-ancora") console.warn(`[remendar-google-maps] o ponto de remendo sumiu em ${r.arquivo}: o plugin mudou de versão?`);
    else if (r.estado === "remendado") console.log(`[remendar-google-maps] ${r.arquivo}: onCameraMove ligado`);
  }
}
