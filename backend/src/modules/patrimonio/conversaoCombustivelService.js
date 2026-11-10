/**
 * D-PROD-159 (Patrimônio P1-02) — fator de conversão kg/L INFORMADO pelo
 * responsável, por EMPRESA × tipo de combustível × produto (o par do vínculo
 * R2). Parâmetro operacional, NUNCA densidade presumida: nada é inferido do
 * nome, do combustível, do preço ou de fonte externa, e a declaração de que o
 * estoque do produto está em KG é obrigatória.
 *
 * Versionado: alterar o fator = encerrar a vigente + criar a próxima
 * `sequencia`, sob a MESMA trava do vínculo (`chaveVinculo`) que o
 * abastecimento e a inativação do vínculo usam. No máximo UMA vigente por par
 * (`ativo_chave` true|NULL + unique). Linhas imutáveis salvo o encerramento.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento, registrarEventosEmLote } from '../auditoria/auditService.js';
import { dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, iso, travarEscopo } from '../gestao/gestaoComum.js';
import { CASAS_FATOR, ENTIDADE_CONVERSAO, FATOR_MAXIMO, normalizarConversao } from './abastecimentoPlano.js';
import { chaveVinculo } from './combustivelProdutoService.js';
import { exigirVersao, listarKeyset } from './patrimonioComum.js';

// ─── erros ──────────────────────────────────────────────────────────────────

export const naoEncontrado = () => new AppError('CONVERSAO_COMBUSTIVEL_NAO_ENCONTRADA', 'fator kg/L não encontrado nesta fazenda');
const MENSAGENS_INVALIDO = Object.freeze({
  tipo_inexistente: 'tipo de combustível não encontrado; nada foi gravado',
  tipo_inativo: 'o tipo de combustível está inativo; nada foi gravado',
  inexistente: 'produto não encontrado nesta fazenda; nada foi gravado',
  outra_empresa: 'o produto pertence a outra fazenda; nada foi gravado',
  inativo: 'o produto está inativo; nada foi gravado',
  sem_vinculo_ativo: 'o produto não tem vínculo ativo com este tipo de combustível nesta fazenda: vincule-o antes de configurar o fator; nada foi gravado',
});
/** @param {'tipo_combustivel_id'|'produto_id'} field @param {keyof typeof MENSAGENS_INVALIDO} reason */
const invalido = (field, reason) => new AppError('COMBUSTIVEL_PRODUTO_INVALIDO', MENSAGENS_INVALIDO[reason], { details: { field, reason } });
/** @param {{id: string, versao: number}|null} vigente */
const alterada = (vigente) =>
  new AppError('ABASTECIMENTO_CONVERSAO_ALTERADA', 'o fator kg/L vigente mudou desde a leitura: recarregue e tente de novo; nada foi gravado', {
    details: { field: 'conversao_vigente_id', reason: 'vigente_divergente', conversao_vigente_id: vigente?.id ?? null, conversao_vigente_versao: vigente?.versao ?? null },
  });
const conversaoInvalida = (field, reason, mensagem) => new AppError('ABASTECIMENTO_CONVERSAO_INVALIDA', `${mensagem}; nada foi gravado`, { details: { field, reason } });

// ─── formas públicas e auditoria ────────────────────────────────────────────

const INCLUIR = Object.freeze({
  vinculo: { select: { tipoCombustivel: { select: { id: true, codigo: true, nome: true } }, produto: { select: { id: true, nome_produto: true, unidade_principal_estoque: true } } } },
  criadoPor: { select: { id: true, login: true } },
  encerradoPor: { select: { id: true, login: true } },
});
const usuarioPublico = (u) => (u ? { id: u.id, login: u.login } : null);

/** @param {any} r linha com `INCLUIR` */
export const comoConversaoPublica = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  tipo_combustivel: { id: r.vinculo.tipoCombustivel.id, codigo: r.vinculo.tipoCombustivel.codigo, nome: r.vinculo.tipoCombustivel.nome },
  produto: { id: r.vinculo.produto.id, nome: r.vinculo.produto.nome_produto, unidade_principal_estoque: r.vinculo.produto.unidade_principal_estoque },
  sequencia: r.sequencia,
  kg_por_litro: dec(r.kg_por_litro).toFixed(CASAS_FATOR),
  declara_estoque_em_kg: r.declara_estoque_em_kg,
  ativo: r.ativo,
  versao: r.versao,
  encerrado_em: iso(r.encerrado_em),
  criado_por: usuarioPublico(r.criadoPor),
  encerrado_por: usuarioPublico(r.encerradoPor),
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

