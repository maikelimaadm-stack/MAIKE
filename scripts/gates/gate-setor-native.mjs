#!/usr/bin/env node
/**
 * Gate: Setor nativo (P4.1, D-PROD-25).
 *
 * Absoluto, como `gate:tenancy`, `gate:indices` e `gate:native-api`: sem
 * `--update`, sem baseline, sem correção automática, e nunca escreve arquivo.
 *
 * A P4.1 é a primeira migração de capacidade, e ela cria um conjunto de
 * invariantes que nenhum teste funcional cobre porque nenhuma delas quebra em
 * verde: um `setoresProvider` reintroduzido continuaria listando setores; um
 * `catch` devolvendo a lista da Base44 quando o backend falha pareceria
 * resiliência; um `MAX + 1` de volta no service passaria em toda tela de
 * navegador único. São exatamente os defeitos que só aparecem em produção, com
 * dois usuários, ou meses depois, com duas bases divergentes.
 *
 * A disciplina da P2-R1 vale aqui: cada regra tem prova **negativa** em
 * `scripts/tests/gates/setor-native.test.mjs` — o código mutilado precisa
 * reprovar com o código de falha certo — e controles **positivos**, para que a
 * regra não vire um scanner ingênuo que reprova código correto. Foi o erro que
 * a P4.0 cometeu duas vezes no próprio `gate:native-api` (`getNativeApiUrl` na
 * definição, `Authorization` na fronteira legítima da Base44).
 *
 * Códigos:
 *   P41-SETOR-MODEL · P41-SETOR-NUMBERING · P41-SETOR-DELETE
 *   P41-SETOR-BASE44 · P41-SETOR-PORT · P41-SETOR-TENANT-SOURCE
 *   P41-SETOR-OFFLINE-ID · P41-SETOR-FALLBACK · P41-SETOR-AUDIT
 *   P41-SETOR-ROUTE-AUTH · P41-SETOR-OFFLINE-TENANT · P41-SETOR-TIPO-DEFAULT
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { lerModels, campo } from './lib/prisma-schema.mjs';

const ROOT = process.env.SETOR_NATIVE_ROOT || process.cwd();

const SCHEMA = 'backend/prisma/schema.prisma';
const BACKEND_MODULO = 'backend/src/modules/setores';
const ROTAS = 'backend/src/modules/setores/setorRoutes.js';
const SERVICE_BACKEND = 'backend/src/modules/setores/setorService.js';
const REPOSITORIO = 'backend/src/modules/setores/setorRepository.js';
const PORTA = 'src/apis/setores/setorNativePort.js';
const API_MODULO = 'src/apis/setores/setoresApi.js';
const SERVICE_FRONT = 'src/services/setorService.js';
const PROVIDER = 'src/apis/_providers/base44Provider.js';
const HTTP_CLIENT = 'src/apis/_core/nativeHttpClient.js';
const RUNTIME_OFFLINE = 'src/lib/offline/offlineEntityRuntime.js';
const SESSAO = 'src/apis/session/nativeSessionApi.js';

const MODEL = 'Setor';
const TENANT = 'cliente_id';
const MIGRATIONS = 'backend/prisma/migrations';

/** Valor declarado em `base44/entities/Setor.jsonc` para `tipo`. */
const DEFAULT_TIPO = 'Próprio';

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push({ codigo, mensagem });

const caminho = (rel) => join(ROOT, rel);
const existe = (rel) => existsSync(caminho(rel));
const ler = (rel) => readFileSync(caminho(rel), 'utf8');

/**
 * Remove comentários de bloco e de linha.
 *
 * Sem isto o gate seria um scanner ingênuo: esta base de código explica em
 * prosa justamente as formas proibidas — "o `MAX + 1` que saiu", "não existe
 * `DELETE /setores/:id`" — e um `grep` cru reprovaria a documentação escrita
 * para impedir o defeito. É a mesma correção que a P3-R1 aplicou à regra de
 * identidade em runtime.
 */
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Fontes `.js`/`.jsx` de um diretório, recursivo. */
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
// SN-01 · P41-SETOR-MODEL — o model existe, é tenant-scoped e tem migration
// ---------------------------------------------------------------------------

