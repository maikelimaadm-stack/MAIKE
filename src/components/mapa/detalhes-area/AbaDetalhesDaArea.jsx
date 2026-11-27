import React from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Sprout } from "lucide-react";
import { B1MenuAcoesDaLinha } from "@/components/cadastro/base1/B1AcoesDaLinha";
import { VerCustoContext, useVerCusto } from "@/components/lancamento-atividades/VerCusto";
import { Cartao, Celula, Chip, Grade, Linha, SecaoDetalhe, Vazio } from "@/components/mapa/detalhes-lote/blocos";
import { useAcoesTelaAtividades, useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { podeVerCusto } from "@/lib/verCustoRegras";
import { iconeDoTipoAtividade } from "@/lib/iconesTipoAtividade";
import { formatarMoedaAtividade } from "@/lib/atividadeLinhasRegras";
import { formatarDiaAtividade } from "@/lib/lancamentoAtividadesRegras";
import { QUERY_ATIVIDADES_DA_AREA, rotuloDoMesCurto } from "@/lib/registroDeCampoRegras";
import { STATUS_AREA } from "@/lib/atividadeAreasRegras";
import { chaveApontamentos, itensDaLista } from "@/lib/atividadeApontamentoRegras";
import { frentesDosApontamentos, resumoDasFrentes, textoDasMaquinasEmCampo } from "@/lib/aberturaServicoRegras";
import { textoDaReformaNaArea } from "@/lib/reformaRegras";
import { definirFazendaDaTela, listarApontamentos, obterResumoDaArea } from "@/services/lancamentoAtividadesService";
import { useAcoesDaAtividadeDaArea } from "./AcoesDaAtividadeDaArea";

import "@/styles/mk-dp-detalhes-v13.css";
import "@/styles/mk-dp-area-v13.css";


/*
 * Aba Detalhes da área (D-PROD-254), no desenho do Detalhes do Lote v12: o cartão da área (nome, hectares, tipo,
 * cultura/forragem, situação), as atividades em andamento (nome, feito/previsto e a situação em chip) e os custos da área
 * no mês. Os números das atividades e dos custos são do servidor (`GET /atividades-por-area/:id/resumo`); aqui só se
 * formatam. Sem a permissão de ver atividades, as duas seções simplesmente não aparecem (o resto da aba fica).
 *
 * MAIKE-ENTREGA3 (D-PROD-276): com uma reforma ABERTA na área (o resumo traz as reformas), o cartão da área mostra
 * "Em reforma desde 10/09" (o início previsto; ainda no futuro, "Reforma prevista para 10/09") e o nome dela embaixo.
 *
 * MAIKE-MAPA-ATIVIDADE-ACOES (D-PROD-278): com permissão de lançar ou de concluir, a linha da atividade é tocável e abre o
 * menu das ações rápidas (o do ⚡ da lista: janela presa à linha no computador, folha de baixo no celular) — "+ Lançar
 * dia", "Só máquina / mão de obra / insumo / serviço de terceiro" (presos nesta área) e "Concluir"
 * (`AcoesDaAtividadeDaArea`). Sem permissão, a linha fica como era (só leitura).
 *
 * MAIKE-AREA-V13 (D-PROD-289): a mesma aba agora serve três seções (`secao`), cada uma com um assunto só, no visual v13
 * dos Detalhes do Lote — "detalhes" (o cartão da área e um resumo de uma linha de Manejos e Custos, que leva à aba),
 * "manejos" (as atividades em andamento e planejadas, com a barra do feito) e "custos" (total, por hectare e a barra
 * insumos × máquinas e mão de obra). Os números continuam os do servidor; nada é calculado aqui além da proporção da barra.
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
  if (a.area_status === STATUS_AREA.CONCLUIDA) return { rotulo: "Finalizada", tom: /** @type {"ok"} */ ("ok") };
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
 * D-PROD-348 (item 2): o `subDaAtividade` e, com frente aberta, "N máquinas em campo" (o mesmo texto do cartão da atividade
 * no Diário). `frentes` nulo (lendo ou com erro) ou sem frente aberta → só o texto de antes.
 * @param {any} a uma atividade do resumo
 * @param {any[] | null} frentes as frentes lidas da atividade (`frentesDosApontamentos`), ou nulo
 */
