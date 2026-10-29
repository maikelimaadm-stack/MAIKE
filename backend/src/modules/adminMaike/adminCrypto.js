/**
 * Primitivas criptográficas do MAIKE Admin (D-PROD-70).
 *
 * Só `node:crypto` (OpenSSL do runtime) — nenhuma dependência nova:
 * - senha: scrypt com parâmetros explícitos e versionados no próprio hash;
 * - sessão e códigos de recuperação: valores aleatórios de alta entropia,
 *   guardados só como sha256 (não são senhas escolhidas por humanos);
 * - CSRF: HMAC do id da sessão (sem estado extra no banco);
 * - MFA: TOTP RFC 6238 (SHA-1, 30 s, 6 dígitos) com segredo cifrado por
 *   AES-256-GCM sob chave server-only.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { env, ehProducao } from '../../config/env.js';

/**
 * scrypt assíncrono com opções (o `promisify` tipado perde a sobrecarga de 4 argumentos).
 * @param {string|Buffer} senha @param {Buffer} salt @param {number} keylen @param {import('node:crypto').ScryptOptions} opcoes
 * @returns {Promise<Buffer>}
 */
const scrypt = (senha, salt, keylen, opcoes) =>
  new Promise((resolve, reject) => scryptCb(senha, salt, keylen, opcoes, (e, dk) => (e ? reject(e) : resolve(dk))));

/** Parâmetros do hash de senha. Mudá-los cria nova versão; hashes antigos seguem verificáveis. */
export const SCRYPT_V1 = Object.freeze({ versao: 1, N: 2 ** 15, r: 8, p: 1, keylen: 64, saltBytes: 16 });
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/** Política mínima de senha do proprietário. */
export const SENHA_MIN = 12;
export const SENHA_MAX = 256;

/** @param {unknown} senha @returns {string|null} motivo da recusa */
export const motivoSenhaFraca = (senha) => {
  if (typeof senha !== 'string') return 'senha obrigatória';
  if (senha.length < SENHA_MIN) return `senha deve ter ao menos ${SENHA_MIN} caracteres`;
  if (senha.length > SENHA_MAX) return `senha deve ter no máximo ${SENHA_MAX} caracteres`;
  if (new Set(senha).size < 5) return 'senha com caracteres repetidos demais';
  return null;
};

/** @param {string} senha */
export const gerarHashSenhaAdmin = async (senha) => {
  const { versao, N, r, p, keylen, saltBytes } = SCRYPT_V1;
  const salt = randomBytes(saltBytes);
  const dk = /** @type {Buffer} */ (await scrypt(senha, salt, keylen, { N, r, p, maxmem: SCRYPT_MAXMEM }));
  return `scrypt$${versao}$${N}$${r}$${p}$${salt.toString('base64url')}$${dk.toString('base64url')}`;
};

/** Hash descartável para equalizar o tempo quando o login não existe. */
let hashDescartavel;
const obterHashDescartavel = async () => (hashDescartavel ??= await gerarHashSenhaAdmin('__sem_admin__#descartavel'));

/**
 * @param {string} senha
 * @param {string|null|undefined} armazenado
 * @returns {Promise<boolean>}
 */
export const verificarSenhaAdmin = async (senha, armazenado) => {
  const alvo = typeof armazenado === 'string' && armazenado ? armazenado : await obterHashDescartavel();
  const partes = alvo.split('$');
  if (partes.length !== 7 || partes[0] !== 'scrypt' || partes[1] !== '1') return false;
  const [, , nTxt, rTxt, pTxt, saltTxt, dkTxt] = partes;
  const esperado = Buffer.from(dkTxt, 'base64url');
  const dk = /** @type {Buffer} */ (
    await scrypt(typeof senha === 'string' ? senha : '', Buffer.from(saltTxt, 'base64url'), esperado.length, {
      N: Number(nTxt),
      r: Number(rTxt),
      p: Number(pTxt),
      maxmem: SCRYPT_MAXMEM,
    })
  );
  const ok = dk.length === esperado.length && timingSafeEqual(dk, esperado);
  return ok && alvo !== hashDescartavel;
};

/** Token opaco de sessão (256 bits). */
export const novoTokenSessao = () => randomBytes(32).toString('base64url');

/** @param {string} valor */
export const sha256Hex = (valor) => createHash('sha256').update(valor, 'utf8').digest('hex');

