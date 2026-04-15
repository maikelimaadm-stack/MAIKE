import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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

const CATEGORIAS = ["Máquina", "Equipamento", "Implemento", "Veículo", "Ferramenta"];
const TIPOS_MEDICAO = ["Horímetro", "Hodômetro", "Nenhum"];
const REQUIRED_FIELDS = ["nome", "categoria"];

const CAMPOS_POR_CATEGORIA = {
  "Máquina": {
    identificacaoVeicular: true,
    combustivel: true,
    medicao: true,
    custosComplexos: true,
    consumoOpcional: true,
  },
  "Veículo": {
    identificacaoVeicular: true,
    combustivel: true,
    medicao: true,
    custosComplexos: true,
    consumoOpcional: true,
  },
  "Equipamento": {
    identificacaoVeicular: false,
    combustivel: false,
    medicao: true,
    custosComplexos: true,
    consumoOpcional: true,
  },
  "Implemento": {
    identificacaoVeicular: false,
    combustivel: false,
    medicao: false,
    custosComplexos: false,
    consumoOpcional: false,
  },
  "Ferramenta": {
    identificacaoVeicular: false,
    combustivel: false,
    medicao: false,
    custosComplexos: false,
    consumoOpcional: false,
  },
};
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

  const { data: tiposAtivo = [] } = useQuery({
    queryKey: ["tipos-ativo", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.TipoAtivo.list();
      return all.filter((item) => item.ativo !== false);
    },
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-combustivel-ativos", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId && p.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const [formData, setFormData] = useState({
    codigo: maquina?.codigo || "",
    nome: maquina?.nome || "",
    identificador_curto: maquina?.identificador_curto || "",
    categoria: maquina?.categoria || "",
    tipo_id: maquina?.tipo_id || "",
    tipo: maquina?.tipo || "",
    marca: maquina?.marca || "",
    modelo: maquina?.modelo || "",
    ano_fabricacao: maquina?.ano_fabricacao || "",
    placa: maquina?.placa || "",
    chassi: maquina?.chassi || "",
    renavam: maquina?.renavam || "",
    potencia_cv: maquina?.potencia_cv || "",
    tipo_medicao: maquina?.tipo_medicao || "Nenhum",
    medicao_atual: maquina?.medicao_atual || maquina?.horimetro_atual || maquina?.hodometro_atual || "",
    data_aquisicao: maquina?.data_aquisicao || "",
    valor_aquisicao: maquina?.valor_aquisicao || "",
    valor_atual: maquina?.valor_atual || "",
    consumo_medio: maquina?.consumo_medio || "",
    capacidade_tanque: maquina?.capacidade_tanque || "",
    vida_util_horas: maquina?.vida_util_horas || "",
    custo_hora: maquina?.custo_hora || "",
    valor_combustivel_litro: maquina?.valor_combustivel_litro || "",
    status: maquina?.status || "Ativo",
    localizacao_atual: maquina?.localizacao_atual || "",
    observacoes: maquina?.observacoes || "",
    produtos_combustiveis_vinculados: maquina?.produtos_combustiveis_vinculados || [],
  });

  const tiposFiltrados = useMemo(() => {
    return tiposAtivo.filter((item) => item.categoria === formData.categoria);
  }, [tiposAtivo, formData.categoria]);

  const categoriaConfig = CAMPOS_POR_CATEGORIA[formData.categoria] || {
    identificacaoVeicular: false,
    combustivel: false,
    medicao: false,
    custosComplexos: false,
    consumoOpcional: false,
  };

  const limparCamposPorCategoria = (categoria, prev) => {
    const config = CAMPOS_POR_CATEGORIA[categoria] || {};
    const next = { ...prev, categoria, tipo_id: "", tipo: "" };

    if (!config.identificacaoVeicular) {
      next.placa = "";
      next.renavam = "";
      next.chassi = "";
    }

    if (!config.combustivel) {
      next.capacidade_tanque = "";
      next.produtos_combustiveis_vinculados = [];
      next.valor_combustivel_litro = "";
      if (!config.consumoOpcional) {
        next.consumo_medio = "";
      }
    }

    if (!config.medicao) {
      next.tipo_medicao = "Nenhum";
      next.medicao_atual = "";
      next.vida_util_horas = "";
      next.custo_hora = "";
    }

    if (!config.custosComplexos) {
      next.vida_util_horas = "";
      next.custo_hora = "";
      next.valor_combustivel_litro = "";
      next.potencia_cv = "";
    }

    return next;
  };

  const handleChange = (field, value) => {
    const uppercaseFields = ["codigo", "nome", "identificador_curto", "marca", "modelo", "placa", "chassi", "renavam", "observacoes"];
    setFormData((prev) => {
      const nextValue = uppercaseFields.includes(field) ? String(value).toUpperCase() : value;
      if (field === "categoria") {
        return limparCamposPorCategoria(nextValue, prev);
      }
      if (field === "tipo_medicao" && value === "Nenhum") {
        return { ...prev, tipo_medicao: value, medicao_atual: "" };
      }
      return { ...prev, [field]: nextValue };
    });
  };

  const toggleProduto = (produto) => {
    setFormData((prev) => {
      const exists = prev.produtos_combustiveis_vinculados.some((item) => item.produto_id === produto.id);
      if (exists) {
        return {
          ...prev,
          produtos_combustiveis_vinculados: prev.produtos_combustiveis_vinculados.filter((item) => item.produto_id !== produto.id),
        };
      }
      return {
        ...prev,
        produtos_combustiveis_vinculados: [...prev.produtos_combustiveis_vinculados, { produto_id: produto.id, produto_nome: produto.nome_produto, principal: prev.produtos_combustiveis_vinculados.length === 0 }],
      };
    });
  };

  const definirPrincipal = (produtoId) => {
    setFormData((prev) => ({
      ...prev,
      produtos_combustiveis_vinculados: prev.produtos_combustiveis_vinculados.map((item) => ({ ...item, principal: item.produto_id === produtoId })),
    }));
  };

  const mutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        ...data,
        empresa_id: empresaSelecionadaId,
        ano_fabricacao: data.ano_fabricacao ? parseInt(data.ano_fabricacao) : null,
        potencia_cv: data.potencia_cv ? parseFloat(data.potencia_cv) : null,
        medicao_atual: data.tipo_medicao !== "Nenhum" && data.medicao_atual ? parseFloat(data.medicao_atual) : null,
        valor_aquisicao: data.valor_aquisicao ? parseFloat(data.valor_aquisicao) : null,
        valor_atual: data.valor_atual ? parseFloat(data.valor_atual) : null,
        consumo_medio: data.consumo_medio ? parseFloat(data.consumo_medio) : null,
        capacidade_tanque: data.capacidade_tanque ? parseFloat(data.capacidade_tanque) : null,
        vida_util_horas: data.vida_util_horas ? parseFloat(data.vida_util_horas) : null,
        custo_hora: data.custo_hora ? parseFloat(data.custo_hora) : null,
        valor_combustivel_litro: data.valor_combustivel_litro ? parseFloat(data.valor_combustivel_litro) : null,
      };

      delete payload.horimetro_atual;
      delete payload.hodometro_atual;

      if (maquina) return base44.entities.Maquina.update(maquina.id, payload);
      return base44.entities.Maquina.create(payload);
    },
    onSuccess: () => {
      toast.success(maquina ? "Ativo atualizado!" : "Ativo cadastrado!");
      onSave();
    },
    onError: (error) => {
      toast.error("Erro: " + error.message);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setTentouSalvar(true);
    if (REQUIRED_FIELDS.some((field) => !formData[field])) {
      toast.error("Preencha os campos obrigatórios");
      return;
    }
    if (categoriaConfig.medicao && formData.tipo_medicao !== "Nenhum" && !formData.medicao_atual) {
      toast.error("Informe a medição atual");
      return;
    }
    mutation.mutate(formData);
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-white border-b py-1 px-1">
...
        <CardContent className="p-1 bg-white">
          <form onSubmit={handleSubmit} className="space-y-1 bg-white">
            <div className="border border-slate-200 bg-white rounded-lg p-1 space-y-1">
              <span className="font-semibold text-xs text-slate-700">Identificação</span>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-1">
                <FL label="Código"><Input value={formData.codigo} onChange={(e) => handleChange("codigo", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="COD001" /></FL>
                <FL label="Nome do ativo" required error={tentouSalvar && !formData.nome}><Input value={formData.nome} onChange={(e) => handleChange("nome", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="NOME DO ATIVO" /></FL>
                <FL label="Identificador"><Input value={formData.identificador_curto} onChange={(e) => handleChange("identificador_curto", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="TRATOR 01" /></FL>
                <FL label="Categoria" required error={tentouSalvar && !formData.categoria}>
                  <Select value={formData.categoria} onValueChange={(v) => handleChange("categoria", v)}>
                    <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                    <SelectContent>{CATEGORIAS.map((item) => <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>)}</SelectContent>
                  </Select>
                </FL>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-1">
                <FL label="Tipo">
                  <Select value={formData.tipo_id} onValueChange={(v) => {
                    const tipo = tiposFiltrados.find((item) => item.id === v);
                    setFormData((prev) => ({ ...prev, tipo_id: v, tipo: tipo?.nome || "" }));
                  }}>
                    <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder={formData.categoria ? "SELECIONE" : "SELECIONE A CATEGORIA"} /></SelectTrigger>
                    <SelectContent>{tiposFiltrados.map((item) => <SelectItem key={item.id} value={item.id} className="text-xs">{item.nome}</SelectItem>)}</SelectContent>
                  </Select>
                </FL>
                {formData.categoria !== "Ferramenta" && (
                  <>
                    <FL label="Marca"><Input value={formData.marca} onChange={(e) => handleChange("marca", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="MARCA" /></FL>
                    <FL label="Modelo"><Input value={formData.modelo} onChange={(e) => handleChange("modelo", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="MODELO" /></FL>
                    <FL label="Ano fabricação"><Input type="number" value={formData.ano_fabricacao} onChange={(e) => handleChange("ano_fabricacao", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="2024" /></FL>
                  </>
                )}
              </div>
              {(categoriaConfig.identificacaoVeicular || formData.categoria !== "Ferramenta") && (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-1">
                  {categoriaConfig.identificacaoVeicular && (
                    <>
                      <FL label="Placa"><Input value={formData.placa} onChange={(e) => handleChange("placa", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="ABC1D23" /></FL>
                      <FL label="Chassi"><Input value={formData.chassi} onChange={(e) => handleChange("chassi", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="CHASSI" /></FL>
                      <FL label="Renavam"><Input value={formData.renavam} onChange={(e) => handleChange("renavam", e.target.value)} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="RENAVAM" /></FL>
                    </>
                  )}
                  {formData.categoria !== "Ferramenta" && categoriaConfig.custosComplexos && <FL label="Potência (CV)"><Input type="number" value={formData.potencia_cv} onChange={(e) => handleChange("potencia_cv", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0" /></FL>}
                  <FL label="Status">
                    <Select value={formData.status} onValueChange={(v) => handleChange("status", v)}>
                      <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="Ativo" className="text-xs">Ativo</SelectItem><SelectItem value="Em Manutenção" className="text-xs">Em Manutenção</SelectItem><SelectItem value="Inativo" className="text-xs">Inativo</SelectItem><SelectItem value="Vendido" className="text-xs">Vendido</SelectItem></SelectContent>
                    </Select>
                  </FL>
                </div>
              )}
            </div>

            {(categoriaConfig.medicao || categoriaConfig.combustivel || categoriaConfig.consumoOpcional || formData.localizacao_atual || formData.categoria === "Máquina" || formData.categoria === "Veículo" || formData.categoria === "Equipamento") && (
              <div className="border border-slate-200 bg-white rounded-lg p-1 space-y-1">
                <span className="font-semibold text-xs text-slate-700">Operação</span>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-1">
                  {categoriaConfig.medicao && (
                    <FL label="Tipo de medição" required error={tentouSalvar && !formData.tipo_medicao}>
                      <Select value={formData.tipo_medicao} onValueChange={(v) => handleChange("tipo_medicao", v)}>
                        <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger>
                        <SelectContent>{TIPOS_MEDICAO.map((item) => <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>)}</SelectContent>
                      </Select>
                    </FL>
                  )}
                  {categoriaConfig.medicao && formData.tipo_medicao !== "Nenhum" && (
                    <FL label={formData.tipo_medicao === "Horímetro" ? "Medição atual (h)" : "Medição atual (km)"} required error={tentouSalvar && !formData.medicao_atual}>
                      <Input type="number" value={formData.medicao_atual} onChange={(e) => handleChange("medicao_atual", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0" />
                    </FL>
                  )}
                  {categoriaConfig.combustivel && <FL label="Capacidade tanque (L)"><Input type="number" value={formData.capacidade_tanque} onChange={(e) => handleChange("capacidade_tanque", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0" /></FL>}
                  {categoriaConfig.consumoOpcional && <FL label="Consumo médio"><Input type="number" step="0.1" value={formData.consumo_medio} onChange={(e) => handleChange("consumo_medio", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0" /></FL>}
                  {formData.categoria !== "Ferramenta" && <FL label="Localização atual">
                    <Select value={formData.localizacao_atual} onValueChange={(v) => handleChange("localizacao_atual", v)}>
                      <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE A ÁREA" /></SelectTrigger>
                      <SelectContent>{areas.map((a) => <SelectItem key={a.id} value={a.nome} className="text-xs uppercase">{a.nome}</SelectItem>)}</SelectContent>
                    </Select>
                  </FL>}
                </div>
                {categoriaConfig.combustivel && (
                  <div className="space-y-1">
                    <label className="text-[12px] text-slate-500 pl-1 leading-none">Combustíveis vinculados</label>
                    <div className="rounded-md border border-slate-300 p-2 space-y-2 bg-white">
                      {produtos.length === 0 ? (
                        <div className="text-xs text-slate-400">Nenhum produto combustível encontrado</div>
                      ) : produtos.map((produto) => {
                        const vinculado = formData.produtos_combustiveis_vinculados.some((item) => item.produto_id === produto.id);
                        const principal = formData.produtos_combustiveis_vinculados.some((item) => item.produto_id === produto.id && item.principal);
                        return (
                          <div key={produto.id} className="flex items-center justify-between gap-2 border-b border-slate-100 last:border-b-0 pb-2 last:pb-0">
                            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                              <Checkbox checked={vinculado} onCheckedChange={() => toggleProduto(produto)} />
                              <span className="uppercase">{produto.nome_produto}</span>
                            </label>
                            {vinculado && (
                              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                                <Checkbox checked={principal} onCheckedChange={() => definirPrincipal(produto.id)} />
                                <span>Principal</span>
                              </label>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {(formData.categoria !== "Ferramenta" && (categoriaConfig.custosComplexos || formData.valor_aquisicao || formData.valor_atual)) && (
              <div className="border border-slate-200 bg-white rounded-lg p-1 space-y-1">
                <span className="font-semibold text-xs text-slate-700">Custos</span>
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-1">
                  {categoriaConfig.custosComplexos && <FL label="Vida útil (h)"><Input type="number" value={formData.vida_util_horas} onChange={(e) => handleChange("vida_util_horas", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="10000" /></FL>}
                  {categoriaConfig.custosComplexos && <FL label="Custo / hora"><Input type="number" step="0.01" value={formData.custo_hora} onChange={(e) => handleChange("custo_hora", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0,00" /></FL>}
                  {categoriaConfig.combustivel && <FL label="Combustível / L"><Input type="number" step="0.01" value={formData.valor_combustivel_litro} onChange={(e) => handleChange("valor_combustivel_litro", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0,00" /></FL>}
                  <FL label="Valor aquisição"><Input type="number" step="0.01" value={formData.valor_aquisicao} onChange={(e) => handleChange("valor_aquisicao", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0,00" /></FL>
                  <FL label="Valor atual"><Input type="number" step="0.01" value={formData.valor_atual} onChange={(e) => handleChange("valor_atual", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0,00" /></FL>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-1">
              <FL label="Observações">
                <Textarea value={formData.observacoes} onChange={(e) => handleChange("observacoes", e.target.value)} rows={3} className="text-xs uppercase min-h-[84px] border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="OBSERVAÇÕES GERAIS" />
              </FL>
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