/**
 * D-PROD-156 — filhos do agregado do bem: medições físicas (só BENFEITORIA) e
 * tanques de combustível (só MAQUINA/VEICULO/EQUIPAMENTO). Mudam SÓ pelo
 * POST/PATCH do bem, dentro da transação dele e depois da trava da linha do
 * bem (A5). Cada lista do corpo é o SYNC COMPLETO do estado final.
 *
 * Medições: item com `id` atualiza, sem `id` cria, ausente é REMOVIDO (é
 * atributo; a auditoria do bem registra antes/depois). O perfil de uma
 * medição gravada não muda (trocar = remover + criar). Perfil ATIVO só ao
 * acrescentar; a unidade tem de estar no perfil e o valor é normalizado na
 * canônica por fator exato. Sem principal marcada, a primeira vira principal.
 *
 * Tanques: nunca removidos (ausente → 422 `TANQUE_REMOCAO_NAO_PERMITIDA`),
 * só inativados; identificador único no bem sem diferenciar maiúsculas
 * (inclusive o de tanque inativo, que continua reservado); até 10 ATIVOS;
 * combustível só em litros, ATIVO ao ser acrescentado. Os vínculos tanque ×
 * combustível são atributos: removidos fisicamente no sync.
 *
 * Perfis e combustíveis usados são lidos com `FOR SHARE`: o PATCH do perfil
 * (que trava a linha FOR UPDATE antes de contar as medições) e a inativação
 * do combustível esperam esta escrita, e vice-versa.
 */

