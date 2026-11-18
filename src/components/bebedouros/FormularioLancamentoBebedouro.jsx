import React, { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { criarHistorico } from "@/services/bebedouroDataService";
import { getCurrentUser } from "@/services/sessionService";
import { BEBEDOURO_HISTORICO_STATUS, BEBEDOURO_HISTORICO_TIPOS } from "@/services/bebedouroService";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/apis/_core/ApiError";

import B1Select from "@/components/cadastro/base1/B1Select";
import LancField from "@/components/cadastro/base1/LancField";
import { LancLoteForm, LancLoteGrade, LancLoteRodape, LL_CTL } from "@/components/lotes/LancamentoLoteUi";

const AVALIACAO_AGUA_TYPES = new Set(["Análise da água", "Contaminação", "Inspeção", "Tratamento da água"]);
const PRODUTO_TYPES = new Set(["Tratamento da água", "Aplicação de produto", "Limpeza", "Abastecimento"]);
const MANUTENCAO_TYPES = new Set(["Manutenção", "Vazamento", "Troca de boia", "Troca de encanamento"]);
const QUALIDADES_DA_AGUA = ["Boa", "Média", "Ruim"];
const SEM_CADASTRO = "Ponto sem cadastro de bebedouro: cadastre-o no Mapa Cadastro para registrar lançamentos. Nada foi gravado.";

/**
 * Lançamento no bebedouro, no desenho dos lançamentos de manejo do lote
 * (D-PROD-222): `LancLoteForm` dentro do `LancLoteDialogo` que o
 * `DetalhesBebedouro` abre por cima ("Lançamento no Bebedouro", o bebedouro no
 * subtítulo); cada campo num `LancField` (rótulo dentro da caixa); campos lado a
 * lado em `LancLoteGrade`; o `LancLoteRodape` vira o ✕ / ✓ do cabeçalho do
 * diálogo (o ✓ envia o formulário). Tipo, Status e Qualidade da água são o
 * campo de escolha dos manejos (`B1Select`, como Categoria e Causa): o painel
 * das listas no desktop e a folha no celular. Mesmos campos, padrões,
 * validações e envio de antes; os campos de produto, custo e qualidade da água
 * aparecem pelo Tipo (a Qualidade remonta com o valor ao voltar a um tipo que
 * a pede).
 *
 * D-PROD-137: a recusa do servidor (403, 400, 404…) vira mensagem e o
 * formulário fica aberto. Sem `bebedouro.id` real não envia: o histórico
 * ficaria órfão (o servidor também recusa). Quem o abre já passou pela regra do
 * servidor (DetalhesBebedouro `podeLancar`): o formulário fica fora da
 * heurística de texto do Layout (`data-permissao-explicita`), e o rótulo do ✓
 * ("Registrar Lançamento", como os "Registrar …" do manejo) não é um dos verbos
 * que essa heurística lê ("Salvar…" exigiria "salvar", e o servidor aceita
 * "novo" OU "salvar" — BEB-04; prova em tests/smoke/bebedourosTelaParidade).
 */
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
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Não foi possível registrar o lançamento. Nada foi gravado."));
    }
  });

  const temCadastro = Boolean(bebedouro?.id && !String(bebedouro.id).startsWith("ponto-"));
  const enviar = (e) => {
    e.preventDefault();
    if (mutation.isPending) return;
    if (!temCadastro) {
      toast.error(SEM_CADASTRO);
      return;
    }
    mutation.mutate();
  };

  return (
    <LancLoteForm onSubmit={enviar} data-permissao-explicita="" data-testid="form-lancamento-bebedouro">
      <LancLoteGrade>
        <LancField label="Data" required>
          <Input type="date" value={form.data_lancamento} onChange={(e) => setForm({ ...form, data_lancamento: e.target.value })} className={LL_CTL} required />
        </LancField>
        <LancField label="Hora">
          <Input type="time" value={form.hora_lancamento} onChange={(e) => setForm({ ...form, hora_lancamento: e.target.value })} className={LL_CTL} />
        </LancField>
        <LancField label="Tipo" required>
          <B1Select value={form.tipo_lancamento} onChange={(e) => setForm({ ...form, tipo_lancamento: e.target.value })} className={LL_CTL}>
            {BEBEDOURO_HISTORICO_TIPOS.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
          </B1Select>
        </LancField>
        <LancField label="Status" required>
          <B1Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={LL_CTL}>
            {BEBEDOURO_HISTORICO_STATUS.map((status) => <option key={status} value={status}>{status}</option>)}
          </B1Select>
        </LancField>
      </LancLoteGrade>

      {showProduto ? (
        <LancLoteGrade>
          <LancField label="Produto utilizado">
            <Input value={form.produto_utilizado} onChange={(e) => setForm({ ...form, produto_utilizado: e.target.value })} className={`${LL_CTL} uppercase`} />
          </LancField>
          <LancField label="Quantidade">
            <Input type="number" step="0.01" value={form.quantidade_utilizada} onChange={(e) => setForm({ ...form, quantidade_utilizada: e.target.value })} className={LL_CTL} />
          </LancField>
        </LancLoteGrade>
      ) : null}

      {showAvaliacaoAgua ? (
        // Sem caixa dentro da caixa (como no manejo): o "da água" vai para o rótulo de cada campo.
        <LancLoteGrade>
          <LancField label="Escore da água">
            <Input type="number" step="0.1" value={form.escore_agua} onChange={(e) => setForm({ ...form, escore_agua: e.target.value })} className={LL_CTL} />
          </LancField>
          <LancField label="Qualidade da água">
            <B1Select value={form.qualidade_agua} onChange={(e) => setForm({ ...form, qualidade_agua: e.target.value })} className={LL_CTL}>
              {QUALIDADES_DA_AGUA.map((item) => <option key={item} value={item}>{item}</option>)}
            </B1Select>
          </LancField>
        </LancLoteGrade>
      ) : null}

      {showCusto ? (
        <LancField label="Custo">
          <Input type="number" step="0.01" value={form.custo} onChange={(e) => setForm({ ...form, custo: e.target.value })} className={LL_CTL} />
        </LancField>
      ) : null}

      <LancField label="Observação">
        <Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={2} className={`${LL_CTL} uppercase`} />
      </LancField>

      <LancLoteRodape onCancelar={onCancel} textoAcao="Registrar Lançamento" textoEnviando="Salvando..." enviando={mutation.isPending} />
    </LancLoteForm>
  );
}
