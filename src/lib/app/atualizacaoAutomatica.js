/**
 * Atualização automática do app Android/iOS (D-PROD-294).
 *
 * O APK traz o frontend dentro dele; versões novas do frontend chegam sem
 * instalar APK de novo:
 *  1. ao abrir e ao voltar para a frente, com internet, lê
 *     `<servidor>/app-atualizacao/ultima.json` (publicado a cada build da Vercel);
 *  2. versão diferente da carregada, e o APK instalado é novo o bastante
 *     (`nativoMinimo` <= versionCode), baixa o pacote por baixo (conferindo o
 *     sha256) e deixa marcado para a PRÓXIMA abertura — nunca troca a tela no
 *     meio do uso;
 *  3. ao abrir, avisa o plugin que o pacote carregou (`notifyAppReady`); se um
 *     pacote novo quebrar antes disso, o plugin volta sozinho ao anterior.
 *
 * Plugin: `@capgo/capacitor-updater`, modo manual, sem servidor da Capgo
 * (estatística e canais desligados em `capacitor.config.json`).
 */
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { App } from '@capacitor/app';
import { getOrigemDasAtualizacoesDoApp, isAppNativo } from '@/config/runtimeConfig';

let conferindo = false;
let iniciado = false;

/**
 * D-PROD-304 — a pessoa fica sabendo da atualização:
 *  - `EVENTO_VERSAO_BAIXADA` (detalhe `{ versao, id }`): versão nova baixada, entra
 *    na próxima abertura (ou já, com `aplicarVersaoBaixada`);
 *  - `EVENTO_APP_ATUALIZADO` (detalhe `{ versao }`): este pacote é novo neste celular.
 */
export const EVENTO_VERSAO_BAIXADA = 'maike:versao-baixada';
export const EVENTO_APP_ATUALIZADO = 'maike:app-atualizado';
const CHAVE_EM_USO = 'maike_app_versao_em_uso';
const CHAVE_BAIXADA = 'maike_app_versao_baixada';

/** @param {string} chave */
const lerLocal = (chave) => {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
};
/** @param {string} chave @param {string|null} valor */
const gravarLocal = (chave, valor) => {
  try {
    if (valor === null) window.localStorage.removeItem(chave);
    else window.localStorage.setItem(chave, valor);
  } catch {
    // sem armazenamento: só não lembra
  }
};
/** @param {string} nome @param {Record<string, unknown>} detalhe */
const avisar = (nome, detalhe) => {
  try {
    window.dispatchEvent(new CustomEvent(nome, { detail: detalhe }));
  } catch {
    // sem window: nada a avisar
  }
};

/** Versão baixada esperando a próxima abertura (para a tela mostrar de novo), ou `null`. */
export const versaoBaixadaEsperando = () => {
  try {
    const v = JSON.parse(lerLocal(CHAVE_BAIXADA) || 'null');
    return v && typeof v.versao === 'string' && typeof v.id === 'string' ? v : null;
  } catch {
    return null;
  }
};

/** "Atualizar agora": troca para a versão baixada na hora (o app recarrega). */
export const aplicarVersaoBaixada = async () => {
  const baixada = versaoBaixadaEsperando();
  if (!baixada) return false;
  try {
    await CapacitorUpdater.set({ id: baixada.id });
    return true;
  } catch {
    return false;
  }
};

/**
 * Versão do app para mostrar (menu): a do APK (`versionName`) e a do pacote
 * carregado (commit). Fora do app nativo: `null`.
 * @returns {Promise<{ apk: string|null, pacote: string|null }|null>}
 */
export const versaoDoApp = async () => {
  if (!isAppNativo()) return null;
  let apk = null;
  try {
    apk = (await App.getInfo())?.version ?? null;
  } catch {
    apk = null;
  }
  return { apk, pacote: await versaoCarregada() };
};

/**
 * Ao abrir: este pacote é diferente do que estava em uso neste celular? Avisa
 * uma vez ("App atualizado") e esquece a versão baixada que já entrou.
 */
