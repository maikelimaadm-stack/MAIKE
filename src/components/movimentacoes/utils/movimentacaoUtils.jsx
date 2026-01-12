// Utils de Movimentações de Estoque
// Padroniza slugs/labels de operações e leitura/gravação de locais seguindo o schema

const removerAcentos = (str = "") => {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
};

// A) Converte Label -> slug consistente
export function toValue(label) {
  if (!label) return "";
  let s = removerAcentos(String(label).trim().toLowerCase());
  // trocar espaços e hífens por underscore
  s = s.replace(/[\s-]+/g, "_");
  // remover caracteres não permitidos
  s = s.replace(/[^a-z0-9_]/g, "");
  // consolidar underscores duplicados
  s = s.replace(/_+/g, "_");
  return s;
}

// B) Converte slug -> Label amigável
export function getLabelOperacao(value) {
  if (!value) return "-";
  const raw = String(value);
  // se já possui espaços, normaliza capitalização
  if (raw.includes(" ")) {
    return raw
      .split(" ")
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }
  // tratar underscore/hífen como separador
  const parts = raw.replace(/[-]+/g, "_").split("_").filter(Boolean);
  if (parts.length === 0) return "-";
  return parts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// Compatibilidade: alguns lugares importam toLabel
export const toLabel = getLabelOperacao;

// Helpers internos para limpar campos fora do schema
const limparLocais = (obj) => {
  const clone = { ...obj };
  const chavesRemover = [
    "local_estoque_origem_id",
    "local_estoque_origem_nome",
    "local_estoque_destino_id",
    "local_estoque_destino_nome",
  ];
  chavesRemover.forEach(k => { if (k in clone) delete clone[k]; });
  return clone;
};

// C) Prepara locais para salvar 100% compatível com schema MovimentacaoEstoque
export function prepararLocaisParaSalvar(dados) {
  const d = limparLocais(dados || {});
  const tipo = d.tipo_movimentacao;

  // valores brutos informados
  const origemInformada = d.local_estoque_origem || d.local_origem || "";
  const destinoInformado = d.local_estoque_destino || d.local_destino || "";

  let local_estoque_origem = "";
  let local_estoque_destino = "";

  if (tipo === "Entrada") {
    local_estoque_destino = destinoInformado || origemInformada || "";
  } else if (tipo === "Saída") {
    local_estoque_origem = origemInformada || destinoInformado || "";
  } else if (tipo === "Transferência") {
    local_estoque_origem = origemInformada || "";
    local_estoque_destino = destinoInformado || "";
  } else if (tipo === "Ajuste") {
    // usar destino se existir, senão origem
    if (destinoInformado) local_estoque_destino = destinoInformado;
    else local_estoque_origem = origemInformada || "";
  }

  // preencher locais "plain" como fallback de compatibilidade
  const local_origem = local_estoque_origem || d.local_origem || "";
  const local_destino = local_estoque_destino || d.local_destino || "";

  return {
    local_estoque_origem,
    local_estoque_destino,
    local_origem,
    local_destino,
  };
}

// D) Local principal para UI/Relatórios
export function getLocalEstoque(m) {
  if (!m) return "";
  const tipo = m.tipo_movimentacao;
  const origem = m.local_estoque_origem || m.local_origem || "";
  const destino = m.local_estoque_destino || m.local_destino || "";

  if (tipo === "Transferência") {
    if (origem && destino) return `${origem} → ${destino}`;
    return origem || destino || "";
  }
  if (tipo === "Entrada") {
    return destino || "";
  }
  if (tipo === "Saída") {
    return origem || "";
  }
  if (tipo === "Ajuste") {
    return destino || origem || "";
  }
  // fallback
  return origem || destino || "";
}