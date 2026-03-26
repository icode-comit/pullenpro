from typing import List, Dict

PATTERNS = [
    ("{first}.{last}",      "firstname.lastname",  0.92),
    ("{first}{last}",       "firstnamelastname",   0.85),
    ("{f}{last}",           "flastname",           0.80),
    ("{first}_{last}",      "firstname_lastname",  0.75),
    ("{first}",             "firstname",           0.65),
    ("{last}",              "lastname",            0.55),
    ("{first}.{l}",         "firstname.l",         0.50),
    ("{f}.{last}",          "f.lastname",          0.70),
    ("{last}.{first}",      "lastname.firstname",  0.45),
    ("{last}{f}",           "lastnamef",           0.40),
    ("{first}-{last}",      "firstname-lastname",  0.35),
    ("{last}_{first}",      "lastname_firstname",  0.30),
]

def generate(first_name: str, last_name: str, domain: str) -> List[Dict]:
    f     = first_name.lower().strip()
    l     = last_name.lower().strip()
    fi    = f[0] if f else ""
    li    = l[0] if l else ""
    results = []
    for pattern, label, confidence in PATTERNS:
        try:
            local = pattern.format(first=f, last=l, f=fi, l=li)
            results.append({
                "email":      f"{local}@{domain}",
                "pattern":    label,
                "confidence": confidence,
            })
        except KeyError:
            pass
    # Deduplicate by email
    seen = set()
    unique = []
    for r in results:
        if r["email"] not in seen:
            seen.add(r["email"])
            unique.append(r)
    return sorted(unique, key=lambda x: x["confidence"], reverse=True)
