import React from "react";
import { useMediaQuery } from "@/components/common/MobileSheet";

/*
 * Contexto da casca do Detalhes do Lote v12 (`PainelPasto`, D-PROD-218).
 *
 * A casca desenha o cabeçalho (pelo `LancLoteDialogo`), as abas, o corpo e o
 * rodapé, e guarda a pilha de telas (pasto › lote › manejos › configurar
 * tabela). As abas e as telas empilhadas não recebem props: leem tudo daqui.
 */

/** @typedef {"celular" | "tablet" | "desktop"} ModoPasto */

/**
 * @typedef {{ tipo: "pasto", aba: string }
 *   | { tipo: "lote", loteId: string }
 *   | { tipo: "manejos", loteId?: string | null }
 *   | { tipo: "configurarTabela" }} TelaPasto
 */

/**
 * @typedef {{
 *   areaId: string | null,
 *   areaNome: string,
 *   setorNome: string,
 *   lotesDoPasto: any[],
 *   movimentacoes: any[],
 *   empresaId: string | null,
 *   suplementacao: null | { pontos: any[], eventos: any[], hoje: any },
 *   onAbrirCocho: null | ((ponto: any) => void),
 * }} DadosPasto
 */

/**
 * @typedef {{
 *   mover: boolean,
 *   pesar: boolean,
 *   historico: boolean,
 *   supl: boolean,
 *   detalhesCocho: boolean,
 *   lancarSupl: boolean,
 *   historicoCocho: boolean,
 * }} PermissoesPasto
 */

/**
 * @typedef {{
 *   modo: ModoPasto,
 *   modelo: any,
 *   dados: DadosPasto,
 *   permissoes: PermissoesPasto,
 *   escopoPreferencias: null | { clienteId: string, login: string, empresaId: string },
 *   empurrar: (tela: TelaPasto) => void,
 *   voltar: () => void,
 *   selecao: Set<string>,
 *   alternarSelecao: (id: string) => void,
 *   definirSelecao: (ids: string[]) => void,
 *   slotRodape: HTMLElement | null,
 *   marcarRodapeProprio: (delta: number) => void,
 * }} Pasto
 */

export const PastoCtx = React.createContext(/** @type {Pasto | null} */ (null));

/**
 * Lê a casca. Fora de um `PainelPasto` (ou de um provedor de teste) é erro de uso.
 * @returns {Pasto}
 */
export function usePasto() {
  const ctx = React.useContext(PastoCtx);
  if (!ctx) throw new Error("usePasto() fora do PainelPasto");
  return ctx;
}

/**
 * Enquanto `ativo`, a aba/tela desenha o próprio rodapé (por portal em
 * `slotRodape`) e a casca esconde o rodapé padrão (Mover lotes · Pesar · Manejos).
 * Ex.: aba Suplementação com cocho (Lançar · Leitura · Histórico) e
 * Configurar tabela (Redefinir · Aplicar).
 * @param {boolean} ativo
 */
export function useRodapeProprio(ativo) {
  const { marcarRodapeProprio } = usePasto();
  React.useEffect(() => {
    if (!ativo) return undefined;
    marcarRodapeProprio(1);
    return () => marcarRodapeProprio(-1);
  }, [ativo, marcarRodapeProprio]);
}

/**
 * Celular < 768 px · tablet 768–1023 · desktop ≥ 1024 (mesmos cortes do CSS).
 * Usado pela casca do pasto e pela casca dos detalhes de uma tela (`CascaDetalhe`).
 * @returns {ModoPasto}
 */
export function useModoPasto() {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const tabletOuMais = useMediaQuery("(min-width: 768px)");
  return desktop ? "desktop" : tabletOuMais ? "tablet" : "celular";
}
