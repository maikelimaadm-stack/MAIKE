/**
 * Renomeação de produto nos dependentes que só guardam o NOME (D-PROD-136).
 *
 * `PontoSuplementacao.produto_padrao` (o lançamento de suplementação pré-seleciona
 * o produto por esse nome) e `ManejoTecnicoRebanho.dados.produto/produto_utilizado`
 * não têm `produto_id`. A regra por nome do `/referencias/sincronizar` tomava o
 * nome antigo do CORPO — qualquer um com a tela de Produtos reescrevia cochos e
 * manejos de outro produto (REF-01). Aqui o nome antigo é o do banco, lido na
 * MESMA transação do PATCH, e o casamento é pela chave única do produto:
 * `@@unique([cliente_id, empresa_id, nome_produto])`. Na hora da renomeação,
 * (empresa, nome antigo) identifica exatamente este produto — não é casamento
 * por nome ambíguo, como seria com `Setor.nome`.
 *
 * Fail-closed: se outro produto da mesma empresa ainda responde pelo nome antigo
 * (o unique do banco distingue caixa; a comparação aqui, como a do formulário,
 * não), o nome não identifica ninguém e nada é propagado. Produto que trocou de
 * empresa no mesmo PATCH também não: o nome antigo deixou de ser chave dele lá.
 */
import { Prisma } from '@prisma/client';

const AGORA_UTC = Prisma.raw(`(now() AT TIME ZONE 'UTC')`);
const igual = (expr, nome) => Prisma.sql`lower(btrim(${expr})) = lower(btrim(${nome}::text))`;

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {{id: string, empresa_id: string, nome_produto: string}} anterior lido do banco no PATCH
 * @param {{id: string, empresa_id: string, nome_produto: string}} registro gravado no PATCH
 * @returns {Promise<{porTabela: Record<string, number>, ids: Record<string, string[]>, valores: Record<string, string | null>}>}
 */
export const propagarRenomeacaoDeProduto = async (tx, clienteId, anterior, registro) => {
  const vazio = { porTabela: {}, ids: {}, valores: {} };
  const antigo = anterior.nome_produto;
  const novo = registro.nome_produto;
  if (!antigo || antigo === novo || anterior.empresa_id !== registro.empresa_id) return vazio;
  const empresaId = anterior.empresa_id;

  const homonimo = await tx.$queryRaw`
    SELECT 1 FROM "Produto"
     WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND id <> ${registro.id}
       AND ${igual(Prisma.sql`nome_produto`, antigo)}
     LIMIT 1`;
  if (/** @type {unknown[]} */ (homonimo).length) return vazio;

  const cochos = /** @type {Array<{id: string}>} */ (await tx.$queryRaw`
    UPDATE "PontoSuplementacao" SET produto_padrao = ${novo}, "updatedAt" = ${AGORA_UTC}
     WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND ${igual(Prisma.sql`produto_padrao`, antigo)}
    RETURNING id`);

  const campoCasa = (chave) => igual(Prisma.sql`dados->>${Prisma.raw(`'${chave}'`)}`, antigo);
  const trocaSeCasa = (chave) =>
    Prisma.sql`CASE WHEN ${campoCasa(chave)} THEN jsonb_build_object(${Prisma.raw(`'${chave}'`)}, ${novo}::text) ELSE '{}'::jsonb END`;
  const manejos = /** @type {Array<{id: string}>} */ (await tx.$queryRaw`
    UPDATE "ManejoTecnicoRebanho"
       SET dados = dados || ${trocaSeCasa('produto')} || ${trocaSeCasa('produto_utilizado')}, "updatedAt" = ${AGORA_UTC}
     WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND jsonb_typeof(dados) = 'object'
       AND (${campoCasa('produto')} OR ${campoCasa('produto_utilizado')})
    RETURNING id`);

  /** @type {Record<string, number>} */
  const porTabela = {};
  /** @type {Record<string, string[]>} */
  const ids = {};
  /** @type {Record<string, string | null>} */
  const valores = {};
  if (cochos.length) {
    porTabela.PontoSuplementacao = cochos.length;
    ids.PontoSuplementacao = cochos.map((l) => l.id);
    valores['PontoSuplementacao.produto_padrao'] = novo;
  }
  if (manejos.length) {
    porTabela.ManejoTecnicoRebanho = manejos.length;
    ids.ManejoTecnicoRebanho = manejos.map((l) => l.id);
    valores['ManejoTecnicoRebanho.produto'] = novo;
  }
  return { porTabela, ids, valores };
};
