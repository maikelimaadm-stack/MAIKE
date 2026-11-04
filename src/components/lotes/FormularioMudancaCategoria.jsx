import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { listarIconesDaEmpresa } from "@/services/mapaService";
import { listarCategoriasManejoDaEmpresa } from "@/services/categoriaManejoService";
import { getTodayLocalDate } from "../utils/pecuariaUtils";
import { LancLoteForm, LancLoteItens, LancLoteItem, LancLoteAdicionar, LancLoteRodape, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import LancField from "@/components/cadastro/base1/LancField";

/** Campo flutuante Base1 (rótulo dentro) — D-PROD-88. */
const FL = LancField;

const CATEGORIAS = [
  "Bezerro 0 a 12 meses",
  "Bezerra 0 a 12 meses",
  "Garrote 13 a 24 meses",
  "Novilha 13 a 24 meses",
  "Boi 25 a 36 meses",
  "Vaca 25 a 36 meses",
  "Touro + 36 meses",
  "Vaca + 36 meses"
];

export default function FormularioMudancaCategoria({ lote, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: categoriasManejo = [] } = useQuery({
    queryKey: ['categorias-manejo-mudanca', empresaSelecionadaId],
    queryFn: async () => {
      const categorias = await listarCategoriasManejoDaEmpresa(empresaSelecionadaId);
      return categorias.filter((c) => c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });
  
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
      acc[cat] = {
        categoria: cat,
        lotes: [],
        totalCabecas: 0
      };
    }
    acc[cat].lotes.push(l);
    acc[cat].totalCabecas += l.quantidade_cabecas || 0;
    return acc;
  }, {});

  const categoriasDisponiveis = Object.keys(lotesPorCategoria).sort();

  const [formData, setFormData] = useState({
    data_mudanca: getTodayLocalDate(),
    mudancas: [],
    observacoes: ""
  });

  const [saving, setSaving] = useState(false);

  /** R2B-P1 (D-PROD-101): uma confirmação = um envio (tudo ou nada no servidor); duplo clique bloqueado. */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;

    const mudancasValidas = formData.mudancas.filter(m => m.categoria_nova && parseInt(m.quantidade) > 0);
    if (mudancasValidas.length === 0) {
      alert("Preencha pelo menos uma mudança com quantidade e categoria nova");
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        ...formData,
        mudancas: mudancasValidas.map(m => ({
          ...m,
          quantidade: parseInt(m.quantidade),
          peso_medio: m.peso_medio ? parseFloat(m.peso_medio) : null
        }))
      });
    } finally {
      setSaving(false);
    }
  };

  const adicionarCategoria = () => {
    const primeiraCategoria = categoriasDisponiveis[0];
    setFormData(prev => ({
      ...prev,
      mudancas: [...prev.mudancas, {
        categoria_atual: primeiraCategoria,
        quantidade: "",
        categoria_nova: "",
        peso_medio: ""
      }]
    }));
  };

  const removerCategoria = (index) => {
    setFormData(prev => ({
      ...prev,
      mudancas: prev.mudancas.filter((_, i) => i !== index)
    }));
  };

  const handleMudancaChange = (index, field, value) => {
    const novasMudancas = [...formData.mudancas];
    novasMudancas[index] = {
      ...novasMudancas[index],
      [field]: value
    };
    // Se mudou a nova categoria, buscar o sexo da categoria de manejo correspondente
    if (field === 'categoria_nova') {
      // R2B-P1: a categoria de manejo acompanha a oficial escolhida (sem herdar a da categoria antiga).
      const catManejo = categoriasManejo.find(c => c.categoria_oficial === value);
      novasMudancas[index].sexo_novo = catManejo?.sexo || undefined;
      novasMudancas[index].categoria_manejo_id_novo = catManejo?.id || undefined;
      novasMudancas[index].categoria_manejo_nome_novo = catManejo?.nome || undefined;
    }
    setFormData({ ...formData, mudancas: novasMudancas });
  };

  return (
    <LancLoteForm onSubmit={handleSubmit}>
          <FL label="Data da Mudança" required>
            <Input type="date" value={formData.data_mudanca} onChange={(e) => setFormData({ ...formData, data_mudanca: e.target.value })} className={LL_CTL} required />
          </FL>

          <LancLoteItens>
            {formData.mudancas.map((mudanca, index) => {
              const infoCategoria = lotesPorCategoria[mudanca.categoria_atual];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === mudanca.categoria_atual?.toUpperCase()
              );
              const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

              return (
                <LancLoteItem key={index} titulo={`Categoria ${index + 1}`} icone={iconeUrl} onRemover={() => removerCategoria(index)} rotuloRemover="Remover categoria">

                  <FL label="Categoria Atual">
                    <Select
                      value={mudanca.categoria_atual}
                      onValueChange={(v) => handleMudancaChange(index, 'categoria_atual', v)}
                    >
                      <SelectTrigger className={LL_CTL}>
                        <SelectValue>
                          {infoCategoria?.totalCabecas || 0} cb - {mudanca.categoria_atual}
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

                  <>
                    <FL label="Quantidade" required>
                      <Input
                        type="number"
                        min="0"
                        max={infoCategoria.totalCabecas}
                        value={mudanca.quantidade}
                        onChange={(e) => handleMudancaChange(index, 'quantidade', e.target.value)}
                        className={LL_CTL}
                        placeholder="0"
                        required
                      />
                    </FL>
                    <FL label="Nova Categoria" required>
                      <Select
                        value={mudanca.categoria_nova}
                        onValueChange={(v) => handleMudancaChange(index, 'categoria_nova', v)}
                      >
                        <SelectTrigger className={LL_CTL}>
                          <SelectValue placeholder="Selecione a nova categoria" />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIAS.filter(c => c !== mudanca.categoria_atual).map(cat => (
                            <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FL>

                    {mudanca.sexo_novo && (
                      <div className="text-xs text-slate-500">
                        Sexo da nova categoria: <span className="font-semibold text-slate-700">{mudanca.sexo_novo}</span>
                      </div>
                    )}

                    <FL label="Peso Médio (kg)">
                      <Input
                        type="number"
                        step="0.1"
                        value={mudanca.peso_medio || ""}
                        onChange={(e) => handleMudancaChange(index, 'peso_medio', e.target.value)}
                        className={LL_CTL}
                        placeholder="0"
                      />
                    </FL>
                  </>
                </LancLoteItem>
              );
            })}

            <LancLoteAdicionar onClick={adicionarCategoria} />
          </LancLoteItens>

          <LancLoteRodape onCancelar={onCancel} cancelarDesabilitado={saving} textoAcao="Confirmar Mudanças" textoEnviando="Salvando..." enviando={saving} />
        </LancLoteForm>
  );
}