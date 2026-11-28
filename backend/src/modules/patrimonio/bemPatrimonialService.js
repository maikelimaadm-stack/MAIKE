/**
 * D-PROD-157 / D-PROD-162 — Bens patrimoniais (da EMPRESA): lista, detalhe,
 * criação, edição do agregado (medidor, tanques e os Produtos aceitos por
 * tanque) e prévia de depreciação.
 *
 * Regras:
 *  - `cliente_id` só da sessão; `empresa_id` (query ou corpo) é ESCOPO,
 *    validado no banco e imutável: bem de outra empresa, de outro tenant ou
 *    inexistente → o mesmo 404 `BEM_PATRIMONIAL_NAO_ENCONTRADO`;
 *  - `numero` pela sequência do tenant (`reservarNumero`, ESCOPO_TENANT) e
 *    `natureza` copiada da família: ambos IMUTÁVEIS;
 *  - D-PROD-169: o corpo traz "Tipo de bem" (`natureza`) + "Tipo" (`tipo_id`)
 *    SEM `familia_id`: a família é a do TIPO e a natureza do tipo tem de ser a
 *    do bem (senão 422 `BEM_TIPO_NATUREZA_INCOMPATIVEL`). `familia_id`
 *    continua aceito por compatibilidade e tem de bater com o tipo. O catálogo
 *    padrão é garantido antes de criar/editar (`garantirCatalogoPadrao`);
 *  - `codigo_frota` (opcional) único por empresa: pré-checagem sob
 *    `travarEscopo('patrimonio:frota:<cli>:<emp>:<codigo>')` e o unique do
 *    banco como última barreira → 409 `BEM_CODIGO_FROTA_DUPLICADO`;
 *  - escrita numa transação, na ordem do A5: trava a linha do bem (PATCH) e
 *    confere a `versao` → lê tipo/família com FOR SHARE → mescla banco +
 *    corpo e valida TUDO sobre o estado final → tanques e Produtos aceitos
 *    (acrescentados lidos FOR KEY SHARE) → UPDATE com CAS da versão (uma vez
 *    por PATCH efetivo) → auditoria (allowlist, sem texto livre) na mesma
 *    transação;
 *  - PATCH sem mudança efetiva devolve o atual sem gravar, auditar nem
 *    incrementar a versão;
 *  - nada aqui toca estoque, financeiro, consumo ou contabilidade: a
 *    depreciação são PARÂMETROS e a prévia é simulação (§6).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento, registrarEventosEmLote } from '../auditoria/auditService.js';
import { texto } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, iso, travarEscopo } from '../gestao/gestaoComum.js';
import { hojeDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ESCOPO_TENANT, reservarNumero } from '../sequencias/entidadeCodigoService.js';
import {
  ESTADO_NOVO, REFERENCIAS_DO_TOPO, aquisicaoDoCorpo, decidirMedidor, depreciacaoDoCorpo, diferencas, escalaresDoCorpo, estadoDoRegistro,
  exigirCamposAplicaveis, exigirProprietarioCoerente, medidorDoEstado, paraGravacao, previaDoEstado, referenciaInvalida,
  validarAquisicaoEDepreciacao,
} from './bemPatrimonialRegras.js';
import { ehContador, pisoOperacional } from './abastecimentoMedidor.js';
import { revalidarAceitesDoBem, sincronizarTanques, validarTanques } from './bemPatrimonialFilhos.js';
import { simularDepreciacaoLinear } from './depreciacaoLinear.js';
import { garantirCatalogoPadrao } from './patrimonioCatalogoPadrao.js';
import { produtoDoCorpo } from './tipoPatrimonialService.js';
import { atualizarComVersao, comUnicosEstaveis, exigirVersao, lerAtivo, listarKeyset, termoDeBusca } from './patrimonioComum.js';
import { CAPACIDADES_POR_NATUREZA, ROTULO_NATUREZA } from './patrimonioDominio.js';

export const ENTIDADE = 'BemPatrimonial';
/** Ação de auditoria da correção do cadastro do medidor (A2). */
export const ACAO_CORRIGIR_MEDIDOR = 'bem_patrimonial.corrigir_medidor';

const CASAS_MEDIDA = 4;
const CASAS_DINHEIRO = 2;
const CASAS_PERCENTUAL = 4;

export const naoEncontrado = () => new AppError('BEM_PATRIMONIAL_NAO_ENCONTRADO', 'bem patrimonial não encontrado nesta fazenda');
const frotaDuplicado = () =>
  new AppError('BEM_CODIGO_FROTA_DUPLICADO', 'já existe um bem com este código de frota nesta fazenda; nada foi gravado', {
    details: { field: 'codigo_frota', reason: 'codigo_frota_repetido' },
  });