const subDaAtividadeComMaquinas = (a, frentes) => {
  const abertas = frentes ? resumoDasFrentes(frentes).abertas : 0;
  const base = subDaAtividade(a);
  return abertas > 0 ? `${base} · ${textoDasMaquinasEmCampo(abertas)}` : base;
};

/**
 * @param {{ area: any, setorNome?: string, ocupada?: boolean | null, verAtividades: boolean, tipos?: any[], secao?: "detalhes" | "manejos" | "custos", onIrAba?: (aba: string) => void }} props
 *   `tipos`: as operações ativas (as que os Detalhes da área já leem), para as ações da atividade.
 */
/** @param {{ area: any, setorNome?: string, ocupada?: boolean | null, verAtividades: boolean, tipos?: any[], secao?: "detalhes" | "manejos" | "custos", onIrAba?: (aba: string) => void }} props */
export default function AbaDetalhesDaArea(props) {
  // Diário da máquina (Fase 2): R$ só para o administrador da fazenda (`podeVerCusto`).
  const acoesTela = useAcoesTelaAtividades();
  return (
    <VerCustoContext.Provider value={podeVerCusto(acoesTela.permissaoEfetiva)}>
      <ConteudoAbaDetalhesDaArea {...props} />
    </VerCustoContext.Provider>
  );
}

