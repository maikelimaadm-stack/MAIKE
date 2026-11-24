import React from "react";
import { Beef, Sprout } from "lucide-react";
import { Aviso, Cartao, Celula, Chip, Grade, SecaoDetalhe, Vazio } from "@/components/mapa/detalhes-lote/blocos";
import { statusDaArea, VAZIO } from "@/components/mapa/detalhes-lote/catalogo";
import { usePasto } from "@/components/mapa/detalhes-lote/pastoContexto";
import { CORES_UA_HA } from "@/components/mapa/MapaFiltrosAvancados";
import "@/styles/mk-dp-detalhes-v13.css";

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */

/** Fim da escala da régua (UA/ha); acima disso o marcador fica preso na borda. */
export const ESCALA_UA_HA = 3;
/** Limites das faixas do mapa (MapaGeral: < 0,8 · < 1,2 · < 1,8 · < 2,4 · resto). */
const LIMITES_UA_HA = [0, 0.8, 1.2, 1.8, 2.4, ESCALA_UA_HA];
/** Faixas com gado, na ordem e com as cores de CORES_UA_HA (a 1ª chave é "Sem gado"). */
const FAIXAS_UA_HA = Object.keys(CORES_UA_HA).slice(1).map((chave, i) => ({
  nome: chave.split(" (")[0],
  cor: /** @type {Record<string, string>} */ (CORES_UA_HA)[chave],
  largura: ((LIMITES_UA_HA[i + 1] - LIMITES_UA_HA[i]) / ESCALA_UA_HA) * 100,
}));
const MARCAS = LIMITES_UA_HA.slice(1, -1);

/**
 * Número de um texto pt-BR do catálogo ("2,24", "1.008"); `null` para vazio.
 * @param {string | undefined} texto
 */
