/**
 * D-PROD-230 — mostra a resposta do assistente com formatação simples, sem HTML:
 * linhas "- " / "* " / "1. " viram lista, **negrito** vira negrito e "# título" vira
 * linha em negrito. Tudo passa pelo React como texto (nada de innerHTML).
 */
import React from 'react';

/** @param {string} linha */
const comNegrito = (linha) =>
  linha.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith('**') && parte.endsWith('**') && parte.length > 4 ? <strong key={i}>{parte.slice(2, -2)}</strong> : parte,
  );

/** @param {{ texto: string }} props */
export default function TextoAssistente({ texto }) {
  const blocos = [];
  let itens = null;
  const fecharLista = () => {
    if (itens) blocos.push(<ul key={`l${blocos.length}`} className="my-1 list-disc space-y-0.5 pl-5">{itens}</ul>);
    itens = null;
  };
  String(texto ?? '').split('\n').forEach((bruta, i) => {
    const linha = bruta.trimEnd();
    const item = linha.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      itens = itens ?? [];
      itens.push(<li key={i}>{comNegrito(item[1])}</li>);
      return;
    }
    fecharLista();
    if (!linha.trim()) return;
    const titulo = linha.match(/^#{1,6}\s+(.*)$/);
    blocos.push(
      <p key={i} className={blocos.length ? 'mt-2' : ''}>
        {titulo ? <strong>{titulo[1].replace(/\*\*/g, '')}</strong> : comNegrito(linha)}
      </p>,
    );
  });
  fecharLista();
  return <>{blocos}</>;
}
