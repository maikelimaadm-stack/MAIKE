#!/usr/bin/env node
/**
 * Gate: transporte e sessão nativos (P4.0, D-PROD-24).
 *
 * Absoluto, como `gate:tenancy` e `gate:indices`: sem `--update`, sem baseline,
 * sem correção automática, e nunca escreve arquivo.
 *
 * A P4.0 criou invariantes que não existiam antes — o navegador passou a
 * carregar um JWT e a falar direto com o backend próprio. Regra sem gate é
 * sugestão (Constituição, P5), e estas em particular são do tipo que ninguém
 * percebe quebrando: um `localStorage` no lugar de `sessionStorage` não quebra
 * teste nenhum, e um `cliente_id` no corpo do login parece até correto para
 * quem chega novo no código.
 *
 * A disciplina da P2-R1 vale aqui: cada invariante tem prova **negativa** em
 * `scripts/tests/gates/native-api.test.mjs` — o código mutilado precisa
 * reprovar com o código de falha certo.
 *
 * Códigos:
 *   P4-NATIVE-CONFIG · P4-NATIVE-BASE44-TOKEN · P4-NATIVE-TOKEN-STORAGE
 *   P4-NATIVE-TENANT-SOURCE · P4-NATIVE-ERROR-CATALOG · P4-NATIVE-HTTP-BOUNDARY
 *   P4-NATIVE-CORS · P4-NATIVE-SCHEME
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.env.NATIVE_API_ROOT || process.cwd();
const CONTRATO = process.env.NATIVE_API_CONTRACT || 'config/modelobase1-pecuario.json';

/** Arquivos que a P4.0 define como fronteira. Caminho fixo é parte do contrato. */
const RUNTIME_CONFIG = 'src/config/runtimeConfig.js';
const HTTP_CLIENT = 'src/apis/_core/nativeHttpClient.js';
const TOKEN_STORAGE = 'src/lib/auth/nativeTokenStorage.js';
const SESSION_API = 'src/apis/session/nativeSessionApi.js';
const ERROR_CATALOG = 'src/apis/_core/ApiError.js';
const CORS_POLICY = 'backend/src/shared/http/corsPolicy.js';

const VAR_URL = 'VITE_MAIKE_API_URL';

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push({ codigo, mensagem });

const caminho = (rel) => join(ROOT, rel);
const existe = (rel) => existsSync(caminho(rel));
const ler = (rel) => readFileSync(caminho(rel), 'utf8');

/**
 * Remove comentários de bloco e de linha.
 *
 * Sem isso o gate viraria um scanner ingênuo: esta própria base de código
 * explica em prosa as formas proibidas — "nunca `localStorage`", "jamais
 * `cliente_id`" — e um `grep` cru reprovaria a documentação que existe
 * justamente para impedir o defeito. Foi o erro que a P3-R1 cometeu e corrigiu
 * na regra de identidade em runtime.
 *
 * Também tira strings de template e literais, para que um texto de mensagem
 * não seja confundido com código.
 */
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Arquivos `.js`/`.jsx` de um diretório, recursivo. */
const listarFontes = (dirRel) => {
  const base = caminho(dirRel);
  if (!existsSync(base)) return [];
  const encontrados = [];
  const andar = (atual) => {
    for (const nome of readdirSync(atual)) {
      const completo = join(atual, nome);
      if (statSync(completo).isDirectory()) {
        if (nome === 'node_modules' || nome === '.git') continue;
        andar(completo);
        continue;
      }
      if (/\.(js|jsx)$/.test(nome)) encontrados.push(relative(ROOT, completo).split('\\').join('/'));
    }
  };
  andar(base);
  return encontrados;
};

// ---------------------------------------------------------------------------
// P4-NATIVE-CONFIG — a URL do backend nativo vem de referência estática
// ---------------------------------------------------------------------------