import { AppError } from '../../shared/errors/AppError.js';
import { dec, texto } from '../financeiro/decimalFinanceiro.js';
import { invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { PADRAO_MEDIDA, referenciaInvalida } from './bemPatrimonialRegras.js';
import { MAX_MEDICOES_POR_BEM, MAX_TANQUES_ATIVOS_POR_BEM, UNIDADE_COMBUSTIVEL_DO_TANQUE } from './patrimonioDominio.js';
import { CASAS_MEDIDA, normalizarMedicao } from './unidadesFisicas.js';

// ─── medições ───────────────────────────────────────────────────────────────

/**
 * @typedef {{ id: string|null, perfil_id: string, rotulo: string|null, valor_informado: string, unidade_informada: string,
 *   valor_normalizado: string, unidade_canonica: string, principal: boolean }} MedicaoDesejada
 */

/** Medição gravada → forma comparável (decimais na escala da coluna). */
const medicaoGravada = (m) => ({
  rotulo: m.rotulo ?? null,
  valor_informado: texto(m.valor_informado, CASAS_MEDIDA),
  unidade_informada: m.unidade_informada,
  principal: m.principal === true,
});

/** @param {any} tx @param {string} clienteId @param {string[]} ids */
const travarPerfis = async (tx, clienteId, ids) => {
  if (!ids.length) return new Map();
  await tx.$queryRaw`SELECT id FROM "PerfilMedicao" WHERE cliente_id = ${clienteId} AND id = ANY(${ids}::text[]) ORDER BY id FOR SHARE`;
  const perfis = await tx.perfilMedicao.findMany({
    where: { cliente_id: clienteId, id: { in: ids } },
    select: { id: true, dimensao: true, unidades_permitidas: true, ativo: true },
  });
  return new Map(perfis.map((p) => [p.id, p]));
};

const perfilDuplicado = (field, reason, mensagem) => new AppError('MEDICAO_PERFIL_DUPLICADO', `${mensagem}; nada foi gravado`, { details: { field, reason } });

/**
 * Valida a lista final de medições (sem gravar).
 * @param {any} tx
 * @param {string} clienteId
 * @param {Array<Record<string, any>>} pedidas  itens do corpo `{id?, perfil_id, valor, unidade, rotulo?, principal?}`
 * @param {Array<Record<string, any>>} gravadas  medições atuais do bem (PATCH) ou []
 * @returns {Promise<{ desejadas: MedicaoDesejada[], mudou: boolean }>}
 */
export const validarMedicoes = async (tx, clienteId, pedidas, gravadas) => {
  if (pedidas.length > MAX_MEDICOES_POR_BEM) {
    throw new AppError('MEDICAO_LIMITE_EXCEDIDO', `um bem tem no máximo ${MAX_MEDICOES_POR_BEM} medições; nada foi gravado`, {
      details: { field: 'medicoes', reason: 'limite', maximo: MAX_MEDICOES_POR_BEM },
    });
  }
  const porId = new Map(gravadas.map((m) => [m.id, m]));
  pedidas.forEach((item, i) => {
    if (!item.id) return;
    const gravada = porId.get(item.id);
    if (!gravada) throw referenciaInvalida(`medicoes[${i}].id`, 'inexistente', 'medição não encontrada neste bem');
    if (gravada.perfil_id !== item.perfil_id) {
      throw perfilDuplicado(`medicoes[${i}].perfil_id`, 'perfil_imutavel', 'o perfil de uma medição gravada não muda: remova a medição e crie outra');
    }
  });
  const perfisPedidos = new Set();
  pedidas.forEach((item, i) => {
    if (perfisPedidos.has(item.perfil_id)) throw perfilDuplicado(`medicoes[${i}].perfil_id`, 'perfil_repetido', 'o mesmo perfil de medição aparece mais de uma vez no bem');
    perfisPedidos.add(item.perfil_id);
  });
  if (pedidas.filter((m) => m.principal === true).length > 1) {
    throw new AppError('MEDICAO_PRINCIPAL_DUPLICADA', 'marque no máximo uma medição como principal; nada foi gravado', {
      details: { field: 'medicoes', reason: 'principal_duplicada' },
    });
  }
  const perfis = await travarPerfis(tx, clienteId, [...perfisPedidos]);
  const perfisDoBem = new Set(gravadas.map((m) => m.perfil_id));
  const principal = Math.max(0, pedidas.findIndex((m) => m.principal === true));
  /** @type {MedicaoDesejada[]} */
  const desejadas = pedidas.map((item, i) => {
    const perfil = perfis.get(item.perfil_id);
    if (!perfil) throw referenciaInvalida(`medicoes[${i}].perfil_id`, 'inexistente', 'perfil de medição não encontrado');
    if (!perfil.ativo && !perfisDoBem.has(perfil.id)) throw referenciaInvalida(`medicoes[${i}].perfil_id`, 'inativo', 'perfil de medição inativo não pode ser acrescentado');
    return {
      id: item.id ?? null,
      perfil_id: perfil.id,
      rotulo: textoDoCorpo(item.rotulo, `medicoes[${i}].rotulo`) ?? null,
      ...normalizarMedicao(perfil, item.valor, item.unidade, `medicoes[${i}]`),
      principal: i === principal,
    };
  });
  const mudou =
    desejadas.length !== gravadas.length ||
    desejadas.some((d) => {
      if (!d.id) return true;
      const g = medicaoGravada(porId.get(d.id));
      return g.rotulo !== d.rotulo || g.valor_informado !== d.valor_informado || g.unidade_informada !== d.unidade_informada || g.principal !== d.principal;
    });
  return { desejadas, mudou };
};

/**
 * Sync das medições (A5.4): remove as ausentes, zera o `principal` das
 * mantidas, atualiza as mantidas que mudaram, cria as novas e marca a
 * principal por último — trocar a principal nunca colide no unique
 * `(cliente_id, bem_id, principal)`. Chame `validarMedicoes` antes.
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} bemId
 * @param {MedicaoDesejada[]} desejadas
 * @param {Array<Record<string, any>>} gravadas
 */
export const sincronizarMedicoes = async (tx, clienteId, bemId, desejadas, gravadas) => {
  const base = { cliente_id: clienteId, bem_id: bemId };
  const mantidas = new Set(desejadas.filter((d) => d.id).map((d) => d.id));
  const remover = gravadas.filter((m) => !mantidas.has(m.id)).map((m) => m.id);
  if (remover.length) await tx.medicaoBem.deleteMany({ where: { ...base, id: { in: remover } } });
  await tx.medicaoBem.updateMany({ where: { ...base, principal: true }, data: { principal: null } });
  const porId = new Map(gravadas.map((m) => [m.id, medicaoGravada(m)]));
  for (const d of desejadas) {
    if (!d.id) continue;
    const g = porId.get(d.id);
    if (g.rotulo === d.rotulo && g.valor_informado === d.valor_informado && g.unidade_informada === d.unidade_informada) continue;
    await tx.medicaoBem.updateMany({
      where: { ...base, id: d.id },
      data: {
        rotulo: d.rotulo,
        valor_informado: d.valor_informado,
        unidade_informada: d.unidade_informada,
        valor_normalizado: d.valor_normalizado,
        unidade_canonica: d.unidade_canonica,
      },
    });
  }
  const novas = desejadas.filter((d) => !d.id);
  if (novas.length) {
    await tx.medicaoBem.createMany({
      data: novas.map((d) => ({
        ...base,
        perfil_id: d.perfil_id,
        rotulo: d.rotulo,
        valor_informado: d.valor_informado,
        unidade_informada: d.unidade_informada,
        valor_normalizado: d.valor_normalizado,
        unidade_canonica: d.unidade_canonica,
        principal: null,
      })),
    });
  }
  const principal = desejadas.find((d) => d.principal);
  if (principal) await tx.medicaoBem.updateMany({ where: { ...base, perfil_id: principal.perfil_id }, data: { principal: true } });
};

// ─── tanques ────────────────────────────────────────────────────────────────

/**
 * @typedef {{ id: string|null, identificador: string, capacidade_litros: string, observacao: string|null, ativo: boolean,
 *   combustivel_ids: string[] }} TanqueDesejado
 */

/** @param {any} tx @param {string} clienteId @param {string[]} ids */
const travarCombustiveis = async (tx, clienteId, ids) => {
  if (!ids.length) return new Map();
  await tx.$queryRaw`SELECT id FROM "TipoCombustivel" WHERE cliente_id = ${clienteId} AND id = ANY(${ids}::text[]) ORDER BY id FOR SHARE`;
  const combustiveis = await tx.tipoCombustivel.findMany({ where: { cliente_id: clienteId, id: { in: ids } }, select: { id: true, unidade: true, ativo: true } });
  return new Map(combustiveis.map((c) => [c.id, c]));
};

const combustivelObrigatorio = (i, reason, mensagem) =>
  new AppError('TANQUE_COMBUSTIVEL_OBRIGATORIO', `${mensagem}; nada foi gravado`, { details: { field: `tanques[${i}].combustivel_ids`, reason } });

const idsVinculados = (tanque) => tanque.combustiveis.map((c) => c.combustivel_id);
const mesmoConjunto = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Valida a lista final de tanques (sem gravar).
 * @param {any} tx
 * @param {string} clienteId
 * @param {Array<Record<string, any>>} pedidos  itens do corpo `{id?, identificador, capacidade_litros, combustivel_ids, observacao?, ativo?}`
 * @param {Array<Record<string, any>>} gravados  tanques atuais do bem (com `combustiveis[].combustivel_id`) ou []
 * @returns {Promise<{ desejados: TanqueDesejado[], mudou: boolean }>}
 */
export const validarTanques = async (tx, clienteId, pedidos, gravados) => {
  const porId = new Map(gravados.map((t) => [t.id, t]));
  const citados = new Set();
  pedidos.forEach((item, i) => {
    if (!item.id) {
      if (item.ativo === false) throw invalido('tanque novo nasce ativo: não envie ativo false sem id', { field: `tanques[${i}].ativo`, reason: 'tanque_novo_inativo' });
      return;
    }
    if (!porId.has(item.id)) throw referenciaInvalida(`tanques[${i}].id`, 'inexistente', 'tanque não encontrado neste bem');
    if (citados.has(item.id)) throw referenciaInvalida(`tanques[${i}].id`, 'repetido', 'o mesmo tanque aparece mais de uma vez');
    citados.add(item.id);
  });
  const ausente = gravados.find((t) => !citados.has(t.id));
  if (ausente) {
    throw new AppError('TANQUE_REMOCAO_NAO_PERMITIDA', 'um tanque gravado não sai do bem: inative o tanque; nada foi gravado', {
      details: { field: 'tanques', reason: 'tanque_ausente', tanque_id: ausente.id },
    });
  }
  const identificadores = new Set();
  /** @type {TanqueDesejado[]} */
  const desejados = pedidos.map((item, i) => {
    const gravado = item.id ? porId.get(item.id) : null;
    const identificador = /** @type {string} */ (textoDoCorpo(item.identificador, `tanques[${i}].identificador`, { obrigatorio: true })).replace(/\s+/g, ' ');
    const chave = identificador.toLowerCase();
    if (identificadores.has(chave)) {
      throw new AppError('TANQUE_IDENTIFICADOR_DUPLICADO', 'dois tanques do bem com o mesmo identificador; nada foi gravado', {
        details: { field: `tanques[${i}].identificador`, reason: 'identificador_repetido' },
      });
    }
    identificadores.add(chave);
    const capacidade = item.capacidade_litros;
    if (typeof capacidade !== 'string' || !PADRAO_MEDIDA.test(capacidade) || dec(capacidade).lte(0)) {
      throw new AppError('TANQUE_CAPACIDADE_INVALIDA', 'a capacidade do tanque deve ser maior que zero, em litros, com até 4 casas; nada foi gravado', {
        details: { field: `tanques[${i}].capacidade_litros`, reason: 'capacidade_invalida' },
      });
    }
    const ativo = typeof item.ativo === 'boolean' ? item.ativo : gravado ? gravado.ativo : true;
    const combustivelIds = Array.isArray(item.combustivel_ids) ? item.combustivel_ids.map(String) : [];
    if (new Set(combustivelIds).size !== combustivelIds.length) throw combustivelObrigatorio(i, 'repetido', 'o mesmo combustível aparece mais de uma vez no tanque');
    if (ativo && combustivelIds.length === 0) throw combustivelObrigatorio(i, 'vazio', 'informe ao menos um combustível aceito pelo tanque');
    return {
      id: item.id ?? null,
      identificador,
      capacidade_litros: dec(capacidade).toFixed(CASAS_MEDIDA),
      observacao: textoDoCorpo(item.observacao, `tanques[${i}].observacao`) ?? null,
      ativo,
      combustivel_ids: combustivelIds,
    };
  });
  const ativos = desejados.filter((t) => t.ativo).length;
  if (ativos > MAX_TANQUES_ATIVOS_POR_BEM) {
    throw new AppError('TANQUE_LIMITE_EXCEDIDO', `um bem tem no máximo ${MAX_TANQUES_ATIVOS_POR_BEM} tanques ativos; nada foi gravado`, {
      details: { field: 'tanques', reason: 'limite', maximo: MAX_TANQUES_ATIVOS_POR_BEM },
    });
  }
  const combustiveis = await travarCombustiveis(tx, clienteId, [...new Set(desejados.flatMap((t) => t.combustivel_ids))]);
  desejados.forEach((t, i) => {
    const vinculados = t.id ? idsVinculados(porId.get(t.id)) : [];
    const field = `tanques[${i}].combustivel_ids`;
    for (const id of t.combustivel_ids) {
      const c = combustiveis.get(id);
      if (!c) throw referenciaInvalida(field, 'inexistente', 'combustível não encontrado', { combustivel_id: id });
      if (!c.ativo && !vinculados.includes(id)) throw referenciaInvalida(field, 'inativo', 'combustível inativo não pode ser acrescentado ao tanque', { combustivel_id: id });
      if (c.unidade !== UNIDADE_COMBUSTIVEL_DO_TANQUE) {
        throw new AppError('TANQUE_COMBUSTIVEL_INCOMPATIVEL', 'o tanque só aceita combustível medido em litros (L) neste cadastro; nada foi gravado', {
          details: { field, reason: 'unidade_incompativel', combustivel_id: id, unidade: c.unidade },
        });
      }
    }
  });
  const mudou =
    desejados.length !== gravados.length ||
    desejados.some((t) => {
      if (!t.id) return true;
      const g = porId.get(t.id);
      return (
        g.identificador !== t.identificador ||
        texto(g.capacidade_litros, CASAS_MEDIDA) !== t.capacidade_litros ||
        (g.observacao ?? null) !== t.observacao ||
        g.ativo !== t.ativo ||
        !mesmoConjunto(idsVinculados(g), t.combustivel_ids)
      );
    });
  return { desejados, mudou };
};

/**
 * Sync dos tanques (A5.5): identificadores alterados passam primeiro por um
 * temporário único ` ~<id>` (cabe em 40) e depois recebem o final — trocar o
 * identificador entre dois tanques nunca colide no unique. O espaço inicial
 * torna o temporário inalcançável pelo corpo (`textoDoCorpo` apara): mesmo um
 * identificador digitado `~<id de outro tanque>` nunca colide com ele; atualiza
 * capacidade, observação e situação; sincroniza os vínculos com combustível
 * (removidos fisicamente); cria os tanques novos. Chame `validarTanques` antes.
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} bemId
 * @param {TanqueDesejado[]} desejados
 * @param {Array<Record<string, any>>} gravados
 */
export const sincronizarTanques = async (tx, clienteId, bemId, desejados, gravados) => {
  const base = { cliente_id: clienteId, bem_id: bemId };
  const porId = new Map(gravados.map((t) => [t.id, t]));
  const existentes = desejados.filter((t) => t.id);
  for (const t of existentes) {
    if (porId.get(t.id).identificador !== t.identificador) {
      await tx.tanqueBem.updateMany({ where: { ...base, id: t.id }, data: { identificador: ` ~${t.id}` } });
    }
  }
  for (const t of existentes) {
    const g = porId.get(t.id);
    /** @type {Record<string, unknown>} */
    const dados = {};
    if (g.identificador !== t.identificador) dados.identificador = t.identificador;
    if (texto(g.capacidade_litros, CASAS_MEDIDA) !== t.capacidade_litros) dados.capacidade_litros = t.capacidade_litros;
    if ((g.observacao ?? null) !== t.observacao) dados.observacao = t.observacao;
    if (g.ativo !== t.ativo) dados.ativo = t.ativo;
    if (Object.keys(dados).length) await tx.tanqueBem.updateMany({ where: { ...base, id: t.id }, data: dados });
    const vinculados = idsVinculados(g);
    const remover = vinculados.filter((id) => !t.combustivel_ids.includes(id));
    if (remover.length) await tx.tanqueBemCombustivel.deleteMany({ where: { cliente_id: clienteId, tanque_id: t.id, combustivel_id: { in: remover } } });
    const criar = t.combustivel_ids.filter((id) => !vinculados.includes(id));
    if (criar.length) {
      await tx.tanqueBemCombustivel.createMany({ data: criar.map((combustivelId) => ({ cliente_id: clienteId, tanque_id: t.id, combustivel_id: combustivelId })) });
    }
  }
  for (const t of desejados.filter((d) => !d.id)) {
    const novo = await tx.tanqueBem.create({
      data: { ...base, identificador: t.identificador, capacidade_litros: t.capacidade_litros, observacao: t.observacao, ativo: true },
      select: { id: true },
    });
    await tx.tanqueBemCombustivel.createMany({ data: t.combustivel_ids.map((combustivelId) => ({ cliente_id: clienteId, tanque_id: novo.id, combustivel_id: combustivelId })) });
  }
};
