/**
 * Assistente só de leitura (D-PROD-230) — as ferramentas que a IA pode pedir.
 *
 * Conjunto FECHADO e só de leitura. Cada ferramenta chama um serviço que já existe
 * (as mesmas leituras que o Mapa Geral faz) com o `contexto` da requisição: o tenant
 * vem SÓ do `auth_context` (R11) e a fazenda é a que o usuário tem aberta no mapa,
 * conferida contra o tenant antes de qualquer leitura. A IA escolhe a ferramenta e,
 * no máximo, um id de pasto ou um limite; nunca escreve, nunca manda SQL, nunca
 * escolhe o cliente nem a fazenda.
 *
 * As respostas são compactas e sem dados pessoais nem financeiros: nada de CPF,
 * telefone, fornecedor, nota fiscal, GTA, valor de compra ou nome de quem registrou.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { listar as listarAreas } from '../areas/areaPastagemService.js';
import { listar as listarLotes } from '../lotes/loteService.js';
import { listar as listarMedicoes, descansoDosPastos } from '../medicoesForragem/medicaoForragemService.js';
import { parametrosDoPasto, ROTULO_SITUACAO } from '../medicoesForragem/medicaoForragemCalculo.js';
import { listar as listarLeiturasCocho } from '../leiturasCocho/leituraCochoService.js';
import { listarPosicoes } from '../rebanhoLedger/rebanhoLedgerService.js';
import { agoraDoServidor, diaNoFuso, normalizarFusoIana } from '../rebanhoLedger/rebanhoLedgerTempo.js';

/** Espelho das regras do farol da tela (src/domain/pastagem/farolForragem.js, D-PROD-221/223). */
export const DIAS_VALIDADE_FORRAGEM = 15;
export const FATOR_PASSOU_DESCANSO = 1.5;
const USOS_SEM_FORRAGEM = new Set(['Infraestrutura', 'Reserva', 'APP']);

const ID_PASTO = { type: 'string', minLength: 1, maxLength: 64, description: 'id do pasto (campo "id" de listar_pastos)' };
const LIMITE = (max, descricao) => ({ type: 'integer', minimum: 1, maximum: max, description: descricao });

/** Definições enviadas à API (sem estado: o prefixo é estável para o cache). */
export const DEFINICOES_FERRAMENTAS = Object.freeze([
  {
    name: 'listar_pastos',
    description:
      'Lista os pastos (áreas) da fazenda aberta: nome, setor, hectares, cultura, alturas de entrada/saída e dias de descanso que valem, cabeças dentro agora e a situação de forragem (Rapado, Descanso, Pronto, Passou do ponto), vinda da última medição válida (até 15 dias) ou estimada pelos dias de descanso. Use para perguntas sobre pastos prontos, ocupação, descanso e forragem.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'medicoes_do_pasto',
    description: 'Medições de forragem de um pasto (mais recentes primeiro): data, método (régua ou no olho), altura média, situação e, quando houve amostra, matéria seca.',
    input_schema: {
      type: 'object',
      properties: { area_id: ID_PASTO, limite: LIMITE(30, 'quantas medições (padrão 10)') },
      required: ['area_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'rebanho_por_pasto',
    description: 'Grupos de animais (lotes) da fazenda com cabeças, categoria, sexo, peso médio, pasto onde estão e data de entrada.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'resumo_rebanho',
    description: 'Totais do rebanho da fazenda: cabeças, peso médio ponderado e a divisão por categoria e por sexo.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'leituras_cocho_recentes',
    description: 'Leituras de cocho mais recentes da fazenda: data, cocho, escore de sobra, acesso e estrutura.',
    input_schema: { type: 'object', properties: { limite: LIMITE(50, 'quantas leituras (padrão 20)') }, additionalProperties: false },
  },
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

  /** @type {Record<string, (entrada: any) => Promise<unknown>>} */
  const ferramentas = {
    listar_pastos: async () => {
      const [areas, medicoes, descansos] = await Promise.all([
        listarAreas(contexto),
        listarMedicoes(contexto, { empresa_id: empresa, limit: 2000 }),
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
    },
    medicoes_do_pasto: async (entrada) => {
      const limite = Math.min(30, Math.max(1, Number(entrada?.limite) || 10));
      const lista = await listarMedicoes(contexto, { empresa_id: empresa, area_id: String(entrada?.area_id ?? ''), limit: limite });
      return lista.map((m) => ({
        data: dia(m.data_medicao),
        metodo: m.metodo === 'OLHO' ? 'no olho' : 'régua',
        altura_media_cm: num(m.altura_media_cm),
        leituras: num(m.qtd_leituras),
        situacao: m.situacao ? ROTULO_SITUACAO[m.situacao] : null,
        materia_seca_pct: num(m.materia_seca_pct),
        massa_seca_kg_ha: num(m.massa_seca_kg_ha),
        observacoes: m.observacoes ? String(m.observacoes).slice(0, 200) : null,
      }));
    },
    rebanho_por_pasto: async () => grupos(),
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
    leituras_cocho_recentes: async (entrada) => {
      const limite = Math.min(50, Math.max(1, Number(entrada?.limite) || 20));
      const [leituras, pontos] = await Promise.all([
        listarLeiturasCocho(contexto, { empresa_id: empresa, limit: limite }),
        prisma.pontoSuplementacao.findMany({ where: { cliente_id: auth.clienteId, empresa_id: empresa }, select: { id: true, nome_ponto: true } }),
      ]);
      const nomes = new Map(pontos.map((p) => [p.id, p.nome_ponto]));
      return leituras.map((l) => ({ data: dia(l.data_leitura), cocho: nomes.get(l.ponto_suplementacao_id) ?? null, escore: l.escore ?? null, acesso: l.acesso ?? null, estrutura: l.estrutura ?? null }));
    },
  };

  /** Grupos do rebanho: posições do ledger quando ativo; senão o cadastro de lotes. */
  const grupos = async () => {
    const pos = await listarPosicoes(contexto, { empresa_id: empresa, incluir_vazias: 'false' });
    const fonte = pos.ativo ? pos.itens : daFazenda(await listarLotes(contexto)).filter((l) => Number(l.quantidade_cabecas) > 0);
    return fonte.map((g) => ({
      nome: g.nome,
      cabecas: Number(g.quantidade_cabecas) || 0,
      categoria: g.categoria_manejo_nome ?? g.categoria ?? null,
      sexo: g.sexo ?? null,
      peso_medio_kg: num(g.peso_medio_kg),
      peso_projetado_hoje_kg: g.projecao_peso?.disponivel ? num(g.projecao_peso.peso_kg) : null,
      peso_objetivo_kg: num(g.projecao_peso?.peso_objetivo_kg),
      pasto: g.area_atual_nome ?? null,
      data_entrada: dia(g.data_entrada),
    }));
  };

  return {
    hoje,
    /** @param {string} nome @param {unknown} entrada */
    executar: async (nome, entrada) => {
      const fn = Object.prototype.hasOwnProperty.call(ferramentas, nome) ? ferramentas[nome] : null;
      if (!fn) return { erro: `ferramenta desconhecida: ${nome}` };
      return fn(entrada ?? {});
    },
  };
};