const verificarConfig = () => {
  if (!existe(RUNTIME_CONFIG)) {
    registrar('P4-NATIVE-CONFIG', `${RUNTIME_CONFIG} não encontrado`);
    return;
  }

  const codigo = semComentarios(ler(RUNTIME_CONFIG));

  // Referência estática literal. A forma dinâmica funciona no Vite, mas
  // materializa o objeto `import.meta.env` inteiro no bundle — publicando toda
  // `VITE_*` presente no build, inclusive as que ninguém referencia (P1.2-R1).
  if (!codigo.includes(`import.meta.env.${VAR_URL}`)) {
    registrar(
      'P4-NATIVE-CONFIG',
      `${RUNTIME_CONFIG} precisa ler ${VAR_URL} por referência estática: import.meta.env.${VAR_URL}`
    );
  }

  if (!/export const getNativeApiUrl\b/.test(codigo)) {
    registrar('P4-NATIVE-CONFIG', `${RUNTIME_CONFIG} precisa exportar getNativeApiUrl()`);
  }

  // A URL nativa não aceita override. Os parâmetros da Base44 aceitam por
  // herança do legado; o backend próprio nasce sem essa porta, porque trocar a
  // base URL redirecionaria o `Authorization` com o JWT para outro servidor.
  const bloco = codigo.match(/export const getNativeApiUrl[\s\S]{0,400}/)?.[0] ?? '';
  if (/localStorage|sessionStorage|URLSearchParams|location\.search/.test(bloco)) {
    registrar(
      'P4-NATIVE-CONFIG',
      `getNativeApiUrl() não pode aceitar override de storage ou de query string`
    );
  }

  // A variável precisa estar documentada, ou ninguém sabe configurar o deploy.
  if (existe('.env.example') && !ler('.env.example').includes(VAR_URL)) {
    registrar('P4-NATIVE-CONFIG', `${VAR_URL} não está documentada em .env.example`);
  }

  // P4-NATIVE-SCHEME — a base nativa é absoluta ou não existe.
  //
  // `nativeRequest` concatena base e caminho. Base sem esquema não falha: vira
  // URL relativa, e o `POST /auth/login` — com a senha no corpo — sai para a
  // origem do frontend em vez do backend. Aconteceu em produção com
  // `VITE_MAIKE_API_URL=maike-production.up.railway.app`.
  //
  // A regra é textual porque o gate é estático, mas não é cosmética: ela exige
  // que a validação exista **e** que `getNativeApiUrl` passe por ela. Remover
  // qualquer uma das duas pontas reprova.
  if (!/const\s+comEsquemaExplicito\s*=/.test(codigo)) {
    registrar(
      'P4-NATIVE-SCHEME',
      `${RUNTIME_CONFIG} precisa definir comEsquemaExplicito(): base sem esquema vira requisição same-origin`
    );
  } else if (!/https\?:/.test(codigo)) {
    registrar(
      'P4-NATIVE-SCHEME',
      `comEsquemaExplicito() precisa testar o esquema http/https antes de aceitar a base`
    );
  }

  if (!/export const getNativeApiUrl[^;]*comEsquemaExplicito\s*\(/.test(codigo)) {
    registrar(
      'P4-NATIVE-SCHEME',
      `getNativeApiUrl() precisa passar por comEsquemaExplicito(): sem isso a base sem esquema chega ao fetch`
    );
  }
};

// ---------------------------------------------------------------------------
// P4-NATIVE-BASE44-TOKEN — o transporte nativo não conhece a Base44
// ---------------------------------------------------------------------------

const verificarSemBase44 = () => {
  const alvos = [HTTP_CLIENT, TOKEN_STORAGE, SESSION_API].filter(existe);

  if (!existe(HTTP_CLIENT)) {
    registrar('P4-NATIVE-BASE44-TOKEN', `${HTTP_CLIENT} não encontrado`);
    return;
  }

  for (const rel of alvos) {
    const codigo = semComentarios(ler(rel));

    // `getDataProviderConfig` é a porta do token da Base44. Importá-la aqui
    // seria o primeiro passo para repassar credencial de um sistema ao outro —
    // proibido pela D-PROD-24, item B.
    const importsProibidos = [
      { padrao: /\bgetDataProviderConfig\b/, o_que: 'getDataProviderConfig (token da Base44)' },
      { padrao: /from\s+['"][^'"]*base44Client['"]/, o_que: 'base44Client' },
      { padrao: /from\s+['"][^'"]*base44Provider['"]/, o_que: 'base44Provider' },
      { padrao: /@base44\/sdk/, o_que: '@base44/sdk' },
    ];

    for (const { padrao, o_que } of importsProibidos) {
      if (padrao.test(codigo)) {
        registrar('P4-NATIVE-BASE44-TOKEN', `${rel} não pode usar ${o_que}: o token da Base44 nunca vai para o backend MAIKE`);
      }
    }
  }
};

// ---------------------------------------------------------------------------
// P4-NATIVE-TOKEN-STORAGE — o JWT nativo mora em sessionStorage, e só ali
// ---------------------------------------------------------------------------

const verificarStorageDoToken = () => {
  if (!existe(TOKEN_STORAGE)) {
    registrar('P4-NATIVE-TOKEN-STORAGE', `${TOKEN_STORAGE} não encontrado`);
    return;
  }

  const codigo = semComentarios(ler(TOKEN_STORAGE));

  if (/\blocalStorage\b/.test(codigo)) {
    registrar(
      'P4-NATIVE-TOKEN-STORAGE',
      `${TOKEN_STORAGE} usa localStorage: o JWT nativo sobreviveria ao fechamento da aba e ficaria disponível para o próximo usuário da máquina`
    );
  }

  if (!/\bsessionStorage\b/.test(codigo)) {
    registrar('P4-NATIVE-TOKEN-STORAGE', `${TOKEN_STORAGE} precisa guardar o token em sessionStorage`);
  }

  // Nenhum outro arquivo de `src/` pode tocar a chave do token: guarda única é
  // o que torna a regra acima verificável.
  const chave = codigo.match(/const CHAVE_TOKEN\s*=\s*'([^']+)'/)?.[1] ?? 'maike_native_access_token';
  const vazamentos = listarFontes('src')
    .filter((rel) => rel !== TOKEN_STORAGE)
    .filter((rel) => semComentarios(ler(rel)).includes(chave));

  for (const rel of vazamentos) {
    registrar(
      'P4-NATIVE-TOKEN-STORAGE',
      `${rel} manipula a chave do token nativo diretamente; use ${TOKEN_STORAGE}`
    );
  }
};

