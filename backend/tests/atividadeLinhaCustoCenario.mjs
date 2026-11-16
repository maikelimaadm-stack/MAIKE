/**
 * D-PROD-207 (Fatia 4 do Lançamento de Atividades) — cenário comum dos testes
 * das LINHAS DE MÃO DE OBRA e DE SERVIÇO (`atividadeLinhaMaoObra.test.mjs`,
 * `atividadeLinhaServico.test.mjs`).
 *
 * Parte do cenário do abastecimento (tenant com 2 fazendas, trator com
 * horímetro, gerador sem medidor, local de estoque, `lote`, `conta`) e cria
 * DIRETO pelo Prisma (o CRUD dos cadastros é de outro módulo): funcionários
 * (D-PROD-208: parceiros com o papel `funcionario` e os dados dele), serviços
 * com unidade de medida, parceiros com e sem o papel `prestador_servico` (o
 * terceiro da mão de obra e o prestador do serviço), um com os dois papéis, um
 * tipo de atividade que permite as quatro linhas e um
 * que não permite nenhuma, um herbicida com lote (a linha de produto dos
 * totais) e uma atividade ABERTA.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { erro, http, prisma } from './patrimonioP1Cenario.mjs';
import { montarAbastecimento } from './patrimonioP1AbastecimentoCenario.mjs';

export { erro, prisma };

export const MODULO = 'suporte-mapa';
export const TELA = 'op-atividades';

/** Chave nova de operação. @param {string} [prefixo] */
export const opId = (prefixo = 'lin') => `${prefixo}-${randomUUID()}`;

/**
 * @param {import('fastify').FastifyInstance} app
 */
