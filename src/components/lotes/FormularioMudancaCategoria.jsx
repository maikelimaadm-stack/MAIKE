import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { listarCategoriasManejoDaEmpresa } from "@/services/categoriaManejoService";
import { figuraDaPosicao, figuraDoGrupo, urlSubiconeLote } from "@/assets/icones/lotes";
import { getTodayLocalDate } from "../utils/pecuariaUtils";
import { LancLoteForm, LancLoteItens, LancLoteItem, LancLoteAdicionar, LancLoteRodape, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import B1Select from "@/components/cadastro/base1/B1Select";
import LancField from "@/components/cadastro/base1/LancField";
import { notifyWarning } from "@/lib/maikeNotify";
import { CATEGORIAS_OFICIAIS, categoriaManejoParaMudanca } from "@/domain/lotes/categoriaOficialDerivada";

/** Campo flutuante Base1 (rótulo dentro) — D-PROD-88. */
const FL = LancField;

/** As 8 categorias oficiais (mesma ordem do servidor) — fonte única em `categoriaOficialDerivada`. */
const CATEGORIAS = CATEGORIAS_OFICIAIS;

/** Largura do ícone no cabeçalho do item (`.mk-ll__item-ic`): o subícone é montado nela. */
const SUBICONE_PX = 22;

/**
 * `categoriasManejo` (cache do mapa, ativas e inativas): o subícone de cada linha vem do
 * código pela Categoria de Manejo das posições (D-PROD-191). A categoria de manejo NOVA
 * sai das ativas lidas do servidor (`categoriasManejoAtivas`), como antes.
 */
export default function FormularioMudancaCategoria({ lote, onSubmit, onCancel, categoriasManejo = [] }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: categoriasManejoAtivas = [] } = useQuery({
    queryKey: ['categorias-manejo-mudanca', empresaSelecionadaId],
    queryFn: async () => {
      const categorias = await listarCategoriasManejoDaEmpresa(empresaSelecionadaId);
      return categorias.filter((c) => c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });
  
  const lotesArray = Array.isArray(lote) ? lote : [lote];

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
      notifyWarning("Atenção", "Preencha pelo menos uma mudança com quantidade e categoria nova");
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
      // R2B-P1: a categoria de manejo acompanha a escolhida (sem herdar a da categoria antiga).
      // MAIKE-CATEGORIA-MANEJO-ENXUGAR: casa pela oficial DERIVADA de sexo + faixa de idade (mesma regra do
      // servidor); o nome é livre e não é a chave. Escolha determinística (ver categoriaManejoParaMudanca).
      const catManejo = categoriaManejoParaMudanca(categoriasManejoAtivas, value);
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
              // D-PROD-191: o animal das posições da categoria atual (sexo + faixa da Categoria de
              // Manejo; reserva: o texto da categoria oficial), na cor do sexo. Nunca misto.
              const figura = figuraDoGrupo(infoCategoria?.lotes, categoriasManejo) ?? figuraDaPosicao({ categoria: mudanca.categoria_atual }, categoriasManejo);
              const iconeUrl = urlSubiconeLote(figura?.figura, SUBICONE_PX);

              return (
                <LancLoteItem key={index} titulo={`Categoria ${index + 1}`} icone={iconeUrl} onRemover={() => removerCategoria(index)} rotuloRemover="Remover categoria">

                  <FL label="Categoria Atual">
                    <B1Select value={(mudanca.categoria_atual) ?? ""} onChange={(e) => { const v = e.target.value; handleMudancaChange(index, 'categoria_atual', v); }} className={LL_CTL}>
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
                        value={mudanca.quantidade}
                        onChange={(e) => handleMudancaChange(index, 'quantidade', e.target.value)}
                        className={LL_CTL}
                        placeholder="0"
                        required
                      />
                    </FL>
                    <FL label="Nova Categoria" required>
                      <B1Select value={(mudanca.categoria_nova) ?? ""} onChange={(e) => { const v = e.target.value; handleMudancaChange(index, 'categoria_nova', v); }} className={LL_CTL}>
                          {CATEGORIAS.filter(c => c !== mudanca.categoria_atual).map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                      </B1Select>
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