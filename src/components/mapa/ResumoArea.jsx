import React from "react";
import { Sprout, Warehouse } from "lucide-react";
import { indicadoresDaArea } from "@/domain/areas/indicadoresArea";
import { ehCurral } from "@/domain/mapa/cliqueArea";

const fmt = (valor, casas = 2) =>
  Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const inteiro = (valor) => Number(valor || 0).toLocaleString("pt-BR");

/**
 * Resumo da área aberta no Mapa Geral: nome, tipo e os indicadores que decidem
 * o manejo — área total e útil, dias pastejados, bovinos, carga animal e taxa
 * de lotação (D-PROD-94a). Curral mostra a infraestrutura no lugar do pastejo.
 *
 * @param {{ area: any, lotes?: any[] }} props
 */
export default function ResumoArea({ area, lotes = [] }) {
  if (!area?.id) return null;

  const curral = ehCurral(area);
  const indicadores = indicadoresDaArea(area, lotes);
  const Icone = curral ? Warehouse : Sprout;
  const tipo = curral ? area.tipo_infraestrutura || area.tipo_pastagem || "Infraestrutura" : area.tipo_cultura || "Pastagem";
  const pastagem = curral ? null : area.tipo_pastagem;

  return (
    <div className="mk-ar" translate="no">
      <div className="mk-ar__cartao">
        <div className="mk-ar__cab">
          <span className="mk-ar__icone" aria-hidden="true">
            <Icone size={18} />
          </span>
          <div className="mk-ar__titulo">
            <h3 className="mk-ar__nome">{area.nome}</h3>
            <p className="mk-ar__sub">
              {tipo}
              {pastagem && <span className="mk-ar__chip">{pastagem}</span>}
              {!curral && area.aproveitamento_classificacao && (
                <span className="mk-ar__chip">{`Aproveitamento: ${area.aproveitamento_classificacao}`}</span>
              )}
            </p>
          </div>
        </div>

        {curral ? (
          <dl className="mk-ar__lista">
            <div>
              <dt>Tipo de infraestrutura</dt>
              <dd>{area.tipo_infraestrutura || area.tipo_pastagem || "-"}</dd>
            </div>
            <div>
              <dt>Tipo de área</dt>
              <dd>{area.tipo_cultura || "-"}</dd>
            </div>
          </dl>
        ) : (
          <dl className="mk-ar__lista mk-ar__lista--3">
            <div>
              <dt>Área total</dt>
              <dd>
                <b>{fmt(indicadores.areaTotal)}</b> ha
              </dd>
            </div>
            <div>
              <dt>Área útil</dt>
              <dd>
                <b>{fmt(indicadores.areaUtil)}</b> ha
              </dd>
            </div>
            <div>
              <dt>Dias pastejados</dt>
              <dd>
                <b>{inteiro(indicadores.diasPastejados)}</b> {indicadores.diasPastejados === 1 ? "dia" : "dias"}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {!curral && (
        <div className="mk-ar__cartao">
          <dl className="mk-ar__lista mk-ar__lista--3">
            <div>
              <dt>Bovinos</dt>
              <dd>
                <b>{inteiro(indicadores.cabecas)}</b> {indicadores.cabecas === 1 ? "cabeça" : "cabeças"}
              </dd>
            </div>
            <div>
              <dt>Carga animal</dt>
              <dd>
                <b>{fmt(indicadores.cargaAnimal)}</b> UA
              </dd>
            </div>
            <div>
              <dt>Taxa de lotação</dt>
              <dd>
                <b>{fmt(indicadores.taxaDeLotacao)}</b> UA / ha
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
