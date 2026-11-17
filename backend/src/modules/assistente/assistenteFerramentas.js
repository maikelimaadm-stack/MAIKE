/**
 * Assistente só de leitura (D-PROD-230) — as ferramentas que a IA pode pedir.
 *
 * Conjunto FECHADO e só de leitura. Cada ferramenta chama um serviço que já existe
 * (as mesmas leituras que o Mapa Geral faz) com o `contexto` da requisição: o tenant
 * vem SÓ do `auth_context` (R11) e a fazenda é a que o usuário tem aberta no mapa,
 * conferida contra o tenant antes de qualquer leitura. A IA escolhe a ferramenta e
 * filtros fechados pelo schema (texto, faixas, enumerações, limite), aplicados em
 * memória sobre o que já é do tenant; nunca escreve, nunca manda SQL, nunca
 * escolhe o cliente nem a fazenda. `calcular` é um analisador aritmético próprio
 * (sem eval).
 *
 * As respostas são compactas e sem dados pessoais nem financeiros: nada de CPF,
 * telefone, fornecedor, nota fiscal, GTA, valor de compra ou nome de quem registrou.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { listar as listarAreas } from '../areas/areaPastagemService.js';
import { listar as listarLotes } from '../lotes/loteService.js';
import { descansoDosPastos } from '../medicoesForragem/medicaoForragemService.js';
import { parametrosDoPasto, ROTULO_SITUACAO } from '../medicoesForragem/medicaoForragemCalculo.js';
import { listarPosicoes } from '../rebanhoLedger/rebanhoLedgerService.js';
import { agoraDoServidor, diaNoFuso, normalizarFusoIana } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { AppError } from '../../shared/errors/AppError.js';
import { DEFINICAO_APLICAR_FILTRO, montarAcaoFiltro } from './assistenteAcoes.js';
import { agrupar, arred, avaliarExpressao, contem, naFaixa, ordenarECortar, validarEntrada } from './assistenteFiltros.js';

/** Espelho das regras do farol da tela (src/domain/pastagem/farolForragem.js, D-PROD-221/223). */
export const DIAS_VALIDADE_FORRAGEM = 15;
export const FATOR_PASSOU_DESCANSO = 1.5;
const USOS_SEM_FORRAGEM = new Set(['Infraestrutura', 'Reserva', 'APP']);

const ID_PASTO = { type: 'string', minLength: 1, maxLength: 64, description: 'id do pasto (campo "id" de listar_pastos)' };
const LIMITE = (max, descricao) => ({ type: 'integer', minimum: 1, maximum: max, description: descricao });
const TEXTO = (descricao) => ({ type: 'string', minLength: 1, maxLength: 80, description: descricao });
const NUMERO = (descricao) => ({ type: 'number', minimum: 0, maximum: 1000000, description: descricao });
const DATA = (descricao) => ({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: `${descricao} (AAAA-MM-DD)` });
const ORDEM = { type: 'string', enum: ['asc', 'desc'], description: 'asc = menor primeiro (padrão), desc = maior primeiro' };

/** Situações que o filtro de pastos aceita (a do farol, sem o "(estimado)"). */
export const SITUACOES_FILTRO = Object.freeze(['Rapado', 'Descanso', 'Pronto', 'Passou do ponto', 'Em pastejo', 'Sem medição recente', 'Sem informação']);
export const ESCORES_COCHO = Object.freeze(['VAZIO', 'ADEQUADO', 'CHEIO']);
export const FUNCOES_CALCULO = Object.freeze(['soma', 'media', 'media_ponderada', 'minimo', 'maximo', 'arred', 'pct', 'raiz', 'abs']);

