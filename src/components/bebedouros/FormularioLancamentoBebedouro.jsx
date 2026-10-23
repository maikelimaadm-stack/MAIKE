import React, { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { criarHistorico } from "@/services/bebedouroDataService";
import { getCurrentUser } from "@/services/sessionService";
import { BEBEDOURO_HISTORICO_STATUS, BEBEDOURO_HISTORICO_TIPOS } from "@/services/bebedouroService";
import { toast } from "sonner";

import CadastroFormField, {
  CADASTRO_INPUT_CLS,
  CADASTRO_SELECT_CLS,
  CADASTRO_TEXTAREA_CLS,
} from "@/components/cadastro/base1/CadastroFormField";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";

const FL = ({ label, required = false, error = false, children }) => (
  <CadastroFormField label={label} required={required} error={error}>
    {children}
  </CadastroFormField>
);
const INPUT_CLS = CADASTRO_INPUT_CLS;
const SELECT_CLS = CADASTRO_SELECT_CLS;
const TEXTAREA_CLS = CADASTRO_TEXTAREA_CLS;

const AVALIACAO_AGUA_TYPES = new Set(["Análise da água", "Contaminação", "Inspeção", "Tratamento da água"]);
const PRODUTO_TYPES = new Set(["Tratamento da água", "Aplicação de produto", "Limpeza", "Abastecimento"]);
const MANUTENCAO_TYPES = new Set(["Manutenção", "Vazamento", "Troca de boia", "Troca de encanamento"]);

export default function FormularioLancamentoBebedouro({ bebedouro, onSaved, onCancel }) {
  const empresaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const hoje = new Date().toISOString().split("T")[0];
  const agora = new Date().toTimeString().slice(0, 5);
  const [form, setForm] = useState({
    data_lancamento: hoje,
    hora_lancamento: agora,
    tipo_lancamento: "Inspeção",
    status: "Concluído",
    descricao: "",
    produto_utilizado: "",
    quantidade_utilizada: "",
    custo: "",
    escore_agua: "",
    qualidade_agua: "Boa"
  });

  const showAvaliacaoAgua = useMemo(() => AVALIACAO_AGUA_TYPES.has(form.tipo_lancamento), [form.tipo_lancamento]);
  const showProduto = useMemo(() => PRODUTO_TYPES.has(form.tipo_lancamento), [form.tipo_lancamento]);
  const showCusto = useMemo(() => PRODUTO_TYPES.has(form.tipo_lancamento) || MANUTENCAO_TYPES.has(form.tipo_lancamento) || form.tipo_lancamento === "Outro", [form.tipo_lancamento]);

  const mutation = useMutation({
    mutationFn: async () => {
      const user = await getCurrentUser();
      const payload = {
        empresa_id: empresaId,
        bebedouro_id: bebedouro.id,
        bebedouro_nome: bebedouro.nome,
        data_lancamento: form.data_lancamento,
        hora_lancamento: form.hora_lancamento,
        responsavel: user?.full_name || user?.email || "",
        tipo_lancamento: form.tipo_lancamento,
        descricao: form.descricao?.toUpperCase(),
        status: form.status
      };

      if (showProduto) {
        payload.produto_utilizado = form.produto_utilizado?.toUpperCase();
        payload.quantidade_utilizada = form.quantidade_utilizada ? Number(form.quantidade_utilizada) : null;
      }

      if (showCusto) {
        payload.custo = form.custo ? Number(form.custo) : null;
      }

      if (showAvaliacaoAgua) {
        payload.escore_agua = form.escore_agua ? Number(form.escore_agua) : null;
        payload.qualidade_agua = form.qualidade_agua;
      }

      return criarHistorico(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebedouro-historico", empresaId, bebedouro.id] });
      queryClient.invalidateQueries({ queryKey: ["bebedouro-historico-all", empresaId] });
      toast.success("Lançamento registrado.");
      onSaved?.();
    }
  });

  return (
    <CadastroFormShell title="Lançamento do bebedouro" subtitle={bebedouro.nome} embedded>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-0.5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
          <FL label="Data" required>
            <Input type="date" value={form.data_lancamento} onChange={(e) => setForm({ ...form, data_lancamento: e.target.value })} className={INPUT_CLS} required />
          </FL>
          <FL label="Hora">
            <Input type="time" value={form.hora_lancamento} onChange={(e) => setForm({ ...form, hora_lancamento: e.target.value })} className={INPUT_CLS} />
          </FL>
          <FL label="Tipo" required>
            <Select value={form.tipo_lancamento} onValueChange={(value) => setForm({ ...form, tipo_lancamento: value })}>
              <SelectTrigger className={SELECT_CLS}><SelectValue /></SelectTrigger>
              <SelectContent>{BEBEDOURO_HISTORICO_TIPOS.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}</SelectContent>
            </Select>
          </FL>
          <FL label="Status" required>
            <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}>
              <SelectTrigger className={SELECT_CLS}><SelectValue /></SelectTrigger>
              <SelectContent>{BEBEDOURO_HISTORICO_STATUS.map((status) => <SelectItem key={status} value={status} className="text-xs">{status}</SelectItem>)}</SelectContent>
            </Select>
          </FL>
        </div>

        {showProduto ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
            <FL label="Produto utilizado">
              <Input value={form.produto_utilizado} onChange={(e) => setForm({ ...form, produto_utilizado: e.target.value })} className={`${INPUT_CLS} uppercase`} />
            </FL>
            <FL label="Quantidade">
              <Input type="number" step="0.01" value={form.quantidade_utilizada} onChange={(e) => setForm({ ...form, quantidade_utilizada: e.target.value })} className={INPUT_CLS} />
            </FL>
          </div>
        ) : null}

        {showAvaliacaoAgua ? (
          <div className="rounded-md border border-[var(--mg-divider)] bg-slate-50/80 p-2 space-y-1">
            <div className="text-[11px] font-semibold text-slate-800 px-1">Qualidade da água</div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
              <FL label="Escore">
                <Input type="number" step="0.1" value={form.escore_agua} onChange={(e) => setForm({ ...form, escore_agua: e.target.value })} className={INPUT_CLS} />
              </FL>
              <FL label="Qualidade">
                <Select value={form.qualidade_agua} onValueChange={(value) => setForm({ ...form, qualidade_agua: value })}>
                  <SelectTrigger className={SELECT_CLS}><SelectValue /></SelectTrigger>
                  <SelectContent>{["Boa", "Média", "Ruim"].map((item) => <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>)}</SelectContent>
                </Select>
              </FL>
            </div>
          </div>
        ) : null}

        {showCusto ? (
          <FL label="Custo">
            <Input type="number" step="0.01" value={form.custo} onChange={(e) => setForm({ ...form, custo: e.target.value })} className={INPUT_CLS} />
          </FL>
        ) : null}

        <FL label="Observação">
          <Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={3} className={`${TEXTAREA_CLS} uppercase`} />
        </FL>

        <CadastroFormActions
          onCancel={onCancel}
          submitLabel="Salvar lançamento"
          isSubmitting={mutation.isPending}
        />
      </form>
    </CadastroFormShell>
  );
}
