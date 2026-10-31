/**
 * Regras do cadastro de área — uma só fonte para o formulário manual e para a
 * importação por arquivo (D-PROD-90). O servidor aplica a mesma regra na
 * importação (`backend/src/modules/areas/areaImportacaoService.js`).
 *
 * `tipo_cultura` é o "Tipo de uso" da tela. `tipo_pastagem` guarda a cultura
 * (Pastagem/Agricultura/Reserva/APP) ou, em Infraestrutura, o tipo de
 * infraestrutura — não existe coluna própria para ele.
 *
 * Nada aqui conhece React, rede ou storage.
 */

export const TIPOS_USO = Object.freeze(["Pastagem", "Agricultura", "Reserva", "APP", "Infraestrutura"]);
export const APROVEITAMENTO = Object.freeze(["Alta", "Média", "Baixa"]);
export const TIPOS_CULTURAS = Object.freeze([
  "Brachiaria", "Mombaça", "Tanzânia", "Tifton", "Piatã", "Marandu", "Panicum", "Elefante",
  "Milho", "Soja", "Sorgo", "Arroz", "Trigo", "Cevada", "Cana-de-açúcar", "Algodão",
  "Feijão", "Girassol", "Aveia", "Café", "Eucalipto", "Floresta", "Outros",
]);
export const TIPOS_INFRAESTRUTURA = Object.freeze([
  "Curral", "Oficina", "Casa", "Barracão", "Galpão", "Depósito", "Embarcador", "Brete", "Outro",
]);
export const CORES_DISPONIVEIS = Object.freeze([
  { nome: "Branco", cor: "#f8f9fa" },
  { nome: "Cinza claro", cor: "#d8dee2" },
  { nome: "Preto", cor: "#2c303e" },
  { nome: "Azul escuro", cor: "#0d67ad" },
  { nome: "Azul celeste", cor: "#61aad9" },
  { nome: "Amarelo", cor: "#efcb19" },
  { nome: "Verde claro", cor: "#92ca25" },
  { nome: "Laranja", cor: "#f5a01b" },
  { nome: "Roxo", cor: "#966fe1" },
]);
export const MAX_NOME = 255;
export const MAX_SIGLA = 10;

/** Cor neutra das áreas importadas (editável antes de gravar). */
export const COR_PADRAO_IMPORTACAO = "#f8f9fa";

/** Uso que explora a área: exige cultura e área pastejada/arável. */
export const usoExploraArea = (uso) => uso === "Pastagem" || uso === "Agricultura";
/** Uso sem exploração pecuária: cultura opcional, área pastejada pode ser 0. */
export const usoDePreservacao = (uso) => uso === "Reserva" || uso === "APP";

/** Tolerância da comparação pastejada ≤ total (arredondamento a 2 casas). */
const TOLERANCIA_HA = 0.005;

/**
 * Número de hectares digitado em pt-BR ("1.234,56") ou já numérico.
 * Vazio → `null` (não informado); "0" → 0 (informado). Nunca confunde os dois.
 * @param {unknown} valor
 * @returns {number | null | typeof NaN}
 */
export const lerHectares = (valor) => {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : NaN;
  const texto = String(valor).trim();
  if (texto === "") return null;
  const normal = texto.includes(",") ? texto.replace(/\./g, "").replace(",", ".") : texto;
  const n = Number(normal);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Pendências de uma área, na ordem da tela. Vazio = pode gravar.
 *
 * @param {{
 *   nome?: string, sigla?: string, setor_id?: string, tipo_cultura?: string, tipo_pastagem?: string,
 *   area_pastejada?: unknown, total_ha?: number | null
 * }} campos `total_ha` é a área total geodésica (ou `null` se ainda não há contorno)
 * @returns {{ campo: string, mensagem: string }[]}
 */
export const pendenciasDaArea = (campos) => {
  /** @type {{ campo: string, mensagem: string }[]} */
  const pend = [];
  const uso = String(campos.tipo_cultura ?? "").trim();
  const tipo = String(campos.tipo_pastagem ?? "").trim();

  const nome = String(campos.nome ?? "").replace(/\s+/g, " ").trim();
  if (!nome) pend.push({ campo: "nome", mensagem: "Informe o nome." });
  else if (nome.length > MAX_NOME) pend.push({ campo: "nome", mensagem: `Nome com mais de ${MAX_NOME} caracteres.` });
  if (String(campos.sigla ?? "").trim().length > MAX_SIGLA) {
    pend.push({ campo: "sigla", mensagem: `Sigla com mais de ${MAX_SIGLA} caracteres.` });
  }
  if (!String(campos.setor_id ?? "").trim()) pend.push({ campo: "setor_id", mensagem: "Escolha o setor." });
  if (!uso) {
    pend.push({ campo: "tipo_cultura", mensagem: "Escolha o tipo de uso." });
    return pend;
  }
  if (!TIPOS_USO.includes(uso)) {
    pend.push({ campo: "tipo_cultura", mensagem: "Tipo de uso desconhecido." });
    return pend;
  }

  if (uso === "Infraestrutura") {
    if (!tipo) pend.push({ campo: "tipo_infraestrutura", mensagem: "Escolha o tipo de infraestrutura." });
    else if (!TIPOS_INFRAESTRUTURA.includes(tipo)) {
      pend.push({ campo: "tipo_infraestrutura", mensagem: "Tipo de infraestrutura desconhecido." });
    }
    return pend;
  }

  if (usoExploraArea(uso) && !tipo) pend.push({ campo: "tipo_pastagem", mensagem: "Escolha o tipo de cultura." });
  if (tipo && !TIPOS_CULTURAS.includes(tipo)) pend.push({ campo: "tipo_pastagem", mensagem: "Tipo de cultura desconhecido." });

  const pastejada = lerHectares(campos.area_pastejada);
  if (pastejada === null) {
    pend.push({
      campo: "area_pastejada",
      mensagem: usoDePreservacao(uso)
        ? "Informe a área pastejada ou arável (use 0 se não houver)."
        : "Informe a área pastejada ou arável.",
    });
  } else if (Number.isNaN(pastejada)) {
    pend.push({ campo: "area_pastejada", mensagem: "Área pastejada inválida." });
  } else if (pastejada < 0) {
    pend.push({ campo: "area_pastejada", mensagem: "Área pastejada não pode ser negativa." });
  } else if (typeof campos.total_ha === "number" && pastejada > campos.total_ha + TOLERANCIA_HA) {
    pend.push({ campo: "area_pastejada", mensagem: "Área pastejada maior que a área total." });
  }
  return pend;
};
