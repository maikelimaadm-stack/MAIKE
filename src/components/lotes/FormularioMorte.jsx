import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { listarIconesDaEmpresa } from "@/services/mapaService";
import { getTodayLocalDate } from "../utils/pecuariaUtils";
import B1Select from "@/components/cadastro/base1/B1Select";
import LancField from "@/components/cadastro/base1/LancField";
import { LancLoteForm, LancLoteItens, LancLoteItem, LancLoteAdicionar, LancLoteRodape, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import { notifyWarning } from "@/lib/maikeNotify";

/** Campo flutuante Base1 (rótulo dentro) — D-PROD-88. */
const FL = LancField;

/**
 * R2D-P1 (D-PROD-105): UMA confirmação = UM envio com todas as categorias
 * (`linhas`); o servidor escolhe os lotes e baixa tudo numa transação.
 */
export default function FormularioMorte({ lote, onSubmit, onCancel, enviando = false }) {
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
    data_ocorrencia: getTodayLocalDate(),
    mortes: [],
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const mortesValidas = formData.mortes.filter(m => parseInt(m.quantidade) > 0 && m.causa_morte);
    if (mortesValidas.length === 0) {
      notifyWarning("Atenção", "Preencha pelo menos uma morte com quantidade e causa");
      return;
    }
    
    if (enviando) return;
    onSubmit({
      data_ocorrencia: formData.data_ocorrencia,
      observacoes: formData.observacoes,
      linhas: mortesValidas.map((morte) => ({
        categoria: morte.categoria,
        quantidade: parseInt(morte.quantidade),
        causa_morte: morte.causa_morte,
      })),
    });
  };

  const adicionarCategoria = () => {
    const primeiraCategoria = categoriasDisponiveis[0];
    setFormData(prev => ({
      ...prev,
      mortes: [...prev.mortes, {
        categoria: primeiraCategoria,
        quantidade: "",
        causa_morte: ""
      }]
    }));
  };

  const removerCategoria = (index) => {
    setFormData(prev => ({
      ...prev,
      mortes: prev.mortes.filter((_, i) => i !== index)
    }));
  };

  const handleMorteChange = (index, field, value) => {
    const novasMortes = [...formData.mortes];
    novasMortes[index] = { ...novasMortes[index], [field]: value };
    setFormData({ ...formData, mortes: novasMortes });
  };


  return (
    <LancLoteForm onSubmit={handleSubmit}>
      <FL label="Data da Ocorrência" required>
        <Input type="date" value={formData.data_ocorrencia} onChange={(e) => setFormData({ ...formData, data_ocorrencia: e.target.value })} className={LL_CTL} required />
      </FL>

      <LancLoteItens>
        {formData.mortes.map((morte, index) => {
          const infoCategoria = lotesPorCategoria[morte.categoria];
          const configIcone = iconesConfig.find(ic =>
            ic.tipo_entidade === 'Lote' &&
            ic.categoria?.toUpperCase() === morte.categoria?.toUpperCase()
          );
          const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

          return (
            <LancLoteItem key={index} titulo={`Categoria ${index + 1}`} icone={iconeUrl} onRemover={() => removerCategoria(index)} rotuloRemover="Remover categoria">
              <FL label="Categoria" className="mk-ll__cheio">
                <B1Select value={(morte.categoria) ?? ""} onChange={(e) => { const v = e.target.value; handleMorteChange(index, 'categoria', v); }} className={LL_CTL}>
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

              <FL label="Quantidade" required>
                <Input
                  type="number"
                  min="0"
                  max={infoCategoria.totalCabecas}
                  value={morte.quantidade}
                  onChange={(e) => handleMorteChange(index, 'quantidade', e.target.value)}
                  className={LL_CTL}
                  placeholder="0"
                  required
                />
              </FL>

              <FL label="Causa da Morte" required>
                <B1Select value={(morte.causa_morte) ?? ""} onChange={(e) => { const v = e.target.value; handleMorteChange(index, 'causa_morte', v); }} className={LL_CTL}>
                    <option value="Doença">Doença</option>
                    <option value="Acidente">Acidente</option>
                    <option value="Predador">Predador</option>
                    <option value="Natural">Natural</option>
                    <option value="Desconhecida">Desconhecida</option>
                    <option value="Outra">Outra</option>
                </B1Select>
              </FL>
            </LancLoteItem>
          );
        })}

        <LancLoteAdicionar onClick={adicionarCategoria} />
      </LancLoteItens>

      <FL label="Observações Gerais">
        <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className={LL_CTL} rows={2} />
      </FL>
      <LancLoteRodape onCancelar={onCancel} textoAcao="Registrar Mortes" enviando={enviando} textoEnviando="Registrando…" />
    </LancLoteForm>
  );
}
