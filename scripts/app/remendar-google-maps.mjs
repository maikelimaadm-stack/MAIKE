#!/usr/bin/env node
/**
 * Remendos no plugin `@capacitor/google-maps` (D-PROD-373, D-PROD-374, D-PROD-376), aplicados no `postinstall`.
 *
 * D-PROD-376: o mapa avisa cada passo da câmera à camada nativa do Mapa Geral (`MaikeCamera`, um arquivo novo no plugin).
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
export const MARCA_CAMADA = "MAIKE D-PROD-376: camada do Mapa Geral";
export const MARCA_JUNTOS = "MAIKE D-PROD-382: marcadores juntos";
export const MARCA_MOSTRAR = "MAIKE D-PROD-382: mostrar e esconder";

/**
 * D-PROD-376: o gancho da câmera para a camada nativa do Mapa Geral (`CamadaDoMapaView.java`, no app). O plugin chama
 * `MaikeCamera.mexeu()` a cada passo da câmera; o app põe em `aoMexer` o "desenhe de novo" da camada. Em Java para o
 * app (Java) e o plugin (Kotlin) enxergarem a mesma classe.
 */
export const ARQUIVO_GANCHO = "android/src/main/java/com/capacitorjs/plugins/googlemaps/MaikeCamera.java";
export const GANCHO = `package com.capacitorjs.plugins.googlemaps;

/** ${MARCA_CAMADA}: o mapa avisa cada passo da câmera (a camada desenha junto). */
public final class MaikeCamera {
    /** O que o app quer a cada passo da câmera (na thread da tela), ou null. */
    public static volatile Runnable aoMexer;

    private MaikeCamera() {}

    public static void mexeu() {
        Runnable r = aoMexer;
        if (r != null) r.run();
    }
}
`;

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
  // D-PROD-376: a cada passo da câmera, a camada nativa do Mapa Geral desenha de novo (logo depois do remendo D-PROD-373)
  {
    marca: MARCA_CAMADA,
    arquivo: "android/src/main/java/com/capacitorjs/plugins/googlemaps/CapacitorGoogleMap.kt",
    ancora: `        // ${MARCA} (a câmera a cada quadro, para os marcadores do Mapa Geral andarem junto com o mapa)\n`,
    inserir: `        // ${MARCA} (a câmera a cada quadro, para os marcadores do Mapa Geral andarem junto com o mapa)
        // ${MARCA_CAMADA} (desenha junto com a câmera)
        MaikeCamera.mexeu()
`,
  },
  // D-PROD-382: os marcadores de um pedido entram no mapa JUNTOS. O plugin preparava e punha um de cada vez (cada um
  // esperava a imagem dele): com centenas de ícones e nomes, apareciam um por um ("carregando"). Agora todas as imagens
  // são preparadas fora da tela e os marcadores entram numa passada só. `opacity: 0` = o marcador começa escondido.
  {
    marca: MARCA_JUNTOS,
    arquivo: "android/src/main/java/com/capacitorjs/plugins/googlemaps/CapacitorGoogleMap.kt",
    ancora: `                newMarkers.forEach {
                    val markerOptions: Deferred<MarkerOptions> =
                            CoroutineScope(Dispatchers.IO).async {
                                this@CapacitorGoogleMap.buildMarker(it)
                            }
                    val googleMapMarker = googleMap?.addMarker(markerOptions.await())
`,
    inserir: `                // ${MARCA_JUNTOS} (as imagens todas antes, fora da tela; os marcadores entram numa passada só)
                val maikeOpcoes: List<MarkerOptions> =
                        CoroutineScope(Dispatchers.IO).async {
                            newMarkers.map { m -> this@CapacitorGoogleMap.buildMarker(m) }
                        }.await()
                var maikeIndice = 0
                newMarkers.forEach {
                    val maikeOpcao = maikeOpcoes[maikeIndice]
                    maikeIndice += 1
                    if (it.opacity == 0f) maikeOpcao.visible(false)
                    val googleMapMarker = googleMap?.addMarker(maikeOpcao)
`,
  },
  // D-PROD-382: mostrar e esconder marcadores que JÁ estão no mapa, com uma passagem curta (nada é refeito). A troca
  // de sigla para nome, os hectares e os filtros viram só isto: nenhuma imagem passa de novo do app para o mapa.
  {
    marca: MARCA_MOSTRAR,
    arquivo: "android/src/main/java/com/capacitorjs/plugins/googlemaps/CapacitorGoogleMap.kt",
    ancora: `    fun removeMarkers(ids: List<String>, callback: (error: GoogleMapsError?) -> Unit) {
`,
    inserir: `    // ${MARCA_MOSTRAR} (marcadores que já estão no mapa; nada é refeito)
    private var maikeAnimacao: android.animation.ValueAnimator? = null

    private fun maikeAlfa(m: Marker, alfa: Float) {
        try {
            m.alpha = alfa
        } catch (e: Exception) {
            // marcador já tirado do mapa
        }
    }

    private fun maikeVisivel(m: Marker, visivel: Boolean) {
        try {
            m.isVisible = visivel
        } catch (e: Exception) {
            // marcador já tirado do mapa
        }
    }

    private fun maikeTerminar(entram: List<Marker>, saem: List<Marker>) {
        for (m in entram) {
            maikeAlfa(m, 1f)
            maikeVisivel(m, true)
        }
        for (m in saem) {
            maikeVisivel(m, false)
        }
    }

    fun maikeMostrar(mostrar: List<String>, esconder: List<String>, ms: Long) {
        CoroutineScope(Dispatchers.Main).launch {
            // a passagem anterior termina antes (cada marcador fica no estado final dela)
            maikeAnimacao?.end()
            maikeAnimacao = null
            val entram: List<Marker> = mostrar.mapNotNull { id -> markers[id]?.googleMapMarker }
            val saem: List<Marker> = esconder.mapNotNull { id -> markers[id]?.googleMapMarker }
            if (ms <= 0L || entram.size + saem.size > 400) {
                maikeTerminar(entram, saem)
            } else {
                for (m in entram) {
                    maikeAlfa(m, 0f)
                    maikeVisivel(m, true)
                }
                val animacao = android.animation.ValueAnimator.ofFloat(0f, 1f)
                animacao.duration = ms
                animacao.addUpdateListener { a ->
                    val f = a.animatedValue as Float
                    for (m in entram) {
                        maikeAlfa(m, f)
                    }
                    for (m in saem) {
                        maikeAlfa(m, 1f - f)
                    }
                }
                animacao.addListener(object : android.animation.AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: android.animation.Animator) {
                        maikeTerminar(entram, saem)
                    }
                })
                maikeAnimacao = animacao
                animacao.start()
            }
        }
    }

    fun removeMarkers(ids: List<String>, callback: (error: GoogleMapsError?) -> Unit) {
`,
  },
  {
    marca: MARCA_MOSTRAR,
    arquivo: "android/src/main/java/com/capacitorjs/plugins/googlemaps/CapacitorGoogleMapsPlugin.kt",
    ancora: `    @PluginMethod
    fun removeMarkers(call: PluginCall) {
`,
    inserir: `    // ${MARCA_MOSTRAR} (marcadores que já estão no mapa; nada é refeito)
    @PluginMethod
    fun maikeMostrar(call: PluginCall) {
        try {
            val id = call.getString("id")
            id ?: throw InvalidMapIdError()

            val map = maps[id]
            map ?: throw MapNotFoundError()

            val lista = { nome: String ->
                val saida: MutableList<String> = mutableListOf()
                val vetor = call.getArray(nome)
                if (vetor != null) {
                    for (i in 0 until vetor.length()) {
                        saida.add(vetor.getString(i))
                    }
                }
                saida
            }

            map.maikeMostrar(lista("mostrar"), lista("esconder"), (call.getInt("ms") ?: 0).toLong())
            call.resolve()
        } catch (e: GoogleMapsError) {
            handleError(call, e)
        } catch (e: Exception) {
            handleError(call, e)
        }
    }

    @PluginMethod
    fun removeMarkers(call: PluginCall) {
`,
  },
];

/**
 * Põe o gancho da câmera (D-PROD-376) no plugin instalado em `pasta`, se ele não está lá igual.
 * @param {string} [pasta]
 * @returns {"criado" | "ja-criado" | "sem-plugin"}
 */
export function criarGancho(pasta = PLUGIN) {
  const raiz = join(pasta, "android", "src", "main", "java", "com", "capacitorjs", "plugins", "googlemaps");
  if (!existsSync(raiz)) return "sem-plugin";
  const caminho = join(pasta, ARQUIVO_GANCHO);
  if (existsSync(caminho) && readFileSync(caminho, "utf8") === GANCHO) return "ja-criado";
  writeFileSync(caminho, GANCHO);
  return "criado";
}

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
  if (criarGancho() === "criado") console.log(`[remendar-google-maps] ${ARQUIVO_GANCHO}: criado`);
  for (const r of remendar()) {
    if (r.estado === "sem-ancora") console.warn(`[remendar-google-maps] o ponto de remendo sumiu em ${r.arquivo}: o plugin mudou de versão?`);
    else if (r.estado === "remendado") console.log(`[remendar-google-maps] ${r.arquivo}: remendado`);
  }
}
