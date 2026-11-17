import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { cn } from "@/lib/utils";

/*
 * D-PROD-222 — o cartão dos históricos do manejo como peça comum.
 *
 * É o mesmo desenho (as mesmas classes) do cartão do Histórico de Movimentação
 * (`HistoricoMovimentacoes`): selos (data, tipo, situação), título em negrito,
 * linhas "Rótulo: valor" e o rodapé de ações separado por um traço. Os
 * históricos que abrem pelos detalhes do mapa (cocho, depósito, bebedouro e o
 * abate do curral) usam estas peças para ficarem iguais aos do manejo.
 * Só apresentação: quem monta decide o que entra em cada cartão.
 */

/** @typedef {"data" | "neutro" | "verde" | "vermelho" | "ambar"} TomSelo */

/** @type {Record<Exclude<TomSelo, "data">, string>} */
const TOM_DO_SELO = {
  neutro: "text-[10px] text-slate-700 border-slate-300 bg-white",
  verde: "text-[10px] text-emerald-800 border-emerald-300 bg-emerald-50",
  vermelho: "text-[10px] text-red-800 border-red-300 bg-red-50",
  ambar: "text-[10px] text-amber-800 border-amber-300 bg-amber-50",
};

/**
 * Selo do cartão. `data` é o primeiro selo (a data), como no Histórico de
 * Movimentação; `verde`/`vermelho` são a situação (Ativo/Cancelado);
 * `ambar`, um alerta.
 * @param {React.HTMLAttributes<HTMLElement> & { tom?: TomSelo }} props
 */
export function SeloHistorico({ tom = "neutro", className, children, ...props }) {
  if (tom === "data") {
    return (
      <span className={cn("inline-flex items-center rounded-md border px-2.5 py-0.5 font-semibold text-[10px] text-slate-700 border-slate-300 bg-white", className)} {...props}>
        {children}
      </span>
    );
  }
  return (
    <Badge variant="outline" className={cn(TOM_DO_SELO[tom] || TOM_DO_SELO.neutro, className)} {...props}>
      {children}
    </Badge>
  );
}

/**
 * Uma linha "Rótulo: valor" do cartão.
 * @param {React.HTMLAttributes<HTMLDivElement> & { rotulo: React.ReactNode }} props
 */
export function LinhaHistorico({ rotulo, children, className, ...props }) {
  return (
    <div className={cn("break-words", className)} {...props}>
      <strong>{rotulo}:</strong> {children}
    </div>
  );
}

/**
 * Ação do rodapé do cartão (ex.: "Excluir"), com o botão do "Excluir
 * movimentação" do manejo: contorno, 32 px de altura, texto vermelho quando é
 * destrutiva e está ligada; cinza quando desligada.
 * @param {React.ButtonHTMLAttributes<HTMLButtonElement> & { destrutiva?: boolean }} props
 */
export function AcaoHistorico({ destrutiva = false, disabled = false, className, children, ...props }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("h-8 text-xs", destrutiva && !disabled ? "text-red-700" : "text-slate-500", className)}
      disabled={disabled}
      {...props}
    >
      {children}
    </Button>
  );
}

/**
 * O cartão. `children` são as linhas (`LinhaHistorico` ou notas); `rodape`,
 * as ações (ex.: "Excluir"); `cancelado` usa o fundo dos cancelados.
 * @param {Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & { selos?: React.ReactNode, titulo?: React.ReactNode, rodape?: React.ReactNode, cancelado?: boolean }} props
 */
