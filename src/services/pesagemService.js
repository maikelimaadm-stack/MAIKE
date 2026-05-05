export function getDataAtual() {
  return new Date().toISOString().split("T")[0];
}

export function getDataInicial(initialData) {
  if (!initialData?.data_pesagem) return getDataAtual();
  const date = new Date(initialData.data_pesagem);
  if (Number.isNaN(date.getTime())) return getDataAtual();
  return date.toISOString().split("T")[0];
}

export function getInitialPesagemFormData(initialData = null) {
  return {
    data_pesagem: getDataInicial(initialData),
    tipo_pesagem: initialData?.tipo_pesagem || "",
    placa_caminhao: initialData?.placa_caminhao?.toUpperCase() || "",
    nome_motorista: initialData?.nome_motorista?.toUpperCase() || "",
    produto: initialData?.produto?.toUpperCase() || "",
    fornecedor_destino: initialData?.fornecedor_destino?.toUpperCase() || "",
    peso_tara: initialData?.peso_tara || "",
    peso_bruto: initialData?.peso_bruto || "",
    peso_liquido: initialData?.peso_liquido || 0,
    observacoes: initialData?.observacoes?.toUpperCase() || "",
  };
}

export function calculatePesoLiquido(pesoTara, pesoBruto) {
  const tara = parseFloat(pesoTara) || 0;
  const bruto = parseFloat(pesoBruto) || 0;
  return bruto - tara;
}

export function normalizePesagemFieldValue(field, value) {
  const uppercaseFields = ["placa_caminhao", "nome_motorista", "produto", "fornecedor_destino", "observacoes"];
  if (uppercaseFields.includes(field) && typeof value === "string") return value.toUpperCase();
  return value;
}

export function applyPesagemFieldChange(currentData, field, value) {
  const nextData = {
    ...currentData,
    [field]: normalizePesagemFieldValue(field, value),
  };

  if (field === "peso_tara" || field === "peso_bruto") {
    nextData.peso_liquido = calculatePesoLiquido(nextData.peso_tara, nextData.peso_bruto);
  }

  return nextData;
}