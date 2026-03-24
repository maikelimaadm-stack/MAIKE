export const getUserDisplayName = (user) => {
  const nome = typeof user?.nome === "string" ? user.nome.trim() : "";
  const fullName = typeof user?.full_name === "string" ? user.full_name.trim() : "";
  return nome || fullName || user?.email || "";
};

export const getPermissionDisplayName = (permission, user) => {
  const nomePermissao = typeof permission?.user_nome === "string" ? permission.user_nome.trim() : "";
  return nomePermissao || getUserDisplayName(user);
};