/** Allowlist (identidades, fator e situação). @param {any} r */
const paraAuditoria = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  tipo_combustivel_id: r.tipo_combustivel_id,
  produto_id: r.produto_id,
  sequencia: r.sequencia,
  kg_por_litro: dec(r.kg_por_litro).toFixed(CASAS_FATOR),
  declara_estoque_em_kg: r.declara_estoque_em_kg,
  ativo: r.ativo,
  versao: r.versao,
});

const buscar = (db, cli, empresaId, id) => db.conversaoCombustivelProduto.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id }, include: INCLUIR });

/** Corrida perdida nos uniques do par (barreira final; com a trava não deveria ocorrer). */
const UNICOS = Object.freeze({
  par_vigente: () => alterada(null),
  par_sequencia: () => alterada(null),
  ativo_chave: () => alterada(null),
  sequencia: () => alterada(null),
});

// ─── API ────────────────────────────────────────────────────────────────────

/** A13: fatores da empresa (keyset createdAt desc, id desc). @param {any} contexto @param {Record<string, any>} [query] */
export const listar = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  /** @type {Record<string, any>} */
  const where = { cliente_id: auth.clienteId, empresa_id: empresaId };
  if (typeof query.tipo_combustivel_id === 'string' && query.tipo_combustivel_id) where.tipo_combustivel_id = query.tipo_combustivel_id;
  if (typeof query.produto_id === 'string' && query.produto_id) where.produto_id = query.produto_id;
  if (query.situacao === 'VIGENTES') where.ativo = true;
  return listarKeyset(prisma.conversaoCombustivelProduto, { where, busca: [], query, include: INCLUIR, mapItem: comoConversaoPublica });
};

/** Encerra a vigente por CAS (`versao`); count ≠ 1 → 409 ALTERADA. */
const encerrarVigente = async (tx, cli, vigente, usuarioId) => {
  const r = await tx.conversaoCombustivelProduto.updateMany({
    where: { cliente_id: cli, id: vigente.id, versao: vigente.versao, ativo: true },
    data: { ativo: false, ativo_chave: null, encerrado_em: new Date(), encerrado_por_usuario_id: usuarioId ?? null, versao: { increment: 1 } },
  });
  if (r.count !== 1) throw alterada(vigente);
};

/**
 * A14: cria a PRÓXIMA versão do fator do par (encerrando a vigente, se houver).
 * `conversao_vigente_id` = a vigente vista pela tela (null = nenhuma).
 * @param {any} contexto @param {Record<string, any>} corpo
 */
