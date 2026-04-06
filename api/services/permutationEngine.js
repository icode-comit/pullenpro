const PATTERNS = [
  ["{first}.{last}",   "firstname.lastname",  0.92],
  ["{first}{last}",    "firstnamelastname",   0.85],
  ["{f}{last}",        "flastname",           0.80],
  ["{first}_{last}",   "firstname_lastname",  0.75],
  ["{first}",          "firstname",           0.65],
  ["{f}.{last}",       "f.lastname",          0.70],
  ["{first}.{l}",      "firstname.l",         0.50],
  ["{last}.{first}",   "lastname.firstname",  0.45],
  ["{last}{f}",        "lastnamef",           0.40],
  ["{first}-{last}",   "firstname-lastname",  0.35],
  ["{last}_{first}",   "lastname_firstname",  0.30],
  ["{last}",           "lastname",            0.25],
];

export function generate(firstName, lastName, domain) {
  const f  = firstName.toLowerCase().trim();
  const l  = lastName.toLowerCase().trim();
  const fi = f[0] || "";
  const li = l[0] || "";
  const seen = new Set();
  const results = [];
  for (const [pattern, label, confidence] of PATTERNS) {
    const local = pattern
      .replace("{first}", f).replace("{last}", l)
      .replace("{f}", fi).replace("{l}", li);
    const email = `${local}@${domain}`;
    if (!seen.has(email)) {
      seen.add(email);
      results.push({ email, pattern: label, confidence });
    }
  }
  return results.sort((a, b) => b.confidence - a.confidence);
}
