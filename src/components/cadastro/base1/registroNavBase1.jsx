import React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { IconBtn } from "./Base1Ui";

/**
 * Navegação entre registros dentro do formulário (D-PROD-163, proposta 6.24 do design):
 * no desktop ‹ › fica na linha das abas, à direita; no tablet, numa linha própria acima das seções;
 * a faixa de cabeçalho do registro deixa de existir quando o formulário mostra a navegação.
 *
 * O chrome da lista fornece os dados (`info`) e fica sabendo, por `registrar`, que o formulário
 * já mostra a navegação — aí ele não desenha o cabeçalho antigo.
 */

/**
 * @typedef {{ index: number, total: number, onGo?: (index: number) => void, navDisabled?: boolean }} InfoDaNavegacao
 * @typedef {{ info: InfoDaNavegacao | null, registrar: () => () => void, navJaEntrou?: { current: boolean } }} ContextoDaNavegacao
 */

/** @type {React.Context<ContextoDaNavegacao | null>} */
export const RegistroNavContext = React.createContext(/** @type {ContextoDaNavegacao | null} */ (null));

/**
 * Avisa ao chrome que este formulário mostra a navegação (enquanto `ativo`) e devolve os dados dela.
 * @param {boolean} ativo
 * @returns {InfoDaNavegacao | null}
 */
export function useNavegacaoDoRegistro(ativo) {
  const ctx = React.useContext(RegistroNavContext);
  const registrar = ctx?.registrar;
  React.useLayoutEffect(() => {
    if (!ativo || !registrar) return undefined;
    return registrar();
  }, [ativo, registrar]);
  return ativo ? ctx?.info ?? null : null;
}

/**
 * Há o que navegar? (registro salvo, mais de um na lista)
 * @param {InfoDaNavegacao | null | undefined} info
 */
export const temNavegacao = (info) => Boolean(info && info.onGo && info.total > 1 && info.index >= 0);

/**
 * ‹‹ ‹ 3/12 › ›› — mesmos botões do cabeçalho antigo.
 * @param {{ info: InfoDaNavegacao | null }} props
 */
export function NavegacaoDoRegistro({ info }) {
  const marca = React.useContext(RegistroNavContext)?.navJaEntrou;
  const visivel = temNavegacao(info);
  // Entra deslizando (`mk-entra-lado`) só quando o registro abre. Trocar de registro remonta o formulário,
  // mas no design a navegação fica parada (D-PROD-164).
  const [entra] = React.useState(() => !marca?.current);
  React.useEffect(() => {
    if (visivel && marca) marca.current = true;
  }, [visivel, marca]);
  if (!visivel || !info || !info.onGo) return null;
  const { index, total, onGo, navDisabled = false } = info;
  const inicio = navDisabled || index <= 0;
  const fim = navDisabled || index >= total - 1;
  return (
    <span className={entra ? "b1-reg-nav" : "b1-reg-nav b1-reg-nav--fica"} data-testid="cadastro-record-nav">
      <IconBtn size="sm" aria-label="Primeiro registro" disabled={inicio} onClick={() => onGo(0)}>
        <ChevronsLeft className="h-4 w-4" />
      </IconBtn>
      <IconBtn size="sm" aria-label="Registro anterior" disabled={inicio} onClick={() => onGo(index - 1)}>
        <ChevronLeft className="h-4 w-4" />
      </IconBtn>
      <span className="mg-b1-record-nav">
        {index + 1}/{total}
      </span>
      <IconBtn size="sm" aria-label="Próximo registro" disabled={fim} onClick={() => onGo(index + 1)}>
        <ChevronRight className="h-4 w-4" />
      </IconBtn>
      <IconBtn size="sm" aria-label="Último registro" disabled={fim} onClick={() => onGo(total - 1)}>
        <ChevronsRight className="h-4 w-4" />
      </IconBtn>
    </span>
  );
}
