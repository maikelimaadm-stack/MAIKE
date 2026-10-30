/**
 * Mapa sem WebGL: diagnóstico e mensagem legível.
 *
 * O MapLibre desenha com WebGL. Quando o navegador está com a aceleração
 * gráfica desligada (ou o Chrome a desativou depois de travas do processo de
 * vídeo), a criação do mapa falha com uma mensagem técnica em JSON:
 * `{"type":"webglcontextcreationerror","message":"Failed to initialize WebGL",
 * "statusMessage":"Could not create a WebGL context, ... GL_VENDOR = Disabled"}`.
 * Isso é configuração do navegador/computador, não do app: o app só pode
 * explicar o que fazer e deixar tentar de novo.
 */

export const MENSAGEM_WEBGL_DESLIGADO =
  "O navegador está com o WebGL (aceleração gráfica) desligado, e o mapa precisa dele. " +
  "No Chrome/Edge, ative “Usar aceleração gráfica quando disponível” em Configurações › Sistema " +
  "(chrome://settings/system) e reinicie o navegador. Se já estiver ativado, feche todas as janelas " +
  "do navegador e abra de novo; se continuar, atualize o driver de vídeo ou teste em outro navegador.";

const RE_FALHA_WEBGL = /webgl|webglcontextcreationerror|GL_VENDOR|GL_RENDERER|BindToCurrentSequence/i;

/**
 * O navegador consegue criar um contexto WebGL agora? O contexto de teste é
 * liberado em seguida (não conta para o limite de contextos do navegador).
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function navegadorTemWebGL(doc = globalThis.document) {
  try {
    if (typeof globalThis.WebGLRenderingContext === "undefined" || !doc?.createElement) return false;
    const canvas = doc.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return false;
    /** @type {any} */ (gl).getExtension?.("WEBGL_lose_context")?.loseContext?.();
    return true;
  } catch {
    return false;
  }
}

/**
 * A falha ao criar o mapa é de WebGL?
 * @param {unknown} erro
 */
export function ehFalhaDeWebGL(erro) {
  const e = /** @type {any} */ (erro);
  const texto = [e?.message, e?.type, e?.statusMessage, typeof erro === "string" ? erro : ""].filter(Boolean).join(" ");
  return RE_FALHA_WEBGL.test(texto);
}

/**
 * Mensagem para o usuário quando o mapa não pôde ser criado: WebGL vira o
 * texto explicativo; qualquer outra falha mantém a mensagem original (ou o
 * texto padrão), nunca um JSON técnico.
 * @param {unknown} erro
 * @param {string} [padrao]
 */
export function mensagemFalhaMapa(erro, padrao = "Não foi possível iniciar o mapa.") {
  if (ehFalhaDeWebGL(erro)) return MENSAGEM_WEBGL_DESLIGADO;
  const msg = String(/** @type {any} */ (erro)?.message ?? "").trim();
  if (!msg || msg.startsWith("{")) return padrao;
  return msg;
}
