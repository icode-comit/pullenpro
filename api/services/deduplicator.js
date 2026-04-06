const ROLE_ACCOUNTS = new Set([
  "info","contact","admin","support","help","sales","hello",
  "noreply","no-reply","postmaster","webmaster","team","hr",
  "careers","jobs","marketing","billing","office","mail",
  "enquiries","enquiry","service",
]);

export function normaliseEmail(email) {
  if (!email || !email.includes("@")) return email?.toLowerCase() || "";
  let [local, domain] = email.toLowerCase().split("@");
  local = local.split("+")[0].replace(/\./g, "");
  return `${local}@${domain}`;
}

export function isRoleBased(email) {
  const local = email?.toLowerCase().split("@")[0] || "";
  return ROLE_ACCOUNTS.has(local);
}

export function deduplicate(rows, emailField = "email") {
  const seen  = new Set();
  const clean = [];
  let dupes   = 0;
  for (const row of rows) {
    const key = normaliseEmail(row[emailField] || "") || JSON.stringify(row);
    if (seen.has(key)) { dupes++; } else { seen.add(key); clean.push(row); }
  }
  return { clean, dupes };
}

export function detectRoleEmails(rows, emailField = "email") {
  let roleCount = 0;
  const annotated = rows.map(row => {
    const role = isRoleBased(row[emailField] || "");
    if (role) roleCount++;
    return { ...row, _role_based: role };
  });
  return { rows: annotated, roleCount };
}
