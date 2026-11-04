import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { listarIconesDaEmpresa } from "@/services/mapaService";
import { getTodayLocalDate } from "../utils/pecuariaUtils";
import { LancLoteForm, LancLoteItens, LancLoteItem, LancLoteAdicionar, LancLoteRodape, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import LancField from "@/components/cadastro/base1/LancField";
import { ehLoteDeMatriz } from "@/domain/lotes/manejoRebanho";

/** Campo flutuante Base1 (rótulo dentro) — D-PROD-88. */
const FL = LancField;

export default function FormularioNascimento({ lote, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const lotesArray = Array.isArray(lote) ? lote : [lote];
  
  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const icones = await listarIconesDaEmpresa(empresaSelecionadaId);
      return icones.filter((i) => i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  // PR168-R2 (D-PROD-101): mesma política do servidor — só lotes FÊMEA de
  // categoria oficial de matriz (Vaca 25-36, Vaca +36, Novilha 13-24).
  const lotesPorCategoria = lotesArray.reduce((acc, l) => {
    const cat = l.categoria || 'SEM CATEGORIA';
    if (ehLoteDeMatriz(l)) {
      if (!acc[cat]) {
        acc[cat] = { categoria: cat, lotes: [], totalCabecas: 0 };
      }
      acc[cat].lotes.push(l);
      acc[cat].totalCabecas += l.quantidade_cabecas || 0;
    }
    return acc;
  }, {});

  const categoriasDisponiveis = Object.keys(lotesPorCategoria).sort();

  const [formData, setFormData] = useState({
    data_nascimento: getTodayLocalDate(),
    nascimentos: [],
    observacoes: ""
  });

  const [saving, setSaving] = useState(false);

  /**
   * R2B-P1 (D-PROD-101): UMA confirmação = UM envio com todas as linhas (o
   * servidor grava tudo ou nada). Antes: `forEach` sem await disparava uma
   * gravação solta por linha. Duplo clique bloqueado enquanto envia.
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const preenchidas = formData.nascimentos.filter(n => n.quantidade !== "" || n.sexo);
    const invalida = preenchidas.find(n => !n.sexo || !n.categoria_mae || !(Number(n.quantidade) > 0) || !Number.isInteger(Number(n.quantidade)));
    if (preenchidas.length === 0 || invalida) {
      alert("Preencha cada linha com categoria da mãe, sexo e quantidade inteira maior que zero");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        data_nascimento: formData.data_nascimento,
        observacoes: formData.observacoes,
        linhas: preenchidas.map(n => ({
          categoria_mae: n.categoria_mae,
          quantidade: parseInt(n.quantidade, 10),
          sexo: n.sexo,
          peso_medio: n.peso_medio ? parseFloat(n.peso_medio) : null,
        })),
      });
    } finally {
      setSaving(false);
    }
  };

  const adicionarCategoria = () => {
    const primeiraCategoria = categoriasDisponiveis[0];
    setFormData(prev => ({
      ...prev,
      nascimentos: [...prev.nascimentos, {
        categoria_mae: primeiraCategoria,
        quantidade: "",
        sexo: "",
        peso_medio: ""
      }]
    }));
  };

  const removerCategoria = (index) => {
    setFormData(prev => ({
      ...prev,
      nascimentos: prev.nascimentos.filter((_, i) => i !== index)
    }));
  };

  const handleNascimentoChange = (index, field, value) => {
    const novosNascimentos = [...formData.nascimentos];
    novosNascimentos[index] = { ...novosNascimentos[index], [field]: value };
    setFormData({ ...formData, nascimentos: novosNascimentos });
  };


  return (
    <LancLoteForm onSubmit={handleSubmit}>
          <FL label="Data do Nascimento" required>
            <Input type="date" value={formData.data_nascimento} onChange={(e) => setFormData({ ...formData, data_nascimento: e.target.value })} className={LL_CTL} required />
          </FL>

          <LancLoteItens>
            {formData.nascimentos.map((nascimento, index) => {
              const infoCategoria = lotesPorCategoria[nascimento.categoria_mae];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === nascimento.categoria_mae?.toUpperCase()
              );
              const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

              return (
                <LancLoteItem key={index} titulo={`Categoria ${index + 1}`} icone={iconeUrl} onRemover={() => removerCategoria(index)} rotuloRemover="Remover categoria">

                  <FL label="Categoria Mãe">
                    <Select
                      value={nascimento.categoria_mae}
                      onValueChange={(v) => handleNascimentoChange(index, 'categoria_mae', v)}
                    >
                      <SelectTrigger className={LL_CTL}>
                        <SelectValue>
                          {infoCategoria?.totalCabecas || 0} cb - {nascimento.categoria_mae}
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
                        value={nascimento.quantidade}
                        onChange={(e) => handleNascimentoChange(index, 'quantidade', e.target.value)}
                        className={LL_CTL}
                        placeholder="0"
                        required
                      />
                    </FL>
                    <FL label="Sexo" required>
                      <Select
                        value={nascimento.sexo}
                        onValueChange={(v) => handleNascimentoChange(index, 'sexo', v)}
                      >
                        <SelectTrigger className={LL_CTL}>
                          <SelectValue placeholder="Selecione o sexo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                          <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                        </SelectContent>
                      </Select>
                    </FL>

                    <FL label="Peso Médio (kg)">
                      <Input
                        type="number"
                        step="0.1"
                        value={nascimento.peso_medio}
                        onChange={(e) => handleNascimentoChange(index, 'peso_medio', e.target.value)}
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

          <FL label="Observações Gerais">
            <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className={LL_CTL} rows={2} />
          </FL>
          <LancLoteRodape onCancelar={onCancel} cancelarDesabilitado={saving} textoAcao="Registrar Nascimentos" textoEnviando="Salvando..." enviando={saving} />
        </LancLoteForm>
  );
}