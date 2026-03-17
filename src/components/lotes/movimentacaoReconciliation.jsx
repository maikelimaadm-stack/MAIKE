import { base44 } from "@/api/base44Client";
import { getCategoriaAnteriorFromObs, normalizeText } from "../utils/pecuariaUtils";

const normalize = (value) => normalizeText(value);
const toNumber = (value) => Number(value || 0);
const toDateOnly = (value) => String(value || new Date().toISOString()).split("T")[0];
const toIsoDateTime = (value, fallback) => {
  if (!value) return fallback;
  if (String(value).includes("T")) return value;
  return `${value}T12:00:00.000Z`;
};

function syncObservacoesWithPayload(originalMovement, observacoes, quantidade) {
  let texto = observacoes || "";

  if (originalMovement.tipo === "Transferência de Área") {
    texto = texto.replace(/Movimentação parcial\s*-\s*\d+\s*cabeças/i, `Movimentação parcial - ${quantidade} cabeças`);
    texto = texto.replace(/Movimentação completa do lote\s*-\s*\d+\s*cabeças/i, `Movimentação completa do lote - ${quantidade} cabeças`);
  }

  return texto;
}

function buildActiveStatus(quantidade) {
  return quantidade > 0 ? "Ativo" : "Inativo";
}

function parseCategoriaNovaFromObs(observacoes) {
  const match = String(observacoes || "").match(/De\s+.+?\s+para\s+(.+?)\.\s*Sexo:/i);
  return match ? match[1].trim() : null;
}

function ensureAvailable(lote, quantidade, mensagem) {
  if (!lote || toNumber(lote.quantidade_cabecas) < quantidade) {
    throw new Error(mensagem);
  }
}

async function updateLoteQuantidade(lote, quantidade) {
  const quantidadeFinal = Math.max(0, toNumber(quantidade));
  await base44.entities.Lote.update(lote.id, {
    quantidade_cabecas: quantidadeFinal,
    status: buildActiveStatus(quantidadeFinal),
  });
}

async function createRecomposicaoLote({ template, areaId, areaNome, quantidade, dataMovimentacao, categoria }) {
  await base44.entities.Lote.create({
    empresa_id: template.empresa_id,
    nome: template.nome,
    quantidade_cabecas: quantidade,
    categoria: categoria || template.categoria,
    sexo: template.sexo,
    peso_medio_kg: template.peso_medio_kg,
    idade_media_meses: template.idade_media_meses,
    area_atual_id: areaId,
    area_atual_nome: areaNome || "",
    area_entrada_id: areaId,
    area_entrada_nome: areaNome || "",
    raca_predominante: template.raca_predominante,
    sistema_produtivo: template.sistema_produtivo,
    categoria_manejo_id: template.categoria_manejo_id,
    categoria_manejo_nome: template.categoria_manejo_nome,
    data_entrada: toDateOnly(dataMovimentacao),
    motivo_entrada: "Outros",
    motivo_outros: "Recomposição por edição",
    origem: "EDIÇÃO MOVIMENTAÇÃO",
    status: "Ativo",
  });
}

function createFinders(lotesEmpresa) {
  const findLoteById = (id) => (id ? lotesEmpresa.find((lote) => lote.id === id) || null : null);
  const findLoteByNomeArea = (nome, areaId, apenasAtivo = false, excludeId = null) => (
    lotesEmpresa.find((lote) =>
      lote.id !== excludeId &&
      normalize(lote.nome) === normalize(nome) &&
      lote.area_atual_id === areaId &&
      (!apenasAtivo || lote.status === "Ativo")
    ) || null
  );
  const findLoteByNomeAreaCategoria = (nome, areaId, categoria, excludeId = null) => (
    lotesEmpresa.find((lote) =>
      lote.id !== excludeId &&
      normalize(lote.nome) === normalize(nome) &&
      lote.area_atual_id === areaId &&
      normalize(lote.categoria) === normalize(categoria)
    ) || null
  );

  return { findLoteById, findLoteByNomeArea, findLoteByNomeAreaCategoria };
}

