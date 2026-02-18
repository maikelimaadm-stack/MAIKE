import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import EditorVisualPanel from "@/components/editor/EditorVisualPanel";

const AVAILABLE_PAGES = [
{ id: "Home", name: "Dashboard" },
{ id: "Pesagens", name: "Pesagens" },
{ id: "LancamentoPesagensIndividuais", name: "Lançamento de Pesagens" },
{ id: "PesagensIndividuais", name: "Pesagens Individuais" },
{ id: "RelatorioPesagensIndividuais", name: "Relatório Pesagens Individuais" },
{ id: "CustosSafra", name: "Custos de Safra" },
{ id: "MovimentacoesEstoque", name: "Movimentações Estoque" },
{ id: "LancamentoFinanceiro", name: "Lançamento Financeiro" },
{ id: "Fornecedores", name: "Fornecedores" },
{ id: "Produtos", name: "Produtos" }].
sort((a, b) => a.name.localeCompare(b.name));

export default function EditorVisualSistema() {
  const [selectedPage, setSelectedPage] = useState("");
  const [showEditor, setShowEditor] = useState(false);

  const ativarEditor = () => {
    if (!selectedPage) {
      toast.error('Selecione uma página primeiro!');
      return;
    }
    setShowEditor(true);
    toast.success('Editor ativado! Clique em elementos para editar.');
  };

  return null;












































































}