/** Leitura completa do agregado (detalhe, auditoria e base do PATCH). */
const INCLUIR = Object.freeze({
  familia: { select: { id: true, codigo: true, nome: true, natureza: true, ativo: true } },
  tipo: { select: { id: true, codigo: true, nome: true, ativo: true } },
  proprietario: { select: { id: true, nome: true } },
  fornecedor: { select: { id: true, nome: true } },
  responsavel: { select: { id: true, nome: true } },
  centroCusto: { select: { id: true, numero: true, nome: true } },
  area: { select: { id: true, nome: true } },
  tanques: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, identificador: true, capacidade_litros: true, observacao: true, ativo: true,
      // D-PROD-162 — Produtos ACEITOS (só os ativos); as linhas inativas são lidas à parte para validar.
      produtos: {
        where: { ativo: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { produto_id: true, produto: { select: { id: true, nome_produto: true, codigo_interno: true, unidade_principal_estoque: true, ativo: true } } },
      },
    },
  },
});

const buscar = (db, clienteId, empresaId, id) => db.bemPatrimonial.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, include: INCLUIR });

/**
 * Tanques gravados com TODAS as linhas de Produto aceito (ativas e inativas),
 * `produtos: [{produto_id, ativo}]`, na forma que `validarTanques` e
 * `sincronizarTanques` esperam. Lido dentro da transação, sob a trava do bem.
 * @param {any} tx @param {string} clienteId @param {Array<Record<string, any>>} tanques
 */