async function reconcileTransferencia({ mov, diff, findLoteById, findLoteByNomeArea }) {
  const origemFinal = findLoteByNomeArea(mov.lote, mov.area_origem_id, true) || findLoteByNomeArea(mov.lote, mov.area_origem_id, false);
  const destinoFinal = findLoteByNomeArea(mov.lote, mov.area_destino_id, true) || findLoteByNomeArea(mov.lote, mov.area_destino_id, false);
  const lotePorId = findLoteById(mov.lote_id);

  if (origemFinal && destinoFinal && origemFinal.id !== destinoFinal.id) {
    if (diff > 0) {
      ensureAvailable(origemFinal, diff, "O lote de origem não tem saldo suficiente para aumentar essa transferência.");
    }
    await updateLoteQuantidade(origemFinal, toNumber(origemFinal.quantidade_cabecas) - diff);
    await updateLoteQuantidade(destinoFinal, toNumber(destinoFinal.quantidade_cabecas) + diff);
    return;
  }

  if (destinoFinal) {
    if (diff > 0) {
      const origemReajuste = origemFinal && origemFinal.id !== destinoFinal.id ? origemFinal : null;
      if (!origemReajuste) {
        throw new Error("Não foi possível localizar saldo na origem para aumentar essa transferência.");
      }
      ensureAvailable(origemReajuste, diff, "O lote de origem não tem saldo suficiente para aumentar essa transferência.");
      await updateLoteQuantidade(origemReajuste, toNumber(origemReajuste.quantidade_cabecas) - diff);
      await updateLoteQuantidade(destinoFinal, toNumber(destinoFinal.quantidade_cabecas) + diff);
      return;
    }

    const retorno = Math.abs(diff);
    ensureAvailable(destinoFinal, retorno, "O lote de destino não tem saldo suficiente para reduzir essa transferência.");

    if (origemFinal && origemFinal.id !== destinoFinal.id) {
      await updateLoteQuantidade(origemFinal, toNumber(origemFinal.quantidade_cabecas) + retorno);
    } else {
      await createRecomposicaoLote({
        template: destinoFinal,
        areaId: mov.area_origem_id,
        areaNome: mov.area_origem_nome,
        quantidade: retorno,
        dataMovimentacao: mov.data_movimentacao,
      });
    }

    await updateLoteQuantidade(destinoFinal, toNumber(destinoFinal.quantidade_cabecas) - retorno);
    return;
  }

  if (!lotePorId) {
    throw new Error("Não foi possível localizar os lotes da transferência para reconciliar a edição.");
  }

  if (diff > 0) {
    throw new Error("Não foi possível aumentar essa transferência porque não existe saldo disponível na origem.");
  }

  const retorno = Math.abs(diff);
  ensureAvailable(lotePorId, retorno, "O lote de destino não tem saldo suficiente para reduzir essa transferência.");

  const origemExistente = findLoteByNomeArea(mov.lote, mov.area_origem_id, true, lotePorId.id) || findLoteByNomeArea(mov.lote, mov.area_origem_id, false, lotePorId.id);

  if (origemExistente) {
    await updateLoteQuantidade(origemExistente, toNumber(origemExistente.quantidade_cabecas) + retorno);
  } else {
    await createRecomposicaoLote({
      template: lotePorId,
      areaId: mov.area_origem_id,
      areaNome: mov.area_origem_nome,
      quantidade: retorno,
      dataMovimentacao: mov.data_movimentacao,
    });
  }

  await updateLoteQuantidade(lotePorId, toNumber(lotePorId.quantidade_cabecas) - retorno);
}

