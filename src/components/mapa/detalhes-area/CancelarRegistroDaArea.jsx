import React from "react";
import { DialogoAcao } from "@/components/financeiroGestao/DialogosLancamento";
import { MOTIVO_MINIMO, LOCALE_ATIVIDADE, STATUS_ABERTA, STATUS_CONCLUIDA, formatarDiaAtividade } from "@/lib/lancamentoAtividadesRegras";

/*
 * "Cancelar registro" no Histórico da área (D-PROD-266, etapa 1): o MESMO cancelamento do apontamento do Lançamento de
 * Atividades ("Cancelar lançamento", POST /atividades/:id/apontamentos/:apontamentoId/cancelar), levado ao cartão da
 * linha do tempo. Nada de backend novo, nada de fila offline: o cancelamento é só online.
 *
 * Mesmas condições do "Cancelar lançamento" (ListaApontamentos): a ação extra `cancelar_apontamento` da tela
 * `op-atividades`, o fuso da fazenda configurado, a atividade ABERTA e o apontamento CONFIRMADO (relido no servidor,
 * com a `versao` do CAS, antes de abrir o diálogo). Quem bloqueia de fato é o servidor.
 *
 * Marcação, no pé do cartão (`acoes` da LinhaDoTempo, div.mk-dp-tl__acoes):
 *   div.mk-dp-hist__excluir[data-estado-exclusao] > div > button + p (motivo de estar desligado)
 * As classes são as do pé de ações do v12 (src/styles/mk-dp-tl-acoes.css): botão compacto, vermelho quando liberado.
 */

/** Formatação das mensagens do diálogo de ação (não há dinheiro neste diálogo). */
const CONTEXTO_MENSAGENS = Object.freeze({ locale: LOCALE_ATIVIDADE, moeda: "BRL", casas: 2 });

/** `navigator.onLine` agora (sem navegador: online). */
export const estaOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/** `navigator.onLine`, acompanhando os eventos online/offline. */
export const useEstaOnline = () => {
  const [online, setOnline] = React.useState(estaOnline());
  React.useEffect(() => {
    const atualizar = () => setOnline(estaOnline());
    window.addEventListener("online", atualizar);
    window.addEventListener("offline", atualizar);
    return () => {
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
    };
  }, []);
  return online;
};

export const TEXTO_SEM_CONEXAO = "Sem conexão: o cancelamento só é feito online e não entra na fila offline.";
export const TEXTO_SEM_FUSO = "Configure o fuso horário da fazenda (Empresa → Fuso horário) para cancelar: o servidor recusa sem ele.";
export const TEXTO_ATIVIDADE_CONCLUIDA = "Atividade concluída: para cancelar este registro, reabra a atividade no Lançamento de Atividades.";

/**
 * O estado da ação de um cartão. `null` = não há o que mostrar (sem permissão, atividade ainda não lida ou cancelada).
 * @param {{ permitido: boolean, semFuso: boolean, fusoOk: boolean, online: boolean, statusAtividade: string|null|undefined }} c
 * @returns {{ habilitado: boolean, motivo: string|null } | null}
 */
export const estadoDoCancelamento = ({ permitido, semFuso, fusoOk, online, statusAtividade }) => {
  if (!permitido) return null;
  if (semFuso) return { habilitado: false, motivo: TEXTO_SEM_FUSO };
  if (!fusoOk) return null;
  if (!online) return { habilitado: false, motivo: TEXTO_SEM_CONEXAO };
  if (statusAtividade === STATUS_ABERTA) return { habilitado: true, motivo: null };
  if (statusAtividade === STATUS_CONCLUIDA) return { habilitado: false, motivo: TEXTO_ATIVIDADE_CONCLUIDA };
  return null;
};

/** "Gradeação de 17/11/2026": o registro de que o botão e o diálogo falam. @param {Record<string, any>|null|undefined} registro */
export const descreverRegistro = (registro) => {
  const dia = formatarDiaAtividade(registro?.data_operacional);
  const nome = String(registro?.tipo_atividade_nome ?? "").trim() || "Registro";
  return `${nome}${dia ? ` de ${dia}` : ""}`;
};

/**
 * O botão no pé do cartão. O nome acessível diz de qual registro se trata (vários cartões têm o mesmo botão) e, desligado,
 * o motivo fica ligado ao botão por `aria-describedby`.
 * @param {{ registroId: string, descricao: string, estado: { habilitado: boolean, motivo: string|null }, conferindo?: boolean, onClick: () => void }} props
 */
export function BotaoCancelarRegistro({ registroId, descricao, estado, conferindo = false, onClick }) {
  const idMotivo = React.useId();
  const habilitado = estado.habilitado && !conferindo;
  return (
    <div className="mk-dp-hist__excluir" data-estado-exclusao={estado.habilitado ? "elegivel" : "indisponivel"} data-testid={`registro-${registroId}-cancelar-acao`}>
      <div>
        <button
          type="button"
          disabled={!habilitado}
          aria-busy={conferindo || undefined}
          aria-label={`Cancelar registro: ${descricao}`}
          aria-describedby={estado.motivo ? idMotivo : undefined}
          onClick={onClick}
          data-testid={`registro-${registroId}-cancelar`}
        >
          {conferindo ? "Conferindo..." : "Cancelar registro"}
        </button>
        {estado.motivo ? <p id={idMotivo}>{estado.motivo}</p> : null}
      </div>
    </div>
  );
}

/**
 * O diálogo de motivo (o `DialogoAcao` da tela de atividades, na janela do Base1).
 * @param {{ registro: Record<string, any>, online: boolean, onFechar: () => void, onEnviar: (motivo: string) => Promise<unknown>, onConsultar: () => void }} props
 */
export function DialogoCancelarRegistro({ registro, online, onFechar, onEnviar, onConsultar }) {
  return (
    <DialogoAcao
      aberto
      janelaBase1
      titulo={`Cancelar registro: ${descreverRegistro(registro)}`}
      descricao={`O registro fica no Lançamento de Atividades como cancelado e sai deste histórico. Motivo com pelo menos ${MOTIVO_MINIMO} caracteres.`}
      conteudo={
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="m-0 break-words">
            Cancela só o registro desta área. Os produtos usados voltam ao estoque na data de hoje e os abastecimentos ligados a ele são cancelados.
            Se o mesmo serviço foi registrado em outras áreas, os registros delas continuam.
          </p>
          {online ? null : (
            <p role="alert" className="m-0 break-words text-amber-800">
              {TEXTO_SEM_CONEXAO}
            </p>
          )}
        </div>
      }
      rotuloBotao="Cancelar registro"
      testId="dialogo-cancelar-registro-area"
      contexto={CONTEXTO_MENSAGENS}
      onFechar={onFechar}
      onEnviar={onEnviar}
      onConsultar={onConsultar}
    />
  );
}
