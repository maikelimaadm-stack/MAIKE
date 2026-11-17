/**
 * Serviço da Medição de Forragem (D-PROD-219), tabela física "MEDICAOFORRAGEM".
 *
 * Uma medição registra como estava o pasto num dia:
 *  - REGUA: as leituras da régua (cm) → média (1 casa) e a situação pelas alturas
 *    de entrada e de saída da cultura da área (retrato do dia, gravado junto);
 *    amostra de corte opcional → matéria verde (kg/ha), MS (%) e massa seca (kg MS/ha);
 *  - OLHO: a situação escolhida (RAPADO | DESCANSO | PRONTO | PASSOU), sem número.
 * As contas são do servidor (`medicaoForragemCalculo.js`); derivados enviados no
 * corpo nem existem no schema da rota (corpo fechado).
 *
 * Regras:
 *  - tenant só de `auth_context` (R11); a fazenda (`empresa_id`) vem do corpo e
 *    precisa ser DESTE tenant (outra ou inexistente → 404);
 *  - o pasto (`area_id`) precisa existir neste tenant e ser DESTA fazenda; área de
 *    Infraestrutura não tem forragem → 400 com `field`/`reason`
 *    (`area_inexistente`, `area_de_outra_fazenda`, `area_sem_forragem`);
 *  - a cultura é a da área no momento (nunca do corpo);
 *  - `data_medicao` AAAA-MM-DD válida e não posterior a hoje no fuso da fazenda;
 *  - `registrado_por_nome` vem da conta autenticada;
 *  - exclusão física por id do tenant (a medição não tem efeito em outro lugar).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { medicaoForragemNotFound } from '../../shared/errors/AppError.js';
import { exigirEmpresaDoTenant, invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { agoraDoServidor, diaNoFuso, normalizarFusoIana } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import {
  METODOS, SITUACOES, MAX_LEITURAS, lerLeituras, mediaDasLeituras, situacaoPelaAltura, calcularAmostra, numeroPtBR,
} from './medicaoForragemCalculo.js';
import {
  listarMedicoes, buscarMedicao, buscarArea, buscarCultura, buscarFusoDaEmpresa, buscarNomeDoUsuario, inserirMedicao, excluirMedicaoPorId,
} from './medicaoForragemRepository.js';

export { METODOS, SITUACOES };
const ENTIDADE = 'MedicaoForragem';
/** Reserva quando a fazenda não tem fuso configurado (a medição não é fato do rebanho). */
export const FUSO_RESERVA = 'America/Sao_Paulo';
const DIA = /^\d{4}-\d{2}-\d{2}$/;
/** Limites das colunas da amostra (DECIMAL do banco) — fora disso, 400 antes do banco. */
const LIMITES = Object.freeze({
  quadro_m2: { max: 999, casas: 3 },
  peso_verde_g: { max: 999999, casas: 1 },
  peso_seco_g: { max: 999999, casas: 1 },
  materia_seca_pct: { max: 100, casas: 2 },
});

/** @param {Date|string} d */
const diaDe = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
/** @param {unknown} v */
const dec = (v) => (v === null || v === undefined ? null : Number(v));

/** Formato público (data AAAA-MM-DD, decimais como número). @param {any} r */
export const comoMedicaoPublica = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  area_id: r.area_id,
  cultura_id: r.cultura_id ?? null,
  data_medicao: diaDe(r.data_medicao),
  metodo: r.metodo,
  leituras_cm: Array.isArray(r.leituras_cm) ? r.leituras_cm : null,
  qtd_leituras: r.qtd_leituras ?? null,
  altura_media_cm: dec(r.altura_media_cm),
  situacao: r.situacao ?? null,
  altura_entrada_cm: dec(r.altura_entrada_cm),
  altura_saida_cm: dec(r.altura_saida_cm),
  quadro_m2: dec(r.quadro_m2),
  qtd_amostras: r.qtd_amostras ?? null,
  peso_verde_g: dec(r.peso_verde_g),
  peso_seco_g: dec(r.peso_seco_g),
  materia_seca_pct: dec(r.materia_seca_pct),
  massa_verde_kg_ha: dec(r.massa_verde_kg_ha),
  massa_seca_kg_ha: dec(r.massa_seca_kg_ha),
  observacoes: r.observacoes ?? null,
  registrado_por_nome: r.registrado_por_nome ?? null,
  created_date: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
  updated_date: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
});

/** @param {unknown} valor */
const diaValido = (valor) => {
  if (typeof valor !== 'string' || !DIA.test(valor)) return null;
  const d = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor ? valor : null;
};

