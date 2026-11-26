import { obterAtividade, listarAtividades } from "@/services/lancamentoAtividadesService";
import { STATUS_ABERTA } from "@/lib/lancamentoAtividadesRegras";

/**
 * A atividade inteira para as janelas do Mapa (D-PROD-278/335): o detalhe (versão, operação, áreas) com o `andamento` e o
 * custo da linha da lista (filtrada pela área e pelas abertas; sem ela, as janelas funcionam sem a prévia do andamento).
 * Fica num arquivo próprio para o `DiarioDoPasto` e o `AcoesDaAtividadeDaArea` a importarem sem ciclo.
 * @param {string} atividadeId @param {string} areaId
 */
export const lerAtividadeParaAcoes = async (atividadeId, areaId) => {
  const [detalhe, pagina] = await Promise.all([
    obterAtividade(atividadeId),
    listarAtividades({ area_id: areaId, status: STATUS_ABERTA }).catch(() => null),
  ]);
  const itens = /** @type {any[]} */ (Array.isArray(/** @type {any} */ (pagina)?.items) ? /** @type {any} */ (pagina).items : []);
  const daLista = itens.find((i) => String(i?.id) === atividadeId) ?? null;
  const d = /** @type {any} */ (detalhe);
  return { ...(daLista ?? {}), ...d, andamento: daLista?.andamento ?? d?.andamento ?? null, custo_total: daLista?.custo_total ?? d?.custo_total ?? null };
};
