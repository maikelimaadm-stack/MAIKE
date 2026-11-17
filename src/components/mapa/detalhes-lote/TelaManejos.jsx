import React from "react";
import { LayoutGrid } from "lucide-react";
import { Vazio } from "./blocos";

/*
 * Tela empilhada "Manejos e históricos" do Detalhes do Lote v12 (D-PROD-V12,
 * especificação §F.2): os quadros de manejo e de histórico (`AcoesDoLote`,
 * montados pelo DetalhesLote com as permissões e as ações de hoje), no corpo
 * "lista" da casca. Sem rodapé. O título ("Manejos e históricos") e o sub
 * ("Lote X" ou o nome do pasto) vão no cabeçalho, pela casca.
 */

/** @param {{ manejos?: React.ReactNode }} props */
export default function TelaManejos({ manejos }) {
  if (manejos == null || manejos === false) return <Vazio icone={LayoutGrid}>Nenhum manejo disponível.</Vazio>;
  return <>{manejos}</>;
}
