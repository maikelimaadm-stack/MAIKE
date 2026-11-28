/**
 * Os ícones do Mapa Geral como marcadores do PRÓPRIO mapa nativo do Google, no app (D-PROD-374, APK 1.0.8 em diante).
 *
 * Por quê: num `div` por cima do mapa nativo (D-PROD-372/373), os ícones dependem da câmera que o Android manda para a
 * página, com atraso e em rajadas: andam atrás do mapa e tremem. Como marcadores do mapa, andam colados nele.
 *
 * Como: o remendo `scripts/app/remendar-google-maps.mjs` faz o marcador nativo aceitar a imagem `data:` (a mesma do
 * site: lote com a contagem, cocho com o nível e o farol). A posição em px (centro ou topo no ponto + deslocamento)
 * vira uma âncora: a imagem ganha só a margem transparente que precisa para o ponto do mapa caber nela, e a âncora vai
 * no ponto (D-PROD-379; antes ia no meio e a imagem dobrava). O nome do pasto, que muda de tamanho com o zoom, é refeito no tamanho do zoom quando o
 * mapa para.
 *
 * O toque no marcador é do Mapa Geral (o remendo faz o mapa não centralizar nem abrir balão): `tocar(idNativo)`.
 */

/** @typedef {import('./mapaGoogleWeb.js').MarcadorWeb} Marcador */

/** Ordem dos nomes no mapa nativo: por baixo dos ícones (a margem transparente do nome não rouba o toque do lote). */
export const Z_NOME_NATIVO = 100;
/** Diferença de tamanho (proporção) a partir da qual o nome é refeito quando o mapa para. */
export const DIFERENCA_REFAZER_NOME = 0.04;

/** Imagens com a margem, por URL, tamanho e âncora. @type {Map<string, Promise<string | null>>} */
const comMargem = new Map();

/**
 * A imagem com a margem transparente MÍNIMA para o ponto de âncora (ax, ay em px da imagem) caber nela (D-PROD-379;
 * antes a margem punha o ponto no meio e dobrava a imagem). A âncora vai em px da imagem nova: o plugin a converte em
 * fração do tamanho (Android e iOS). Tamanhos em px inteiros: o Android lê o tamanho do ícone em número inteiro.
 * @param {string} url @param {number} w @param {number} h @param {number} ax @param {number} ay
 * @returns {Promise<{ url: string, w: number, h: number, ax: number, ay: number } | null>}
 */
