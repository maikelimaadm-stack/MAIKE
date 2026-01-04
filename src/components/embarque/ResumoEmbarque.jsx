import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function ResumoEmbarque({ embarques, documentos, embarqueSelecionado, pesagens, pendingPesagens }) {
  const docs = useMemo(() => documentos.filter(d => d.embarque_id === embarqueSelecionado), [documentos, embarqueSelecionado]);
  const allPesagens = useMemo(() => [...(pesagens||[]), ...(pendingPesagens||[])], [pesagens, pendingPesagens]);

  const linhas = useMemo(() => {
    return docs.map(d => {
      const embarcadosDoc = allPesagens.filter(p => p.documento_embarque_id === d.id);
      const machos = embarcadosDoc.filter(p => p.sexo === 'M').length;
      const femeas = embarcadosDoc.filter(p => p.sexo === 'F').length;
      return {
        id: d.id,
        doc: d.tipo_documento,
        numero: d.numero_gta || d.numero_nfe || '-',
        prevM: d.qtd_prev_machos || 0,
        prevF: d.qtd_prev_femeas || 0,
        embM: machos,
        embF: femeas
      };
    });
  }, [docs, allPesagens]);

  const totais = useMemo(() => {
    return linhas.reduce((acc, l) => ({
      prevM: acc.prevM + l.prevM,
      prevF: acc.prevF + l.prevF,
      embM: acc.embM + l.embM,
      embF: acc.embF + l.embF
    }), { prevM: 0, prevF: 0, embM: 0, embF: 0 });
  }, [linhas]);

  return (
    <div className="xl:col-span-1 lg:col-span-1">
      <Card className="shadow-sm sticky top-2">
        <CardHeader className="py-2 px-3 bg-slate-200 border-b">
          <CardTitle className="text-xs font-semibold">Documentação / Embarque</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          {docs.length === 0 ? (
            <div className="text-center py-6 text-slate-400 text-xs">Selecione um embarque para ver os documentos</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Doc</TableHead>
                    <TableHead className="text-[10px]">Nº</TableHead>
                    <TableHead className="text-[10px] text-center">Prev M/F</TableHead>
                    <TableHead className="text-[10px] text-center">Emb M/F</TableHead>
                    <TableHead className="text-[10px] text-center">Faltam</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map(l => (
                    <TableRow key={l.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs">{l.doc}</TableCell>
                      <TableCell className="text-xs">{l.numero}</TableCell>
                      <TableCell className="text-xs text-center">{l.prevM}/{l.prevF}</TableCell>
                      <TableCell className="text-xs text-center">{l.embM}/{l.embF}</TableCell>
                      <TableCell className="text-xs text-center">{Math.max(0, l.prevM - l.embM)}/{Math.max(0, l.prevF - l.embF)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-2 pt-2 border-t text-xs text-center text-slate-600">
                Previsto: {totais.prevM}/{totais.prevF} • Embarcado: {totais.embM}/{totais.embF} • Falta: {Math.max(0, totais.prevM - totais.embM)}/{Math.max(0, totais.prevF - totais.embF)}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}