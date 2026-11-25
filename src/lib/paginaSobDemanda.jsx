import React, { Suspense, lazy } from 'react';

/** Já tentou recarregar a página por causa de um pedaço que não carregou (uma vez por sessão). */
const CHAVE_RECARGA = 'maike_recarga_por_tela';

/**
 * D-PROD-304 — tela carregada só quando aberta (`React.lazy`), já com o
 * `Suspense` em volta: quem usa continua tratando como um componente comum.
 *
 * No site, depois de publicar uma versão nova, o pedaço antigo de uma tela pode
 * não existir mais no servidor: recarrega a página UMA vez (pega a versão nova).
 * No app Android/iOS os pedaços estão dentro do pacote (abrem sem internet).
 *
 * @param {() => Promise<{ default: React.ComponentType<any> }>} carregar
 * @returns {React.ComponentType<any>}
 */
export const paginaSobDemanda = (carregar) =>
  componenteSobDemanda(carregar, {
    fallback: (
      <div className="flex h-full min-h-[40vh] w-full items-center justify-center text-sm text-slate-400" role="status">
        Carregando…
      </div>
    ),
  });

/**
 * O mesmo, para uma janela ou painel que só abre com um toque (ex.: os detalhes
 * do Mapa Geral): sem nada na tela enquanto carrega (é um instante).
 *
 * @param {() => Promise<{ default: React.ComponentType<any> }>} carregar
 * @param {{ fallback?: React.ReactNode }} [opcoes]
 * @returns {React.ComponentType<any>}
 */
export const componenteSobDemanda = (carregar, { fallback = null } = {}) => {
  const Tela = lazy(() =>
    carregar().catch((erro) => {
      let jaRecarregou = false;
      try {
        jaRecarregou = window.sessionStorage.getItem(CHAVE_RECARGA) === '1';
        if (!jaRecarregou) window.sessionStorage.setItem(CHAVE_RECARGA, '1');
      } catch {
        jaRecarregou = true;
      }
      if (!jaRecarregou && typeof window !== 'undefined' && navigator.onLine !== false) {
        window.location.reload();
        return new Promise(() => {});
      }
      throw erro;
    })
  );
  /** @param {any} props */
  const ComCarregando = (props) => (
    <Suspense fallback={fallback}>
      <Tela {...props} />
    </Suspense>
  );
  // Quem precisa da tela de verdade (teste, pré-carga) chama `carregar()`.
  ComCarregando.carregar = carregar;
  return ComCarregando;
};
