/**
 * Guarda do token de sessão nativo (P4.0, D-PROD-24).
 *
 * Este é o **único** lugar do frontend autorizado a escrever ou ler o JWT do
 * backend MAIKE. Não é preferência de organização: é o que torna a regra
 * verificável. Com uma porta só, `gate:native-api` consegue afirmar onde o
 * token pode estar; com o token espalhado, nenhuma varredura conseguiria.
 *
 * ─── Por que em `src/lib/`, e não em `src/apis/session/` ───────────────────
 *
 * A primeira versão morava junto da API de sessão, e dois testes de
 * arquitetura reprovaram — com razão. `src/apis/**` não pode tocar
 * armazenamento do navegador (B10), e `_core` alcançando o interior de outro
 * módulo de API é bypass de camada (B13). Armazenamento é preocupação de
 * ambiente, como o runtime offline em `src/lib/offline/`, e é aqui que ela
 * pertence. A regra não foi afrouxada para acomodar o arquivo: o arquivo foi
 * para o lugar certo.
 *
 * ─── Por que memória + `sessionStorage`, e não `localStorage` ───────────────
 *
 * `localStorage` persiste até alguém apagar: sobrevive a fechar a aba, fechar o
 * navegador e desligar a máquina. Num computador compartilhado — que é o caso
 * comum na fazenda — isso deixa uma sessão válida aberta para o próximo. O
 * `sessionStorage` morre com a aba, que é o tempo de vida que uma sessão de
 * trabalho deveria ter.
 *
 * A memória vem antes porque é a fonte quente: evita ler storage a cada
 * requisição e continua funcionando quando o storage lança (modo privado,
 * cota, política de site).
 *
 * ─── O trade-off, dito sem maquiagem ───────────────────────────────────────
 *
 * `sessionStorage` é acessível a JavaScript. Um XSS que rode nesta origem lê o
 * token, e trocar `localStorage` por `sessionStorage` **não** resolve XSS —
 * reduz a janela, não a classe do problema. A defesa real é cookie `HttpOnly`
 * com `SameSite`, refresh token com rotação, revogação no servidor e CSP.
 * Nada disso está nesta fatia, e fingir o contrário seria pior do que a
 * ausência: ficaria a impressão de que a sessão está endurecida.
 *
 * Isso pertence à fase de segurança (P8) e está registrado na D-PROD-24.
 */

/** Uma chave, estável. Sem prefixo `base44_`: esta sessão não é da Base44. */
const CHAVE_TOKEN = 'maike_native_access_token';

/**
 * Fonte quente. Também é o que mantém a sessão viva quando o `sessionStorage`
 * está indisponível — o usuário continua trabalhando até fechar a aba.
 */
let tokenEmMemoria = null;

const temWindow = () => typeof window !== 'undefined';

/**
 * `sessionStorage` pode não existir (SSR, teste em Node) ou **lançar** no
 * acesso: Safari em modo privado, cota estourada e navegadores com dados de
 * site bloqueados jogam `SecurityError` na própria leitura da propriedade. Por
 * isso o `try` envolve o acesso, não só a chamada.
 */
const storage = () => {
  if (!temWindow()) return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
};

const normalizar = (valor) => (typeof valor === 'string' && valor.trim() ? valor.trim() : null);

/**
 * Token da sessão nativa, ou `null`.
 *
 * Memória primeiro; `sessionStorage` como reidratação depois de um reload.
 *
 * @returns {string|null}
 */
export const getNativeToken = () => {
  if (tokenEmMemoria) return tokenEmMemoria;
  try {
    tokenEmMemoria = normalizar(storage()?.getItem(CHAVE_TOKEN) ?? null);
  } catch {
    tokenEmMemoria = null;
  }
  return tokenEmMemoria;
};

/**
 * Grava o token. Valor vazio equivale a limpar — não existe estado "token em
 * branco".
 *
 * @param {unknown} token
 */
export const setNativeToken = (token) => {
  const valor = normalizar(token);
  if (!valor) {
    clearNativeToken();
    return;
  }
  tokenEmMemoria = valor;
  try {
    storage()?.setItem(CHAVE_TOKEN, valor);
  } catch {
    // Persistir é conveniência: sem storage a sessão vale enquanto a página
    // viver. Falhar aqui não pode derrubar um login que já deu certo.
  }
};

/** Descarta o token da memória e do `sessionStorage`. */
export const clearNativeToken = () => {
  tokenEmMemoria = null;
  try {
    storage()?.removeItem(CHAVE_TOKEN);
  } catch {
    // Nada a fazer: se o storage recusa remover, ele também recusou gravar.
  }
};

/** Existe token guardado? Não diz nada sobre ele ser válido. */
export const hasNativeToken = () => getNativeToken() !== null;

/**
 * Nome da chave, exposto para teste e diagnóstico.
 *
 * É o **nome**, nunca o valor. Não existe export do token para fora deste
 * módulo além de `getNativeToken`, e nada aqui serializa o estado interno.
 */
export const NATIVE_TOKEN_STORAGE_KEY = CHAVE_TOKEN;
