import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import RelatorioBase from "@/components/relatorios/RelatorioBase";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Download, Printer, Settings2 } from "lucide-react";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fmt = (value, digits = 2) => Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtInt = (value) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const hoje = new Date();

const diffDays = (dateValue) => {
  if (!dateValue) return 0;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((hoje - date) / 86400000));
};

const formatDate = (dateValue) => {
  if (!dateValue) return "-";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
};

const AREA_COLUMNS = [
  { id: "area", label: "Área" },
  { id: "hectares", label: "Hectares" },
  { id: "uaHa", label: "UA/ha" },
  { id: "uaTotal", label: "UA total" },
  { id: "pastagem", label: "Pastagem" },
  { id: "cabecas", label: "Qtd. Cabeças" },
  { id: "lotes", label: "Qtd. Lotes" },
  { id: "media", label: "Média geral" },
  { id: "dias", label: "Dias pastejo" },
  { id: "consumo", label: "Consumo/Suplementação" },
];

const LOTE_COLUMNS = [
  { id: "identificador", label: "Identificador" },
  { id: "sigla", label: "Sigla" },
  { id: "cabecas", label: "Qtd. Cabeças" },
  { id: "peso", label: "Peso Médio" },
  { id: "dias", label: "Dias de pastejo" },
  { id: "sistema", label: "Sist. Rep." },
  { id: "raca", label: "Raça Predominante" },
  { id: "sexo", label: "Sexo" },
  { id: "catManejo", label: "Categoria de Manejo" },
  { id: "catOficial", label: "Categoria Oficial" },
  { id: "nome", label: "Nome do lote" },
  { id: "entrada", label: "Data entrada" },
  { id: "ua", label: "UA lote" },
  { id: "area", label: "Área atual" },
  { id: "setor", label: "Setor" },
];

