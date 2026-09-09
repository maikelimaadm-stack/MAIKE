/**
 * Testes do `gate:native-api`.
 *
 * Cada caso monta um projeto sintético num diretório temporário e roda o **gate
 * real**. Nenhuma reimplementação da regra dentro do teste — reimplementar é
 * testar a cópia, não o gate.
 *
 * A regra que governa este arquivo vem da P2-R1 e foi reforçada pela P3-R1: uma
 * invariante não está protegida porque o código correto passa; ela está
 * protegida quando o código **mutilado reprova** com o código de falha certo.
 *
 * Há também controles **positivos**, e eles não são decorativos. Durante a
 * escrita deste gate, duas regras minhas reprovaram o próprio repositório:
 *
 *  - `getNativeApiUrl()` casava na **definição**, em `runtimeConfig.js`, e não
 *    só no uso;
 *  - `Authorization` casava no `base44Provider.js`, que monta esse cabeçalho
 *    legitimamente com o token da Base44 — a fronteira dele.
 *
 * É a mesma classe de falso positivo que a P3-R1 corrigiu na regra de
 * identidade em runtime, e o motivo de TEN-27 existir lá. NAT-14 e NAT-15 são
 * os equivalentes aqui: eles quebram se alguém alargar as regras de volta.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTempDir, cleanup, writeFile, runGate, REPO_ROOT } from './helpers.mjs';

const GATE = 'gate-native-api.mjs';

const RUNTIME_CONFIG = 'src/config/runtimeConfig.js';
const HTTP_CLIENT = 'src/apis/_core/nativeHttpClient.js';
const TOKEN_STORAGE = 'src/lib/auth/nativeTokenStorage.js';
const SESSION_API = 'src/apis/session/nativeSessionApi.js';
const ERROR_CATALOG = 'src/apis/_core/ApiError.js';
const CORS_POLICY = 'backend/src/shared/http/corsPolicy.js';
const CONTRATO = 'config/modelobase1-pecuario.json';
const ENV_EXAMPLE = '.env.example';

const real = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/**
 * Projeto sintético que reproduz a forma do repositório real.
 *
 * Os arquivos são cópias do código de produção: mutar uma cópia fiel prova algo
 * sobre o código real; mutar um esqueleto inventado prova algo sobre o
 * esqueleto.
 */
const projetoBase = () => ({
  [CONTRATO]: real(CONTRATO),
  [ENV_EXAMPLE]: real(ENV_EXAMPLE),
  [RUNTIME_CONFIG]: real(RUNTIME_CONFIG),
  [HTTP_CLIENT]: real(HTTP_CLIENT),
  [TOKEN_STORAGE]: real(TOKEN_STORAGE),
  [SESSION_API]: real(SESSION_API),
  [ERROR_CATALOG]: real(ERROR_CATALOG),
  [CORS_POLICY]: real(CORS_POLICY),
});

/**
 * Monta o projeto, aplica as mutações pedidas e roda o gate.
 * @param {Record<string, string|null>} [mutacoes] `null` remove o arquivo
 */
const rodar = (mutacoes = {}) => {
  const dir = makeTempDir('maike-nat-');
  try {
    const arquivos = { ...projetoBase(), ...mutacoes };
    for (const [caminho, conteudo] of Object.entries(arquivos)) {
      if (conteudo === null) continue;
      writeFile(dir, caminho, conteudo);
    }
    return runGate(GATE, { cwd: dir, env: { NATIVE_API_ROOT: dir } });
  } finally {
    cleanup(dir);
  }
};

/** Aplica uma substituição obrigatória: se o alvo sumiu, o teste falha alto. */
const trocar = (fonte, de, para) => {
  assert.ok(fonte.includes(de), `fixture desatualizada: não encontrei ${JSON.stringify(de)}`);
  return fonte.replaceAll(de, para);
};

