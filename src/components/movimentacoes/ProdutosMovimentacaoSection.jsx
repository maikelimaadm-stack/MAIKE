import React, { useMemo } from "react";
import { Plus, X } from "lucide-react";
import AutocompleteGenerico from "../financeiro/AutocompleteGenerico.jsx";
import { formatarMoedaInput, parseMoedaInput, formatarMoeda } from "@/components/financeiro/moedaUtils";

const TH = "sticky top-0 z-10 bg-white text-[11px] font-medium text-gray-900 text-center align-middle whitespace-nowrap h-7 px-2 border-r border-b border-gray-200";
const TD = "px-2 py-0 text-xs align-middle border-r border-b border-gray-300 h-7";
const INP = "w-full bg-transparent border-0 outline-none text-xs h-[26px] px-0 focus:ring-0";

export default function ProdutosMovimentacaoSection({ itens, onChange, produtos, valorLiquidoFinanceiro }) {
  const totalLiquidoProdutos = itens.reduce((sum, r) => sum + (r.valor_liquido || 0), 0);

  const adicionarItem = () => {
    onChange([...itens, {
      produto_id: '', produto_nome: '', unidade_medida: '',
      quantidade: 0, valor_unitario: 0, valor_total: 0,
      valor_desconto: 0, valor_liquido: 0, valor_liquido_unitario: 0
    }]);
  };

  const removerItem = (index) => onChange(itens.filter((_, i) => i !== index));

  const atualizarItem = (index, campo, valor) => {
    const updated = itens.map((item, i) => {
      if (i !== index) return item;
      const newItem = { ...item };

      if (campo === 'produto_id') {
        const prod = produtos.find(p => p.id === valor);
        newItem.produto_id = valor;
        newItem.produto_nome = prod?.nome_produto || '';
        newItem.unidade_medida = prod?.unidade_medida || '';
        newItem.valor_unitario = prod?.preco_custo || 0;
        // Recalcular
        const total = newItem.quantidade * newItem.valor_unitario;
        newItem.valor_total = total;
        newItem.valor_liquido = Math.max(0, total - (newItem.valor_desconto || 0));
        newItem.valor_liquido_unitario = newItem.quantidade > 0 ? newItem.valor_liquido / newItem.quantidade : 0;
        return newItem;
      }

      if (campo === 'quantidade_input') {
        newItem.quantidade = parseMoedaInput(valor);
        const total = newItem.quantidade * newItem.valor_unitario;
        newItem.valor_total = total;
        newItem.valor_liquido = Math.max(0, total - (newItem.valor_desconto || 0));
        newItem.valor_liquido_unitario = newItem.quantidade > 0 ? newItem.valor_liquido / newItem.quantidade : 0;
        return newItem;
      }

      if (campo === 'valor_unitario_input') {
        newItem.valor_unitario = parseMoedaInput(valor);
        const total = newItem.quantidade * newItem.valor_unitario;
        newItem.valor_total = total;
        newItem.valor_liquido = Math.max(0, total - (newItem.valor_desconto || 0));
        newItem.valor_liquido_unitario = newItem.quantidade > 0 ? newItem.valor_liquido / newItem.quantidade : 0;
        return newItem;
      }

      if (campo === 'valor_desconto_input') {
        newItem.valor_desconto = parseMoedaInput(valor);
        newItem.valor_liquido = Math.max(0, newItem.valor_total - newItem.valor_desconto);
        newItem.valor_liquido_unitario = newItem.quantidade > 0 ? newItem.valor_liquido / newItem.quantidade : 0;
        return newItem;
      }

      return newItem;
    });
    onChange(updated);
  };

  const produtosItems = useMemo(() => {
    return produtos.filter(p => p.ativo !== false).map(p => ({
      ...p,
      display: `${p.nome_produto}${p.codigo_interno ? ` (${p.codigo_interno})` : ''}`
    }));
  }, [produtos]);

  const temDiferencaFinanceiro = valorLiquidoFinanceiro != null && Math.abs(totalLiquidoProdutos - valorLiquidoFinanceiro) > 0.01;

  return (
    <div className="border border-gray-200 rounded-lg">
      <div className="flex justify-between items-center px-2 h-7 bg-slate-100 border-b border-gray-200 rounded-t-lg">
        <span className="font-semibold text-xs text-slate-700">Produtos da Movimentação</span>
        <button type="button" onClick={adicionarItem} className="w-5 h-5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-emerald-600 flex items-center justify-center">
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {itens.length === 0 ? (
        <div className="text-[11px] text-slate-400 text-center py-4">Nenhum produto adicionado. Clique em + para adicionar.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border-separate border-spacing-0 table-fixed min-w-[900px]">
            <colgroup>
              <col style={{ width: 240 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 28 }} />
            </colgroup>
            <thead>
              <tr>
                <th className={`${TH} text-left`}>Produto</th>
                <th className={TH}>Quantidade</th>
                <th className={TH}>UN</th>
                <th className={TH}>Vlr. Unit.</th>
                <th className={TH}>Vlr. Total</th>
                <th className={TH}>Vlr. Desconto</th>
                <th className={TH}>Vlr. Líquido</th>
                <th className={TH}>Vlr. Líq. Unit.</th>
                <th className={`${TH} border-r-0`}></th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className={`${TD} overflow-visible relative`}>
                    <AutocompleteGenerico
                      items={produtosItems}
                      value={item.produto_id}
                      onChange={(v) => atualizarItem(index, 'produto_id', v)}
                      placeholder="BUSCAR PRODUTO..."
                      displayField="display"
                      searchFields={["nome_produto", "codigo_interno", "codigo_barras"]}
                      className="w-full"
                      inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[26px] text-xs px-0 uppercase"
                    />
                  </td>
                  <td className={TD}>
                    <input
                      value={formatarMoedaInput(item.quantidade)}
                      onChange={(e) => atualizarItem(index, 'quantidade_input', e.target.value)}
                      placeholder="0,00"
                      className={`${INP} text-center font-mono`}
                    />
                  </td>
                  <td className={`${TD} text-center text-[11px] text-slate-500 font-mono`}>
                    {item.unidade_medida || '-'}
                  </td>
                  <td className={TD}>
                    <input
                      value={formatarMoedaInput(item.valor_unitario)}
                      onChange={(e) => atualizarItem(index, 'valor_unitario_input', e.target.value)}
                      placeholder="0,00"
                      className={`${INP} text-right font-mono`}
                    />
                  </td>
                  <td className={`${TD} text-right font-mono text-[11px] text-slate-600`}>
                    {formatarMoedaInput(item.valor_total)}
                  </td>
                  <td className={TD}>
                    <input
                      value={formatarMoedaInput(item.valor_desconto)}
                      onChange={(e) => atualizarItem(index, 'valor_desconto_input', e.target.value)}
                      placeholder="0,00"
                      className={`${INP} text-right font-mono`}
                    />
                  </td>
                  <td className={`${TD} text-right font-mono text-[11px] font-semibold text-emerald-700`}>
                    {formatarMoedaInput(item.valor_liquido)}
                  </td>
                  <td className={`${TD} text-right font-mono text-[11px] text-slate-500`}>
                    {formatarMoedaInput(item.valor_liquido_unitario)}
                  </td>
                  <td className={`${TD} text-center border-r-0`}>
                    <button type="button" onClick={() => removerItem(index)} className="text-slate-400 hover:text-red-500">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {itens.length > 0 && (
        <div className={`flex justify-between text-[11px] px-2 h-[26px] items-center rounded-b-lg border-t ${temDiferencaFinanceiro ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
          <span className="font-semibold">Total Líquido Produtos: {formatarMoeda(totalLiquidoProdutos)}</span>
          {valorLiquidoFinanceiro != null && (
            <span className="font-semibold">
              Financeiro: {formatarMoeda(valorLiquidoFinanceiro)}
              {temDiferencaFinanceiro && <span className="ml-1 text-red-600 font-bold">⚠ DIFERENÇA</span>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}