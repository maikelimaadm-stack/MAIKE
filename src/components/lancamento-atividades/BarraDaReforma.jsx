import React from "react";
import { Ban, CircleCheck, Sprout } from "lucide-react";
import { formatarDecimalLinha, formatarMoedaAtividade } from "@/lib/atividadeLinhasRegras";
import { ROTULO_DA_SITUACAO } from "@/lib/servicoVariosDias";
import { rotuloDoTipoFixo } from "@/lib/tiposFixosAtividade";
import { ROTULO_DO_STATUS_DA_REFORMA, STATUS_REFORMA, TIPOS_DE_REFORMA, diaCurtoDaReforma, textosDaNatureza } from "@/lib/reformaRegras";

/** O texto do tipo ("Reforma de pastagem"). @param {string} tipo */
const rotuloDoTipo = (tipo) => TIPOS_DE_REFORMA.find((t) => t.value === tipo)?.label ?? "Outro";

/** "40 ha" (sem valor, "—"). @param {unknown} v */
const ha = (v) => (v ? `${formatarDecimalLinha(String(v))} ha` : "—");

/**
 * MAIKE-ENTREGA3 (D-PROD-275) — a barra do filtro "Reforma", em cima da lista: o nome, a situação e o tipo da reforma, o
 * capim que vai ficar (com a natureza: recuperação ou renovação), o CUSTO TOTAL, o R$/ha (custo das realizações ÷ hectares
 * da reforma), o custo por tipo (Preparo, Fertilização, Aplicação, Plantio…) e os serviços em ordem de data com a situação
 * e o custo de cada um. Todo número vem do servidor (`GET /planejamentos/:id`, calculado na leitura com o mesmo custo da
 * lista); aqui só se formata. A realização cancelada aparece riscada e não soma. Os botões "Concluir reforma" e "Cancelar"
 * só aparecem com a permissão e com a reforma aberta.
 *
 * @param {{ reforma: any|null, carregando?: boolean, erro?: string|null, podeConcluir?: boolean, podeCancelar?: boolean,
 *   onConcluir?: (reforma: any) => void, onCancelar?: (reforma: any) => void }} props
 */
