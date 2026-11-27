#!/usr/bin/env node
/**
 * Remendos no plugin `@capacitor/google-maps` (D-PROD-373, D-PROD-374), aplicados no `postinstall`.
 *
 * D-PROD-374: o marcador nativo aceita a imagem `data:` (base64), para os ícones do Mapa Geral serem marcadores do
 * próprio mapa (andam colados nele). Antes o SDK só aceitava arquivo do app ou `https`.
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
export const MARCA_DATA = "MAIKE D-PROD-374: imagem data:";
export const MARCA_TOQUE = "MAIKE D-PROD-374: toque no marcador";

export const REMENDOS = [
  {
    marca: MARCA,
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
    marca: MARCA,
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
  // D-PROD-374: o marcador nativo aceita a imagem desenhada na hora (URL `data:` em base64). Os ícones do Mapa Geral
  // (lote com a contagem, cocho com o nível e o farol) viram marcadores do próprio mapa: andam colados nele.
  {
    marca: MARCA_DATA,
    arquivo: "android/src/main/java/com/capacitorjs/plugins/googlemaps/CapacitorGoogleMap.kt",
    ancora: `                    var stream: InputStream? = null
                    if (marker.iconUrl!!.startsWith("https:")) {`,
    inserir: `                    var stream: InputStream? = null
                    if (marker.iconUrl!!.startsWith("data:")) {
                        // ${MARCA_DATA} (os ícones do Mapa Geral, desenhados na hora)
                        val bytes = android.util.Base64.decode(marker.iconUrl!!.substringAfter(","), android.util.Base64.DEFAULT)
                        stream = java.io.ByteArrayInputStream(bytes)
                    } else if (marker.iconUrl!!.startsWith("https:")) {`,
  },
  {
    marca: MARCA_DATA,
    arquivo: "ios/Sources/CapacitorGoogleMapsPlugin/Map.swift",
    ancora: `                if iconUrl.starts(with: "https:") {`,
    inserir: `                if iconUrl.starts(with: "data:") {
                    // ${MARCA_DATA} (os ícones do Mapa Geral, desenhados na hora)
                    let base64 = String(iconUrl.split(separator: ",", maxSplits: 1).last ?? "")
                    if let dados = Data(base64Encoded: base64), let iconImage = UIImage(data: dados, scale: UIScreen.main.scale) {
                        self.markerIcons[iconUrl] = iconImage
                        newMarker.icon = getResizedIcon(iconImage, marker)
                    }
                } else if iconUrl.starts(with: "https:") {`,
  },
  // D-PROD-374: o toque no marcador é do Mapa Geral (abre o detalhe); o mapa não centraliza nem abre balão
  {
    marca: MARCA_TOQUE,
    arquivo: "android/src/main/java/com/capacitorjs/plugins/googlemaps/CapacitorGoogleMap.kt",
    ancora: `        delegate.notify("onMarkerClick", data)
        return false`,
    inserir: `        delegate.notify("onMarkerClick", data)
        // ${MARCA_TOQUE} (o Mapa Geral abre o detalhe; o mapa não centraliza nem abre balão)
        return true`,
  },
  {
    marca: MARCA_TOQUE,
    arquivo: "ios/Sources/CapacitorGoogleMapsPlugin/CapacitorGoogleMapsPlugin.swift",
    ancora: `                "snippet": marker.snippet ?? ""
            ])
        }
        return false
    }`,
    inserir: `                "snippet": marker.snippet ?? ""
            ])
        }
        // ${MARCA_TOQUE} (o Mapa Geral abre o detalhe; o mapa não centraliza nem abre balão)
        return true
    }`,
  },
];

/**
 * Aplica os remendos no plugin instalado em `pasta`. Devolve o que aconteceu com cada arquivo.
 * @param {string} [pasta]
 * @returns {Array<{ arquivo: string, estado: "remendado" | "ja-remendado" | "sem-ancora" | "sem-arquivo" }>}
 */
export function remendar(pasta = PLUGIN) {
  return REMENDOS.map(({ marca, arquivo, ancora, inserir }) => {
    const caminho = join(pasta, arquivo);
    if (!existsSync(caminho)) return { arquivo, estado: "sem-arquivo" };
    const texto = readFileSync(caminho, "utf8");
    if (texto.includes(marca)) return { arquivo, estado: "ja-remendado" };
    if (!texto.includes(ancora)) return { arquivo, estado: "sem-ancora" };
    writeFileSync(caminho, texto.replace(ancora, inserir));
    return { arquivo, estado: "remendado" };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(PLUGIN)) process.exit(0); // instalação sem o plugin: nada a fazer
  for (const r of remendar()) {
    if (r.estado === "sem-ancora") console.warn(`[remendar-google-maps] o ponto de remendo sumiu em ${r.arquivo}: o plugin mudou de versão?`);
    else if (r.estado === "remendado") console.log(`[remendar-google-maps] ${r.arquivo}: remendado`);
  }
}
