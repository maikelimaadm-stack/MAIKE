#!/usr/bin/env node
/**
 * Gate: AreaPastagem nativa (P4.2, D-PROD-30).
 *
 * Absoluto, como `gate:setor-native`: sem `--update`, sem baseline, sem
 * correção automática, e nunca escreve arquivo.
 *
 * A P4.2 acrescenta duas invariantes que a P4.1 não tinha, e nenhuma das duas
 * quebra em verde:
 *
 *   FK composta   `AreaPastagem.setor` precisa apontar para `[cliente_id, id]`
 *                 de `Setor`. Uma FK só por `setor_id` continuaria listando
 *                 área, criando área e passando em todo teste de navegador
 *                 único — e aceitaria, no banco, uma área de um cliente
 *                 vinculada ao setor de outro;
 *   derivação     `setor_nome` precisa vir do setor lido no servidor. Um
 *                 `setor_nome` aceito do corpo funcionaria perfeitamente até o
 *                 dia em que alguém renomeasse um setor — e aí a divergência
 *                 seria silenciosa e permanente.
 *
 * A disciplina de prova negativa vale aqui como na P4.1: cada regra tem
 * mutilação que **precisa** reprovar com o código certo, em
 * `scripts/tests/gates/area-pastagem-native.test.mjs`, e controles positivos
 * para que a regra não vire scanner ingênuo. Esta base de código descreve em
 * prosa justamente as formas proibidas — é o erro que o repositório já cometeu
 * cinco vezes.
 *
 * Códigos:
 *   P42-AREA-MODEL · P42-AREA-FK · P42-AREA-NUMBERING · P42-AREA-SETOR-NOME
 *   P42-AREA-BASE44 · P42-AREA-PORT · P42-AREA-TENANT-SOURCE
 *   P42-AREA-FALLBACK · P42-AREA-AUDIT · P42-AREA-ROUTE-AUTH
 *   P42-AREA-OFFLINE-TENANT · P42-AREA-SINGLE-OWNER
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { lerModels, campo } from './lib/prisma-schema.mjs';

const ROOT = process.env.AREA_NATIVE_ROOT || process.cwd();

const SCHEMA = 'backend/prisma/schema.prisma';
const ROTAS = 'backend/src/modules/areas/areaPastagemRoutes.js';
const SERVICE_BACKEND = 'backend/src/modules/areas/areaPastagemService.js';
const REPOSITORIO = 'backend/src/modules/areas/areaPastagemRepository.js';
const PORTA = 'src/apis/areas/areaPastagemNativePort.js';
const API_MODULO = 'src/apis/areas/areasApi.js';
const MAPA_API = 'src/apis/mapa/mapaApi.js';
const SUPLEMENTACAO_API = 'src/apis/suplementacao/suplementacaoApi.js';
const PROVIDER = 'src/apis/_providers/base44Provider.js';
const MIGRATIONS = 'backend/prisma/migrations';

const MODEL = 'AreaPastagem';
const MODEL_PAI = 'Setor';
const TENANT = 'cliente_id';

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push({ codigo, mensagem });

const caminho = (rel) => join(ROOT, rel);
const existe = (rel) => existsSync(caminho(rel));
const ler = (rel) => readFileSync(caminho(rel), 'utf8');

/**
 * Remove comentários de bloco e de linha.
 *
 * Sem isto o gate seria um scanner ingênuo: os arquivos desta missão explicam
 * em prosa as formas proibidas — "o `setor_nome` que vinha do corpo", "não
 * existe fallback" —, e um `grep` cru reprovaria a documentação escrita para
 * impedir o defeito.
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

/** Model do schema, ou `null` com falha já registrada. */
const lerModel = (codigo, nome) => {
  if (!existe(SCHEMA)) {
    registrar(codigo, `${SCHEMA} não encontrado`);
    return null;
  }
  let models;
  try {
    models = lerModels(ler(SCHEMA));
  } catch (erro) {
    registrar(codigo, `${SCHEMA} ilegível: ${erro.message}`);
    return null;
  }
  const encontrado = models.find((m) => m.nome === nome);
  if (!encontrado) registrar(codigo, `o schema não declara model ${nome}`);
  return encontrado || null;
};

