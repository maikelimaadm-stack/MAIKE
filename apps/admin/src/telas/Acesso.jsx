/**
 * Entrar → segundo fator (TOTP ou código de recuperação) → ou, no primeiro
 * acesso, inscrição obrigatória do autenticador. Nada é guardado no navegador
 * além do cookie HttpOnly que o servidor define.
 */
import React, { useEffect, useState } from 'react';
import { api, mensagemDeErro } from '../api.js';
import { Aviso, Botao, Campo } from '../componentes.jsx';

const Moldura = ({ titulo, children }) => (
  <main className="acesso">
    <section className="acesso-cartao" aria-labelledby="acesso-titulo">
      <p className="marca">MAIKE Admin</p>
      <h1 id="acesso-titulo">{titulo}</h1>
      {children}
    </section>
  </main>
);

/**
 * Primeiro acesso (D-PROD-78): cria o proprietário pela web, sem terminal.
 * Só aparece enquanto não existe proprietário. Exige a chave que o próprio
 * proprietário colocou nas variáveis do servidor; depois some para sempre.
 */
const PrimeiroAcesso = ({ onCriado }) => {
  const [chave, setChave] = useState('');
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [repetir, setRepetir] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    if (senha !== repetir) {
      setErro('As senhas não conferem.');
      return;
    }
    setOcupado(true);
    try {
      await api.criarProprietario({ chave, login, senha });
      setChave('');
      setSenha('');
      setRepetir('');
      onCriado(login);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <Moldura titulo="Primeiro acesso">
      <p className="texto-apoio">
        Crie o login do proprietário do MAIKE. Esta tela só existe uma vez: depois de criado, ela some.
        Cole a <strong>chave do MAIKE Admin</strong> que você cadastrou nas variáveis do servidor, no Vercel.
      </p>
      <form onSubmit={enviar} className="formulario">
        <Campo rotulo="Chave do MAIKE Admin" id="admin-chave">
          <input id="admin-chave" type="password" autoComplete="off" value={chave} onChange={(e) => setChave(e.target.value)} required />
        </Campo>
        <Campo rotulo="Login do proprietário" id="admin-novo-login">
          <input id="admin-novo-login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
        </Campo>
        <Campo rotulo="Senha (mínimo 12 caracteres)" id="admin-nova-senha">
          <input id="admin-nova-senha" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </Campo>
        <Campo rotulo="Repita a senha" id="admin-repetir-senha">
          <input id="admin-repetir-senha" type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} required />
        </Campo>
        <Aviso tipo="erro">{erro}</Aviso>
        <Botao type="submit" ocupado={ocupado}>
          Criar proprietário
        </Botao>
      </form>
    </Moldura>
  );
};

export const Entrar = ({ onEtapa }) => {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [primeiro, setPrimeiro] = useState(false);
  const [criado, setCriado] = useState(false);
  useEffect(() => {
    let vivo = true;
    api
      .primeiroAcesso()
      .then((r) => vivo && setPrimeiro(Boolean(r?.disponivel)))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);
  if (primeiro) {
    return (
      <PrimeiroAcesso
        onCriado={(novoLogin) => {
          setLogin(novoLogin);
          setPrimeiro(false);
          setCriado(true);
        }}
      />
    );
  }
  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      const r = await api.entrar(login, senha);
      setSenha('');
      onEtapa(r);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <Moldura titulo="Entrar">
      <p className="texto-apoio">Área exclusiva do proprietário do MAIKE. Clientes usam o MAIKE normal.</p>
      {criado && <Aviso tipo="sucesso">Proprietário criado. Entre com o login e a senha; em seguida o MAIKE Admin pede o código do autenticador.</Aviso>}
      <form onSubmit={enviar} className="formulario">
        <Campo rotulo="Login" id="admin-login">
          <input id="admin-login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
        </Campo>
        <Campo rotulo="Senha" id="admin-senha">
          <input id="admin-senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </Campo>
        <Aviso tipo="erro">{erro}</Aviso>
        <Botao type="submit" ocupado={ocupado}>
          Continuar
        </Botao>
      </form>
    </Moldura>
  );
};