/** Valor fechado em maiúsculas. @param {unknown} v @param {string} campo @param {readonly string[]} permitidos */
const fechado = (v, campo, permitidos) => {
  const t = String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  if (!t) throw invalido(`${campo} é obrigatório`, { field: campo, reason: 'obrigatorio' });
  if (!permitidos.includes(t)) throw invalido(`${campo} deve ser um de: ${permitidos.join(', ')}`, { field: campo, reason: 'valor_invalido' });
  return t;
};

/**
 * Número positivo opcional da amostra (pt-BR), dentro do limite da coluna.
 * @param {unknown} valor @param {keyof typeof LIMITES} campo
 * @returns {number|null}
 */
const positivoOpcional = (valor, campo) => {
  const n = numeroPtBR(valor);
  if (n === null) return null;
  const { max, casas } = LIMITES[campo];
  if (Number.isNaN(n) || n <= 0 || n > max) throw invalido(`${campo} deve ser maior que 0 e no máximo ${max}`, { field: campo, reason: 'valor_fora_da_faixa' });
  const f = 10 ** casas;
  if (Math.abs(n * f - Math.round(n * f)) > 1e-6) throw invalido(`${campo} aceita no máximo ${casas} casa(s) decimal(is)`, { field: campo, reason: 'casas_decimais' });
  return n;
};

/** Inteiro positivo opcional. @param {unknown} valor @param {string} campo */
const inteiroOpcional = (valor, campo) => {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0 || n > 1000) throw invalido(`${campo} deve ser um inteiro de 1 a 1000`, { field: campo, reason: 'valor_invalido' });
  return n;
};

const CAMPOS_AMOSTRA = Object.freeze(['quadro_m2', 'qtd_amostras', 'peso_verde_g', 'peso_seco_g', 'materia_seca_pct']);

/**
 * Amostra de corte do corpo, já conferida. Nenhum campo → null.
 * @param {Record<string, unknown>} entrada
 */
const amostraDoCorpo = (entrada) => {
  const informados = CAMPOS_AMOSTRA.filter((c) => entrada[c] !== undefined && entrada[c] !== null && entrada[c] !== '');
  if (!informados.length) return null;
  const quadro = positivoOpcional(entrada.quadro_m2, 'quadro_m2');
  const verde = positivoOpcional(entrada.peso_verde_g, 'peso_verde_g');
  const seco = positivoOpcional(entrada.peso_seco_g, 'peso_seco_g');
  const pct = positivoOpcional(entrada.materia_seca_pct, 'materia_seca_pct');
  const qtd = inteiroOpcional(entrada.qtd_amostras, 'qtd_amostras');
  if (quadro === null) throw invalido('informe o tamanho do quadrado da amostra (m²)', { field: 'quadro_m2', reason: 'obrigatorio_na_amostra' });
  if (verde === null) throw invalido('informe o peso verde médio da amostra (g)', { field: 'peso_verde_g', reason: 'obrigatorio_na_amostra' });
  if (seco !== null && seco > verde) throw invalido('o peso seco não pode passar do peso verde', { field: 'peso_seco_g', reason: 'maior_que_verde' });
  return { quadro_m2: quadro, qtd_amostras: qtd ?? 1, peso_verde_g: verde, peso_seco_g: seco, materia_seca_pct_digitada: seco === null ? pct : null };
};

/**
 * @param {any} contexto auth_context da requisição (`contexto.auth`)
 * @param {{ empresa_id?: string, area_id?: string, limit?: unknown }} filtros
 */
export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarMedicoes(auth.clienteId, filtros);
  return registros.map(comoMedicaoPublica);
};