/** Aviso "App atualizado" que ainda não foi mostrado (a tela pode montar depois). */
let atualizacaoPorAvisar = /** @type {{ versao: string }|null} */ (null);

/** A tela pega (uma vez) o "App atualizado" que chegou antes de ela montar. */
export const pegarAvisoDeAtualizacao = () => {
  const aviso = atualizacaoPorAvisar;
  atualizacaoPorAvisar = null;
  return aviso;
};

const conferirSeAtualizou = async () => {
  const atual = await versaoCarregada();
  if (!atual) return;
  const anterior = lerLocal(CHAVE_EM_USO);
  gravarLocal(CHAVE_EM_USO, atual);
  if (versaoBaixadaEsperando()?.versao === atual) gravarLocal(CHAVE_BAIXADA, null);
  // Sem registro anterior (a 1ª versão com o aviso, ou app recém-instalado) também avisa:
  // a pessoa precisa ver que a atualização entrou.
  if (anterior === atual) return;
  atualizacaoPorAvisar = { versao: atual };
  avisar(EVENTO_APP_ATUALIZADO, { versao: atual });
};

const semInternet = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Versão do pacote carregado agora (gravada no build em `app-versao.json`). */
const versaoCarregada = async () => {
  try {
    const r = await fetch('/app-versao.json', { cache: 'no-store' });
    return r.ok ? (await r.json())?.versao ?? null : null;
  } catch {
    return null;
  }
};

/**
 * Confere e, se houver versão nova, baixa e deixa para a próxima abertura.
 * Nunca lança: falhar aqui só adia a atualização.
 *
 * @returns {Promise<'atual'|'baixada'|'sem-internet'|'nativo-antigo'|'falhou'>}
 */
export const conferirAtualizacao = async () => {
  const origem = getOrigemDasAtualizacoesDoApp();
  if (!origem || conferindo) return 'atual';
  if (semInternet()) return 'sem-internet';
  conferindo = true;
  try {
    const resposta = await fetch(`${origem}/app-atualizacao/ultima.json`, { cache: 'no-store' });
    if (!resposta.ok) return 'falhou';
    const ultima = await resposta.json();
    if (!ultima?.versao || !ultima?.url) return 'falhou';
    if (ultima.versao === (await versaoCarregada())) return 'atual';
    // Já baixada, esperando a próxima abertura: não baixa de novo; só lembra a pessoa.
    const esperando = versaoBaixadaEsperando();
    if (esperando?.versao === String(ultima.versao)) {
      avisar(EVENTO_VERSAO_BAIXADA, esperando);
      return 'baixada';
    }
    const info = await App.getInfo();
    if (Number(info.build) < Number(ultima.nativoMinimo || 0)) return 'nativo-antigo';
    const url = new URL(ultima.url, origem).toString();
    const pacote = await CapacitorUpdater.download({ url, version: String(ultima.versao), checksum: ultima.checksum || undefined });
    await CapacitorUpdater.next({ id: pacote.id });
    gravarLocal(CHAVE_BAIXADA, JSON.stringify({ versao: String(ultima.versao), id: pacote.id }));
    avisar(EVENTO_VERSAO_BAIXADA, { versao: String(ultima.versao), id: pacote.id });
    return 'baixada';
  } catch {
    return 'falhou';
  } finally {
    conferindo = false;
  }
};

/** Liga a atualização automática (uma vez). Fora do app nativo não faz nada. */
export const iniciarAtualizacaoAutomatica = () => {
  if (iniciado || !isAppNativo()) return;
  iniciado = true;
  // Primeiro: este pacote abriu. Sem isso o plugin volta ao anterior.
  CapacitorUpdater.notifyAppReady().catch(() => {});
  // D-PROD-304: dá tempo da tela montar (quem mostra o aviso escuta o evento).
  setTimeout(() => {
    conferirSeAtualizou();
  }, 2500);
  setTimeout(() => {
    conferirAtualizacao();
  }, 5000);
  App.addListener('resume', () => {
    conferirAtualizacao();
  }).catch(() => {});
};
