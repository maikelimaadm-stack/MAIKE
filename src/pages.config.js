/**
 * pages.config.js — registro de páginas do produto.
 *
 * Escopo do produto: Pecuária — Mapa Geral + Manejo.
 * A lista abaixo é validada por `npm run gate:product-scope` contra
 * `config/mapa-manejo-scope.json`. Adicionar página fora do manifesto reprova o gate.
 */
import MapaGeral from './pages/MapaGeral';
import __Layout from './Layout.jsx';
import { paginaSobDemanda } from './lib/paginaSobDemanda.jsx';

// D-PROD-304: só o Mapa Geral (a superfície primária) vem no pacote inicial; as outras
// telas carregam quando abertas — o app abre mais rápido e usa menos memória.
const MapaCadastro = paginaSobDemanda(() => import('./pages/MapaCadastro'));
const CadastroLotes = paginaSobDemanda(() => import('./pages/CadastroLotes'));
const CadastroSetores = paginaSobDemanda(() => import('./pages/CadastroSetores'));
const CategoriasManejo = paginaSobDemanda(() => import('./pages/CategoriasManejo'));
const Bebedouros = paginaSobDemanda(() => import('./pages/Bebedouros'));
const Produtos = paginaSobDemanda(() => import('./pages/Produtos'));
const Categorias = paginaSobDemanda(() => import('./pages/Categorias'));
const Marcas = paginaSobDemanda(() => import('./pages/Marcas'));
const UnidadesMedida = paginaSobDemanda(() => import('./pages/UnidadesMedida'));
const LocaisEstoque = paginaSobDemanda(() => import('./pages/LocaisEstoque'));
const Estoque = paginaSobDemanda(() => import('./pages/Estoque'));
const TiposTarefa = paginaSobDemanda(() => import('./pages/TiposTarefa'));
const TiposAtividade = paginaSobDemanda(() => import('./pages/TiposAtividade'));
const Estacoes = paginaSobDemanda(() => import('./pages/Estacoes'));
const Culturas = paginaSobDemanda(() => import('./pages/Culturas'));
const CurvasGanho = paginaSobDemanda(() => import('./pages/CurvasGanho'));
const Formulacoes = paginaSobDemanda(() => import('./pages/Formulacoes'));
const LancamentoAtividades = paginaSobDemanda(() => import('./pages/LancamentoAtividades'));
const GruposAtividades = paginaSobDemanda(() => import('./pages/GruposAtividades'));
const Servicos = paginaSobDemanda(() => import('./pages/Servicos'));
const Empresa = paginaSobDemanda(() => import('./pages/Empresa'));
const Usuarios = paginaSobDemanda(() => import('./pages/Usuarios'));
const Permissoes = paginaSobDemanda(() => import('./pages/Permissoes'));
const ConfiguracoesGerais = paginaSobDemanda(() => import('./pages/ConfiguracoesGerais'));
const Parceiros = paginaSobDemanda(() => import('./pages/Parceiros'));
const CentrosCusto = paginaSobDemanda(() => import('./pages/CentrosCusto'));
const CentrosResultado = paginaSobDemanda(() => import('./pages/CentrosResultado'));
const NaturezasFinanceiras = paginaSobDemanda(() => import('./pages/NaturezasFinanceiras'));
const LancamentosFinanceiros = paginaSobDemanda(() => import('./pages/LancamentosFinanceiros'));
const BensPatrimoniais = paginaSobDemanda(() => import('./pages/BensPatrimoniais'));
const Abastecimentos = paginaSobDemanda(() => import('./pages/Abastecimentos'));


export const PAGES = {
    "MapaGeral": MapaGeral,
    "MapaCadastro": MapaCadastro,
    "CadastroLotes": CadastroLotes,
    "CadastroSetores": CadastroSetores,
    "CategoriasManejo": CategoriasManejo,
    "Bebedouros": Bebedouros,
    "Produtos": Produtos,
    "Categorias": Categorias,
    "Marcas": Marcas,
    "UnidadesMedida": UnidadesMedida,
    "LocaisEstoque": LocaisEstoque,
    "Estoque": Estoque,
    "TiposTarefa": TiposTarefa,
    "TiposAtividade": TiposAtividade,
    "Estacoes": Estacoes,
    "Culturas": Culturas,
    "CurvasGanho": CurvasGanho,
    "Formulacoes": Formulacoes,
    "LancamentoAtividades": LancamentoAtividades,
    "GruposAtividades": GruposAtividades,
    "Servicos": Servicos,
    "Empresa": Empresa,
    "Usuarios": Usuarios,
    "Permissoes": Permissoes,
    "ConfiguracoesGerais": ConfiguracoesGerais,
    "Parceiros": Parceiros,
    "CentrosCusto": CentrosCusto,
    "CentrosResultado": CentrosResultado,
    "NaturezasFinanceiras": NaturezasFinanceiras,
    "LancamentosFinanceiros": LancamentosFinanceiros,
    "BensPatrimoniais": BensPatrimoniais,
    "Abastecimentos": Abastecimentos,
};

export const pagesConfig = {
    mainPage: "MapaGeral",
    Pages: PAGES,
    Layout: __Layout,
};
