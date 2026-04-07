import React from "react";

const formatDateBR = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
};

export default function TarefaResumoVisual({ status, prioridade, prazo }) {
  return null;















}