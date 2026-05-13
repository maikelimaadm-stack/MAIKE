import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBebedouros } from "@/hooks/useBebedouros";
import { useQuery } from "@tanstack/react-query";
import bebedouroRepository from "@/repositories/bebedouroRepository";
import BebedouroResumoCards from "@/components/bebedouros/BebedouroResumoCards";
import DetalhesBebedouro from "@/components/bebedouros/DetalhesBebedouro";
import BebedouroStatusBadge from "@/components/bebedouros/BebedouroStatusBadge";
import { buildBebedouroAlertas, getBebedouroStatusVisual } from "@/services/bebedouroService";

export default function Bebedouros() {
  const empresaId = localStorage.getItem("empresa_selecionada_id");
  const [busca, setBusca] = useState("");
  const [selected, setSelected] = useState(null);
  const { data: bebedouros = [] } = useBebedouros(empresaId);
  const { data: historico = [] } = useQuery({ queryKey: ["bebedouro-historico-all", empresaId], queryFn: () => bebedouroRepository.listHistorico(empresaId), enabled: !!empresaId, initialData: [] });
  const { data: sanidade = [] } = useQuery({ queryKey: ["bebedouro-sanidade-all", empresaId], queryFn: () => bebedouroRepository.listSanidade(empresaId), enabled: !!empresaId, initialData: [] });

  const getPastosAtendidos = (item) => Array.isArray(item.area_vinculada_nomes) && item.area_vinculada_nomes.length ? item.area_vinculada_nomes.join(", ") : item.pasto_nome || "-";
  const rows = useMemo(() => bebedouros.filter((item) => `${item.nome} ${item.codigo_interno} ${getPastosAtendidos(item)} ${item.origem_agua}`.toLowerCase().includes(busca.toLowerCase())), [bebedouros, busca]);
  const alertas = useMemo(() => bebedouros.flatMap((b) => buildBebedouroAlertas(b, historico.filter((h) => h.bebedouro_id === b.id), sanidade.filter((s) => s.bebedouro_id === b.id))), [bebedouros, historico, sanidade]);

  return (
    <div className="p-2 space-y-2 h-full overflow-auto bg-slate-50">
      <div className="flex items-center justify-between gap-2 bg-white border rounded-lg p-2">
        <div><h1 className="text-lg font-bold text-slate-900">Gestão de Bebedouros</h1><p className="text-xs text-slate-500">Controle operacional, sanitário e histórico da água</p></div>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => window.location.href = "/MapaCadastro"}>Cadastrar no mapa</Button>
      </div>
      <BebedouroResumoCards bebedouros={bebedouros} historico={historico} alertas={alertas} />
      <div className="bg-white border rounded-lg p-2 space-y-2">
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar bebedouro..." className="h-8 text-xs" />
        <div className="overflow-auto border rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-slate-50"><tr><th className="p-2 text-left">Nome</th><th className="p-2 text-left">Pastos atendidos</th><th className="p-2 text-left">Tipo</th><th className="p-2 text-left">Origem da água</th><th className="p-2 text-right">Capacidade</th><th className="p-2 text-center">Status</th></tr></thead>
            <tbody>{rows.map((item) => {
              const h = historico.filter((x) => x.bebedouro_id === item.id);
              const s = sanidade.filter((x) => x.bebedouro_id === item.id);
              const visual = getBebedouroStatusVisual({ bebedouro: item, historico: h, sanidade: s });
              return <tr key={item.id} className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(item)}><td className="p-2 font-medium">{item.nome}</td><td className="p-2">{getPastosAtendidos(item)}</td><td className="p-2">{item.tipo}</td><td className="p-2">{item.origem_agua || "-"}</td><td className="p-2 text-right">{item.capacidade_litros ? `${Number(item.capacidade_litros).toLocaleString("pt-BR")} L` : "-"}</td><td className="p-2 text-center"><BebedouroStatusBadge visual={visual} /></td></tr>;
            })}</tbody>
          </table>
        </div>
      </div>
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}><DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-2"><DialogHeader><DialogTitle className="text-sm">Detalhes do Bebedouro</DialogTitle></DialogHeader>{selected && <DetalhesBebedouro bebedouro={selected} />}</DialogContent></Dialog>
    </div>
  );
}