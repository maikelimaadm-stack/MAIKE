import React from "react";
import { PESO_DA_UA_KG, diasPastejoDoLote } from "@/domain/areas/indicadoresArea";

const fmt = (valor, casas = 2) =>
  Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const inteiro = (valor) => Number(valor || 0).toLocaleString("pt-BR");
const texto = (valor) => String(valor || "-");

/**
 * Lotes que estão na área agora, com o que o manejo precisa ver: categoria,
 * cabeças, carga por cabeça, peso por cabeça e dias de pastejo — mais o total
 * da área (D-PROD-94a).
 *
 * @param {{ lotes?: any[] }} props
 */
export default function LotesDaArea({ lotes = [] }) {
  if (!lotes.length) {
    return <p className="mk-ar__vazio">Nenhum lote nesta área.</p>;
  }

  const linhas = lotes
    .map((lote) => {
      const cabecas = Number(lote?.quantidade_cabecas) || 0;
      const peso = Number(lote?.peso_medio_kg) || 0;
      return {
        id: lote?.id || `${lote?.nome}-${lote?.categoria}`,
        nome: texto(lote?.nome),
        categoria: texto(lote?.categoria_manejo_nome || lote?.categoria),
        cor: lote?.identificador_cor || null,
        cabecas,
        carga: peso / PESO_DA_UA_KG,
        peso,
        dias: diasPastejoDoLote(lote?.data_entrada),
      };
    })
    .sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));

  const totalCabecas = linhas.reduce((soma, l) => soma + l.cabecas, 0);
  const pesoTotal = linhas.reduce((soma, l) => soma + l.peso * l.cabecas, 0);
  const pesoMedio = totalCabecas > 0 ? pesoTotal / totalCabecas : 0;
  const diasPonderados = linhas.reduce((soma, l) => soma + l.dias * l.cabecas, 0);

  return (
    <div className="mk-ar__tabela">
      <table>
        <caption className="sr-only">Lotes nesta área</caption>
        <thead>
          <tr>
            <th scope="col">Lote</th>
            <th scope="col">Categoria</th>
            <th scope="col" className="is-num">Cabeças</th>
            <th scope="col" className="is-num">Carga (UA / cab.)</th>
            <th scope="col" className="is-num">Peso (kg / cab.)</th>
            <th scope="col" className="is-num">Dias</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id}>
              <td>
                {l.cor && <span className="mk-ar__ponto" style={{ backgroundColor: l.cor }} aria-hidden="true" />}
                {l.nome}
              </td>
              <td>{l.categoria}</td>
              <td className="is-num">{inteiro(l.cabecas)}</td>
              <td className="is-num">{fmt(l.carga)}</td>
              <td className="is-num">{fmt(l.peso, 0)}</td>
              <td className="is-num">{inteiro(l.dias)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Total</td>
            <td className="is-num">{inteiro(totalCabecas)}</td>
            <td className="is-num">{fmt(pesoMedio / PESO_DA_UA_KG)}</td>
            <td className="is-num">{fmt(pesoMedio, 0)}</td>
            <td className="is-num">{inteiro(totalCabecas > 0 ? Math.round(diasPonderados / totalCabecas) : 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
