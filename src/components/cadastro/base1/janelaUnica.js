/**
 * Grupo de janelas com UMA aberta por vez (pílulas da faixa de filtros, menus das colunas, painéis dos cards):
 * o estado guarda qual está aberta. Abrir `id` troca a aberta; fechar só vale se `id` ainda for a aberta.
 *
 * Por quê: com uma janela aberta, ao clicar no botão de OUTRA o Radix confirma o "clique fora" da anterior
 * DEPOIS do clique (no fim do clique ou num `setTimeout`), quando a nova já abriu. Sem esta regra, esse
 * fechamento atrasado zerava o estado e apagava a janela nova — o usuário via a lista abrir e fechar na hora.
 *
 * Uso: `onOpenChange={(o) => setAberta((a) => trocaJanela(a, id, o))}`.
 *
 * @template T
 * @param {T | null} aberta a janela aberta agora (ou `null`)
 * @param {T} id a janela que pediu para abrir ou fechar
 * @param {boolean} abrir
 * @returns {T | null}
 */
export function trocaJanela(aberta, id, abrir) {
  if (abrir) return id;
  return aberta === id ? null : aberta;
}

/**
 * `onCloseAutoFocus` das janelas Base1. Ao fechar, o Radix devolve o foco ao botão que abriu a janela; se o foco
 * já está noutro lugar — o usuário clicou noutro botão ou campo e a janela DELE já abriu —, não puxa de volta.
 * Puxar tirava o foco da janela nova, que então fechava ("cliquei na outra lista e ela fechou em vez de abrir").
 * Com teclado (Esc, Enter num item) o foco estava dentro da janela que saiu: aí ele volta ao botão, como antes.
 *
 * @param {Event} e
 * @returns {boolean} `true` quando o foco ficou onde estava (a janela não deve mexer nele)
 */
export function focoFicaOndeEsta(e) {
  if (typeof document === "undefined") return false;
  const f = document.activeElement;
  const janela = e.currentTarget instanceof Node ? e.currentTarget : null;
  if (!f || f === document.body || f === document.documentElement || (janela && janela.contains(f))) return false;
  e.preventDefault();
  return true;
}