// ---------------------------------------------------------------------------
// AN-01 · P42-AREA-MODEL — o model existe, é tenant-scoped e tem migration
// ---------------------------------------------------------------------------

const verificarModel = () => {
  const area = lerModel('P42-AREA-MODEL', MODEL);
  if (!area) return;

  if (!campo(area, TENANT)) {
    registrar('P42-AREA-MODEL', `${MODEL} não declara ${TENANT}`);
  }

  if (!campo(area, 'numero_area')) {
    registrar('P42-AREA-MODEL', `${MODEL} não declara numero_area`);
  }

  // `numero_area` é identificador de negócio: precisa viver sob unique
  // tenant-scoped. Sem o unique, a sequência é a única barreira — e barreira
  // única é convenção, não constraint.
  const uniquePorNumero = area.uniques.some(
    (colunas) => colunas.length === 2 && colunas[0] === TENANT && colunas[1] === 'numero_area'
  );
  if (!uniquePorNumero) {
    registrar(
      'P42-AREA-MODEL',
      `${MODEL} precisa de @@unique([${TENANT}, numero_area]) — a sequência sozinha não é constraint`
    );
  }

  // Chave referenciável tenant-aware, para quem vier a apontar para área.
  const uniqueReferenciavel = area.uniques.some(
    (colunas) => colunas.length === 2 && colunas[0] === TENANT && colunas[1] === 'id'
  );
  if (!uniqueReferenciavel) {
    registrar('P42-AREA-MODEL', `${MODEL} precisa de @@unique([${TENANT}, id])`);
  }

  // `empresa_id` continua String simples: `Empresa` só é nativa na P6, e uma
  // relação Prisma para model inexistente não compila.
  const empresa = campo(area, 'empresa_id');
  if (!empresa) {
    registrar('P42-AREA-MODEL', `${MODEL} não declara empresa_id`);
  } else if (empresa.tipo !== 'String') {
    registrar(
      'P42-AREA-MODEL',
      `${MODEL}.empresa_id deve ser String nesta fase — encontrado ${empresa.tipo}. ` +
        'Empresa nativa é P6'
    );
  }

  const temMigration = existsSync(caminho(MIGRATIONS))
    ? readdirSync(caminho(MIGRATIONS)).some((nome) => {
        const sql = join(caminho(MIGRATIONS), nome, 'migration.sql');
        return existsSync(sql) && /CREATE TABLE "AreaPastagem"/.test(readFileSync(sql, 'utf8'));
      })
    : false;

  if (!temMigration) {
    registrar('P42-AREA-MODEL', 'nenhuma migration versionada cria a tabela "AreaPastagem"');
  }
};

// ---------------------------------------------------------------------------
// AN-02 · P42-AREA-FK — o vínculo com Setor é FK COMPOSTA tenant-aware
// ---------------------------------------------------------------------------

