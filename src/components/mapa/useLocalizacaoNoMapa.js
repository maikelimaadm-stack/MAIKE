import { useCallback, useEffect, useRef, useState } from "react";

/**
 * D-PROD-302 — a localização do aparelho no Mapa Geral: GPS de verdade, sempre
 * atualizada, e o mapa acompanhando quando a pessoa pede.
 *
 * Antes, o mapa pedia a posição UMA vez, ao tocar em "Localizar", sem alta
 * precisão: o celular podia responder com a posição aproximada da rede (centenas
 * de metros, às vezes outra cidade), e andando no pasto o ponto ficava parado.
 *
 * Agora:
 *  - com a camada "Minha localização" ligada, o GPS fica ligado
 *    (`watchPosition`, alta precisão) e o ponto anda junto com a pessoa;
 *  - o círculo mostra a precisão REAL da leitura (antes era fixo em 20 m);
 *  - uma leitura muito pior que a anterior (ex.: rede no lugar do GPS) não
 *    substitui uma boa recente;
 *  - "Localizar" centraliza UMA vez; depois o ponto anda sozinho e o mapa fica
 *    onde a pessoa deixou (o proprietário quer o ponto acompanhando, não o mapa).
 */

/** Leitura pior do que isto, com uma boa recente, é descartada (m). */
const PIOR_ACEITAVEL_M = 150;
/** Por quanto tempo uma leitura boa segura as piores (ms). */
const BOA_VALE_MS = 30_000;
const OPCOES_GPS = Object.freeze({ enableHighAccuracy: true, maximumAge: 3_000, timeout: 20_000 });

/**
 * @typedef {{ lat: number, lng: number, accuracy: number|null, em: number }} PosicaoGps
 */

/**
 * Uma leitura nova entra? Descarta a muito pior que uma boa recente.
 * @param {PosicaoGps|null} atual
 * @param {PosicaoGps} nova
 */
export const leituraEntra = (atual, nova) => {
  if (!atual) return true;
  const precisaoNova = nova.accuracy ?? Infinity;
  const precisaoAtual = atual.accuracy ?? Infinity;
  const atualRecente = nova.em - atual.em < BOA_VALE_MS;
  if (atualRecente && precisaoAtual <= PIOR_ACEITAVEL_M && precisaoNova > Math.max(PIOR_ACEITAVEL_M, precisaoAtual * 3)) return false;
  return true;
};

/** @param {GeolocationPosition} pos @returns {PosicaoGps} */
const deGeolocation = (pos) => ({
  lat: pos.coords.latitude,
  lng: pos.coords.longitude,
  accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
  em: Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now(),
});

/** @param {GeolocationPositionError|null|undefined} erro */
export const mensagemDoErroGps = (erro) => {
  if (erro?.code === 1) return "Permita a localização do MAK Gestão nas configurações do celular.";
  if (erro?.code === 2) return "Não foi possível obter o GPS. Ligue a localização do celular.";
  return null; // tempo esgotado: o GPS continua tentando, sem aviso
};

/**
 * @param {{
 *   mapInstanceRef: { current: any },
 *   ativo: boolean,
 *   aoErro?: (mensagem: string) => void,
 * }} p `ativo`: permissão + camada "Minha localização" ligada.
 */
export function useLocalizacaoNoMapa({ mapInstanceRef, ativo, aoErro }) {
  const [posicao, setPosicao] = useState(/** @type {PosicaoGps|null} */ (null));
  const posicaoRef = useRef(/** @type {PosicaoGps|null} */ (null));
  const aoErroRef = useRef(aoErro);
  aoErroRef.current = aoErro;

  const centrar = useCallback((/** @type {PosicaoGps} */ p) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    try {
      map.jumpTo({ center: [p.lng, p.lat], zoom: 18 });
    } catch {
      /* mapa ainda não pronto */
    }
  }, [mapInstanceRef]);

  const receber = useCallback((/** @type {PosicaoGps} */ nova) => {
    if (!leituraEntra(posicaoRef.current, nova)) return;
    posicaoRef.current = nova;
    setPosicao(nova);
  }, []);

  // GPS ligado enquanto a camada estiver ligada.
  useEffect(() => {
    if (!ativo || typeof navigator === "undefined" || typeof navigator.geolocation?.watchPosition !== "function") return undefined;
    let avisado = false;
    const id = navigator.geolocation.watchPosition(
      (pos) => receber(deGeolocation(pos)),
      (erro) => {
        const msg = mensagemDoErroGps(erro);
        if (msg && !avisado) {
          avisado = true;
          aoErroRef.current?.(msg);
        }
      },
      OPCOES_GPS
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [ativo, receber]);

  /**
   * "Localizar": pede a posição e, se `aoResponder` aceitar (a tela confere se a
   * fazenda e a permissão ainda são as do pedido), centraliza o mapa nela uma vez.
   * @param {{ aoResponder?: (p: PosicaoGps) => boolean }} [opcoes]
   */
  const localizar = useCallback((opcoes = {}) => {
    const aceitar = (/** @type {PosicaoGps} */ p) => {
      const ok = opcoes.aoResponder ? opcoes.aoResponder(p) !== false : true;
      if (ok) centrar(p);
    };
    const atual = posicaoRef.current;
    if (atual && Date.now() - atual.em < BOA_VALE_MS) {
      aceitar(atual);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nova = deGeolocation(pos);
        posicaoRef.current = nova;
        setPosicao(nova);
        aceitar(nova);
      },
      (erro) => {
        const msg = mensagemDoErroGps(erro) || "Não foi possível obter a localização. Tente de novo em um lugar aberto.";
        aoErroRef.current?.(msg);
      },
      OPCOES_GPS
    );
  }, [centrar]);

  return { posicao, localizar };
}
