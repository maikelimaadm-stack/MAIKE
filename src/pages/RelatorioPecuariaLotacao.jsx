import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import RelatorioBase from "@/components/relatorios/RelatorioBase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fmt = (value, digits = 2) => Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default function RelatorioPecuariaLotacao() {
  const empresaId = typeof window !== "undefined" ? localStorage.getItem("empresa_selecionada_id") : null;
  const [orientacao, setOrientacao] = useState("paisagem");

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-relatorio-lotacao"],
    queryFn: () => base44.entities.Empresa.list(),
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["areas-relatorio-lotacao", empresaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((area) => area.empresa_id === empresaId && area.ativo !== false);
    },
    enabled: !!empresaId,
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ["lotes-relatorio-lotacao", empresaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((lote) => lote.empresa_id === empresaId && lote.status === "Ativo");
    },
    enabled: !!empresaId,
  });

  const empresaAtual = useMemo(() => empresas.find((empresa) => empresa.id === empresaId), [empresas, empresaId]);

  const areaRows = useMemo(() => {
    return areas.map((area) => {
      const lotesArea = lotes.filter((lote) => lote.area_atual_id === area.id);
      const cabecas = lotesArea.reduce((sum, lote) => sum + Number(lote.quantidade_cabecas || 0), 0);
      const pesoTotal = lotesArea.reduce((sum, lote) => sum + Number(lote.quantidade_cabecas || 0) * Number(lote.peso_medio_kg || 0), 0);
      const uaTotal = pesoTotal / 450;
      const hectares = Number(area.area_pastejada || area.tamanho_hectares || 0);
      const capacidadeUa = Number(area.capacidade_maxima || 0);

      return {
        id: area.id,
        nome: area.nome || "-",
        setor: area.setor_nome || "-",
        hectares,
        capacidadeUa,
        lotes: lotesArea.length,
        cabecas,
        pesoMedio: cabecas > 0 ? pesoTotal / cabecas : 0,
        uaTotal,
        uaHa: hectares > 0 ? uaTotal / hectares : 0,
        ocupacao: capacidadeUa > 0 ? (uaTotal / capacidadeUa) * 100 : 0,
      };
    }).sort((a, b) => a.setor.localeCompare(b.setor) || a.nome.localeCompare(b.nome));
  }, [areas, lotes]);

  const total = useMemo(() => {
    const cabecas = areaRows.reduce((sum, row) => sum + row.cabecas, 0);
    const hectares = areaRows.reduce((sum, row) => sum + row.hectares, 0);
    const uaTotal = areaRows.reduce((sum, row) => sum + row.uaTotal, 0);
    const pesoTotal = lotes.reduce((sum, lote) => sum + Number(lote.quantidade_cabecas || 0) * Number(lote.peso_medio_kg || 0), 0);
    return {
      areas: areaRows.length,
      lotes: areaRows.reduce((sum, row) => sum + row.lotes, 0),
      cabecas,
      hectares,
      uaTotal,
      uaHa: hectares > 0 ? uaTotal / hectares : 0,
      pesoMedio: cabecas > 0 ? pesoTotal / cabecas : 0,
    };
  }, [areaRows, lotes]);

  const filtros = (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      <div>
        <Label className="text-xs mb-1 block">Orientação</Label>
        <Select value={orientacao} onValueChange={setOrientacao}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="paisagem" className="text-xs">Paisagem</SelectItem>
            <SelectItem value="retrato" className="text-xs">Retrato</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  return (
    <RelatorioBase
      titulo="Relatório Técnico de Lotação"
      subtitulo="Resumo técnico de lotação por área"
      empresaAtual={empresaAtual}
      filtros={filtros}
      orientacao={orientacao}
      resumoTotais={`Áreas: ${total.areas} | Lotes: ${total.lotes} | Cabeças: ${total.cabecas} | UA total: ${fmt(total.uaTotal)} | UA/ha: ${fmt(total.uaHa)}`}
    >
      <div className="space-y-4">
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-xs">
              <div><strong>Áreas:</strong> {total.areas}</div>
              <div><strong>Lotes:</strong> {total.lotes}</div>
              <div><strong>Cabeças:</strong> {total.cabecas}</div>
              <div><strong>Hectares:</strong> {fmt(total.hectares)}</div>
              <div><strong>UA total:</strong> {fmt(total.uaTotal)}</div>
              <div><strong>UA/ha:</strong> {fmt(total.uaHa)}</div>
              <div><strong>Peso médio:</strong> {fmt(total.pesoMedio, 1)} kg</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Lotação por Área</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="text-xs font-bold py-1 border border-black">Setor</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Área</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Hectares</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Lotes</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Cabeças</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Peso médio</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">UA total</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">UA/ha</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Ocupação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {areaRows.map((row) => (
                    <TableRow key={row.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300">{row.setor}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{row.nome}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right">{fmt(row.hectares)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right">{row.lotes}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right">{row.cabecas}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right">{fmt(row.pesoMedio, 1)} kg</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right">{fmt(row.uaTotal)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right">{fmt(row.uaHa)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right">{fmt(row.ocupacao, 0)}%</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-gray-100 font-bold">
                    <TableCell colSpan={2} className="text-xs py-1 border border-black">TOTAL GERAL</TableCell>
                    <TableCell className="text-xs py-1 border border-black text-right">{fmt(total.hectares)}</TableCell>
                    <TableCell className="text-xs py-1 border border-black text-right">{total.lotes}</TableCell>
                    <TableCell className="text-xs py-1 border border-black text-right">{total.cabecas}</TableCell>
                    <TableCell className="text-xs py-1 border border-black text-right">{fmt(total.pesoMedio, 1)} kg</TableCell>
                    <TableCell className="text-xs py-1 border border-black text-right">{fmt(total.uaTotal)}</TableCell>
                    <TableCell className="text-xs py-1 border border-black text-right">{fmt(total.uaHa)}</TableCell>
                    <TableCell className="text-xs py-1 border border-black text-right">-</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </RelatorioBase>
  );
}