const verificarModel = () => {
  if (!existe(SCHEMA)) {
    registrar('P41-SETOR-MODEL', `${SCHEMA} não encontrado`);
    return;
  }

  let models;
  try {
    models = lerModels(ler(SCHEMA));
  } catch (erro) {
    registrar('P41-SETOR-MODEL', `${SCHEMA} ilegível: ${erro.message}`);
    return;
  }

  const setor = models.find((m) => m.nome === MODEL);
  if (!setor) {
    registrar('P41-SETOR-MODEL', `o schema não declara model ${MODEL}`);
    return;
  }

  // `numero_setor` é identificador de negócio: precisa existir e viver sob
  // unique tenant-scoped. Sem o unique, a sequência é a única barreira — e
  // barreira única é convenção, não constraint.
  if (!campo(setor, 'numero_setor')) {
    registrar('P41-SETOR-MODEL', `${MODEL} não declara numero_setor`);
  }
  const uniquePorNumero = setor.uniques.some(
    (colunas) => colunas.length === 2 && colunas[0] === TENANT && colunas[1] === 'numero_setor'
  );
  if (!uniquePorNumero) {
    registrar(
      'P41-SETOR-MODEL',
      `${MODEL} precisa de @@unique([${TENANT}, numero_setor]) — a sequência sozinha não é constraint`
    );
  }

  // Chave referenciável tenant-aware, para que a FK composta de quem apontar
  // para Setor (P4.2) nasça sem migration de retrofit.
  const uniqueReferenciavel = setor.uniques.some(
    (colunas) => colunas.length === 2 && colunas[0] === TENANT && colunas[1] === 'id'
  );
  if (!uniqueReferenciavel) {
    registrar('P41-SETOR-MODEL', `${MODEL} precisa de @@unique([${TENANT}, id])`);
  }

  // `empresa_id` é String simples nesta fase: `Empresa` só é nativa na P6, e
  // uma relação Prisma para um model inexistente não compila.
  const empresa = campo(setor, 'empresa_id');
  if (!empresa) {
    registrar('P41-SETOR-MODEL', `${MODEL} não declara empresa_id`);
  } else if (empresa.tipo !== 'String') {
    registrar(
      'P41-SETOR-MODEL',
      `${MODEL}.empresa_id deve ser String nesta fase — encontrado ${empresa.tipo}. ` +
        'Empresa nativa é P6 (D-PROD-25)'
    );
  }

  // Migration versionada: o model sem migration é schema que nunca chegou ao
  // banco, e o `migrate deploy` da CI descobriria isso tarde.
  const dirMigrations = caminho('backend/prisma/migrations');
  const temMigration = existsSync(dirMigrations)
    ? readdirSync(dirMigrations).some((nome) => {
        const sql = join(dirMigrations, nome, 'migration.sql');
        return existsSync(sql) && /CREATE TABLE "Setor"/.test(readFileSync(sql, 'utf8'));
      })
    : false;

  if (!temMigration) {
    registrar('P41-SETOR-MODEL', 'nenhuma migration versionada cria a tabela "Setor"');
  }
};

// ---------------------------------------------------------------------------
// SN-02 · P41-SETOR-NUMBERING — o número vem da sequência, nunca de MAX/COUNT
// ---------------------------------------------------------------------------

