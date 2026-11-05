import React from "react";

/**
 * Ícones em imagem dos manejos, enviados pelo proprietário (D-PROD-131).
 * Ficam no lugar de um ícone lucide nos quadros de AcoesDoLote
 * (mesma altura dos outros ícones — ver `.mk-al__img`).
 *
 * @param {string} src
 */
const iconeImagem = (src) => {
  /** @param {{ className?: string }} props */
  const Icone = ({ className = "" }) => (
    <img src={src} alt="" aria-hidden="true" draggable={false} className={`mk-al__img ${className}`.trim()} />
  );
  return Icone;
};

/** Mover: boi com as setas de ida e volta. */
export const IconeMoverAnimais = iconeImagem("/icons/mover-animais.png");

/** Pesar: balança digital com o visor 0.0. */
export const IconePesar = iconeImagem("/icons/pesar.png");

/** Nascimento: vaca com o bezerro e os símbolos de macho e fêmea. */
export const IconeNascimento = iconeImagem("/icons/nascimento.png");

/** Saída (antigo "Abate"): boi com o ícone de saída. */
export const IconeSaida = iconeImagem("/icons/saida.png");

/** Morte: animal deitado com o X. */
export const IconeMorte = iconeImagem("/icons/morte.png");

/** Juntar Lotes: boi com as setas que se encontram. */
export const IconeJuntarLotes = iconeImagem("/icons/juntar-lotes.png");

/** Mudar Categoria: bezerro → boi, cada um num quadro, com a seta entre eles. */
export const IconeMudarCategoria = iconeImagem("/icons/mudar-categoria.png");

/** Editar Informação (antigo "Renomear Lote"): boi com a ficha e o lápis. */
export const IconeEditarInformacao = iconeImagem("/icons/editar-informacao.png");
