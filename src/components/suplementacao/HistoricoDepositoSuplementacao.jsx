import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { excluirTransferenciaDeposito } from "./historicoSuplementacaoUtils";
import { formatDecimal } from "./formatters";

export default function HistoricoDepositoSuplementacao({ deposito }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [editMov, setEditMov] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ["historico-deposito", deposito.id],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list("-data_movimentacao");
      return all.filter((item) => item.empresa_id === empresaSelecionadaId && (item.local_estoque_origem === deposito.local_estoque_id || item.local_estoque_destino === deposito.local_estoque_id) && item.origem_sistema !== "reversao" && !(item.tipo_detalhado === "ajuste_positivo" && String(item.observacoes || "").includes("Reversão do lançamento do cocho"))).sort((a, b) => new Date(b.data_movimentacao) - new Date(a.data_movimentacao));
    },
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MovimentacaoEstoque.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["historico-deposito", "saldo-deposito", "movimentacoes-deposito-detalhe"].includes(query.queryKey[0]) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Lançamento atualizado.");
    },
  });

  const resumo = useMemo(() => {
    const ultimaData = movimentacoes[0] ? new Date(movimentacoes[0].data_movimentacao).toLocaleString("pt-BR") : "-";
    return { total: movimentacoes.length, ultimaData };
  }, [movimentacoes]);

  const handleDelete = async (movimentacao, index) => {
    if (index !== 0) {
      return toast.error("Exclua primeiro o último lançamento.");
    }
    if (![