/** @param {{ area: any, setorNome?: string, ocupada?: boolean | null, verAtividades: boolean, tipos?: any[], secao?: "detalhes" | "manejos" | "custos", onIrAba?: (aba: string) => void }} props */
function ConteudoAbaDetalhesDaArea({ area, ocupada = null, verAtividades, tipos = [], secao = "detalhes", onIrAba }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const verCusto = useVerCusto();
  definirFazendaDaTela(empresaId);
  const resumo = useQuery({
    queryKey: [QUERY_ATIVIDADES_DA_AREA, "resumo", empresaId, area.id],
    queryFn: () => obterResumoDaArea(String(area.id)),
    enabled: Boolean(empresaId && area?.id && verAtividades),
    staleTime: 15 * 1000,
  });
  const atividades = resumo.data?.atividades ?? [];
  // D-PROD-348 (item 2): as máquinas em campo de cada atividade EM ANDAMENTO (a linha diz "N máquinas em campo"). Lê os
  // apontamentos com a MESMA chave e o MESMO serviço do Diário das atividades (sem chamada a mais, o cache é o mesmo).
  // Lendo ou com erro, a linha fica como era (`frentesPorAtividade` não tem a atividade → sem trecho).
  const emAndamentoLista = atividades.filter((a) => a.area_status !== STATUS_AREA.CONCLUIDA && a.area_status !== STATUS_AREA.PLANEJADA);
  const frentesLidas = useQueries({
    queries: emAndamentoLista.map((a) => ({
      queryKey: chaveApontamentos(empresaId, String(a.atividade_id)),
      queryFn: () => listarApontamentos(String(a.atividade_id)),
      enabled: Boolean(empresaId && verAtividades && a.atividade_id),
      staleTime: 15 * 1000,
    })),
  });
  /** @type {Map<string, any[]>} */
  const frentesPorAtividade = new Map();
  emAndamentoLista.forEach((a, i) => {
    const consulta = frentesLidas[i];
    if (consulta?.isSuccess) frentesPorAtividade.set(String(a.atividade_id), frentesDosApontamentos(itensDaLista(consulta.data)));
  });
  const custos = resumo.data?.custos ?? null;
  const mes = rotuloDoMesCurto(resumo.data?.mes);
  const cultura = texto(area.tipo_cultura) !== "Infraestrutura" ? texto(area.cultura?.nome || area.tipo_pastagem) : "";
  const { hoje } = useFusoDaFazenda(empresaId);
  // D-PROD-276: a reforma aberta da área (a mais antiga).
  const reformas = verAtividades && resumo.isSuccess && Array.isArray(resumo.data?.planejamentos) ? resumo.data.planejamentos : [];
  const emReforma = textoDaReformaNaArea(reformas, hoje);
  // D-PROD-278: as ações rápidas da atividade tocada.
  const acoesDaAtividade = useAcoesDaAtividadeDaArea({ area, tipos });
  const pronto = verAtividades && resumo.isSuccess;

  const listaDeAtividades = atividades.length ? (
    <Cartao className="mk-da13-ativs">
      {atividades.map((a) => {
        const s = situacaoDaAtividade(a);
        const props = {
          textoAutomatico: true,
          icone: iconeDoTipoAtividade({ nome_tipo: a.tipo_atividade_nome }),
          rotulo: a.nome,
          sub: subDaAtividadeComMaquinas(a, frentesPorAtividade.get(String(a.atividade_id)) ?? null),
          valor: <Chip tom={s.tom}>{s.rotulo}</Chip>,
        };
        const grupos = acoesDaAtividade.gruposDe(a);
        const linha = !grupos ? (
          <Linha {...props} data-testid={`area-atividade-${a.atividade_id}`} />
        ) : (
          <B1MenuAcoesDaLinha
            rotulo={`Ações da atividade ${a.numero != null ? `nº ${a.numero}` : a.nome}`}
            titulo={[a.numero != null ? `Nº ${a.numero}` : "", a.nome].filter(Boolean).join(" · ")}
            subtitulo={subDaAtividade(a)}
            grupos={grupos}
            testId={`area-atividade-${a.atividade_id}`}
            gatilho={(b) => (
              <Linha
                {...props}
                {...b}
                // No computador o Popover põe o clique; no celular ele já vem (a folha de baixo).
                onClick={b.onClick ?? (() => {})}
                chevron
                aria-busy={acoesDaAtividade.buscando || undefined}
                title="Ações da atividade"
              />
            )}
          />
        );
        const pct = proporcaoFeita(a);
        return (
          <div key={a.atividade_id} className="mk-da13-ativ">
            {linha}
            {pct == null ? null : (
              <span className={`mk-da13-prog mk-da13-prog--${s.tom}`} aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </span>
            )}
          </div>
        );
      })}
    </Cartao>
  ) : (
    <Vazio icone={Sprout}>Nenhuma atividade nesta área agora.</Vazio>
  );

  // D-PROD-341: o diário das atividades (a pílula "Manejos" do rodapé e a ação de linha) é o DiarioDoPasto; não há botão aqui.
  if (secao === "manejos") {
    return (
      <div className="mk-dp-area-organizada mk-dp-d13">
        {pronto ? <SecaoDetalhe titulo="Em andamento e planejado">{listaDeAtividades}</SecaoDetalhe> : null}
        {acoesDaAtividade.janelas}
      </div>
    );
  }

  if (secao === "custos") {
    // Sem permissão de ver R$ (operador), a seção de custos não aparece.
    return (
      <div className="mk-dp-area-organizada mk-dp-d13">
        {verCusto && pronto && custos ? <BlocoDeCustos custos={custos} mes={mes} /> : null}
        {verCusto && pronto && !custos ? <Vazio icone={Sprout}>Nenhum custo lançado nesta área no mês.</Vazio> : null}
      </div>
    );
  }

  const situacao = ocupada === null ? null : ocupada ? "OCUPADO" : "VAZIO";
  const emAndamento = atividades.filter((a) => a.area_status !== STATUS_AREA.CONCLUIDA && a.area_status !== STATUS_AREA.PLANEJADA);
  const planejadas = atividades.filter((a) => a.area_status === STATUS_AREA.PLANEJADA);
  const contagem = [
    emAndamento.length ? `${emAndamento.length} em andamento` : "",
    planejadas.length ? `${planejadas.length} ${planejadas.length > 1 ? "planejados" : "planejado"}` : "",
  ].filter(Boolean).join(" · ");
  const destaque = emAndamento[0];

  return (
    <div className="mk-dp-area-organizada mk-dp-d13">
      <Cartao
        icone={Sprout}
        titulo={cultura || area.nome}
        sub={cultura ? "Cultura / forragem" : undefined}
        chip={situacao ? <Chip tom={ocupada ? "ok" : "neutro"} className="mk-dp-d13-status">{situacao}</Chip> : null}
        className="mk-dp-area-resumo mk-dp-d13-area"
      >
        <Grade className="mk-dp-area-superficies mk-dp-d13-grade mk-dp-d13-grade--3">
          <Celula textoAutomatico rotulo="Área (ha)" valor={ha2(area.tamanho_hectares) || "—"} />
          <Celula textoAutomatico rotulo="Tipo" valor={tipoDaAreaTexto(area).toUpperCase()} />
          {situacao ? <Celula textoAutomatico rotulo="Situação" valor={situacao} /> : null}
        </Grade>
        {/* D-PROD-276: a reforma aberta da área, numa linha inteira (o nome é longo). */}
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

      {pronto ? (
        <SecaoDetalhe titulo="Resumo">
          <Cartao className="mk-da13-resumo">
            <Linha
              rotulo="Manejos"
              sub={contagem || "Nenhuma atividade agora"}
              valor={destaque ? <Chip tom="atencao">{`${destaque.tipo_atividade_nome || destaque.nome}${destaque.area_planejada ? ` ${ha(destaque.area_executada || 0)} de ${ha(destaque.area_planejada)} ha` : ""}`}</Chip> : null}
              chevron
              onClick={onIrAba ? () => onIrAba("manejos") : undefined}
              data-testid="area-resumo-manejos"
            />
            {verCusto ? (
              <Linha
                rotulo={`Custos${mes ? ` · ${mes}` : ""}`}
                sub={custos ? `${formatarMoedaAtividade(custos.custo_por_ha) || "—"} por hectare` : "Nenhum custo no mês"}
                valor={custos ? <strong className="mk-da13-total">{formatarMoedaAtividade(custos.custo_total) || "—"}</strong> : null}
                chevron
                onClick={onIrAba ? () => onIrAba("custos") : undefined}
                data-testid="area-resumo-custos"
              />
            ) : null}
          </Cartao>
        </SecaoDetalhe>
      ) : null}
      {acoesDaAtividade.janelas}
    </div>
  );
}

