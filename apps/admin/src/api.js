/**
 * Cliente HTTP do MAIKE Admin.
 *
 * - Mesma origin (`/api/native`), `credentials: 'same-origin'`: o cookie de
 *   sessão é HttpOnly e nunca passa por este código.
 * - O CSRF da sessão fica só em memória (não em localStorage) e vai no
 *   cabeçalho de toda mutação.
 * - Toda escrita no catálogo relê a revisão e envia `revisao_esperada` (CAS):
 *   alteração concorrente volta 409 e a tela recarrega em vez de sobrescrever.
 */

const BASE = '/api/native';
let csrf = '';
/** @type {(() => void) | null} */
let aoPerderSessao = null;

export const definirCsrf = (valor) => {
  csrf = valor || '';
};
export const aoExpirarSessao = (fn) => {
  aoPerderSessao = fn;
};

export class ErroApi extends Error {
  constructor(status, corpo) {
    super(corpo?.message || `erro ${status}`);
    this.status = status;
    this.code = corpo?.code || 'ERRO';
    this.details = corpo?.details;
  }
}

/** Unique violado no banco chega como CONCURRENCY_CONFLICT "registro já existe". */
export const ehDuplicidade = (e) => e?.code === 'CONCURRENCY_CONFLICT' && e?.message === 'registro já existe';
/** Conflito de revisão (CAS): recarregar antes de tentar de novo. */
export const ehConflitoRevisao = (e) => e?.code === 'CONCURRENCY_CONFLICT' && !ehDuplicidade(e);

/** Mensagens para quem não é técnico. */
export const mensagemDeErro = (erro) => {
  const e = /** @type {any} */ (erro);
  switch (e?.code) {
    case 'CONCURRENCY_CONFLICT':
      return ehDuplicidade(e)
        ? 'Já existe um registro com esse código.'
        : 'O catálogo foi alterado em outra sessão. Recarregamos os dados: revise e tente de novo.';
    case 'ADMIN_CREDENCIAIS_INVALIDAS':
      return 'Login, senha ou código inválido. Depois de várias tentativas o acesso fica bloqueado por alguns minutos.';
    case 'ADMIN_RATE_LIMITED':
      return 'Muitas tentativas seguidas. Aguarde alguns minutos.';
    case 'ADMIN_SESSAO_REQUIRED':
      return 'Sua sessão terminou. Entre novamente.';
    case 'ADMIN_ORIGEM_RECUSADA':
      return 'Requisição recusada por segurança (origem não autorizada). Recarregue a página.';
    case 'CATALOGO_ASSET_INVALID':
      return `Imagem recusada: ${e.message}`;
    case 'CATALOGO_GLOBAL_INVALID':
    case 'ADMIN_ENTRADA_INVALIDA':
      return e.message;
    default:
      return e?.status === 0 || e instanceof TypeError ? 'Sem conexão com o servidor. Tente novamente.' : e?.message || 'Erro inesperado.';
  }
};

/**
 * @param {string} caminho
 * @param {{ method?: string, body?: unknown }} [opcoes]
 */
export const chamar = async (caminho, { method = 'GET', body } = {}) => {
  const mutacao = method !== 'GET';
  const resposta = await fetch(`${BASE}${caminho}`, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(mutacao ? { 'content-type': 'application/json', 'x-maike-admin-csrf': csrf } : {}),
    },
    body: mutacao ? JSON.stringify(body ?? {}) : undefined,
  });
  if (resposta.status === 204) return null;
  const texto = await resposta.text();
  let corpo = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = { message: texto.slice(0, 200) };
  }
  if (!resposta.ok) {
    const erro = new ErroApi(resposta.status, corpo);
    if (resposta.status === 401 && erro.code === 'ADMIN_SESSAO_REQUIRED' && aoPerderSessao) aoPerderSessao();
    throw erro;
  }
  if (corpo?.csrf_token) definirCsrf(corpo.csrf_token);
  return corpo;
};

