import React, { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import MaikeToastCard from '@/components/common/MaikeToastCard';
import { aplicarVersaoBaixada, EVENTO_APP_ATUALIZADO, EVENTO_VERSAO_BAIXADA, pegarAvisoDeAtualizacao, versaoBaixadaEsperando } from '@/lib/app/atualizacaoAutomatica';

const ID_BAIXADA = 'maike-versao-baixada';
const ID_ATUALIZADO = 'maike-app-atualizado';

/** O mesmo cartão do sistema (o Toaster é `unstyled`), com id fixo para não empilhar. */
const mostrar = (id, tom, titulo, descricao, duracao, aoTocar = null) =>
  toast.custom(
    (t) => {
      const cartao = <MaikeToastCard tone={tom} title={titulo} description={descricao} onClose={() => toast.dismiss(t)} />;
      if (!aoTocar) return cartao;
      return (
        <div
          role="button"
          tabIndex={0}
          data-testid="aviso-versao-atualizar"
          onClick={() => {
            toast.dismiss(t);
            aoTocar();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              toast.dismiss(t);
              aoTocar();
            }
          }}
        >
          {cartao}
        </div>
      );
    },
    { id, position: 'top-right', duration: duracao, unstyled: true, className: 'mg-toast-host' }
  );

/**
 * D-PROD-304 — a pessoa fica sabendo da atualização do app:
 *  - versão nova baixada: "Versão nova pronta — toque para atualizar agora (ou ela
 *    entra na próxima vez que abrir o app)"; tocar troca na hora;
 *  - ao abrir com a versão nova: "App atualizado".
 * Um aviso por versão (o mesmo id não empilha).
 */
export default function AvisoDeVersao() {
  const avisadas = useRef(new Set());

  useEffect(() => {
    const baixada = (/** @type {any} */ e) => {
      const versao = e?.detail?.versao;
      if (!versao || avisadas.current.has(versao)) return;
      avisadas.current.add(versao);
      mostrar(
        ID_BAIXADA,
        'info',
        'Versão nova do app pronta',
        'Toque aqui para atualizar agora. Ou ela entra sozinha na próxima vez que abrir o app.',
        15000,
        () => {
          void aplicarVersaoBaixada();
        }
      );
    };
    const atualizado = () => {
      pegarAvisoDeAtualizacao();
      mostrar(ID_ATUALIZADO, 'success', 'App atualizado', 'Você já está usando a versão nova.', 8000);
    };
    window.addEventListener(EVENTO_VERSAO_BAIXADA, baixada);
    window.addEventListener(EVENTO_APP_ATUALIZADO, atualizado);
    // O aviso pode ter chegado antes desta tela montar (abertura do app, login): mostra agora.
    if (pegarAvisoDeAtualizacao()) atualizado();
    const esperando = versaoBaixadaEsperando();
    if (esperando) baixada({ detail: esperando });
    return () => {
      window.removeEventListener(EVENTO_VERSAO_BAIXADA, baixada);
      window.removeEventListener(EVENTO_APP_ATUALIZADO, atualizado);
    };
  }, []);

  return null;
}
