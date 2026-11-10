/**
 * D-PROD-157 / D-PROD-161 — filhos do agregado do bem: os tanques (só
 * MAQUINA/VEICULO/EQUIPAMENTO) e, em cada tanque, os Produtos do estoque que
 * ele ACEITA. Mudam SÓ pelo POST/PATCH do bem, dentro da transação dele e
 * depois da trava da linha do bem (A5; o PATCH trava o bem FOR UPDATE, a mesma
 * trava R3 do confirmar do abastecimento). A lista `tanques` do corpo é o SYNC
 * COMPLETO do estado final.
 *
 * Tanques: nunca removidos (ausente → 422 `TANQUE_REMOCAO_NAO_PERMITIDA`),
 * só inativados; identificador único no bem sem diferenciar maiúsculas
 * (inclusive o de tanque inativo, que continua reservado); até 10 ATIVOS;
 * capacidade em litros, maior que zero, com até 4 casas.
 *
 * Produtos aceitos (`produto_ids`, obrigatório; pode ser `[]`, P-01): até 20,
 * sem repetição. Só o que é ACRESCENTADO (novo, reativado, ou o conjunto de um
 * tanque/bem que volta a ficar ativo — achado D1) é validado: Produto do
 * tenant, da MESMA fazenda do bem, ativo e com estoque em L ou KG; lido antes
 * com `FOR KEY SHARE` (espera a troca de fazenda/unidade do Produto em voo,
 * que toma `FOR UPDATE`). Um aceite mantido não é revalidado: o abastecimento
 * relê o Produto e o recusa.
 *
 * Aceite retirado (achado D11): sem nenhum abastecimento naquele par tanque ×
 * Produto, a linha é APAGADA (o Produto passa a poder ser excluído); com
 * histórico, só `ativo = false` (a FK do abastecimento segura o par).
 */

import { AppError } from '../../shared/errors/AppError.js';
import { dec, texto } from '../financeiro/decimalFinanceiro.js';
import { invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { PADRAO_MEDIDA, referenciaInvalida } from './bemPatrimonialRegras.js';
import { MAX_PRODUTOS_POR_TANQUE, MAX_TANQUES_ATIVOS_POR_BEM, UNIDADES_ABASTECIMENTO } from './patrimonioDominio.js';

/** Escala da capacidade (`DECIMAL(14,4)`). */
const CASAS_MEDIDA = 4;

/**
 * @typedef {{ id: string|null, identificador: string, capacidade_litros: string, observacao: string|null, ativo: boolean,
 *   produto_ids: string[] }} TanqueDesejado
 */

const MENSAGENS_PRODUTO = Object.freeze({
  inexistente: 'Produto não encontrado',
  outra_empresa: 'o Produto é de outra fazenda: o tanque só aceita Produtos da fazenda do bem',
  inativo: 'Produto inativo não pode ser acrescentado ao tanque',
  unidade_incompativel: 'o tanque só aceita Produto com estoque em litros (L) ou em quilos (KG)',
  repetido: 'o mesmo Produto aparece mais de uma vez no tanque',
  limite: `um tanque aceita no máximo ${MAX_PRODUTOS_POR_TANQUE} Produtos`,
});

/**
 * 422 `TANQUE_PRODUTO_INVALIDO` (nada foi gravado). `inexistente` vale também
 * para Produto de outro tenant (sem oráculo).
 * @param {number} i @param {keyof typeof MENSAGENS_PRODUTO} reason @param {Record<string, unknown>} [extra]
 */
const produtoInvalido = (i, reason, extra = {}) =>
  new AppError('TANQUE_PRODUTO_INVALIDO', `${MENSAGENS_PRODUTO[reason]}; nada foi gravado`, {
    details: { field: `tanques[${i}].produto_ids`, reason, ...extra },
  });

/** Ids ATIVOS gravados de um tanque. @param {{ produtos?: Array<{ produto_id: string, ativo: boolean }> }} tanque */
const idsAtivos = (tanque) => (tanque.produtos ?? []).filter((p) => p.ativo).map((p) => p.produto_id);
const mesmoConjunto = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Passo 3 do §4.5: os Produtos acrescentados, em ordem crescente de id, são
 * travados `FOR KEY SHARE` ANTES de ler e então relidos e conferidos.
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} empresaId  fazenda do bem
 * @param {Array<{ indice: number, ids: string[] }>} porTanque
 */
