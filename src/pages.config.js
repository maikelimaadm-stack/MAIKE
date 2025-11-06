import Dashboard from './pages/Dashboard';
import Relatorios from './pages/Relatorios';
import Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "Relatorios": Relatorios,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: Layout,
};