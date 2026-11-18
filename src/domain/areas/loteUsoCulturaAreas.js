/**
 * Ação em lote "Tipo de uso" / "Tipo de cultura" das áreas selecionadas no mapa.
 *
 * O lote grava um campo só (`tipo_cultura` ou `tipo_pastagem`) em várias áreas,
 * mas os dois campos andam juntos: em Infraestrutura o `tipo_pastagem` guarda o
 * tipo da infraestrutura (Curral, Galpão...), não uma cultura. Por isso cada área
 * passa pela mesma regra do cadastro (`pendenciasDaArea`, D-PROD-90) com o valor
 * novo, e as que ficariam numa combinação recusada pelo formulário são deixadas
 * de fora (com o motivo), em vez de gravadas:
 *  - cultura num curral apagaria o tipo da infraestrutura;
 *  - uso "Infraestrutura" num pasto deixaria a cultura no lugar do tipo;
 *  - uso de pasto numa infraestrutura deixaria "Curral" como cultura.
 *
 * Nada aqui conhece React, rede ou storage.
 */
import { TIPOS_CULTURAS, TIPOS_USO, pendenciasDaArea } from "./regrasCadastroArea";

/** Campos da regra que o lote de uso/cultura pode quebrar. */
const CAMPOS_DO_LOTE = new Set(["tipo_cultura", "tipo_pastagem", "tipo_infraestrutura"]);

/**
 * @param {{ areas: any[], ids: Array<string|number>, tipo: 'uso' | 'cultura', valor: string }} p
 * @returns {{
 *   erro: string | null,
 *   aplicar: Array<{ id: string, dados: Record<string, string> }>,
 *   ignoradas: Array<{ id: string, nome: string, motivo: string }>,
 * }}
 */
export function planejarLoteUsoCultura({ areas, ids, tipo, valor }) {
  const campo = tipo === "uso" ? "tipo_cultura" : "tipo_pastagem";
  const valido = tipo === "uso" ? TIPOS_USO.includes(valor) : TIPOS_CULTURAS.includes(valor);
  if (!valido) {
    return { erro: tipo === "uso" ? "Escolha um tipo de uso válido." : "Escolha um tipo de cultura válido.", aplicar: [], ignoradas: [] };
  }

  /** @type {Array<{ id: string, dados: Record<string, string> }>} */
  const aplicar = [];
  /** @type {Array<{ id: string, nome: string, motivo: string }>} */
  const ignoradas = [];

  for (const idCru of ids) {
    const id = String(idCru);
    const area = (areas || []).find((a) => String(a?.id) === id);
    if (!area) {
      ignoradas.push({ id, nome: "", motivo: "Área não encontrada." });
      continue;
    }
    const nome = String(area.nome || "").trim();
    if (tipo === "cultura" && area.tipo_cultura === "Infraestrutura") {
      ignoradas.push({ id, nome, motivo: "Área de infraestrutura não tem tipo de cultura." });
      continue;
    }
    // D-PROD-216: a área ligada a uma cultura do cadastro guarda o nome dela em `tipo_pastagem` (o servidor ignora o
    // texto enviado); a troca é feita no registro da área, escolhendo outra cultura.
    if (tipo === "cultura" && area.cultura_id) {
      ignoradas.push({ id, nome, motivo: "Área ligada a uma cultura do cadastro: troque a cultura no registro da área." });
      continue;
    }
    const pendencia = pendenciasDaArea({
      nome: "-",
      setor_id: "-",
      tipo_cultura: area.tipo_cultura,
      tipo_pastagem: area.tipo_pastagem,
      cultura_id: area.cultura_id ?? null,
      area_pastejada: 0,
      [campo]: valor,
    }).find((p) => CAMPOS_DO_LOTE.has(p.campo));
    if (pendencia) {
      ignoradas.push({ id, nome, motivo: motivoDoLote(area, tipo, valor, pendencia.mensagem) });
      continue;
    }
    aplicar.push({ id, dados: { [campo]: valor } });
  }

  if (!aplicar.length && ignoradas.length) {
    const motivo = ignoradas[0].motivo;
    const todasIguais = ignoradas.every((i) => i.motivo === motivo);
    return {
      erro: todasIguais ? motivo : "Nenhuma área selecionada aceita essa alteração. Edite cada área no cadastro.",
      aplicar,
      ignoradas,
    };
  }
  return { erro: null, aplicar, ignoradas };
}

/** Mensagem curta em português para a área deixada de fora. */
function motivoDoLote(area, tipo, valor, mensagem) {
  if (tipo === "uso" && valor === "Infraestrutura" && area.tipo_cultura !== "Infraestrutura") {
    return "Para virar infraestrutura, edite a área e escolha o tipo de infraestrutura.";
  }
  if (tipo === "uso" && area.tipo_cultura === "Infraestrutura") {
    return "Área de infraestrutura: edite a área para trocar o uso e escolher a cultura.";
  }
  if (tipo === "cultura" && !TIPOS_USO.includes(String(area.tipo_cultura ?? "").trim())) {
    return "Área sem tipo de uso válido: edite a área no cadastro.";
  }
  if (tipo === "uso" && /desconhecid/i.test(mensagem)) {
    return "Tipo de cultura da área não é reconhecido: edite a área para escolher a cultura.";
  }
  if (tipo === "uso" && /cultura/i.test(mensagem)) {
    return "Área sem tipo de cultura: edite a área para escolher a cultura.";
  }
  return mensagem;
}

/**
 * Texto do aviso das áreas deixadas de fora (até 3 nomes).
 * @param {Array<{ nome: string, motivo: string }>} ignoradas
 */
export function textoDasIgnoradas(ignoradas) {
  if (!ignoradas.length) return "";
  const nomes = ignoradas.map((i) => i.nome).filter(Boolean);
  const lista = nomes.slice(0, 3).join(", ") + (nomes.length > 3 ? "…" : "");
  const n = ignoradas.length;
  return `${n} ${n === 1 ? "área ficou" : "áreas ficaram"} de fora${lista ? ` (${lista})` : ""}: ${ignoradas[0].motivo}`;
}