const verificarNumeracao = () => {
  if (!existe(SERVICE_BACKEND)) {
    registrar('P41-SETOR-NUMBERING', `${SERVICE_BACKEND} não encontrado`);
    return;
  }

  const codigo = semComentarios(ler(SERVICE_BACKEND));

  if (!/\breservarNumero\s*\(/.test(codigo)) {
    registrar(
      'P41-SETOR-NUMBERING',
      `${SERVICE_BACKEND} não chama reservarNumero(): a numeração precisa vir de EntidadeCodigoSequencia`
    );
  }

  // A reserva e a gravação são a mesma transação. Reservar num commit e gravar
  // noutro deixa buraco na sequência quando o segundo falha.
  if (!/\$transaction\s*\(/.test(codigo)) {
    registrar(
      'P41-SETOR-NUMBERING',
      `${SERVICE_BACKEND} não abre $transaction: reserva de número e gravação precisam commitar juntas`
    );
  }

  // `MAX + 1` e `COUNT(*) + 1` são proibidos por nome no contrato. A varredura
  // cobre os dois lados: SQL cru e a forma equivalente em JavaScript, que é
  // como o defeito realmente existia no frontend.
  const proibidos = [
    { padrao: /\bMAX\s*\(/i, o_que: 'MAX(' },
    { padrao: /\bCOUNT\s*\(\s*\*\s*\)/i, o_que: 'COUNT(*)' },
    { padrao: /Math\s*\.\s*max\s*\(/, o_que: 'Math.max(' },
    { padrao: /_max\s*:/, o_que: 'aggregate _max' },
  ];

  for (const rel of [SERVICE_BACKEND, REPOSITORIO, SERVICE_FRONT, PORTA, API_MODULO].filter(existe)) {
    const fonte = semComentarios(ler(rel));
    for (const { padrao, o_que } of proibidos) {
      if (padrao.test(fonte)) {
        registrar(
          'P41-SETOR-NUMBERING',
          `${rel} usa ${o_que} no caminho de Setor — numeração por MAX/COUNT é proibida pelo contrato`
        );
      }
    }
  }

  // A função que fazia MAX+1 no frontend não pode voltar, nem sem uso.
  if (existe(SERVICE_FRONT) && /\bproximoNumeroSetor\b/.test(semComentarios(ler(SERVICE_FRONT)))) {
    registrar(
      'P41-SETOR-NUMBERING',
      `${SERVICE_FRONT} reintroduziu proximoNumeroSetor: quem numera é o backend`
    );
  }
};

// ---------------------------------------------------------------------------
// SN-03 · P41-SETOR-DELETE — a exclusão não existe como superfície
// ---------------------------------------------------------------------------

const verificarExclusao = () => {
  if (!existe(ROTAS)) {
    registrar('P41-SETOR-DELETE', `${ROTAS} não encontrado`);
    return;
  }

  const rotas = semComentarios(ler(ROTAS));

  // Qualquer forma de registrar DELETE no Fastify: `app.delete(...)`,
  // `app.route({method: 'DELETE'})`, `['GET','DELETE']`.
  if (/\.\s*delete\s*\(\s*['"`]/.test(rotas) || /method\s*:\s*\[?[^\]\n]*['"`]DELETE['"`]/.test(rotas)) {
    registrar(
      'P41-SETOR-DELETE',
      `${ROTAS} registra uma rota DELETE. A guarda de vínculo de Setor depende de quatro ` +
        'entidades que ainda vivem na Base44; uma exclusão nativa aqui apagaria sem verificar'
    );
  }

  // O frontend também não pode ter uma capacidade de exclusão de Setor: sem
  // rota, ela só poderia falhar — ou, pior, chamar a Base44.
  if (existe(API_MODULO) && /\bexport const deleteSetor\b/.test(semComentarios(ler(API_MODULO)))) {
    registrar(
      'P41-SETOR-DELETE',
      `${API_MODULO} exporta deleteSetor, mas não existe rota de exclusão no backend nativo`
    );
  }

  // E a recusa precisa ter código PRÓPRIO. Reaproveitar `SETOR_DELETE_BLOCKED`
  // afirmaria um vínculo que ninguém verificou.
  if (existe(SERVICE_FRONT)) {
    const service = semComentarios(ler(SERVICE_FRONT));
    if (!/SETOR_DELETE_UNAVAILABLE/.test(service)) {
      registrar(
        'P41-SETOR-DELETE',
        `${SERVICE_FRONT} precisa recusar a exclusão com SETOR_DELETE_UNAVAILABLE, código próprio da recusa`
      );
    }
    if (/API_ERROR_CODES\.SETOR_DELETE_BLOCKED/.test(service)) {
      registrar(
        'P41-SETOR-DELETE',
        `${SERVICE_FRONT} usa SETOR_DELETE_BLOCKED sem consultar vínculo: o código afirmaria um vínculo não verificado`
      );
    }
  }
};

// ---------------------------------------------------------------------------
// SN-04 · P41-SETOR-BASE44 — Setor não volta a ser dado da Base44
// ---------------------------------------------------------------------------

const verificarSemBase44 = () => {
  if (!existe(PROVIDER)) {
    registrar('P41-SETOR-BASE44', `${PROVIDER} não encontrado`);
    return;
  }

  const provider = semComentarios(ler(PROVIDER));

  // O acesso a entidade no provider é literal por contrato
  // (`P11-API-BOUNDARY-DYNAMIC-ENTITY`), então estas duas formas são as únicas
  // que existem — e as duas significam "Setor voltou a ser dado da Base44".
  if (/base44\.entities\.Setor\b/.test(provider) || /endpointOf\(\s*['"`]Setor['"`]\s*\)/.test(provider)) {
    registrar(
      'P41-SETOR-BASE44',
      `${PROVIDER} voltou a resolver a entidade Setor pela Base44. A persistência é nativa (D-PROD-25)`
    );
  }

  if (/\bsetoresProvider\b/.test(provider)) {
    registrar('P41-SETOR-BASE44', `${PROVIDER} reintroduziu setoresProvider`);
  }

  // A porta nativa não pode conhecer a Base44 em forma nenhuma.
  for (const rel of [PORTA].filter(existe)) {
    const fonte = semComentarios(ler(rel));
    if (/base44/i.test(fonte)) {
      registrar('P41-SETOR-BASE44', `${rel} referencia a Base44: a porta nativa não a conhece`);
    }
  }
};

// ---------------------------------------------------------------------------
// SN-05 · P41-SETOR-PORT — uma porta só, para o cadastro e para o mapa
// ---------------------------------------------------------------------------

const verificarPortaUnica = () => {
  if (!existe(PORTA)) {
    registrar('P41-SETOR-PORT', `${PORTA} não encontrado`);
    return;
  }

  // Ninguém além da porta monta requisição de `/setores`. Duas montagens
  // significam dois contratos, e o segundo diverge na primeira mudança.
  const CAMINHO_HTTP = /['"`]\/setores/;
  for (const rel of listarFontes('src')) {
    if (rel === PORTA) continue;
    if (CAMINHO_HTTP.test(semComentarios(ler(rel)))) {
      registrar(
        'P41-SETOR-PORT',
        `${rel} monta o caminho HTTP /setores: a porta única é ${PORTA}`
      );
    }
  }

  // A porta é composta com o runtime offline — a P4.1 mantém cache e fila.
  const porta = semComentarios(ler(PORTA));
  if (!/createOfflineEntityAdapter\s*\(/.test(porta)) {
    registrar(
      'P41-SETOR-PORT',
      `${PORTA} não compõe createOfflineEntityAdapter: a P4.1 preserva cache e fila offline`
    );
  }

  // Sem `delete` no catálogo de operações não existe fila de exclusão offline —
  // que o servidor recusaria para sempre, deixando o item preso.
  if (/\bdelete\s*:/.test(porta)) {
    registrar(
      'P41-SETOR-PORT',
      `${PORTA} declara operação delete: sem rota no backend, ela só encheria a fila offline`
    );
  }
};

// ---------------------------------------------------------------------------
// SN-06 · P41-SETOR-TENANT-SOURCE — o tenant nunca é enviado pelo cliente
// ---------------------------------------------------------------------------

const verificarFonteDeTenant = () => {
  // O corpo montado pela porta é uma lista literal de campos. `cliente_id`
  // dentro dela seria o tenant vindo do payload — o que a P3 gastou um gate
  // inteiro para impedir do lado do servidor.
  if (existe(PORTA)) {
    const porta = semComentarios(ler(PORTA));
    if (/\bcliente_id\b/.test(porta)) {
      registrar(
        'P41-SETOR-TENANT-SOURCE',
        `${PORTA} cita cliente_id: o tenant vem do auth_context do backend, nunca do corpo`
      );
    }
  }

  // E o schema da rota precisa ser fechado, para que um `cliente_id` enviado
  // vire 400 visível em vez de campo apagado em silêncio.
  if (existe(ROTAS)) {
    const rotas = semComentarios(ler(ROTAS));
    if (!/additionalProperties\s*:\s*false/.test(rotas)) {
      registrar(
        'P41-SETOR-TENANT-SOURCE',
        `${ROTAS} precisa de additionalProperties: false — campo desconhecido tem que virar 400, não sumir`
      );
    }
    if (/\bcliente_id\b/.test(rotas)) {
      registrar(
        'P41-SETOR-TENANT-SOURCE',
        `${ROTAS} declara cliente_id no contrato HTTP: ele vem do token, e o schema tem que recusá-lo`
      );
    }
  }
};

// ---------------------------------------------------------------------------
// SN-07 · P41-SETOR-OFFLINE-ID — id e metadado offline não vão para a rede
// ---------------------------------------------------------------------------

const verificarIdentidadeOffline = () => {
  if (!existe(PORTA)) return;

  const porta = semComentarios(ler(PORTA));

  // O corpo é montado por lista literal de campos permitidos. Um spread do
  // objeto da tela levaria `id`, `numero_setor` e `_isOffline` para o POST — e
  // o replay da fila offline falharia para todo setor criado sem rede.
  if (!/corpoDeEnvio\s*\(/.test(porta)) {
    registrar(
      'P41-SETOR-OFFLINE-ID',
      `${PORTA} não filtra o corpo por lista de campos: id offline e metadados chegariam ao POST`
    );
  }

  for (const proibido of ['numero_setor', '_isOffline']) {
    if (new RegExp(`['"\`]${proibido}['"\`]`).test(porta)) {
      registrar(
        'P41-SETOR-OFFLINE-ID',
        `${PORTA} lista "${proibido}" entre os campos enviados: quem o atribui é o servidor`
      );
    }
  }

  // `body: {...algo}` é o spread que a lista literal existe para evitar.
  if (/body\s*:\s*\{\s*\.\.\./.test(porta)) {
    registrar(
      'P41-SETOR-OFFLINE-ID',
      `${PORTA} monta o corpo por spread: use a lista literal de campos permitidos`
    );
  }
};

// ---------------------------------------------------------------------------
// SN-12 · P41-SETOR-TIPO-DEFAULT — o default do contrato chega ao banco
// ---------------------------------------------------------------------------

/** Tira comentário de SQL antes de varrer: prosa não satisfaz regra. */
const semComentariosSql = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');

/**
 * Estado do default de `Setor.tipo` no **fim** da cadeia de migrations.
 *
 * A migration da P4.1 criou a coluna sem default e já está mergeada e aplicada:
 * editá-la mudaria o checksum de uma migration registrada em
 * `_prisma_migrations` e quebraria todo `migrate deploy` seguinte. Por isso o
 * gate não olha migration isolada — ele **reproduz a cadeia** e cobra o estado
 * final. Um histórico com `CREATE TABLE` sem default seguido de
 * `SET DEFAULT 'Próprio'` é legítimo; o que não pode é a cadeia terminar sem o
 * default, ou com outro valor.
 *
 * @returns {{viuSetor: boolean, valor: string|null}}
 */
const defaultFinalDeTipo = () => {
  const dir = caminho(MIGRATIONS);
  if (!existsSync(dir)) return { viuSetor: false, valor: null };

  // Ordem lexicográfica = ordem cronológica: o nome começa pelo timestamp.
  const nomes = readdirSync(dir)
    .filter((nome) => existsSync(join(dir, nome, 'migration.sql')))
    .sort();

  // Uma varredura só, em ordem de ocorrência dentro de cada arquivo: um SET
  // seguido de um DROP no mesmo arquivo tem que resultar em "sem default".
  const passos =
    /CREATE\s+TABLE\s+"Setor"\s*\(([\s\S]*?)\)\s*;|ALTER\s+TABLE\s+"Setor"\s+ALTER\s+COLUMN\s+"tipo"\s+SET\s+DEFAULT\s+'([^']*)'|ALTER\s+TABLE\s+"Setor"\s+ALTER\s+COLUMN\s+"tipo"\s+DROP\s+DEFAULT/gi;

  let viuSetor = false;
  let valor = null;

  for (const nome of nomes) {
    const sql = semComentariosSql(readFileSync(join(dir, nome, 'migration.sql'), 'utf8'));

    for (const passo of sql.matchAll(passos)) {
      if (passo[1] !== undefined) {
        viuSetor = true;
        const coluna = /"tipo"[^,)]*/.exec(passo[1]);
        const comDefault = coluna && /DEFAULT\s+'([^']*)'/i.exec(coluna[0]);
        valor = comDefault ? comDefault[1] : null;
        continue;
      }
      if (passo[2] !== undefined) {
        viuSetor = true;
        valor = passo[2];
        continue;
      }
      viuSetor = true;
      valor = null;
    }
  }

  return { viuSetor, valor };
};

const verificarDefaultDeTipo = () => {
  if (existe(SCHEMA)) {
    let setor = null;
    try {
      setor = lerModels(ler(SCHEMA)).find((m) => m.nome === MODEL) ?? null;
    } catch {
      setor = null;
    }

    const tipo = setor && campo(setor, 'tipo');
    if (!tipo) {
      registrar('P41-SETOR-TIPO-DEFAULT', `${MODEL}.tipo não encontrado no schema`);
    } else {
      // Comentário de linha fora antes de varrer: um `// @default("Próprio")`
      // escrito ao lado do campo é prosa, não declaração.
      const atributos = String(tipo.atributos || '').replace(/\/\/.*$/, '');
      if (!new RegExp(`@default\\(\\s*"${DEFAULT_TIPO}"\\s*\\)`).test(atributos)) {
        registrar(
          'P41-SETOR-TIPO-DEFAULT',
          `${MODEL}.tipo precisa de @default("${DEFAULT_TIPO}"): o contrato legado declara esse default`
        );
      }
    }
  }

  const { viuSetor, valor } = defaultFinalDeTipo();

  if (!viuSetor) {
    registrar('P41-SETOR-TIPO-DEFAULT', `nenhuma migration toca "${MODEL}"."tipo"`);
    return;
  }

  if (valor === null) {
    registrar(
      'P41-SETOR-TIPO-DEFAULT',
      `a cadeia de migrations termina sem DEFAULT em "${MODEL}"."tipo" — ` +
        `acrescente uma migration com ALTER COLUMN "tipo" SET DEFAULT '${DEFAULT_TIPO}'`
    );
    return;
  }

  if (valor !== DEFAULT_TIPO) {
    registrar(
      'P41-SETOR-TIPO-DEFAULT',
      `a cadeia de migrations termina com DEFAULT '${valor}' em "${MODEL}"."tipo"; ` +
        `o contrato declara '${DEFAULT_TIPO}'`
    );
  }
};

// ---------------------------------------------------------------------------
// SN-11 · P41-SETOR-OFFLINE-TENANT — cache, fila e replay têm dono
// ---------------------------------------------------------------------------

const verificarDonoDoOffline = () => {
  if (existe(PORTA)) {
    const porta = semComentarios(ler(PORTA));

    // A porta de Setor precisa declarar o escopo. Sem isto, cache e fila voltam
    // a ser `entidade::empresa`: o replay manda `Authorization: Bearer` e o
    // backend grava pelo tenant do token, então a operação enfileirada por um
    // cliente seria aplicada dentro de outro que entrasse no mesmo navegador.
    if (!/tenantScoped\s*:\s*true/.test(porta)) {
      registrar(
        'P41-SETOR-OFFLINE-TENANT',
        `${PORTA} não declara tenantScoped: true: cache e fila offline ficariam sem dono`
      );
    }
  }

  if (existe(RUNTIME_OFFLINE)) {
    const runtime = semComentarios(ler(RUNTIME_OFFLINE));

    // As duas pontas da regra, como no gate:native-api: o runtime precisa
    // **saber** de tenant e precisa **usar** isso no replay. Declarar o escopo
    // na porta não protege nada se o runtime ignorar o campo.
    if (!/getOfflineTenant\s*\(/.test(runtime)) {
      registrar(
        'P41-SETOR-OFFLINE-TENANT',
        `${RUNTIME_OFFLINE} não lê o dono da sessão: a partição por tenant não existiria`
      );
    }

    if (!/destinoDaEntrada\s*\(/.test(runtime)) {
      registrar(
        'P41-SETOR-OFFLINE-TENANT',
        `${RUNTIME_OFFLINE} não decide o destino da entrada no replay: item de outro dono seria despachado`
      );
    }
  }

  if (existe(SESSAO)) {
    const sessao = semComentarios(ler(SESSAO));

    // O dono é marcado a partir do contexto vindo do servidor, e descartado
    // junto do token. Se um dos dois faltar, a fila fica órfã — o estado exato
    // que abriu o replay cruzado.
    for (const [chamada, motivo] of [
      ['setOfflineTenant', 'o dono nunca seria marcado'],
      ['clearOfflineTenant', 'o dono sobreviveria ao logout'],
    ]) {
      if (!new RegExp(`${chamada}\\s*\\(`).test(sessao)) {
        registrar(
          'P41-SETOR-OFFLINE-TENANT',
          `${SESSAO} não chama ${chamada}(): ${motivo}`
        );
      }
    }
  }
};

// ---------------------------------------------------------------------------
// SN-08 · P41-SETOR-FALLBACK — falha do backend não cai para a Base44
// ---------------------------------------------------------------------------

const verificarSemFallback = () => {
  const alvos = [PORTA, API_MODULO, SERVICE_FRONT].filter(existe);

  for (const rel of alvos) {
    const fonte = semComentarios(ler(rel));

    // `catch {}` e `catch (e) {}` — engolir o erro aqui transforma
    // "o backend não respondeu" em "não há setores", e a tela mostra lista
    // vazia como se fosse verdade.
    if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(fonte)) {
      registrar(
        'P41-SETOR-FALLBACK',
        `${rel} tem catch silencioso: falha do backend nativo não pode virar lista vazia`
      );
    }

    // Fallback explícito para a Base44 no caminho de Setor.
    if (/catch[\s\S]{0,300}?(setoresProvider|base44)/i.test(fonte)) {
      registrar(
        'P41-SETOR-FALLBACK',
        `${rel} cai para a Base44 em caso de erro: fallback silencioso faz as duas bases divergirem`
      );
    }
  }

  // O transporte não pode devolver lista vazia quando a URL não está
  // configurada — a P4.0 já resolveu isso lançando PROVIDER_UNAVAILABLE, e a
  // regra aqui impede que alguém "conserte" o Setor afrouxando o transporte.
  if (existe(HTTP_CLIENT)) {
    const http = semComentarios(ler(HTTP_CLIENT));
    if (!/erroDeIndisponibilidade\s*\(/.test(http)) {
      registrar(
        'P41-SETOR-FALLBACK',
        `${HTTP_CLIENT} deixou de sinalizar indisponibilidade: sem URL configurada a leitura precisa falhar, não devolver vazio`
      );
    }
  }
};

// ---------------------------------------------------------------------------
// SN-09 · P41-SETOR-AUDIT — escrita de Setor é auditada, na mesma transação
// ---------------------------------------------------------------------------

const verificarAuditoria = () => {
  if (!existe(SERVICE_BACKEND)) return;

  const codigo = semComentarios(ler(SERVICE_BACKEND));

  if (!/registrarEvento\s*\(/.test(codigo)) {
    registrar(
      'P41-SETOR-AUDIT',
      `${SERVICE_BACKEND} não registra evento de auditoria nas escritas de Setor`
    );
  }

  // `registrarEvento(contexto, evento, tx)` — o terceiro argumento é o que faz
  // a auditoria participar da MESMA transação. Sem ele, uma gravação pode
  // sobreviver a uma auditoria perdida.
  const chamadas = codigo.match(/registrarEvento\s*\(([\s\S]*?)\n\s*\);/g) || [];
  for (const chamada of chamadas) {
    if (!/\btx\b/.test(chamada)) {
      registrar(
        'P41-SETOR-AUDIT',
        `${SERVICE_BACKEND}: registrarEvento sem o cliente de transação — a auditoria precisa commitar junto`
      );
    }
  }
  if (chamadas.length === 0 && /registrarEvento\s*\(/.test(codigo)) {
    registrar(
      'P41-SETOR-AUDIT',
      `${SERVICE_BACKEND}: não foi possível verificar os argumentos de registrarEvento`
    );
  }
};

// ---------------------------------------------------------------------------
// SN-10 · P41-SETOR-ROUTE-AUTH — nenhuma rota de Setor é pública
// ---------------------------------------------------------------------------

const verificarAutenticacao = () => {
  if (!existe(ROTAS)) return;

  const rotas = semComentarios(ler(ROTAS));
  const registros = [...rotas.matchAll(/app\s*\.\s*(get|post|patch|put|delete)\s*\(([\s\S]*?)\n\s*\}\s*\)\s*;/g)];

  if (registros.length === 0) {
    registrar('P41-SETOR-ROUTE-AUTH', `${ROTAS} não registra nenhuma rota`);
    return;
  }

  for (const [, metodo, corpo] of registros) {
    if (!/onRequest\s*:\s*\[\s*app\s*\.\s*autenticar\s*\]/.test(corpo)) {
      registrar(
        'P41-SETOR-ROUTE-AUTH',
        `${ROTAS}: a rota ${metodo.toUpperCase()} não exige app.autenticar — sem sessão não há tenant`
      );
    }
  }
};

// ---------------------------------------------------------------------------

if (!existsSync(caminho(BACKEND_MODULO))) {
  registrar('P41-SETOR-MODEL', `módulo de backend ausente: ${BACKEND_MODULO}`);
}

verificarModel();
verificarNumeracao();
verificarExclusao();
verificarSemBase44();
verificarPortaUnica();
verificarFonteDeTenant();
verificarIdentidadeOffline();
verificarDonoDoOffline();
verificarDefaultDeTipo();
verificarSemFallback();
verificarAuditoria();
verificarAutenticacao();

if (falhas.length) {
  console.error('gate:setor-native — FALHOU\n');
  falhas.forEach((f) => console.error(`  - [${f.codigo}] ${f.mensagem}`));
  console.error(`\n  ${falhas.length} violação(ões) do contrato de Setor nativo.`);
  console.error('  O gate é absoluto: não existe --update, baseline nem correção automática.');
  process.exit(1);
}

console.log(
  'gate:setor-native — PASSOU ' +
    '(model tenant-scoped com migration; numeração por sequência em transação; ' +
    'sem exclusão nativa; sem Base44 no caminho de Setor; porta única; tenant só do token; ' +
    'id offline fora da rede; sem fallback silencioso; auditoria transacional; rotas autenticadas; ' +
    'cache e fila offline com dono; default de tipo chegando ao banco)'
);
