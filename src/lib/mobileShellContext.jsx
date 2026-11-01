import React from "react";

/**
 * Ponte entre o shell do celular (`Layout`) e o chrome Base1 da tela aberta.
 *
 * No celular o cabeçalho do `Layout` mostra o nome da tela, troca para o nome do
 * registro durante a edição e o botão voltar fecha o registro antes de sair da
 * tela. A barra inferior some enquanto um registro está aberto, porque o
 * registro usa o rodapé para a navegação ‹ n/N ›. Quem sabe disso é o chrome;
 * quem desenha é o `Layout`.
 *
 * @typedef {{ editing: boolean, title?: string, subtitle?: string, onBack?: () => void, formId?: string, saving?: boolean, acoes?: MobileShellAcao[] }} MobileShellRecord
 * @typedef {{ key: string, label: string, icon?: React.ReactNode, disabled?: boolean, onSelect: () => void }} MobileShellAcao
 * @typedef {{ listChrome: boolean, record: MobileShellRecord | null }} MobileShellState
 */

const noop = () => {};

const MobileShellContext = React.createContext({
  /** @type {MobileShellState} */
  state: { listChrome: false, record: null },
  /** @type {(patch: Partial<MobileShellState>) => void} */
  publish: noop,
});

/** @param {{ children: React.ReactNode }} props */
export function MobileShellProvider({ children }) {
  const [state, setState] = React.useState(/** @type {MobileShellState} */ ({ listChrome: false, record: null }));
  const publish = React.useCallback((patch) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      if (next.listChrome === prev.listChrome && next.record === prev.record) return prev;
      return next;
    });
  }, []);
  const value = React.useMemo(() => ({ state, publish }), [state, publish]);
  return <MobileShellContext.Provider value={value}>{children}</MobileShellContext.Provider>;
}

/** Estado publicado pela tela aberta — lido pelo `Layout`. */
export function useMobileShellState() {
  return React.useContext(MobileShellContext).state;
}

/**
 * Publicado pelo `CadastroListaChrome`. `record` nulo = lista (tabela/cards).
 * `onBack` vai por ref para não republicar a cada render.
 *
 * @param {{ editing: boolean, title?: string, subtitle?: string, onBack?: () => void, formId?: string, saving?: boolean, acoes?: MobileShellAcao[] } | null} record
 */
export function usePublishMobileShell(record) {
  const { publish } = React.useContext(MobileShellContext);
  const backRef = React.useRef(record?.onBack);
  backRef.current = record?.onBack;

  const open = Boolean(record);
  const editing = Boolean(record?.editing);
  const title = record?.title ?? "";
  const subtitle = record?.subtitle ?? "";
  const formId = record?.formId ?? "";
  const saving = Boolean(record?.saving);
  // Ações ao lado do ✓ (ex.: Anexos): o array muda a cada render; publica só
  // quando a lista de chaves muda, e o clique lê a versão atual pelo ref.
  const acoesRef = React.useRef(record?.acoes ?? []);
  acoesRef.current = record?.acoes ?? [];
  const chavesAcoes = (record?.acoes ?? []).map((a) => `${a.key}:${a.disabled ? 1 : 0}`).join("|");

  React.useEffect(() => {
    publish({ listChrome: true });
    return () => publish({ listChrome: false, record: null });
  }, [publish]);

  React.useEffect(() => {
    publish({
      record: open
        ? {
            editing,
            title,
            subtitle,
            formId,
            saving,
            onBack: () => backRef.current?.(),
            acoes: acoesRef.current.map((a) => ({
              ...a,
              onSelect: () => acoesRef.current.find((atual) => atual.key === a.key)?.onSelect(),
            })),
          }
        : null,
    });
  }, [publish, open, editing, title, subtitle, formId, saving, chavesAcoes]);
}