const comTodosOsAceites = async (tx, clienteId, tanques) => {
  if (!tanques.length) return [];
  const linhas = await tx.tanqueBemProduto.findMany({
    where: { cliente_id: clienteId, tanque_id: { in: tanques.map((t) => t.id) } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { tanque_id: true, produto_id: true, ativo: true },
  });
  return tanques.map((t) => ({
    ...t,
    produtos: linhas.filter((l) => l.tanque_id === t.id).map((l) => ({ produto_id: l.produto_id, ativo: l.ativo })),
  }));
};

const ref = (r) => (r ? { id: r.id, nome: r.nome } : null);

/**
 * Detalhe (A13, forma FIXA): referências como objetos, medidor/aquisição/
 * depreciação em blocos (sem repetir as colunas planas), decimais em string
 * (medidas, leituras, capacidade e potência com 4 casas; dinheiro 2;
 * percentual 4), `consumo` sempre null neste slice. Tanques com os Produtos
 * aceitos ATIVOS (`produto_ativo` = situação atual do Produto), por nome e id.
 * D-PROD-159: `medidor_operacional` = maior leitura registrada por abastecimento
 * CONFIRMADO (`{leitura, data, abastecimento_id}`) ou null — o abastecimento
 * nunca grava as colunas do medidor do bem. D-PROD-202: ou pela linha de
 * máquina confirmada do Lançamento de Atividades, a que for maior (`{leitura,
 * data, abastecimento_id: null, origem: 'ATIVIDADE', linha_maquina_id}`): a
 * leitura atual do bem reflete as linhas sem gravar o bem. `custo_uso_unitario`
 * = custo por hora ou km de uso (snapshot na linha de máquina).
 * @param {any} r  bem lido com `INCLUIR`
 * @param {{ leitura: string, data: string, abastecimento_id: string|null, origem?: string, linha_maquina_id?: string }|null} [operacional]
 */
export const comoBemPublico = (r, operacional = null) => {
  const e = estadoDoRegistro(r);
  return {
    id: r.id,
    empresa_id: r.empresa_id,
    numero: r.numero,
    codigo_frota: r.codigo_frota ?? null,
    nome: r.nome,
    natureza: r.natureza,
    ativo: r.ativo,
    versao: r.versao,
    created_date: iso(r.createdAt),
    updated_date: iso(r.updatedAt),
    familia: { id: r.familia.id, codigo: r.familia.codigo, nome: r.familia.nome, natureza: r.familia.natureza, ativo: r.familia.ativo },
    tipo: { id: r.tipo.id, codigo: r.tipo.codigo, nome: r.tipo.nome, ativo: r.tipo.ativo },
    propriedade: r.propriedade,
    proprietario: ref(r.proprietario),
    responsavel: ref(r.responsavel),
    centro_custo: r.centroCusto ? { id: r.centroCusto.id, numero: r.centroCusto.numero, nome: r.centroCusto.nome } : null,
    area: ref(r.area),
    localizacao_descricao: e.localizacao_descricao,
    marca: e.marca,
    modelo: e.modelo,
    ano_fabricacao: e.ano_fabricacao,
    ano_modelo: e.ano_modelo,
    numero_serie: e.numero_serie,
    chassi: e.chassi,
    placa: e.placa,
    placa_uf: e.placa_uf,
    renavam: e.renavam,
    potencia_cv: texto(r.potencia_cv, CASAS_MEDIDA),
    material: e.material,
    ano_conclusao: e.ano_conclusao,
    compatibilidade: e.compatibilidade,
    // D-PROD-297: o produto do implemento no próprio bem (nulos fora do implemento).
    usa_produto: r.usa_produto ?? null,
    forma_produto: r.forma_produto ?? null,
    capacidade: texto(r.capacidade, 4),
    capacidade_unidade: r.capacidade_unidade ?? null,
    especificacoes: e.especificacoes,
    observacoes: e.observacoes,
    medidor: medidorDoEstado(e),
    medidor_operacional: operacional
      ? {
          leitura: operacional.leitura,
          data: operacional.data,
          abastecimento_id: operacional.abastecimento_id,
          ...(operacional.linha_maquina_id ? { origem: operacional.origem, linha_maquina_id: operacional.linha_maquina_id } : {}),
        }
      : null,
    custo_uso_unitario: texto(r.custo_uso_unitario, CASAS_MEDIDA),
    tanques: r.tanques.map((t) => ({
      id: t.id,
      identificador: t.identificador,
      capacidade_litros: texto(t.capacidade_litros, CASAS_MEDIDA),
      observacao: t.observacao ?? null,
      ativo: t.ativo,
      produtos: t.produtos
        .map((v) => v.produto)
        .sort((a, b) => a.nome_produto.localeCompare(b.nome_produto, 'pt-BR') || a.id.localeCompare(b.id))
        .map((p) => ({
          produto_id: p.id,
          nome: p.nome_produto,
          codigo_interno: p.codigo_interno ?? null,
          unidade_principal_estoque: p.unidade_principal_estoque,
          produto_ativo: p.ativo,
        })),
    })),
    aquisicao: {
      data_aquisicao: e.data_aquisicao,
      data_disponibilidade: e.data_disponibilidade,
      valor_aquisicao: texto(r.valor_aquisicao, CASAS_DINHEIRO),
      custo_incorporacao: texto(r.custo_incorporacao, CASAS_DINHEIRO),
      fornecedor: ref(r.fornecedor),
      documento_referencia: e.documento_referencia,
      garantia_ate: e.garantia_ate,
    },
    depreciacao: {
      depreciavel: r.depreciavel,
      metodo: e.depreciacao_metodo,
      vida_util_meses: e.vida_util_meses,
      residual_modo: e.residual_modo,
      valor_residual: texto(r.valor_residual, CASAS_DINHEIRO),
      residual_percentual: texto(r.residual_percentual, CASAS_PERCENTUAL),
      data_inicio_depreciacao: e.data_inicio_depreciacao,
      previa: previaDoEstado(e),
    },
    consumo: null,
  };
};

const SELECAO_RESUMO = Object.freeze({
  id: true, numero: true, codigo_frota: true, nome: true, natureza: true, propriedade: true, medidor_tipo: true, ativo: true, versao: true,
  createdAt: true, updatedAt: true, familia: { select: { id: true, nome: true } }, tipo: { select: { id: true, nome: true } },
});

/** Item da lista (resumo do §5). */
const comoResumo = (r) => ({
  id: r.id,
  numero: r.numero,
  codigo_frota: r.codigo_frota ?? null,
  nome: r.nome,
  natureza: r.natureza,
  familia: { id: r.familia.id, nome: r.familia.nome },
  tipo: { id: r.tipo.id, nome: r.tipo.nome },
  propriedade: r.propriedade,
  medidor_tipo: r.medidor_tipo ?? null,
  ativo: r.ativo,
  versao: r.versao,
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

/**
 * Auditoria por allowlist: ids, número, código de frota, classificação,
 * situação, medidor, sinal de depreciação e a forma dos tanques (situação,
 * capacidade e os ids dos Produtos aceitos ativos, ordenados). Sem nome,
 * descrições, observações, identificadores, documentos nem placa/chassi/renavam.
 * @param {any} r  bem lido com `INCLUIR`
 */
const paraAuditoria = (r) => {
  const e = estadoDoRegistro(r);
  return {
    id: r.id,
    empresa_id: r.empresa_id,
    numero: r.numero,
    codigo_frota: r.codigo_frota ?? null,
    natureza: r.natureza,
    familia_id: r.familia_id,
    tipo_id: r.tipo_id,
    propriedade: r.propriedade,
    proprietario_parceiro_id: e.proprietario_parceiro_id,
    fornecedor_parceiro_id: e.fornecedor_parceiro_id,
    responsavel_usuario_id: e.responsavel_usuario_id,
    centro_custo_id: e.centro_custo_id,
    area_id: e.area_id,
    ativo: r.ativo,
    versao: r.versao,
    medidor: medidorDoEstado(e),
    custo_uso_unitario: texto(r.custo_uso_unitario, CASAS_MEDIDA),
    depreciavel: r.depreciavel,
    vida_util_meses: e.vida_util_meses,
    residual_modo: e.residual_modo,
    tanques: r.tanques.map((t) => ({
      id: t.id,
      ativo: t.ativo,
      capacidade_litros: texto(t.capacidade_litros, CASAS_MEDIDA),
      produto_ids: t.produtos.map((p) => p.produto_id).sort(),
    })),
  };
};

/** NOMES dos campos alterados (as colunas do medidor viram `medidor`). */
const nomesAlterados = (dados, mudouTanques) => {
  const nomes = new Set(Object.keys(dados).map((c) => (c.startsWith('medidor_') ? 'medidor' : c)));
  if (mudouTanques) nomes.add('tanques');
  return [...nomes];
};

const transacao = (fn) => comUnicosEstaveis(() => emTransacao(TRANSACAO_CURTA, fn, {}, MENSAGEM_CONFLITO_SEM_CHAVE), { codigo_frota: frotaDuplicado });

/** "Hoje" da fazenda, lido uma vez por transação e só quando uma data do medidor precisa dele. */
const hojeDe = (tx, clienteId, empresaId) => {
  /** @type {string|null} */
  let dia = null;
  return async () => {
    dia ??= (await hojeDaEmpresa(tx, clienteId, empresaId)).hoje;
    return dia;
  };
};

// ─── referências ────────────────────────────────────────────────────────────

/**
 * Tipo (e a família INFORMADA, se veio — compatibilidade) lidos com FOR SHARE:
 * a exclusão/inativação concorrente do tipo espera esta escrita (e esta escrita
 * vê a exclusão já confirmada). Sem `familia_id`, a família é a do tipo (lida
 * com FOR SHARE depois do tipo).
 * @param {any} tx @param {string} clienteId @param {{ familiaId: string|null, tipoId: string }} ids
 */
const carregarClassificacao = async (tx, clienteId, { familiaId, tipoId }) => {
  if (familiaId) await tx.$queryRaw`SELECT id FROM "FamiliaPatrimonial" WHERE cliente_id = ${clienteId} AND id = ${familiaId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "TipoPatrimonial" WHERE cliente_id = ${clienteId} AND id = ${tipoId} FOR SHARE`;
  const tipo = await tx.tipoPatrimonial.findFirst({ where: { cliente_id: clienteId, id: tipoId }, select: { id: true, familia_id: true, ativo: true } });
  const idDaFamilia = familiaId ?? tipo?.familia_id ?? null;
  if (!familiaId && idDaFamilia) await tx.$queryRaw`SELECT id FROM "FamiliaPatrimonial" WHERE cliente_id = ${clienteId} AND id = ${idDaFamilia} FOR SHARE`;
  const familia = idDaFamilia
    ? await tx.familiaPatrimonial.findFirst({ where: { cliente_id: clienteId, id: idDaFamilia }, select: { id: true, natureza: true, ativo: true } })
    : null;
  return { familia, tipo, familiaInformada: Boolean(familiaId) };
};

/** @param {string} n */
const rotulo = (n) => ROTULO_NATUREZA[/** @type {keyof typeof ROTULO_NATUREZA} */ (n)] ?? n;

/**
 * 422 D-PROD-169: o tipo (ou a família informada) é de outro "Tipo de bem".
 * @param {string} field @param {string} natureza  a do bem/pedida @param {string} naturezaTipo
 */
const naturezaIncompativel = (field, natureza, naturezaTipo) =>
  new AppError(
    'BEM_TIPO_NATUREZA_INCOMPATIVEL',
    `o tipo escolhido é do tipo de bem "${rotulo(naturezaTipo)}", não "${rotulo(natureza)}": escolha um tipo de "${rotulo(natureza)}"; nada foi gravado`,
    { details: { field, reason: 'natureza_diferente', natureza, natureza_tipo: naturezaTipo } }
  );

/**
 * Classificação escolhida (criação) ou alterada (PATCH): tipo existente no
 * tenant e ATIVO quando novo; família = a informada (compatibilidade: do
 * tenant, da natureza, ATIVA quando nova, e o tipo tem de ser dela) ou a do
 * tipo (ATIVA quando nova); a natureza do tipo tem de ser a do bem (PATCH) ou
 * a pedida (POST). No PATCH a natureza do bem nunca muda (família informada de
 * outra natureza → 409, nada apagado).
 * @param {{ familia: any, tipo: any, familiaInformada: boolean }} c
 * @param {{ naturezaDoBem?: string|null, naturezaPedida?: string|null, familiaAtualId?: string|null, tipoNovo?: boolean }} [opcoes]
 * @returns {{ familia: { id: string, natureza: string, ativo: boolean }, tipo: { id: string, familia_id: string, ativo: boolean } }}
 */
const exigirClassificacao = ({ familia, tipo, familiaInformada }, { naturezaDoBem = null, naturezaPedida = null, familiaAtualId = null, tipoNovo = true } = {}) => {
  const familiaNova = Boolean(familia) && familia.id !== familiaAtualId;
  if (familiaInformada) {
    if (!familia) throw referenciaInvalida('familia_id', 'inexistente', 'família patrimonial não encontrada');
    if (naturezaDoBem && familia.natureza !== naturezaDoBem) {
      throw new AppError('BEM_NATUREZA_IMUTAVEL', 'a natureza do bem não muda: escolha uma família da mesma natureza; nada foi gravado', {
        details: { field: 'familia_id', reason: 'natureza_diferente', natureza: naturezaDoBem, natureza_familia: familia.natureza },
      });
    }
    if (naturezaPedida && familia.natureza !== naturezaPedida) throw naturezaIncompativel('familia_id', naturezaPedida, familia.natureza);
    if (familiaNova && !familia.ativo) throw referenciaInvalida('familia_id', 'inativo', 'a família escolhida está inativa');
  }
  if (!tipo) throw referenciaInvalida('tipo_id', 'inexistente', 'tipo patrimonial não encontrado');
  if (tipoNovo && !tipo.ativo) throw referenciaInvalida('tipo_id', 'inativo', 'o tipo escolhido está inativo');
  if (familiaInformada && tipo.familia_id !== familia.id) {
    throw new AppError('BEM_TIPO_FAMILIA_INCOMPATIVEL', 'o tipo escolhido não pertence a esta família; nada foi gravado', {
      details: { field: 'tipo_id', reason: 'tipo_de_outra_familia' },
    });
  }
  if (!familia) throw referenciaInvalida('tipo_id', 'inexistente', 'tipo patrimonial não encontrado');
  const esperada = naturezaDoBem ?? naturezaPedida;
  if (esperada && familia.natureza !== esperada) throw naturezaIncompativel('tipo_id', esperada, familia.natureza);
  if (!familiaInformada && familiaNova && !familia.ativo) {
    throw referenciaInvalida('tipo_id', 'familia_inativa', 'o tipo escolhido pertence a uma classificação inativa');
  }
  return { familia, tipo };
};

/** Mensagens das referências escalares (inexistente/inativo). */
const REFERENCIAS = Object.freeze({
  proprietario_parceiro_id: { field: 'proprietario_parceiro_id', inexistente: 'o parceiro proprietário não foi encontrado nesta fazenda', inativo: 'o parceiro proprietário está inativo' },
  responsavel_usuario_id: { field: 'responsavel_usuario_id', inexistente: 'o responsável não foi encontrado', inativo: 'o responsável está inativo' },
  centro_custo_id: { field: 'centro_custo_id', inexistente: 'o centro de custo não foi encontrado nesta fazenda', inativo: 'o centro de custo está inativo' },
  area_id: { field: 'area_id', inexistente: 'a área não foi encontrada nesta fazenda', inativo: 'a área está inativa' },
  fornecedor_parceiro_id: { field: 'aquisicao.fornecedor_parceiro_id', inexistente: 'o parceiro fornecedor não foi encontrado nesta fazenda', inativo: 'o parceiro fornecedor está inativo' },
});

/**
 * O parceiro (proprietário ou fornecedor) é lido FOR KEY SHARE — a mesma trava
 * que a FK pega no INSERT, só que antes: uma exclusão do parceiro em voo
 * termina primeiro e aqui ele já não existe (422 "inexistente", nunca o 403 da
 * FK); se este bem chega antes, a exclusão espera o commit e vê o vínculo.
 * @param {any} tx @param {string} clienteId @param {string} coluna @param {string} id @returns {Promise<{ empresa_id?: string, ativo: boolean }|null>}
 */
const lerReferencia = async (tx, clienteId, coluna, id) => {
  const where = { cliente_id: clienteId, id };
  if (coluna === 'responsavel_usuario_id') return tx.usuario.findFirst({ where, select: { ativo: true } });
  if (coluna === 'centro_custo_id') return tx.centroCusto.findFirst({ where, select: { empresa_id: true, ativo: true } });
  if (coluna === 'area_id') return tx.areaPastagem.findFirst({ where, select: { empresa_id: true, ativo: true } });
  const [parceiro] = /** @type {Array<{ empresa_id: string, ativo: boolean }>} */ (
    await tx.$queryRaw`SELECT empresa_id, ativo FROM "Fornecedor" WHERE cliente_id = ${clienteId} AND id = ${id} FOR KEY SHARE`
  );
  return parceiro ?? null;
};

/**
 * Parceiros, responsável, centro de custo e área INFORMADOS (criação) ou
 * ALTERADOS (PATCH): do tenant, da MESMA empresa do bem (o usuário é do
 * tenant) e ativos. Manter uma referência que depois foi inativada é permitido.
 * @param {any} tx @param {string} clienteId @param {string} empresaId
 * @param {Record<string, any>} estado  estado final
 * @param {Record<string, any>|null} anterior  estado gravado (PATCH) ou null
 */
const exigirReferencias = async (tx, clienteId, empresaId, estado, anterior) => {
  for (const coluna of [...REFERENCIAS_DO_TOPO, 'fornecedor_parceiro_id']) {
    const id = estado[coluna];
    if (!id || id === (anterior?.[coluna] ?? null)) continue;
    const { field, inexistente, inativo } = REFERENCIAS[coluna];
    const r = await lerReferencia(tx, clienteId, coluna, id);
    if (!r || (r.empresa_id !== undefined && r.empresa_id !== empresaId)) throw referenciaInvalida(field, 'inexistente', inexistente);
    if (!r.ativo) throw referenciaInvalida(field, 'inativo', inativo);
  }
};

/**
 * Código de frota livre na empresa, sob a trava do código (a corrida de dois
 * POST com o mesmo código termina em 201 + 409).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string|null} codigo @param {string|null} ignorarId
 */
const exigirCodigoFrotaLivre = async (tx, clienteId, empresaId, codigo, ignorarId) => {
  if (!codigo) return;
  await travarEscopo(tx, `patrimonio:frota:${clienteId}:${empresaId}:${codigo}`);
  const outro = await tx.bemPatrimonial.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, codigo_frota: codigo, ...(ignorarId ? { NOT: { id: ignorarId } } : {}) },
    select: { id: true },
  });
  if (outro) throw frotaDuplicado();
};