export async function imagemComAncora(url, w, h, ax, ay) {
  const esquerda = Math.min(0, ax);
  const topo = Math.min(0, ay);
  const L = Math.max(1, Math.ceil(Math.max(w, ax) - esquerda - 0.001));
  const A = Math.max(1, Math.ceil(Math.max(h, ay) - topo - 0.001));
  // o ponto já está dentro da imagem: a mesma imagem, no tamanho inteiro mais perto
  if (esquerda === 0 && topo === 0 && ax <= w && ay <= h) {
    const wi = Math.max(1, Math.round(w));
    const hi = Math.max(1, Math.round(h));
    return { url, w: wi, h: hi, ax: (ax * wi) / w, ay: (ay * hi) / h };
  }
  const chave = `${url.length}:${url.slice(-64)}|${w.toFixed(2)}|${h.toFixed(2)}|${ax.toFixed(2)}|${ay.toFixed(2)}`;
  let p = comMargem.get(chave);
  if (!p) {
    p = new Promise((resolve) => {
      if (typeof document === "undefined" || typeof Image === "undefined") return resolve(null);
      const img = new Image();
      img.onload = () => {
        try {
          const pr = Math.max(1, Number(globalThis.devicePixelRatio) || 1);
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(L * pr);
          canvas.height = Math.ceil(A * pr);
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(null);
          ctx.drawImage(img, -esquerda * pr, -topo * pr, w * pr, h * pr);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    comMargem.set(chave, p);
    if (comMargem.size > 800) comMargem.clear();
  }
  const pronta = await p;
  return pronta ? { url: pronta, w: L, h: A, ax: ax - esquerda, ay: ay - topo } : null;
}

/** D-PROD-382: os grupos pedidos dentro deste tempo (ms) vão para o mapa juntos (os ícones não aparecem um por um). */
export const MS_JUNTAR_GRUPOS = 40;

/**
 * Tamanho e âncora (px da imagem) de um marcador no zoom.
 * @param {Marcador} m @param {number} zoom zoom do MapLibre
 */
export function geometriaNoZoom(m, zoom) {
  const f = m.escala ? m.escala(zoom) : 1;
  const k = Number.isFinite(f) && f > 0 ? f : 1;
  const w = m.w * k;
  const h = m.h * k;
  // o ponto do mapa na imagem: centro (ou topo) da imagem menos o deslocamento
  const ax = w / 2 - (m.dx || 0);
  const ay = (m.ancora === "topo" ? 0 : h / 2) - (m.dy || 0);
  return { w, h, ax, ay };
}

/** D-PROD-382: a passagem (ms) de quem aparece e some no mapa. */
export const MS_PASSAGEM = 140;
/** D-PROD-382: quantos marcadores escondidos ficam guardados no mapa para voltar sem refazer. */
export const LIMITE_GUARDADOS = 1500;
/** D-PROD-382: depois de uma troca, a espera (ms) para pôr no mapa, escondidos, os outros níveis dos nomes. */
export const MS_AQUECER = 350;

/**
 * A camada de marcadores nativos sobre um mapa do plugin (`GoogleMap`).
 * @param {{ addMarkers: (m: any[]) => Promise<string[]>, removeMarkers: (ids: string[]) => Promise<void> }} mapa
 * @param {{ mostrar?: (mostrar: string[], esconder: string[], ms: number) => Promise<any> }} [opcoes] `mostrar`: o
 *   método nativo que mostra e esconde marcadores que já estão no mapa (APK com o remendo D-PROD-382)
 */
export function criarMarcadoresNativos(mapa, { mostrar } = {}) {
  /** @type {Map<string, { m: Marcador, idNativo: string | null, assinatura: string, visivel: boolean, naLista: boolean }>} */
  const itens = new Map();
  // o APK sabe mostrar e esconder? (uma chamada vazia: o APK anterior responde que não tem o método)
  /** @type {Promise<boolean>} */
  const suporte = mostrar ? Promise.resolve().then(() => mostrar([], [], 0)).then(() => true, () => false) : Promise.resolve(false);
  /** @type {Map<string, string>} idNativo → chave */
  const porNativo = new Map();
  /** @type {Map<string, Marcador[]>} a última lista de cada grupo (para refazer os nomes no zoom) */
  const listas = new Map();
  /** @type {Map<string, number>} o zoom em que cada grupo foi posto (o tamanho dos nomes) */
  const zoomDoGrupo = new Map();
  let zoom = 14;
  let fila = /** @type {Promise<void>} */ (Promise.resolve());
  let vivo = true;

  /** @param {Marcador} m */
  const assinatura = (m) => {
    const g = geometriaNoZoom(m, zoom);
    return [m.url.length, m.url.slice(-48), g.w.toFixed(1), g.h.toFixed(1), g.ax.toFixed(1), g.ay.toFixed(1), m.z ?? 0, m.lat, m.lng].join("|");
  };

  /** @param {Marcador} m */
  const paraNativo = async (m) => {
    const g = geometriaNoZoom(m, zoom);
    const img = await imagemComAncora(m.url, g.w, g.h, g.ax, g.ay);
    if (!img) return null;
    return {
      coordinate: { lat: m.lat, lng: m.lng },
      iconUrl: img.url,
      iconSize: { width: img.w, height: img.h },
      iconAnchor: { x: img.ax, y: img.ay },
      // o nome por baixo dos ícones; quem pede outra ordem no app (o ponto azul) usa `zNativo`
      zIndex: m.zNativo ?? (m.semToque ? Z_NOME_NATIVO : m.z ?? 0),
    };
  };

  /** D-PROD-382: os grupos pedidos em seguida (lotes, cochos, pontos, tarefas, nomes) esperando a próxima troca */
  /** @type {Map<string, Marcador[]>} */
  const pendentes = new Map();
  /** @type {Promise<void> | null} */
  let agendada = null;

  /** Marcadores trocados que saem do mapa depois da passagem (ids nativos). @type {Set<string>} */
  const lixo = new Set();
  const esvaziarLixo = () => {
    if (!lixo.size) return Promise.resolve();
    const ids = [...lixo];
    lixo.clear();
    return mapa.removeMarkers(ids).catch(() => {});
  };

  /**
   * Uma troca no mapa (D-PROD-382). Todos os grupos do lote vão numa chamada só ao mapa: os ícones aparecem juntos.
   *
   * Com o APK que sabe mostrar e esconder (`liso`): nada que já está no mapa é refeito. O marcador que sai da lista ou
   * fica `oculto` é só ESCONDIDO (e guardado); o que volta é só MOSTRADO; os novos entram escondidos e aparecem na
   * mesma passagem curta. Trocar o nível dos nomes ou um filtro vira uma chamada pequena, sem imagem nenhuma.
   *
   * Sem isso (APK anterior): o que entrou ou mudou entra e só depois o que saiu sai; o nome que troca de texto no
   * mesmo lugar sai antes de o novo entrar.
   * @param {Map<string, Marcador[]>} lote
   */
  const trocar = async (lote) => {
    if (!vivo) return;
    const liso = await suporte;
    if (!vivo) return;
    const zoomDaTroca = zoom;
    /** @type {Set<string>} chaves cujo marcador sai do mapa */
    const tirar = new Set();
    /** @type {Array<[string, Marcador, string]>} */
    const por = [];
    /** @type {string[]} */
    const mostrarK = [];
    /** @type {string[]} */
    const esconderK = [];
    let frios = 0;
    for (const [grupo, lista] of lote) {
      const novos = new Map(lista.map((m) => [`${grupo}|${m.id}`, m]));
      for (const [k, it] of itens) {
        if (!k.startsWith(`${grupo}|`)) continue;
        const m = novos.get(k);
        if (m && assinatura(m) !== it.assinatura) {
          tirar.add(k); // outro desenho ou lugar: o novo entra (se é para aparecer) e este sai
          continue;
        }
        if (m) it.m = m; // mesmo desenho e lugar: só o clique e o resto dos dados
        it.naLista = Boolean(m);
        const querVisivel = Boolean(m && !m.oculto);
        if (!liso) {
          if (!querVisivel) tirar.add(k);
        } else if (querVisivel && !it.visivel) mostrarK.push(k);
        else if (!querVisivel && it.visivel) esconderK.push(k);
      }
      for (const [k, m] of novos) {
        if (itens.has(k) && !tirar.has(k)) continue;
        if (m.oculto) frios += 1;
        else por.push([k, m, assinatura(m)]);
      }
    }
    // guardados demais (saíram da lista e ficaram escondidos): os mais antigos saem do mapa
    if (liso) {
      let guardados = 0;
      for (const it of itens.values()) if (!it.naLista) guardados += 1;
      for (const [k, it] of itens) {
        if (guardados <= LIMITE_GUARDADOS) break;
        if (it.naLista || tirar.has(k)) continue;
        tirar.add(k);
        guardados -= 1;
      }
    }
    const prontos = await Promise.all(por.map(([, m]) => paraNativo(m)));
    if (!vivo) return;
    for (const grupo of lote.keys()) zoomDoGrupo.set(grupo, zoomDaTroca);
    try {
      const validos = por.filter((_, i) => prontos[i]);
      const paraOMapa = /** @type {any[]} */ (prontos.filter(Boolean));
      // liso: os novos entram escondidos e aparecem na passagem, junto com os que voltam
      if (liso) for (const n of paraOMapa) n.opacity = 0;
      const entraDeNovo = new Set(validos.map(([k]) => k));
      /** @type {string[]} */
      const tirarAntes = [];
      /** @type {string[]} */
      const tirarDepois = [];
      /** @type {string[]} */
      const somem = [];
      for (const k of tirar) {
        const it = itens.get(k);
        if (it?.idNativo) {
          porNativo.delete(it.idNativo);
          if (!liso && it.m.semToque && entraDeNovo.has(k)) tirarAntes.push(it.idNativo);
          else tirarDepois.push(it.idNativo);
          if (it.visivel) somem.push(it.idNativo);
        }
        itens.delete(k);
      }
      if (tirarAntes.length) await mapa.removeMarkers(tirarAntes);
      const ids = paraOMapa.length ? await mapa.addMarkers(paraOMapa) : [];
      /** @type {string[]} */
      const aparecem = [];
      validos.forEach(([k, m, a], i) => {
        const idNativo = ids?.[i] != null ? String(ids[i]) : null;
        itens.set(k, { m, idNativo, assinatura: a, visivel: true, naLista: true });
        if (idNativo) {
          porNativo.set(idNativo, k);
          aparecem.push(idNativo);
        }
      });
      if (!liso) {
        if (tirarDepois.length) await mapa.removeMarkers(tirarDepois);
      } else {
        for (const k of mostrarK) {
          const it = itens.get(k);
          if (!it) continue;
          it.visivel = true;
          if (it.idNativo) aparecem.push(it.idNativo);
        }
        for (const k of esconderK) {
          const it = itens.get(k);
          if (!it) continue;
          it.visivel = false;
          if (it.idNativo) somem.push(it.idNativo);
        }
        if ((aparecem.length || somem.length) && mostrar) await mostrar(aparecem, somem, MS_PASSAGEM).catch(() => {});
        // os trocados saem do mapa depois da passagem (já estão invisíveis)
        if (tirarDepois.length) {
          for (const id of tirarDepois) lixo.add(id);
          setTimeout(() => void esvaziarLixo(), MS_PASSAGEM + 80);
        }
      }
    } catch {
      /* mapa fechado no meio */
    }
    // o mapa parou num zoom novo enquanto as imagens eram preparadas: refaz no zoom de agora
    if (vivo && zoom !== zoomDaTroca) for (const grupo of lote.keys()) if (!pendentes.has(grupo)) revisarGrupo(grupo);
    // os escondidos que ainda não existem (os outros níveis dos nomes): entram depois, sem pressa, já escondidos
    if (vivo && liso && frios) agendarFrios();
  };

  /** @type {ReturnType<typeof setTimeout> | null} */
  let esperaFrios = null;
  const agendarFrios = () => {
    if (esperaFrios) clearTimeout(esperaFrios);
    esperaFrios = setTimeout(() => {
      esperaFrios = null;
      fila = fila.then(aquecer);
    }, MS_AQUECER);
  };
  /**
   * Põe no mapa, escondidos, os marcadores `oculto` que ainda não existem (a sigla e os hectares de cada pasto):
   * a primeira troca de nível também vira só mostrar e esconder. Para se uma troca de verdade está esperando.
   */
  const aquecer = async () => {
    if (!vivo || pendentes.size || !(await suporte)) return;
    let escondidos = 0;
    for (const it of itens.values()) if (!it.visivel) escondidos += 1;
    /** @type {Array<[string, Marcador, string]>} */
    const por = [];
    for (const [grupo, lista] of listas) {
      for (const m of lista) {
        const k = `${grupo}|${m.id}`;
        if (!m.oculto || itens.has(k)) continue;
        if (escondidos + por.length >= LIMITE_GUARDADOS) break;
        por.push([k, m, assinatura(m)]);
      }
    }
    if (!por.length) return;
    const prontos = await Promise.all(por.map(([, m]) => paraNativo(m)));
    if (!vivo || pendentes.size) return;
    try {
      const validos = por.filter((_, i) => prontos[i]);
      const paraOMapa = /** @type {any[]} */ (prontos.filter(Boolean));
      for (const n of paraOMapa) n.opacity = 0;
      const ids = paraOMapa.length ? await mapa.addMarkers(paraOMapa) : [];
      validos.forEach(([k, m, a], i) => {
        const idNativo = ids?.[i] != null ? String(ids[i]) : null;
        // a lista pode ter mudado no meio: o que já entrou por outro caminho fica com o dele
        if (itens.has(k)) {
          if (idNativo) lixo.add(idNativo);
          return;
        }
        itens.set(k, { m, idNativo, assinatura: a, visivel: false, naLista: true });
        if (idNativo) porNativo.set(idNativo, k);
      });
      await esvaziarLixo();
    } catch {
      /* mapa fechado no meio */
    }
  };

  /**
   * Troca os marcadores de um grupo. Os pedidos que chegam juntos (no mesmo `MS_JUNTAR_GRUPOS`) vão numa troca só; um
   * pedido mais novo do mesmo grupo substitui o anterior que ainda não foi para o mapa.
   * @param {string} grupo @param {Marcador[]} lista
   */
  const definir = (grupo, lista) => {
    listas.set(grupo, lista);
    pendentes.set(grupo, lista);
    if (!agendada) {
      agendada = new Promise((r) => setTimeout(r, MS_JUNTAR_GRUPOS)).then(() => {
        agendada = null;
        const lote = new Map(pendentes);
        pendentes.clear();
        fila = fila.then(() => trocar(lote));
        return fila;
      });
    }
    return agendada;
  };

  /**
   * Refaz o grupo se o que muda de tamanho com o zoom (os nomes) mudou o bastante desde que ele foi posto.
   * @param {string} grupo
   */
  const revisarGrupo = (grupo) => {
    const lista = listas.get(grupo);
    const comEscala = lista ? lista.filter((m) => m.escala) : [];
    if (!lista || !comEscala.length) return;
    const antes = zoomDoGrupo.get(grupo);
    if (antes == null) return; // a primeira troca ainda não rodou: ela confere o zoom ao terminar
    const mudou = comEscala.some((m) => {
      const a = /** @type {any} */ (m.escala)(antes);
      const b = /** @type {any} */ (m.escala)(zoom);
      return a > 0 && Math.abs(b / a - 1) > DIFERENCA_REFAZER_NOME;
    });
    if (mudou) void definir(grupo, lista);
  };

  return {
    definir,
    /** O toque num marcador nativo: devolve o marcador (o clique é de quem chama). @param {string} idNativo */
    marcadorDoToque(idNativo) {
      const k = porNativo.get(String(idNativo));
      return k ? itens.get(k)?.m || null : null;
    },
    /**
     * O mapa parou num zoom: o que muda de tamanho com o zoom (os nomes) é refeito no tamanho dele, se mudou o bastante.
     * @param {number} z zoom do MapLibre
     */
    aoParar(z) {
      if (!Number.isFinite(z)) return;
      zoom = z;
      for (const grupo of listas.keys()) revisarGrupo(grupo);
    },
    /** Tira todos os marcadores. */
    async limpar() {
      vivo = false;
      if (esperaFrios) clearTimeout(esperaFrios);
      const ids = [...porNativo.keys(), ...lixo];
      lixo.clear();
      itens.clear();
      porNativo.clear();
      listas.clear();
      if (ids.length) await mapa.removeMarkers(ids).catch(() => {});
    },
  };
}