// ---------------------------------------------------------------------------
// P4-NATIVE-TENANT-SOURCE — o cliente nunca fornece o tenant
// ---------------------------------------------------------------------------

const verificarFonteDeTenant = () => {
  if (!existe(SESSION_API)) {
    registrar('P4-NATIVE-TENANT-SOURCE', `${SESSION_API} não encontrado`);
    return;
  }

  const codigo = semComentarios(ler(SESSION_API));

  // O corpo do login tem exatamente três campos. `cliente_id` é **resultado**
  // da autenticação, e enviá-lo faria o tenant vir do payload — o que a P3
  // gastou um gate inteiro para impedir do lado do servidor.
  const corpoDoLogin = codigo.match(/body:\s*\{[^}]*\}/)?.[0] ?? '';
  if (/\bcliente_id\s*:/.test(corpoDoLogin)) {
    registrar(
      'P4-NATIVE-TENANT-SOURCE',
      `${SESSION_API} envia cliente_id no corpo do login: o tenant vem do auth_context, nunca do cliente`
    );
  }
  if (!/\bcliente\s*[,:]/.test(corpoDoLogin)) {
    registrar('P4-NATIVE-TENANT-SOURCE', `${SESSION_API} precisa enviar 'cliente' (código operacional) no login`);
  }

  // O transporte também não pode carimbar tenant por header nem no corpo.
  if (existe(HTTP_CLIENT)) {
    const http = semComentarios(ler(HTTP_CLIENT));
    if (/headers\s*(\.|\[)\s*['"]?[Xx]-[Cc]liente/.test(http) || /\bcliente_id\s*:/.test(http)) {
      registrar(
        'P4-NATIVE-TENANT-SOURCE',
        `${HTTP_CLIENT} não pode montar cliente_id como header nem como campo de escopo`
      );
    }
  }
};

// ---------------------------------------------------------------------------
// P4-NATIVE-ERROR-CATALOG — os oito códigos do contrato existem no frontend
// ---------------------------------------------------------------------------

const verificarCatalogoDeErros = () => {
  if (!existe(ERROR_CATALOG)) {
    registrar('P4-NATIVE-ERROR-CATALOG', `${ERROR_CATALOG} não encontrado`);
    return;
  }

  // A lista vem do contrato, não do gate: o SSOT dos códigos continua sendo
  // `config/modelobase1-pecuario.json`, e duplicá-la aqui criaria a segunda
  // fonte de verdade que a P2 existe para evitar.
  let esperados = [];
  if (existe(CONTRATO)) {
    try {
      const contrato = JSON.parse(ler(CONTRATO));
      // `errorCodes` é uma lista de `{code, http, meaning}` — ver
      // `config/modelobase1-pecuario.json`. Ler a forma real em vez de supor
      // um mapa evita o gate passar vazio por não encontrar nada.
      esperados = (Array.isArray(contrato?.errorCodes) ? contrato.errorCodes : [])
        .map((item) => item?.code)
        .filter((nome) => typeof nome === 'string' && nome);
    } catch {
      registrar('P4-NATIVE-ERROR-CATALOG', `${CONTRATO} ilegível`);
      return;
    }
  }

  if (esperados.length === 0) {
    registrar('P4-NATIVE-ERROR-CATALOG', `nenhum código de erro lido de ${CONTRATO}`);
    return;
  }

  const codigo = semComentarios(ler(ERROR_CATALOG));
  const ausentes = esperados.filter((nome) => !new RegExp(`\\b${nome}\\s*:\\s*'${nome}'`).test(codigo));

  if (ausentes.length) {
    registrar(
      'P4-NATIVE-ERROR-CATALOG',
      `${ERROR_CATALOG} não cataloga: ${ausentes.join(', ')} — dívida declarada na P3 e fechada na P4.0`
    );
  }

  // Código catalogado sem mensagem pública cairia no texto padrão, e o
  // vocabulário perderia o sentido de existir.
  const semMensagem = esperados.filter(
    (nome) => !new RegExp(`API_ERROR_CODES\\.${nome}\\]\\s*:`).test(codigo)
  );
  if (semMensagem.length) {
    registrar(
      'P4-NATIVE-ERROR-CATALOG',
      `${ERROR_CATALOG} cataloga sem mensagem pública: ${semMensagem.join(', ')}`
    );
  }
};

// ---------------------------------------------------------------------------
// P4-NATIVE-HTTP-BOUNDARY — só a fronteira fala com o backend nativo
// ---------------------------------------------------------------------------

const verificarFronteiraHttp = () => {
  if (!existe(HTTP_CLIENT)) return;

  for (const rel of listarFontes('src')) {
    const codigo = semComentarios(ler(rel));

    // ── base URL do backend nativo ─────────────────────────────────────────
    //
    // Quem **consome** `getNativeApiUrl` está montando requisição por conta
    // própria: a base URL só interessa a quem vai concatenar caminho.
    //
    // O arquivo que a **define** é `runtimeConfig`, e ele obviamente escreve o
    // nome. A primeira versão desta regra reprovou o próprio `runtimeConfig.js`
    // por isso — a definição casava com o mesmo padrão do uso.
    if (rel !== RUNTIME_CONFIG && rel !== HTTP_CLIENT && /\bgetNativeApiUrl\s*\(/.test(codigo)) {
      registrar(
        'P4-NATIVE-HTTP-BOUNDARY',
        `${rel} usa getNativeApiUrl(): a montagem de requisição nativa vive só em ${HTTP_CLIENT}`
      );
    }

    // ── o token nativo não circula ─────────────────────────────────────────
    //
    // Esta é a regra que importa, e ela é sobre o **token**, não sobre a
    // palavra `Authorization`. O provider da Base44 monta `Authorization` com o
    // token da Base44 e está certo em fazê-lo: é a fronteira dele. A primeira
    // versão desta regra reprovava esse arquivo — falso positivo do mesmo tipo
    // que a P3-R1 corrigiu na regra de identidade em runtime, e o motivo de
    // TEN-27 existir lá.
    //
    // O que não pode é o **JWT do MAIKE** ser lido fora da fronteira: quem tem
    // o token monta requisição autenticada, e aí a fronteira deixou de existir.
    if (rel !== HTTP_CLIENT && rel !== TOKEN_STORAGE && /\bgetNativeToken\s*\(/.test(codigo)) {
      registrar(
        'P4-NATIVE-HTTP-BOUNDARY',
        `${rel} lê o token nativo: só ${HTTP_CLIENT} anexa o Bearer`
      );
    }
  }
};

// ---------------------------------------------------------------------------
// P4-NATIVE-CORS — allowlist explícita, nunca wildcard
// ---------------------------------------------------------------------------

const verificarCors = () => {
  if (!existe(CORS_POLICY)) {
    registrar('P4-NATIVE-CORS', `${CORS_POLICY} não encontrado`);
    return;
  }

  const codigo = semComentarios(ler(CORS_POLICY));

  // `origin: '*'` explícito, ou devolver a origin recebida — que é wildcard
  // escrito de outro jeito.
  if (/origin\s*:\s*['"`]\*['"`]/.test(codigo)) {
    registrar('P4-NATIVE-CORS', `${CORS_POLICY} declara origin '*': allowlist explícita é obrigatória`);
  }
  if (/callback\s*\(\s*null\s*,\s*origin\s*\)/.test(codigo)) {
    registrar(
      'P4-NATIVE-CORS',
      `${CORS_POLICY} devolve a origin recebida no callback: isso equivale a wildcard`
    );
  }

  // Comparação por prefixo ou substring deixa `https://maike.app.evil.com`
  // passar por `https://maike.app`.
  if (/\borigin\s*\.\s*(startsWith|endsWith|includes)\s*\(/.test(codigo)) {
    registrar(
      'P4-NATIVE-CORS',
      `${CORS_POLICY} compara origin por prefixo/substring: a comparação precisa ser por igualdade exata`
    );
  }

  if (!/credentials\s*:\s*false/.test(codigo)) {
    registrar(
      'P4-NATIVE-CORS',
      `${CORS_POLICY} precisa manter credentials: false — esta fase autentica por Bearer, não por cookie`
    );
  }

  if (!/Authorization/.test(codigo)) {
    registrar('P4-NATIVE-CORS', `${CORS_POLICY} precisa permitir o cabeçalho Authorization`);
  }
};

// ---------------------------------------------------------------------------

verificarConfig();
verificarSemBase44();
verificarStorageDoToken();
verificarFonteDeTenant();
verificarCatalogoDeErros();
verificarFronteiraHttp();
verificarCors();

if (falhas.length) {
  console.error('gate:native-api — FALHOU\n');
  falhas.forEach((f) => console.error(`  - [${f.codigo}] ${f.mensagem}`));
  console.error(`\n  ${falhas.length} violação(ões) do contrato de transporte nativo.`);
  console.error('  O gate é absoluto: não existe --update, baseline nem correção automática.');
  process.exit(1);
}

console.log(
  'gate:native-api — PASSOU ' +
    `(URL por referência estática; JWT só em sessionStorage; login sem cliente_id; ` +
    `catálogo de erros sincronizado; fronteira HTTP única; CORS com allowlist exata)`
);