async function reconcileMudancaCategoria({ mov, diff, findLoteById, findLoteByNomeAreaCategoria }) {
  const categoriaAnterior = getCategoriaAnteriorFromObs(mov.observacoes);
  const categoriaNova = parseCategoriaNovaFromObs(mov.observacoes);
  const loteBase = findLoteById(mov.lote_id);

  if (!loteBase || !categoriaAnterior || !categoriaNova) return;

  const loteCategoriaAnterior = normalize(loteBase.categoria) === normalize(categoriaAnterior)
    ? loteBase
    : findLoteByNomeAreaCategoria(mov.lote, mov.area_origem_id, categoriaAnterior, loteBase.id);

  const loteCategoriaNova = normalize(loteBase.categoria) === normalize(categoriaNova)
    ? loteBase
    : findLoteByNomeAreaCategoria(mov.lote, mov.area_origem_id, categoriaNova, loteBase.id);

  if (!loteCategoriaNova) {
    throw new Error("Não foi possível localizar o lote da nova categoria para reconciliar a edição.");
  }

  if (diff > 0) {
    if (!loteCategoriaAnterior || loteCategoriaAnterior.id === loteCategoriaNova.id) {
      throw new Error("Não é possível aumentar essa mudança de categoria porque não há saldo disponível na categoria original.");
    }
    ensureAvailable(loteCategoriaAnterior, diff, "O lote da categoria original não tem saldo suficiente para aumentar essa mudança.");
    await updateLoteQuantidade(loteCategoriaAnterior, toNumber(loteCategoriaAnterior.quantidade_cabecas) - diff);
    await updateLoteQuantidade(loteCategoriaNova, toNumber(loteCategoriaNova.quantidade_cabecas) + diff);
    return;
  }

  const retorno = Math.abs(diff);
  ensureAvailable(loteCategoriaNova, retorno, "O lote da nova categoria não tem saldo suficiente para reduzir essa mudança.");

  if (loteCategoriaAnterior && loteCategoriaAnterior.id !== loteCategoriaNova.id) {
    await updateLoteQuantidade(loteCategoriaAnterior, toNumber(loteCategoriaAnterior.quantidade_cabecas) + retorno);
  } else {
    await createRecomposicaoLote({
      template: loteCategoriaNova,
      areaId: mov.area_origem_id,
      areaNome: mov.area_origem_nome,
      quantidade: retorno,
      dataMovimentacao: mov.data_movimentacao,
      categoria: categoriaAnterior,
    });
  }

  await updateLoteQuantidade(loteCategoriaNova, toNumber(loteCategoriaNova.quantidade_cabecas) - retorno);
}

export async function reconcileMovementEdit({ empresaSelecionadaId, originalMovement, nextData }) {
  const quantidadeFinal = Math.max(0, toNumber(nextData.quantidade_animais ?? originalMovement.quantidade_animais));
  const payload = {
    data_movimentacao: toIsoDateTime(nextData.data_movimentacao, originalMovement.data_movimentacao),
    quantidade_animais: quantidadeFinal,
    peso_medio: nextData.peso_medio === "" || nextData.peso_medio == null
      ? (originalMovement.tipo === "Pesagem" ? null : originalMovement.peso_medio)
      : toNumber(nextData.peso_medio),
    observacoes: syncObservacoesWithPayload(originalMovement, nextData.observacoes, quantidadeFinal),
  };

  const oldQuantidade = Math.max(0, toNumber(originalMovement.quantidade_animais));
  const diff = payload.quantidade_animais - oldQuantidade;

  const lotesAll = await base44.entities.Lote.list();
  const lotesEmpresa = lotesAll.filter((lote) => lote.empresa_id === empresaSelecionadaId);
  const { findLoteById, findLoteByNomeArea, findLoteByNomeAreaCategoria } = createFinders(lotesEmpresa);
  const lotePrincipal = findLoteById(originalMovement.lote_id);

  if (diff !== 0) {
    if (originalMovement.tipo === "Morte" || originalMovement.tipo === "Abate") {
      if (!lotePrincipal) throw new Error("Não foi possível localizar o lote para reconciliar a edição.");
      if (diff > 0) ensureAvailable(lotePrincipal, diff, "O lote não tem saldo suficiente para aumentar essa baixa.");
      await updateLoteQuantidade(lotePrincipal, toNumber(lotePrincipal.quantidade_cabecas) - diff);
    }

    if (originalMovement.tipo === "Nascimento") {
      if (!lotePrincipal) throw new Error("Não foi possível localizar o lote para reconciliar a edição.");
      if (diff < 0) ensureAvailable(lotePrincipal, Math.abs(diff), "O lote não tem saldo suficiente para reduzir esse nascimento.");
      await updateLoteQuantidade(lotePrincipal, toNumber(lotePrincipal.quantidade_cabecas) + diff);
    }

    if (originalMovement.tipo === "Transferência de Área") {
      await reconcileTransferencia({
        mov: originalMovement,
        diff,
        findLoteById,
        findLoteByNomeArea,
      });
    }

    if (originalMovement.tipo === "Mudança de Categoria") {
      await reconcileMudancaCategoria({
        mov: originalMovement,
        diff,
        findLoteById,
        findLoteByNomeAreaCategoria,
      });
    }
  }

  if (originalMovement.tipo === "Pesagem") {
    if (!lotePrincipal) throw new Error("Não foi possível localizar o lote para reconciliar a pesagem.");
    await base44.entities.Lote.update(lotePrincipal.id, { peso_medio_kg: payload.peso_medio });
  }

  await base44.entities.MovimentacaoMapa.update(originalMovement.id, payload);
}