export default function RelatorioGadoMapaGeral() {
  const empresaId = typeof window !== "undefined" ? localStorage.getItem("empresa_selecionada_id") : null;
  const [orientacao, setOrientacao] = useState("paisagem");
  const [setorFiltro, setSetorFiltro] = useState("todos");
  const [areaFiltro, setAreaFiltro] = useState("todas");
  const [agruparPor, setAgruparPor] = useState("setor_area");
  const [areaCols, setAreaCols] = useState(AREA_COLUMNS.map((column) => column.id));
  const [loteCols, setLoteCols] = useState(LOTE_COLUMNS.map((column) => column.id));

  const { data: empresas = [] } = useQuery({ queryKey: ["empresas-relatorio-gado"], queryFn: () => base44.entities.Empresa.list() });

  const { data: setores = [] } = useQuery({
    queryKey: ["setores-relatorio-gado", empresaId],
    queryFn: async () => (await base44.entities.Setor.list()).filter((item) => item.empresa_id === empresaId),
    enabled: !!empresaId,
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["areas-relatorio-gado", empresaId],
    queryFn: async () => (await base44.entities.AreaPastagem.list()).filter((item) => item.empresa_id === empresaId && item.ativo !== false),
    enabled: !!empresaId,
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ["lotes-relatorio-gado", empresaId],
    queryFn: async () => (await base44.entities.Lote.list()).filter((item) => item.empresa_id === empresaId && item.status === "Ativo"),
    enabled: !!empresaId,
  });

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ["movimentacoes-relatorio-gado", empresaId],
    queryFn: async () => (await base44.entities.MovimentacaoMapa.list("-data_movimentacao")).filter((item) => item.empresa_id === empresaId),
    enabled: !!empresaId,
  });

  const { data: eventosSuplementacao = [] } = useQuery({
    queryKey: ["eventos-suplementacao-relatorio-gado", empresaId],
    queryFn: async () => (await base44.entities.SuplementacaoEvento.list("-data_lancamento")).filter((item) => item.empresa_id === empresaId),
    enabled: !!empresaId,
  });

  const { data: consumosLote = [] } = useQuery({
    queryKey: ["consumos-lote-relatorio-gado", empresaId],
    queryFn: async () => (await base44.entities.SuplementacaoLote.list("-data_lancamento")).filter((item) => item.empresa_id === empresaId),
    enabled: !!empresaId,
  });

  const empresaAtual = useMemo(() => empresas.find((item) => item.id === empresaId), [empresas, empresaId]);
  const setoresById = useMemo(() => new Map(setores.map((item) => [item.id, item])), [setores]);
  const areasById = useMemo(() => new Map(areas.map((item) => [item.id, item])), [areas]);

  const getDiasPastejo = (lote) => {
    const entradaNaArea = movimentacoes.find((mov) =>
      mov.lote_id === lote.id &&
      mov.area_destino_id === lote.area_atual_id &&
      ["Transferência de Área", "Entrada"].includes(mov.tipo)
    );
    return diffDays(entradaNaArea?.data_movimentacao || lote.data_entrada);
  };

  const eventosPorArea = useMemo(() => {
    const map = new Map();
    eventosSuplementacao.forEach((evento) => {
      const areaIds = evento.area_ids?.length ? evento.area_ids : [evento.area_id].filter(Boolean);
      areaIds.forEach((areaId) => {
        if (!map.has(areaId)) map.set(areaId, []);
        map.get(areaId).push(evento);
      });
    });
    return map;
  }, [eventosSuplementacao]);

  const consumoPorLote = useMemo(() => {
    const map = new Map();
    consumosLote.forEach((consumo) => {
      if (!map.has(consumo.lote_id)) map.set(consumo.lote_id, { totalKg: 0, ultimo: null });
      const current = map.get(consumo.lote_id);
      current.totalKg += Number(consumo.consumo_total_lote_periodo_kg || 0);
      if (!current.ultimo || new Date(consumo.data_lancamento || 0) > new Date(current.ultimo.data_lancamento || 0)) {
        current.ultimo = consumo;
      }
    });
    return map;
  }, [consumosLote]);

  const lotesAtuais = useMemo(() => lotes
    .filter((lote) => lote.area_atual_id && areasById.has(lote.area_atual_id))
    .filter((lote) => setorFiltro === "todos" || lote.setor_id === setorFiltro || areasById.get(lote.area_atual_id)?.setor_id === setorFiltro)
    .filter((lote) => areaFiltro === "todas" || lote.area_atual_id === areaFiltro)
    .map((lote) => {
      const area = areasById.get(lote.area_atual_id) || {};
      const consumo = consumoPorLote.get(lote.id);
      const cabecas = Number(lote.quantidade_cabecas || 0);
      const pesoMedio = Number(lote.peso_medio_kg || 0);
      return {
        ...lote,
        setorFinalId: area.setor_id || lote.setor_id || "sem_setor",
        setorFinalNome: area.setor_nome || lote.setor_nome || setoresById.get(area.setor_id || lote.setor_id)?.nome || "Sem setor",
        areaFinalNome: area.nome || lote.area_atual_nome || "Sem área",
        cabecas,
        pesoMedio,
        pesoTotal: cabecas * pesoMedio,
        uaTotal: cabecas * pesoMedio / 450,
        diasPastejo: getDiasPastejo(lote),
        consumoTotalKg: consumo?.totalKg || 0,
        ultimoConsumo: consumo?.ultimo || null,
      };
    })
    .sort((a, b) => a.setorFinalNome.localeCompare(b.setorFinalNome) || a.areaFinalNome.localeCompare(b.areaFinalNome) || (a.nome || "").localeCompare(b.nome || "")),
  [lotes, areasById, setoresById, setorFiltro, areaFiltro, consumoPorLote, movimentacoes]);

  const grupos = useMemo(() => {
    const map = new Map();
    lotesAtuais.forEach((lote) => {
      const area = areasById.get(lote.area_atual_id) || {};
      const key = agruparPor === "setor" ? lote.setorFinalId : `${lote.setorFinalId}__${lote.area_atual_id}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          setorNome: lote.setorFinalNome,
          areaId: agruparPor === "setor" ? null : lote.area_atual_id,
          areaNome: agruparPor === "setor" ? "Todas as áreas do setor" : lote.areaFinalNome,
          hectares: 0,
          pastagem: agruparPor === "setor" ? "-" : area.tipo_pastagem || area.tipo_cultura || "-",
          lotes: [],
        });
      }
      map.get(key).lotes.push(lote);
    });

    return Array.from(map.values()).map((grupo) => {
      const areasGrupo = grupo.areaId ? [areasById.get(grupo.areaId)].filter(Boolean) : areas.filter((area) => area.setor_nome === grupo.setorNome || area.setor_id === grupo.lotes[0]?.setorFinalId);
      const hectares = areasGrupo.reduce((sum, area) => sum + Number(area.area_pastejada || area.tamanho_hectares || 0), 0);
      const cabecas = grupo.lotes.reduce((sum, lote) => sum + lote.cabecas, 0);
      const pesoTotal = grupo.lotes.reduce((sum, lote) => sum + lote.pesoTotal, 0);
      const uaTotal = grupo.lotes.reduce((sum, lote) => sum + lote.uaTotal, 0);
      const consumoTotalKg = grupo.lotes.reduce((sum, lote) => sum + lote.consumoTotalKg, 0);
      const eventosArea = grupo.areaId ? eventosPorArea.get(grupo.areaId) || [] : [];
      const ultimoEvento = eventosArea[0] || grupo.lotes.map((lote) => lote.ultimoConsumo).filter(Boolean).sort((a, b) => new Date(b.data_lancamento || 0) - new Date(a.data_lancamento || 0))[0];

      return {
        ...grupo,
        hectares,
        cabecas,
        uaTotal,
        uaHa: hectares > 0 ? uaTotal / hectares : 0,
        qtdLotes: grupo.lotes.length,
        mediaGeral: cabecas > 0 ? pesoTotal / cabecas : 0,
        diasPastejo: grupo.lotes.length ? Math.max(...grupo.lotes.map((lote) => lote.diasPastejo)) : 0,
        consumoTotalKg,
        ultimoConsumoTexto: ultimoEvento ? `${ultimoEvento.produto || "-"} | ${formatDate(ultimoEvento.data_lancamento)}` : "-",
      };
    });
  }, [lotesAtuais, areasById, areas, agruparPor, eventosPorArea]);

  const setoresRelatorio = useMemo(() => {
    const map = new Map();
    grupos.forEach((grupo) => {
      if (!map.has(grupo.setorNome)) {
        map.set(grupo.setorNome, {
          setorNome: grupo.setorNome,
          grupos: [],
          lotes: [],
          totalAnimais: 0,
        });
      }
      const setor = map.get(grupo.setorNome);
      setor.grupos.push(grupo);
      setor.lotes.push(...grupo.lotes);
      setor.totalAnimais += grupo.cabecas;
    });
    return Array.from(map.values()).sort((a, b) => a.setorNome.localeCompare(b.setorNome));
  }, [grupos]);

  const totalGeral = useMemo(() => {
    const cabecas = lotesAtuais.reduce((sum, lote) => sum + lote.cabecas, 0);
    const pesoTotal = lotesAtuais.reduce((sum, lote) => sum + lote.pesoTotal, 0);
    const uaTotal = lotesAtuais.reduce((sum, lote) => sum + lote.uaTotal, 0);
    const areaIds = new Set(lotesAtuais.map((lote) => lote.area_atual_id));
    const hectares = areas.filter((area) => areaIds.has(area.id)).reduce((sum, area) => sum + Number(area.area_pastejada || area.tamanho_hectares || 0), 0);
    return {
      setores: new Set(lotesAtuais.map((lote) => lote.setorFinalId)).size,
      areas: areaIds.size,
      lotes: lotesAtuais.length,
      cabecas,
      hectares,
      uaTotal,
      uaHa: hectares > 0 ? uaTotal / hectares : 0,
      mediaGeral: cabecas > 0 ? pesoTotal / cabecas : 0,
      consumoTotalKg: lotesAtuais.reduce((sum, lote) => sum + lote.consumoTotalKg, 0),
    };
  }, [lotesAtuais, areas]);

  const areasFiltradas = useMemo(() => areas.filter((area) => setorFiltro === "todos" || area.setor_id === setorFiltro), [areas, setorFiltro]);

  const toggleColumn = (selected, setter, id) => {
    setter(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  };

  const filtros = (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
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
          <Label className="text-xs mb-1 block">Agrupar</Label>
          <Select value={agruparPor} onValueChange={setAgruparPor}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="setor_area" className="text-xs">Setor e Área</SelectItem>
              <SelectItem value="setor" className="text-xs">Somente Setor</SelectItem>
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
      <div className="flex flex-wrap gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1"><Settings2 className="w-3.5 h-3.5" /> Colunas do subtotal</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-y-auto">
            <DropdownMenuLabel>Subtotal por setor/área</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {AREA_COLUMNS.map((column) => (
              <DropdownMenuCheckboxItem key={column.id} checked={areaCols.includes(column.id)} onCheckedChange={() => toggleColumn(areaCols, setAreaCols, column.id)}>
                {column.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1"><Settings2 className="w-3.5 h-3.5" /> Colunas dos lotes</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-y-auto">
            <DropdownMenuLabel>Informações dos lotes</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {LOTE_COLUMNS.map((column) => (
              <DropdownMenuCheckboxItem key={column.id} checked={loteCols.includes(column.id)} onCheckedChange={() => toggleColumn(loteCols, setLoteCols, column.id)}>
                {column.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  const renderAreaValue = (grupo, columnId) => ({
    area: grupo.areaNome,
    hectares: fmt(grupo.hectares, 2),
    uaHa: fmt(grupo.uaHa, 2),
    uaTotal: fmt(grupo.uaTotal, 2),
    pastagem: grupo.pastagem,
    cabecas: fmtInt(grupo.cabecas),
    lotes: fmtInt(grupo.qtdLotes),
    media: `${fmt(grupo.mediaGeral, 1)} kg`,
    dias: fmtInt(grupo.diasPastejo),
    consumo: `${fmt(grupo.consumoTotalKg, 1)} kg | ${grupo.ultimoConsumoTexto}`,
  }[columnId] || "-");

  const renderLoteValue = (lote, columnId) => ({
    identificador: lote.identificador_nome || "-",
    sigla: lote.identificador_sigla || "-",
    cabecas: fmtInt(lote.cabecas),
    peso: `${fmt(lote.pesoMedio, 1)} kg`,
    dias: fmtInt(lote.diasPastejo),
    sistema: lote.sistema_produtivo || "-",
    raca: lote.raca_predominante || "-",
    sexo: lote.sexo || "-",
    catManejo: lote.categoria_manejo_nome || "-",
    catOficial: lote.categoria || "-",
    nome: lote.nome || "-",
    entrada: formatDate(lote.data_entrada),
    ua: fmt(lote.uaTotal, 2),
    area: lote.areaFinalNome || "-",
    setor: lote.setorFinalNome || "-",
  }[columnId] || "-");

  return (
    <RelatorioBase
      titulo="Relatório Atual de Gado por Área"
      subtitulo="Informações atuais dos lotes do mapa geral, por setor/área, com consumo e lotação"
      empresaAtual={empresaAtual}
      filtros={filtros}
      orientacao={orientacao}
      resumoTotais={`Setores: ${totalGeral.setores} | Áreas: ${totalGeral.areas} | Lotes: ${totalGeral.lotes} | Cabeças: ${fmtInt(totalGeral.cabecas)} | Média: ${fmt(totalGeral.mediaGeral, 1)} kg | UA total: ${fmt(totalGeral.uaTotal, 2)} | UA/ha: ${fmt(totalGeral.uaHa, 2)} | Consumo: ${fmt(totalGeral.consumoTotalKg, 1)} kg`}
    >
      <div className="space-y-4">
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 md:grid-cols-8 gap-2 text-xs">
              <div><strong>Setores:</strong> {totalGeral.setores}</div>
              <div><strong>Áreas:</strong> {totalGeral.areas}</div>
              <div><strong>Hectares:</strong> {fmt(totalGeral.hectares, 2)}</div>
              <div><strong>UA total:</strong> {fmt(totalGeral.uaTotal, 2)}</div>
              <div><strong>UA/ha:</strong> {fmt(totalGeral.uaHa, 2)}</div>
              <div><strong>Cabeças:</strong> {fmtInt(totalGeral.cabecas)}</div>
              <div><strong>Média geral:</strong> {fmt(totalGeral.mediaGeral, 1)} kg</div>
              <div><strong>Consumo:</strong> {fmt(totalGeral.consumoTotalKg, 1)} kg</div>
            </div>
          </CardContent>
        </Card>

        {setoresRelatorio.map((setor) => (
          <div key={setor.setorNome} className="break-inside-avoid border border-slate-300 rounded-md overflow-hidden">
            <div className="bg-slate-200 px-3 py-2 border-b border-slate-300">
              <div className="text-sm font-bold text-slate-900 uppercase">Setor: {setor.setorNome}</div>
              <div className="text-xs text-slate-700 mt-1"><strong>Total de animais:</strong> {fmtInt(setor.totalAnimais)}</div>
            </div>

            <div className="bg-slate-50 px-3 py-2 border-b border-slate-300">
              <div className="text-xs font-bold text-slate-800 mb-2 uppercase">Áreas do setor</div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-white">
                      {AREA_COLUMNS.filter((column) => areaCols.includes(column.id)).map((column) => (
                        <TableHead key={column.id} className="text-[11px] font-bold border border-black py-1 whitespace-nowrap">{column.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {setor.grupos.map((grupo) => (
                      <TableRow key={grupo.key}>
                        {AREA_COLUMNS.filter((column) => areaCols.includes(column.id)).map((column) => (
                          <TableCell key={column.id} className="text-[11px] border border-gray-300 py-1 whitespace-nowrap">{renderAreaValue(grupo, column.id)}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="px-3 py-2">
              <div className="text-xs font-bold text-slate-800 mb-2 uppercase">Lotes do setor</div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-white">
                      {LOTE_COLUMNS.filter((column) => loteCols.includes(column.id)).map((column) => (
                        <TableHead key={column.id} className="text-[11px] font-bold border border-black py-1 whitespace-nowrap">{column.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {setor.lotes.map((lote) => (
                      <TableRow key={lote.id}>
                        {LOTE_COLUMNS.filter((column) => loteCols.includes(column.id)).map((column) => (
                          <TableCell key={column.id} className="text-[11px] border border-gray-300 py-1 whitespace-nowrap">{renderLoteValue(lote, column.id)}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                    <TableRow className="bg-slate-50 font-bold">
                      <TableCell colSpan={Math.max(1, loteCols.length)} className="text-[11px] border border-black py-1">
                        Subtotal do setor: {fmtInt(setor.totalAnimais)} cabeças | {fmtInt(setor.lotes.length)} lotes
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        ))}

        <div className="border border-black rounded-md overflow-hidden">
          <Table>
            <TableBody>
              <TableRow className="bg-gray-100 font-bold">
                <TableCell className="text-xs border border-black py-2">TOTAL GERAL</TableCell>
                <TableCell className="text-xs border border-black py-2">Setores: {totalGeral.setores}</TableCell>
                <TableCell className="text-xs border border-black py-2">Áreas: {totalGeral.areas}</TableCell>
                <TableCell className="text-xs border border-black py-2">Lotes: {totalGeral.lotes}</TableCell>
                <TableCell className="text-xs border border-black py-2">Cabeças: {fmtInt(totalGeral.cabecas)}</TableCell>
                <TableCell className="text-xs border border-black py-2">Média: {fmt(totalGeral.mediaGeral, 1)} kg</TableCell>
                <TableCell className="text-xs border border-black py-2">UA total: {fmt(totalGeral.uaTotal, 2)}</TableCell>
                <TableCell className="text-xs border border-black py-2">UA/ha: {fmt(totalGeral.uaHa, 2)}</TableCell>
                <TableCell className="text-xs border border-black py-2">Consumo: {fmt(totalGeral.consumoTotalKg, 1)} kg</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {setoresRelatorio.length === 0 && (
          <div className="text-center text-sm text-slate-500 py-8 border rounded-md">Nenhum lote atual encontrado nos filtros selecionados.</div>
        )}
      </div>
    </RelatorioBase>
  );
}