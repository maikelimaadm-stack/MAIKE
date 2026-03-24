export const EXCLUDED_SYSTEM_USER_EMAILS = ["ciarac@wix.com", "omerber@base44.com"];

export const isExcludedSystemUser = (userOrEmail) => {
  const email = typeof userOrEmail === "string" ? userOrEmail : userOrEmail?.email;
  return EXCLUDED_SYSTEM_USER_EMAILS.includes((email || "").toLowerCase());
};

export const getUserDisplayName = (user) => {
  const nome = typeof user?.nome === "string"
    ? user.nome.trim()
    : typeof user?.data?.nome === "string"
      ? user.data.nome.trim()
      : "";
  const fullName = typeof user?.full_name === "string" ? user.full_name.trim() : "";
  return nome || fullName || user?.email || "";
};

export const getPermissionDisplayName = (permission, user) => {
  const nomePermissao = typeof permission?.user_nome === "string"
    ? permission.user_nome.trim()
    : typeof permission?.data?.user_nome === "string"
      ? permission.data.user_nome.trim()
      : "";
  return nomePermissao || getUserDisplayName(user);
};