describe('gate:native-api — estado correto', () => {
  test('NAT-01 o repositório real passa', () => {
    const r = runGate(GATE);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /PASSOU/);
  });

  test('NAT-02 o projeto sintético fiel passa', () => {
    const r = rodar();
    assert.equal(r.status, 0, r.output);
  });
});

describe('P4-NATIVE-CONFIG', () => {
  test('NAT-03 leitura dinâmica de import.meta.env reprova', () => {
    // A forma dinâmica funciona no Vite, mas materializa o objeto inteiro no
    // bundle e publica toda VITE_ do build, inclusive as não referenciadas.
    const mutado = trocar(
      real(RUNTIME_CONFIG),
      'import.meta.env.VITE_MAIKE_API_URL',
      "import.meta.env['VITE_MAIKE_API_URL']"
    );
    const r = rodar({ [RUNTIME_CONFIG]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-CONFIG/);
  });

  test('NAT-04 override por query string na URL nativa reprova', () => {
    const mutado = trocar(
      real(RUNTIME_CONFIG),
      'export const getNativeApiUrl = () => comEsquemaExplicito(semBarraFinal(lerMaikeApiUrl()));',
      'export const getNativeApiUrl = () => new URLSearchParams(location.search).get("api") || comEsquemaExplicito(semBarraFinal(lerMaikeApiUrl()));'
    );
    const r = rodar({ [RUNTIME_CONFIG]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-CONFIG/);
  });

  test('NAT-05 variável ausente do .env.example reprova', () => {
    const mutado = real(ENV_EXAMPLE).replaceAll('VITE_MAIKE_API_URL', 'VITE_OUTRA_COISA');
    const r = rodar({ [ENV_EXAMPLE]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-CONFIG/);
  });
});

describe('P4-NATIVE-BASE44-TOKEN', () => {
  test('NAT-06 importar getDataProviderConfig no cliente HTTP reprova', () => {
    // Este é o caminho pelo qual o token da Base44 chegaria ao backend MAIKE.
    const mutado = trocar(
      real(HTTP_CLIENT),
      "import { getNativeApiUrl } from '@/config/runtimeConfig';",
      "import { getNativeApiUrl, getDataProviderConfig } from '@/config/runtimeConfig';"
    );
    const r = rodar({ [HTTP_CLIENT]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-BASE44-TOKEN/);
  });

  test('NAT-07 importar base44Client no cliente HTTP reprova', () => {
    const mutado = `import { base44 } from '@/api/base44Client';\n${real(HTTP_CLIENT)}`;
    const r = rodar({ [HTTP_CLIENT]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-BASE44-TOKEN/);
  });
});

describe('P4-NATIVE-TOKEN-STORAGE', () => {
  test('NAT-08 trocar sessionStorage por localStorage reprova', () => {
    const mutado = real(TOKEN_STORAGE).replaceAll('sessionStorage', 'localStorage');
    const r = rodar({ [TOKEN_STORAGE]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-TOKEN-STORAGE/);
  });

  test('NAT-09 outro arquivo mexer na chave do token reprova', () => {
    // Guarda única é o que torna a regra do storage verificável: se qualquer
    // arquivo puder ler a chave, afirmar onde o token está deixa de ser possível.
    const intruso = "export const roubar = () => window.localStorage.getItem('maike_native_access_token');\n";
    const r = rodar({ 'src/lib/intruso.js': intruso });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-TOKEN-STORAGE/);
  });
});

describe('P4-NATIVE-TENANT-SOURCE', () => {
  test('NAT-10 incluir cliente_id no corpo do login reprova', () => {
    const mutado = trocar(
      real(SESSION_API),
      'body: { cliente, login: usuarioLogin, senha }',
      'body: { cliente, cliente_id: credenciais.clienteId, login: usuarioLogin, senha }'
    );
    const r = rodar({ [SESSION_API]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-TENANT-SOURCE/);
  });

  test('NAT-11 cliente_id como header no transporte reprova', () => {
    const mutado = trocar(
      real(HTTP_CLIENT),
      "const headers = { Accept: 'application/json' };",
      "const headers = { Accept: 'application/json' }; headers['X-Cliente-Id'] = 'x';"
    );
    const r = rodar({ [HTTP_CLIENT]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-TENANT-SOURCE/);
  });
});

describe('P4-NATIVE-ERROR-CATALOG', () => {
  test('NAT-12 remover um dos oito códigos reprova', () => {
    const mutado = real(ERROR_CATALOG).replaceAll(
      "TENANT_SCOPE_VIOLATION: 'TENANT_SCOPE_VIOLATION',",
      ''
    );
    const r = rodar({ [ERROR_CATALOG]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-ERROR-CATALOG/);
    assert.match(r.output, /TENANT_SCOPE_VIOLATION/);
  });

  test('NAT-13 código catalogado sem mensagem pública reprova', () => {
    // Sem mensagem, o código cai no texto padrão e o vocabulário perde o
    // sentido de existir: a tela não consegue dizer nada específico.
    const mutado = trocar(
      real(ERROR_CATALOG),
      "  [API_ERROR_CODES.CONCURRENCY_CONFLICT]: 'Este registro foi alterado por outra pessoa. Recarregue e tente novamente.',\n",
      ''
    );
    const r = rodar({ [ERROR_CATALOG]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-ERROR-CATALOG/);
  });
});

describe('P4-NATIVE-HTTP-BOUNDARY', () => {
  test('NAT-14 CONTROLE POSITIVO: runtimeConfig define getNativeApiUrl e passa', () => {
    // A primeira versão da regra reprovava a **definição** junto com o uso, e
    // portanto reprovava o próprio repositório. Se alguém reintroduzir a forma
    // ingênua, este caso fica vermelho.
    const r = rodar();
    assert.equal(r.status, 0, r.output);
    assert.doesNotMatch(r.output, /P4-NATIVE-HTTP-BOUNDARY/);
  });

  test('NAT-15 CONTROLE POSITIVO: Authorization com o token da Base44 não reprova', () => {
    // O provider da Base44 monta `Authorization` com o token dele — é a
    // fronteira dele, e está certo. A regra é sobre o **JWT nativo**, não sobre
    // a palavra. A primeira versão desta regra reprovava esse arquivo.
    const provider = `
const cabecalhos = (token) => ({ Authorization: \`Bearer \${token}\` });
export const buscar = (token) => fetch('https://base44.example/api', { headers: cabecalhos(token) });
`;
    const r = rodar({ 'src/apis/_providers/base44Provider.js': provider });
    assert.equal(r.status, 0, r.output);
  });

  test('NAT-16 mover a montagem da requisição nativa para um service reprova', () => {
    const service = `
import { getNativeApiUrl } from '@/config/runtimeConfig';
export const listar = () => fetch(\`\${getNativeApiUrl()}/setores\`);
`;
    const r = rodar({ 'src/services/setorService.js': service });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-HTTP-BOUNDARY/);
  });

  test('NAT-17 ler o token nativo fora da fronteira reprova', () => {
    const componente = `
import { getNativeToken } from '@/lib/auth/nativeTokenStorage';
export const cabecalho = () => ({ Authorization: \`Bearer \${getNativeToken()}\` });
`;
    const r = rodar({ 'src/components/vazamento.js': componente });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-HTTP-BOUNDARY/);
  });
});

describe('P4-NATIVE-CORS', () => {
  test('NAT-18 origin wildcard reprova', () => {
    const mutado = `export const opcoesDeCors = () => ({ origin: '*', credentials: false, allowedHeaders: ['Authorization'] });\n`;
    const r = rodar({ [CORS_POLICY]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-CORS/);
  });

  test('NAT-19 devolver a origin recebida reprova', () => {
    // Ecoar a origin é wildcard escrito de outro jeito: qualquer site passa.
    const mutado = trocar(
      real(CORS_POLICY),
      'callback(null, originPermitida(origin, permitidas));',
      'callback(null, origin);'
    );
    const r = rodar({ [CORS_POLICY]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-CORS/);
  });

  test('NAT-20 comparação por prefixo reprova', () => {
    // `https://maike.app.evil.com`.startsWith(`https://maike.app`) === true.
    const mutado = trocar(
      real(CORS_POLICY),
      'return permitidas.includes(origin);',
      'return permitidas.some((p) => origin.startsWith(p));'
    );
    const r = rodar({ [CORS_POLICY]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-CORS/);
  });

  test('NAT-21 ligar credentials reprova', () => {
    const mutado = trocar(real(CORS_POLICY), 'credentials: false,', 'credentials: true,');
    const r = rodar({ [CORS_POLICY]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-CORS/);
  });

  test('NAT-22 remover Authorization dos headers permitidos reprova', () => {
    // Sem ele o preflight recusa toda chamada autenticada de outra origin, e o
    // sintoma na tela é "erro de rede", sem nenhuma pista do motivo.
    const mutado = real(CORS_POLICY).replaceAll("'Authorization', ", '');
    const r = rodar({ [CORS_POLICY]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-CORS/);
  });
});

describe('gate:native-api — o gate é absoluto', () => {
  test('NAT-23 não existe --update, baseline nem correção automática', () => {
    const fonte = readFileSync(join(REPO_ROOT, 'scripts/gates', GATE), 'utf8');
    assert.doesNotMatch(fonte, /writeFileSync/);
    assert.match(fonte, /não existe --update, baseline nem correção automática/);
  });

  test('NAT-24 arquivo de fronteira ausente reprova em vez de passar vazio', () => {
    // Gate que passa quando não encontra o que verificar é pior que gate
    // ausente: reporta verde sem ter olhado nada.
    const r = rodar({ [TOKEN_STORAGE]: null });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-TOKEN-STORAGE/);
  });
});

describe('P4-NATIVE-SCHEME', () => {
  // O defeito real: `VITE_MAIKE_API_URL=maike-production.up.railway.app`, sem
  // esquema. `fetch` tratou a URL como relativa e o POST /auth/login — com a
  // senha no corpo — foi para a origem do frontend, não para o backend.
  test('NAT-25 getNativeApiUrl sem comEsquemaExplicito reprova', () => {
    const mutado = trocar(
      real(RUNTIME_CONFIG),
      'export const getNativeApiUrl = () => comEsquemaExplicito(semBarraFinal(lerMaikeApiUrl()));',
      'export const getNativeApiUrl = () => semBarraFinal(lerMaikeApiUrl());'
    );
    const r = rodar({ [RUNTIME_CONFIG]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-SCHEME/);
  });

  test('NAT-26 remover a definição de comEsquemaExplicito reprova', () => {
    const mutado = trocar(real(RUNTIME_CONFIG), 'const comEsquemaExplicito =', 'const naoValidaNada =');
    const r = rodar({ [RUNTIME_CONFIG]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-SCHEME/);
  });

  test('NAT-27 comEsquemaExplicito que não testa o esquema reprova', () => {
    // Mantém o nome e a chamada, mas devolve a base intacta: é exatamente o
    // jeito de "passar no gate" sem proteger nada.
    const mutado = trocar(
      real(RUNTIME_CONFIG),
      "  if (/^https?:\\/\\//.test(url)) return url;\n  return HOST_PURO.test(url) ? `https://${url}` : null;",
      '  return url;'
    );
    const r = rodar({ [RUNTIME_CONFIG]: mutado });
    assert.equal(r.status, 1);
    assert.match(r.output, /P4-NATIVE-SCHEME/);
  });

  test('NAT-28 CONTROLE POSITIVO: o runtimeConfig real passa na regra de esquema', () => {
    // Sem este controle a regra poderia estar reprovando por scanner ingênuo —
    // a prosa deste repositório cita `https://` em vários comentários.
    const r = rodar();
    assert.equal(r.status, 0, r.output);
    assert.doesNotMatch(r.output, /P4-NATIVE-SCHEME/);
  });
});
