import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { SecaoForm } from "@/components/gestao/GestaoFormParts";
import { useCelular } from "@/components/common/MobileSheet";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { detalharMovimentoEstoque } from "@/services/estoqueConsultaService";
import {
  ROTULO_ORIGEM,
  depositoDoMovimento,
  formatarCustoUnitario,
  formatarDia,
  formatarQtd,
  formatarReais,
  quantidadeComSinal,
  rotuloDoMovimento,
  rotuloSituacao,
} from "@/lib/estoqueConsultaRegras";
import { saidaDoMovimento } from "@/lib/estoqueSaidasRegras";
import { createPageUrl } from "@/utils";

/** Chave do detalhe (prefixo `estoque`: o que invalida o estoque invalida o detalhe). */
export const chaveDetalheMovimento = (/** @type {string|null} */ empresaId, /** @type {string|null} */ id) => ["estoque", "movimento", empresaId, id];

/** @param {{ rotulo: string, valor: React.ReactNode, testId?: string }} props */
function Linha({ rotulo, valor, testId = undefined }) {
  if (valor === null || valor === undefined || valor === "") return null;
  return (
    <div className="b1-janela__linha">
      <dt>{rotulo}</dt>
      <dd data-testid={testId}>{valor}</dd>
    </div>
  );
}