/**
 * @param {any} contexto auth_context da requisição (`contexto.auth`)
 * @param {Record<string, unknown>} entrada
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const criado = await prisma.$transaction(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);

    const areaId = typeof entrada.area_id === 'string' ? entrada.area_id.trim() : '';
    if (!areaId) throw invalido('area_id é obrigatório', { field: 'area_id', reason: 'obrigatorio' });
    const area = await buscarArea(tx, auth.clienteId, areaId);
    if (!area) throw invalido('pasto não encontrado neste tenant', { field: 'area_id', reason: 'area_inexistente' });
    if (area.empresa_id !== empresaId) throw invalido('o pasto é de outra fazenda', { field: 'area_id', reason: 'area_de_outra_fazenda' });
    if (String(area.tipo_cultura || '').toLowerCase() === 'infraestrutura') {
      throw invalido('área de infraestrutura não tem forragem para medir', { field: 'area_id', reason: 'area_sem_forragem' });
    }

    const dia = diaValido(entrada.data_medicao);
    if (!dia) throw invalido('data_medicao deve ser uma data válida (AAAA-MM-DD)', { field: 'data_medicao', reason: 'data_invalida' });
    const empresa = await buscarFusoDaEmpresa(tx, auth.clienteId, empresaId);
    const fuso = normalizarFusoIana(empresa?.fuso_horario) || FUSO_RESERVA;
    const hoje = diaNoFuso(agoraDoServidor(), fuso);
    if (dia > hoje) throw invalido(`a data ${dia} é posterior a hoje (${hoje}) na fazenda: só medição já feita`, { field: 'data_medicao', reason: 'data_futura', hoje });

    const metodo = fechado(entrada.metodo, 'metodo', METODOS);
    const cultura = area.cultura_id ? await buscarCultura(tx, auth.clienteId, area.cultura_id) : null;
    const entradaCm = cultura?.altura_entrada_cm === null || cultura?.altura_entrada_cm === undefined ? null : Number(cultura.altura_entrada_cm);
    const saidaCm = cultura?.altura_saida_cm === null || cultura?.altura_saida_cm === undefined ? null : Number(cultura.altura_saida_cm);

    /** @type {Record<string, unknown>} */
    const medidos = {};
    if (metodo === 'REGUA') {
      if (entrada.situacao !== undefined && entrada.situacao !== null && entrada.situacao !== '') {
        throw invalido('na régua a situação é calculada pela altura: não informe', { field: 'situacao', reason: 'nao_aceita' });
      }
      const { valores, invalidas } = lerLeituras(entrada.leituras_cm ?? '');
      if (invalidas.length) throw invalido(`leitura inválida: ${invalidas.slice(0, 3).join(', ')} (de 0 a 500 cm)`, { field: 'leituras_cm', reason: 'leitura_invalida' });
      if (!valores.length) throw invalido('informe ao menos uma leitura da régua (cm)', { field: 'leituras_cm', reason: 'obrigatorio' });
      if (valores.length > MAX_LEITURAS) throw invalido(`no máximo ${MAX_LEITURAS} leituras`, { field: 'leituras_cm', reason: 'leituras_demais' });
      const media = mediaDasLeituras(valores);
      const amostra = amostraDoCorpo(entrada);
      const contas = amostra
        ? calcularAmostra({ quadro_m2: amostra.quadro_m2, peso_verde_g: amostra.peso_verde_g, peso_seco_g: amostra.peso_seco_g, materia_seca_pct: amostra.materia_seca_pct_digitada })
        : null;
      Object.assign(medidos, {
        leituras_cm: valores,
        qtd_leituras: valores.length,
        altura_media_cm: media,
        situacao: situacaoPelaAltura(media, entradaCm, saidaCm),
        ...(amostra
          ? {
              quadro_m2: amostra.quadro_m2,
              qtd_amostras: amostra.qtd_amostras,
              peso_verde_g: amostra.peso_verde_g,
              peso_seco_g: amostra.peso_seco_g,
              materia_seca_pct: contas?.materia_seca_pct ?? null,
              massa_verde_kg_ha: contas?.massa_verde_kg_ha ?? null,
              massa_seca_kg_ha: contas?.massa_seca_kg_ha ?? null,
            }
          : {}),
      });
    } else {
      const comNumero = ['leituras_cm', ...CAMPOS_AMOSTRA].find((c) => {
        const v = entrada[c];
        return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
      });
      if (comNumero) throw invalido('no olho não há leitura nem amostra: use a régua para medir', { field: comNumero, reason: 'nao_aceita' });
      medidos.situacao = fechado(entrada.situacao, 'situacao', SITUACOES);
    }

    const observacoes = textoDoCorpo(entrada.observacoes, 'observacoes') ?? null;
    if (observacoes && [...observacoes].length > 2000) throw invalido('observacoes passa de 2000 caracteres', { field: 'observacoes', reason: 'tamanho_excedido' });

    const usuario = await buscarNomeDoUsuario(tx, auth.clienteId, auth.usuarioId);
    const nome = (usuario?.nome || usuario?.login || auth.login || '').trim().slice(0, 255) || null;

    const registro = await inserirMedicao(tx, {
      cliente_id: auth.clienteId,
      empresa_id: empresaId,
      area_id: area.id,
      cultura_id: cultura?.id ?? null,
      data_medicao: new Date(`${dia}T00:00:00.000Z`),
      metodo,
      altura_entrada_cm: cultura ? entradaCm : null,
      altura_saida_cm: cultura ? saidaCm : null,
      ...medidos,
      observacoes,
      registrado_por_nome: nome,
    });
    await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: comoMedicaoPublica(registro) }, tx);
    return registro;
  });
  return comoMedicaoPublica(criado);
};

/**
 * @param {any} contexto auth_context da requisição (`contexto.auth`)
 * @param {string} id
 */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    const existente = await buscarMedicao(tx, auth.clienteId, id);
    if (!existente) throw medicaoForragemNotFound();
    await excluirMedicaoPorId(tx, auth.clienteId, id);
    await registrarEvento(contexto, { acao: 'delete', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: comoMedicaoPublica(existente) }, tx);
  });
};
