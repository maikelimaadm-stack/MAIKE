import React, { useEffect, useRef, useState } from "react";
import { GoogleMap } from "@capacitor/google-maps";

import { getGoogleMapsApiKey, getGoogleMapsIosKey } from "@/config/runtimeConfig";
import { lerVisaoSalva } from "@/lib/maplibre/mapaGeralRender.js";
import {
  areaNoPonto,
  caixaDosPoligonos,
  chaveDaVistaSalva,
  circuloDaLocalizacao,
  configDoMapaGoogle,
  ehMapaGoogleNativo,
  escalaDoMapaGoogle,
  limparMapaGoogleOrfao,
  marcadorDaLocalizacao,
  APK_MARCADORES_NATIVOS,
  novoIdDoMapaGoogle,
  numeroDoApk,
  pluginDoMapaGoogle,
  planejarPoligonos,
  poligonosDasAreas,
  polilinhasDasLinhas,
  registrarMapaGoogleAberto,
  tipoDoMapaGoogle,
  zoomDoGoogle,
  zoomDoMapLibre,
} from "@/lib/mapaNativo/mapaGoogleNativo.js";
import { criarMapaGoogleWeb } from "@/lib/mapaNativo/mapaGoogleWeb.js";
import { criarCamadaDeImagens, projetarNaCamera } from "@/lib/mapaNativo/camadaDeImagens.js";
import { criarMarcadoresNativos } from "@/lib/mapaNativo/marcadoresNativos.js";
import { APK_CAMADA_NATIVA, camadaNativaDisponivel, criarCamadaNativa } from "@/lib/mapaNativo/camadaNativa.js";

const CENTRO_PADRAO = { lat: -15.78, lng: -47.93 };
/** Margem em volta da fazenda ao enquadrar (px da página). */
const MARGEM_ENQUADRAR = 40;

/**
 * O mapa nativo fica ATRÁS da página (o plugin deixa a WebView transparente): todo elemento entre o mapa e a raiz
 * precisa estar sem fundo, senão ele cobre o mapa. Guarda o fundo de cada um e devolve ao fechar.
 * @param {HTMLElement | null} el
 */
function abrirJanelaParaOMapa(el) {
  /** @type {Array<[HTMLElement, string]>} */
  const antes = [];
  for (let n = el?.parentElement; n; n = n.parentElement) {
    antes.push([n, n.style.background]);
    n.style.background = "transparent";
  }
  return () => {
    for (const [n, fundo] of antes) n.style.background = fundo;
  };
}

/**
 * Mapa Geral no Google Maps (D-PROD-366, etapa 1): nativo no app Android/iOS, Maps JavaScript API no site. Satélite do
 * Google, áreas com as cores e o estilo do Mapa Geral, toque na área abre o mesmo detalhe. A vista (centro e zoom)
 * usa a mesma chave do MapLibre.
 *
 * @param {{
 *   areas: any[],
 *   areasDaFazenda?: any[],
 *   areasCarregadas?: boolean,
 *   mostrarAreas: boolean,
 *   corDaArea: (area: any) => string | null | undefined,
 *   estiloPasto?: string,
 *   tipoMapa: string,
 *   empresaId?: string | null,
 *   ativo?: boolean,
 *   onClickArea?: (area: any) => void,
 *   onFalha?: (erro: unknown) => void,
 *   onMapa?: (mapa: any) => void,
 *   linhas?: any[],
 *   onClickLinha?: (linha: any) => void,
 *   localizacao?: { lat: number, lng: number, accuracy?: number | null } | null,
 * }} props `linhas` e `localizacao` (D-PROD-375): as linhas do Mapa Geral e o ponto azul com o círculo da precisão.
 */