const validarProdutosAcrescentados = async (tx, clienteId, empresaId, porTanque) => {
  const todos = [...new Set(porTanque.flatMap((t) => t.ids))].sort();
  if (!todos.length) return;
  await tx.$queryRaw`SELECT id FROM "Produto" WHERE cliente_id = ${clienteId} AND id = ANY(${todos}::text[]) ORDER BY id FOR KEY SHARE`;
  const lidos = await tx.produto.findMany({
    where: { cliente_id: clienteId, id: { in: todos } },
    select: { id: true, empresa_id: true, ativo: true, unidade_principal_estoque: true },
  });
  const porId = new Map(lidos.map((p) => [p.id, p]));
  for (const { indice, ids } of porTanque) {
    for (const id of ids) {
      const p = porId.get(id);
      if (!p) throw produtoInvalido(indice, 'inexistente', { produto_id: id });
      if (p.empresa_id !== empresaId) throw produtoInvalido(indice, 'outra_empresa', { produto_id: id });
      if (!p.ativo) throw produtoInvalido(indice, 'inativo', { produto_id: id });
      if (!UNIDADES_ABASTECIMENTO.includes(p.unidade_principal_estoque)) {
        throw produtoInvalido(indice, 'unidade_incompativel', { produto_id: id, unidade: p.unidade_principal_estoque ?? null });
      }
    }
  }
};

/**
 * Valida a lista final de tanques (sem gravar).
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} empresaId  fazenda do bem (os Produtos aceitos são dela)
 * @param {Array<Record<string, any>>} pedidos  itens do corpo `{id?, identificador, capacidade_litros, produto_ids, observacao?, ativo?}`
 * @param {Array<Record<string, any>>} gravados  tanques atuais do bem com `produtos: [{produto_id, ativo}]` (TODAS as linhas) ou []
 * @param {{ reativandoBem?: boolean }} [opcoes]  o PATCH reativa o bem: os aceites dos tanques ativos são revalidados (D1)
 * @returns {Promise<{ desejados: TanqueDesejado[], mudou: boolean }>}
 */
export const validarTanques = async (tx, clienteId, empresaId, pedidos, gravados, { reativandoBem = false } = {}) => {
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
    if (!Array.isArray(item.produto_ids)) throw invalido(`tanques[${i}].produto_ids é obrigatório (pode ser vazio)`, { field: `tanques[${i}].produto_ids` });
    const produtoIds = item.produto_ids.map(String);
    if (new Set(produtoIds).size !== produtoIds.length) throw produtoInvalido(i, 'repetido');
    if (produtoIds.length > MAX_PRODUTOS_POR_TANQUE) throw produtoInvalido(i, 'limite', { maximo: MAX_PRODUTOS_POR_TANQUE });
    return {
      id: item.id ?? null,
      identificador,
      capacidade_litros: dec(capacidade).toFixed(CASAS_MEDIDA),
      observacao: textoDoCorpo(item.observacao, `tanques[${i}].observacao`) ?? null,
      ativo,
      produto_ids: produtoIds,
    };
  });
  const ativos = desejados.filter((t) => t.ativo).length;
  if (ativos > MAX_TANQUES_ATIVOS_POR_BEM) {
    throw new AppError('TANQUE_LIMITE_EXCEDIDO', `um bem tem no máximo ${MAX_TANQUES_ATIVOS_POR_BEM} tanques ativos; nada foi gravado`, {
      details: { field: 'tanques', reason: 'limite', maximo: MAX_TANQUES_ATIVOS_POR_BEM },
    });
  }
  // Acrescentados: ids que não estão ATIVOS no tanque. Tanque (ou bem) que volta
  // a ficar ativo revalida o conjunto inteiro (achado D1).
  const porTanque = desejados.map((t, indice) => {
    const gravado = t.id ? porId.get(t.id) : null;
    if (!gravado) return { indice, ids: t.produto_ids };
    const voltaAtivo = t.ativo && (!gravado.ativo || reativandoBem);
    if (voltaAtivo) return { indice, ids: t.produto_ids };
    const jaAtivos = idsAtivos(gravado);
    return { indice, ids: t.produto_ids.filter((id) => !jaAtivos.includes(id)) };
  });
  await validarProdutosAcrescentados(tx, clienteId, empresaId, porTanque);
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
        !mesmoConjunto(idsAtivos(g), t.produto_ids)
      );
    });
  return { desejados, mudou };
};

