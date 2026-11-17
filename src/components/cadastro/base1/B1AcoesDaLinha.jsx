import React from "react";
import { ChevronDown, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";
import { B1Popover } from "./Base1Ui";

/**
 * Botão ⚡ das ações da LINHA (D-PROD-232): o raio e a setinha, na célula de seleção da grade (ao lado da caixa de
 * marcar) e no topo do card. O desenho é o do protótipo do proprietário (`.b1-raio`), com as cores do sistema.
 *
 * @typedef {import('react').ComponentPropsWithoutRef<'button'> & { rotulo?: string }} B1BotaoAcoesDaLinhaProps
 * @type {import('react').ForwardRefRenderFunction<HTMLButtonElement, B1BotaoAcoesDaLinhaProps>}
 */
const BotaoRender = ({ rotulo = "Ações", className, ...p }, ref) => (
  <button ref={ref} type="button" aria-label={rotulo} title={rotulo} aria-haspopup="menu" className={cn("b1-raio", className)} {...p}>
    <Zap size={13} strokeWidth={2} aria-hidden />
    <ChevronDown size={11} strokeWidth={2} aria-hidden />
  </button>
);
export const B1BotaoAcoesDaLinha = React.forwardRef(BotaoRender);
B1BotaoAcoesDaLinha.displayName = "B1BotaoAcoesDaLinha";

/**
 * @typedef {{ key: string, label: string, icon?: import('react').ReactNode, danger?: boolean, disabled?: boolean, onSelect: () => void }} ItemDasAcoesDaLinha
 */

/**
 * Menu das ações de UMA linha (D-PROD-232), aberto pelo ⚡: no computador, a janela presa ao botão (o `B1Popover` do
 * motor); no celular, a folha de baixo (`MobileSheet`). Cabeçalho opcional (título e uma linha de apoio) e os grupos
 * separados por divisória; grupo vazio não aparece. Teclado: o botão diz se está aberto (`aria-expanded`), Esc fecha,
 * ↑ ↓ andam pelos itens e o foco volta ao botão ao fechar. Quem escolhe o que entra (permissão, status) é a tela.
 *
 * @param {{
 *   rotulo: string,
 *   titulo?: string,
 *   subtitulo?: string,
 *   grupos: ItemDasAcoesDaLinha[][],
 *   testId?: string,
 * }} props
 */
export function B1MenuAcoesDaLinha({ rotulo, titulo = "", subtitulo = "", grupos, testId = undefined }) {
  const celular = useCelular();
  const [aberto, setAberto] = React.useState(false);
  const botaoRef = React.useRef(/** @type {HTMLButtonElement | null} */ (null));
  const menuRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const cheios = grupos.filter((g) => g.length > 0);

  // Folha do celular: ao abrir, o foco vai ao primeiro item (a janela do computador já faz isso sozinha).
  React.useEffect(() => {
    if (!aberto || !celular) return;
    const t = window.setTimeout(() => /** @type {HTMLElement | null | undefined} */ (menuRef.current?.querySelector("[role='menuitem']:not(:disabled)"))?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [aberto, celular]);

  const fecharFolha = () => {
    setAberto(false);
    botaoRef.current?.focus();
  };

  /** @param {ItemDasAcoesDaLinha} item */
  const escolher = (item) => {
    setAberto(false);
    // O foco volta ao botão ANTES da ação: a janela que a ação abrir pega o foco depois.
    botaoRef.current?.focus();
    item.onSelect();
  };

  /** ↑ ↓ Home End entre os itens. @param {React.KeyboardEvent<HTMLDivElement>} e */
  const andar = (e) => {
    const itens = /** @type {HTMLElement[]} */ (Array.from(menuRef.current?.querySelectorAll("[role='menuitem']:not(:disabled)") ?? []));
    if (!itens.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = itens.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    const proximo =
      e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : e.key === "ArrowDown" ? (i + 1) % itens.length : (i - 1 + itens.length) % itens.length;
    itens[proximo]?.focus();
  };

  const menu = (
    <div ref={menuRef} role="menu" aria-label={rotulo} className="cadastro-b1 b1-acoes-linha" data-testid={testId ? `${testId}-menu` : undefined} onKeyDown={andar}>
      {titulo && !celular ? (
        <div className="b1-acoes-linha__cab">
          <p className="b1-acoes-linha__titulo">{titulo}</p>
          {subtitulo ? <p className="b1-acoes-linha__sub">{subtitulo}</p> : null}
        </div>
      ) : null}
      {cheios.map((grupo, g) => (
        <div key={g} role="group" className="b1-acoes-linha__grupo">
          {grupo.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cn("mg-b1-menuitem", item.danger && "is-danger")}
              data-acao={item.key}
              onClick={() => escolher(item)}
            >
              {item.icon ? (
                <span className="b1-acoes-linha__icone" aria-hidden>
                  {item.icon}
                </span>
              ) : null}
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  const botao = (
    <B1BotaoAcoesDaLinha
      ref={botaoRef}
      rotulo={rotulo}
      aria-expanded={aberto}
      data-testid={testId}
      onClick={celular ? () => setAberto(true) : undefined}
    />
  );

  if (celular) {
    return (
      <>
        {botao}
        {aberto ? (
          <MobileSheet
            open
            onClose={fecharFolha}
            label={rotulo}
            // Na folha, o cabeçalho do menu vai no título da própria folha (e a linha de apoio logo abaixo).
            title={titulo || rotulo}
            aside={subtitulo ? <p className="b1-acoes-linha-folha__sub">{subtitulo}</p> : null}
            // Muitos itens: a folha já abre grande, para o último (Cancelar) não ficar escondido.
            initialLarge={cheios.reduce((n, g) => n + g.length, 0) > 10}
            className="mk-base1-sheet b1-acoes-linha-folha"
          >
            {menu}
          </MobileSheet>
        ) : null}
      </>
    );
  }
  return (
    <B1Popover open={aberto} onOpenChange={setAberto} align="start" className="b1-acoes-linha-pop w-64 p-1.5" trigger={botao}>
      {menu}
    </B1Popover>
  );
}