export default function MapaGoogleNativo({ areas, areasDaFazenda, areasCarregadas = true, mostrarAreas, corDaArea, estiloPasto, tipoMapa, empresaId, ativo = true, onClickArea, onFalha, onMapa, linhas, onClickLinha, localizacao }) {
  const elRef = useRef(/** @type {HTMLElement | null} */ (null));
  const mapaRef = useRef(/** @type {GoogleMap | null} */ (null));
  const idsRef = useRef(/** @type {string[]} */ ([]));
  /** D-PROD-382: o que está no mapa, chave do polígono → id nativo (para trocar só o que mudou) */
  const poligonosNoMapaRef = useRef(/** @type {Map<string, string>} */ (new Map()));
  const linhasNoMapaRef = useRef(/** @type {Map<string, string>} */ (new Map()));
  // as trocas de polígonos rodam uma de cada vez: a seguinte sempre tira o que a anterior pôs
  const filaRef = useRef(/** @type {Promise<void>} */ (Promise.resolve()));
  const areasPorIdRef = useRef(new Map());
  const cliqueRef = useRef(onClickArea);
  cliqueRef.current = onClickArea;
  const falhaRef = useRef(onFalha);
  falhaRef.current = onFalha;
  const mapaProntoRef = useRef(onMapa);
  mapaProntoRef.current = onMapa;
  const enquadrouRef = useRef(false);
  const tipoMapaInicialRef = useRef(tipoMapa);
  // App: os marcadores ficam num div por cima do mapa nativo (D-PROD-372)
  const camadaElRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const camadaRef = useRef(/** @type {ReturnType<typeof criarCamadaDeImagens> | null} */ (null));
  const nativosRef = useRef(/** @type {ReturnType<typeof criarMarcadoresNativos> | null} */ (null));
  // D-PROD-376: a camada desenhada pelo Android (APK 1.0.9 em diante)
  const camadaNativaRef = useRef(/** @type {Awaited<ReturnType<typeof criarCamadaNativa>> | null} */ (null));
  const ouvinteMovimentoRef = useRef(/** @type {{ remove: () => any } | null} */ (null));
  // App: os polígonos postos (para achar a área do toque; lá eles não são clicáveis)
  const poligonosRef = useRef(/** @type {any[]} */ ([]));
  // D-PROD-375: as linhas postas (ids e a linha de cada `tag`), o círculo da localização e quem põe os marcadores
  const linhasIdsRef = useRef(/** @type {string[]} */ ([]));
  const linhasPorIdRef = useRef(new Map());
  const circuloIdsRef = useRef(/** @type {string[]} */ ([]));
  const definirRef = useRef(/** @type {null | ((grupo: string, lista: any[]) => any)} */ (null));
  const linhaRef = useRef(onClickLinha);
  linhaRef.current = onClickLinha;
  const [pronto, setPronto] = useState(false);

  // cria o mapa uma vez por fazenda
  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    let cancelado = false;
    const nativo = ehMapaGoogleNativo();
    /** @type {any} */
    let vista = null;
    try {
      vista = lerVisaoSalva(localStorage.getItem(chaveDaVistaSalva(empresaId)));
    } catch {
      vista = null;
    }
    enquadrouRef.current = !!vista;
    idsRef.current = [];
    poligonosNoMapaRef.current = new Map();
    filaRef.current = Promise.resolve();
    (async () => {
      try {
        // um mapa nativo que ficou vivo de uma recarga no meio sai antes: o id novo apaga a única referência a ele
        await limparMapaGoogleOrfao();
        if (cancelado) return;
        const config = configDoMapaGoogle(
          { center: vista?.center || CENTRO_PADRAO, zoom: zoomDoGoogle(vista?.zoom ?? 14) },
          tipoMapaInicialRef.current
        );
        // App: o mapa nativo do plugin. Site: a Maps JavaScript API direto (D-PROD-369), com os marcadores do Mapa Geral.
        const mapa = /** @type {any} */ (
          nativo
            ? await GoogleMap.create({
                id: novoIdDoMapaGoogle(),
                element: el,
                // Android lê a chave do AndroidManifest (segredo do build do APK); o iOS recebe aqui.
                apiKey: getGoogleMapsIosKey() || getGoogleMapsApiKey() || "",
                forceCreate: true,
                config: /** @type {any} */ (config),
              })
            : await criarMapaGoogleWeb({ element: el, config })
        );
        if (cancelado) {
          await mapa.destroy().catch(() => {});
          return;
        }
        mapaRef.current = mapa;
        registrarMapaGoogleAberto(mapa);
        // App: os ícones do Mapa Geral.
        // - APK 1.0.8 em diante (D-PROD-374): marcadores do PRÓPRIO mapa nativo, com a mesma imagem do site; andam colados
        //   no mapa.
        // - APK mais antigo (D-PROD-372/373): imagens num div por cima do mapa, posicionadas pela câmera (com o
        //   `onCameraMove` do 1.0.7, a cada quadro do ecrã; no 1.0.6, somem enquanto o mapa se mexe).
        // - APK 1.0.9 em diante (D-PROD-376): a camada desenhada pelo próprio Android, colada no mapa; os nomes mudam
        //   de tamanho junto com o zoom. Se ela não ligar, os marcadores do mapa.
        const camadaEl = camadaElRef.current;
        const apk = nativo ? await numeroDoApk() : 0;
        const camadaNativa = nativo && apk >= APK_CAMADA_NATIVA && camadaNativaDisponivel() ? await criarCamadaNativa(mapa.id) : null;
        if (cancelado) {
          await camadaNativa?.limpar();
          return;
        }
        camadaNativaRef.current = camadaNativa;
        const nativos = nativo && !camadaNativa && apk >= APK_MARCADORES_NATIVOS ? criarMarcadoresNativos(mapa, {
              // D-PROD-382: mostrar e esconder o que já está no mapa (o APK anterior não tem o método: recusa)
              mostrar: async (entram, saem, ms) => /** @type {any} */ (pluginDoMapaGoogle()).maikeMostrar({ id: mapa.id, mostrar: entram, esconder: saem, ms }),
            })
          : null;
        nativosRef.current = nativos;
        const camada = nativo && !camadaNativa && !nativos && camadaEl ? criarCamadaDeImagens(camadaEl) : null;
        camadaRef.current = camada;
        if (camadaEl && (nativos || camadaNativa)) camadaEl.style.display = "none";
        /** @type {Set<(c: any) => void>} quem quer a câmera (os nomes dos pastos) */
        const ouvintesCamera = new Set();
        /** @type {ReturnType<typeof projetarNaCamera>} */
        let projecao = null;
        let recebeMovimento = false;
        /** @param {any} camera @param {boolean} final */
        const avisarCamera = (camera, final) => {
          if (!ouvintesCamera.size || !el) return;
          const largura = el.clientWidth;
          const altura = el.clientHeight;
          const projetar = projetarNaCamera(camera, largura, altura);
          if (!projetar) return;
          const c = { zoom: zoomDoMapLibre(camera.zoom), projetar, largura, altura, final };
          ouvintesCamera.forEach((f) => f(c));
        };
        /** @param {any} camera */
        const mostrarNaCamera = (camera) => {
          if (!camada || !camadaEl) return;
          projecao = projetarNaCamera(camera, camadaEl.clientWidth, camadaEl.clientHeight);
          // inclinado: sem projeção plana, os ícones ficam escondidos
          if (!projecao) {
            camadaEl.style.visibility = "hidden";
            return;
          }
          camada.posicionarTodos(projecao, zoomDoMapLibre(camera.zoom));
          camadaEl.style.visibility = "visible";
        };
        // a câmera a cada quadro chega em rajadas: só a última de cada quadro da tela é usada (o ícone não treme)
        /** @type {any} */
        let ultimaCamera = null;
        let quadro = 0;
        const noQuadro = () => {
          quadro = 0;
          if (!ultimaCamera) return;
          mostrarNaCamera(ultimaCamera);
          // com os ícones no mapa nativo, os nomes são revistos só quando o mapa para: nada de trabalho no meio do gesto
          if (camada) avisarCamera(ultimaCamera, false);
        };
        if (nativo) {
          if (camada) mostrarNaCamera({ latitude: config.center.lat, longitude: config.center.lng, zoom: config.zoom, bearing: 0 });
          await mapa.setOnCameraMoveStartedListener(() => {
            if (camadaEl && camada && !recebeMovimento) camadaEl.style.visibility = "hidden";
          });
          // a câmera a cada quadro só serve aos ícones por cima do mapa (APK antigo); a camada nativa e os marcadores
          // do mapa andam sozinhos
          if (camada) {
            try {
              ouvinteMovimentoRef.current = await pluginDoMapaGoogle().addListener("onCameraMove", (/** @type {any} */ e) => {
                if (e?.mapId !== mapa.id) return;
                recebeMovimento = true;
                ultimaCamera = e;
                if (!quadro) quadro = requestAnimationFrame(noQuadro);
              });
            } catch {
              ouvinteMovimentoRef.current = null; // plugin sem o evento: os ícones somem durante o movimento
            }
          }
          // O toque no ícone nativo (APK 1.0.8): abre o detalhe dele; no nome do pasto, abre o pasto.
          if (nativos) {
            await mapa.setOnMarkerClickListener((/** @type {any} */ e) => {
              const m = nativos.marcadorDoToque(e?.markerId);
              if (!m) return;
              if (m.onClick) {
                m.onClick();
                return;
              }
              const tag = areaNoPonto(poligonosRef.current, m.lat, m.lng);
              const area = tag != null ? areasPorIdRef.current.get(String(tag)) : null;
              if (area) cliqueRef.current?.(area);
            });
          }
          // Todo toque fora de ícone nativo vai para o mapa: no APK antigo, o ícone de cima nesse ponto abre o detalhe
          // dele; sem ícone, a área nesse ponto.
          /** @param {any} e */
          const tocarSemCamadaNativa = (e) => {
            const p = projecao?.(e?.latitude, e?.longitude);
            if (camada && p && camada.tocar(p.x, p.y)) return;
            const tag = areaNoPonto(poligonosRef.current, e?.latitude, e?.longitude);
            const area = tag != null ? areasPorIdRef.current.get(String(tag)) : null;
            if (area) cliqueRef.current?.(area);
          };
          await mapa.setOnMapClickListener((/** @type {any} */ e) => {
            if (!camadaNativa) {
              tocarSemCamadaNativa(e);
              return;
            }
            // D-PROD-376: o Android diz qual item da camada está no ponto (o de cima que recebe toque); sem item, a área
            void camadaNativa.tocar(e?.latitude, e?.longitude).then((m) => {
              if (m?.onClick) m.onClick();
              else tocarSemCamadaNativa(e);
            });
          });
        }
        const alvoDosMarcadores = camadaNativa || nativos || camada;
        definirRef.current = alvoDosMarcadores
          ? (g, l) => alvoDosMarcadores.definir(g, l)
          : typeof mapa.definirMarcadores === "function"
            ? (g, l) => mapa.definirMarcadores(g, l)
            : null;
        mapaProntoRef.current?.(
          alvoDosMarcadores
            ? {
                definirMarcadores: (/** @type {string} */ g, /** @type {any[]} */ l) => alvoDosMarcadores.definir(g, l),
                // D-PROD-379: nos marcadores do mapa nativo, o nome tem tamanho fixo (o mapa não o refaz no zoom)
                nomesFixos: Boolean(nativos),
                /** "Localizar" (D-PROD-375): centraliza num ponto, no zoom do MapLibre. */
                centrar: (/** @type {number} */ lat, /** @type {number} */ lng, /** @type {number} */ zoom) =>
                  mapa
                    .setCamera({ coordinate: { lat, lng }, ...(Number.isFinite(zoom) ? { zoom: zoomDoGoogle(zoom) } : {}), animate: false })
                    ?.catch?.(() => {}),
                /** @param {(c: any) => void} f */
                aoMudarCamera: (f) => {
                  ouvintesCamera.add(f);
                  return () => ouvintesCamera.delete(f);
                },
              }
            : mapa
        );
        await mapa.setOnPolygonClickListener((e) => {
          const area = areasPorIdRef.current.get(String(e?.tag));
          if (area) cliqueRef.current?.(area);
        });
        // D-PROD-375: o toque na linha mostra o nome e o tipo dela
        if (typeof mapa.setOnPolylineClickListener === "function") {
          await mapa.setOnPolylineClickListener((/** @type {any} */ e) => {
            const linha = linhasPorIdRef.current.get(String(e?.tag));
            if (linha) linhaRef.current?.(linha);
          });
        }
        await mapa.setOnCameraIdleListener((e) => {
          if (quadro) cancelAnimationFrame(quadro);
          quadro = 0;
          ultimaCamera = null;
          mostrarNaCamera(e);
          if (nativos) nativos.aoParar(zoomDoMapLibre(e?.zoom));
          avisarCamera(e, true);
          if (!enquadrouRef.current || !Number.isFinite(e?.latitude)) return;
          try {
            localStorage.setItem(
              chaveDaVistaSalva(empresaId),
              JSON.stringify({ center: { lat: e.latitude, lng: e.longitude }, zoom: zoomDoMapLibre(e.zoom) })
            );
          } catch {
            /* armazenamento indisponível */
          }
        });
        if (!cancelado) setPronto(true);
      } catch (erro) {
        if (!cancelado) falhaRef.current?.(erro);
      }
    })();
    return () => {
      cancelado = true;
      setPronto(false);
      idsRef.current = [];
      poligonosNoMapaRef.current = new Map();
      const mapa = mapaRef.current;
      mapaRef.current = null;
      registrarMapaGoogleAberto(null);
      if (mapa) mapaProntoRef.current?.(null);
      camadaRef.current?.limpar();
      camadaRef.current = null;
      void nativosRef.current?.limpar();
      nativosRef.current = null;
      void camadaNativaRef.current?.limpar();
      camadaNativaRef.current = null;
      ouvinteMovimentoRef.current?.remove();
      ouvinteMovimentoRef.current = null;
      poligonosRef.current = [];
      linhasIdsRef.current = [];
      linhasNoMapaRef.current = new Map();
      circuloIdsRef.current = [];
      definirRef.current = null;
      mapa?.destroy().catch(() => {});
    };
  }, [empresaId]);

  // App: com o Mapa Geral à vista, a página fica transparente em volta do mapa e o mapa recebe o toque; fora dela
  // (D-PROD-305: o Mapa Geral fica montado e escondido) o fundo volta e o mapa para de pegar os toques das outras telas.
  useEffect(() => {
    if (!pronto || !ehMapaGoogleNativo()) return undefined;
    const mapa = mapaRef.current;
    if (!ativo) {
      mapa?.disableTouch().catch(() => {});
      return undefined;
    }
    const fechar = abrirJanelaParaOMapa(elRef.current);
    mapa?.enableTouch().catch(() => {});
    return fechar;
  }, [pronto, ativo]);

  // satélite ou mapa
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!pronto || !mapa) return;
    mapa.setMapType(/** @type {any} */ (tipoDoMapaGoogle(tipoMapa))).catch(() => {});
  }, [pronto, tipoMapa]);

  // áreas: refeitas quando mudam as áreas, as cores (coloração) ou o estilo dos pastos
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!pronto || !mapa) return undefined;
    let superada = false;
    const lista = mostrarAreas ? areas || [] : [];
    const escala = escalaDoMapaGoogle();
    const nativo = ehMapaGoogleNativo();
    // App (D-PROD-373): o polígono não pega o toque (o clique do mapa acha a área); no site, o Google acha
    const poligonos = poligonosDasAreas(lista, corDaArea, estiloPasto, escala).map((p) => (nativo ? { ...p, clickable: false } : p));
    filaRef.current = filaRef.current.then(async () => {
      if (mapaRef.current !== mapa) return;
      // uma troca mais nova já está na fila: ela põe os polígonos dela
      if (superada) return;
      try {
        // D-PROD-382: só o pasto que mudou sai e entra; o novo entra ANTES do velho sair (nada pisca)
        const { entram, saem, ficam } = planejarPoligonos(poligonosNoMapaRef.current, poligonos);
        areasPorIdRef.current = new Map(lista.map((a) => [String(a.id), a]));
        poligonosRef.current = poligonos;
        if (entram.length) {
          const ids = await mapa.addPolygons(/** @type {any} */ (entram.map((e) => e.poligono)));
          entram.forEach((e, i) => ids[i] != null && ficam.set(e.chave, String(ids[i])));
        }
        poligonosNoMapaRef.current = ficam;
        idsRef.current = [...ficam.values()];
        if (saem.length && mapaRef.current === mapa) await mapa.removePolygons(saem);
      } catch (erro) {
        if (!superada && mapaRef.current === mapa) falhaRef.current?.(erro);
      }
    });
    return () => {
      superada = true;
    };
  }, [pronto, areas, mostrarAreas, corDaArea, estiloPasto]);

  // linhas (D-PROD-375): refeitas quando mudam (a fila é a mesma dos polígonos)
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!pronto || !mapa || typeof mapa.addPolylines !== "function") return undefined;
    let superada = false;
    const lista = linhas || [];
    const polilinhas = polilinhasDasLinhas(lista, escalaDoMapaGoogle());
    filaRef.current = filaRef.current.then(async () => {
      if (mapaRef.current !== mapa) return;
      if (superada) return;
      try {
        // D-PROD-382: como nos pastos, só a linha que mudou sai e entra (a nova antes da velha sair)
        const { entram, saem, ficam } = planejarPoligonos(linhasNoMapaRef.current, polilinhas);
        linhasPorIdRef.current = new Map(lista.map((l) => [String(l.id), l]));
        if (entram.length) {
          const ids = await mapa.addPolylines(/** @type {any} */ (entram.map((e) => e.poligono)));
          entram.forEach((e, i) => ids[i] != null && ficam.set(e.chave, String(ids[i])));
        }
        linhasNoMapaRef.current = ficam;
        linhasIdsRef.current = [...ficam.values()];
        if (saem.length && mapaRef.current === mapa) await mapa.removePolylines(saem);
      } catch {
        /* mapa fechado no meio */
      }
    });
    return () => {
      superada = true;
    };
  }, [pronto, linhas]);

  // minha localização (D-PROD-375): o ponto azul (marcador, por cima de tudo) e o círculo da precisão. O círculo novo
  // entra antes do velho sair (não pisca a cada leitura do GPS).
  const latLocal = localizacao?.lat;
  const lngLocal = localizacao?.lng;
  const precisaoLocal = localizacao?.accuracy;
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!pronto || !mapa) return;
    const pos = Number.isFinite(latLocal) && Number.isFinite(lngLocal) ? { lat: /** @type {number} */ (latLocal), lng: /** @type {number} */ (lngLocal), accuracy: precisaoLocal } : null;
    const ponto = marcadorDaLocalizacao(pos);
    void definirRef.current?.("localizacao", ponto ? [ponto] : []);
    if (typeof mapa.addCircles !== "function") return;
    const circulos = pos ? [circuloDaLocalizacao(pos, escalaDoMapaGoogle())] : [];
    filaRef.current = filaRef.current.then(async () => {
      if (mapaRef.current !== mapa) return;
      try {
        const velhos = circuloIdsRef.current;
        circuloIdsRef.current = circulos.length ? await mapa.addCircles(/** @type {any} */ (circulos)) : [];
        if (velhos.length) await mapa.removeCircles(velhos);
      } catch {
        /* mapa fechado no meio */
      }
    });
  }, [pronto, latLocal, lngLocal, precisaoLocal]);

  // primeira abertura sem vista salva: enquadra todas as áreas da fazenda (como o MapLibre, sem filtro nem camada).
  // Enquanto a consulta das áreas não termina, fica pendente e a vista não é gravada; fazenda sem áreas de fato:
  // a vista passa a ser gravada como está.
  const paraEnquadrar = areasDaFazenda ?? areas;
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!pronto || !mapa || enquadrouRef.current) return;
    const escala = escalaDoMapaGoogle();
    const caixa = caixaDosPoligonos(poligonosDasAreas(paraEnquadrar || [], () => null, undefined, escala));
    if (!caixa && !areasCarregadas) return;
    enquadrouRef.current = true;
    if (!caixa) return;
    filaRef.current = filaRef.current.then(async () => {
      if (mapaRef.current !== mapa) return;
      await mapa.fitBounds(/** @type {any} */ (caixa), MARGEM_ENQUADRAR * escala).catch(() => {});
    });
  }, [pronto, paraEnquadrar, areasCarregadas]);

  // App: o elemento do plugin (ele abre o "buraco" para o mapa nativo). Site: um div comum (o elemento do plugin
  // apaga o conteúdo quando volta à página, e o mapa do site mora dentro dele).
  // `isolation: isolate` nos dois, como no MapLibre: a ordem dos marcadores (z-index 500 a 3000) fica dentro do mapa e
  // não passa por cima da barra, do resumo e das janelas do Mapa Geral.
  const estilo = { display: "block", width: "100%", height: "100%" };
  return ehMapaGoogleNativo() ? (
    <div style={{ position: "relative", width: "100%", height: "100%", isolation: "isolate" }}>
      <capacitor-google-map ref={elRef} data-testid="mapa-geral-google" style={estilo} />
      {/* os marcadores por cima do mapa nativo: o div não pega o toque (vai para o mapa); só a imagem pega */}
      <div
        ref={camadaElRef}
        data-testid="mapa-google-marcadores-app"
        style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
      />
    </div>
  ) : (
    <div ref={/** @type {any} */ (elRef)} data-testid="mapa-geral-google" style={{ ...estilo, isolation: "isolate" }} />
  );
}
