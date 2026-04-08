import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const TIPOS = ["Trator", "Colheitadeira", "Plantadeira", "Pulverizador", "Caminhão", "Pickup", "Motocicleta", "Implemento", "Outro"];
const COMBUSTIVEIS = ["Diesel", "Gasolina", "Etanol", "Flex", "Elétrico", "Não Aplicável"];
const REQUIRED_FIELDS = ["nome", "tipo"];

export default function FormularioMaquina({ maquina, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [tentouSalvar, setTentouSalvar] = useState(false);

  const { data: areas = [] } = useQuery({
    queryKey: ["areas-maquina", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((a) => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const [formData, setFormData] = useState({
    codigo: maquina?.codigo || "",
    nome: maquina?.nome || "",
    tipo: maquina?.tipo || "",
    marca: maquina?.marca || "",
    modelo: maquina?.modelo || "",
    ano_fabricacao: maquina?.ano_fabricacao || "",
    placa: maquina?.placa || "",
    chassi: maquina?.chassi || "",
    renavam: maquina?.renavam || "",
    potencia_cv: maquina?.potencia_cv || "",
    horimetro_atual: maquina?.horimetro_atual || "",
    hodometro_atual: maquina?.hodometro_atual || "",
    data_aquisicao: maquina?.data_aquisicao || "",
    valor_aquisicao: maquina?.valor_aquisicao || "",
    valor_atual: maquina?.valor_atual || "",
    consumo_medio: maquina?.consumo_medio || "",
    tipo_combustivel: maquina?.tipo_combustivel || "",
    capacidade_tanque: maquina?.capacidade_tanque || "",
    vida_util_horas: maquina?.vida_util_horas || "",
    custo_hora: maquina?.custo_hora || "",
    valor_combustivel_litro: maquina?.valor_combustivel_litro || "",
    status: maquina?.status || "Ativo",
    localizacao_atual: maquina?.localizacao_atual || "",
    observacoes: maquina?.observacoes || "",
  });

  const getFieldClassName = (field) => {
    if (!tentouSalvar || !REQUIRED_FIELDS.includes(field) || formData[field]) return "h-8 text-xs uppercase";
    return "h-8 text-xs uppercase border-red-500 bg-red-50 focus-visible:ring-red-500";
  };

  const mutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        ...data,
        empresa_id: empresaSelecionadaId,
        ano_fabricacao: data.ano_fabricacao ? parseInt(data.ano_fabricacao) : null,
        potencia_cv: data.potencia_cv ? parseFloat(data.potencia_cv) : null,
        horimetro_atual: data.horimetro_atual ? parseFloat(data.horimetro_atual) : null,
        hodometro_atual: data.hodometro_atual ? parseFloat(data.hodometro_atual) : null,
        valor_aquisicao: data.valor_aquisicao ? parseFloat(data.valor_aquisicao) : null,
        valor_atual: data.valor_atual ? parseFloat(data.valor_atual) : null,
        consumo_medio: data.consumo_medio ? parseFloat(data.consumo_medio) : null,
        capacidade_tanque: data.capacidade_tanque ? parseFloat(data.capacidade_tanque) : null,
        vida_util_horas: data.vida_util_horas ? parseFloat(data.vida_util_horas) : null,
        custo_hora: data.custo_hora ? parseFloat(data.custo_hora) : null,
        valor_combustivel_litro: data.valor_combustivel_litro ? parseFloat(data.valor_combustivel_litro) : null,
      };

      if (maquina) return base44.entities.Maquina.update(maquina.id, payload);
      return base44.entities.Maquina.create(payload);
    },
    onSuccess: () => {
      toast.success(maquina ? "Máquina atualizada!" : "Máquina cadastrada!");
      onSave();
    },
    onError: (error) => {
      toast.error("Erro: " + error.message);
    },
  });

  const handleChange = (field, value) => {
    const uppercaseFields = ["codigo", "nome", "marca", "modelo", "placa", "chassi", "renavam", "observacoes"];
    setFormData((prev) => ({ ...prev, [field]: uppercaseFields.includes(field) ? String(value).toUpperCase() : value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setTentouSalvar(true);
    if (REQUIRED_FIELDS.some((field) => !formData[field])) {
      toast.error("Preencha os campos obrigatórios");
      return;
    }
    mutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="space-y-1">
          <Label className="text-xs uppercase">Código</Label>
          <Input value={formData.codigo} onChange={(e) => handleChange("codigo", e.target.value)} className="h-8 text-xs uppercase" placeholder="TRT001" />
        </div>
        <div className="col-span-2 md:col-span-2 space-y-1">
          <Label className="text-xs uppercase">Nome *</Label>
          <Input value={formData.nome} onChange={(e) => handleChange("nome", e.target.value)} className={getFieldClassName("nome")} placeholder="NOME DA MÁQUINA" required />
        </div>
        <div className="space-y-1">
          <Label className="text-xs uppercase">Tipo *</Label>
          <Select value={formData.tipo} onValueChange={(v) => handleChange("tipo", v)}>
            <SelectTrigger className={getFieldClassName("tipo")}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
            <SelectContent>{TIPOS.map((t) => <SelectItem key={t} value={t} className="text-xs uppercase">{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="space-y-1"><Label className="text-xs uppercase">Marca</Label><Input value={formData.marca} onChange={(e) => handleChange("marca", e.target.value)} className="h-8 text-xs uppercase" placeholder="MARCA" /></div>
        <div className="space-y-1"><Label className="text-xs uppercase">Modelo</Label><Input value={formData.modelo} onChange={(e) => handleChange("modelo", e.target.value)} className="h-8 text-xs uppercase" placeholder="MODELO" /></div>
        <div className="space-y-1"><Label className="text-xs uppercase">Ano Fabricação</Label><Input type="number" value={formData.ano_fabricacao} onChange={(e) => handleChange("ano_fabricacao", e.target.value)} className="h-8 text-xs" placeholder="2024" /></div>
        <div className="space-y-1"><Label className="text-xs uppercase">Status</Label><Select value={formData.status} onValueChange={(v) => handleChange("status", v)}><SelectTrigger className="h-8 text-xs uppercase"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Ativo" className="text-xs uppercase">Ativo</SelectItem><SelectItem value="Em Manutenção" className="text-xs uppercase">Em Manutenção</SelectItem><SelectItem value="Inativo" className="text-xs uppercase">Inativo</SelectItem><SelectItem value="Vendido" className="text-xs uppercase">Vendido</SelectItem></SelectContent></Select></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div className="space-y-1"><Label className="text-xs uppercase">Placa</Label><Input value={formData.placa} onChange={(e) => handleChange("placa", e.target.value)} className="h-8 text-xs uppercase" placeholder="ABC1D23" /></div>
        <div className="space-y-1"><Label className="text-xs uppercase">Chassi</Label><Input value={formData.chassi} onChange={(e) => handleChange("chassi", e.target.value)} className="h-8 text-xs uppercase" placeholder="CHASSI" /></div>
        <div className="space-y-1"><Label className="text-xs uppercase">Renavam</Label><Input value={formData.renavam} onChange={(e) => handleChange("renavam", e.target.value)} className="h-8 text-xs uppercase" placeholder="RENAVAM" /></div>
        <div className="space-y-1"><Label className="text-xs uppercase">Potência (CV)</Label><Input type="number" value={formData.potencia_cv} onChange={(e) => handleChange("potencia_cv", e.target.value)} className="h-8 text-xs" placeholder="0" /></div>
        <div className="space-y-1"><Label className="text-xs uppercase">Data Aquisição</Label><Input type="date" value={formData.data_aquisicao} onChange={(e) => handleChange("data_aquisicao", e.target.value)} className="h-8 text-xs" /></div>
      </div>

      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
        <div className="text-xs font-semibold text-slate-700 uppercase">Operação e Abastecimento</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="space-y-1"><Label className="text-xs uppercase">Horímetro Atual</Label><Input type="number" value={formData.horimetro_atual} onChange={(e) => handleChange("horimetro_atual", e.target.value)} className="h-8 text-xs" placeholder="HORAS" /></div>
          <div className="space-y-1"><Label className="text-xs uppercase">Hodômetro Atual</Label><Input type="number" value={formData.hodometro_atual} onChange={(e) => handleChange("hodometro_atual", e.target.value)} className="h-8 text-xs" placeholder="KM" /></div>
          <div className="space-y-1"><Label className="text-xs uppercase">Combustível</Label><Select value={formData.tipo_combustivel} onValueChange={(v) => handleChange("tipo_combustivel", v)}><SelectTrigger className="h-8 text-xs uppercase"><SelectValue placeholder="SELECIONE" /></SelectTrigger><SelectContent>{COMBUSTIVEIS.map((c) => <SelectItem key={c} value={c} className="text-xs uppercase">{c}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs uppercase">Capacidade Tanque (L)</Label><Input type="number" value={formData.capacidade_tanque} onChange={(e) => handleChange("capacidade_tanque", e.target.value)} className="h-8 text-xs" placeholder="0" /></div>
          <div className="space-y-1"><Label className="text-xs uppercase">Consumo Médio</Label><Input type="number" step="0.1" value={formData.consumo_medio} onChange={(e) => handleChange("consumo_medio", e.target.value)} className="h-8 text-xs" placeholder="L/H" /></div>
        </div>
      </div>

      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg space-y-2">
        <div className="text-xs font-semibold text-emerald-800 uppercase">Custos Operacionais</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="space-y-1"><Label className="text-xs uppercase">Vida Útil (H)</Label><Input type="number" value={formData.vida_util_horas} onChange={(e) => handleChange("vida_util_horas", e.target.value)} className="h-8 text-xs bg-white" placeholder="10000" /></div>
          <div className="space-y-1"><Label className="text-xs uppercase">Custo / Hora</Label><Input type="number" step="0.01" value={formData.custo_hora} onChange={(e) => handleChange("custo_hora", e.target.value)} className="h-8 text-xs bg-white" placeholder="0,00" /></div>
          <div className="space-y-1"><Label className="text-xs uppercase">Combustível / L</Label><Input type="number" step="0.01" value={formData.valor_combustivel_litro} onChange={(e) => handleChange("valor_combustivel_litro", e.target.value)} className="h-8 text-xs bg-white" placeholder="0,00" /></div>
          <div className="space-y-1"><Label className="text-xs uppercase">Valor Aquisição</Label><Input type="number" step="0.01" value={formData.valor_aquisicao} onChange={(e) => handleChange("valor_aquisicao", e.target.value)} className="h-8 text-xs bg-white" placeholder="0,00" /></div>
          <div className="space-y-1"><Label className="text-xs uppercase">Valor Atual</Label><Input type="number" step="0.01" value={formData.valor_atual} onChange={(e) => handleChange("valor_atual", e.target.value)} className="h-8 text-xs bg-white" placeholder="0,00" /></div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="space-y-1"><Label className="text-xs uppercase">Localização Atual</Label><Select value={formData.localizacao_atual} onValueChange={(v) => handleChange("localizacao_atual", v)}><SelectTrigger className="h-8 text-xs uppercase"><SelectValue placeholder="SELECIONE A ÁREA" /></SelectTrigger><SelectContent>{areas.map((a) => <SelectItem key={a.id} value={a.nome} className="text-xs uppercase">{a.nome}</SelectItem>)}</SelectContent></Select></div>
        <div className="md:col-span-2 space-y-1"><Label className="text-xs uppercase">Observações</Label><Textarea value={formData.observacoes} onChange={(e) => handleChange("observacoes", e.target.value)} rows={3} className="text-xs uppercase min-h-[84px]" placeholder="OBSERVAÇÕES GERAIS" /></div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">Cancelar</Button>
        <Button type="submit" disabled={mutation.isPending} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">{mutation.isPending ? "Salvando..." : "Salvar"}</Button>
      </div>
    </form>
  );
}