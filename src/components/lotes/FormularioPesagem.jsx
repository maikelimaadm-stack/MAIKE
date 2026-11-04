import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { listarIconesDaEmpresa } from "@/services/mapaService";
import { getTodayLocalDate } from "../utils/pecuariaUtils";
import { LancLoteForm, LancLoteItens, LancLoteItem, LancLoteAdicionar, LancLoteRodape, LancLoteSegmento, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import LancField from "@/components/cadastro/base1/LancField";

/** Campo flutuante Base1 (rótulo dentro) — D-PROD-88. */
const FL = LancField;

export default function FormularioPesagem({ lote, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [saving, setSaving] = useState(false);
  const lotesArray = Array.isArray(lote) ? lote : [lote];

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const icones = await listarIconesDaEmpresa(empresaSelecionadaId);
      return icones.filter((i) => i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const lotesPorCategoria = lotesArray.reduce((acc, l) => {
    const cat = l.categoria || 'SEM CATEGORIA';
    if (!acc[cat]) {
      acc[cat] = { categoria: cat, lotes: [], totalCabecas: 0, pesoAnterior: l.peso_medio_kg || 0 };
    }
    acc[cat].lotes.push(l);
    acc[cat].totalCabecas += l.quantidade_cabecas || 0;
    return acc;
  }, {});

  const categoriasDisponiveis = Object.keys(lotesPorCategoria).sort();

  const [modoPesagem, setModoPesagem] = useState("categorias");
  const [pesoGeral, setPesoGeral] = useState("");
  const [pesosIndividuais, setPesosIndividuais] = useState({});

  // Se há múltiplos lotes na mesma categoria com pesos diferentes, habilitar modo individual
  const temLotesComPesosDiferentes = Object.values(lotesPorCategoria).some(cat => {
    if (cat.lotes.length <= 1) return false;
    const pesos = cat.lotes.map(l => l.peso_medio_kg || 0);
    return new Set(pesos).size > 1;
  });

  const [formData, setFormData] = useState({
    data_pesagem: getTodayLocalDate(),
    pesagens: [],
    observacoes: ""
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    
    if (modoPesagem === "todos") {
      if (!pesoGeral || parseFloat(pesoGeral) <= 0) {
        alert("Informe o peso para todos os animais");
        return;
      }

      setSaving(true);
      try {
        await onSubmit({
          modo: 'todos',
          data_pesagem: formData.data_pesagem,
          categorias_selecionadas: categoriasDisponiveis,
          pesos_por_categoria: categoriasDisponiveis.reduce((acc, cat) => {
            acc[cat] = parseFloat(pesoGeral);
            return acc;
          }, {}),
          observacoes: formData.observacoes
        });
      } finally {
        setSaving(false);
      }
    } else if (modoPesagem === "individual") {
      // Modo individual: peso por lote
      const lotesComPeso = Object.entries(pesosIndividuais).filter(([, peso]) => peso && parseFloat(peso) > 0);
      if (lotesComPeso.length === 0) {
        alert("Preencha o peso de pelo menos um lote");
        return;
      }
      const categoriasAfetadas = [...new Set(lotesArray.filter(l => pesosIndividuais[l.id]).map(l => l.categoria))];
      setSaving(true);
      try {
        await onSubmit({
          // R2B-P1: só os lotes com peso preenchido entram (sem "peso da categoria" de fallback).
          modo: 'por_lote',
          data_pesagem: formData.data_pesagem,
          categorias_selecionadas: categoriasAfetadas,
          pesos_por_categoria: categoriasAfetadas.reduce((acc, cat) => {
            // Usa o primeiro peso da categoria como fallback
            const primeiroLote = lotesArray.find(l => l.categoria === cat && pesosIndividuais[l.id]);
            acc[cat] = primeiroLote ? parseFloat(pesosIndividuais[primeiroLote.id]) : 0;
            return acc;
          }, {}),
          pesos_por_lote: Object.fromEntries(lotesComPeso),
          observacoes: formData.observacoes
        });
      } finally {
        setSaving(false);
      }
    } else {
      const pesagensValidas = formData.pesagens.filter(p => p.peso && parseFloat(p.peso) > 0);
      if (pesagensValidas.length === 0) {
        alert("Preencha o peso de pelo menos uma categoria");
        return;
      }

      setSaving(true);
      try {
        await onSubmit({
          modo: 'por_categoria',
          data_pesagem: formData.data_pesagem,
          categorias_selecionadas: pesagensValidas.map(p => p.categoria),
          pesos_por_categoria: pesagensValidas.reduce((acc, p) => {
            acc[p.categoria] = parseFloat(p.peso);
            return acc;
          }, {}),
          observacoes: formData.observacoes
        });
      } finally {
        setSaving(false);
      }
    }
  };



  const adicionarCategoria = () => {
    const primeiraCategoria = categoriasDisponiveis[0];
    setFormData(prev => ({
      ...prev,
      pesagens: [...prev.pesagens, {
        categoria: primeiraCategoria,
        peso: ""
      }]
    }));
  };

  const removerCategoria = (index) => {
    setFormData(prev => ({
      ...prev,
      pesagens: prev.pesagens.filter((_, i) => i !== index)
    }));
  };

  const handlePesagemChange = (index, field, value) => {
    const novasPesagens = [...formData.pesagens];
    novasPesagens[index] = { ...novasPesagens[index], [field]: value };
    setFormData({ ...formData, pesagens: novasPesagens });
  };


  return (
    <LancLoteForm onSubmit={handleSubmit}>
          <FL label="Data da Pesagem" required>
            <Input type="date" value={formData.data_pesagem} onChange={(e) => setFormData({ ...formData, data_pesagem: e.target.value })} className={LL_CTL} required />
          </FL>

          <LancLoteSegmento rotulo="Modo de Pesagem" valor={modoPesagem} onChange={setModoPesagem} opcoes={[{ value: "categorias", label: "Por Categoria" }, { value: "individual", label: "Por Lote" }, { value: "todos", label: "Todos (Mesmo Peso)" }]} />

          {modoPesagem === "individual" ? (
            <LancLoteItens>
              {lotesArray.map((loteItem) => {
                const configIcone = iconesConfig.find(ic => 
                  ic.tipo_entidade === 'Lote' && 
                  ic.categoria?.toUpperCase() === loteItem.categoria?.toUpperCase()
                );
                const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;
                return (
                  <LancLoteItem key={loteItem.id} titulo={loteItem.nome} icone={iconeUrl} sub={<>{loteItem.categoria} • {loteItem.quantidade_cabecas || 0} cab • Peso atual: {loteItem.peso_medio_kg || 0} kg</>}>
                    <FL label="Novo Peso (kg)" className="mk-ll__cheio">
                      <Input
                        type="number"
                        step="0.1"
                        value={pesosIndividuais[loteItem.id] || ''}
                        onChange={(e) => setPesosIndividuais(prev => ({ ...prev, [loteItem.id]: e.target.value }))}
                        placeholder={String(loteItem.peso_medio_kg || 0)}
                        className={LL_CTL}
                      />
                    </FL>
                  </LancLoteItem>
                );
              })}
            </LancLoteItens>
          ) : modoPesagem === "todos" ? (
            <>
              <FL label="Peso para Todos os Animais (kg)" required>
                <Input
                  type="number"
                  step="0.1"
                  value={pesoGeral}
                  onChange={(e) => setPesoGeral(e.target.value)}
                  className="h-7 text-xs font-semibold border-0 shadow-none focus-visible:ring-0 bg-transparent"
                  placeholder="0"
                />
              </FL>
              <div className="mk-ll__item-rodape">Este peso será aplicado a todas as {categoriasDisponiveis.length} categoria(s)</div>
            </>
          ) : (
            <LancLoteItens>
              {formData.pesagens.map((pesagem, index) => {
                const infoCategoria = lotesPorCategoria[pesagem.categoria];
                const configIcone = iconesConfig.find(ic => 
                  ic.tipo_entidade === 'Lote' && 
                  ic.categoria?.toUpperCase() === pesagem.categoria?.toUpperCase()
                );
                const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

                return (
                  <LancLoteItem key={index} titulo={`Categoria ${index + 1}`} icone={iconeUrl} onRemover={() => removerCategoria(index)} rotuloRemover="Remover categoria">

                    <FL label="Categoria" className="mk-ll__cheio">
                    <Select
                      value={pesagem.categoria}
                      onValueChange={(v) => handlePesagemChange(index, 'categoria', v)}
                    >
                      <SelectTrigger className={LL_CTL}>
                        <SelectValue>
                          {infoCategoria?.totalCabecas || 0} cb - {pesagem.categoria}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {categoriasDisponiveis.map(cat => {
                          const info = lotesPorCategoria[cat];
                          return (
                            <SelectItem key={cat} value={cat} className="text-xs">
                              {info.totalCabecas} cb - {cat}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    </FL>

                    <FL label="Peso Atual (kg)" required>
                      <Input
                        type="number"
                        step="0.1"
                        value={pesagem.peso}
                        onChange={(e) => handlePesagemChange(index, 'peso', e.target.value)}
                        placeholder="0"
                        className={LL_CTL}
                        required
                      />
                    </FL>
                  </LancLoteItem>
                );
              })}

              <LancLoteAdicionar onClick={adicionarCategoria} />
            </LancLoteItens>
          )}

          <FL label="Observações Gerais">
            <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className={LL_CTL} rows={2} />
          </FL>
          <LancLoteRodape onCancelar={onCancel} cancelarDesabilitado={saving} textoAcao="Registrar Pesagens" textoEnviando="Salvando..." enviando={saving} />
        </LancLoteForm>
  );
}