const verificarFkComposta = () => {
  const area = lerModel('P42-AREA-FK', MODEL);
  if (!area) return;

  const setorId = campo(area, 'setor_id');
  if (!setorId) {
    registrar('P42-AREA-FK', `${MODEL} não declara setor_id`);
    return;
  }

  const relacao = area.campos.find((c) => c.tipo === MODEL_PAI && !c.lista);
  if (!relacao) {
    registrar('P42-AREA-FK', `${MODEL} não declara relação para ${MODEL_PAI}`);
    return;
  }

  // A checagem é estrutural sobre os dois arrays do @relation, não substring:
  // `fields: [setor_id, cliente_id]` e `fields: [cliente_id, setor_id]` têm os
  // mesmos caracteres, e só a ordem casa com `references: [cliente_id, id]`.
  const fields = /fields:\s*\[([^\]]*)\]/.exec(relacao.atributos);
  const references = /references:\s*\[([^\]]*)\]/.exec(relacao.atributos);

  const colunas = (m) => (m ? m[1].split(',').map((c) => c.trim()).filter(Boolean) : []);
  const deOrigem = colunas(fields);
  const deDestino = colunas(references);

  const ok =
    deOrigem.length === 2 &&
    deOrigem[0] === TENANT &&
    deOrigem[1] === 'setor_id' &&
    deDestino.length === 2 &&
    deDestino[0] === TENANT &&
    deDestino[1] === 'id';

  if (!ok) {
    registrar(
      'P42-AREA-FK',
      `${MODEL}.${MODEL_PAI} precisa ser FK composta @relation(fields: [${TENANT}, setor_id], ` +
        `references: [${TENANT}, id]) — encontrado fields: [${deOrigem.join(', ')}], ` +
        `references: [${deDestino.join(', ')}]. FK só por setor_id aceita área de um cliente ` +
        'vinculada a setor de outro'
    );
  }

  if (!/onDelete:\s*Restrict/.test(relacao.atributos)) {
    registrar(
      'P42-AREA-FK',
      `${MODEL}.${MODEL_PAI} precisa de onDelete: Restrict — apagar setor com área não pode cascatear`
    );
  }

  // Índice para o lado da FK: sem ele, toda navegação por setor é seq scan.
  const temIndice = area.indices.some(
    (colunas2) => colunas2.length >= 2 && colunas2[0] === TENANT && colunas2[1] === 'setor_id'
  );
  if (!temIndice) {
    registrar('P42-AREA-FK', `${MODEL} precisa de @@index([${TENANT}, setor_id])`);
  }
};

// ---------------------------------------------------------------------------
// AN-03 · P42-AREA-NUMBERING — o número vem da sequência, nunca de MAX/COUNT
// ---------------------------------------------------------------------------