/** Definições enviadas à API (sem estado: o prefixo é estável para o cache). */
export const DEFINICOES_FERRAMENTAS = Object.freeze([
  {
    name: 'listar_pastos',
    description:
      'Lista os pastos (áreas) da fazenda aberta: nome, setor, hectares, cultura, alturas de entrada/saída e dias de descanso que valem, cabeças dentro agora e a situação de forragem (Rapado, Descanso, Pronto, Passou do ponto, Em pastejo), vinda da última medição válida (até 15 dias) ou estimada pelos dias de descanso. Todos os filtros são opcionais e se somam; use-os para trazer só o que a pergunta pede. A resposta diz o total encontrado e quantos vieram.',
    input_schema: {
      type: 'object',
      properties: {
        nome: TEXTO('parte do nome do pasto'),
        setor: TEXTO('parte do nome do setor'),
        cultura: TEXTO('parte do nome da cultura (ex.: marandu)'),
        situacao: { type: 'array', maxItems: 7, items: { type: 'string', enum: [...SITUACOES_FILTRO] }, description: 'uma ou mais situações de forragem' },
        ocupado: { type: 'boolean', description: 'true = com gado dentro agora; false = vazio' },
        hectares_min: NUMERO('área mínima em ha'),
        hectares_max: NUMERO('área máxima em ha'),
        cabecas_min: NUMERO('mínimo de cabeças dentro'),
        cabecas_max: NUMERO('máximo de cabeças dentro'),
        ordenar_por: { type: 'string', enum: ['nome', 'setor', 'hectares', 'cabecas', 'dias_descanso', 'dias_desde_saida'] },
        ordem: ORDEM,
        limite: LIMITE(300, 'quantos pastos devolver (padrão 150)'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'medicoes_do_pasto',
    description: 'Medições de forragem de um pasto (mais recentes primeiro): data, método (régua ou no olho), altura média, situação e, quando houve amostra, matéria seca. Filtro opcional por período.',
    input_schema: {
      type: 'object',
      properties: {
        area_id: ID_PASTO,
        data_de: DATA('a partir de'),
        data_ate: DATA('até'),
        limite: LIMITE(60, 'quantas medições (padrão 10)'),
      },
      required: ['area_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'rebanho_por_pasto',
    description:
      'Grupos de animais (lotes) da fazenda com cabeças, categoria, sexo, peso médio, peso projetado para hoje, peso objetivo, pasto onde estão, data de entrada do lote na fazenda (data_entrada_fazenda) e há quantos dias o grupo está no pasto atual (no_pasto_desde / dias_no_pasto, pelo histórico do rebanho; null quando não dá para saber, por exemplo grupos que vieram da implantação do sistema). Filtros opcionais e somados; a resposta diz o total encontrado e quantos vieram.',
    input_schema: {
      type: 'object',
      properties: {
        nome: TEXTO('parte do nome do lote'),
        categoria: TEXTO('parte do nome da categoria (ex.: garrote, bezerro)'),
        sexo: TEXTO('sexo (ex.: macho, fêmea)'),
        pasto: TEXTO('parte do nome do pasto onde está'),
        cabecas_min: NUMERO('mínimo de cabeças no lote'),
        cabecas_max: NUMERO('máximo de cabeças no lote'),
        peso_min: NUMERO('peso médio mínimo (kg)'),
        peso_max: NUMERO('peso médio máximo (kg)'),
        dias_no_pasto_min: NUMERO('há pelo menos N dias no pasto atual (grupos sem data conhecida ficam de fora)'),
        dias_no_pasto_max: NUMERO('há no máximo N dias no pasto atual (grupos sem data conhecida ficam de fora)'),
        acima_do_objetivo: { type: 'boolean', description: 'true = peso projetado já passou do objetivo; false = ainda abaixo' },
        ordenar_por: { type: 'string', enum: ['nome', 'cabecas', 'peso', 'peso_projetado', 'dias_no_pasto', 'categoria', 'pasto'] },
        ordem: ORDEM,
        limite: LIMITE(300, 'quantos lotes devolver (padrão 150)'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'resumo_rebanho',
    description: 'Totais do rebanho da fazenda: cabeças, peso médio ponderado e a divisão por categoria e por sexo.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'resumo_agrupado',
    description:
      'Contas prontas, feitas pelo sistema, agrupando o rebanho ou os pastos. rebanho: por categoria, sexo ou pasto → lotes, cabeças, peso médio ponderado e peso total. pastos: por setor, situação ou cultura → pastos, hectares e cabeças dentro. Aceita os mesmos filtros de texto principais para estreitar antes de agrupar. Prefira esta ferramenta a somar listas à mão.',
    input_schema: {
      type: 'object',
      properties: {
        origem: { type: 'string', enum: ['rebanho', 'pastos'] },
        agrupar_por: { type: 'string', enum: ['categoria', 'sexo', 'pasto', 'setor', 'situacao', 'cultura'], description: 'rebanho: categoria, sexo ou pasto; pastos: setor, situacao ou cultura' },
        categoria: TEXTO('rebanho: parte do nome da categoria'),
        pasto: TEXTO('rebanho: parte do nome do pasto'),
        setor: TEXTO('pastos: parte do nome do setor'),
      },
      required: ['origem', 'agrupar_por'],
      additionalProperties: false,
    },
  },
  {
    name: 'leituras_cocho_recentes',
    description: 'Leituras de cocho mais recentes da fazenda: data, cocho, escore de sobra (VAZIO, ADEQUADO, CHEIO), acesso e estrutura. Filtros opcionais por cocho, escore e período.',
    input_schema: {
      type: 'object',
      properties: {
        cocho: TEXTO('parte do nome do cocho'),
        escore: { type: 'string', enum: [...ESCORES_COCHO] },
        data_de: DATA('a partir de'),
        data_ate: DATA('até'),
        limite: LIMITE(100, 'quantas leituras (padrão 20)'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'calcular',
    description:
      `Calculadora exata. Use SEMPRE que precisar fazer conta com números do sistema (somas, médias, médias ponderadas, porcentagens, diferenças, UA, lotação, GMD), em vez de calcular de cabeça. Aceita números (ponto como decimal: 327.5), + - * / % ^, parênteses e as funções ${FUNCOES_CALCULO.join(', ')}; listas entre colchetes, ex.: media_ponderada([300, 280], [100, 50]), soma([1, 2, 3]), arred(4425 / 73, 1), pct(38, 4425). Pode mandar várias contas de uma vez em "contas".`,
    input_schema: {
      type: 'object',
      properties: {
        contas: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', minLength: 1, maxLength: 2000 },
          description: 'uma ou mais expressões; cada uma volta com o seu resultado',
        },
      },
      required: ['contas'],
      additionalProperties: false,
    },
  },
  DEFINICAO_APLICAR_FILTRO,
]);

export const NOMES_FERRAMENTAS = Object.freeze(DEFINICOES_FERRAMENTAS.map((f) => f.name));

/** @param {string} a AAAA-MM-DD @param {string} b AAAA-MM-DD */
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
/** @param {unknown} v */
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** @param {unknown} v */
const dia = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : null);

/**
 * Situação estimada pelos dias de descanso (mesma regra da tela). Nunca RAPADO.
 * @param {number|null} d @param {number|null} D
 */
export const estimarPorDescanso = (d, D) => {
  if (d === null || D === null || !Number.isInteger(d) || d < 0 || !Number.isInteger(D) || D < 1) return null;
  if (d < D) return 'DESCANSO';
  if (d <= Math.round(D * FATOR_PASSOU_DESCANSO)) return 'PRONTO';
  return 'PASSOU';
};

/**
 * Forragem de um pasto: medição válida vence; senão estimativa; senão o que houver.
 * @param {any} area @param {any|undefined} ultima @param {any|undefined} descanso @param {string|null} hoje
 */
export const forragemDoPasto = (area, ultima, descanso, hoje) => {
  const parametros = parametrosDoPasto(area, area?.cultura);
  const idade = ultima && hoje ? diasEntre(dia(ultima.data_medicao), hoje) : null;
  if (ultima?.situacao && idade !== null && idade <= DIAS_VALIDADE_FORRAGEM) {
    return { situacao: ROTULO_SITUACAO[ultima.situacao], fonte: ultima.metodo === 'OLHO' ? 'medição no olho' : 'medição pela régua', data_medicao: dia(ultima.data_medicao), altura_media_cm: num(ultima.altura_media_cm) };
  }
  if (descanso?.ocupada) return { situacao: 'Em pastejo', fonte: 'lote dentro agora' };
  const saida = dia(descanso?.ultima_saida);
  const desde = saida && hoje ? diasEntre(saida, hoje) : null;
  const D = Number.isInteger(parametros.dias_descanso) ? parametros.dias_descanso : null;
  const estimada = estimarPorDescanso(desde, D);
  if (estimada) return { situacao: `${ROTULO_SITUACAO[estimada]} (estimado)`, fonte: 'dias de descanso', ultima_saida: saida, dias_desde_saida: desde, dias_descanso: D };
  if (ultima) return { situacao: 'Sem medição recente', fonte: 'medição vencida', data_medicao: dia(ultima.data_medicao) };
  return { situacao: 'Sem informação', fonte: null };
};

/**
 * Executor das ferramentas para UMA pergunta. A fazenda é conferida uma vez.
 * @param {{auth: any}} contexto auth_context da requisição
 * @param {string} empresaId fazenda aberta no mapa
 */
export const criarExecutor = async (contexto, empresaId) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresa = await exigirEmpresaDoTenant(prisma, auth.clienteId, empresaId);
  const fazenda = await prisma.empresa.findFirst({ where: { cliente_id: auth.clienteId, id: empresa }, select: { fuso_horario: true } });
  const fuso = normalizarFusoIana(fazenda?.fuso_horario) ?? 'America/Sao_Paulo';
  const hoje = diaNoFuso(agoraDoServidor(), fuso);
  const daFazenda = (/** @type {any[]} */ lista) => lista.filter((x) => x.empresa_id === empresa);

  /** Pastos com forragem calculada (sem filtro): base de listar_pastos e do resumo. */
  const pastosCompletos = async () => {
    const [areas, medicoes, descansos] = await Promise.all([
      listarAreas(contexto),
      // A última medição de CADA pasto (DISTINCT ON area_id), sem corte global de linhas.
      prisma.medicaoForragem.findMany({
        where: { cliente_id: auth.clienteId, empresa_id: empresa },
        orderBy: [{ area_id: 'asc' }, { data_medicao: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['area_id'],
        select: { area_id: true, data_medicao: true, situacao: true, metodo: true, altura_media_cm: true },
      }),
      descansoDosPastos(contexto, { empresa_id: empresa }),
    ]);
    const ultimaPorPasto = new Map();
    for (const m of medicoes) if (!ultimaPorPasto.has(m.area_id)) ultimaPorPasto.set(m.area_id, m);
    const descansoPorPasto = new Map(descansos.map((d) => [d.area_id, d]));
    return daFazenda(areas)
      .filter((a) => a.ativo !== false)
      .map((a) => {
        const p = parametrosDoPasto(a, a.cultura);
        const semForragem = USOS_SEM_FORRAGEM.has(a.tipo_cultura);
        return {
          id: a.id,
          nome: a.nome,
          setor: a.setor_nome ?? null,
          hectares: num(a.tamanho_hectares),
          uso: a.tipo_cultura ?? null,
          cultura: a.cultura?.nome ?? a.tipo_pastagem ?? null,
          cabecas_agora: num(a.quantidade_atual) ?? 0,
          altura_entrada_cm: p.altura_entrada_cm,
          altura_saida_cm: p.altura_saida_cm,
          dias_descanso: p.dias_descanso,
          forragem: semForragem ? null : forragemDoPasto(a, ultimaPorPasto.get(a.id), descansoPorPasto.get(a.id), hoje),
        };
      });
  };
  /** Situação "limpa" (sem o "(estimado)") para filtrar e agrupar. @param {any} p */
  const situacaoDe = (p) => (p.forragem?.situacao ? String(p.forragem.situacao).replace(/\s*\(estimado\)$/, '') : 'Sem informação');

  /** @param {any[]} lista @param {Record<string, any>} e */
  const filtrarPastos = (lista, e) => {
    const situacoes = e.situacao?.length ? new Set(e.situacao) : null;
    return lista.filter(
      (p) =>
        contem(p.nome, e.nome) &&
        contem(p.setor, e.setor) &&
        contem(p.cultura, e.cultura) &&
        (!situacoes || situacoes.has(situacaoDe(p))) &&
        (e.ocupado === undefined || (p.cabecas_agora > 0) === e.ocupado) &&
        naFaixa(p.hectares, e.hectares_min, e.hectares_max) &&
        naFaixa(p.cabecas_agora, e.cabecas_min, e.cabecas_max),
    );
  };

  /** @param {any[]} lista @param {Record<string, any>} e */
  const filtrarLotes = (lista, e) =>
    lista.filter(
      (g) =>
        contem(g.nome, e.nome) &&
        contem(g.categoria, e.categoria) &&
        contem(g.sexo, e.sexo) &&
        contem(g.pasto, e.pasto) &&
        naFaixa(g.cabecas, e.cabecas_min, e.cabecas_max) &&
        naFaixa(g.peso_medio_kg, e.peso_min, e.peso_max) &&
        naFaixa(g.dias_no_pasto, e.dias_no_pasto_min, e.dias_no_pasto_max) &&
        (e.acima_do_objetivo === undefined ||
          (g.peso_projetado_hoje_kg !== null && g.peso_objetivo_kg !== null && (g.peso_projetado_hoje_kg >= g.peso_objetivo_kg) === e.acima_do_objetivo)),
    );

  /** Faixa de datas (colunas DATE) para o `where` do Prisma. @param {string} coluna @param {string|undefined} de @param {string|undefined} ate */
  const periodoWhere = (coluna, de, ate) =>
    de || ate ? { [coluna]: { ...(de ? { gte: new Date(`${de}T00:00:00.000Z`) } : {}), ...(ate ? { lte: new Date(`${ate}T00:00:00.000Z`) } : {}) } } : {};

  /** @param {string|undefined} de @param {string|undefined} ate */
  const conferirPeriodo = (de, ate) => {
    if (de && ate && de > ate) throw new AppError('REQUEST_VALIDATION_FAILED', 'data_de depois de data_ate');
  };

  /** @type {Record<string, (entrada: any) => Promise<unknown>>} */
  const ferramentas = {
    listar_pastos: async (e) => {
      const lista = filtrarPastos(await pastosCompletos(), e);
      const r = ordenarECortar(
        lista,
        e,
        {
          nome: (p) => p.nome,
          setor: (p) => p.setor,
          hectares: (p) => p.hectares,
          cabecas: (p) => p.cabecas_agora,
          dias_descanso: (p) => p.dias_descanso,
          dias_desde_saida: (p) => p.forragem?.dias_desde_saida ?? null,
        },
        150,
      );
      return { total: r.total, mostrados: r.mostrados, cortado: r.cortado, pastos: r.itens };
    },
    medicoes_do_pasto: async (e) => {
      conferirPeriodo(e.data_de, e.data_ate);
      const limite = e.limite ?? 10;
      // Filtros NO banco (antes do corte): o período acha medições antigas também.
      // `where` montado só com valores já validados pelo schema; nunca SQL cru.
      const where = { cliente_id: auth.clienteId, empresa_id: empresa, area_id: String(e.area_id), ...periodoWhere('data_medicao', e.data_de, e.data_ate) };
      const [total, lista] = await Promise.all([
        prisma.medicaoForragem.count({ where }),
        prisma.medicaoForragem.findMany({ where, orderBy: [{ data_medicao: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: limite }),
      ]);
      return {
        total,
        mostrados: lista.length,
        cortado: total > lista.length,
        medicoes: lista.map((m) => ({
          data: dia(m.data_medicao),
          metodo: m.metodo === 'OLHO' ? 'no olho' : 'régua',
          altura_media_cm: num(m.altura_media_cm),
          leituras: num(m.qtd_leituras),
          situacao: m.situacao ? ROTULO_SITUACAO[m.situacao] : null,
          materia_seca_pct: num(m.materia_seca_pct),
          massa_seca_kg_ha: num(m.massa_seca_kg_ha),
          observacoes: m.observacoes ? String(m.observacoes).slice(0, 200) : null,
        })),
      };
    },
    rebanho_por_pasto: async (e) => {
      const todos = await grupos();
      const lista = filtrarLotes(todos, e);
      const r = ordenarECortar(
        lista,
        e,
        {
          nome: (g) => g.nome,
          cabecas: (g) => g.cabecas,
          peso: (g) => g.peso_medio_kg,
          peso_projetado: (g) => g.peso_projetado_hoje_kg,
          dias_no_pasto: (g) => g.dias_no_pasto,
          categoria: (g) => g.categoria,
          pasto: (g) => g.pasto,
        },
        150,
      );
      const usaDias = e.dias_no_pasto_min !== undefined || e.dias_no_pasto_max !== undefined;
      return {
        total: r.total,
        mostrados: r.mostrados,
        cortado: r.cortado,
        cabecas_no_filtro: lista.reduce((s, g) => s + g.cabecas, 0),
        // Filtro por dias no pasto deixa de fora quem não tem data de chegada conhecida.
        ...(usaDias ? { fora_por_dias_desconhecidos: todos.filter((g) => g.dias_no_pasto === null).length } : {}),
        lotes: r.itens,
      };
    },
    resumo_rebanho: async () => {
      const lista = await grupos();
      let cabecas = 0;
      let pesoTotal = 0;
      let cabecasComPeso = 0;
      /** @type {Record<string, number>} */ const porCategoria = {};
      /** @type {Record<string, number>} */ const porSexo = {};
      for (const g of lista) {
        cabecas += g.cabecas;
        if (g.peso_medio_kg !== null) { pesoTotal += g.peso_medio_kg * g.cabecas; cabecasComPeso += g.cabecas; }
        const cat = g.categoria ?? 'sem categoria';
        porCategoria[cat] = (porCategoria[cat] ?? 0) + g.cabecas;
        const sexo = g.sexo ?? 'não informado';
        porSexo[sexo] = (porSexo[sexo] ?? 0) + g.cabecas;
      }
      return {
        data: hoje,
        cabecas,
        grupos: lista.length,
        peso_medio_kg: cabecasComPeso ? Math.round((pesoTotal / cabecasComPeso) * 10) / 10 : null,
        por_categoria: porCategoria,
        por_sexo: porSexo,
      };
    },
    resumo_agrupado: async (e) => {
      if (e.origem === 'rebanho') {
        if (!['categoria', 'sexo', 'pasto'].includes(e.agrupar_por)) throw new AppError('REQUEST_VALIDATION_FAILED', 'rebanho agrupa por categoria, sexo ou pasto');
        const lista = filtrarLotes(await grupos(), { categoria: e.categoria, pasto: e.pasto });
        return {
          origem: 'rebanho',
          agrupado_por: e.agrupar_por,
          lotes: lista.length,
          cabecas: lista.reduce((s, g) => s + g.cabecas, 0),
          grupos: agrupar(lista, (g) => g[e.agrupar_por], { cabecas: (g) => g.cabecas, peso: (g) => g.peso_medio_kg }),
        };
      }
      if (!['setor', 'situacao', 'cultura'].includes(e.agrupar_por)) throw new AppError('REQUEST_VALIDATION_FAILED', 'pastos agrupam por setor, situacao ou cultura');
      const lista = filtrarPastos(await pastosCompletos(), { setor: e.setor });
      const chave = e.agrupar_por === 'situacao' ? situacaoDe : (/** @type {any} */ p) => p[e.agrupar_por];
      return {
        origem: 'pastos',
        agrupado_por: e.agrupar_por,
        pastos: lista.length,
        grupos: agrupar(lista, chave, { cabecas: (p) => p.cabecas_agora, hectares: (p) => p.hectares }),
      };
    },
    leituras_cocho_recentes: async (e) => {
      conferirPeriodo(e.data_de, e.data_ate);
      const limite = e.limite ?? 20;
      const pontos = await prisma.pontoSuplementacao.findMany({ where: { cliente_id: auth.clienteId, empresa_id: empresa }, select: { id: true, nome_ponto: true } });
      const nomes = new Map(pontos.map((p) => [p.id, p.nome_ponto]));
      // O nome do cocho vira lista de ids desta fazenda; escore e período vão no
      // `where` — tudo antes do corte, para achar leituras antigas também.
      const idsCocho = e.cocho ? pontos.filter((p) => contem(p.nome_ponto, e.cocho)).map((p) => p.id) : null;
      const where = {
        cliente_id: auth.clienteId,
        empresa_id: empresa,
        ...(idsCocho ? { ponto_suplementacao_id: { in: idsCocho } } : {}),
        ...(e.escore ? { escore: e.escore } : {}),
        ...periodoWhere('data_leitura', e.data_de, e.data_ate),
      };
      const [total, leituras] = await Promise.all([
        prisma.leituraCocho.count({ where }),
        prisma.leituraCocho.findMany({ where, orderBy: [{ data_leitura: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: limite }),
      ]);
      return {
        total,
        mostrados: leituras.length,
        cortado: total > leituras.length,
        leituras: leituras.map((l) => ({ data: dia(l.data_leitura), cocho: nomes.get(l.ponto_suplementacao_id) ?? null, escore: l.escore ?? null, acesso: l.acesso ?? null, estrutura: l.estrutura ?? null })),
      };
    },
    // Não lê dados: devolve a ação validada que a tela aplica (assistenteAcoes.js).
    aplicar_filtro_tela: async (e) => ({ acao: montarAcaoFiltro(/** @type {any} */ (e)) }),
    calcular: async (e) =>
      e.contas.map((conta) => {
        try {
          return { conta, resultado: arred(avaliarExpressao(conta), 6) };
        } catch (falha) {
          return { conta, erro: falha instanceof AppError ? falha.message : 'conta inválida' };
        }
      }),
  };

  /**
   * Desde quando cada posição do ledger está no pasto atual: a data da partida que
   * levou o saldo da posição (que é de UM pasto) de zero para positivo pela última
   * vez (entrada, transferência, junção, nascimento...). Se essa partida é da
   * implantação do ledger (saldo de abertura), a data real de chegada ao pasto não
   * é conhecida → fica de fora (null), em vez de uma data errada.
   * @param {string[]} posicaoIds
   * @returns {Promise<Map<string, string>>}
   */
  const chegadaNoPasto = async (posicaoIds) => {
    const out = new Map();
    if (!posicaoIds.length) return out;
    const partidas = await prisma.partidaRebanho.findMany({
      where: { cliente_id: auth.clienteId, empresa_id: empresa, posicao_id: { in: posicaoIds }, ativa: true },
      orderBy: [{ data_operacional: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { posicao_id: true, data_operacional: true, delta: true, evento: { select: { tipo: true, dados: true } } },
    });
    /** @type {Map<string, { saldo: number, desde: string|null }>} */
    const estado = new Map();
    for (const pt of partidas) {
      const st = estado.get(pt.posicao_id) ?? { saldo: 0, desde: null };
      const antes = st.saldo;
      st.saldo += pt.delta;
      if (antes <= 0 && st.saldo > 0) {
        const daImplantacao = pt.evento?.tipo === 'SALDO_ABERTURA' || (pt.evento?.tipo === 'ENTRADA' && Boolean(/** @type {any} */ (pt.evento?.dados)?.ativacao));
        st.desde = daImplantacao ? null : dia(pt.data_operacional);
      }
      estado.set(pt.posicao_id, st);
    }
    for (const [id, st] of estado) if (st.saldo > 0 && st.desde) out.set(id, st.desde);
    return out;
  };

  /** Grupos do rebanho: posições do ledger quando ativo; senão o cadastro de lotes. */
  const grupos = async () => {
    const pos = await listarPosicoes(contexto, { empresa_id: empresa, incluir_vazias: 'false' });
    // Sem ledger não há histórico de pasto: a data de chegada ao pasto atual é desconhecida.
    const fonte = pos.ativo ? pos.itens : daFazenda(await listarLotes(contexto)).filter((l) => l.status === 'Ativo' && Number(l.quantidade_cabecas) > 0);
    const chegada = pos.ativo ? await chegadaNoPasto(fonte.map((g) => g.id)) : new Map();
    return fonte.map((g) => {
      const noPastoDesde = pos.ativo ? chegada.get(g.id) ?? null : null;
      return {
        nome: g.nome,
        cabecas: Number(g.quantidade_cabecas) || 0,
        categoria: g.categoria_manejo_nome ?? g.categoria ?? null,
        sexo: g.sexo ?? null,
        peso_medio_kg: num(g.peso_medio_kg),
        peso_projetado_hoje_kg: g.projecao_peso?.disponivel ? num(g.projecao_peso.peso_kg) : null,
        peso_objetivo_kg: num(g.projecao_peso?.peso_objetivo_kg),
        pasto: g.area_atual_nome ?? null,
        // Entrada do lote na fazenda (compra/nascimento), NÃO no pasto atual.
        data_entrada_fazenda: dia(g.data_entrada),
        // Chegada ao pasto atual pelo ledger; null = não dá para saber.
        no_pasto_desde: noPastoDesde,
        dias_no_pasto: noPastoDesde && hoje ? diasEntre(noPastoDesde, hoje) : null,
      };
    });
  };

  const schemas = new Map(DEFINICOES_FERRAMENTAS.map((f) => [f.name, f.input_schema]));

  return {
    hoje,
    /** @param {string} nome @param {unknown} entrada */
    executar: async (nome, entrada) => {
      const fn = Object.prototype.hasOwnProperty.call(ferramentas, nome) ? ferramentas[nome] : null;
      if (!fn) return { erro: `ferramenta desconhecida: ${nome}` };
      // Fora do schema → AppError, que volta para a IA como erro da ferramenta.
      return fn(validarEntrada(schemas.get(nome), entrada ?? {}, nome));
    },
  };
};
