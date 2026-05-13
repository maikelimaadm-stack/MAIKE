export const BEBEDOURO_TIPOS = ["Caixa d’água", "Bebedouro australiano", "Concreto", "Tambor", "Natural", "Outro"];
export const BEBEDOURO_ORIGENS_AGUA = ["Poço", "Água encanada", "Mina", "Rio", "Represa", "Rede", "Outro"];
export const BEBEDOURO_STATUS = ["Ativo", "Em manutenção", "Inativo"];
export const BEBEDOURO_HISTORICO_TIPOS = ["Limpeza", "Tratamento da água", "Aplicação de produto", "Manutenção", "Vazamento", "Troca de boia", "Troca de encanamento", "Análise da água", "Contaminação", "Inspeção", "Abastecimento", "Outro"];
export const BEBEDOURO_HISTORICO_STATUS = ["Pendente", "Concluído", "Emergencial"];
export const BEBEDOURO_PERIODICIDADES = ["Semanal", "Quinzenal", "Mensal", "Personalizado"];

export const normalizarTextoBebedouro = (valor = "") => String(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

export const getPeriodicidadeDias = (periodicidade, personalizado) => {
  if (periodicidade === "Semanal") return 7;
  if (periodicidade === "Quinzenal") return 15;
  if (periodicidade === "Mensal") return 30;
  return Number(personalizado || 0);
};

export const getDiasDesde = (dateValue) => {
  if (!dateValue) return null;
  const date = new Date(`${String(dateValue).split("T")[0]}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.floor((todayStart - date) / 86400000));
};

export const getBebedouroStatusVisual = ({ bebedouro, historico = [], sanidade = [] }) => {
  const pendente = historico.some((item) => item.status === "Pendente" && ["Manutenção", "Vazamento", "Troca de boia", "Troca de encanamento"].includes(item.tipo_lancamento));
  const emergencial = historico.some((item) => item.status === "Emergencial");
  const riscoAlto = [...sanidade, ...historico].some((item) => item.nivel_risco === "Alto" || item.presenca_contaminacao);
  if (bebedouro?.status === "Inativo" || emergencial || riscoAlto) return { cor: "#ef4444", label: "Problema", nivel: "alto" };
  if (bebedouro?.status === "Em manutenção" || pendente) return { cor: "#f59e0b", label: "Atenção", nivel: "medio" };
  return { cor: "#22c55e", label: "OK", nivel: "baixo" };
};

export const buildBebedouroAlertas = (bebedouro, historico = [], sanidade = []) => {
  const alertas = [];
  const ultimaLimpeza = historico.filter((item) => item.tipo_lancamento === "Limpeza" && item.status === "Concluído").sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0];
  const ultimaInspecao = historico.filter((item) => item.tipo_lancamento === "Inspeção" && item.status === "Concluído").sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0];
  const diasLimpeza = getPeriodicidadeDias(bebedouro?.periodicidade_limpeza, bebedouro?.dias_limpeza_personalizado);
  const diasInspecao = getPeriodicidadeDias(bebedouro?.periodicidade_inspecao, bebedouro?.dias_inspecao_personalizado);
  const diasDesdeLimpeza = getDiasDesde(ultimaLimpeza?.data_lancamento);
  const diasDesdeInspecao = getDiasDesde(ultimaInspecao?.data_lancamento);

  if (diasLimpeza && (diasDesdeLimpeza === null || diasDesdeLimpeza > diasLimpeza)) alertas.push({ tipo: "Limpeza vencida", nivel: "Médio", descricao: "Limpeza do bebedouro está vencida." });
  if (diasInspecao && (diasDesdeInspecao === null || diasDesdeInspecao > diasInspecao)) alertas.push({ tipo: "Inspeção vencida", nivel: "Médio", descricao: "Inspeção do bebedouro está vencida." });
  if (historico.some((item) => item.status === "Pendente" && item.tipo_lancamento === "Manutenção")) alertas.push({ tipo: "Manutenção pendente", nivel: "Médio", descricao: "Existe manutenção pendente." });
  if (historico.some((item) => item.status !== "Concluído" && item.tipo_lancamento === "Vazamento")) alertas.push({ tipo: "Vazamento em aberto", nivel: "Alto", descricao: "Existe vazamento em aberto." });
  if ([...sanidade, ...historico].some((item) => item.nivel_risco === "Alto" || item.presenca_contaminacao)) alertas.push({ tipo: "Água contaminada", nivel: "Alto", descricao: "A água apresenta risco alto ou contaminação." });
  if (historico.some((item) => item.status === "Emergencial")) alertas.push({ tipo: "Ocorrência emergencial", nivel: "Alto", descricao: "Existe lançamento emergencial no histórico." });

  return alertas;
};