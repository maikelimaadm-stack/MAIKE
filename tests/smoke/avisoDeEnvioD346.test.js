/**
 * D-PROD-346 — Fase 4 da sincronização: aviso de registros esperando envio com o app fechado (APK 1.0.5).
 *
 *  AE-01 com o plugin: a quantidade (aguardando + precisa de atenção) vai ao Android; só quando muda; na primeira
 *        pendência, pede a permissão de avisos; com a fila vazia, informa zero (o aviso sai)
 *  AE-02 sem o plugin (APK 1.0.4, iPhone, web): não liga nada e nunca lança
 *  AE-03 o pacote novo continua chegando ao APK 1.0.4: `nativoMinimo` 5 em app-version.json
 *  AE-04 a parte nativa: plugin registrado, permissão de avisos, trabalho periódico só com internet, aviso que abre o
 *        app e não toca de novo
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const plugin = { definirPendentes: vi.fn(async () => undefined), pedirPermissao: vi.fn(async () => ({ concedida: true })) };
let disponivel = true;
let fila = { aguardando: 0, atencao: 0 };

vi.mock('@capacitor/core', async (original) => ({
  ...(await original()),
  Capacitor: { isPluginAvailable: () => disponivel, isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => plugin,
}));
vi.mock('@/config/runtimeConfig', async (original) => ({ ...(await original()), isAppNativo: () => true }));
vi.mock('@/services/sincronizacaoService', () => ({
  lerFilaDeEnvio: async () => ({ ...fila, itens: [] }),
  eventosDaFilaDeEnvio: () => ['maike-fila-de-envio-teste'],
}));

beforeEach(async () => {
  disponivel = true;
  fila = { aguardando: 0, atencao: 0 };
  plugin.definirPendentes.mockClear();
  plugin.pedirPermissao.mockClear();
  (await import('@/lib/app/avisoDeEnvio')).resetAvisoDeEnvio();
});
afterEach(() => vi.useRealTimers());

describe('D-PROD-346 — aviso de envio pendente', () => {
  it('AE-01 informa a quantidade quando muda e pede a permissão na primeira pendência', async () => {
    const aviso = await import('@/lib/app/avisoDeEnvio');
    fila = { aguardando: 2, atencao: 1 };
    await aviso.informarPendentes();
    expect(plugin.definirPendentes).toHaveBeenLastCalledWith({ quantidade: 3 });
    expect(plugin.pedirPermissao).toHaveBeenCalledTimes(1);
    await aviso.informarPendentes();
    expect(plugin.definirPendentes).toHaveBeenCalledTimes(1); // não mudou: nada de novo
    fila = { aguardando: 0, atencao: 0 };
    await aviso.informarPendentes();
    expect(plugin.definirPendentes).toHaveBeenLastCalledWith({ quantidade: 0 });
    expect(plugin.pedirPermissao).toHaveBeenCalledTimes(1);
  });

  it('AE-01b liga uma vez e reage às mudanças da fila', async () => {
    vi.useFakeTimers();
    const aviso = await import('@/lib/app/avisoDeEnvio');
    fila = { aguardando: 1, atencao: 0 };
    aviso.ligarAvisoDeEnvio();
    aviso.ligarAvisoDeEnvio();
    await vi.advanceTimersByTimeAsync(2000);
    expect(plugin.definirPendentes).toHaveBeenLastCalledWith({ quantidade: 1 });
    fila = { aguardando: 4, atencao: 0 };
    window.dispatchEvent(new Event('maike-fila-de-envio-teste'));
    window.dispatchEvent(new Event('maike-fila-de-envio-teste'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(plugin.definirPendentes).toHaveBeenLastCalledWith({ quantidade: 4 });
    expect(plugin.definirPendentes).toHaveBeenCalledTimes(2);
  });

  it('AE-02 sem o plugin não liga nada', async () => {
    disponivel = false;
    const aviso = await import('@/lib/app/avisoDeEnvio');
    fila = { aguardando: 5, atencao: 0 };
    expect(aviso.avisoDeEnvioDisponivel()).toBe(false);
    aviso.ligarAvisoDeEnvio();
    await aviso.informarPendentes();
    expect(plugin.definirPendentes).not.toHaveBeenCalled();
  });

  it('AE-03 o pacote novo continua chegando ao APK 1.0.4', async () => {
    const versao = JSON.parse(readFileSync('app-version.json', 'utf8'));
    // D-PROD-366: o app passou a 1.0.6 (mapa nativo do Google); o pacote continua aceito pelo APK 1.0.4 (código 5).
    expect(versao.versionCode).toBeGreaterThanOrEqual(6);
    expect(versao.nativoMinimo).toBe(5);
    const { nativoMinimo } = await import('../../scripts/app/versao-do-pacote.mjs');
    expect(nativoMinimo()).toBe(5);
  });

  it('AE-04 a parte nativa do Android', () => {
    const pasta = 'android/app/src/main/java/com/makgestao/app';
    expect(readFileSync(`${pasta}/MainActivity.java`, 'utf8')).toMatch(/registerPlugin\(AvisoDeEnvioPlugin\.class\);\s*super\.onCreate/);
    const plugin = readFileSync(`${pasta}/AvisoDeEnvioPlugin.java`, 'utf8');
    expect(plugin).toMatch(/name = "AvisoDeEnvio"/);
    expect(plugin).toMatch(/NetworkType\.CONNECTED/);
    expect(plugin).toMatch(/15, TimeUnit\.MINUTES/);
    expect(plugin).toMatch(/cancelUniqueWork/);
    const trabalho = readFileSync(`${pasta}/AvisoDeEnvioWorker.java`, 'utf8');
    expect(trabalho).toMatch(/setOnlyAlertOnce\(true\)/);
    expect(trabalho).toMatch(/MainActivity\.class/);
    expect(trabalho).toMatch(/FORA_DE_USO_MS/);
    expect(readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')).toMatch(/android\.permission\.POST_NOTIFICATIONS/);
    expect(readFileSync('android/app/build.gradle', 'utf8')).toMatch(/androidx\.work:work-runtime:/);
  });
});
