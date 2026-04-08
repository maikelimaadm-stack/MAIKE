import React, { useState } from "react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {maquina ? "Editar Máquina" : "Nova Máquina"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1">
          <form onSubmit={handleSubmit} className="space-y-1">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <div className="space-y-1">
                <Label className="text-xs">Código</Label>
                <Input value={formData.codigo} onChange={(e) => handleChange("codigo", e.target.value)} className="h-7 text-xs uppercase" placeholder="TRT001" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nome da Máquina *</Label>
                <Input value={formData.nome} onChange={(e) => handleChange("nome", e.target.value)} className={getFieldClassName("nome").replace("h-8", "h-7")} placeholder="NOME DA MÁQUINA" required />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo *</Label>
                <Select value={formData.tipo} onValueChange={(v) => handleChange("tipo", v)}>
                  <SelectTrigger className={getFieldClassName("tipo").replace("h-8", "h-7")}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>{TIPOS.map((t) => <SelectItem key={t} value={t} className="text-xs uppercase">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-1">
              <div className="space-y-1"><Label className="text-xs">Marca</Label><Input value={formData.marca} onChange={(e) => handleChange("marca", e.target.value)} className="h-7 text-xs uppercase" placeholder="MARCA" /></div>
              <div className="space-y-1"><Label className="text-xs">Modelo</Label><Input value={formData.modelo} onChange={(e) => handleChange("modelo", e.target.value)} className="h-7 text-xs uppercase" placeholder="MODELO" /></div>
              <div className="space-y-1"><Label className="text-xs">Ano Fabricação</Label><Input type="number" value={formData.ano_fabricacao} onChange={(e) => handleChange("ano_fabricacao", e.target.value)} className="h-7 text-xs" placeholder="2024" /></div>
              <div className="space-y-1"><Label className="text-xs">Status</Label><Select value={formData.status} onValueChange={(v) => handleChange("status", v)}><SelectTrigger className="h-7 text-xs uppercase"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Ativo" className="text-xs uppercase">Ativo</SelectItem><SelectItem value="Em Manutenção" className="text-xs uppercase">Em Manutenção</SelectItem><SelectItem value="Inativo" className="text-xs uppercase">Inativo</SelectItem><SelectItem value="Vendido" className="text-xs uppercase">Vendido</SelectItem></SelectContent></Select></div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-1">
              <div className="space-y-1"><Label className="text-xs">Placa</Label><Input value={formData.placa} onChange={(e) => handleChange("placa", e.target.value)} className="h-7 text-xs uppercase" placeholder="ABC1D23" /></div>
              <div className="space-y-1"><Label className="text-xs">Chassi</Label><Input value={formData.chassi} onChange={(e) => handleChange("chassi", e.target.value)} className="h-7 text-xs uppercase" placeholder="CHASSI" /></div>
              <div className="space-y-1"><Label className="text-xs">Renavam</Label><Input value={formData.renavam} onChange={(e) => handleChange("renavam", e.target.value)} className="h-7 text-xs uppercase" placeholder="RENAVAM" /></div>
              <div className="space-y-1"><Label className="text-xs">Potência (CV)</Label><Input type="number" value={formData.potencia_cv} onChange={(e) => handleChange("potencia_cv", e.target.value)} className="h-7 text-xs" placeholder="0" /></div>
              <div className="space-y-1"><Label className="text-xs">Data Aquisição</Label><Input type="date" value={formData.data_aquisicao} onChange={(e) => handleChange("data_aquisicao", e.target.value)} className="h-7 text-xs" /></div>
            </div>

            <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-1 space-y-1">
              <div>
                <span className="font-semibold text-sm text-slate-700">Operação e Abastecimento</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-1">
                <div className="space-y-1"><Label className="text-xs">Horímetro Atual</Label><Input type="number" value={formData.horimetro_atual} onChange={(e) => handleChange("horimetro_atual", e.target.value)} className="h-7 text-xs" placeholder="HORAS" /></div>
                <div className="space-y-1"><Label className="text-xs">Hodômetro Atual</Label><Input type="number" value={formData.hodometro_atual} onChange={(e) => handleChange("hodometro_atual", e.target.value)} className="h-7 text-xs" placeholder="KM" /></div>
                <div className="space-y-1"><Label className="text-xs">Combustível</Label><Select value={formData.tipo_combustivel} onValueChange={(v) => handleChange("tipo_combustivel", v)}><SelectTrigger className="h-7 text-xs uppercase"><SelectValue placeholder="SELECIONE" /></SelectTrigger><SelectContent>{COMBUSTIVEIS.map((c) => <SelectItem key={c} value={c} className="text-xs uppercase">{c}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label className="text-xs">Capacidade Tanque (L)</Label><Input type="number" value={formData.capacidade_tanque} onChange={(e) => handleChange("capacidade_tanque", e.target.value)} className="h-7 text-xs" placeholder="0" /></div>
                <div className="space-y-1"><Label className="text-xs">Consumo Médio</Label><Input type="number" step="0.1" value={formData.consumo_medio} onChange={(e) => handleChange("consumo_medio", e.target.value)} className="h-7 text-xs" placeholder="L/H" /></div>
              </div>
            </div>

            <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-1 space-y-1">
              <div>
                <span className="font-semibold text-sm text-slate-700">Custos Operacionais</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-1">
                <div className="space-y-1"><Label className="text-xs">Vida Útil (H)</Label><Input type="number" value={formData.vida_util_horas} onChange={(e) => handleChange("vida_util_horas", e.target.value)} className="h-7 text-xs" placeholder="10000" /></div>
                <div className="space-y-1"><Label className="text-xs">Custo / Hora</Label><Input type="number" step="0.01" value={formData.custo_hora} onChange={(e) => handleChange("custo_hora", e.target.value)} className="h-7 text-xs" placeholder="0,00" /></div>
                <div className="space-y-1"><Label className="text-xs">Combustível / L</Label><Input type="number" step="0.01" value={formData.valor_combustivel_litro} onChange={(e) => handleChange("valor_combustivel_litro", e.target.value)} className="h-7 text-xs" placeholder="0,00" /></div>
                <div className="space-y-1"><Label className="text-xs">Valor Aquisição</Label><Input type="number" step="0.01" value={formData.valor_aquisicao} onChange={(e) => handleChange("valor_aquisicao", e.target.value)} className="h-7 text-xs" placeholder="0,00" /></div>
                <div className="space-y-1"><Label className="text-xs">Valor Atual</Label><Input type="number" step="0.01" value={formData.valor_atual} onChange={(e) => handleChange("valor_atual", e.target.value)} className="h-7 text-xs" placeholder="0,00" /></div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <div className="space-y-1"><Label className="text-xs">Localização Atual</Label><Select value={formData.localizacao_atual} onValueChange={(v) => handleChange("localizacao_atual", v)}><SelectTrigger className="h-7 text-xs uppercase"><SelectValue placeholder="SELECIONE A ÁREA" /></SelectTrigger><SelectContent>{areas.map((a) => <SelectItem key={a.id} value={a.nome} className="text-xs uppercase">{a.nome}</SelectItem>)}</SelectContent></Select></div>
              <div className="lg:col-span-2 space-y-1"><Label className="text-xs">Observações</Label><Textarea value={formData.observacoes} onChange={(e) => handleChange("observacoes", e.target.value)} rows={3} className="text-xs uppercase min-h-[84px]" placeholder="OBSERVAÇÕES GERAIS" /></div>
            </div>

            <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
              <Button type="submit" disabled={mutation.isPending} size="sm" className="h-7 bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow hover:bg-emerald-600">{mutation.isPending ? "Salvando..." : maquina ? "Atualizar" : "Salvar"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}