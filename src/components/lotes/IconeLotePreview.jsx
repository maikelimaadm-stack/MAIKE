/**
 * Prévia do ícone do lote no formulário (D-PROD-191) — somente leitura.
 *
 * O desenho vem do CÓDIGO (`src/assets/icones/lotes`), pela chave SEXO + FAIXA DE IDADE
 * da Categoria de Manejo escolhida: é o subícone dos detalhes — o animal sozinho, na cor
 * do sexo, nunca o misto (o misto é só do marcador do pasto). Nada de upload, de rede,
 * de query nem de cache: aparece offline. O lote não guarda ícone.
 *
 * É a linha de dica sob o campo Categoria de Manejo (D-PROD-164): amostra pequena + texto.
 *   - nenhuma categoria → nada (o formulário passa null também quando a escolhida não
 *     está na lista carregada: sem ela não há como saber o desenho);
 *   - categoria sem sexo ou sem faixa de idade → "Sem ícone: …" (o sexo e a categoria
 *     oficial gravados no lote NÃO completam a chave: quem manda é a categoria).
 */
import React from "react";
import { figuraDaPosicao, urlSubiconeLote } from "@/assets/icones/lotes";

/** Largura da amostra na dica, em px (o traço branco do subícone é calculado para ela). */
const LARGURA_AMOSTRA_PX = 16;

/** @param {{ sexo: string, faixa: string }} animal */
const rotuloDoAnimal = (animal) => `${animal.sexo === "FEMEA" ? "Fêmea" : "Macho"}, ${animal.faixa}`;

/**
 * @param {{ categoria?: { id?: string|number|null, sexo?: string|null, idade_minima_meses?: unknown, idade_maxima_meses?: unknown }|null }} props
 *   `categoria`: a Categoria de Manejo escolhida no lote (null = nenhuma).
 */
export default function IconeLotePreview({ categoria = null }) {
  if (!categoria) return null;
  const animal = figuraDaPosicao({ categoria_manejo_id: categoria.id }, [categoria]);
  const url = animal ? urlSubiconeLote(animal.figura, LARGURA_AMOSTRA_PX) : null;

  if (!animal || !url) {
    return (
      <p className="b1-campo-dica" data-testid="icone-lote-categoria" data-status="sem_icone">
        Sem ícone: categoria sem sexo ou faixa de idade
      </p>
    );
  }

  return (
    <p className="b1-campo-dica" data-testid="icone-lote-categoria" data-status="ok" data-figura={animal.figura}>
      <img src={url} alt={rotuloDoAnimal(animal)} width={LARGURA_AMOSTRA_PX} className="flex-none" style={{ height: "auto" }} />
      Ícone da categoria
    </p>
  );
}
