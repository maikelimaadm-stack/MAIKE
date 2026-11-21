import React from "react";
import { DialogoAcao } from "@/components/financeiroGestao/DialogosLancamento";
import { lerErroGestao } from "@/lib/gestaoErros";
import {
  MOTIVO_MINIMO,
  LOCALE_ATIVIDADE,
  STATUS_ABERTA,
  STATUS_CANCELADA,
  STATUS_CANCELADO,
  STATUS_CONCLUIDA,
  formatarDiaAtividade,
  mensagemDeErroAtividade,
} from "@/lib/lancamentoAtividadesRegras";

/*
 * "Excluir registro" no Histórico da área (D-PROD-266, etapa 1): por baixo, o MESMO cancelamento do apontamento do
 * Lançamento de Atividades (POST /atividades/:id/apontamentos/:apontamentoId/cancelar), levado ao cartão da linha do
 * tempo. Nada de backend novo, nada de fila offline: a exclusão é só online.
 *
 * Texto visível (pedido do proprietário: "não tenho cancelamentos, tenho exclusão"): no mapa a pessoa só vê EXCLUSÃO —
 * botão, título, confirmar, avisos e recusas dizem "excluir"/"excluído", e o registro excluído some do histórico. Rota,
 * códigos de erro, chaves de permissão e nomes de arquivo/função seguem os do cancelamento (nada muda no servidor).
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

export const TEXTO_SEM_CONEXAO = "Sem conexão: a exclusão só é feita online e não entra na fila offline.";
export const TEXTO_SEM_FUSO = "Configure o fuso horário da fazenda (Empresa → Fuso horário) para excluir: o servidor recusa sem ele.";
export const TEXTO_ATIVIDADE_CONCLUIDA = "Atividade concluída: para excluir este registro, reabra a atividade no Lançamento de Atividades.";

export const TEXTO_JA_EXCLUIDO = "Este registro já foi excluído. Nada foi alterado.";
export const TEXTO_STATUS_SEM_EXCLUSAO = "Este registro não pode ser excluído no status atual. Nada foi alterado.";
export const TEXTO_FALHA_NA_EXCLUSAO = "Não foi possível excluir o registro. Nada foi alterado.";

/** Texto que fala em cancelar/cancelamento/estorno (o mapa só fala em exclusão). */
const VOCABULARIO_DE_CANCELAMENTO = /cancel|estorn/i;

/**
 * A recusa diz que o apontamento já está CANCELADO no servidor, isto é, o registro já foi excluído (por outra pessoa ou
 * por um envio anterior): a tela o tira do histórico na hora, sem pedir para abrir a exclusão de novo.
 * @param {unknown} erro
 */
export const ehRegistroJaExcluido = (erro) => {
  const { code, details } = lerErroGestao(erro);
  return code === "ATIVIDADE_STATUS_INVALIDO" && details.entidade !== "area" && details.status === STATUS_CANCELADO;
};

/**
 * A recusa do servidor no vocabulário da exclusão. Os códigos cujo texto comum (`mensagemDeErroAtividade`, o do
 * Lançamento de Atividades) fala em "cancelar"/"cancelado"/"estorno" ganham frase própria; o resto é a frase comum,
 * desde que ela não fale em cancelamento/estorno. Se falar (qualquer código, inclusive os do catálogo geral), sai a
 * frase de exclusão: a do status para `ATIVIDADE_STATUS_INVALIDO`, senão o `fallback`.
 * @param {unknown} erro @param {string} fallback
 */