export const criar = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const e = normalizarConversao(corpo);
  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, e.empresa_id);
      await travarEscopo(tx, chaveVinculo(cli, empresaId, e.produto_id));
      const [tipo] = /** @type {Array<{id: string, ativo: boolean, unidade: string}>} */ (
        await tx.$queryRaw`SELECT id, ativo, unidade FROM "TipoCombustivel" WHERE cliente_id = ${cli} AND id = ${e.tipo_combustivel_id} FOR KEY SHARE`
      );
      if (!tipo) throw invalido('tipo_combustivel_id', 'tipo_inexistente');
      if (!tipo.ativo) throw invalido('tipo_combustivel_id', 'tipo_inativo');
      if (tipo.unidade !== 'L') {
        throw new AppError('TANQUE_COMBUSTIVEL_INCOMPATIVEL', 'este combustível não é medido em litros: não há fator kg/L para ele; nada foi gravado', {
          details: { field: 'tipo_combustivel_id', reason: 'unidade_nao_litro', unidade: tipo.unidade },
        });
      }
      const vinculo = await tx.tipoCombustivelProduto.findFirst({
        where: { cliente_id: cli, empresa_id: empresaId, tipo_combustivel_id: tipo.id, produto_id: e.produto_id },
        select: { id: true, ativo: true },
      });
      if (!vinculo || !vinculo.ativo) throw invalido('produto_id', 'sem_vinculo_ativo');
      const [produto] = /** @type {Array<{id: string, empresa_id: string, ativo: boolean, unidade_principal_estoque: string}>} */ (
        await tx.$queryRaw`SELECT id, empresa_id, ativo, unidade_principal_estoque FROM "Produto" WHERE cliente_id = ${cli} AND id = ${e.produto_id} FOR KEY SHARE`
      );
      if (!produto) throw invalido('produto_id', 'inexistente');
      if (produto.empresa_id !== empresaId) throw invalido('produto_id', 'outra_empresa');
      if (!produto.ativo) throw invalido('produto_id', 'inativo');
      if (produto.unidade_principal_estoque !== 'KG') {
        throw new AppError('ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', `o estoque do produto está em ${produto.unidade_principal_estoque}, não em KG: o fator kg/L não se aplica; nada foi gravado`, {
          details: { field: 'produto_id', reason: 'unidade_estoque_nao_kg', unidade: produto.unidade_principal_estoque },
        });
      }
      const fator = dec(e.kg_por_litro);
      if (!fator.gt(0)) throw conversaoInvalida('kg_por_litro', 'fator_nao_positivo', 'o fator kg/L deve ser maior que zero');
      if (fator.gt(FATOR_MAXIMO)) throw conversaoInvalida('kg_por_litro', 'fator_acima_do_teto', 'o fator kg/L deve ser no máximo 10');
      if (e.declara_estoque_em_kg !== true) {
        throw conversaoInvalida('declara_estoque_em_kg', 'declaracao_obrigatoria', 'confirme que o estoque deste produto está em KG');
      }
      const [vigente] = /** @type {Array<{id: string, versao: number, sequencia: number}>} */ (
        await tx.$queryRaw`SELECT id, versao, sequencia FROM "ConversaoCombustivelProduto"
          WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND tipo_combustivel_id = ${tipo.id} AND produto_id = ${produto.id} AND ativo
          FOR UPDATE`
      );
      if ((vigente?.id ?? null) !== e.conversao_vigente_id) throw alterada(vigente ?? null);
      /** @type {Array<{acao: string, entidade: string, entidadeId: string, dadosAnteriores?: unknown, dadosNovos?: unknown}>} */
      const eventos = [];
      if (vigente) {
        const antes = await buscar(tx, cli, empresaId, vigente.id);
        await encerrarVigente(tx, cli, vigente, auth.usuarioId);
        const depois = await buscar(tx, cli, empresaId, vigente.id);
        eventos.push({ acao: 'conversao_combustivel.encerrar', entidade: ENTIDADE_CONVERSAO, entidadeId: vigente.id, dadosAnteriores: paraAuditoria(antes), dadosNovos: paraAuditoria(depois) });
      }
      const maximo = await tx.conversaoCombustivelProduto.aggregate({
        where: { cliente_id: cli, empresa_id: empresaId, tipo_combustivel_id: tipo.id, produto_id: produto.id },
        _max: { sequencia: true },
      });
      const criada = await tx.conversaoCombustivelProduto.create({
        data: {
          cliente_id: cli,
          empresa_id: empresaId,
          tipo_combustivel_id: tipo.id,
          produto_id: produto.id,
          sequencia: (maximo._max.sequencia ?? 0) + 1,
          kg_por_litro: fator.toFixed(CASAS_FATOR),
          declara_estoque_em_kg: true,
          ativo: true,
          ativo_chave: true,
          criado_por_usuario_id: auth.usuarioId ?? null,
          versao: 1,
        },
        include: INCLUIR,
      });
      eventos.push({ acao: 'conversao_combustivel.criar', entidade: ENTIDADE_CONVERSAO, entidadeId: criada.id, dadosNovos: paraAuditoria(criada) });
      await registrarEventosEmLote(contexto, eventos, tx);
      return comoConversaoPublica(criada);
    },
    UNICOS,
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

/**
 * A15: encerra o fator (sem sucessor: o próximo abastecimento recusa com
 * ABASTECIMENTO_CONVERSAO_AUSENTE). Já encerrado → 200 sem escrita.
 * @param {any} contexto @param {string} id @param {{ empresa_id: string, versao: number }} corpo
 */
export const encerrar = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const previa = await tx.conversaoCombustivelProduto.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id }, select: { produto_id: true } });
      if (!previa) throw naoEncontrado();
      await travarEscopo(tx, chaveVinculo(cli, empresaId, previa.produto_id));
      await tx.$queryRaw`SELECT id FROM "ConversaoCombustivelProduto" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`;
      const antes = await buscar(tx, cli, empresaId, id);
      if (!antes) throw naoEncontrado();
      exigirVersao(antes, corpo.versao);
      if (!antes.ativo) return comoConversaoPublica(antes);
      await encerrarVigente(tx, cli, { id: antes.id, versao: antes.versao }, auth.usuarioId);
      const depois = await buscar(tx, cli, empresaId, id);
      await registrarEvento(
        contexto,
        { acao: 'conversao_combustivel.encerrar', entidade: ENTIDADE_CONVERSAO, entidadeId: id, dadosAnteriores: paraAuditoria(antes), dadosNovos: paraAuditoria(depois) },
        tx
      );
      return comoConversaoPublica(depois);
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};
