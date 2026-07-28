/**
 * pages.config.js — registro de páginas do produto.
 *
 * Escopo do produto: Pecuária — Mapa Geral + Manejo.
 * A lista abaixo é validada por `npm run gate:product-scope` contra
 * `config/mapa-manejo-scope.json`. Adicionar página fora do manifesto reprova o gate.
 */
import MapaGeral from './pages/MapaGeral';
import MapaCadastro from './pages/MapaCadastro';
import CadastroLotes from './pages/CadastroLotes';
import CadastroSetores from './pages/CadastroSetores';
import CategoriasManejo from './pages/CategoriasManejo';
import Bebedouros from './pages/Bebedouros';
import Produtos from './pages/Produtos';
import Categorias from './pages/Categorias';
import Marcas from './pages/Marcas';
import UnidadesMedida from './pages/UnidadesMedida';
import LocaisEstoque from './pages/LocaisEstoque';
import TiposTarefa from './pages/TiposTarefa';
import GruposAtividades from './pages/GruposAtividades';
import Empresa from './pages/Empresa';
import Usuarios from './pages/Usuarios';
import ConfiguracoesGerais from './pages/ConfiguracoesGerais';
import __Layout from './Layout.jsx';

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
    "TiposTarefa": TiposTarefa,
    "GruposAtividades": GruposAtividades,
    "Empresa": Empresa,
    "Usuarios": Usuarios,
    "ConfiguracoesGerais": ConfiguracoesGerais,
};

export const pagesConfig = {
    mainPage: "MapaGeral",
    Pages: PAGES,
    Layout: __Layout,
};
