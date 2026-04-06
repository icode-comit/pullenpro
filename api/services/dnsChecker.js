import dns from "dns/promises";

const BLACKLISTS = [
  "zen.spamhaus.org",
  "b.barracudacentral.org",
  "bl.spamcop.net",
];

export async function checkDomainHealth(domain) {
  const result = { domain };

  // MX
  try {
    const mx = await dns.resolveMx(domain);
    result.mx = { valid: mx.length > 0, records: mx.map(r => r.exchange) };
  } catch {
    result.mx = { valid: false, records: [] };
  }

  // SPF
  try {
    const txt = await dns.resolveTxt(domain);
    const flat = txt.map(r => r.join(""));
    const spf  = flat.find(r => r.toLowerCase().startsWith("v=spf1")) || null;
    result.spf = { valid: !!spf, record: spf };
  } catch {
    result.spf = { valid: false, record: null };
  }

  // DMARC
  try {
    const txt    = await dns.resolveTxt(`_dmarc.${domain}`);
    const flat   = txt.map(r => r.join(""));
    const dmarc  = flat.find(r => r.includes("v=DMARC1")) || null;
    let policy   = null;
    if (dmarc) {
      const match = dmarc.match(/p=([^;]+)/);
      if (match) policy = match[1];
    }
    result.dmarc = { valid: !!dmarc, policy };
  } catch {
    result.dmarc = { valid: false, policy: null };
  }

  // DKIM (default selector)
  try {
    await dns.resolveTxt(`default._domainkey.${domain}`);
    result.dkim = { valid: true };
  } catch {
    result.dkim = { valid: false };
  }

  // Blacklist
  const listedOn = [];
  try {
    const addrs = await dns.resolve4(domain);
    const ip    = addrs[0];
    const rev   = ip.split(".").reverse().join(".");
    await Promise.all(BLACKLISTS.map(async (bl) => {
      try { await dns.resolve4(`${rev}.${bl}`); listedOn.push(bl); } catch {}
    }));
  } catch {}
  result.spam_score = { listed: listedOn.length > 0, lists: listedOn };

  // Overall
  const failed = [
    !result.mx.valid,
    !result.spf.valid,
    !result.dmarc.valid,
    result.spam_score.listed,
  ].filter(Boolean).length;

  result.overall = failed === 0 ? "healthy" : failed <= 1 ? "warning" : "critical";
  return result;
}