export default function BarraDaReforma({ reforma, carregando = false, erro = null, podeConcluir = false, podeCancelar = false, onConcluir, onCancelar }) {
  if (erro) {
    return (
      <div className="b1-reforma-barra" role="alert" data-testid="barra-reforma-erro">
        <p className="b1-reforma-barra__aviso">{erro}</p>
      </div>
    );
  }
  if (carregando || !reforma) {
    return (
      <div className="b1-reforma-barra" role="status" data-testid="barra-reforma-carregando">
        <p className="b1-reforma-barra__aviso">Lendo o custo da reforma…</p>
      </div>
    );
  }
  const custo = reforma.custo ?? {};
  const aberta = reforma.status === STATUS_REFORMA.ABERTO;
  const naturezas = textosDaNatureza(reforma.cultura_alvo_id, reforma.areas ?? []);
  const servicos = /** @type {any[]} */ (Array.isArray(custo.servicos) ? custo.servicos : []);
  const porTipo = /** @type {any[]} */ (Array.isArray(custo.por_tipo) ? custo.por_tipo : []);
  const areas = /** @type {any[]} */ (Array.isArray(reforma.areas) ? reforma.areas : []);
  return (
    <section className="b1-reforma-barra" aria-label={`Custo da ${reforma.nome}`} data-testid="barra-reforma" data-status={reforma.status}>
      <div className="b1-reforma-barra__topo">
        <span className="b1-reforma-barra__icone" aria-hidden>
          <Sprout size={18} strokeWidth={1.75} />
        </span>
        <div className="b1-reforma-barra__titulo">
          <strong data-testid="barra-reforma-nome">{reforma.nome}</strong>
          <span className="b1-reforma-barra__sub">
            {rotuloDoTipo(reforma.tipo)} · {areas.length === 1 ? areas[0].nome : `${areas.length} áreas`} · início {diaCurtoDaReforma(reforma.data_inicio)}
            {reforma.data_conclusao ? ` · concluída em ${diaCurtoDaReforma(reforma.data_conclusao)}` : ""}
          </span>
          {reforma.cultura_alvo ? (
            <span className="b1-reforma-barra__sub" data-testid="barra-reforma-capim">
              Capim que vai ficar: <strong>{reforma.cultura_alvo.nome}</strong> {naturezas.join(" · ")}
            </span>
          ) : null}
        </div>
        <span className={`b1-reforma-barra__chip b1-reforma-barra__chip--${String(reforma.status).toLowerCase()}`} data-testid="barra-reforma-status">
          {ROTULO_DO_STATUS_DA_REFORMA[reforma.status] ?? reforma.status}
        </span>
        {aberta && (podeConcluir || podeCancelar) ? (
          <div className="b1-reforma-barra__acoes">
            {podeConcluir ? (
              <button type="button" className="tb-btn tb-btn-outline b1-reforma-barra__botao" onClick={() => onConcluir?.(reforma)} data-testid="barra-reforma-concluir">
                <CircleCheck className="h-4 w-4" aria-hidden />
                Concluir reforma
              </button>
            ) : null}
            {podeCancelar ? (
              <button type="button" className="tb-btn tb-btn-outline b1-reforma-barra__botao" onClick={() => onCancelar?.(reforma)} data-testid="barra-reforma-cancelar">
                <Ban className="h-4 w-4" aria-hidden />
                Cancelar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <dl className="b1-reforma-barra__numeros">
        <div>
          <dt>Custo total</dt>
          <dd data-testid="barra-reforma-custo-total">{formatarMoedaAtividade(custo.custo_total) || "R$ 0,00"}</dd>
        </div>
        <div>
          <dt>R$/ha</dt>
          <dd data-testid="barra-reforma-custo-ha">{formatarMoedaAtividade(custo.custo_por_ha) || "—"}</dd>
        </div>
        <div>
          <dt>Área da reforma</dt>
          <dd data-testid="barra-reforma-hectares">{ha(custo.hectares ?? reforma.hectares)}</dd>
        </div>
        <div>
          <dt>Serviços</dt>
          <dd data-testid="barra-reforma-qtd">{servicos.length}</dd>
        </div>
      </dl>

      {porTipo.length ? (
        <ul className="b1-reforma-barra__tipos" aria-label="Custo por tipo" data-testid="barra-reforma-por-tipo">
          {porTipo.map((t) => (
            <li key={t.tipo_fixo}>
              <span>{t.rotulo || rotuloDoTipoFixo(t.tipo_fixo)}</span>
              <strong>{formatarMoedaAtividade(t.custo_total) || "R$ 0,00"}</strong>
            </li>
          ))}
        </ul>
      ) : null}

      {servicos.length ? (
        <ol className="b1-reforma-barra__servicos" aria-label="Serviços da reforma, em ordem de data" data-testid="barra-reforma-servicos">
          {servicos.map((x) => (
            <li key={x.atividade_id} className={x.conta_no_custo ? undefined : "b1-reforma-barra__servico--fora"} data-testid={`barra-reforma-servico-${x.atividade_id}`}>
              <span className="b1-reforma-barra__dia">{diaCurtoDaReforma(x.primeiro_dia ?? x.data_inicio)}</span>
              <span className="b1-reforma-barra__servico">
                <strong>{rotuloDoTipoFixo(x.tipo_fixo)}</strong> · {x.tipo_atividade_nome}
              </span>
              <span className={`b1-reforma-barra__situacao b1-reforma-barra__situacao--${String(x.situacao).toLowerCase()}`}>{ROTULO_DA_SITUACAO[x.situacao] ?? x.situacao}</span>
              <span className="b1-reforma-barra__valor">{x.conta_no_custo ? formatarMoedaAtividade(x.custo_total) || "—" : "não soma"}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="b1-reforma-barra__aviso" data-testid="barra-reforma-sem-servicos">
          Nenhuma realização nesta reforma ainda. Ao lançar um serviço numa área dela, a Nova realização já marca "Faz parte de".
        </p>
      )}
    </section>
  );
}
