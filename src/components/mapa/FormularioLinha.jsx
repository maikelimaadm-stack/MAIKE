import React, { useEffect, useState } from "react";
import { listarTodasLinhas, criarLinha, atualizarLinha } from "@/services/mapaService";
import { useMutation } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/cadastro/base1/SelectDoMotor";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import CapturaGPSPoligono from "./CapturaGPSPoligono";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { comprimentoMetros, toPersistedCoords, parseVertices } from "@/lib/geografia";
import LancField from "@/components/cadastro/base1/LancField";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";

/** Campo flutuante Base1 (rótulo dentro) — D-PROD-88. */
const FL = LancField;

const TIPOS_LINHA = ["Estrada", "Cerca", "Cerca Elétrica", "Rio", "Córrego", "Outro"];
const CORES_DISPONIVEIS = ["#f59e0b", "#ef4444", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"];

export const FORMULARIO_LINHA_ID = "formulario-linha-b1";

/**
 * Detalhes da linha. `layout="registro"` (D-PROD-174): o registro do Cadastro de Linhas — sem cabeçalho e
 * sem botões próprios (quem salva é a barra do motor, pelo form `formId`), campos travados em `readOnly`.
 */
export default function FormularioLinha({
  coordenadas,
  onSave = (gravada) => void gravada,
  onCancel = () => {},
  usarGPS = false,
  item = null,
  layout = "painel",
  formId = FORMULARIO_LINHA_ID,
  readOnly = false,
  onSalvandoChange = null,
}) {
  const registro = layout === "registro";
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const [mostrarCapturaGPS, setMostrarCapturaGPS] = useState(usarGPS);
  const [coordenadasGPS, setCoordenadasGPS] = useState(coordenadas);
  const [invalidFields, setInvalidFields] = useState([]);
  const [formData, setFormData] = useState({
    nome: item?.nome || "",
    sigla: item?.sigla || "",
    tipo: item?.tipo || "Estrada",
    cor: item?.coordenadas?.cor || CORES_DISPONIVEIS[0],
    observacoes: item?.observacoes || "",
  });

  const getFieldClassName = (field, baseClass = "") => `${baseClass} ${invalidFields.includes(field) ? 'border-red-500 bg-red-50 focus-visible:ring-red-500' : ''}`.trim();
  const handleChange = (field, value) => { setFormData((prev) => ({ ...prev, [field]: value })); setInvalidFields((prev) => prev.filter((item) => item !== field)); };

  const createLinhaMutation = useMutation({
    mutationFn: async (data) => {
      if (item) {
        // Traçado novo (ou o mesmo): o comprimento sai dele, como na criação;
        // sem isso a coluna "Comprimento" continuava com o valor antigo.
        const vertices = parseVertices(coordenadasGPS || coordenadas || item.coordenadas?.coords);
        return atualizarLinha(item.id, {
          ...data,
          ...(vertices.length >= 2 ? { comprimento_metros: comprimentoMetros(vertices) } : {}),
          coordenadas: {
            coords: toPersistedCoords(coordenadasGPS || coordenadas || item.coordenadas?.coords),
            cor: data.cor,
          },
        });
      }

      // Numeração calculada sobre todas as linhas, como antes da P1.2.
      const allLinhas = await listarTodasLinhas();
      const maxNum = allLinhas.reduce((max, l) => Math.max(max, parseInt(l.numero_linha) || 0), 0);
      const coords = parseVertices(coordenadasGPS || coordenadas);
      const metros = coords.length >= 2 ? comprimentoMetros(coords) : 0;

      return criarLinha({
        nome: data.nome,
        sigla: data.sigla,
        tipo: data.tipo,
        observacoes: data.observacoes,
        empresa_id: empresaSelecionadaId,
        numero_linha: String(maxNum + 1),
        ativo: true,
        comprimento_metros: metros,
        coordenadas: {
          coords: toPersistedCoords(coords),
          cor: data.cor,
        },
      });
    },
    onSuccess: (gravada) => { toast.success(item ? 'Linha atualizada!' : 'Linha cadastrada!'); onSave(gravada); },
    onError: () => { toast.error(item ? 'Erro ao atualizar linha' : 'Erro ao cadastrar linha'); },
  });

  useEffect(() => {
    onSalvandoChange?.(createLinhaMutation.isPending);
  }, [createLinhaMutation.isPending, onSalvandoChange]);

  const handleCapturaGPS = (pontos) => { setCoordenadasGPS(pontos); setMostrarCapturaGPS(false); toast.success(`${pontos.length} pontos capturados via GPS!`); };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    if (!formData.nome?.trim()) { setInvalidFields(['nome']); toast.error('Preencha o nome da linha.'); return; }
    createLinhaMutation.mutate({ nome: formData.nome.toUpperCase(), sigla: formData.sigla.toUpperCase(), tipo: formData.tipo, cor: formData.cor, observacoes: formData.observacoes?.toUpperCase() });
  };

  if (mostrarCapturaGPS) {
    return <CapturaGPSPoligono tipo="linha" onSalvar={handleCapturaGPS} onCancelar={() => { setMostrarCapturaGPS(false); if (usarGPS) onCancel(); }} />;
  }

  return (
    <div className={registro ? "" : "mt-4"}>
      <div className={registro ? "" : "rounded-xl border bg-card text-card-foreground shadow-sm border-slate-300"}>
        {registro ? null : (
        <div className="flex flex-col space-y-1.5 p-6 bg-[#FAFCFE] border-b py-1 px-1">
          <div className="text-sm font-semibold text-slate-900">{item ? 'Editar Linha' : 'Nova Linha'}</div>
        </div>
        )}
        <div className={registro ? "" : "p-1"}>
          <form id={formId} onSubmit={handleSubmit} className="space-y-0.5" data-testid="b1-form-linha" data-densidade={registro ? DENSIDADE_BASE1 : undefined}>
          <fieldset disabled={readOnly} className="contents">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
        <div className="lg:col-span-2"><FL label="Nome da Linha" required error={invalidFields.includes('nome')}><Input value={formData.nome} onChange={(e) => handleChange('nome', e.target.value)} placeholder="NOME DA LINHA" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: 'uppercase' }} /></FL></div>
        <FL label="Sigla"><Input value={formData.sigla} onChange={(e) => handleChange('sigla', e.target.value)} placeholder="SIGLA" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" maxLength={10} /></FL>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
        <FL label="Tipo" required><Select value={formData.tipo} onValueChange={(v) => handleChange('tipo', v)}><SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger><SelectContent>{TIPOS_LINHA.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}</SelectContent></Select></FL>
      </div>
      <div className="border border-slate-200 bg-[#FAFCFE]/50 rounded-lg p-3 space-y-1"><span className="font-semibold text-xs text-slate-700">Cor da Linha</span><div className="grid grid-cols-5 gap-2">{CORES_DISPONIVEIS.map((cor) => <button key={cor} type="button" onClick={() => handleChange('cor', cor)} className={`w-full h-7 rounded border ${formData.cor === cor ? 'ring-2 ring-slate-900' : ''}`} style={{ backgroundColor: cor }} />)}</div></div>
      <FL label="Observações"><Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" rows={2} /></FL>
      </fieldset>
      {registro ? null : (
      <div className="cadastro-b1 flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
        <button type="button" className="tb-btn tb-btn-gray" onClick={onCancel}>
          <X className="h-4 w-4" aria-hidden />
          Cancelar
        </button>
        <button type="submit" className="tb-btn tb-btn-green" disabled={createLinhaMutation.isPending}>
          <Check className="h-4 w-4" aria-hidden />
          {item ? 'Salvar alterações' : 'Salvar linha'}
        </button>
      </div>
      )}
          </form>
        </div>
      </div>
    </div>
  );
}