// ─── leitura ────────────────────────────────────────────────────────────────

/**
 * Lista keyset (createdAt desc, id desc) dos bens da empresa; `q` busca em
 * nome, número, código de frota, placa (com ou sem hífen) e número de série.
 */
export const listar = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  /** @type {Record<string, any>} */
  const where = { cliente_id: auth.clienteId, empresa_id: empresaId };
  const ativo = lerAtivo(query.ativo);
  if (ativo !== null) where.ativo = ativo;
  if (typeof query.familia_id === 'string' && query.familia_id) where.familia_id = query.familia_id;
  if (typeof query.tipo_id === 'string' && query.tipo_id) where.tipo_id = query.tipo_id;
  if (typeof query.natureza === 'string' && query.natureza) where.natureza = query.natureza;
  const q = termoDeBusca(query.q);
  const qPlaca = q.replace(/[\s-]/g, '');
  const busca = q
    ? [
        { nome: { contains: q, mode: 'insensitive' } },
        { numero: { contains: q } },
        { codigo_frota: { contains: q, mode: 'insensitive' } },
        ...(qPlaca ? [{ placa: { contains: qPlaca, mode: 'insensitive' } }] : []),
        { numero_serie: { contains: q, mode: 'insensitive' } },
      ]
    : [];
  return listarKeyset(prisma.bemPatrimonial, { where, busca, query, select: SELECAO_RESUMO, mapItem: comoResumo });
};

