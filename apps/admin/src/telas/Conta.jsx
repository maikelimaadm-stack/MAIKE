/**
 * Minha conta / Segurança: trocar senha ou login (senha atual + código do
 * autenticador), ver e revogar sessões, regerar códigos de recuperação.
 * Trocar senha ou login encerra TODAS as sessões, inclusive esta.
 */
import React, { useEffect, useState } from 'react';
import { api, mensagemDeErro } from '../api.js';
import { Aviso, Botao, Campo } from '../componentes.jsx';

const Reautenticacao = ({ valores, setValores, prefixo }) => (
  <>
    <Campo rotulo="Senha atual" id={`${prefixo}-senha-atual`}>
      <input id={`${prefixo}-senha-atual`} type="password" autoComplete="current-password" value={valores.senha_atual} onChange={(e) => setValores({ ...valores, senha_atual: e.target.value })} required />
    </Campo>
    <Campo rotulo="Código do autenticador" id={`${prefixo}-codigo`}>
      <input id={`${prefixo}-codigo`} inputMode="numeric" autoComplete="one-time-code" value={valores.codigo_mfa} onChange={(e) => setValores({ ...valores, codigo_mfa: e.target.value })} required />
    </Campo>
  </>
);

const vazio = { senha_atual: '', codigo_mfa: '' };

export default function Conta({ admin, onSessaoEncerrada, avisar }) {
  const [senha, setSenha] = useState({ ...vazio, nova_senha: '', confirmar: '' });
  const [login, setLogin] = useState({ ...vazio, novo_login: '' });
  const [codigosForm, setCodigosForm] = useState(vazio);
  const [codigos, setCodigos] = useState(null);
  const [sessoes, setSessoes] = useState([]);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState('');

  const carregarSessoes = () => api.sessoes().then(setSessoes, () => setSessoes([]));
  useEffect(() => {
    carregarSessoes();
  }, []);

  const rodar = async (nome, fn) => {
    setErro('');
    setOcupado(nome);
    try {
      await fn();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado('');
    }
  };

  return (
    <section aria-labelledby="titulo-conta">
      <div className="cabecalho-secao">
        <h2 id="titulo-conta">Minha conta e segurança</h2>
        <p className="texto-apoio">
          Administrador principal: <strong>{admin?.login}</strong> · segundo fator {admin?.mfa_ativo ? 'ativo' : 'pendente'}
        </p>
      </div>
      <Aviso tipo="erro" onFechar={() => setErro('')}>
        {erro}
      </Aviso>
      <div className="grade-2">
        <form
          className="painel formulario"
          aria-label="Trocar senha"
          onSubmit={(e) => {
            e.preventDefault();
            if (senha.nova_senha !== senha.confirmar) return setErro('A confirmação não confere com a nova senha.');
            rodar('senha', async () => {
              const { confirmar, ...dados } = senha;
              await api.trocarSenha(dados);
              avisar('sucesso', 'Senha trocada. Todas as sessões foram encerradas: entre de novo.');
              onSessaoEncerrada();
            });
          }}
        >
          <h3>Trocar senha</h3>
          <Reautenticacao valores={senha} setValores={setSenha} prefixo="senha" />
          <Campo rotulo="Nova senha" id="senha-nova" dica="Mínimo de 12 caracteres.">
            <input id="senha-nova" type="password" autoComplete="new-password" value={senha.nova_senha} onChange={(e) => setSenha({ ...senha, nova_senha: e.target.value })} required minLength={12} />
          </Campo>
          <Campo rotulo="Confirmar nova senha" id="senha-confirmar">
            <input id="senha-confirmar" type="password" autoComplete="new-password" value={senha.confirmar} onChange={(e) => setSenha({ ...senha, confirmar: e.target.value })} required />
          </Campo>
          <Botao type="submit" ocupado={ocupado === 'senha'}>
            Trocar senha
          </Botao>
        </form>
        <form
          className="painel formulario"
          aria-label="Trocar login"
          onSubmit={(e) => {
            e.preventDefault();
            rodar('login', async () => {
              await api.trocarLogin(login);
              avisar('sucesso', 'Login trocado. Todas as sessões foram encerradas: entre com o novo login.');
              onSessaoEncerrada();
            });
          }}
        >
          <h3>Trocar login</h3>
          <Reautenticacao valores={login} setValores={setLogin} prefixo="login" />
          <Campo rotulo="Novo login" id="login-novo">
            <input id="login-novo" autoComplete="username" value={login.novo_login} onChange={(e) => setLogin({ ...login, novo_login: e.target.value })} required />
          </Campo>
          <Botao type="submit" ocupado={ocupado === 'login'}>
            Trocar login
          </Botao>
        </form>
      </div>
      <div className="painel">
        <h3>Sessões ativas</h3>
        <ul className="sessoes">
          {sessoes.map((s) => (
            <li key={s.id}>
              {s.atual ? <strong>Esta sessão</strong> : 'Outra sessão'} · início {new Date(s.criada_em).toLocaleString('pt-BR')} · último uso{' '}
              {new Date(s.ultimo_uso_em).toLocaleString('pt-BR')}
              <br />
              <span className="campo-dica">{s.user_agent}</span>
            </li>
          ))}
        </ul>
        <Botao
          variante="secundario"
          ocupado={ocupado === 'sessoes'}
          disabled={sessoes.length < 2}
          onClick={() =>
            rodar('sessoes', async () => {
              const r = await api.revogarOutras();
              avisar('sucesso', `${r.revogadas} outra(s) sessão(ões) encerrada(s).`);
              await carregarSessoes();
            })
          }
        >
          Encerrar as outras sessões
        </Botao>
      </div>
      <form
        className="painel formulario"
        aria-label="Regerar códigos de recuperação"
        onSubmit={(e) => {
          e.preventDefault();
          rodar('codigos', async () => {
            const r = await api.regerarCodigos(codigosForm);
            setCodigos(r.codigos_recuperacao);
            setCodigosForm(vazio);
          });
        }}
      >
        <h3>Códigos de recuperação</h3>
        <p className="texto-apoio">Gerar novos invalida os anteriores não usados. Eles aparecem uma única vez.</p>
        {codigos ? (
          <ol className="codigos">
            {codigos.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ol>
        ) : (
          <>
            <Reautenticacao valores={codigosForm} setValores={setCodigosForm} prefixo="codigos" />
            <Botao type="submit" ocupado={ocupado === 'codigos'}>
              Gerar novos códigos
            </Botao>
          </>
        )}
      </form>
    </section>
  );
}