/**
 * Reativação do bem SEM `tanques` no corpo (achado D1): os aceites ativos dos
 * tanques ativos são revalidados como acrescentados. Nada é gravado.
 * @param {any} tx @param {string} clienteId @param {string} empresaId
 * @param {Array<Record<string, any>>} gravados  tanques com `produtos: [{produto_id, ativo}]`
 */
export const revalidarAceitesDoBem = (tx, clienteId, empresaId, gravados) =>
  validarProdutosAcrescentados(
    tx,
    clienteId,
    empresaId,
    gravados.map((t, indice) => ({ indice, ids: t.ativo ? idsAtivos(t) : [] })),
  );

/**
 * Aceites retirados de um tanque: sem abastecimento → linha apagada; com
 * histórico → `ativo = false` (D11). Roda sob o FOR UPDATE do bem.
 * @param {any} tx @param {string} clienteId @param {string} tanqueId @param {string[]} retirados
 */
const retirarAceites = async (tx, clienteId, tanqueId, retirados) => {
  if (!retirados.length) return;
  const usados = await tx.abastecimentoBem.findMany({
    where: { cliente_id: clienteId, tanque_id: tanqueId, produto_id: { in: retirados } },
    select: { produto_id: true },
    distinct: ['produto_id'],
  });
  const comHistorico = new Set(usados.map((u) => u.produto_id));
  const apagar = retirados.filter((id) => !comHistorico.has(id));
  const desligar = retirados.filter((id) => comHistorico.has(id));
  if (apagar.length) await tx.tanqueBemProduto.deleteMany({ where: { cliente_id: clienteId, tanque_id: tanqueId, produto_id: { in: apagar } } });
  if (desligar.length) await tx.tanqueBemProduto.updateMany({ where: { cliente_id: clienteId, tanque_id: tanqueId, produto_id: { in: desligar } }, data: { ativo: false } });
};

/**
 * Sync dos tanques (A5.5): identificadores alterados passam primeiro por um
 * temporário único ` ~<id>` (cabe em 40) e depois recebem o final — trocar o
 * identificador entre dois tanques nunca colide no unique. O espaço inicial
 * torna o temporário inalcançável pelo corpo (`textoDoCorpo` apara): mesmo um
 * identificador digitado `~<id de outro tanque>` nunca colide com ele; atualiza
 * capacidade, observação e situação; sincroniza os Produtos aceitos (retirado
 * → apagado ou desligado, D11; inativo que volta → `ativo = true`; inédito →
 * criado); cria os tanques novos com os seus. Chame `validarTanques` antes.
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} bemId
 * @param {TanqueDesejado[]} desejados
 * @param {Array<Record<string, any>>} gravados  com `produtos: [{produto_id, ativo}]` (todas as linhas)
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
    const ativosAntes = idsAtivos(g);
    const inativosAntes = (g.produtos ?? []).filter((p) => !p.ativo).map((p) => p.produto_id);
    await retirarAceites(tx, clienteId, t.id, ativosAntes.filter((id) => !t.produto_ids.includes(id)));
    const voltam = t.produto_ids.filter((id) => inativosAntes.includes(id));
    if (voltam.length) await tx.tanqueBemProduto.updateMany({ where: { cliente_id: clienteId, tanque_id: t.id, produto_id: { in: voltam } }, data: { ativo: true } });
    const ineditos = t.produto_ids.filter((id) => !ativosAntes.includes(id) && !inativosAntes.includes(id));
    if (ineditos.length) {
      await tx.tanqueBemProduto.createMany({ data: ineditos.map((produtoId) => ({ cliente_id: clienteId, tanque_id: t.id, produto_id: produtoId })) });
    }
  }
  for (const t of desejados.filter((d) => !d.id)) {
    const novo = await tx.tanqueBem.create({
      data: { ...base, identificador: t.identificador, capacidade_litros: t.capacidade_litros, observacao: t.observacao, ativo: true },
      select: { id: true },
    });
    if (t.produto_ids.length) {
      await tx.tanqueBemProduto.createMany({ data: t.produto_ids.map((produtoId) => ({ cliente_id: clienteId, tanque_id: novo.id, produto_id: produtoId })) });
    }
  }
};
