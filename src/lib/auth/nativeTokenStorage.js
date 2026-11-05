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
 *
 * ─── "Manter conectado" (D-PROD-135) ───────────────────────────────────────
 *
 * O padrão continua sendo `sessionStorage`. Só quando a pessoa marca
 * "Manter conectado" na tela de entrada o token vai para o armazenamento
 * persistente do navegador — escolha explícita, por aparelho, para quem usa o
 * próprio celular ou computador e não quer entrar de novo a cada abertura.
 * Sair da conta apaga os dois. A regra é verificada por `gate:native-api`:
 * o armazenamento persistente só aparece em `armazenamentoPersistente()` e só
 * é gravado com `lembrar === true`.
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
 * Armazenamento que sobrevive a fechar o navegador. Usado **só** com o opt-in
 * "Manter conectado"; o mesmo cuidado do `storage()` com acesso que lança.
 */
const armazenamentoPersistente = () => {
  if (!temWindow()) return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

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
  if (tokenEmMemoria) return tokenEmMemoria;
  try {
    tokenEmMemoria = normalizar(armazenamentoPersistente()?.getItem(CHAVE_TOKEN) ?? null);
  } catch {
    tokenEmMemoria = null;
  }
  return tokenEmMemoria;
};

/**
 * Grava o token. Valor vazio equivale a limpar — não existe estado "token em
 * branco".
 *
 * Por padrão vai para o `sessionStorage` (morre com a aba). Com
 * `{ lembrar: true }` — o "Manter conectado" da tela de entrada — vai para o
 * armazenamento persistente. Nunca os dois ao mesmo tempo: gravar num apaga o
 * outro, para não sobrar sessão esquecida.
 *
 * @param {unknown} token
 * @param {{ lembrar?: boolean }} [opcoes]
 */
export const setNativeToken = (token, opcoes = {}) => {
  const valor = normalizar(token);
  if (!valor) {
    clearNativeToken();
    return;
  }
  tokenEmMemoria = valor;
  const lembrar = opcoes?.lembrar === true;
  try {
    if (lembrar === true) {
      armazenamentoPersistente()?.setItem(CHAVE_TOKEN, valor);
      storage()?.removeItem(CHAVE_TOKEN);
    } else {
      storage()?.setItem(CHAVE_TOKEN, valor);
      armazenamentoPersistente()?.removeItem(CHAVE_TOKEN);
    }
  } catch {
    // Persistir é conveniência: sem storage a sessão vale enquanto a página
    // viver. Falhar aqui não pode derrubar um login que já deu certo.
  }
};

/** Descarta o token da memória, do `sessionStorage` e do armazenamento persistente. */
export const clearNativeToken = () => {
  tokenEmMemoria = null;
  try {
    storage()?.removeItem(CHAVE_TOKEN);
  } catch {
    // Nada a fazer: se o storage recusa remover, ele também recusou gravar.
  }
  try {
    armazenamentoPersistente()?.removeItem(CHAVE_TOKEN);
  } catch {
    // Idem.
  }
};

/**
 * Descarta **só** o token que o servidor recusou.
 *
 * Diferente de `clearNativeToken` (sair da conta, que apaga tudo): numa aba
 * antiga pode sobrar no `sessionStorage` um token vencido de uma entrada sem
 * "Manter conectado", enquanto o armazenamento persistente guarda outro,
 * válido, de uma entrada lembrada. Recusar o velho não pode apagar o novo.
 *
 * @returns {boolean} se ainda resta outro token guardado para tentar
 */
export const descartarTokenRecusado = () => {
  const recusado = tokenEmMemoria ?? getNativeToken();
  tokenEmMemoria = null;
  for (const area of [storage(), armazenamentoPersistente()]) {
    try {
      if (area && normalizar(area.getItem(CHAVE_TOKEN)) === recusado) area.removeItem(CHAVE_TOKEN);
    } catch {
      // Sem storage não há o que apagar.
    }
  }
  return getNativeToken() !== null;
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