export const detalhar = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const r = await buscar(prisma, auth.clienteId, empresaId, id);
  if (!r) throw naoEncontrado();
  return comoBemPublico(r, ehContador(r.medidor_tipo) ? await pisoOperacional(prisma, auth.clienteId, r.id, r.medidor_tipo) : null);
};

// ─── escrita ────────────────────────────────────────────────────────────────

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const corpo = escalaresDoCorpo(entrada);
  const aquisicao = aquisicaoDoCorpo(entrada.aquisicao);
  const depreciacao = depreciacaoDoCorpo(entrada.depreciacao);
  await garantirCatalogoPadrao(contexto);
  return transacao(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, entrada.empresa_id);
    // FOR KEY SHARE da fazenda (a trava que a FK do INSERT pegaria, só que
    // antes): uma exclusão da fazenda em voo termina primeiro → 404; se este
    // bem chega antes, a exclusão espera o commit e devolve 409 com o vínculo.
    const [empresaTravada] = /** @type {Array<{ id: string }>} */ (
      await tx.$queryRaw`SELECT id FROM "Empresa" WHERE cliente_id = ${cli} AND id = ${empresaId} FOR KEY SHARE`
    );
    if (!empresaTravada) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada neste tenant', { details: { field: 'empresa_id' } });
    const classificacao = exigirClassificacao(await carregarClassificacao(tx, cli, { familiaId: entrada.familia_id ?? null, tipoId: entrada.tipo_id }), {
      naturezaPedida: entrada.natureza ?? null,
    });
    const natureza = classificacao.familia.natureza;
    exigirCamposAplicaveis(natureza, entrada);
    /** @type {Record<string, any>} */
    const estado = { ...ESTADO_NOVO, ...corpo, ...(aquisicao ?? {}), ...(depreciacao ?? {}), familia_id: classificacao.familia.id, tipo_id: classificacao.tipo.id };
    exigirProprietarioCoerente(estado);
    await exigirReferencias(tx, cli, empresaId, estado, null);
    const medidor = await decidirMedidor({ natureza, estado: ESTADO_NOVO, pedido: entrada.medidor, criacao: true, hoje: hojeDe(tx, cli, empresaId) });
    if (medidor.colunas) Object.assign(estado, medidor.colunas);
    const capacidades = CAPACIDADES_POR_NATUREZA[natureza];
    const tanques = capacidades.tanques ? await validarTanques(tx, cli, empresaId, entrada.tanques ?? [], []) : null;
    validarAquisicaoEDepreciacao(estado);
    await exigirCodigoFrotaLivre(tx, cli, empresaId, estado.codigo_frota, null);
    const numero = String(await reservarNumero(tx, { clienteId: cli, entidade: ENTIDADE, escopoTipo: ESCOPO_TENANT }));
    // D-PROD-297: o produto do implemento (só IMPLEMENTO; a mesma conferência do tipo, D-PROD-279).
    const produto = produtoDoCorpo(entrada, natureza, null);
    const { id } = await tx.bemPatrimonial.create({
      data: { cliente_id: cli, empresa_id: empresaId, numero, natureza, ...paraGravacao(estado), ...(produto ?? {}) },
      select: { id: true },
    });
    if (tanques?.desejados.length) await sincronizarTanques(tx, cli, id, tanques.desejados, []);
    const r = await buscar(tx, cli, empresaId, id);
    await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: id, dadosNovos: paraAuditoria(r) }, tx);
    return comoBemPublico(r, null);
  });
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const corpo = escalaresDoCorpo(entrada);
  const aquisicao = aquisicaoDoCorpo(entrada.aquisicao);
  const depreciacao = depreciacaoDoCorpo(entrada.depreciacao);
  await garantirCatalogoPadrao(contexto);
  return transacao(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, entrada.empresa_id);
    const travado = /** @type {Array<{ id: string }>} */ (
      await tx.$queryRaw`SELECT id FROM "BemPatrimonial" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`
    );
    if (!travado.length) throw naoEncontrado();
    const atual = await buscar(tx, cli, empresaId, id);
    exigirVersao(atual, entrada.versao);
    // D-PROD-159 (X2): piso operacional lido sob o FOR UPDATE do bem (o abastecimento trava o bem antes de gravar a leitura).
    const piso = ehContador(atual.medidor_tipo) ? await pisoOperacional(tx, cli, id, atual.medidor_tipo) : null;
    const natureza = atual.natureza;
    const antes = estadoDoRegistro(atual);

    // D-PROD-169: `natureza` no corpo só confere (imutável).
    if (entrada.natureza !== undefined && entrada.natureza !== natureza) {
      throw new AppError('BEM_NATUREZA_IMUTAVEL', `o tipo de bem não muda depois do cadastro (este bem é "${rotulo(natureza)}"); nada foi gravado`, {
        details: { field: 'natureza', reason: 'natureza_diferente', natureza, natureza_pedida: entrada.natureza },
      });
    }
    const tipoId = entrada.tipo_id ?? atual.tipo_id;
    const tipoNovo = tipoId !== atual.tipo_id;
    const familiaInformadaNova = entrada.familia_id !== undefined && entrada.familia_id !== atual.familia_id;
    const classificacao =
      tipoNovo || familiaInformadaNova
        ? exigirClassificacao(await carregarClassificacao(tx, cli, { familiaId: entrada.familia_id ?? null, tipoId }), {
            naturezaDoBem: natureza,
            familiaAtualId: atual.familia_id,
            tipoNovo,
          })
        : { familia: atual.familia, tipo: atual.tipo };
    const familiaId = classificacao.familia.id;
    exigirCamposAplicaveis(natureza, entrada);

    /** @type {Record<string, any>} */
    const estado = { ...antes, ...corpo, ...(aquisicao ?? {}), ...(depreciacao ?? {}), familia_id: familiaId, tipo_id: tipoId };
    if (typeof entrada.ativo === 'boolean') estado.ativo = entrada.ativo;
    if (estado.ativo && !antes.ativo && (!classificacao.familia.ativo || !classificacao.tipo.ativo)) {
      throw new AppError('BEM_CLASSIFICACAO_INATIVA', 'o bem não é reativado com família ou tipo inativo: reative a classificação antes; nada foi gravado', {
        details: { field: !classificacao.familia.ativo ? 'familia_id' : 'tipo_id', reason: 'classificacao_inativa' },
      });
    }
    exigirProprietarioCoerente(estado);
    await exigirReferencias(tx, cli, empresaId, estado, antes);
    const medidor = await decidirMedidor({ natureza, estado: antes, pedido: entrada.medidor, criacao: false, hoje: hojeDe(tx, cli, empresaId), piso });
    if (medidor.colunas) Object.assign(estado, medidor.colunas);
    const capacidades = CAPACIDADES_POR_NATUREZA[natureza];
    // D-PROD-162: reativar o bem revalida os Produtos aceitos dos tanques ativos (achado D1).
    const reativandoBem = estado.ativo === true && !antes.ativo;
    const gravados = capacidades.tanques && (entrada.tanques !== undefined || reativandoBem) ? await comTodosOsAceites(tx, cli, atual.tanques) : [];
    const tanques = capacidades.tanques && entrada.tanques !== undefined ? await validarTanques(tx, cli, empresaId, entrada.tanques, gravados, { reativandoBem }) : null;
    if (capacidades.tanques && !tanques && reativandoBem) await revalidarAceitesDoBem(tx, cli, empresaId, gravados);
    validarAquisicaoEDepreciacao(estado);

    const dados = diferencas(antes, estado);
    const mudouTanques = tanques?.mudou === true;
    // D-PROD-297: o produto do implemento (só os campos que mudaram).
    const produto = produtoDoCorpo(entrada, natureza, { usa_produto: atual.usa_produto ?? null, forma_produto: atual.forma_produto ?? null, capacidade: texto(atual.capacidade, 4), capacidade_unidade: atual.capacidade_unidade ?? null });
    /** @type {Record<string, any>} */
    const produtoMudou = {};
    if (produto) {
      if ((produto.usa_produto ?? null) !== (atual.usa_produto ?? null)) produtoMudou.usa_produto = produto.usa_produto;
      if ((produto.forma_produto ?? null) !== (atual.forma_produto ?? null)) produtoMudou.forma_produto = produto.forma_produto;
      if ((produto.capacidade ?? null) !== (texto(atual.capacidade, 4) ?? null)) produtoMudou.capacidade = produto.capacidade;
      if ((produto.capacidade_unidade ?? null) !== (atual.capacidade_unidade ?? null)) produtoMudou.capacidade_unidade = produto.capacidade_unidade;
    }
    if (!Object.keys(dados).length && !mudouTanques && !Object.keys(produtoMudou).length) return comoBemPublico(atual, piso);
    if ('codigo_frota' in dados) await exigirCodigoFrotaLivre(tx, cli, empresaId, dados.codigo_frota, id);
    if (mudouTanques) await sincronizarTanques(tx, cli, id, tanques.desejados, gravados);
    await atualizarComVersao(tx.bemPatrimonial, { clienteId: cli, id, versao: entrada.versao, data: { ...paraGravacao(dados), ...produtoMudou } });
    const depois = await buscar(tx, cli, empresaId, id);
    /** @type {Array<{ acao: string, entidade: string, entidadeId: string, dadosAnteriores: unknown, dadosNovos: unknown }>} */
    const eventos = [
      {
        acao: 'update',
        entidade: ENTIDADE,
        entidadeId: id,
        dadosAnteriores: paraAuditoria(atual),
        dadosNovos: { ...paraAuditoria(depois), campos_alterados: [...nomesAlterados(dados, mudouTanques), ...Object.keys(produtoMudou)].sort() },
      },
    ];
    if (medidor.correcao) {
      eventos.push({
        acao: ACAO_CORRIGIR_MEDIDOR,
        entidade: ENTIDADE,
        entidadeId: id,
        dadosAnteriores: { medidor: medidorDoEstado(antes) },
        dadosNovos: { medidor: medidorDoEstado(estadoDoRegistro(depois)) },
      });
    }
    await registrarEventosEmLote(contexto, eventos, tx);
    return comoBemPublico(depois, await pisoOperacional(tx, cli, id, depois.medidor_tipo));
  });
};