export const montarLinhasCusto = async (app) => {
  const s = await montarAbastecimento(app);
  const H = http(app);
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  let n = 0;
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `GRUPO ${suf}` } });
  const tipo = await p.tipoAtividade.create({
    data: {
      cliente_id: s.c, nome_tipo: `PLANTIO ${suf}`, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo,
      permite_mao_obra: true, permite_servico: true, permite_produto: true,
    },
  });
  const tipoSem = await p.tipoAtividade.create({ data: { cliente_id: s.c, nome_tipo: `VISTORIA ${suf}`, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo } });
  const unidade = await p.unidadeMedida.create({ data: { cliente_id: s.c, numero_unidade: `U${suf}`, sigla: 'ha', descricao: 'Hectare' } });
  const unidadeHora = await p.unidadeMedida.create({ data: { cliente_id: s.c, numero_unidade: `H${suf}`, sigla: 'h', descricao: 'Hora' } });

  /**
   * D-PROD-208 — o funcionário é um PARCEIRO com o papel `funcionario` e os dados dele (`cargo`, `tipo`,
   * `custo_hora`, `custo_diaria` do teste viram as colunas `funcionario_*`); `tipos` troca os papéis.
   * @param {{ id: string }} empresa @param {Record<string, any>} [extra]
   */
  const funcionario = (empresa, extra = {}) => {
    const { cargo, tipo, custo_hora, custo_diaria, tipos = ['funcionario'], ...resto } = extra;
    n += 1;
    return p.fornecedor.create({
      data: {
        cliente_id: s.c, empresa_id: empresa.id, numero_cadastro: `F${n}-${suf}`, tipo_pessoa: 'Física', nome: `Funcionário ${n}`, tipos,
        funcionario_tipo: tipo ?? 'DIARISTA', funcionario_cargo: cargo ?? null, funcionario_custo_hora: custo_hora ?? null, funcionario_custo_diaria: custo_diaria ?? null,
        ...resto,
      },
    });
  };
  /** @param {{ id: string }} empresa @param {Record<string, unknown>} [extra] */
  const servico = (empresa, extra = {}) =>
    p.servico.create({ data: { cliente_id: s.c, empresa_id: empresa.id, numero: `S${(n += 1)}-${suf}`, nome: `Serviço ${n}`, unidade_medida_id: unidade.id, ...extra } });
  /** @param {{ id: string }} empresa @param {string} nome @param {string[]} tipos @param {boolean} [ativo] */
  const parceiro = (empresa, nome, tipos, ativo = true) =>
    p.fornecedor.create({ data: { cliente_id: s.c, empresa_id: empresa.id, numero_cadastro: `PS${(n += 1)}-${suf}`, tipo_pessoa: 'Jurídica', nome, tipos, ativo } });

  const joao = await funcionario(s.e1, { nome: 'João Diarista', cargo: 'Tratorista', tipo: 'DIARISTA', custo_hora: '25.5', custo_diaria: '180' });
  const pedro = await funcionario(s.e1, { nome: 'Pedro Sem Custo', tipo: 'MENSALISTA' });
  const tiao = await funcionario(s.e1, { nome: 'Tião Terceirizado', tipo: 'TERCEIRIZADO' });
  const inativo = await funcionario(s.e1, { nome: 'Antigo Funcionário', ativo: false, custo_hora: '10' });
  const daE2 = await funcionario(s.e2, { nome: 'Funcionário da Fazenda 2', custo_hora: '10' });
  // Com os dois papéis (funcionário e prestador): vale funcionário.
  const ambos = await funcionario(s.e1, { nome: 'Zé Dos Dois Papéis', tipos: ['Prestador de Serviço', 'Funcionária'], custo_hora: '30' });

  const gradagem = await servico(s.e1, { nome: 'Gradagem terceirizada', valor_referencia: '150' });
  const horaTrator = await servico(s.e1, { nome: 'Hora de trator alugado', unidade_medida_id: unidadeHora.id });
  const servicoInativo = await servico(s.e1, { nome: 'Serviço antigo', ativo: false });
  const servicoE2 = await servico(s.e2, { nome: 'Serviço da Fazenda 2' });

  const prestador = await parceiro(s.e1, 'Prestadora Terra Boa', ['prestador_servico']);
  const prestadorAlias = await parceiro(s.e1, 'Empreiteira Alias', ['Prestador de Serviço']);
  const soFornecedor = await parceiro(s.e1, 'Só Fornecedor', ['fornecedor']);
  const semPapel = await parceiro(s.e1, 'Parceiro Antigo Sem Papel', []);
  const prestadorInativo = await parceiro(s.e1, 'Prestadora Fechada', ['prestador_servico'], false);
  const prestadorE2 = await parceiro(s.e2, 'Prestadora da Fazenda 2', ['prestador_servico']);

  const herbicida = await p.produto.create({
    data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `HB-${suf}`, nome_produto: 'Herbicida (L)', unidade_principal_estoque: 'L' },
  });
  await s.lote(s.e1, herbicida, s.local, { quantidade: '100.0000', custo: '5.0000', dia: '2027-06-01' });

  /** Abre uma atividade pela API do cabeçalho. */
  const abrir = async (extra = {}) =>
    H.ok(
      H.req('POST', '/atividades', s.token, {
        empresa_id: s.e1.id, nome: `Plantio ${randomUUID().slice(0, 4)}`, tipo_atividade_id: tipo.id, data_inicio: '2027-06-01', data_prevista_fim: '2027-06-30', ...extra,
      }),
      201
    );
  const atividade = await abrir();
  const baseAp = (/** @type {any} */ a) => `/atividades/${a.id}/apontamentos`;
  /** `POST /atividades/:id/apontamentos` (o lançamento do dia, com ou sem linhas). */
  const lancarAp = (/** @type {any} */ corpo = {}, { a = atividade, tok = s.token } = {}) =>
    H.req('POST', baseAp(a), tok, { empresa_id: a.empresa_id, data_operacional: '2027-06-10', ...corpo });
  const apontar = async (/** @type {any} */ corpo = {}, /** @type {any} */ opcoes = {}) => (await H.ok(lancarAp(corpo, opcoes), 201)).apontamento;
  const versaoDe = async (/** @type {string} */ apId) => (await p.atividadeApontamento.findUnique({ where: { id: apId } })).versao;

  /**
   * Ações de uma linha (`mao-obra` | `servicos`), com a versão atual do
   * apontamento e uma chave nova por padrão.
   * @param {'mao-obra'|'servicos'} recurso
   */
  const acoesDaLinha = (recurso) => {
    const url = (/** @type {any} */ a, /** @type {any} */ ap, linhaId = null, sufixo = '') => `${baseAp(a)}/${ap.id}/${recurso}${linhaId ? `/${linhaId}` : ''}${sufixo}`;
    /** @param {any} ap @param {Record<string, unknown>} corpo @param {any} [o] */
    const lancar = async (ap, corpo, { tok = s.token, a = atividade, versao = undefined, operation_id = opId() } = {}) =>
      H.req('POST', url(a, ap), tok, { empresa_id: a.empresa_id, versao: versao ?? (await versaoDe(ap.id)), operation_id, ...corpo });
    /** @param {any} ap @param {string} linhaId @param {Record<string, unknown>} corpo @param {any} [o] */
    const editar = async (ap, linhaId, corpo, { tok = s.token, a = atividade, versao = undefined, operation_id = opId() } = {}) =>
      H.req('PATCH', url(a, ap, linhaId), tok, { empresa_id: a.empresa_id, versao: versao ?? (await versaoDe(ap.id)), operation_id, ...corpo });
    /** @param {any} ap @param {string} linhaId @param {Record<string, unknown>} [corpo] @param {any} [o] */
    const cancelar = async (ap, linhaId, corpo = {}, { tok = s.token, a = atividade, versao = undefined, operation_id = opId() } = {}) =>
      H.req('POST', url(a, ap, linhaId, '/cancelar'), tok, { empresa_id: a.empresa_id, versao: versao ?? (await versaoDe(ap.id)), operation_id, motivo: 'lançada errada', ...corpo });
    /** @param {any} ap @param {Record<string, unknown>} corpo @param {any} [o] */
    const lancarOk = async (ap, corpo, o) => {
      const r = await lancar(ap, corpo, o);
      assert.equal(r.statusCode, 201, r.body);
      return r.json();
    };
    return { lancar, editar, cancelar, lancarOk };
  };

  const totais = (a = atividade, tok = s.token) => H.ok(H.req('GET', `/atividades/${a.id}/totais?empresa_id=${a.empresa_id}`, tok));
  const contaTela = (/** @type {Record<string, boolean>} */ acoes = {}) =>
    s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [{ modulo_id: MODULO, tela_id: TELA, visualizar: true, ...acoes }] });

  return {
    ...s, H, grupo, tipo, tipoSem, unidade, unidadeHora, funcionario, servico, parceiro,
    joao, pedro, tiao, inativo, daE2, ambos, gradagem, horaTrator, servicoInativo, servicoE2,
    prestador, prestadorAlias, soFornecedor, semPapel, prestadorInativo, prestadorE2, herbicida,
    abrir, atividade, baseAp, lancarAp, apontar, versaoDe, acoesDaLinha, totais, contaTela,
  };
};

const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
/**
 * Prova de "nada gravado": linhas de mão de obra e de serviço, apontamentos,
 * recibos e o financeiro do tenant.
 * @param {string} c
 */
export const foto = async (c) => {
  const p = prisma();
  return JSON.stringify({
    mo: await p.atividadeApontamentoMaoObra.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    sv: await p.atividadeApontamentoServico.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    ap: await p.atividadeApontamento.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    op: await p.operacaoFinanceira.count({ where: { cliente_id: c } }),
    ti: await p.tituloFinanceiro.count({ where: { cliente_id: c } }),
  }, replacer);
};
