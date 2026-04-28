import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const thClass = "text-xs py-2 px-3 font-bold border-b cursor-pointer hover:bg-gray-50 uppercase";
const tdClass = "text-xs py-2 px-3 border-b uppercase";
const tdNumClass = "text-xs py-2 px-3 border-b text-right font-mono";

const statusBadgeClass = {
  critico: "bg-red-100 text-red-700 border-red-200",
  atencao: "bg-amber-100 text-amber-700 border-amber-200",
  normal: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const formatarNumero = (num, casas = 3) => Number(num || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const formatarInteiro = (num) => Number(num || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const formatarData = (valor) => {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleDateString('pt-BR');
};

function valorCelula(linha, coluna) {
  switch (coluna) {
    case 'data': return formatarData(linha.data_evento);
    case 'retiro': return linha.retiro_nome || '-';
    case 'modulo': return linha.modulo_nome || '-';
    case 'area': return linha.area_nome || '-';
    case 'lote': return linha.lote_nome || '-';
    case 'categoria': return linha.categoria_lote || '-';
    case 'cabecas': return formatarInteiro(linha.cabecas);
    case 'peso_medio': return formatarInteiro(linha.peso_medio);
    case 'classificacao_produto': return linha.classificacao_produto || '-';
    case 'produto': return linha.produto_nome || '-';
    case 'quantidade_kg': return formatarNumero(linha.realizado, 1);
    case 'meta_consumo': return formatarNumero(linha.meta_percentual, 3);
    case 'consumo_percentual': return formatarNumero(linha.consumo_percentual, 3);
    case 'desvio_percentual': return formatarNumero(linha.desvio_percentual, 3);
    case 'meta_cabeca': return formatarNumero(linha.meta_cabeca, 3);
    case 'consumo_cabeca': return formatarNumero(linha.consumo_por_cabeca, 3);
    case 'desvio_cabeca': return formatarNumero(linha.desvio_cabeca, 3);
    case 'cocho': return linha.cocho_nome || '-';
    case 'deposito': return linha.deposito_nome || '-';
    case 'status': return linha.status;
    default: return '-';
  }
}

export default function TabelaAnaliseLotes({ titulo, linhas, colunasVisiveis, mostrarDetalhes }) {
  return (
    <div className="rounded-xl border bg-card shadow overflow-x-auto">
      <div className="p-3 border-b bg-slate-50 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase text-slate-900">{titulo}</h3>
        <span className="text-xs text-slate-500">{linhas.length} registros</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {colunasVisiveis.map((coluna) => (
              <TableHead key={coluna} className={`${thClass} ${['cabecas','peso_medio','quantidade_kg','meta_consumo','consumo_percentual','desvio_percentual','meta_cabeca','consumo_cabeca','desvio_cabeca'].includes(coluna) ? 'text-right' : 'text-left'}`}>
                {coluna.replaceAll('_', ' ')}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.length ? linhas.map((linha) => (
            <React.Fragment key={linha.id || `${linha.lote_nome}-${linha.data_evento}`}>
              <TableRow className="hover:bg-gray-50">
                {colunasVisiveis.map((coluna) => (
                  <TableCell key={coluna} className={['cabecas','peso_medio','quantidade_kg','meta_consumo','consumo_percentual','desvio_percentual','meta_cabeca','consumo_cabeca','desvio_cabeca'].includes(coluna) ? tdNumClass : tdClass}>
                    {coluna === 'status' ? <Badge className={statusBadgeClass[linha.status] || statusBadgeClass.normal}>{String(valorCelula(linha, coluna)).toUpperCase()}</Badge> : valorCelula(linha, coluna)}
                  </TableCell>
                ))}
              </TableRow>
              {mostrarDetalhes && linha.detalhes_texto && (
                <TableRow>
                  <TableCell colSpan={colunasVisiveis.length} className="text-xs py-2 px-3 bg-slate-50 border-b text-slate-600 uppercase">
                    {linha.detalhes_texto}
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          )) : (
            <TableRow>
              <TableCell colSpan={colunasVisiveis.length} className="text-center py-8 text-xs text-slate-400">Nenhum registro encontrado</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}