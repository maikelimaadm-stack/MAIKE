export function getHistoricoValido(registros = []) {
  return registros.filter((item) => (item.cabecas_na_area || 0) > 0 && (item.dias_periodo || 0) > 0);
}

export function calcularMediaPonderadaConsumo(registros = []) {
  const validos = getHistoricoValido(registros);
  const totalAnimalDias = validos.reduce((sum, item) => sum + ((item.cabecas_na_area || 0) * (item.dias_periodo || 0)), 0);
  const totalConsumo = validos.reduce((sum, item) => sum + (item.consumo_total_lote_periodo_kg || 0), 0);
  return totalAnimalDias > 0 ? totalConsumo / totalAnimalDias : 0;
}

export function calcularConsumoTotal(registros = []) {
  return registros.reduce((sum, item) => sum + (item.consumo_total_lote_periodo_kg || 0), 0);
}

export function calcularResumoHistorico(registros = []) {
  const ordenados = [...registros].sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento));
  const validos = getHistoricoValido(ordenados);
  const consumoMedioKgCabDia = calcularMediaPonderadaConsumo(validos);
  const consumoTotalKg = calcularConsumoTotal(validos);
  const consumoMedioGramasCabDia = consumoMedioKgCabDia * 1000;
  const ultimoLancamento = ordenados[0] || null;

  const consumoPorProduto = Object.values(validos.reduce((acc, item) => {
    const produto = item.produto || "Sem produto";
    if (!acc[produto]) {
      acc[produto] = {
        produto,
        totalKg: 0,
        animalDias: 0,
        mediaKgCabDia: 0,
        lancamentos: 0,
      };
    }
    acc[produto].totalKg += item.consumo_total_lote_periodo_kg || 0;
    acc[produto].animalDias += (item.cabecas_na_area || 0) * (item.dias_periodo || 0);
    acc[produto].lancamentos += 1;
    return acc;
  }, {})).map((item) => ({
    ...item,
    mediaKgCabDia: item.animalDias > 0 ? item.totalKg / item.animalDias : 0,
  })).sort((a, b) => b.totalKg - a.totalKg);

  return {
    lancamentos: ordenados.length,
    periodosValidos: validos.length,
    consumoMedioKgCabDia,
    consumoMedioGramasCabDia,
    consumoTotalKg,
    ultimoLancamento,
    consumoPorProduto,
  };
}

export function montarSerieConsumoDiario(registros = []) {
  return [...registros]
    .filter((item) => item.data_lancamento)
    .sort((a, b) => new Date(a.data_lancamento) - new Date(b.data_lancamento))
    .map((item) => ({
      data: new Date(item.data_lancamento).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      consumo: Number(item.consumo_por_cabeca_dia_kg || 0),
      total: Number(item.consumo_total_lote_periodo_kg || 0),
      produto: item.produto || "-",
    }));
}

export function montarSerieMensal(registros = []) {
  const agrupado = registros.reduce((acc, item) => {
    if (!item.data_lancamento) return acc;
    const mes = new Date(item.data_lancamento).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    if (!acc[mes]) {
      acc[mes] = { mes, totalKg: 0 };
    }
    acc[mes].totalKg += item.consumo_total_lote_periodo_kg || 0;
    return acc;
  }, {});

  return Object.values(agrupado).reverse();
}

export function filtrarHistoricoPorMeses(registros = [], meses = 3) {
  const dataLimite = new Date();
  dataLimite.setMonth(dataLimite.getMonth() - Number(meses || 3));
  return registros.filter((item) => new Date(item.data_lancamento) >= dataLimite);
}