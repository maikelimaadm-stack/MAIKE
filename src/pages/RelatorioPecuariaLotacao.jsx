import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import RelatorioBase from "@/components/relatorios/RelatorioBase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Settings2 } from "lucide-react";

export default function RelatorioPecuariaLotacao() {
  const empresaId = typeof window !== 'undefined' ? localStorage.getItem('empresa_selecionada_id') : null;
  const [orientation, setOrientation] = useState('portrait');

  // Colunas visíveis (padrões conforme instruções)
  const [colsPastos, setColsPastos] = useState({ nome: true, area: true, ua_ha: true, ua_total: true });
  const [colsLotes, setColsLotes] = useState({ ident: true, categoria: true, cabecas: true, pesoMedio: true, pesoTotal: true, uaCabeca: true, uaTotal: true });
  const [colsDistrib, setColsDistrib] = useState({ pasto: true, lotes: true, cabecas: true, uaTotal: true, uaHaReal: true, ocupacao: true });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas-rel-lot', empresaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaId && a.ativo !== false);
    },
    enabled: !!empresaId,
    staleTime: 0
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes-rel-lot', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.empresa_id === empresaId && l.status === 'Ativo');
    },
    enabled: !!empresaId,
    staleTime: 0
  });

  // Map rápido de áreas por id
  const areaMap = useMemo(() => {
    const m = new Map();
    areas.forEach(a => m.set(a.id, a));
    return m;
  }, [areas]);

  // Relação de pastos
  const relPastos = useMemo(() => {
    return areas.map(a => {
      const areaHa = Number(a.tamanho_hectares || 0);
      const uaTotalCap = Number(a.capacidade_maxima || 0); // UA totais informadas
      const uaHaCap = areaHa > 0 ? (uaTotalCap / areaHa) : 0; // UA/ha = capacidade_total ÷ área
      return {
        id: a.id,
        nome: a.nome || '-',
        area: areaHa,
        ua_ha: uaHaCap,
        ua_total: uaTotalCap,
      };
    });
  }, [areas]);

  // Relação de lotes
  const relLotes = useMemo(() => {
    return lotes.map(l => {
      const cabecas = Number(l.quantidade_cabecas || 0);
      const pesoMedio = Number(l.peso_medio_kg || 0);
      const pesoTotal = cabecas * pesoMedio;
      const uaCabeca = pesoMedio > 0 ? (pesoMedio / 450) : 0;
      const uaTotal = uaCabeca * cabecas;
      return {
        id: l.id,
        ident: l.nome || l.identificacao || '-'
        ,categoria: l.categoria || '-',
        cabecas,
        pesoMedio,
        pesoTotal,
        uaCabeca,
        uaTotal,
        areaId: l.area_atual_id || null,
      };
    });
  }, [lotes]);

  // Distribuição de lotes por pasto
  const relDistrib = useMemo(() => {
    const byArea = new Map();
    relLotes.forEach(l => {
      const key = l.areaId || 'sem_area';
      if (!byArea.has(key)) byArea.set(key, []);
      byArea.get(key).push(l);
    });

    const rows = [];
    byArea.forEach((lotesArea, key) => {
      const area = areaMap.get(key);
      const nome = area?.nome || 'Sem área';
      const areaHa = Number(area?.tamanho_hectares || 0);
      const uaTotalArea = lotesArea.reduce((s, it) => s + it.uaTotal, 0);
      const cabecasTot = lotesArea.reduce((s, it) => s + it.cabecas, 0);
      const uaHaReal = areaHa > 0 ? (uaTotalArea / areaHa) : 0;
      const capUaTotal = Number(area?.capacidade_maxima || 0);
      const ocupacao = capUaTotal > 0 ? (uaTotalArea / capUaTotal) * 100 : 0;
      rows.push({
        key,
        pasto: nome,
        lotes: lotesArea.length,
        cabecas: cabecasTot,
        uaTotal: uaTotalArea,
        uaHaReal,
        ocupacao,
        areaHa,
        capUaTotal,
      });
    });
    return rows.sort((a,b) => a.pasto.localeCompare(b.pasto));
  }, [relLotes, areaMap]);

  // Análise técnica
  const analise = useMemo(() => {
    return relDistrib.map(r => {
      let status = 'Equilibrado';
      if (r.capUaTotal > 0) {
        const p = (r.uaTotal / r.capUaTotal) * 100;
        if (p < 80) status = 'Sublotado';
        else if (p > 100) status = 'Superlotado';
        else status = 'Equilibrado';
      }
      const risco = status === 'Superlotado' ? 'Alto' : status === 'Equilibrado' ? 'Baixo' : 'Baixo';
      const sugestao = status === 'Superlotado'
        ? 'Reduzir cabeças / remanejar lotes / intensificar suplementação.'
        : status === 'Sublotado'
        ? 'Possível incremento de lotação conforme meta produtiva.'
        : 'Manter manejo atual e monitorar UA/ha.';
      return { pasto: r.pasto, status, risco, sugestao, uaHaReal: r.uaHaReal, uaCap: (r.capUaTotal>0 && r.areaHa>0)? (r.capUaTotal/r.areaHa):0 };
    });
  }, [relDistrib]);

  // Resumo final
  const resumo = useMemo(() => {
    const totalCab = relLotes.reduce((s, l) => s + l.cabecas, 0);
    const totalUa = relLotes.reduce((s, l) => s + l.uaTotal, 0);
    const mediaPeso = (() => {
      const totPeso = relLotes.reduce((s, l) => s + l.pesoTotal, 0);
      return totalCab > 0 ? (totPeso / totalCab) : 0;
    })();
    const totalArea = areas.reduce((s, a) => s + Number(a.tamanho_hectares || 0), 0);
    const capTotalUa = areas.reduce((s, a) => s + Number(a.capacidade_maxima || 0), 0);
    const uaHaFazenda = totalArea > 0 ? (totalUa / totalArea) : 0;
    const diferencaCap = capTotalUa - totalUa;
    return { totalCab, totalUa, mediaPeso, uaHaFazenda, capTotalUa, totalArea, diferencaCap };
  }, [relLotes, areas]);

  return (
    <RelatorioBase title="Relatório Técnico de Lotação" subtitle="Capacidade, distribuição e análise de lotação" orientation={orientation}>
      <div className="space-y-4">
        {/* Filtros e controles */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Opções do relatório</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <div>
                <Label className="text-xs mb-1 block">Orientação</Label>
                <Select value={orientation} onValueChange={setOrientation}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait" className="text-xs">Retrato</SelectItem>
                    <SelectItem value="landscape" className="text-xs">Paisagem</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 flex items-end gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1"><Settings2 className="w-3.5 h-3.5"/> Colunas: Pastos</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {Object.keys(colsPastos).map((k) => (
                      <DropdownMenuCheckboxItem key={k} checked={colsPastos[k]} onCheckedChange={(v)=>setColsPastos({ ...colsPastos, [k]: !!v })}>
                        {({ nome: 'Nome', area: 'Área (ha)', ua_ha: 'UA/ha (capacidade)', ua_total: 'UA totais' }[k])}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1"><Settings2 className="w-3.5 h-3.5"/> Colunas: Lotes</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {Object.keys(colsLotes).map((k) => (
                      <DropdownMenuCheckboxItem key={k} checked={colsLotes[k]} onCheckedChange={(v)=>setColsLotes({ ...colsLotes, [k]: !!v })}>
                        {({ ident: 'Identificação', categoria: 'Categoria', cabecas: 'Cabeças', pesoMedio: 'Peso médio (kg)', pesoTotal: 'Peso total (kg)', uaCabeca: 'UA/cabeça', uaTotal: 'UA total' }[k])}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1"><Settings2 className="w-3.5 h-3.5"/> Colunas: Distribuição</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {Object.keys(colsDistrib).map((k) => (
                      <DropdownMenuCheckboxItem key={k} checked={colsDistrib[k]} onCheckedChange={(v)=>setColsDistrib({ ...colsDistrib, [k]: !!v })}>
                        {({ pasto: 'Pasto', lotes: 'Qtde de lotes', cabecas: 'Cabeças', uaTotal: 'UA total', uaHaReal: 'UA/ha real', ocupacao: '% ocupação' }[k])}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2. Relação de Pastos */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">2. Relação de Pastos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    {colsPastos.nome && <TableHead className="text-xs font-bold py-1 border border-black">Nome do pasto</TableHead>}
                    {colsPastos.area && <TableHead className="text-xs font-bold py-1 border border-black">Área total (ha)</TableHead>}
                    {colsPastos.ua_ha && <TableHead className="text-xs font-bold py-1 border border-black">Capacidade (UA/ha)</TableHead>}
                    {colsPastos.ua_total && <TableHead className="text-xs font-bold py-1 border border-black">Capacidade total (UA)</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relPastos.map(p => (
                    <TableRow key={p.id} className="hover:bg-gray-50">
                      {colsPastos.nome && <TableCell className="text-xs py-1 border border-gray-300">{p.nome}</TableCell>}
                      {colsPastos.area && <TableCell className="text-xs py-1 border border-gray-300">{p.area.toFixed(2)}</TableCell>}
                      {colsPastos.ua_ha && <TableCell className="text-xs py-1 border border-gray-300">{p.ua_ha.toFixed(2)}</TableCell>}
                      {colsPastos.ua_total && <TableCell className="text-xs py-1 border border-gray-300">{p.ua_total.toFixed(2)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* 3. Relação de Lotes */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">3. Relação de Lotes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    {colsLotes.ident && <TableHead className="text-xs font-bold py-1 border border-black">Identificação</TableHead>}
                    {colsLotes.categoria && <TableHead className="text-xs font-bold py-1 border border-black">Categoria animal</TableHead>}
                    {colsLotes.cabecas && <TableHead className="text-xs font-bold py-1 border border-black">Cabeças</TableHead>}
                    {colsLotes.pesoMedio && <TableHead className="text-xs font-bold py-1 border border-black">Peso médio (kg)</TableHead>}
                    {colsLotes.pesoTotal && <TableHead className="text-xs font-bold py-1 border border-black">Peso vivo total (kg)</TableHead>}
                    {colsLotes.uaCabeca && <TableHead className="text-xs font-bold py-1 border border-black">UA por cabeça</TableHead>}
                    {colsLotes.uaTotal && <TableHead className="text-xs font-bold py-1 border border-black">UA total do lote</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relLotes.map(l => (
                    <TableRow key={l.id} className="hover:bg-gray-50">
                      {colsLotes.ident && <TableCell className="text-xs py-1 border border-gray-300">{l.ident}</TableCell>}
                      {colsLotes.categoria && <TableCell className="text-xs py-1 border border-gray-300">{l.categoria}</TableCell>}
                      {colsLotes.cabecas && <TableCell className="text-xs py-1 border border-gray-300">{l.cabecas}</TableCell>}
                      {colsLotes.pesoMedio && <TableCell className="text-xs py-1 border border-gray-300">{l.pesoMedio.toFixed(1)}</TableCell>}
                      {colsLotes.pesoTotal && <TableCell className="text-xs py-1 border border-gray-300">{l.pesoTotal.toFixed(1)}</TableCell>}
                      {colsLotes.uaCabeca && <TableCell className="text-xs py-1 border border-gray-300">{l.uaCabeca.toFixed(3)}</TableCell>}
                      {colsLotes.uaTotal && <TableCell className="text-xs py-1 border border-gray-300">{l.uaTotal.toFixed(2)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* 4. Distribuição dos Lotes nos Pastos */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">4. Distribuição dos Lotes nos Pastos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    {colsDistrib.pasto && <TableHead className="text-xs font-bold py-1 border border-black">Pasto</TableHead>}
                    {colsDistrib.lotes && <TableHead className="text-xs font-bold py-1 border border-black">Lotes</TableHead>}
                    {colsDistrib.cabecas && <TableHead className="text-xs font-bold py-1 border border-black">Cabeças</TableHead>}
                    {colsDistrib.uaTotal && <TableHead className="text-xs font-bold py-1 border border-black">UA total</TableHead>}
                    {colsDistrib.uaHaReal && <TableHead className="text-xs font-bold py-1 border border-black">UA/ha (real)</TableHead>}
                    {colsDistrib.ocupacao && <TableHead className="text-xs font-bold py-1 border border-black">% Ocupação</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relDistrib.map(r => (
                    <TableRow key={r.key} className="hover:bg-gray-50">
                      {colsDistrib.pasto && <TableCell className="text-xs py-1 border border-gray-300">{r.pasto}</TableCell>}
                      {colsDistrib.lotes && <TableCell className="text-xs py-1 border border-gray-300">{r.lotes}</TableCell>}
                      {colsDistrib.cabecas && <TableCell className="text-xs py-1 border border-gray-300">{r.cabecas}</TableCell>}
                      {colsDistrib.uaTotal && <TableCell className="text-xs py-1 border border-gray-300">{r.uaTotal.toFixed(2)}</TableCell>}
                      {colsDistrib.uaHaReal && <TableCell className="text-xs py-1 border border-gray-300">{r.uaHaReal.toFixed(2)}</TableCell>}
                      {colsDistrib.ocupacao && <TableCell className="text-xs py-1 border border-gray-300">{r.ocupacao.toFixed(0)}%</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* 5. Análise Técnica Automática */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">5. Análise Técnica Automática</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="text-xs font-bold py-1 border border-black">Pasto</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Status</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Risco</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">UA/ha (real)</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">UA/ha (capacidade)</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Sugestão técnica</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analise.map((a, idx) => (
                    <TableRow key={idx} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300">{a.pasto}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{a.status}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{a.risco}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{a.uaHaReal.toFixed(2)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{a.uaCap.toFixed(2)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{a.sugestao}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* 6. Resumo Final Geral */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">6. Resumo Final Geral</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="text-xs font-bold py-1 border border-black">Total de cabeças</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Total de UA</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Média peso/cabeça (kg)</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Média UA/ha (fazenda)</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Capacidade total (UA)</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Área total (ha)</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Diferença (cap - ocupação)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="hover:bg-gray-50">
                    <TableCell className="text-xs py-1 border border-gray-300">{resumo.totalCab}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{resumo.totalUa.toFixed(2)}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{resumo.mediaPeso.toFixed(1)}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{resumo.uaHaFazenda.toFixed(2)}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{resumo.capTotalUa.toFixed(2)}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{resumo.totalArea.toFixed(2)}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{resumo.diferencaCap.toFixed(2)}</TableCell>
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