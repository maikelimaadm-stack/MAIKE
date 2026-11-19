import { Fuel, Hammer, Layers, Beef, SprayCan, Scissors, Shovel, Sprout, Tractor, Truck, Wheat } from 'lucide-react';

/**
 * D-PROD-254 — o desenho de cada Tipo de atividade nos quadros de Manejos da área. O cadastro de tipos não guarda ícone:
 * vale o nome (o que o produtor reconhece) e, sem casar, a categoria do tipo. lucide, no mesmo tamanho e cor dos quadros do
 * lote (o CSS dos quadros manda). Sem casar nada, o trator.
 */

/** @param {unknown} v */
const semAcento = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** @type {ReadonlyArray<[RegExp, import('lucide-react').LucideIcon]>} */
const POR_NOME = [
  [/abastec|combust/, Fuel],
  [/aduba|fertiliz/, Wheat],
  [/aplica|pulveriz|defensiv|herbicid/, SprayCan],
  [/calag|gessag/, Shovel],
  [/grad|arac|subsol|prepar/, Layers],
  [/plant|semead|semeadura|sement/, Sprout],
  [/roca|rocag|capina|poda/, Scissors],
  [/transport|frete/, Truck],
];

/** @type {Record<string, import('lucide-react').LucideIcon>} */
const POR_CATEGORIA = {
  PREPARO_SOLO: Layers,
  PLANTIO: Sprout,
  TRATO_CULTURAL: Wheat,
  APLICACAO: SprayCan,
  COLHEITA: Wheat,
  PASTAGEM: Sprout,
  BENFEITORIA: Hammer,
  MANEJO_ANIMAL: Beef,
  OUTROS: Tractor,
};

/** @param {{ nome_tipo?: string, categoria?: string|null } | null | undefined} tipo */
export const iconeDoTipoAtividade = (tipo) => {
  const nome = semAcento(tipo?.nome_tipo);
  for (const [regra, Icone] of POR_NOME) if (regra.test(nome)) return Icone;
  return POR_CATEGORIA[String(tipo?.categoria ?? '')] ?? Tractor;
};