/**
 * Prévia gerencial de depreciação linear (§6): SÓ cálculo — confere a
 * empresa do tenant e não grava nada (nenhuma tabela muda).
 */
export const previaDepreciacao = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  await exigirEmpresaDoTenant(getPrismaClient(), auth.clienteId, entrada.empresa_id);
  return simularDepreciacaoLinear({
    valor_aquisicao: entrada.valor_aquisicao,
    custo_incorporacao: entrada.custo_incorporacao ?? null,
    residual_modo: entrada.residual_modo,
    valor_residual: entrada.valor_residual ?? null,
    residual_percentual: entrada.residual_percentual ?? null,
    vida_util_meses: entrada.vida_util_meses,
    data_inicio_depreciacao: entrada.data_inicio_depreciacao,
  });
};

// ─── D-PROD-287: excluir o bem que nunca foi usado ─────────────────────────

/**
 * 409 `BEM_PATRIMONIAL_EM_USO`: o bem tem histórico (abastecimento, em qualquer situação — cancelado também é histórico
 * de estoque e custo). Só inativar.
 * @param {{ abastecimentos: number }} uso
 */
const bemEmUso = (uso) =>
  new AppError('BEM_PATRIMONIAL_EM_USO', 'este bem já foi usado (abastecimento): não pode ser excluído, só inativado; nada foi apagado', {
    details: { ...uso, reason: 'bem_em_uso' },
  });

