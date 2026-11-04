import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { listarIconesDaEmpresa } from "@/services/mapaService";
import { getTodayLocalDate } from "../utils/pecuariaUtils";
import { LancLoteForm, LancLoteItens, LancLoteItem, LancLoteAdicionar, LancLoteRodape, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import B1Select from "@/components/cadastro/base1/B1Select";
import LancField from "@/components/cadastro/base1/LancField";
import { notifyWarning } from "@/lib/maikeNotify";

/** Campo flutuante Base1 (rótulo dentro) — D-PROD-88. */
const FL = LancField;

/**
 * R2D-P1 (D-PROD-105): UMA confirmação = UM envio com todas as categorias
 * (`linhas`); pesos são totais da linha. O servidor escolhe os lotes.
 */
export default function FormularioAbate({ lote, onSubmit, onCancel, enviando = false }) {
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

  const lotesPorCategoria = lotesArray.reduce((acc, l) => {
    const cat = l.categoria || 'SEM CATEGORIA';
    if (!acc[cat]) {
      acc[cat] = { categoria: cat, lotes: [], totalCabecas: 0 };
    }
    acc[cat].lotes.push(l);
    acc[cat].totalCabecas += l.quantidade_cabecas || 0;
    return acc;
  }, {});

  const categoriasDisponiveis = Object.keys(lotesPorCategoria).sort();

  const [formData, setFormData] = useState({
    data_abate: getTodayLocalDate(),
    abates: [],
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const abatesValidos = formData.abates.filter(a => parseInt(a.quantidade) > 0);
    if (abatesValidos.length === 0) {
      notifyWarning("Atenção", "Preencha pelo menos um abate com quantidade");
      return;
    }
    
    if (enviando) return;
    onSubmit({
      data_abate: formData.data_abate,
      observacoes: formData.observacoes,
      linhas: abatesValidos.map((abate) => ({
        categoria: abate.categoria,
        quantidade: parseInt(abate.quantidade),
        peso_vivo_total: abate.peso_vivo_total ? parseFloat(abate.peso_vivo_total) : null,
        peso_carcaca_total: abate.peso_carcaca_total ? parseFloat(abate.peso_carcaca_total) : null,
        destino: abate.destino,
        destino_nome: abate.destino_nome,
      })),
    });
  };

  const adicionarCategoria = () => {
    const primeiraCategoria = categoriasDisponiveis[0];
    setFormData(prev => ({
      ...prev,
      abates: [...prev.abates, {
        categoria: primeiraCategoria,
        quantidade: "",
        peso_vivo_total: "",
        peso_carcaca_total: "",
        destino: ""
      }]
    }));
  };

  const removerCategoria = (index) => {
    setFormData(prev => ({
      ...prev,
      abates: prev.abates.filter((_, i) => i !== index)
    }));
  };

  const handleAbateChange = (index, field, value) => {
    const novosAbates = [...formData.abates];
    novosAbates[index] = { ...novosAbates[index], [field]: value };
    setFormData({ ...formData, abates: novosAbates });
  };


  return (
    <LancLoteForm onSubmit={handleSubmit}>
          <FL label="Data do Abate" required>
            <Input type="date" value={formData.data_abate} onChange={(e) => setFormData({ ...formData, data_abate: e.target.value })} className={LL_CTL} required />
          </FL>

          <LancLoteItens>
            {formData.abates.map((abate, index) => {
              const infoCategoria = lotesPorCategoria[abate.categoria];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === abate.categoria?.toUpperCase()
              );
              const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

              return (
                <LancLoteItem key={index} titulo={`Categoria ${index + 1}`} icone={iconeUrl} onRemover={() => removerCategoria(index)} rotuloRemover="Remover categoria">

                  <FL label="Categoria" className="mk-ll__cheio">
                    <B1Select value={(abate.categoria) ?? ""} onChange={(e) => { const v = e.target.value; handleAbateChange(index, 'categoria', v); }} className={LL_CTL}>
                        {categoriasDisponiveis.map(cat => {
                          const info = lotesPorCategoria[cat];
                          return (
                            <option key={cat} value={cat}>
                              {info.totalCabecas} cb - {cat}
                            </option>
                          );
                        })}
                    </B1Select>
                  </FL>

                  <>
                    <FL label="Quantidade" required>
                      <Input
                        type="number"
                        min="0"
                        max={infoCategoria.totalCabecas}
                        value={abate.quantidade}
                        onChange={(e) => handleAbateChange(index, 'quantidade', e.target.value)}
                        className={LL_CTL}
                        placeholder="0"
                        required
                      />
                    </FL>
                    <FL label="Peso Vivo Total (kg)">
                      <Input
                        type="number"
                        step="0.1"
                        value={abate.peso_vivo_total}
                        onChange={(e) => handleAbateChange(index, 'peso_vivo_total', e.target.value)}
                        className={LL_CTL}
                        placeholder="0"
                      />
                    </FL>
                    <FL label="Peso Carcaça Total (kg)">
                      <Input
                        type="number"
                        step="0.1"
                        value={abate.peso_carcaca_total}
                        onChange={(e) => handleAbateChange(index, 'peso_carcaca_total', e.target.value)}
                        className={LL_CTL}
                        placeholder="0"
                      />
                    </FL>

                    <FL label="Destino">
                      <B1Select value={(abate.destino) ?? ""} onChange={(e) => { const v = e.target.value; handleAbateChange(index, 'destino', v); }} className={LL_CTL}>
                          <option value="Frigorífico">Frigorífico</option>
                          <option value="Açougue">Açougue</option>
                          <option value="Consumo Próprio">Consumo Próprio</option>
                          <option value="Venda Direta">Venda Direta</option>
                          <option value="Outro">Outro</option>
                      </B1Select>
                    </FL>

                    {(abate.destino === "Frigorífico" || abate.destino === "Açougue" || abate.destino === "Venda Direta" || abate.destino === "Outro") && (
                      <FL label={abate.destino === "Frigorífico" ? "Nome do Frigorífico" : "Nome do Cliente"} required>
                        <Input
                          value={abate.destino_nome || ""}
                          onChange={(e) => handleAbateChange(index, 'destino_nome', e.target.value.toUpperCase())}
                          className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                          style={{ textTransform: 'uppercase' }}
                          placeholder={abate.destino === "Frigorífico" ? "NOME DO FRIGORÍFICO" : "NOME DO CLIENTE"}
                          required
                        />
                      </FL>
                    )}
                  </>
                </LancLoteItem>
              );
            })}

            <LancLoteAdicionar onClick={adicionarCategoria} />
          </LancLoteItens>

          <FL label="Observações Gerais">
            <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className={LL_CTL} rows={2} />
          </FL>
          <LancLoteRodape onCancelar={onCancel} textoAcao="Registrar Abates" textoEnviando="Registrando…" enviando={enviando} />
        </LancLoteForm>
  );
}