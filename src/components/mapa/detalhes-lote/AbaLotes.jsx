import ControlesLotes from '@/components/mapa/detalhes-lote/ControlesLotes';
import VistaResumo from '@/components/mapa/detalhes-lote/VistaResumo';
import VistaLote from '@/components/mapa/detalhes-lote/VistaLote';
import VistaLista from '@/components/mapa/detalhes-lote/VistaLista';

/** @typedef {import('./useEstadoLotes').EstadoLotes} EstadoLotes */
/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */

/**
 * Aba Lotes: linha de controles + a vista escolhida (Resumo · Lote · Lista).
 * O estado vem do Painel (`useEstadoLotes`), que também o usa no deslize e no Tudo.
 *
 * @param {{ modelo: ModeloDetalhes, estado: EstadoLotes }} props
 */
export default function AbaLotes({ modelo, estado }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ControlesLotes modelo={modelo} estado={estado} />
      {estado.vista === 'resumo' && <VistaResumo modelo={modelo} estado={estado} />}
      {estado.vista === 'lote' && <VistaLote modelo={modelo} estado={estado} />}
      {estado.vista === 'lista' && <VistaLista modelo={modelo} estado={estado} />}
    </div>
  );
}
