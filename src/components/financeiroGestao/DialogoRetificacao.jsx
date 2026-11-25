import React, { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { DialogoAcao } from "@/components/financeiroGestao/DialogosLancamento";
import LotesDaConfirmacao from "@/components/financeiroGestao/LotesDaConfirmacao";
import { lotesDaConfirmacao } from "@/lib/estoqueLotesRegras";
import { listarLotesDisponiveis } from "@/services/estoqueConsultaService";

const chave = (/** @type {unknown} */ produto, /** @type {unknown} */ local) => `${String(produto ?? "")}|${String(local ?? "")}`;

/**
 * D-PROD-305 — os efeitos de estoque da correção com o controle de lote de cada produto e o estado inicial dos campos.
 * A prévia do servidor só existe para rascunho; aqui o controle de lote (e a validade) vem da leitura dos lotes do
 * produto no depósito (`GET /estoque/lotes-disponiveis`, a mesma do campo "Lote"). Sem a leitura, o item fica sem lote
 * (o servidor confere ao gravar).
 *  - compra: o lote do fabricante e a validade começam com os do lote de entrada da versão anterior (mesmo item, mesmo
 *    produto). A substituição só existe com esse lote intacto, então ele ainda está entre os disponíveis;
 *  - venda: `devolvidos` são as fatias que a versão anterior baixou daquele produto e depósito — o estorno as devolve
 *    antes da saída nova, então elas contam no saldo para conferir e escolher.
 * @param {{ mercadorias: any[], anteriores: any[], leituras: Map<string, any> }} p
 * @returns {{ efeitos: any[], inicial: Record<number, { lote: string, validade: string }> }}
 */
export const efeitosDaRetificacao = ({ mercadorias, anteriores, leituras }) => {
  const antigos = (Array.isArray(anteriores) ? anteriores : []).filter((/** @type {any} */ i) => i?.tipo_item === "MERCADORIA");
  /** @type {Record<number, { lote: string, validade: string }>} */
  const inicial = {};
  const efeitos = (Array.isArray(mercadorias) ? mercadorias : []).map((/** @type {any} */ m) => {
    const leitura = leituras.get(chave(m.produto_id, m.local_estoque_id));
    const devolvidos = antigos
      .filter((/** @type {any} */ i) => String(i.produto_id) === String(m.produto_id) && String(i.local_estoque_id) === String(m.local_estoque_id))
      .flatMap((/** @type {any} */ i) => (Array.isArray(i.consumos) ? i.consumos : []))
      .map((/** @type {any} */ k) => ({ lote_id: k.estoque_lote_nota_id, quantidade: k.quantidade }));
    const anterior = antigos.find((/** @type {any} */ i) => Number(i.ordem) === m.item_ordem && String(i.produto_id) === String(m.produto_id));
    if (anterior?.estoque_lote_nota_id) {
      const lotes = leituras.get(chave(anterior.produto_id, anterior.local_estoque_id))?.lotes;
      const lote = (Array.isArray(lotes) ? lotes : []).find((/** @type {any} */ l) => String(l?.id) === String(anterior.estoque_lote_nota_id));
      if (lote) inicial[m.item_ordem] = { lote: String(lote.lote_fabricante ?? ""), validade: String(lote.data_validade ?? "") };
    }
    return { ...m, controla_lote: leitura?.controla_lote === true, controla_validade: leitura?.controla_validade === true, devolvidos };
  });
  return { efeitos, inicial };
};

/**
 * D-PROD-305 — o diálogo "Salvar correção" do lançamento confirmado. Quando a correção muda o estoque (substituição:
 * estorno da versão anterior + efeitos novos), pede o lote como a confirmação: na compra, "Lote do fabricante" e
 * "Validade" (já preenchidos com os da versão anterior); na venda, o campo "Lote" (sugestão FEFO, escolher e dividir,
 * vencido pede confirmação). Com pendência de lote, "Salvar correção" fica desabilitado (as mesmas regras da
 * confirmação). Produto sem lote, ou correção sem mudança no estoque: nada aparece e nada é lido.
 * `onEnviar` recebe, além do motivo e das opções do envio, o `lotes_por_item` (vazio sem item de lote).
 * @param {{
 *   empresaId: string|null|undefined, direcao: string, mudaEstoque: boolean, mercadorias: any[], anteriores: any[],
 *   titulo: string, descricao: string, contexto: { locale: string, moeda: string, casas: number, direcao?: string|null },
 *   conteudo: React.ReactNode, onFechar: () => void, onConsultar?: (() => void) | null,
 *   onEnviar: (motivo: string, opcoes: { retentativa: boolean }, extra: { lotes_por_item: Array<Record<string, unknown>> }) => Promise<unknown>,
 * }} props
 */
export default function DialogoRetificacao({ empresaId, direcao, mudaEstoque, mercadorias, anteriores, titulo, descricao, contexto, conteudo, onFechar, onConsultar = null, onEnviar }) {
  const ativo = Boolean(mudaEstoque && empresaId && Array.isArray(mercadorias) && mercadorias.length);
  const antigos = (Array.isArray(anteriores) ? anteriores : []).filter((/** @type {any} */ i) => i?.tipo_item === "MERCADORIA");
  // Os pares produto|depósito a ler: os dos itens novos e, para trazer o lote anterior, os dos itens antigos do mesmo produto.
  /** @type {Map<string, [string, string]>} */
  const porChave = new Map();
  if (ativo) {
    for (const m of mercadorias) porChave.set(chave(m.produto_id, m.local_estoque_id), [String(m.produto_id), String(m.local_estoque_id)]);
    for (const i of antigos) {
      const mesmoItem = mercadorias.some((/** @type {any} */ m) => m.item_ordem === Number(i.ordem) && String(m.produto_id) === String(i.produto_id));
      if (i.estoque_lote_nota_id && mesmoItem) porChave.set(chave(i.produto_id, i.local_estoque_id), [String(i.produto_id), String(i.local_estoque_id)]);
    }
  }
  const pares = [...porChave.values()];
  const consultas = useQueries({
    queries: pares.map(([produtoId, localId]) => ({
      // A mesma chave do campo "Lote" (`CampoLotes`): a venda não relê.
      queryKey: ["estoque", "lotes-disponiveis", empresaId, produtoId, localId],
      queryFn: () => listarLotesDisponiveis(/** @type {string} */ (empresaId), produtoId, localId),
      staleTime: 15_000,
    })),
  });
  const carregando = consultas.some((c) => c.isLoading);
  const falhou = consultas.some((c) => c.isError);
  /** @type {Map<string, any>} */
  const leituras = new Map(pares.map(([produtoId, localId], k) => [chave(produtoId, localId), consultas[k]?.data]));
  const { efeitos, inicial } = efeitosDaRetificacao({ mercadorias: ativo ? mercadorias : [], anteriores, leituras });
  const [editado, setEditado] = useState(/** @type {Record<string, any>} */ ({}));
  // O que a pessoa mexeu vale; o resto começa com o da versão anterior.
  /** @type {Record<string, any>} */
  const estado = { ...inicial, ...editado };
  const mudar = (/** @type {number} */ n, /** @type {Record<string, unknown>} */ patch) =>
    setEditado((atual) => ({ ...atual, [n]: { ...(atual[n] ?? inicial[n] ?? {}), ...patch } }));
  const conferencia = lotesDaConfirmacao(direcao, efeitos, estado);
  const pendencia = ativo && carregando ? "Carregando os lotes dos produtos…" : conferencia.pendencia;
  const compra = direcao === "PAGAR";
  const preenchidos = efeitos.some((e) => e.controla_lote && inicial[e.item_ordem]);
  return (
    <DialogoAcao
      aberto
      testId="dialogo-retificacao"
      titulo={titulo}
      descricao={descricao}
      rotuloBotao="Salvar correção"
      perigo={false}
      contexto={contexto}
      bloqueio={pendencia}
      conteudo={
        <div className="min-w-0 space-y-3">
          {conteudo}
          {ativo && carregando ? (
            <p className="text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="retificacao-lotes-carregando">Carregando os lotes dos produtos…</p>
          ) : null}
          {ativo && !carregando && falhou ? (
            <p className="text-[12px] text-amber-800" role="status" data-testid="retificacao-lotes-falhou">
              Não foi possível ler os lotes agora. Ao salvar, o servidor confere: produto com lote precisa do lote na correção.
            </p>
          ) : null}
          {ativo && !carregando ? (
            <LotesDaConfirmacao
              empresaId={empresaId}
              direcao={direcao}
              efeitos={efeitos}
              estado={estado}
              onMudar={mudar}
              pendencia={conferencia.pendencia}
              aviso={compra && preenchidos ? "O lote e a validade vêm da versão anterior; altere se a correção mudou o lote." : ""}
            />
          ) : null}
        </div>
      }
      onFechar={onFechar}
      onConsultar={onConsultar}
      onEnviar={(motivo, opcoes) => onEnviar(motivo, opcoes, { lotes_por_item: conferencia.lotes_por_item })}
    />
  );
}