/** Quanto da área já foi feito (0–100), para a barra; sem área planejada, sem barra. @param {any} a */
function proporcaoFeita(a) {
  const plan = Number(a.area_planejada);
  if (!Number.isFinite(plan) || plan <= 0) return null;
  const feito = Number(a.area_executada || 0);
  return Math.max(0, Math.min(100, Number.isFinite(feito) ? (feito / plan) * 100 : 0));
}

/**
 * Custos do mês (D-PROD-289): total e por hectare em destaque, a barra insumos × máquinas e mão de obra (e serviços,
 * quando houver) e cada parte com a sua porcentagem.
 * @param {{ custos: any, mes: string }} props
 */
function BlocoDeCustos({ custos, mes }) {
  const maq = somaMaquinasMaoObra(custos);
  const partes = [
    { chave: "insumos", rotulo: "Insumos", valor: custos.insumos },
    { chave: "maquinas", rotulo: "Máquinas e mão de obra", valor: maq },
    ...(Number(custos.servicos) > 0 ? [{ chave: "servicos", rotulo: "Serviços", valor: custos.servicos }] : []),
  ];
  const total = partes.reduce((t, p) => t + Math.max(0, Number(p.valor) || 0), 0);
  /** @param {unknown} v */
  const pct = (v) => (total > 0 ? Math.round((Math.max(0, Number(v) || 0) / total) * 100) : 0);
  return (
    <SecaoDetalhe titulo={`Custos da área${mes ? ` · ${mes}` : ""}`}>
      <Cartao className="mk-da13-custos">
        <div className="mk-da13-custos__topo">
          <span>
            <small>Custo total</small>
            <strong>{formatarMoedaAtividade(custos.custo_total) || "—"}</strong>
          </span>
          <span className="mk-da13-custos__ha">
            <small>Por hectare</small>
            <strong>{formatarMoedaAtividade(custos.custo_por_ha) || "—"}</strong>
          </span>
        </div>
        {total > 0 ? (
          <span className="mk-da13-custos__barra" aria-hidden="true">
            {partes.map((p) => (
              <i key={p.chave} className={`mk-da13-cor--${p.chave}`} style={{ flexGrow: Math.max(0, Number(p.valor) || 0) }} />
            ))}
          </span>
        ) : null}
        <Grade className="mk-dp-d13-grade mk-da13-custos__partes">
          {partes.map((p) => (
            <Celula
              key={p.chave}
              textoAutomatico
              rotulo={
                <>
                  <i className={`mk-da13-marca mk-da13-cor--${p.chave}`} aria-hidden="true" />
                  {p.rotulo}
                </>
              }
              valor={`${formatarMoedaAtividade(p.valor) || "—"}${total > 0 ? ` · ${pct(p.valor)}%` : ""}`}
            />
          ))}
        </Grade>
      </Cartao>
    </SecaoDetalhe>
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
