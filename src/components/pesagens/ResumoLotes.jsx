import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const formatarData = (dataString) => {
  if (!dataString) return '--/--/----';
  try {
    const dataStr = dataString.split('T')[0];
    const [ano, mes, dia] = dataStr.split('-');
    if (!ano || !mes || !dia) return '--/--/----';
    return `${dia}/${mes}/${ano}`;
  } catch {return '--/--/----';}
};

export default function ResumoLotes({ apartacaoSelecionada, apartacoes, lotesApartacaoAtual, pesagens, pesagensDia, pendingPesagensDB, dataPesagem }) {
  const [modoVisualizacao, setModoVisualizacao] = useState('dia');

  const resumoLotes = useMemo(() => {
    if (!apartacaoSelecionada || !lotesApartacaoAtual || lotesApartacaoAtual.length === 0) return [];
    let todasPesagensApartacao;
    if (modoVisualizacao === 'dia') {
      todasPesagensApartacao = (pesagensDia || []).filter((p) => p.apartacao_id === apartacaoSelecionada);
    } else {
      todasPesagensApartacao = [
        ...(pesagens || []).filter((p) => p.apartacao_id === apartacaoSelecionada),
        ...(pendingPesagensDB || []).filter((p) => p.apartacao_id === apartacaoSelecionada)
      ];
    }
    return lotesApartacaoAtual.map((lote) => {
      const animaisLote = todasPesagensApartacao.filter((p) => p.lote_id === lote.id);
      const qtd = animaisLote.length;
      const pesoTotal = animaisLote.reduce((s, p) => s + (p.peso || 0), 0);
      const pesoMedio = qtd > 0 ? pesoTotal / qtd : 0;
      return { ...lote, quantidade_atual: qtd, peso_medio: pesoMedio };
    }).sort((a, b) => (a.nome_lote || '').localeCompare(b.nome_lote || ''));
  }, [apartacaoSelecionada, lotesApartacaoAtual, pesagens, pesagensDia, pendingPesagensDB, modoVisualizacao]);

  return (
    <div className="xl:col-span-1 lg:col-span-1">
      <Card className="shadow-sm sticky top-2">
        <CardHeader className="py-2 px-3 bg-slate-200 border-b flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-semibold">Distribuição de Lotes</CardTitle>
          {apartacaoSelecionada && resumoLotes.length > 0 &&
            <div className="flex gap-1">
              <Button variant={modoVisualizacao === 'dia' ? 'default' : 'outline'} size="sm" className="h-6 text-[10px] px-2" onClick={() => setModoVisualizacao('dia')}>Dia</Button>
              <Button variant={modoVisualizacao === 'total' ? 'default' : 'outline'} size="sm" className="h-6 text-[10px] px-2" onClick={() => setModoVisualizacao('total')}>Total</Button>
            </div>
          }
        </CardHeader>
        <CardContent className="p-2">
          {apartacaoSelecionada && resumoLotes.length > 0 ? (
            <>
              <div className="text-center mb-2 py-2 bg-emerald-50 rounded">
                <span className="text-lg font-bold text-emerald-800">
                  {apartacoes?.find((a) => a.id === apartacaoSelecionada)?.nome_apartacao || 'Apartação'}
                </span>
                <div className="text-[10px] text-emerald-600">
                  {modoVisualizacao === 'dia' ? `Pesagens do dia (${formatarData(dataPesagem)})` : 'Todas as pesagens'}
                </div>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead className="text-[10px]">Lote</TableHead><TableHead className="text-[10px] text-right">Qtd.</TableHead><TableHead className="text-[10px] text-right">Média</TableHead></TableRow></TableHeader>
                <TableBody>
                  {resumoLotes.map((lote) => {
                    const cheio = lote.fechado || lote.quantidade_atual >= (lote.quantidade_maxima || 999999);
                    return (
                      <TableRow key={lote.id} className={cheio ? "bg-red-50" : ""}>
                        <TableCell className={`text-xs font-medium ${cheio ? "text-red-700" : ""}`}>{lote.nome_lote} {cheio && "[FECHADO]"}</TableCell>
                        <TableCell className={`text-xs text-right ${cheio ? "text-red-700 font-bold" : ""}`}>{lote.quantidade_atual}/{lote.quantidade_maxima || 0}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{lote.peso_medio?.toFixed(2) || '0.00'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="mt-2 pt-2 border-t text-xs text-center text-slate-500">
                Qtd. Lançada: {resumoLotes.reduce((s, l) => s + (l.quantidade_atual || 0), 0)}
              </div>
            </>
          ) : (
            <div className="text-center py-6 text-slate-400 text-xs">
              {apartacaoSelecionada ? 'Nenhum lote cadastrado nesta apartação' : 'Selecione uma apartação para ver os lotes'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}