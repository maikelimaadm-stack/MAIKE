/**
 * Guarda do tenant corrente para o armazenamento offline (P4.1-R1, D-PROD-25).
 *
 * ─── Por que isto existe ───────────────────────────────────────────────────
 *
 * O runtime offline particionava cache e fila por `entityName::empresa_id`. Não
 * havia tenant em lugar nenhum, e `logout()` só descarta o JWT — nada limpa o
 * IndexedDB. Enquanto `Setor` vivia na Base44 isso não atravessava fronteira:
 * o replay usava a credencial da Base44, que não é tenant do MAIKE.
 *
 * Com a P4.1 o replay passou a mandar `Authorization: Bearer` do MAIKE, e o
 * backend tira o `cliente_id` **do token**. A sequência que isso abre é real:
 *
 *   1. usuário do cliente A cria um setor offline; a operação fica na fila;
 *   2. sai da sessão — a fila continua no IndexedDB, sem dono;
 *   3. usuário do cliente B entra no mesmo navegador;
 *   4. volta a conexão, o replay dispara e grava o setor de A dentro de B.
 *
 * Nenhuma regra do backend é violada no caminho: o tenant sempre veio do token,
 * como manda a R11. O erro é do cliente, que replayou operação de outro dono.
 *
 * ─── Por que `localStorage`, e não `sessionStorage` ────────────────────────
 *
 * Ao contrário do token, este valor precisa durar **o mesmo que a fila**. A
 * fila é IndexedDB e sobrevive a fechar o navegador; um marcador que morresse
 * com a aba deixaria toda operação pendente órfã no próximo boot, e órfã é
 * exatamente o estado que causou o defeito.
 *
 * Isto **não é credencial**. É o identificador do tenant, que já viaja no corpo
 * do JWT e é legível por qualquer script desta origem. Guardá-lo não amplia
 * superfície nenhuma: quem lê este valor já podia ler o mesmo dado no token.
 * Nada aqui autoriza coisa alguma — o backend continua decidindo pelo token, e
 * este módulo só responde "de quem é esta fila".
 */

/** Uma chave, estável, com o mesmo prefixo do resto do armazenamento nativo. */
const CHAVE_TENANT = 'maike_offline_tenant';

const temWindow = () => typeof window !== 'undefined';

/**
 * `localStorage` pode não existir (SSR, teste em Node) ou **lançar** no acesso:
 * Safari em modo privado e navegadores com dados de site bloqueados jogam
 * `SecurityError` na leitura da própria propriedade. O `try` envolve o acesso,
 * não só a chamada — mesma razão de `nativeTokenStorage`.
 */
const storage = () => {
  if (!temWindow()) return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

const normalizar = (valor) => (typeof valor === 'string' && valor.trim() ? valor.trim() : null);

/**
 * Tenant dono do armazenamento offline agora, ou `null`.
 *
 * `null` significa "sem sessão nativa" — e é valor legítimo, não erro: as
 * entidades que ainda vivem na Base44 não têm tenant do MAIKE.
 *
 * @returns {string|null}
 */
export const getOfflineTenant = () => {
  try {
    return normalizar(storage()?.getItem(CHAVE_TENANT) ?? null);
  } catch {
    return null;
  }
};

/**
 * Marca o tenant dono. Valor vazio equivale a limpar — não existe dono em
 * branco.
 *
 * @param {unknown} clienteId
 */
export const setOfflineTenant = (clienteId) => {
  const valor = normalizar(clienteId);
  if (!valor) {
    clearOfflineTenant();
    return;
  }
  try {
    storage()?.setItem(CHAVE_TENANT, valor);
  } catch {
    // Sem storage o marcador vale `null`, e o replay de entidade tenant-scoped
    // simplesmente não roda. Falhar fechado: pior do que não sincronizar é
    // sincronizar para o dono errado.
  }
};

/** Esquece o dono. Chamado no logout, junto do descarte do token. */
export const clearOfflineTenant = () => {
  try {
    storage()?.removeItem(CHAVE_TENANT);
  } catch {
    // Se o storage recusa remover, ele também recusou gravar.
  }
};

/** Nome da chave, exposto para teste e diagnóstico. Nome, nunca decisão. */
export const OFFLINE_TENANT_STORAGE_KEY = CHAVE_TENANT;
