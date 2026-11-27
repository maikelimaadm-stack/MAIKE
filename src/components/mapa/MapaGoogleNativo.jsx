import React, { useEffect, useRef, useState } from "react";
import { GoogleMap } from "@capacitor/google-maps";

import { getGoogleMapsApiKey, getGoogleMapsIosKey } from "@/config/runtimeConfig";
import { lerVisaoSalva } from "@/lib/maplibre/mapaGeralRender.js";
import {
  areaNoPonto,
  caixaDosPoligonos,
  chaveDaVistaSalva,
  configDoMapaGoogle,
  ehMapaGoogleNativo,
  escalaDoMapaGoogle,
  limparMapaGoogleOrfao,
  novoIdDoMapaGoogle,
  pluginDoMapaGoogle,
  poligonosDasAreas,
  registrarMapaGoogleAberto,
  tipoDoMapaGoogle,
  zoomDoGoogle,
  zoomDoMapLibre,
} from "@/lib/mapaNativo/mapaGoogleNativo.js";
import { criarMapaGoogleWeb } from "@/lib/mapaNativo/mapaGoogleWeb.js";
import { criarCamadaDeImagens, projetarNaCamera } from "@/lib/mapaNativo/camadaDeImagens.js";

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
 * }} props
 */
export default function MapaGoogleNativo({ areas, areasDaFazenda, areasCarregadas = true, mostrarAreas, corDaArea, estiloPasto, tipoMapa, empresaId, ativo = true, onClickArea, onFalha, onMapa }) {
  const elRef = useRef(/** @type {HTMLElement | null} */ (null));
  const mapaRef = useRef(/** @type {GoogleMap | null} */ (null));
  const idsRef = useRef(/** @type {string[]} */ ([]));
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
  const ouvinteMovimentoRef = useRef(/** @type {{ remove: () => any } | null} */ (null));
  // App: os polígonos postos (para achar a área do toque; lá eles não são clicáveis)
  const poligonosRef = useRef(/** @type {any[]} */ ([]));
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
        // App (D-PROD-372): o mapa nativo não aceita a imagem desenhada na hora; os marcadores do Mapa Geral ficam
        // num div por cima dele, posicionados pela câmera. D-PROD-373: com o APK 1.0.7 o mapa avisa a câmera a cada
        // quadro (`onCameraMove`) e os ícones andam junto; no APK antigo, somem enquanto o mapa se move e voltam
        // quando ele para.
        const camadaEl = camadaElRef.current;
        const camada = nativo && camadaEl ? criarCamadaDeImagens(camadaEl) : null;
        camadaRef.current = camada;
        /** @type {ReturnType<typeof projetarNaCamera>} */
        let projecao = null;
        let recebeMovimento = false;
        /** @param {any} camera */
        const mostrarNaCamera = (camera) => {
          if (!camada || !camadaEl) return;
          projecao = projetarNaCamera(camera, camadaEl.clientWidth, camadaEl.clientHeight);
          // inclinado: sem projeção plana, os ícones ficam escondidos
          if (!projecao) {
            camadaEl.style.visibility = "hidden";
            return;
          }
          camada.posicionarTodos(projecao);
          camadaEl.style.visibility = "visible";
        };
        if (camada) {
          mostrarNaCamera({ latitude: config.center.lat, longitude: config.center.lng, zoom: config.zoom, bearing: 0 });
          await mapa.setOnCameraMoveStartedListener(() => {
            if (camadaEl && !recebeMovimento) camadaEl.style.visibility = "hidden";
          });
          try {
            ouvinteMovimentoRef.current = await pluginDoMapaGoogle().addListener("onCameraMove", (/** @type {any} */ e) => {
              if (e?.mapId !== mapa.id) return;
              recebeMovimento = true;
              mostrarNaCamera(e);
            });
          } catch {
            ouvinteMovimentoRef.current = null; // plugin sem o evento: os ícones somem durante o movimento
          }
          // Todo toque vai para o mapa nativo (a pinça em cima de um ícone também dá zoom). O toque rápido chega aqui:
          // o ícone de cima nesse ponto abre o detalhe dele; sem ícone, a área nesse ponto.
          await mapa.setOnMapClickListener((/** @type {any} */ e) => {
            const p = projecao?.(e?.latitude, e?.longitude);
            if (p && camada.tocar(p.x, p.y)) return;
            const tag = areaNoPonto(poligonosRef.current, e?.latitude, e?.longitude);
            const area = tag != null ? areasPorIdRef.current.get(String(tag)) : null;
            if (area) cliqueRef.current?.(area);
          });
        }
        mapaProntoRef.current?.(camada ? { definirMarcadores: (/** @type {string} */ g, /** @type {any[]} */ l) => camada.definir(g, l) } : mapa);
        await mapa.setOnPolygonClickListener((e) => {
          const area = areasPorIdRef.current.get(String(e?.tag));
          if (area) cliqueRef.current?.(area);
        });
        await mapa.setOnCameraIdleListener((e) => {
          mostrarNaCamera(e);
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
      const mapa = mapaRef.current;
      mapaRef.current = null;
      registrarMapaGoogleAberto(null);
      if (mapa) mapaProntoRef.current?.(null);
      camadaRef.current?.limpar();
      camadaRef.current = null;
      ouvinteMovimentoRef.current?.remove();
      ouvinteMovimentoRef.current = null;
      poligonosRef.current = [];
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
      try {
        const velhos = idsRef.current;
        idsRef.current = [];
        if (velhos.length) await mapa.removePolygons(velhos);
        // uma troca mais nova já está na fila: ela põe os polígonos dela
        if (superada || mapaRef.current !== mapa) return;
        areasPorIdRef.current = new Map(lista.map((a) => [String(a.id), a]));
        poligonosRef.current = poligonos;
        if (poligonos.length) idsRef.current = await mapa.addPolygons(/** @type {any} */ (poligonos));
      } catch (erro) {
        if (!superada && mapaRef.current === mapa) falhaRef.current?.(erro);
      }
    });
    return () => {
      superada = true;
    };
  }, [pronto, areas, mostrarAreas, corDaArea, estiloPasto]);

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