/**
 * `DELETE /bens-patrimoniais/:id?empresa_id=&versao=` — D-PROD-287: exclui DE VEZ o bem que nunca foi usado (um cadastro
 * feito errado): sem abastecimento, em qualquer situação (D-PROD-383: as atividades e os lançamentos de máquina
 * saíram). Os tanques e os produtos aceitos saem junto. Com histórico → 409
 * `BEM_PATRIMONIAL_EM_USO` (só inativar). Versão diferente → 409 de concorrência. Auditoria `delete` com o bem inteiro.
 * @param {{ requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {string} id @param {Record<string, any>} [query]
 */
export const excluir = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const versao = Number(query.versao);
  return transacao(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    const travado = /** @type {Array<{ id: string }>} */ (
      await tx.$queryRaw`SELECT id FROM "BemPatrimonial" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`
    );
    if (!travado.length) throw naoEncontrado();
    const antes = await buscar(tx, cli, empresaId, id);
    exigirVersao(antes, versao);
    const abastecimentos = await tx.abastecimentoBem.count({ where: { cliente_id: cli, bem_id: id } });
    if (abastecimentos > 0) throw bemEmUso({ abastecimentos });
    try {
      const tanques = await tx.tanqueBem.findMany({ where: { cliente_id: cli, bem_id: id }, select: { id: true } });
      if (tanques.length) {
        await tx.tanqueBemProduto.deleteMany({ where: { cliente_id: cli, tanque_id: { in: tanques.map((t) => t.id) } } });
        await tx.tanqueBem.deleteMany({ where: { cliente_id: cli, bem_id: id } });
      }
      await tx.bemPatrimonial.delete({ where: { cliente_id_id: { cliente_id: cli, id } } });
    } catch (erro) {
      // Uma referência que a conferência acima não conhece: o banco recusa (FK RESTRICT) e nada sai.
      if (/** @type {any} */ (erro)?.code === 'P2003') throw bemEmUso({ abastecimentos });
      throw erro;
    }
    await registrarEvento(contexto, { acao: 'delete', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: paraAuditoria(antes) }, tx);
  });
};
