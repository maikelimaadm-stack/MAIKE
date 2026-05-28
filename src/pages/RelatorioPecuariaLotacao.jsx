import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import RelatorioBase from "@/components/relatorios/RelatorioBase";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fmt = (value, digits = 2) => Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtInt = (value) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const today = new Date();

const diffDays = (dateValue) => {
  if (!dateValue) return 0;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((today - date) / 86400000));
};

export default function RelatorioPecuariaLotacao() {
  const empresaId = typeof window !== "undefined" ? localStorage.getItem("empresa_selecionada_id") : null;
  const [orientacao, setOrientacao] = useState("paisagem");
  const [setorFiltro, setSetorFiltro] = useState("todos");
  const [areaFiltro, setAreaFiltro] = useState("todas");

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-relatorio-gado"],
    queryFn: () => base44.entities.Empresa.list(),
  });

  const { data: setores = [] } = useQuery({
    queryKey: ["setores-relatorio-gado", empresaId],
    queryFn: async () => {
      const all = await base44.entities.Setor.list();
      return all.filter((item) => item.empresa_id === empresaId);
    },
    enabled: !!empresaId,
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["areas-relatorio-gado", empresaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((item) => item.empresa_id === empresaId && item.ativo !== false);
    },
    enabled: !!empresaId,
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ["lotes-relatorio-gado", empresaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((item) => item.empresa_id === empresaId && item.status === "Ativo");
    },
    enabled: !!empresaId,
  });

  const { data: eventosSuplementacao = [] } = useQuery({
    queryKey: ["suplementacao-relatorio-gado", empresaId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list("-data_lancamento");
      return all.filter((item) => item.empresa_id === empresaId);
    },
    enabled: !!empresaId,
  });

  const empresaAtual = useMemo(() => empresas.find((item) => item.id === empresaId), [empresas, empresaId]);
  const setorMap = useMemo(() => new Map(setores.map((item) => [item.id, item])), [setores]);
  const areaMap = useMemo(() => new Map(areas.map((item) => [item.id, item])), [areas]);

  const eventosPorArea = useMemo(() => {
    const map = new Map();
    eventosSuplementacao.forEach((evento) => {
      const ids = evento.area_ids?.length ? evento.area_ids : [evento.area_id].filter(Boolean);
      ids.forEach((areaId) => {
        if (!map.has(areaId)) map.set(areaId, []);
        map.get(areaId).push(evento);
      });
    });
    return map;
  }, [eventosSuplementacao]);

  const lotesAtuais = useMemo(() => {
    return lotes
      .filter((lote) => lote.area_atual_id)
      .filter((lote) => setorFiltro === "todos" || lote.setor_id === setorFiltro || areaMap.get(lote.area_atual_id)?.setor_id === setorFiltro)
      .filter((lote) => areaFiltro === "todas" || lote.area_atual_id === areaFiltro)
      .sort((a, b) => (a.setor_nome || "").localeCompare(b.setor_nome || "") || (a.area_atual_nome || "").localeCompare(b.area_atual_nome || "") || (a.nome || "").localeCompare(b.nome || ""));
  }, [lotes, setorFiltro, areaFiltro, areaMap]);

  const grupos = useMemo(() => {
    const grouped = new Map();

    lotesAtuais.forEach((lote) => {
      const area = areaMap.get(lote.area_atual_id) || {};
      const setorId = area.setor_id || lote.setor_id || "sem_setor";
      const setorNome = area.setor_nome || lote.setor_nome || setorMap.get(setorId)?.nome || "Sem setor";
      const areaId = lote.area_atual_id || "sem_area";
      const key = `${setorId}__${areaId}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          setorId,
          setorNome,
          areaId,
          areaNome: area.nome || lote.area_atual_nome || "Sem área",
          hectares: Number(area.area_pastejada || area.tamanho_hectares || 0),
          pastagem: area.tipo_pastagem || area.tipo_cultura || "-",
          lotes: [],
        });
      }

      const cabecas = Number(lote.quantidade_cabecas || 0);
      const pesoMedio = Number(lote.peso_medio_kg || 0);
      grouped.get(key).lotes.push({
        ...lote,
        cabecas,
        pesoMedio,
        uaTotal: cabecas * pesoMedio / 450,
        diasPastejo: diffDays(lote.data_entrada),
      });
    });

    return Array.from(grouped.values()).map((grupo) => {
      const cabecas = grupo.lotes.reduce((sum, lote) => sum + lote.cabecas, 0);
      const pesoTotal = grupo.lotes.reduce((sum, lote) => sum + lote.cabecas * lote.pesoMedio, 0);
      const uaTotal = grupo.lotes.reduce((sum, lote) => sum + lote.uaTotal, 0);
      const eventos = eventosPorArea.get(grupo.areaId) || [];
      const ultimoEvento = eventos[0] || null;

      return {
        ...grupo,
        cabecas,
        uaTotal,
        uaHa: grupo.hectares > 0 ? uaTotal / grupo.hectares : 0,
        qtdLotes: grupo.lotes.length,
        mediaGeral: cabecas > 0 ? pesoTotal / cabecas : 0,
        diasPastejo: grupo.lotes.length > 0 ? Math.max(...grupo.lotes.map((lote) => lote.diasPastejo || 0)) : 0,
        ultimoConsumo: ultimoEvento ? `${ultimoEvento.produto || "-"} em ${new Date(ultimoEvento.data_lancamento).toLocaleDateString("pt-BR")}` : "-",
      };
    }).sort((a, b) => a.setorNome.localeCompare(b.setorNome) || a.areaNome.localeCompare(b.areaNome));
  }, [lotesAtuais, areaMap, setorMap, eventosPorArea]);

  const totalGeral = useMemo(() => {
    const cabecas = grupos.reduce((sum, grupo) => sum + grupo.cabecas, 0);
    const uaTotal = grupos.reduce((sum, grupo) => sum + grupo.uaTotal, 0);
    const hectares = grupos.reduce((sum, grupo) => sum + grupo.hectares, 0);
    const pesoTotal = grupos.reduce((sum, grupo) => sum + grupo.lotes.reduce((sub, lote) => sub + lote.cabecas * lote.pesoMedio, 0), 0);

    return {
      setores: new Set(grupos.map((grupo) => grupo.setorId)).size,
      areas: grupos.length,
      lotes: grupos.reduce((sum, grupo) => sum + grupo.qtdLotes, 0),
      cabecas,
      hectares,
      uaTotal,
      uaHa: hectares > 0 ? uaTotal / hectares : 0,
      mediaGeral: cabecas > 0 ? pesoTotal / cabecas : 0,
    };
  }, [grupos]);

  const areasFiltradas = useMemo(() => {
    return areas.filter((area) => setorFiltro === "todos" || area.setor_id === setorFiltro);
  }, [areas, setorFiltro]);

  const filtros = (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
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
      <div>
        <Label className="text-xs mb-1 block">Setor</Label>
        <Select value={setorFiltro} onValueChange={(value) => { setSetorFiltro(value); setAreaFiltro("todas"); }}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos" className="text-xs">Todos</SelectItem>
            {setores.map((setor) => <SelectItem key={setor.id} value={setor.id} className="text-xs">{setor.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs mb-1 block">Área</Label>
        <Select value={areaFiltro} onValueChange={setAreaFiltro}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas" className="text-xs">Todas</SelectItem>
            {areasFiltradas.map((area) => <SelectItem key={area.id} value={area.id} className="text-xs">{area.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="md:col-span-2 flex items-end gap-2">
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => window.print()}>
          <Download className="w-3.5 h-3.5" /> Exportar PDF
        </Button>
        <Button type="button" size="sm" className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => window.print()}>
          <Printer className="w-3.5 h-3.5" /> Imprimir
        </Button>
      </div>
    </div>
  );

  return (
    <RelatorioBase
      titulo="Relatório Atual de Gado por Área"
      subtitulo="Lotes atuais do mapa geral, lotação, pastejo e suplementação"
      empresaAtual={empresaAtual}
      filtros={filtros}
      orientacao={orientacao}
      resumoTotais={`Setores: ${totalGeral.setores} | Áreas: ${totalGeral.areas} | Lotes: ${totalGeral.lotes} | Cabeças: ${fmtInt(totalGeral.cabecas)} | Média geral: ${fmt(totalGeral.mediaGeral, 1)} kg | UA/ha: ${fmt(totalGeral.uaHa, 2)}`}
    >
      <div className="space-y-4">
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-xs">
              <div><strong>Setores:</strong> {totalGeral.setores}</div>
              <div><strong>Áreas:</strong> {totalGeral.areas}</div>
              <div><strong>Hectares:</strong> {fmt(totalGeral.hectares, 2)}</div>
              <div><strong>UA total:</strong> {fmt(totalGeral.uaTotal, 2)}</div>
              <div><strong>UA/ha:</strong> {fmt(totalGeral.uaHa, 2)}</div>
              <div><strong>Cabeças:</strong> {fmtInt(totalGeral.cabecas)}</div>
              <div><strong>Média geral:</strong> {fmt(totalGeral.mediaGeral, 1)} kg</div>
            </div>
          </CardContent>
        </Card>

        {grupos.map((grupo) => (
          <div key={grupo.key} className="break-inside-avoid border border-slate-300 rounded-md overflow-hidden">
            <div className="bg-slate-100 px-3 py-2 border-b border-slate-300">
              <div className="text-xs font-bold text-slate-900 uppercase">Setor: {grupo.setorNome} | Área: {grupo.areaNome}</div>
              <div className="grid grid-cols-2 md:grid-cols-9 gap-2 mt-1 text-[11px] text-slate-700">
                <div><strong>Área:</strong> {grupo.areaNome}</div>
                <div><strong>Hectares:</strong> {fmt(grupo.hectares, 2)}</div>
                <div><strong>UA/ha:</strong> {fmt(grupo.uaHa, 2)}</div>
                <div><strong>UA total:</strong> {fmt(grupo.uaTotal, 2)}</div>
                <div><strong>Pastagem:</strong> {grupo.pastagem}</div>
                <div><strong>Qtd. Cabeças:</strong> {fmtInt(grupo.cabecas)}</div>
                <div><strong>Qtd. Lotes:</strong> {grupo.qtdLotes}</div>
                <div><strong>Média geral:</strong> {fmt(grupo.mediaGeral, 1)} kg</div>
                <div><strong>Dias pastejo:</strong> {fmtInt(grupo.diasPastejo)}</div>
              </div>
              <div className="mt-1 text-[11px] text-slate-600"><strong>Último consumo/suplementação:</strong> {grupo.ultimoConsumo}</div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-white">
                    <TableHead className="text-[11px] font-bold border border-black py-1">Identificador</TableHead>
                    <TableHead className="text-[11px] font-bold border border-black py-1">Sigla</TableHead>
                    <TableHead className="text-[11px] font-bold border border-black py-1 text-right">Qtd. Cabeças</TableHead>
                    <TableHead className="text-[11px] font-bold border border-black py-1 text-right">Peso Médio</TableHead>
                    <TableHead className="text-[11px] font-bold border border-black py-1 text-right">Dias de pastejo</TableHead>
                    <TableHead className="text-[11px] font-bold border border-black py-1">Sist. Rep.</TableHead>
                    <TableHead className="text-[11px] font-bold border border-black py-1">Raça Predominante</TableHead>
                    <TableHead className="text-[11px] font-bold border border-black py-1">Sexo</TableHead>
                    <TableHead className="text-[11px] font-bold border border-black py-1">Categoria de Manejo</TableHead>
                    <TableHead className="text-[11px] font-bold border border-black py-1">Categoria Oficial</TableHead>
                    <TableHead className="text-[11px] font-bold border border-black py-1">Nome do lote</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grupo.lotes.map((lote) => (
                    <TableRow key={lote.id}>
                      <TableCell className="text-[11px] border border-gray-300 py-1">{lote.identificador_nome || "-"}</TableCell>
                      <TableCell className="text-[11px] border border-gray-300 py-1">{lote.identificador_sigla || "-"}</TableCell>
                      <TableCell className="text-[11px] border border-gray-300 py-1 text-right font-mono">{fmtInt(lote.cabecas)}</TableCell>
                      <TableCell className="text-[11px] border border-gray-300 py-1 text-right font-mono">{fmt(lote.pesoMedio, 1)} kg</TableCell>
                      <TableCell className="text-[11px] border border-gray-300 py-1 text-right font-mono">{fmtInt(lote.diasPastejo)}</TableCell>
                      <TableCell className="text-[11px] border border-gray-300 py-1">{lote.sistema_produtivo || "-"}</TableCell>
                      <TableCell className="text-[11px] border border-gray-300 py-1">{lote.raca_predominante || "-"}</TableCell>
                      <TableCell className="text-[11px] border border-gray-300 py-1">{lote.sexo || "-"}</TableCell>
                      <TableCell className="text-[11px] border border-gray-300 py-1">{lote.categoria_manejo_nome || "-"}</TableCell>
                      <TableCell className="text-[11px] border border-gray-300 py-1">{lote.categoria || "-"}</TableCell>
                      <TableCell className="text-[11px] border border-gray-300 py-1 font-medium">{lote.nome || "-"}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-slate-50 font-bold">
                    <TableCell colSpan={2} className="text-[11px] border border-black py-1">Subtotal da área</TableCell>
                    <TableCell className="text-[11px] border border-black py-1 text-right">{fmtInt(grupo.cabecas)}</TableCell>
                    <TableCell className="text-[11px] border border-black py-1 text-right">{fmt(grupo.mediaGeral, 1)} kg</TableCell>
                    <TableCell className="text-[11px] border border-black py-1 text-right">{fmtInt(grupo.diasPastejo)}</TableCell>
                    <TableCell colSpan={6} className="text-[11px] border border-black py-1">UA total: {fmt(grupo.uaTotal, 2)} | UA/ha: {fmt(grupo.uaHa, 2)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        ))}

        {grupos.length === 0 && (
          <div className="text-center text-sm text-slate-500 py-8 border rounded-md">Nenhum lote atual encontrado nos filtros selecionados.</div>
        )}
      </div>
    </RelatorioBase>
  );
}