export default function CartaoHistorico({ selos, titulo, rodape, cancelado = false, className, children, ...props }) {
  return (
    <div className={cn("border rounded-lg p-2.5 space-y-1", cancelado ? "border-slate-200 bg-[#FAFCFE]" : "border-slate-200 hover:bg-gray-50", className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          {selos ? <div className="flex flex-wrap items-center gap-1">{selos}</div> : null}
          {titulo ? <div className="text-xs font-semibold text-slate-900">{titulo}</div> : null}
          {children ? <div className="space-y-0.5 text-[10px] text-slate-600">{children}</div> : null}
        </div>
      </div>
      {rodape ? <div className="border-t border-slate-100 pt-1.5">{rodape}</div> : null}
    </div>
  );
}

/**
 * Estado do histórico sem cartões, com os textos e as classes do Histórico de
 * Movimentação: carregando (`role="status"`), erro (`role="alert"`, com a ação
 * de tentar de novo) e vazio.
 * No erro, `erro` (o erro da consulta) vira o motivo, como lá
 * (`getApiErrorMessage`, "Tente novamente em instantes."), e `onTentarDeNovo`
 * põe o botão "Tentar novamente" da referência.
 * @param {{ tipo?: "carregando" | "erro" | "vazio", children?: React.ReactNode, detalhe?: React.ReactNode, acao?: React.ReactNode, erro?: unknown, onTentarDeNovo?: () => void }} props
 */
export function EstadoHistorico({ tipo = "vazio", children, detalhe, acao, erro, onTentarDeNovo }) {
  if (tipo === "carregando") {
    return <div role="status" className="text-center text-sm text-slate-500">{children || "Carregando histórico..."}</div>;
  }
  if (tipo === "erro") {
    const motivo = detalhe ?? (erro !== undefined && erro !== null ? getApiErrorMessage(erro, "Tente novamente em instantes.") : null);
    const botao =
      acao ??
      (onTentarDeNovo ? (
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => onTentarDeNovo()}>
          Tentar novamente
        </Button>
      ) : null);
    return (
      <div role="alert" className="space-y-2 py-6 text-center text-sm text-slate-600">
        <div>{children || "Não foi possível carregar o histórico."}</div>
        {motivo ? <div className="text-[11px] text-slate-500">{motivo}</div> : null}
        {botao}
      </div>
    );
  }
  return <div className="text-center py-8 text-slate-500 text-sm">{children || "Nenhum lançamento encontrado"}</div>;
}

/**
 * Moldura do histórico, como a do Histórico de Movimentação dentro do
 * `LancLoteDialogo` (D-PROD-117): sem cartão em volta, a descrição na barra e a
 * lista sem rolagem própria (o diálogo é quem rola).
 * `antes` entra entre a barra e a lista (avisos); `estado` (carregando, erro,
 * vazio: `EstadoHistorico`) entra no lugar da lista.
 * @param {{ descricao?: React.ReactNode, barra?: React.ReactNode, antes?: React.ReactNode, estado?: React.ReactNode, children?: React.ReactNode }} props
 */
export function MolduraHistorico({ descricao, barra, antes, estado, children }) {
  return (
    <div className="mk-hist">
      {barra || descricao ? (
        <div className="mk-hist__barra">
          {barra}
          {descricao ? <p className="mk-hist__desc">{descricao}</p> : null}
        </div>
      ) : null}
      {antes}
      <div className="mk-hist__corpo">{estado || <div className="mk-hist__lista">{children}</div>}</div>
    </div>
  );
}

/**
 * Título do diálogo com a contagem, como o "Histórico da Área Pasto 07 (8)":
 * dentro do `LancLoteDialogo` o título vai para o cabeçalho; fora dele, nada.
 * `contagem` nula (carregando, erro) mostra só o título.
 * @param {string} titulo
 * @param {number | null} contagem
 */
export function useTituloDoHistorico(titulo, contagem) {
  const dialogo = useLancLoteDialogo();
  const texto = `${titulo}${typeof contagem === "number" && contagem > 0 ? ` (${contagem})` : ""}`;
  React.useEffect(() => {
    if (!dialogo) return undefined;
    dialogo.setTitulo(texto);
    return () => dialogo.setTitulo(null);
  }, [dialogo, texto]);
  return Boolean(dialogo);
}
