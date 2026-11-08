/**
 * D-PROD-154 — perfil financeiro da empresa (onboarding obrigatório da Central
 * Única de Lançamentos): país (metadado), moeda e locale do catálogo FECHADO.
 *
 *  - leitura: quem vê a tela; devolve também o fuso da empresa (o navegador
 *    calcula "hoje" nele) e o catálogo;
 *  - escrita: administrador real OU `Permissao.is_admin` (§8.6), com trava da
 *    linha (FOR UPDATE) antes de contar o que impede trocar a moeda:
 *      · qualquer `OperacaoFinanceira` da empresa (`operacoes_existentes`);
 *      · moeda ≠ BRL com lote de estoque de custo > 0 (`estoque_legado_brl`:
 *        os custos FIFO legados são BRL implícito; a fila FIFO não mistura moedas).
 *    A primeira gravação segue a mesma regra do estoque legado.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_LONGA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirEmpresaDoTenant, invalido, travarEscopo } from '../gestao/gestaoComum.js';
import { normalizarFusoIana } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { MOEDAS, PAISES, VERSAO_CONTRATO, casasDaMoeda, catalogoPublico, localeSuportado, metodosPermitidos } from './financeiroCatalogo.js';

export const ENTIDADE_PERFIL = 'PerfilFinanceiroEmpresa';

/** @param {any} p */
export const comoPerfilPublico = (p) => ({
  empresa_id: p.empresa_id,
  pais: p.pais,
  moeda: p.moeda,
  moeda_casas: casasDaMoeda(p.moeda),
  locale: p.locale,
  versao_contrato: p.versao_contrato,
  metodos_permitidos: [...metodosPermitidos(p)],
});

export const obterPerfil = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const perfil = await prisma.perfilFinanceiroEmpresa.findUnique({ where: { cliente_id_empresa_id: { cliente_id: auth.clienteId, empresa_id: empresaId } } });
  const empresa = await prisma.empresa.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: empresaId } }, select: { fuso_horario: true } });
  return { perfil: perfil ? comoPerfilPublico(perfil) : null, fuso_horario: normalizarFusoIana(empresa?.fuso_horario), catalogo: catalogoPublico() };
};

const moedaEmUso = (reason, details) =>
  new AppError('PERFIL_FINANCEIRO_MOEDA_EM_USO', reason === 'operacoes_existentes'
    ? 'a moeda não muda depois que a empresa tem lançamentos; nada foi gravado'
    : 'a empresa tem estoque com custo registrado em BRL; a moeda do perfil precisa ser BRL; nada foi gravado', {
    details: { field: 'moeda', reason, ...details },
  });

/** PUT — cria ou atualiza o perfil (país e locale mudam livremente; moeda, com as travas). */
export const definirPerfil = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  if (!PAISES.includes(corpo.pais)) throw invalido('país fora do catálogo', { field: 'pais', reason: 'pais_nao_suportado', suportados: [...PAISES] });
  if (!Object.prototype.hasOwnProperty.call(MOEDAS, corpo.moeda)) {
    throw invalido('moeda fora do catálogo', { field: 'moeda', reason: 'moeda_nao_suportada', suportadas: Object.keys(MOEDAS) });
  }
  if (!localeSuportado(corpo.locale)) throw invalido('idioma/formato fora do catálogo', { field: 'locale', reason: 'locale_nao_suportado' });
  const cli = auth.clienteId;
  // §8.4: a linha do perfil fica em FOR SHARE durante confirmação, rascunho e
  // liquidação (até 30 s); o FOR UPDATE daqui espera em vez de estourar os 5 s
  // padrão (500). Valores absolutos: repetir depois do 409 de corrida perdida
  // leva ao mesmo perfil.
  return emTransacao(TRANSACAO_LONGA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
    // A primeira gravação não tem linha para travar: a trava de escopo serializa.
    await travarEscopo(tx, `financeiro:perfil:${cli}:${empresaId}`);
    const [atual] = /** @type {any[]} */ (
      await tx.$queryRaw`SELECT id, empresa_id, pais, moeda, locale, versao_contrato FROM "PerfilFinanceiroEmpresa"
        WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} FOR UPDATE`
    );
    if (!atual || atual.moeda !== corpo.moeda) {
      if (atual) {
        const operacoes = await tx.operacaoFinanceira.count({ where: { cliente_id: cli, empresa_id: empresaId } });
        if (operacoes > 0) throw moedaEmUso('operacoes_existentes', { operacoes });
      }
      if (corpo.moeda !== 'BRL') {
        const lotes = await tx.estoqueLoteNota.count({ where: { cliente_id: cli, empresa_id: empresaId, custo_unitario: { gt: 0 } } });
        if (lotes > 0) throw moedaEmUso('estoque_legado_brl', { lotes });
      }
    }
    const dados = { pais: corpo.pais, moeda: corpo.moeda, locale: corpo.locale };
    const registro = atual
      ? await tx.perfilFinanceiroEmpresa.update({ where: { cliente_id_id: { cliente_id: cli, id: atual.id } }, data: dados })
      : await tx.perfilFinanceiroEmpresa.create({ data: { cliente_id: cli, empresa_id: empresaId, ...dados, versao_contrato: VERSAO_CONTRATO } });
    await registrarEvento(contexto, {
      acao: atual ? 'perfil_financeiro.atualizar' : 'perfil_financeiro.criar',
      entidade: ENTIDADE_PERFIL,
      entidadeId: registro.id,
      dadosAnteriores: atual ? { pais: atual.pais, moeda: atual.moeda, locale: atual.locale } : undefined,
      dadosNovos: { empresa_id: empresaId, pais: registro.pais, moeda: registro.moeda, locale: registro.locale, versao_contrato: registro.versao_contrato },
    }, tx);
    return comoPerfilPublico(registro);
  }, {}, MENSAGEM_CONFLITO_SEM_CHAVE);
};
