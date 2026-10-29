/**
 * Tipos de entidade e categorias visuais. O `codigo` é a identidade lógica
 * estável (não se edita); rótulo, ordem e estado podem mudar. Nada se apaga
 * fisicamente: desativar tira da leitura dos clientes.
 */
import React, { useState } from 'react';
import { catalogo } from '../api.js';
import { Botao, Campo, IdCurto } from '../componentes.jsx';

const CODIGO = '^[a-z0-9_]+$';

const LinhaEditavel = ({ item, onSalvar, extra }) => {
  const [nome, setNome] = useState(item.nome);
  const [ordem, setOrdem] = useState(item.ordem);
  const [ocupado, setOcupado] = useState(false);
  const mudou = nome !== item.nome || Number(ordem) !== item.ordem;
  const salvar = async (dados) => {
    setOcupado(true);
    try {
      await onSalvar(dados);
    } catch {
      /* aviso já exibido */
    } finally {
      setOcupado(false);
    }
  };
  return (
    <tr className={item.ativo ? '' : 'linha-inativa'} data-testid="linha-catalogo" data-codigo={item.codigo}>
      <td>
        <code>{item.codigo}</code>
        <br />
        <IdCurto id={item.id} />
      </td>
      <td>
        <input aria-label={`Nome de ${item.codigo}`} value={nome} onChange={(e) => setNome(e.target.value)} />
      </td>
      <td>
        <input aria-label={`Ordem de ${item.codigo}`} type="number" min="0" className="estreito" value={ordem} onChange={(e) => setOrdem(e.target.value)} />
      </td>
      {extra}
      <td className="acoes-linha">
        <Botao variante="secundario" ocupado={ocupado} disabled={!mudou || !nome.trim()} onClick={() => salvar({ nome: nome.trim(), ordem: Number(ordem) })}>
          Salvar
        </Botao>
        <Botao variante={item.ativo ? 'perigo' : 'secundario'} ocupado={ocupado} onClick={() => salvar({ ativo: !item.ativo })}>
          {item.ativo ? 'Desativar' : 'Reativar'}
        </Botao>
      </td>
    </tr>
  );
};

const NovoItem = ({ titulo, onCriar, comTipo, tipos }) => {
  const [codigo, setCodigo] = useState('');
  const [nome, setNome] = useState('');
  const [ordem, setOrdem] = useState(0);
  const [tipoId, setTipoId] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const enviar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      await onCriar({ codigo, nome: nome.trim(), ordem: Number(ordem), ...(comTipo ? { tipo_id: tipoId } : {}) });
      setCodigo('');
      setNome('');
    } catch {
      /* aviso já exibido */
    } finally {
      setOcupado(false);
    }
  };
  const p = titulo.toLowerCase().includes('tipo') ? 'tipo' : 'categoria';
  return (
    <form className="formulario em-linha" onSubmit={enviar} aria-label={titulo}>
      {comTipo ? (
        <Campo rotulo="Tipo" id={`novo-${p}-tipo`}>
          <select id={`novo-${p}-tipo`} value={tipoId} onChange={(e) => setTipoId(e.target.value)} required>
            <option value="">Selecione</option>
            {tipos.filter((t) => t.ativo).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </Campo>
      ) : null}
      <Campo rotulo="Código" id={`novo-${p}-codigo`} dica="minúsculas, números e _ (não muda depois)">
        <input id={`novo-${p}-codigo`} value={codigo} pattern={CODIGO} onChange={(e) => setCodigo(e.target.value.toLowerCase())} required />
      </Campo>
      <Campo rotulo="Nome" id={`novo-${p}-nome`}>
        <input id={`novo-${p}-nome`} value={nome} onChange={(e) => setNome(e.target.value)} required />
      </Campo>
      <Campo rotulo="Ordem" id={`novo-${p}-ordem`}>
        <input id={`novo-${p}-ordem`} type="number" min="0" className="estreito" value={ordem} onChange={(e) => setOrdem(e.target.value)} />
      </Campo>
      <Botao type="submit" ocupado={ocupado}>
        {titulo}
      </Botao>
    </form>
  );
};

export default function Categorias({ dados, executar }) {
  const [tipoFiltro, setTipoFiltro] = useState('');
  const nomeTipo = new Map(dados.tipos.map((t) => [t.id, t.nome]));
  const categorias = dados.categorias.filter((c) => !tipoFiltro || c.tipo_id === tipoFiltro);
  return (
    <section aria-labelledby="titulo-categorias">
      <div className="cabecalho-secao">
        <h2 id="titulo-categorias">Tipos e categorias</h2>
        <p className="texto-apoio">
          O tipo <code>lote</code> é o que as Categorias de Manejo dos clientes podem vincular. Categorias desativadas deixam de aparecer para eles.
        </p>
      </div>
      <div className="painel">
        <h3>Tipos de entidade</h3>
        <NovoItem titulo="Criar tipo" onCriar={(d) => executar(() => catalogo.criarTipo(d), 'Tipo criado.')} />
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>Ordem</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {dados.tipos.map((t) => (
                <LinhaEditavel key={`${t.id}:${t.nome}:${t.ordem}:${t.ativo}`} item={t} onSalvar={(d) => executar(() => catalogo.atualizarTipo(t.id, d), 'Tipo atualizado.')} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="painel">
        <h3>Categorias visuais</h3>
        <NovoItem titulo="Criar categoria" comTipo tipos={dados.tipos} onCriar={(d) => executar(() => catalogo.criarCategoria(d), 'Categoria criada.')} />
        <Campo rotulo="Mostrar tipo" id="categorias-filtro">
          <select id="categorias-filtro" value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
            <option value="">Todos</option>
            {dados.tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </Campo>
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>Ordem</th>
                <th>Tipo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {categorias.map((c) => (
                <LinhaEditavel
                  key={`${c.id}:${c.nome}:${c.ordem}:${c.ativo}`}
                  item={c}
                  extra={<td>{nomeTipo.get(c.tipo_id)}</td>}
                  onSalvar={(d) => executar(() => catalogo.atualizarCategoria(c.id, d), 'Categoria atualizada.')}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