// ─── Sessão e conta ────────────────────────────────────────────────────────
export const api = {
  sessao: () => chamar('/admin-maike/sessao'),
  entrar: (login, senha) => chamar('/admin-maike/auth/login', { method: 'POST', body: { login, senha } }),
  confirmarMfa: (codigo) => chamar('/admin-maike/auth/mfa', { method: 'POST', body: { codigo } }),
  usarRecuperacao: (codigo_recuperacao) => chamar('/admin-maike/auth/mfa', { method: 'POST', body: { codigo_recuperacao } }),
  iniciarInscricao: () => chamar('/admin-maike/mfa/inscricao', { method: 'POST', body: {} }),
  confirmarInscricao: (codigo) => chamar('/admin-maike/mfa/confirmar', { method: 'POST', body: { codigo } }),
  sair: () => chamar('/admin-maike/auth/logout', { method: 'POST', body: {} }),
  trocarSenha: (dados) => chamar('/admin-maike/conta/senha', { method: 'POST', body: dados }),
  trocarLogin: (dados) => chamar('/admin-maike/conta/login', { method: 'POST', body: dados }),
  regerarCodigos: (dados) => chamar('/admin-maike/conta/codigos-recuperacao', { method: 'POST', body: dados }),
  sessoes: () => chamar('/admin-maike/conta/sessoes'),
  revogarOutras: () => chamar('/admin-maike/conta/sessoes/revogar-outras', { method: 'POST', body: {} }),

  // ─── Catálogo ────────────────────────────────────────────────────────────
  catalogo: () => chamar('/admin-maike/catalogo'),
  validacao: () => chamar('/admin-maike/catalogo/validacao'),
};

const revisaoAtual = async () => Number((await chamar('/admin-maike/catalogo/revisao'))?.revisao ?? 0);

/** Escrita no catálogo com CAS (revisão relida imediatamente antes). */
const escrever = async (method, caminho, dados = {}) =>
  chamar(`/catalogo-global/admin${caminho}`, { method, body: { ...dados, revisao_esperada: await revisaoAtual() } });

export const catalogo = {
  criarTipo: (d) => escrever('POST', '/tipos', d),
  atualizarTipo: (id, d) => escrever('PATCH', `/tipos/${encodeURIComponent(id)}`, d),
  criarCategoria: (d) => escrever('POST', '/categorias', d),
  atualizarCategoria: (id, d) => escrever('PATCH', `/categorias/${encodeURIComponent(id)}`, d),
  enviarImagem: (d) => escrever('POST', '/assets', d),
  criarIcone: (d) => escrever('POST', '/icones', d),
  atualizarIcone: (id, d) => escrever('PATCH', `/icones/${encodeURIComponent(id)}`, d),
  publicarIcone: (id) => escrever('POST', `/icones/${encodeURIComponent(id)}/publicar`),
  desativarIcone: (id) => escrever('POST', `/icones/${encodeURIComponent(id)}/desativar`),
  criarRegra: (d) => escrever('POST', '/regras-misto', d),
  atualizarRegra: (id, d) => escrever('PATCH', `/regras-misto/${encodeURIComponent(id)}`, d),
  publicarRegra: (id) => escrever('POST', `/regras-misto/${encodeURIComponent(id)}/publicar`),
  desativarRegra: (id) => escrever('POST', `/regras-misto/${encodeURIComponent(id)}/desativar`),
};

/**
 * Lê o arquivo escolhido SEM transformar os bytes (as imagens são as do
 * proprietário). A validação real (MIME pelos bytes, tamanho) é do backend;
 * aqui só se antecipa a mensagem com os limites que o backend informou.
 *
 * @param {File} arquivo
 * @param {{ mimes: string[], max_bytes: number }} limites
 */
export const lerImagem = (arquivo, limites) =>
  new Promise((resolve, reject) => {
    if (limites && !limites.mimes.includes(arquivo.type)) {
      reject(new Error(`Formato não aceito (${arquivo.type || 'desconhecido'}). Use ${limites.mimes.map((m) => m.split('/')[1].toUpperCase()).join(', ')}. SVG não é aceito por segurança.`));
      return;
    }
    if (limites && arquivo.size > limites.max_bytes) {
      reject(
        new Error(
          `Arquivo com ${Math.ceil(arquivo.size / 1024)} KB, acima do limite de ${Math.round(limites.max_bytes / 1024)} KB. Exporte o ícone em tamanho menor (ex.: 256×256 px) e tente de novo.`
        )
      );
      return;
    }
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    leitor.onload = () => {
      const url = String(leitor.result || '');
      resolve({ conteudo_base64: url.slice(url.indexOf(',') + 1), mime_type: arquivo.type });
    };
    leitor.readAsDataURL(arquivo);
  });

/** Envia a imagem e devolve o asset registrado. */
export const enviarArquivo = async (arquivo, limites) => catalogo.enviarImagem(await lerImagem(arquivo, limites));
