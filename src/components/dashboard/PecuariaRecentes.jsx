import React from "react";
import { Link } from "react-router-dom";
import { ArrowRightLeft, Scale } from "lucide-react";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const formatDate = (value) => {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR");
};

export default function PecuariaRecentes({ pesagens, movimentacoes }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold text-slate-900">Últimas pesagens individuais</CardTitle>
            <Link to={createPageUrl("PesagensIndividuais")}>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                <Scale className="w-3.5 h-3.5" />
                Ver todas
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-bold py-1 border border-black">Animal</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Data</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Lote</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black text-right">Peso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pesagens.length > 0 ? pesagens.map((item) => (
                <TableRow key={item.id} className="hover:bg-gray-50">
                  <TableCell className="text-xs py-1 border border-gray-300">{item.numero_animal || "-"}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{formatDate(item.data_pesagem)}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{item.nome_lote || "-"}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300 text-right">{Number(item.peso || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg</TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-xs py-6 border border-gray-300 text-center text-slate-500">Nenhuma pesagem recente encontrada.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold text-slate-900">Últimas movimentações pecuárias</CardTitle>
            <Link to={createPageUrl("HistoricoMovimentacoesPecuaria")}>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5" />
                Ver histórico
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Data</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Motivo</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black text-right">Animais</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movimentacoes.length > 0 ? movimentacoes.map((item) => (
                <TableRow key={item.id} className="hover:bg-gray-50">
                  <TableCell className="text-xs py-1 border border-gray-300">{item.tipo || "-"}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{formatDate(item.data_movimentacao)}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{item.motivo || item.lote || "-"}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300 text-right">{Number(item.quantidade_animais || 0).toLocaleString("pt-BR")}</TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-xs py-6 border border-gray-300 text-center text-slate-500">Nenhuma movimentação recente encontrada.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}