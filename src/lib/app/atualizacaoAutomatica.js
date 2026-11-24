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
    const info = await App.getInfo();
    if (Number(info.build) < Number(ultima.nativoMinimo || 0)) return 'nativo-antigo';
    const url = new URL(ultima.url, origem).toString();
    const pacote = await CapacitorUpdater.download({ url, version: String(ultima.versao), checksum: ultima.checksum || undefined });
    await CapacitorUpdater.next({ id: pacote.id });
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
  setTimeout(() => {
    conferirAtualizacao();
  }, 5000);
  App.addListener('resume', () => {
    conferirAtualizacao();
  }).catch(() => {});
};
