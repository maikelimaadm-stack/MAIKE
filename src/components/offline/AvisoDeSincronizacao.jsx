import React, { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import MaikeToastCard from '@/components/common/MaikeToastCard';
import { useFilaDeEnvio } from '@/hooks/useFilaDeEnvio';
import { abrirDadosOffline } from '@/components/offline/DadosOffline';
import { lerProgressoDaSincronia } from '@/services/sincronizacaoCompletaService';

/** D-PROD-329: com o círculo da sincronização na tela, ele já mostra o andamento (sem aviso em dobro). */
const circuloNaTela = () => {
  const p = lerProgressoDaSincronia();
  return p.ativo && p.visivel;
};

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
 *  - D-PROD-380: nada enquanto sobe (antes, "Sincronizando — Enviando 3 registro(s)…" parado na tela): o ícone do
 *    topo mostra o número e gira;
 *  - "Tudo enviado ao sistema" quando a fila esvazia (só se algo feito sem internet subiu);
 *  - "2 registro(s) precisam de atenção" (toque abre a sincronização) quando o sistema recusa algum.
 */
export default function AvisoDeSincronizacao() {
  const fila = useFilaDeEnvio();
  const noInicio = useRef(/** @type {number|null} */ (null));
  const atencaoAvisada = useRef(/** @type {number|null} */ (null));

  useEffect(() => {
    if (!fila.carregado) return;
    if (fila.enviando) {
      if (noInicio.current !== null || fila.aguardando === 0) return;
      noInicio.current = fila.aguardando + fila.atencao;
      return;
    }
    if (noInicio.current === null) return;
    // Enviado = saiu da fila (o recusado continua nela, em "precisa de atenção").
    const enviados = Math.max(0, noInicio.current - fila.aguardando - fila.atencao);
    noInicio.current = null;
    if (circuloNaTela()) {
      // O círculo mostrou o envio: nada a avisar aqui (a atenção tem o aviso dela, abaixo).
    } else if (enviados > 0 && fila.aguardando === 0 && fila.atencao === 0) {
      mostrar(ID_DO_AVISO, 'success', 'Tudo enviado ao sistema', '', 3000);
    } else if (enviados > 0) {
      mostrar(ID_DO_AVISO, 'info', `${enviados} registro(s) enviados`, `${fila.aguardando} ainda esperando; saem sozinhos quando a internet firmar.`, 4000);
    }
    // Parou sem enviar nada (a rede caiu de novo): o resto sai na próxima, sem alarde.
  }, [fila.enviando, fila.aguardando, fila.atencao, fila.carregado]);

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
