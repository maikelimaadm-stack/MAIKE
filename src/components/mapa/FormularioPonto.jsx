import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import CapturaGPSPonto from "./CapturaGPSPonto";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";

function ProdutoSuplementacaoSelect({ value, onChange }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-suplementacao", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((produto) => produto.empresa_id === empresaSelecionadaId && normalizeText(produto.categoria).includes("SUPLEMENTAC"));
    },
    enabled: !!empresaSelecionadaId,
  });

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Selecione o produto" />
      </SelectTrigger>
      <SelectContent>
        {produtos.map((produto) => (
          <SelectItem key={produto.id} value={produto.nome_produto} className="text-xs">
            {produto.nome_produto}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const createEmptyForm = () => ({
  nome: "",
  sigla: "",
  tipo: "",
  configuracao_icone_id: "",
  observacoes: "",
  produto_padrao: "",
  capacidade_cocho_kg: "",
  area_vinculada_id: "",
  deposito_origem_id: "",
  consumo_ideal_por_cabeca_kg: "",
  limite_minimo_consumo: "",
  limite_maximo_consumo: "",
  frequencia_esperada_dias: "7",
  alerta_sem_lancamento_dias: "10",
});

export default function FormularioPonto({ coordenadas, onSave, onCancel, usarGPS = false, item = null }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [areaDetectada, setAreaDetectada] = useState(null);
  const [mostrarCapturaGPS, setMostrarCapturaGPS] = useState(usarGPS);
  const [coordenadasGPS, setCoordenadasGPS] = useState(coordenadas || item?.coordenadas || null);
  const [progresso, setProgresso] = useState({ show: false, atual: 0, total: 0, mensagem: "" });
  const [formData, setFormData] = useState(createEmptyForm());

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((itemIcone) => itemIcone.tipo_entidade === "Ponto" && itemIcone.ativo !== false);
    },
    enabled: true,
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["areas", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((area) => area.empresa_id === empresaSelecionadaId && area.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: pontosSuplementacao = [] } = useQuery({
    queryKey: ["pontos-suplementacao-form", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter((ponto) => ponto.empresa_id === empresaSelecionadaId && ponto.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId,
  });

  const pontoSuplementacaoExistente = useMemo(() => {
    if (!item) return null;
    const nomeAtual = normalizeText(item.nome);
    const siglaAtual = normalizeText(item.sigla);

    return pontosSuplementacao.find((ponto) => normalizeText(ponto.nome_ponto) === nomeAtual || (siglaAtual && normalizeText(ponto.sigla) === siglaAtual)) || null;
  }, [item, pontosSuplementacao]);

  const depositosDisponiveis = useMemo(() => {
    return pontosSuplementacao.filter((ponto) => normalizeText(ponto.categoria_ponto || "") === "DEPOSITO");
  }, [pontosSuplementacao]);

  useEffect(() => {
    if (!item) {
      setFormData(createEmptyForm());
      return;
    }

    setFormData({
      nome: item.nome || "",
      sigla: item.sigla || "",
      tipo: item.tipo || "",
      configuracao_icone_id: item.configuracao_icone_id || "",
      observacoes: item.observacoes || pontoSuplementacaoExistente?.observacoes || "",
      produto_padrao: pontoSuplementacaoExistente?.produto_padrao || "",
      capacidade_cocho_kg: pontoSuplementacaoExistente?.capacidade_cocho_kg || "",
      area_vinculada_id: pontoSuplementacaoExistente?.area_vinculada_id || "",
      deposito_origem_id: pontoSuplementacaoExistente?.deposito_origem_id || "",
      consumo_ideal_por_cabeca_kg: pontoSuplementacaoExistente?.consumo_ideal_por_cabeca_kg || "",
      limite_minimo_consumo: pontoSuplementacaoExistente?.limite_minimo_consumo || "",
      limite_maximo_consumo: pontoSuplementacaoExistente?.limite_maximo_consumo || "",
      frequencia_esperada_dias: pontoSuplementacaoExistente?.frequencia_esperada_dias || "7",
      alerta_sem_lancamento_dias: pontoSuplementacaoExistente?.alerta_sem_lancamento_dias || "10",
    });
  }, [item, pontoSuplementacaoExistente]);

  const handleCapturaGPS = (localizacao) => {
    setCoordenadasGPS(localizacao);
    setMostrarCapturaGPS(false);
    toast.success("Localização GPS capturada!");
  };

  useEffect(() => {
    const pontoCoords = coordenadasGPS || coordenadas;
    if (!pontoCoords || !areas.length) return;

    for (const area of areas) {
      const areaCoords = area.coordenadas?.coords || [];
      if (areaCoords.length < 3) continue;

      const polygon = areaCoords.map((coord) => ({ lat: coord[0] || coord.lat, lng: coord[1] || coord.lng }));
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lat;
        const yi = polygon[i].lng;
        const xj = polygon[j].lat;
        const yj = polygon[j].lng;
        const intersect = ((yi > pontoCoords.lng) !== (yj > pontoCoords.lng)) && (pontoCoords.lat < (xj - xi) * (pontoCoords.lng - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }

      if (inside) {
        setAreaDetectada(area);
        setFormData((prev) => ({ ...prev, area_vinculada_id: prev.area_vinculada_id || area.id }));
        break;
      }
    }
  }, [coordenadasGPS, coordenadas, areas]);

  const ehCocho = normalizeText(formData.tipo).includes("COCHO");
  const ehDeposito = normalizeText(formData.tipo).includes("DEPOSITO");

  const createPontoMutation = useMutation({
    mutationFn: async (data) => {
      const pontosReferencia = await base44.entities.PontoReferencia.list();
      const maxNumeroPonto = pontosReferencia.reduce((maximo, ponto) => Math.max(maximo, parseInt(ponto.numero_ponto) || 0), 0);
      const configIcone = iconesConfig.find((icone) => icone.id === data.configuracao_icone_id)
        || iconesConfig.find((icone) => normalizeText(icone.categoria) === normalizeText(data.tipo));

      setProgresso({ show: true, atual: 1, total: 3, mensagem: item ? "Atualizando ponto de referência..." : "Criando ponto de referência..." });

      const payloadPonto = {
        nome: data.nome,
        sigla: data.sigla,
        tipo: data.tipo,
        configuracao_icone_id: data.configuracao_icone_id || null,
        icone_url: configIcone?.icone_url || null,
        sub_icone_url: configIcone?.sub_icone_url || null,
        observacoes: data.observacoes,
        empresa_id: empresaSelecionadaId,
        numero_ponto: item?.numero_ponto || String(maxNumeroPonto + 1),
        ativo: true,
        cor: configIcone?.cor_padrao || "#0066ff",
        coordenadas: coordenadasGPS || coordenadas,
      };

      const pontoReferencia = item
        ? await base44.entities.PontoReferencia.update(item.id, payloadPonto)
        : await base44.entities.PontoReferencia.create(payloadPonto);

      if (!data.tipo_categoria && pontoSuplementacaoExistente) {
        setProgresso({ show: true, atual: 2, total: 3, mensagem: "Inativando vínculo de suplementação..." });
        await base44.entities.PontoSuplementacao.update(pontoSuplementacaoExistente.id, { status: "Inativo" });
        return pontoReferencia;
      }

      if (!data.tipo_categoria) return pontoReferencia;

      setProgresso({ show: true, atual: 2, total: 3, mensagem: data.tipo_categoria === "DEPOSITO" ? "Configurando depósito..." : "Configurando cocho..." });

      const pontosSuplementacaoEmpresa = await base44.entities.PontoSuplementacao.list();
      const pontosAtivosEmpresa = pontosSuplementacaoEmpresa.filter((ponto) => ponto.empresa_id === empresaSelecionadaId && ponto.status === "Ativo");
      const maiorNumero = pontosAtivosEmpresa.reduce((maximo, ponto) => Math.max(maximo, parseInt(String(ponto.numero_ponto || "").replace(/\D/g, "")) || 0), 0);
      const prefixo = data.tipo_categoria === "DEPOSITO" ? "DEP" : "COCHO";
      const areaVinculada = areas.find((area) => area.id === data.area_vinculada_id);
      let localEstoqueId = pontoSuplementacaoExistente?.local_estoque_id || null;
      let localEstoqueNome = pontoSuplementacaoExistente?.local_estoque_nome || null;

      if (data.tipo_categoria === "DEPOSITO") {
        const descricaoLocal = `DEPÓSITO DE SUPLEMENTAÇÃO - ${data.nome}`;
        if (localEstoqueId) {
          await base44.entities.LocalEstoque.update(localEstoqueId, { nome: data.nome, descricao: descricaoLocal });
          localEstoqueNome = data.nome;
        } else {
          const localCriado = await base44.entities.LocalEstoque.create({ nome: data.nome, descricao: descricaoLocal });
          localEstoqueId = localCriado.id;
          localEstoqueNome = localCriado.nome;
        }
      }

      const depositoSelecionado = depositosDisponiveis.find((ponto) => ponto.id === data.deposito_origem_id);
      const payloadSuplementacao = {
        empresa_id: empresaSelecionadaId,
        numero_ponto: pontoSuplementacaoExistente?.numero_ponto || `${prefixo}-${String(maiorNumero + 1).padStart(4, "0")}`,
        nome_ponto: data.nome,
        sigla: data.sigla,
        categoria_ponto: data.tipo_categoria,
        tipo: data.tipo,
        produto_padrao: data.tipo_categoria === "COCHO" ? data.produto_padrao || null : null,
        capacidade_cocho_kg: data.tipo_categoria === "COCHO" && data.capacidade_cocho_kg ? parseFloat(data.capacidade_cocho_kg) : null,
        area_vinculada_id: data.tipo_categoria === "COCHO" ? data.area_vinculada_id : null,
        area_vinculada_nome: data.tipo_categoria === "COCHO" ? areaVinculada?.nome || "" : null,
        deposito_origem_id: data.tipo_categoria === "COCHO" ? data.deposito_origem_id || null : null,
        deposito_origem_nome: data.tipo_categoria === "COCHO" ? depositoSelecionado?.nome_ponto || null : null,
        local_estoque_id: data.tipo_categoria === "DEPOSITO" ? localEstoqueId : null,
        local_estoque_nome: data.tipo_categoria === "DEPOSITO" ? localEstoqueNome : null,
        coordenadas: coordenadasGPS || coordenadas,
        status: "Ativo",
        observacoes: data.observacoes || null,
        consumo_ideal_por_cabeca_kg: data.tipo_categoria === "COCHO" && data.consumo_ideal_por_cabeca_kg ? parseFloat(data.consumo_ideal_por_cabeca_kg) : null,
        limite_minimo_consumo: data.tipo_categoria === "COCHO" && data.limite_minimo_consumo ? parseFloat(data.limite_minimo_consumo) : null,
        limite_maximo_consumo: data.tipo_categoria === "COCHO" && data.limite_maximo_consumo ? parseFloat(data.limite_maximo_consumo) : null,
        frequencia_esperada_dias: data.tipo_categoria === "COCHO" ? parseInt(data.frequencia_esperada_dias || 7) : null,
        alerta_sem_lancamento_dias: data.tipo_categoria === "COCHO" ? parseInt(data.alerta_sem_lancamento_dias || 10) : null,
      };

      const registroSuplementacao = pontoSuplementacaoExistente
        ? await base44.entities.PontoSuplementacao.update(pontoSuplementacaoExistente.id, payloadSuplementacao)
        : await base44.entities.PontoSuplementacao.create(payloadSuplementacao);

      if (data.tipo_categoria === "DEPOSITO") {
        setProgresso({ show: true, atual: 3, total: 3, mensagem: "Atualizando cochos vinculados..." });
        const cochosRelacionados = pontosAtivosEmpresa.filter((ponto) => ponto.deposito_origem_id === registroSuplementacao.id);
        for (const cocho of cochosRelacionados) {
          await base44.entities.PontoSuplementacao.update(cocho.id, { deposito_origem_nome: data.nome });
        }
      }

      return pontoReferencia;
    },
    onSuccess: () => {
      setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["pontos", "pontos-suplementacao-form", "mapa-pontos", "mapa-pontos-supl", "pontos-suplementacao"].includes(query.queryKey[0]) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success(item ? "Ponto atualizado com sucesso." : "Ponto cadastrado com sucesso.");
      onSave();
    },
    onError: (error) => {
      setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
      toast.error(error.message || "Erro ao salvar o ponto.");
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.nome || !formData.tipo) {
      toast.error("Preencha o nome e o tipo do ponto.");
      return;
    }

    if (!coordenadasGPS && !coordenadas) {
      toast.error("Coordenadas não informadas.");
      return;
    }

    if (ehCocho && !formData.area_vinculada_id) {
      toast.error("Selecione a área do cocho.");
      return;
    }

    if (ehCocho && !formData.deposito_origem_id) {
      toast.error("Selecione o depósito vinculado ao cocho.");
      return;
    }

    createPontoMutation.mutate({
      nome: formData.nome.toUpperCase(),
      sigla: formData.sigla.toUpperCase(),
      tipo: formData.tipo,
      configuracao_icone_id: formData.configuracao_icone_id,
      observacoes: formData.observacoes?.toUpperCase(),
      produto_padrao: ehCocho ? formData.produto_padrao : null,
      capacidade_cocho_kg: ehCocho ? formData.capacidade_cocho_kg : null,
      area_vinculada_id: ehCocho ? formData.area_vinculada_id : null,
      deposito_origem_id: ehCocho ? formData.deposito_origem_id : null,
      consumo_ideal_por_cabeca_kg: ehCocho ? formData.consumo_ideal_por_cabeca_kg : null,
      limite_minimo_consumo: ehCocho ? formData.limite_minimo_consumo : null,
      limite_maximo_consumo: ehCocho ? formData.limite_maximo_consumo : null,
      frequencia_esperada_dias: ehCocho ? formData.frequencia_esperada_dias : null,
      alerta_sem_lancamento_dias: ehCocho ? formData.alerta_sem_lancamento_dias : null,
      tipo_categoria: ehDeposito ? "DEPOSITO" : ehCocho ? "COCHO" : null,
    });
  };

  if (mostrarCapturaGPS) {
    return (
      <CapturaGPSPonto
        onCapturar={handleCapturaGPS}
        onCancelar={() => {
          setMostrarCapturaGPS(false);
          if (usarGPS) onCancel();
        }}
      />
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4 mt-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Nome do ponto *</Label>
            <Input value={formData.nome} onChange={(e) => setFormData((prev) => ({ ...prev, nome: e.target.value }))} className="h-8 text-xs uppercase" required />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sigla</Label>
            <Input value={formData.sigla} onChange={(e) => setFormData((prev) => ({ ...prev, sigla: e.target.value }))} className="h-8 text-xs uppercase" maxLength={10} />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Ponto de referência *</Label>
          <Select value={formData.configuracao_icone_id} onValueChange={(value) => {
            const configuracao = iconesConfig.find((itemConfig) => itemConfig.id === value);
            setFormData((prev) => ({ ...prev, configuracao_icone_id: value, tipo: configuracao?.categoria || prev.tipo }));
          }}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione o tipo do ponto" /></SelectTrigger>
            <SelectContent>
              {iconesConfig.map((itemConfig) => <SelectItem key={itemConfig.id} value={itemConfig.id} className="text-xs">{itemConfig.categoria}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Observações</Label>
          <Textarea value={formData.observacoes} onChange={(e) => setFormData((prev) => ({ ...prev, observacoes: e.target.value }))} rows={3} className="text-xs uppercase" />
        </div>

        {ehCocho && (
          <div className="space-y-4 border-t pt-4">
            <div className="text-sm font-semibold text-slate-700">Dados do Cocho</div>
            {areaDetectada && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Área detectada: {areaDetectada.nome}</div>}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Área vinculada *</Label>
                <Select value={formData.area_vinculada_id} onValueChange={(value) => setFormData((prev) => ({ ...prev, area_vinculada_id: value }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione a área" /></SelectTrigger>
                  <SelectContent>
                    {areas.map((area) => <SelectItem key={area.id} value={area.id} className="text-xs">{area.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Depósito vinculado *</Label>
                <Select value={formData.deposito_origem_id} onValueChange={(value) => setFormData((prev) => ({ ...prev, deposito_origem_id: value }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione o depósito" /></SelectTrigger>
                  <SelectContent>
                    {depositosDisponiveis.map((deposito) => <SelectItem key={deposito.id} value={deposito.id} className="text-xs">{deposito.nome_ponto}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Produto padrão</Label>
                <ProdutoSuplementacaoSelect value={formData.produto_padrao} onChange={(value) => setFormData((prev) => ({ ...prev, produto_padrao: value }))} />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Capacidade do cocho (kg)</Label>
                <Input type="number" step="0.01" value={formData.capacidade_cocho_kg} onChange={(e) => setFormData((prev) => ({ ...prev, capacidade_cocho_kg: e.target.value }))} className="h-8 text-xs" />
              </div>
            </div>

            {depositosDisponiveis.length === 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Cadastre primeiro um ponto do tipo depósito para vincular este cocho.</div>}
          </div>
        )}

        {ehDeposito && (
          <div className="space-y-4 border-t pt-4">
            <div className="text-sm font-semibold text-slate-700">Depósito de Suplementação</div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">Ao salvar este ponto, um local de estoque será criado automaticamente para uso exclusivo dos produtos de suplementação.</div>
            {pontoSuplementacaoExistente?.local_estoque_nome && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Local de estoque atual: {pontoSuplementacaoExistente.local_estoque_nome}</div>}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel} disabled={progresso.show}>Cancelar</Button>
          <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={progresso.show}>{progresso.show ? "Salvando..." : item ? "Salvar alterações" : "Salvar ponto"}</Button>
        </div>
      </form>

      <Dialog open={progresso.show} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Salvando...</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-600">{progresso.mensagem}</p>
            <Progress value={progresso.total ? (progresso.atual / progresso.total) * 100 : 0} className="w-full h-1.5" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}