export const SegundoFator = ({ onEtapa, onVoltar }) => {
  const [codigo, setCodigo] = useState('');
  const [usarRecuperacao, setUsarRecuperacao] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      const r = usarRecuperacao ? await api.usarRecuperacao(codigo) : await api.confirmarMfa(codigo);
      onEtapa(r);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      if (falha?.code === 'ADMIN_SESSAO_REQUIRED') onVoltar();
    } finally {
      setOcupado(false);
    }
  };
  return (
    <Moldura titulo="Segundo fator">
      <p className="texto-apoio">
        {usarRecuperacao
          ? 'Digite um dos códigos de recuperação guardados. Cada código vale uma vez e encerra as outras sessões.'
          : 'Abra o aplicativo autenticador e digite o código de 6 dígitos.'}
      </p>
      <form onSubmit={enviar} className="formulario">
        <Campo rotulo={usarRecuperacao ? 'Código de recuperação' : 'Código do autenticador'} id="admin-codigo">
          <input
            id="admin-codigo"
            inputMode={usarRecuperacao ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            required
          />
        </Campo>
        <Aviso tipo="erro">{erro}</Aviso>
        <Botao type="submit" ocupado={ocupado}>
          Confirmar
        </Botao>
        <button type="button" className="link" onClick={() => { setUsarRecuperacao(!usarRecuperacao); setCodigo(''); }}>
          {usarRecuperacao ? 'Usar o autenticador' : 'Perdi o autenticador — usar código de recuperação'}
        </button>
        <button type="button" className="link" onClick={onVoltar}>
          Voltar
        </button>
      </form>
    </Moldura>
  );
};

export const InscreverMfa = ({ onEtapa, onVoltar }) => {
  const [dados, setDados] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [codigos, setCodigos] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const gerar = async () => {
    setErro('');
    setOcupado(true);
    try {
      setDados(await api.iniciarInscricao());
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  };
  const confirmar = async (e) => {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      const r = await api.confirmarInscricao(codigo);
      setCodigos(r.codigos_recuperacao);
      setResultado(r);
      setDados(null);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  };
  if (codigos) {
    return (
      <Moldura titulo="Guarde os códigos de recuperação">
        <p className="texto-apoio">
          Eles aparecem <strong>só agora</strong>. Guarde em local seguro (fora deste computador). Cada um permite entrar uma vez se o
          autenticador for perdido.
        </p>
        <ol className="codigos" data-testid="codigos-recuperacao">
          {codigos.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ol>
        <Botao onClick={() => onEtapa(resultado)}>Já guardei — continuar</Botao>
      </Moldura>
    );
  }
  return (
    <Moldura titulo="Ative o segundo fator">
      <p className="texto-apoio">
        Obrigatório antes de qualquer operação. Use um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password…).
      </p>
      {!dados ? (
        <Botao onClick={gerar} ocupado={ocupado}>
          Gerar chave do autenticador
        </Botao>
      ) : (
        <form onSubmit={confirmar} className="formulario">
          <Campo rotulo="Chave para digitar no aplicativo" dica="No aplicativo: adicionar conta → inserir chave manualmente (tipo: baseada em tempo).">
            <code className="segredo" data-testid="segredo-totp">
              {dados.segredo.replace(/(.{4})/g, '$1 ').trim()}
            </code>
          </Campo>
          <details>
            <summary>Link otpauth (para gerenciadores de senha)</summary>
            <code className="segredo">{dados.otpauth_uri}</code>
          </details>
          <Campo rotulo="Código de 6 dígitos mostrado no aplicativo" id="admin-codigo-inscricao">
            <input id="admin-codigo-inscricao" inputMode="numeric" autoComplete="one-time-code" value={codigo} onChange={(e) => setCodigo(e.target.value)} required />
          </Campo>
          <Botao type="submit" ocupado={ocupado}>
            Ativar
          </Botao>
        </form>
      )}
      <Aviso tipo="erro">{erro}</Aviso>
      <button type="button" className="link" onClick={onVoltar}>
        Sair
      </button>
    </Moldura>
  );
};
