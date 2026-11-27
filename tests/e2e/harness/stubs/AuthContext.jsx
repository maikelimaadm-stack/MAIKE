/** Harness E2E: sessão fixa do usuário de teste (sem servidor). */
import React from "react";
import { USUARIO } from "../dados.js";

const valor = { user: USUARIO, usuario: USUARIO, clienteId: "cli-e2e", isAuthenticated: true, isLoadingAuth: false, logout: () => {}, checkAppState: () => {} };
export const AuthProvider = ({ children }) => <>{children}</>;
export const useAuth = () => valor;
export default { AuthProvider, useAuth };
