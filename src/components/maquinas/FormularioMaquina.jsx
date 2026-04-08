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

const FL = ({ label, required, error, children }) => (
  <div>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className={`rounded-md border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'} focus-within:border-emerald-500 transition-colors`}>
      {children}
    </div>
  </div>
);

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
          <form onSubmit={handleSubmit} className="space-y-0.5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <FL label="Código"><Input value={formData.codigo} onChange={(e) => handleChange("codigo", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="TRT001" /></FL>
              <FL label="Nome da Máquina" required error={tentouSalvar && !formData.nome}><Input value={formData.nome} onChange={(e) => handleChange("nome", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="NOME DA MÁQUINA" /></FL>
              <FL label="Tipo" required error={tentouSalvar && !formData.tipo}>
                <Select value={formData.tipo} onValueChange={(v) => handleChange("tipo", v)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>{TIPOS.map((t) => <SelectItem key={t} value={t} className="text-xs uppercase">{t}</SelectItem>)}</SelectContent>
                </Select>
              </FL>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-1">
              <FL label="Marca"><Input value={formData.marca} onChange={(e) => handleChange("marca", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="MARCA" /></FL>
              <FL label="Modelo"><Input value={formData.modelo} onChange={(e) => handleChange("modelo", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="MODELO" /></FL>
              <FL label="Ano Fabricação"><Input type="number" value={formData.ano_fabricacao} onChange={(e) => handleChange("ano_fabricacao", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="2024" /></FL>
              <FL label="Status">
                <Select value={formData.status} onValueChange={(v) => handleChange("status", v)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Ativo" className="text-xs">Ativo</SelectItem><SelectItem value="Em Manutenção" className="text-xs">Em Manutenção</SelectItem><SelectItem value="Inativo" className="text-xs">Inativo</SelectItem><SelectItem value="Vendido" className="text-xs">Vendido</SelectItem></SelectContent>
                </Select>
              </FL>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-1">
              <FL label="Placa"><Input value={formData.placa} onChange={(e) => handleChange("placa", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="ABC1D23" /></FL>
              <FL label="Chassi"><Input value={formData.chassi} onChange={(e) => handleChange("chassi", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="CHASSI" /></FL>
              <FL label="Renavam"><Input value={formData.renavam} onChange={(e) => handleChange("renavam", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="RENAVAM" /></FL>
              <FL label="Potência (CV)"><Input type="number" value={formData.potencia_cv} onChange={(e) => handleChange("potencia_cv", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0" /></FL>
              <FL label="Data Aquisição"><Input type="date" value={formData.data_aquisicao} onChange={(e) => handleChange("data_aquisicao", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
            </div>
            <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-1 space-y-0.5">
              <span className="font-semibold text-xs text-slate-700">Operação e Abastecimento</span>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-1">
                <FL label="Horímetro Atual"><Input type="number" value={formData.horimetro_atual} onChange={(e) => handleChange("horimetro_atual", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="HORAS" /></FL>
                <FL label="Hodômetro Atual"><Input type="number" value={formData.hodometro_atual} onChange={(e) => handleChange("hodometro_atual", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="KM" /></FL>
                <FL label="Combustível">
                  <Select value={formData.tipo_combustivel} onValueChange={(v) => handleChange("tipo_combustivel", v)}>
                    <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                    <SelectContent>{COMBUSTIVEIS.map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
                  </Select>
                </FL>
                <FL label="Capacidade Tanque (L)"><Input type="number" value={formData.capacidade_tanque} onChange={(e) => handleChange("capacidade_tanque", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0" /></FL>
                <FL label="Consumo Médio"><Input type="number" step="0.1" value={formData.consumo_medio} onChange={(e) => handleChange("consumo_medio", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="L/H" /></FL>
              </div>
            </div>
            <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-1 space-y-0.5">
              <span className="font-semibold text-xs text-slate-700">Custos Operacionais</span>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-1">
                <FL label="Vida Útil (H)"><Input type="number" value={formData.vida_util_horas} onChange={(e) => handleChange("vida_util_horas", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="10000" /></FL>
                <FL label="Custo / Hora"><Input type="number" step="0.01" value={formData.custo_hora} onChange={(e) => handleChange("custo_hora", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0,00" /></FL>
                <FL label="Combustível / L"><Input type="number" step="0.01" value={formData.valor_combustivel_litro} onChange={(e) => handleChange("valor_combustivel_litro", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0,00" /></FL>
                <FL label="Valor Aquisição"><Input type="number" step="0.01" value={formData.valor_aquisicao} onChange={(e) => handleChange("valor_aquisicao", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0,00" /></FL>
                <FL label="Valor Atual"><Input type="number" step="0.01" value={formData.valor_atual} onChange={(e) => handleChange("valor_atual", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0,00" /></FL>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <FL label="Localização Atual">
                <Select value={formData.localizacao_atual} onValueChange={(v) => handleChange("localizacao_atual", v)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE A ÁREA" /></SelectTrigger>
                  <SelectContent>{areas.map((a) => <SelectItem key={a.id} value={a.nome} className="text-xs uppercase">{a.nome}</SelectItem>)}</SelectContent>
                </Select>
              </FL>
              <div className="lg:col-span-2">
                <FL label="Observações">
                  <Textarea value={formData.observacoes} onChange={(e) => handleChange("observacoes", e.target.value)} rows={3} className="text-xs uppercase min-h-[84px] border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="OBSERVAÇÕES GERAIS" />
                </FL>
              </div>
            </div>
            <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
              <Button type="submit" disabled={mutation.isPending} size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">{mutation.isPending ? "Salvando..." : maquina ? "Atualizar" : "Salvar"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}