/** @param {string} a @param {string} b */
export const iguaisTempoConstante = (a, b) => {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

/**
 * Chave de 32 bytes derivada por finalidade. Em produção a chave-mestra
 * `ADMIN_MAIKE_CHAVE` (base64, ≥ 32 bytes) é obrigatória; fora de produção
 * deriva-se de `AUTH_SECRET` para o ambiente local e de teste funcionar.
 *
 * @param {'mfa'|'csrf'} finalidade
 */
const chaveDerivada = (finalidade) => {
  const mestra = env.adminMaikeChave
    ? Buffer.from(env.adminMaikeChave, 'base64')
    : ehProducao()
      ? null
      : Buffer.from(`dev-only:${env.authSecret ?? ''}`, 'utf8');
  if (!mestra || mestra.length < 32) {
    throw new Error('ADMIN_MAIKE_CHAVE ausente ou curta (base64 de ≥ 32 bytes) — MAIKE Admin indisponível');
  }
  return Buffer.from(hkdfSync('sha256', mestra, Buffer.alloc(0), `maike-admin:${finalidade}:v1`, 32));
};

/** CSRF vinculado à sessão: HMAC(id da sessão). */
export const csrfDaSessao = (sessaoId) => createHmac('sha256', chaveDerivada('csrf')).update(sessaoId).digest('base64url');

/** @param {string} texto */
export const cifrar = (texto) => {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chaveDerivada('mfa'), iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${dados.toString('base64url')}`;
};

/** @param {string} cifrado */
export const decifrar = (cifrado) => {
  const [v, iv, tag, dados] = String(cifrado).split('.');
  if (v !== 'v1') throw new Error('formato de segredo desconhecido');
  const d = createDecipheriv('aes-256-gcm', chaveDerivada('mfa'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64url')), d.final()]).toString('utf8');
};

// ─── TOTP (RFC 6238 / RFC 4226) ────────────────────────────────────────────

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** @param {Buffer} buf */
export const base32Encode = (buf) => {
  let bits = 0;
  let valor = 0;
  let out = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(valor << (5 - bits)) & 31];
  return out;
};

/** @param {string} texto */
export const base32Decode = (texto) => {
  const limpo = String(texto).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let valor = 0;
  const out = [];
  for (const ch of limpo) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('base32 inválido');
    valor = (valor << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

export const TOTP_PERIODO = 30;
export const TOTP_DIGITOS = 6;
/** Tolerância de relógio: um passo antes e um depois. */
export const TOTP_JANELA = 1;

export const novoSegredoTotp = () => base32Encode(randomBytes(20));

/** @param {number} [agoraMs] */
export const passoTotpAtual = (agoraMs = Date.now()) => Math.floor(agoraMs / 1000 / TOTP_PERIODO);

/** @param {string} segredoBase32 @param {number} passo */
export const codigoTotp = (segredoBase32, passo) => {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(passo));
  const h = createHmac('sha1', base32Decode(segredoBase32)).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** TOTP_DIGITOS).padStart(TOTP_DIGITOS, '0');
};

/**
 * Passo que o código satisfaz dentro da janela, ou null.
 * @param {string} segredoBase32
 * @param {unknown} codigo
 * @param {number} [agoraMs]
 */
export const passoDoCodigoTotp = (segredoBase32, codigo, agoraMs = Date.now()) => {
  const c = typeof codigo === 'string' ? codigo.replace(/\s+/g, '') : '';
  if (!/^\d{6}$/.test(c)) return null;
  const atual = passoTotpAtual(agoraMs);
  for (let d = -TOTP_JANELA; d <= TOTP_JANELA; d += 1) {
    if (iguaisTempoConstante(codigoTotp(segredoBase32, atual + d), c)) return atual + d;
  }
  return null;
};

/** @param {string} login @param {string} segredoBase32 */
export const uriOtpauth = (login, segredoBase32) =>
  `otpauth://totp/${encodeURIComponent(`MAIKE Admin:${login}`)}?secret=${segredoBase32}&issuer=${encodeURIComponent(
    'MAIKE Admin'
  )}&algorithm=SHA1&digits=${TOTP_DIGITOS}&period=${TOTP_PERIODO}`;

/** Código de recuperação legível (10 caracteres base32 ≈ 50 bits), em dois blocos. */
export const novoCodigoRecuperacao = () => {
  const c = base32Encode(randomBytes(7)).slice(0, 10);
  return `${c.slice(0, 5)}-${c.slice(5)}`;
};

/** @param {unknown} codigo */
export const normalizarCodigoRecuperacao = (codigo) =>
  typeof codigo === 'string' ? codigo.toUpperCase().replace(/[^A-Z2-7]/g, '') : '';
