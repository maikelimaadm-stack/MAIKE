import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Sprout } from "lucide-react";
import { Cartao, Celula, Chip, Grade, Linha, SecaoDetalhe, Vazio } from "@/components/mapa/detalhes-lote/blocos";
import PainelForragemArea from "@/components/pastagem/PainelForragemArea";
import { useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { iconeDoTipoAtividade } from "@/lib/iconesTipoAtividade";
import { formatarMoedaAtividade } from "@/lib/atividadeLinhasRegras";
import { formatarDiaAtividade } from "@/lib/lancamentoAtividadesRegras";
import { QUERY_ATIVIDADES_DA_AREA, rotuloDoMesCurto } from "@/lib/registroDeCampoRegras";
import { STATUS_AREA } from "@/lib/atividadeAreasRegras";
import { textoDaReformaNaArea } from "@/lib/reformaRegras";
import { definirFazendaDaTela, obterResumoDaArea } from "@/services/lancamentoAtividadesService";


/*
 * Aba Detalhes da área (D-PROD-254), no desenho do Detalhes do Lote v12: o cartão da área (nome, hectares, tipo,
 * cultura/forragem, situação), as atividades em andamento (nome, feito/previsto e a situação em chip) e os custos da área
 * no mês. Os números das atividades e dos custos são do servidor (`GET /atividades-por-area/:id/resumo`); aqui só se
 * formatam. Sem a permissão de ver atividades, as duas seções simplesmente não aparecem (o resto da aba fica).
 *
 * MAIKE-ENTREGA3 (D-PROD-275): com uma reforma ABERTA na área (o resumo traz as reformas), o cartão da área mostra
 * "Em reforma desde 10/09" (o início previsto; ainda no futuro, "Reforma prevista para 10/09") e o nome dela embaixo.
 */

/** @param {unknown} v */
const texto = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
/** @param {unknown} v */
const ha = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "";
};
/** Os hectares do cartão da área, com duas casas ("22,00"). @param {unknown} v */
const ha2 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
};

/** Pasto, talhão ou infraestrutura, pelo uso da área. @param {any} area */
export const tipoDaAreaTexto = (area) => {
  const uso = texto(area?.tipo_cultura).toLowerCase();
  if (uso === "infraestrutura") return texto(area?.tipo_infraestrutura || area?.tipo_pastagem) || "Infraestrutura";
  if (uso === "agricultura") return "Talhão";
  return "Pasto";
};

/** @param {any} a uma atividade do resumo */
const situacaoDaAtividade = (a) => {
  if (a.area_status === STATUS_AREA.CONCLUIDA) return { rotulo: "Concluída", tom: /** @type {"ok"} */ ("ok") };
  if (a.area_status === STATUS_AREA.PLANEJADA) return { rotulo: "Planejada", tom: /** @type {"neutro"} */ ("neutro") };
  return { rotulo: "Em andamento", tom: /** @type {"atencao"} */ ("atencao") };
};

/** "Feito 12 de 22 ha · até 30/11/2026". @param {any} a */
const subDaAtividade = (a) => {
  const feito = a.area_planejada ? `Feito ${ha(a.area_executada || 0)} de ${ha(a.area_planejada)} ha` : `Feito ${ha(a.area_executada || 0)} ha`;
  const fim = formatarDiaAtividade(a.data_prevista_fim);
  if (!fim || a.area_status === STATUS_AREA.CONCLUIDA) return feito;
  return `${feito} · ${a.area_status === STATUS_AREA.PLANEJADA ? "previsto" : "até"} ${fim}`;
};

/**
 * @param {{ area: any, setorNome?: string, ocupada?: boolean | null, verAtividades: boolean, forragem: boolean }} props
 */