const verificarNumeracao = () => {
  if (!existe(SERVICE_BACKEND)) {
    registrar('P42-AREA-NUMBERING', `${SERVICE_BACKEND} não encontrado`);
    return;
  }

  const codigo = semComentarios(ler(SERVICE_BACKEND));

  if (!/\breservarNumero\s*\(/.test(codigo)) {
    registrar(
      'P42-AREA-NUMBERING',
      `${SERVICE_BACKEND} não chama reservarNumero(): a numeração precisa vir de EntidadeCodigoSequencia`
    );
  }

  if (!/\$transaction\s*\(/.test(codigo)) {
    registrar(
      'P42-AREA-NUMBERING',
      `${SERVICE_BACKEND} não abre $transaction: reserva e gravação precisam commitar juntas`
    );
  }

  // O frontend não pode voltar a contar. As formas são as que a P4.1 removeu.
  for (const fonte of [PORTA, API_MODULO, MAPA_API].filter(existe)) {
    const corpo = semComentarios(ler(fonte));
    if (/numero_area\s*[:=][^;\n]*\b(Math\.max|\.length\s*\+\s*1|reduce)\b/.test(corpo)) {
      registrar(
        'P42-AREA-NUMBERING',
        `${fonte} calcula numero_area no cliente: o número é do servidor (MAX + 1 volta a colidir)`
      );
    }
  }
};

// ---------------------------------------------------------------------------
// AN-04 · P42-AREA-SETOR-NOME — setor_nome é derivado, nunca recebido
// ---------------------------------------------------------------------------

const verificarSetorNome = () => {
  if (existe(SERVICE_BACKEND)) {
    const codigo = semComentarios(ler(SERVICE_BACKEND));

    // O service precisa ler o setor para derivar o nome.
    if (!/\bbuscarSetor\s*\(/.test(codigo)) {
      registrar(
        'P42-AREA-SETOR-NOME',
        `${SERVICE_BACKEND} não lê o setor vinculado: setor_nome precisa ser derivado da linha`
      );
    }

    // E precisa gravá-lo a partir do que leu.
    if (!/setor_nome:\s*setor\.nome/.test(codigo)) {
      registrar(
        'P42-AREA-SETOR-NOME',
        `${SERVICE_BACKEND} não grava setor_nome a partir do setor lido`
      );
    }

    // O mapa de campos editáveis não pode conter setor_nome: se contiver, o
    // valor do corpo sobrescreve o derivado.
    const editaveis = /CAMPOS_EDITAVEIS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/.exec(codigo);
    if (editaveis && /\bsetor_nome\b/.test(editaveis[1])) {
      registrar(
        'P42-AREA-SETOR-NOME',
        `${SERVICE_BACKEND} lista setor_nome entre os campos editáveis: o corpo voltaria a mandar no valor`
      );
    }
  }

  // A rota não pode aceitar o campo.
  if (existe(ROTAS)) {
    const rotas = semComentarios(ler(ROTAS));
    if (/\bsetor_nome\b/.test(rotas)) {
      registrar(
        'P42-AREA-SETOR-NOME',
        `${ROTAS} cita setor_nome no schema: o campo tem de ser recusado por additionalProperties`
      );
    }
  }

  // A porta não pode enviá-lo.
  if (existe(PORTA)) {
    const porta = semComentarios(ler(PORTA));
    if (/['"]setor_nome['"]/.test(porta)) {
      registrar(
        'P42-AREA-SETOR-NOME',
        `${PORTA} inclui setor_nome no corpo enviado: o nome é do servidor`
      );
    }
  }

  // E a renomeação precisa propagar nativamente, na mesma transação.
  const SERVICE_SETOR = 'backend/src/modules/setores/setorService.js';
  if (existe(SERVICE_SETOR)) {
    const codigo = semComentarios(ler(SERVICE_SETOR));
    if (!/\bpropagarNomeDoSetor\s*\(/.test(codigo)) {
      registrar(
        'P42-AREA-SETOR-NOME',
        `${SERVICE_SETOR} não propaga o nome novo para as áreas: renomear setor deixaria setor_nome velho`
      );
    }
  }
};

// ---------------------------------------------------------------------------
// AN-05 · P42-AREA-BASE44 — nenhum caminho de área até a Base44
// ---------------------------------------------------------------------------

const verificarBase44 = () => {
  if (existe(PROVIDER)) {
    const provider = semComentarios(ler(PROVIDER));
    if (/endpointOf\(\s*['"]AreaPastagem['"]\s*\)/.test(provider)) {
      registrar(
        'P42-AREA-BASE44',
        `${PROVIDER} ainda resolve endpoint de AreaPastagem: a persistência é nativa`
      );
    }
    if (/AreaPastagem:\s*comFronteira\(/.test(provider)) {
      registrar(
        'P42-AREA-BASE44',
        `${PROVIDER} ainda registra AreaPastagem no ENTITY_REGISTRY`
      );
    }
  }

  // Nenhum arquivo de `src/` pode voltar a chamar o provider para área.
  for (const fonte of listarFontes('src')) {
    const corpo = semComentarios(ler(fonte));
    if (/\bmapaProvider\.(listAreas|filterAreas|createArea|updateArea)\b/.test(corpo)) {
      registrar('P42-AREA-BASE44', `${fonte} chama mapaProvider para área de pastagem`);
    }
    if (/\bsuplementacaoProvider\.listAreas\b/.test(corpo)) {
      registrar('P42-AREA-BASE44', `${fonte} chama suplementacaoProvider.listAreas`);
    }
  }
};

// ---------------------------------------------------------------------------
// AN-06 · P42-AREA-PORT — a porta nativa existe e fala com o backend próprio
// ---------------------------------------------------------------------------

const verificarPorta = () => {
  if (!existe(PORTA)) {
    registrar('P42-AREA-PORT', `${PORTA} não encontrado`);
    return;
  }

  const porta = semComentarios(ler(PORTA));

  if (!/\bnativeRequest\s*\(/.test(porta)) {
    registrar('P42-AREA-PORT', `${PORTA} não usa nativeRequest: a porta precisa falar com o backend próprio`);
  }

  if (!/['"]\/areas-pastagem['"]/.test(porta)) {
    registrar('P42-AREA-PORT', `${PORTA} não declara o caminho /areas-pastagem`);
  }

  // Sem exclusão: não existe rota, e enfileirar offline uma operação que o
  // servidor recusaria para sempre travaria a fila.
  if (/\bdelete\s*:/.test(porta)) {
    registrar(
      'P42-AREA-PORT',
      `${PORTA} declara operação delete: não existe DELETE de área (a baixa é lógica, por update)`
    );
  }
};

// ---------------------------------------------------------------------------
// AN-07 · P42-AREA-TENANT-SOURCE — o tenant nunca vem do cliente
// ---------------------------------------------------------------------------

const verificarOrigemDoTenant = () => {
  for (const fonte of [SERVICE_BACKEND, ROTAS, REPOSITORIO].filter(existe)) {
    const codigo = semComentarios(ler(fonte));

    if (/\b(body|query|params|headers|cookies?)\s*(\.|\[\s*['"])\s*cliente_id/.test(codigo)) {
      registrar(
        'P42-AREA-TENANT-SOURCE',
        `${fonte} lê cliente_id da requisição: o tenant vem de auth_context (R11)`
      );
    }
  }

  if (existe(SERVICE_BACKEND)) {
    const codigo = semComentarios(ler(SERVICE_BACKEND));
    if (!/exigirAuthContext\s*\(/.test(codigo)) {
      registrar('P42-AREA-TENANT-SOURCE', `${SERVICE_BACKEND} não exige auth_context`);
    }
    if (!/cliente_id:\s*auth\.clienteId/.test(codigo)) {
      registrar(
        'P42-AREA-TENANT-SOURCE',
        `${SERVICE_BACKEND} não grava cliente_id a partir de auth.clienteId`
      );
    }
  }

  // O repositório não pode ler por id solto.
  if (existe(REPOSITORIO)) {
    const codigo = semComentarios(ler(REPOSITORIO));
    if (/findUnique\(\s*\{\s*where:\s*\{\s*id\s*[,}]/.test(codigo)) {
      registrar(
        'P42-AREA-TENANT-SOURCE',
        `${REPOSITORIO} consulta por id solto: toda leitura usa o unique composto [${TENANT}, id]`
      );
    }
  }
};

// ---------------------------------------------------------------------------
// AN-08 · P42-AREA-FALLBACK — falha do backend não cai para a Base44
// ---------------------------------------------------------------------------

const verificarFallback = () => {
  for (const fonte of [PORTA, API_MODULO].filter(existe)) {
    const codigo = semComentarios(ler(fonte));
    if (/catch[\s\S]{0,200}?\b(mapaProvider|suplementacaoProvider|base44)\b/.test(codigo)) {
      registrar(
        'P42-AREA-FALLBACK',
        `${fonte} cai para a Base44 num catch: fallback silencioso faz as duas bases divergirem sem aviso`
      );
    }
  }
};

// ---------------------------------------------------------------------------
// AN-09 · P42-AREA-AUDIT — toda escrita audita, na mesma transação
// ---------------------------------------------------------------------------

const verificarAuditoria = () => {
  if (!existe(SERVICE_BACKEND)) {
    registrar('P42-AREA-AUDIT', `${SERVICE_BACKEND} não encontrado`);
    return;
  }

  const codigo = semComentarios(ler(SERVICE_BACKEND));
  const eventos = codigo.match(/registrarEvento\s*\(/g) || [];

  // Criar e atualizar: duas escritas, dois registros.
  if (eventos.length < 2) {
    registrar(
      'P42-AREA-AUDIT',
      `${SERVICE_BACKEND} registra ${eventos.length} evento(s) de auditoria; criação e atualização precisam dos dois`
    );
  }

  if (!/entidade:\s*['"]AreaPastagem['"]/.test(codigo)) {
    registrar('P42-AREA-AUDIT', `${SERVICE_BACKEND} não identifica a entidade auditada como AreaPastagem`);
  }
};

// ---------------------------------------------------------------------------
// AN-10 · P42-AREA-ROUTE-AUTH — nenhuma rota de área é anônima
// ---------------------------------------------------------------------------

const verificarRotas = () => {
  if (!existe(ROTAS)) {
    registrar('P42-AREA-ROUTE-AUTH', `${ROTAS} não encontrado`);
    return;
  }

  const codigo = semComentarios(ler(ROTAS));
  const declaracoes = codigo.match(/app\.(get|post|patch|put|delete)\s*\(/g) || [];
  const autenticadas = codigo.match(/onRequest:\s*\[\s*app\.autenticar\s*\]/g) || [];

  if (declaracoes.length === 0) {
    registrar('P42-AREA-ROUTE-AUTH', `${ROTAS} não declara rota alguma`);
    return;
  }

  if (autenticadas.length !== declaracoes.length) {
    registrar(
      'P42-AREA-ROUTE-AUTH',
      `${ROTAS} tem ${declaracoes.length} rota(s) e ${autenticadas.length} com app.autenticar`
    );
  }

  // Não pode existir DELETE: a baixa de área é lógica, pelo PATCH.
  if (/app\.delete\s*\(/.test(codigo)) {
    registrar(
      'P42-AREA-ROUTE-AUTH',
      `${ROTAS} declara DELETE: a baixa de área é lógica (ativo: false) e passa pelo PATCH`
    );
  }

  // Schemas fechados: campo desconhecido vira 400, não some em silêncio.
  const fechados = codigo.match(/additionalProperties:\s*false/g) || [];
  if (fechados.length < 3) {
    registrar(
      'P42-AREA-ROUTE-AUTH',
      `${ROTAS} tem ${fechados.length} schema(s) com additionalProperties: false; body de criação, params e body de update precisam dos três`
    );
  }
};

// ---------------------------------------------------------------------------
// AN-11 · P42-AREA-OFFLINE-TENANT — a fila offline tem dono
// ---------------------------------------------------------------------------

const verificarOfflineTenant = () => {
  if (!existe(PORTA)) return;

  const porta = semComentarios(ler(PORTA));
  if (!/tenantScoped:\s*true/.test(porta)) {
    registrar(
      'P42-AREA-OFFLINE-TENANT',
      `${PORTA} não marca tenantScoped: true — sem dono, a operação enfileirada por um cliente ` +
        'seria aplicada dentro de outro que entrasse depois no mesmo navegador (D-PROD-25 §L)'
    );
  }
};

// ---------------------------------------------------------------------------
// AN-12 · P42-AREA-SINGLE-OWNER — um agregado, uma porta
// ---------------------------------------------------------------------------

const verificarDonoUnico = () => {
  // Mapa e suplementação precisam reexportar do módulo de áreas, não ter
  // leitura própria. Duas portas do mesmo agregado = dois caches offline com a
  // mesma chave, divergindo na primeira invalidação parcial.
  for (const fonte of [MAPA_API, SUPLEMENTACAO_API].filter(existe)) {
    const codigo = semComentarios(ler(fonte));
    const reexporta = /export\s*\{[^}]*\blistAreas\b[^}]*\}\s*from\s*['"]@\/apis\/areas['"]/.test(
      codigo
    );
    const declaraPropria = /export\s+const\s+listAreas\s*=/.test(codigo);

    if (declaraPropria || !reexporta) {
      registrar(
        'P42-AREA-SINGLE-OWNER',
        `${fonte} precisa reexportar listAreas de @/apis/areas em vez de manter leitura própria`
      );
    }
  }
};

// ---------------------------------------------------------------------------

const executar = () => {
  verificarModel();
  verificarFkComposta();
  verificarNumeracao();
  verificarSetorNome();
  verificarBase44();
  verificarPorta();
  verificarOrigemDoTenant();
  verificarFallback();
  verificarAuditoria();
  verificarRotas();
  verificarOfflineTenant();
  verificarDonoUnico();

  if (falhas.length === 0) {
    console.log('gate:area-pastagem-native — PASSOU (12 regras verificadas)');
    return 0;
  }

  console.error(`gate:area-pastagem-native — REPROVOU (${falhas.length} falha(s))\n`);
  for (const { codigo, mensagem } of falhas) {
    console.error(`  [${codigo}] ${mensagem}`);
  }
  console.error('');
  return 1;
};

/* c8 ignore start — entrada de CLI, exercitada pelos testes via a função exportada */
const ehEntradaDireta = () =>
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (ehEntradaDireta()) {
  process.exit(executar());
}
/* c8 ignore stop */

export { executar, falhas };