const numeroDe = (texto) => {
  if (!texto || texto === VAZIO) return null;
  const n = Number(String(texto).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Posição (0–100) do marcador na régua; preso às bordas fora da escala.
 * @param {number | null} valor
 */
export const posicaoNaRegua = (valor) => (valor === null ? null : Math.max(0, Math.min(100, (valor / ESCALA_UA_HA) * 100)));

/**
 * Régua de UA/ha com as faixas do mapa. Sem valor (sem gado, sem peso ou sem
 * hectares) não há marcador. O desenho é um `img` com o texto equivalente.
 * @param {{ texto: string, faixa: { rotulo: string, rotuloLongo: string } }} props
 */
export function ReguaUaHa({ texto, faixa }) {
  const pos = posicaoNaRegua(numeroDe(texto));
  const descricao = pos === null
    ? `UA/ha sem valor${faixa.rotulo !== VAZIO ? ` — ${faixa.rotulo}` : ""}`
    : `UA/ha ${texto} — ${faixa.rotuloLongo !== VAZIO ? faixa.rotuloLongo : "faixa desconhecida"}`;
  return (
    <div className="mk-dp-d13-regua" role="img" aria-label={descricao} data-posicao={pos === null ? undefined : pos.toFixed(1)}>
      <div className="mk-dp-d13-regua__trilho" aria-hidden="true">
        {FAIXAS_UA_HA.map((f) => (
          <span key={f.nome} style={{ width: `${f.largura}%`, background: f.cor }} />
        ))}
        {pos === null ? null : <i className="mk-dp-d13-regua__marcador" style={{ left: `${pos.toFixed(1)}%` }} />}
      </div>
      <div className="mk-dp-d13-regua__marcas" aria-hidden="true">
        {MARCAS.map((m) => (
          <span key={m} style={{ left: `${(m / ESCALA_UA_HA) * 100}%` }}>{String(m).replace(".", ",")}</span>
        ))}
      </div>
      <div className="mk-dp-d13-regua__nomes" aria-hidden="true">
        {FAIXAS_UA_HA.map((f) => (
          <span key={f.nome} style={{ width: `${f.largura}%` }} data-ativa={pos !== null && f.nome === faixa.rotulo ? "" : undefined}>{f.nome}</span>
        ))}
      </div>
    </div>
  );
}

/** Ordem da grade da Lotação (o UA/ha vai no título, com a régua). */
const ORDEM_LOTACAO = ["qtdLotes", "qtdCab", "uaTotal", "kgPvHa", "cabHa", "pesoMedio", "capacidade", "pctCap"];

/**
 * Aba Detalhes do pasto (v13): cartão da área (capim, status, áreas e dias de
 * pastejo — o nome e o setor já estão no cabeçalho do diálogo), Lotação com a
 * régua de UA/ha nas faixas do mapa e o aviso de capacidade. Tudo vem da casca
 * (`usePasto()`); a área usa todas as posições ativas dela (`lotesDaArea`).
 */
export function AbaDetalhes() {
  const { modelo, dados } = usePasto();
  const area = /** @type {ModeloDetalhes} */ (modelo).area;
  const status = React.useMemo(
    () => statusDaArea({ areaId: dados.areaId, cab: area.cab, movimentacoes: dados.movimentacoes, hoje: modelo.ctx?.hoje }),
    [dados.areaId, dados.movimentacoes, area.cab, modelo.ctx?.hoje],
  );
  const porChave = Object.fromEntries(area.lotacao.map((c) => [c.chave, c]));
  const uaHa = porChave.uaHa;

  return (
    <div className="mk-dp-area-organizada mk-dp-d13">
      <Cartao
        icone={Sprout}
        titulo={area.campos.pastagem.texto}
        sub="Pastagem"
        chip={<Chip tom={area.cab > 0 ? "ok" : "neutro"} className="mk-dp-d13-status">{status.texto}</Chip>}
        className="mk-dp-area-resumo mk-dp-d13-area"
      >
        <Grade className="mk-dp-d13-grade mk-dp-d13-grade--3">
          <Celula textoAutomatico rotulo="Área (ha)" valor={area.campos.hectares.texto} />
          <Celula textoAutomatico rotulo="Área pastejada (ha)" valor={area.campos.haPastejada.texto} />
          <Celula textoAutomatico rotulo={area.campos.dias.rotulo} valor={area.campos.dias.texto} />
        </Grade>
      </Cartao>
      <SecaoDetalhe titulo="Lotação" className="mk-dp-area-organizada__lotacao">
        <Cartao className="mk-dp-area-lotacao mk-dp-d13-lotacao">
          <div className="mk-dp-d13-uaha">
            <span className="mk-dp-d13-uaha__rot">UA/ha</span>
            <strong className="mk-dp-d13-uaha__val">{uaHa?.texto ?? VAZIO}</strong>
            {area.faixa.rotulo !== VAZIO ? (
              <Chip tom="neutro" className="mk-dp-d13-faixa" style={/** @type {React.CSSProperties} */ ({ "--mk-d13-faixa": area.faixa.cor })}>
                {area.faixa.rotulo}
              </Chip>
            ) : null}
          </div>
          <ReguaUaHa texto={uaHa?.texto ?? VAZIO} faixa={area.faixa} />
          <Grade className="mk-dp-d13-grade mk-dp-d13-grade--4">
            {ORDEM_LOTACAO.map((chave) => porChave[chave]).filter(Boolean).map((c) => (
              <Celula
                textoAutomatico
                key={c.chave}
                rotulo={c.rotulo}
                valor={c.texto}
                cor={c.cor}
                barra={c.barra}
                corBarra={c.corBarra}
              />
            ))}
          </Grade>
        </Cartao>
      </SecaoDetalhe>
      {area.alertas.map((a) => (
        <Aviso key={a.frase} tom={a.tom === "atencao" ? "atencao" : "neutro"}>
          {a.frase}
        </Aviso>
      ))}
      {area.categorias.length ? null : <Vazio icone={Beef}>Nenhum lote neste pasto agora.</Vazio>}
    </div>
  );
}

export default AbaDetalhes;