/** @param {{ titulo: string, children: React.ReactNode }} props */
function Grupo({ titulo, children }) {
  return (
    <div className="min-w-0" data-testid={`movimento-grupo-${titulo.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <div className="mg-b1-form-grid grid grid-cols-12">
        <SecaoForm titulo={titulo} />
      </div>
      <dl className="min-w-0">{children}</dl>
    </div>
  );
}

/** Parente do estorno (original ↔ estorno): "Nº 12 — Compra (20 L)". @param {any} p */
const textoDoParente = (p) => (p ? `Nº ${p.numero} — ${rotuloDoMovimento({ tipo_detalhado: p.tipo_detalhado, tipo: p.tipo })} (${formatarQtd(p.quantidade, p.unidade)})` : "");

/**
 * Detalhe de UM movimento do estoque (D-PROD-255), SOMENTE LEITURA, numa só janela: 680px no desktop e
 * `b1-janela--tela-cheia` no celular. Sem segundo diálogo: o documento de origem é um link de navegação; a ENTRADA do
 * estoque (D-PROD-259, sem página própria) fecha esta janela e abre a da entrada (`onAbrirEntrada`); a SAÍDA manual
 * (D-PROD-264, `origem_sistema = saida_estoque`) faz o mesmo com a da saída (`onAbrirSaida`).
 * @param {{ movimento: any|null, empresaId: string|null, onFechar: () => void, onAbrirEntrada?: (doc: { id: string, numero: string }) => void,
 *   onAbrirSaida?: (doc: { id: string, numero: string }) => void }} props
 */
export default function JanelaMovimentoEstoque({ movimento, empresaId, onFechar, onAbrirEntrada = undefined, onAbrirSaida = undefined }) {
  const celular = useCelular();
  const id = movimento?.id ? String(movimento.id) : null;
  const consulta = useQuery({
    queryKey: chaveDetalheMovimento(empresaId, id),
    queryFn: () => detalharMovimentoEstoque(empresaId, /** @type {string} */ (id)),
    enabled: Boolean(empresaId && id),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const d = /** @type {any} */ (consulta.data ?? null);
  // Enquanto o detalhe não chega, a linha da lista já mostra o essencial.
  const m = d ?? movimento;
  const vinculos = d?.vinculos ?? {};
  const camadas = Array.isArray(d?.camadas_consumidas) ? d.camadas_consumidas : [];
  const unidade = m?.unidade;
  // A saída manual é achada pelo documento do detalhe ou, sem ele, pelo `lancamento_origem_id` do movimento.
  const saida = saidaDoMovimento(d) ?? saidaDoMovimento(movimento);

  return (
    <B1Janela
      aberto={Boolean(movimento)}
      onFechar={onFechar}
      titulo={m ? `Movimento nº ${m.numero}` : "Movimento"}
      testId="janela-movimento-estoque"
      className={celular ? "b1-janela--tela-cheia" : ""}
      contentProps={{ className: celular ? "b1-janela__camada--tela-cheia" : "" }}
    >
      {m ? (
        <div className="min-w-0" data-testid="movimento-detalhe">
          <Grupo titulo="Movimento">
            <Linha rotulo="Data" valor={formatarDia(m.data)} testId="movimento-data" />
            <Linha rotulo="Tipo" valor={rotuloDoMovimento(m)} testId="movimento-tipo" />
            <Linha rotulo="Produto" valor={m.produto_nome} />
            <Linha rotulo="Quantidade" valor={quantidadeComSinal(m)} testId="movimento-quantidade" />
            <Linha rotulo="Depósito" valor={depositoDoMovimento(m)} />
            <Linha rotulo="Origem" valor={ROTULO_ORIGEM[m.origem_sistema] !== rotuloDoMovimento(m) ? (ROTULO_ORIGEM[m.origem_sistema] ?? m.origem_sistema) : null} />
            <Linha rotulo="Situação" valor={rotuloSituacao(m)} testId="movimento-situacao" />
          </Grupo>

          <Grupo titulo="Saldo e custo">
            <Linha rotulo="Saldo antes" valor={m.saldo_antes ? formatarQtd(m.saldo_antes, unidade) : ""} testId="movimento-saldo-antes" />
            <Linha rotulo="Saldo depois" valor={m.saldo_depois ? formatarQtd(m.saldo_depois, unidade) : ""} testId="movimento-saldo-depois" />
            <Linha rotulo="Custo unitário" valor={m.valor_unitario ? formatarCustoUnitario(m.valor_unitario) : ""} testId="movimento-custo" />
            <Linha rotulo="Valor" valor={m.valor_total ? formatarReais(m.valor_total) : ""} testId="movimento-valor" />
          </Grupo>

          {consulta.isError ? (
            <p role="alert" className="mt-2 text-[13px] text-red-800" data-testid="movimento-erro">
              {getApiErrorMessage(consulta.error, "Não foi possível abrir o detalhe do movimento.")}
              {" "}
              <button type="button" className="underline" onClick={() => consulta.refetch()}>
                Tentar novamente
              </button>
            </p>
          ) : null}

          {d ? (
            <>
              {d.documento || saida || d.numero_documento || d.fornecedor_nome || d.motivo || d.observacoes || d.responsavel || Object.values(vinculos).some(Boolean) ? (
                <Grupo titulo="Origem do movimento">
                  <Linha
                    rotulo="Documento"
                    testId="movimento-documento"
                    valor={
                      saida && onAbrirSaida ? (
                        <button type="button" className="underline" onClick={() => onAbrirSaida(saida)} data-testid="movimento-abrir-saida">
                          {saida.rotulo || (saida.numero ? `Saída nº ${saida.numero}` : "Saída manual")}
                        </button>
                      ) : d.documento?.tipo === "ENTRADA_ESTOQUE" && onAbrirEntrada ? (
                        <button type="button" className="underline" onClick={() => onAbrirEntrada(d.documento)} data-testid="movimento-abrir-entrada">
                          {d.documento.rotulo}
                        </button>
                      ) : d.documento?.pagina ? (
                        <Link className="underline" to={createPageUrl(d.documento.pagina)}>
                          {d.documento.rotulo}
                        </Link>
                      ) : d.documento ? (
                        d.documento.rotulo
                      ) : null
                    }
                  />
                  <Linha rotulo="Nota" valor={[d.tipo_documento, d.numero_documento].filter(Boolean).join(" ")} />
                  <Linha rotulo="Fornecedor" valor={d.fornecedor_nome} />
                  <Linha rotulo="Área" valor={vinculos.area} />
                  <Linha rotulo="Lote" valor={vinculos.lote} />
                  <Linha rotulo="Máquina" valor={vinculos.maquina} />
                  <Linha rotulo="Centro de custo" valor={vinculos.centro_custo} />
                  <Linha rotulo="Motivo" valor={d.motivo} />
                  <Linha rotulo="Observações" valor={d.observacoes} />
                  <Linha rotulo="Responsável" valor={d.responsavel} />
                </Grupo>
              ) : null}

              {camadas.length ? (
                <Grupo titulo="Camadas consumidas">
                  {camadas.map((/** @type {any} */ c, /** @type {number} */ i) => (
                    <Linha
                      key={`${c.lote_id ?? "lote"}-${i}`}
                      testId={`movimento-camada-${i}`}
                      rotulo={[c.numero_documento ? `Nota ${c.numero_documento}` : "Camada", c.fornecedor_nome, c.data_documento ? formatarDia(c.data_documento) : null].filter(Boolean).join(" · ")}
                      valor={`${formatarQtd(c.quantidade, c.unidade)} × ${formatarCustoUnitario(c.custo_unitario)}`}
                    />
                  ))}
                </Grupo>
              ) : null}

              {d.pai || d.filho ? (
                <Grupo titulo={d.pai ? "Estorno de" : "Estornado por"}>
                  <Linha rotulo="Movimento original" valor={textoDoParente(d.pai)} testId="movimento-pai" />
                  <Linha rotulo={d.origem_sistema === "deposito" ? "Movimento par" : "Estorno"} valor={textoDoParente(d.filho)} testId="movimento-filho" />
                </Grupo>
              ) : null}

            </>
          ) : consulta.isLoading ? (
            <p role="status" className="mt-2 text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="movimento-carregando">
              Carregando detalhe…
            </p>
          ) : null}
        </div>
      ) : null}
    </B1Janela>
  );
}
