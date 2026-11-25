import React, { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import MaikeToastCard from '@/components/common/MaikeToastCard';
import { useFilaDeEnvio } from '@/hooks/useFilaDeEnvio';
import { abrirDadosOffline } from '@/components/offline/DadosOffline';

const ID_DO_AVISO = 'maike-sincronizacao';
const ID_DA_ATENCAO = 'maike-sincronizacao-atencao';

/**
 * O cartão do sistema (o Toaster é `unstyled`), com id fixo: o "Enviando…"
 * vira "Tudo enviado" no mesmo lugar, sem empilhar.
 * @param {string} id
 * @param {'success'|'warning'|'info'} tom
 * @param {string} titulo
 * @param {string} descricao
 * @param {number} duracao
 * @param {(() => void) | null} [aoTocar]
 */
const mostrar = (id, tom, titulo, descricao, duracao, aoTocar = null) =>
  toast.custom(
    (t) => {
      const cartao = <MaikeToastCard tone={tom} title={titulo} description={descricao} onClose={() => toast.dismiss(t)} />;
      if (!aoTocar) return cartao;
      return (
        <div
          role="button"
          tabIndex={0}
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
 * D-PROD-301 — o aviso de quando o que foi feito sem internet sobe: só aparece
 * quando há algo para enviar e a internet está de volta. Nada de faixa "sem
 * internet": sem sinal, o app só guarda (o ícone do topo mostra o número).
 *
 *  - "Enviando 3 registro(s)…" enquanto sobe;
 *  - "Tudo enviado ao sistema" quando a fila esvazia;
 *  - "2 registro(s) precisam de atenção" (toque abre a sincronização) quando o sistema recusa algum.
 */
export default function AvisoDeSincronizacao() {
  const fila = useFilaDeEnvio();
  const noInicio = useRef(/** @type {number|null} */ (null));
  const mostrado = useRef(false);
  const espera = useRef(/** @type {ReturnType<typeof setTimeout>|null} */ (null));
  const atencaoAvisada = useRef(/** @type {number|null} */ (null));
  const aguardandoAgora = useRef(0);
  aguardandoAgora.current = fila.aguardando;

  useEffect(() => {
    if (!fila.carregado) return;
    if (fila.enviando) {
      if (noInicio.current !== null || fila.aguardando === 0) return;
      noInicio.current = fila.aguardando + fila.atencao;
      // A passada de rotina (a cada minuto) que não manda nada termina logo: sem aviso.
      espera.current = setTimeout(() => {
        mostrado.current = true;
        mostrar(ID_DO_AVISO, 'info', 'Sincronizando', `Enviando ${aguardandoAgora.current} registro(s) feitos sem internet…`, Infinity);
      }, 1200);
      return;
    }
    if (noInicio.current === null) return;
    if (espera.current) clearTimeout(espera.current);
    espera.current = null;
    // Enviado = saiu da fila (o recusado continua nela, em "precisa de atenção").
    const enviados = Math.max(0, noInicio.current - fila.aguardando - fila.atencao);
    noInicio.current = null;
    if (enviados > 0 && fila.aguardando === 0 && fila.atencao === 0) {
      mostrar(ID_DO_AVISO, 'success', 'Tudo enviado ao sistema', '', 3000);
    } else if (enviados > 0) {
      mostrar(ID_DO_AVISO, 'info', `${enviados} registro(s) enviados`, `${fila.aguardando} ainda esperando; saem sozinhos quando a internet firmar.`, 4000);
    } else if (mostrado.current) {
      // A passada parou sem conseguir (a rede caiu de novo): o resto sai na próxima, sem alarde.
      toast.dismiss(ID_DO_AVISO);
    }
    mostrado.current = false;
  }, [fila.enviando, fila.aguardando, fila.atencao, fila.carregado]);

  useEffect(() => () => {
    if (espera.current) clearTimeout(espera.current);
  }, []);

  useEffect(() => {
    if (!fila.carregado) return;
    // Na abertura só lembra quantos havia: avisa quando aparece um NOVO caso.
    if (atencaoAvisada.current !== null && fila.atencao > atencaoAvisada.current) {
      mostrar(
        ID_DA_ATENCAO,
        'warning',
        `${fila.atencao} registro(s) precisam de atenção`,
        'O sistema não aceitou. Toque para ver o motivo.',
        8000,
        abrirDadosOffline
      );
    }
    atencaoAvisada.current = fila.atencao;
  }, [fila.atencao, fila.carregado]);

  return null;
}