export default function AbaDetalhesDaArea({ area, ocupada = null, verAtividades, forragem }) {
  const empresaId = useEmpresaRealSelecionadaId();
  definirFazendaDaTela(empresaId);
  const resumo = useQuery({
    queryKey: [QUERY_ATIVIDADES_DA_AREA, "resumo", empresaId, area.id],
    queryFn: () => obterResumoDaArea(String(area.id)),
    enabled: Boolean(empresaId && area?.id && verAtividades),
    staleTime: 15 * 1000,
  });
  const atividades = resumo.data?.atividades ?? [];
  const custos = resumo.data?.custos ?? null;
  const mes = rotuloDoMesCurto(resumo.data?.mes);
  const cultura = texto(area.tipo_cultura) !== "Infraestrutura" ? texto(area.cultura?.nome || area.tipo_pastagem) : "";
  const { hoje } = useFusoDaFazenda(empresaId);
  // D-PROD-275: a reforma aberta da área (a mais antiga).
  const reformas = verAtividades && resumo.isSuccess && Array.isArray(resumo.data?.planejamentos) ? resumo.data.planejamentos : [];
  const emReforma = textoDaReformaNaArea(reformas, hoje);

  return (
    <div className="mk-dp-area-organizada">
      <Cartao icone={Sprout} titulo={area.nome} className="mk-dp-area-resumo">
        <Grade className="mk-dp-area-superficies">
          <Celula textoAutomatico rotulo="Área (ha)" valor={ha2(area.tamanho_hectares) || "—"} />
          <Celula textoAutomatico rotulo="Tipo" valor={tipoDaAreaTexto(area).toUpperCase()} />
          {cultura ? <Celula textoAutomatico rotulo="Cultura / forragem" valor={cultura} /> : null}
          {ocupada === null ? null : <Celula textoAutomatico rotulo="Situação" valor={ocupada ? "OCUPADO" : "VAZIO"} />}
        </Grade>
        {/* D-PROD-275: a reforma aberta da área, numa linha inteira (o nome é longo). */}
        {emReforma ? (
          <Linha
            icone={Sprout}
            rotulo={emReforma}
            sub={reformas.length > 1 ? `${reformas[0].nome} (+${reformas.length - 1})` : reformas[0].nome}
            valor={<Chip tom="atencao">Reforma</Chip>}
            className="mk-dp-area-reforma"
            data-testid="detalhes-area-em-reforma"
          />
        ) : null}
      </Cartao>

      {verAtividades && resumo.isSuccess ? (
        <>
          <SecaoDetalhe titulo="Atividades em andamento">
            {atividades.length ? (
              <Cartao>
                {atividades.map((a) => {
                  const s = situacaoDaAtividade(a);
                  return (
                    <Linha
                      key={a.atividade_id}
                      textoAutomatico
                      icone={iconeDoTipoAtividade({ nome_tipo: a.tipo_atividade_nome })}
                      rotulo={a.nome}
                      sub={subDaAtividade(a)}
                      valor={<Chip tom={s.tom}>{s.rotulo}</Chip>}
                    />
                  );
                })}
              </Cartao>
            ) : (
              <Vazio icone={Sprout}>Nenhuma atividade nesta área agora.</Vazio>
            )}
          </SecaoDetalhe>
          {custos ? (
            <SecaoDetalhe titulo={`Custos da área${mes ? ` · ${mes}` : ""}`}>
              <Cartao>
                <Grade>
                  <Celula textoAutomatico rotulo="Custo total" valor={formatarMoedaAtividade(custos.custo_total) || "—"} />
                  <Celula textoAutomatico rotulo="Por hectare" valor={formatarMoedaAtividade(custos.custo_por_ha) || "—"} />
                  <Celula textoAutomatico rotulo="Insumos" valor={formatarMoedaAtividade(custos.insumos) || "—"} />
                  <Celula textoAutomatico rotulo="Máquinas e mão de obra" valor={formatarMoedaAtividade(somaMaquinasMaoObra(custos)) || "—"} />
                  {Number(custos.servicos) > 0 ? <Celula textoAutomatico rotulo="Serviços" valor={formatarMoedaAtividade(custos.servicos)} /> : null}
                </Grade>
              </Cartao>
            </SecaoDetalhe>
          ) : null}
        </>
      ) : null}
      {forragem ? <PainelForragemArea area={area} /> : null}
    </div>
  );
}

/**
 * "Máquinas e mão de obra": a soma dos dois que o servidor mandou, em centavos inteiros (sem float).
 * @param {{ maquinas?: string|null, mao_obra?: string|null }} c
 */
function somaMaquinasMaoObra(c) {
  /** @param {unknown} v */
  const centavos = (v) => {
    const m = /^(-?\d+)(?:\.(\d+))?$/.exec(String(v ?? "0"));
    if (!m) return 0n;
    const frac = (m[2] ?? "").padEnd(2, "0").slice(0, 2);
    return BigInt(m[1]) * 100n + (m[1].startsWith("-") ? -BigInt(frac) : BigInt(frac));
  };
  const t = centavos(c.maquinas) + centavos(c.mao_obra);
  const abs = t < 0n ? -t : t;
  return `${t < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
