import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Root as Popover, Content as PopoverContent, Trigger as PopoverTrigger, Portal } from '@radix-ui/react-popover';
import { filtroSemRestricao } from '@/lib/mapaFiltroSelecao';

/** Lista ancorada ao campo, com seleção múltipla em todas as telas. */
export default function MapaFiltroSelecao({ value, onChange, children, className = '', 'aria-label': rotulo }) {
  const [busca, setBusca] = React.useState('');
  const opcoes = [];
  const ler = (nos) => React.Children.forEach(nos, (no) => {
    if (!React.isValidElement(no)) return;
    const props = /** @type {{value?: string, children?: React.ReactNode}} */ (no.props);
    if (no.type === 'option') opcoes.push({ value: String(props.value), label: String(props.children) });
    else if (no.type === React.Fragment) ler(props.children);
  });
  ler(children);
  const padrao = opcoes[0];
  const todas = filtroSemRestricao(value);
  const selecionados = todas ? [] : Array.isArray(value) ? value : [value];
  const texto = todas ? padrao?.label : selecionados.length > 1 ? `${selecionados.length} selecionados` : opcoes.find(o => o.value === selecionados[0])?.label;
  const marcar = (valor) => {
    const novos = selecionados.includes(valor) ? selecionados.filter(v => v !== valor) : [...selecionados, valor];
    onChange({ target: { value: novos.length ? novos : padrao.value } });
  };
  return <Popover onOpenChange={() => setBusca('')}>
    <PopoverTrigger asChild>
      <button type="button" role="combobox" aria-label={rotulo} className={className}>
        <span>{texto || padrao?.label}</span><ChevronDown aria-hidden size={12} />
      </button>
    </PopoverTrigger>
    <Portal><PopoverContent align="end" sideOffset={5} collisionPadding={8} className="mk-map-multi-popup" aria-label={rotulo}>
      <div className="mk-map-multi-title">{rotulo}</div>
      {opcoes.length > 8 && <input type="search" aria-label={`Pesquisar ${rotulo}`} placeholder="Procurar opção..." value={busca} onChange={e => setBusca(e.target.value)} />}
      <div className="mk-map-multi-options">
        {padrao && <label><input type="checkbox" checked={todas} onChange={() => onChange({ target: { value: padrao.value } })} /><span>{padrao.label}</span></label>}
        {opcoes.slice(1).filter(o => o.label.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR'))).map(o => <label key={o.value}>
          <input type="checkbox" checked={selecionados.includes(o.value)} onChange={() => marcar(o.value)} /><span>{o.label}</span>
        </label>)}
      </div>
    </PopoverContent></Portal>
  </Popover>;
}