export const mensagemDeErroDaExclusao = (erro, fallback) => {
  const { code, details } = lerErroGestao(erro);
  if (ehRegistroJaExcluido(erro)) return TEXTO_JA_EXCLUIDO;
  if (code === "ATIVIDADE_STATUS_INVALIDO" && details.entidade !== "area") {
    if (details.status === STATUS_CONCLUIDA) return `${TEXTO_ATIVIDADE_CONCLUIDA} Nada foi alterado.`;
    if (details.status === STATUS_CANCELADA) return "Este registro não pode ser excluído porque a atividade não está mais aberta no Lançamento de Atividades. Nada foi alterado.";
    if (!details.status) return "Este registro não pode ser excluído porque a atividade não está aberta. Nada foi alterado.";
  }
  if (code === "ATIVIDADE_ESTORNO_BLOQUEADO") {
    return "Este registro não pode ser excluído porque o lote de onde o produto saiu já foi consumido, transferido ou mudou. Nada foi alterado.";
  }
  const comum = mensagemDeErroAtividade(erro, fallback);
  if (!VOCABULARIO_DE_CANCELAMENTO.test(comum)) return comum;
  if (code === "ATIVIDADE_STATUS_INVALIDO") return TEXTO_STATUS_SEM_EXCLUSAO;
  return VOCABULARIO_DE_CANCELAMENTO.test(fallback) ? TEXTO_FALHA_NA_EXCLUSAO : fallback;
};

/**
 * O estado da ação de um cartão. `null` = não há o que mostrar (sem permissão, atividade ainda não lida ou encerrada).
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
          aria-label={`Excluir registro: ${descricao}`}
          aria-describedby={estado.motivo ? idMotivo : undefined}
          onClick={onClick}
          data-testid={`registro-${registroId}-cancelar`}
        >
          {conferindo ? "Conferindo..." : "Excluir registro"}
        </button>
        {estado.motivo ? <p id={idMotivo}>{estado.motivo}</p> : null}
      </div>
    </div>
  );
}

/**
 * A recusa mostrada DENTRO do diálogo, no vocabulário da exclusão (nunca cancelamento/estorno). A queda de conexão antes
 * do envio (`SEM_CONEXAO`, nada saiu) diz isso.
 * @param {unknown} erro
 */
export const mensagemDoErroNoDialogo = (erro) =>
  /** @type {any} */ (erro)?.code === "SEM_CONEXAO" ? TEXTO_SEM_CONEXAO : mensagemDeErroDaExclusao(erro, TEXTO_FALHA_NA_EXCLUSAO);

/** Texto que pode aparecer no histórico do mapa (sem cancelar/estorno), senão o `fallback`. @param {string} texto @param {string} fallback */
export const textoSemCancelamento = (texto, fallback) => (VOCABULARIO_DE_CANCELAMENTO.test(texto) ? fallback : texto);

/**
 * O diálogo de motivo (o `DialogoAcao` da tela de atividades, na janela do Base1), no vocabulário da exclusão: a recusa
 * dentro do diálogo (`mensagemDoErro`), o botão durante o envio ("Excluindo...") e o rótulo do motivo.
 * @param {{ registro: Record<string, any>, online: boolean, onFechar: () => void, onEnviar: (motivo: string) => Promise<unknown>, onConsultar: () => void }} props
 */
export function DialogoCancelarRegistro({ registro, online, onFechar, onEnviar, onConsultar }) {
  return (
    <DialogoAcao
      aberto
      janelaBase1
      titulo={`Excluir registro: ${descreverRegistro(registro)}`}
      descricao={`O registro excluído sai deste histórico. Motivo da exclusão com pelo menos ${MOTIVO_MINIMO} caracteres.`}
      conteudo={
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="m-0 break-words">
            Exclui só o registro desta área. Os produtos usados voltam ao estoque na data de hoje e os abastecimentos ligados a ele também são excluídos.
            Se o mesmo serviço foi registrado em outras áreas, os registros delas continuam.
          </p>
          {online ? null : (
            <p role="alert" className="m-0 break-words text-amber-800">
              {TEXTO_SEM_CONEXAO}
            </p>
          )}
        </div>
      }
      rotuloBotao="Excluir registro"
      rotuloEnviando="Excluindo..."
      rotuloMotivo="Motivo da exclusão"
      mensagemDoErro={mensagemDoErroNoDialogo}
      testId="dialogo-cancelar-registro-area"
      contexto={CONTEXTO_MENSAGENS}
      onFechar={onFechar}
      onEnviar={onEnviar}
      onConsultar={onConsultar}
    />
  );
}
