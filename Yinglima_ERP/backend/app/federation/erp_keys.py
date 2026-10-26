"""
Does the list of ERPs a person may use (from ERP_Main) include THIS ERP?

ERP_Main stores an ERP under a registry key (lowercase letters, digits and underscores: "inhyma", "erp_01", "inhyma_erp")
while an ERP also knows itself by an instance id with hyphens ("erp-01"). Comparing those strings literally refused real,
active members whenever the two spellings differed ("erp_01" vs "erp-01", or a key with a suffix such as "inhyma_erp").

The comparison therefore ignores separators and case, and also accepts a key that contains this ERP's distinctive
name as a whole word ("inhyma" in "inhyma_erp"). Another ERP is never accepted: "yinglima" shares no word with "inhyma".
"""

from __future__ import annotations

import re
from collections.abc import Iterable

_SEPARATORS = re.compile(r"[^a-z0-9]+")
# Words that say nothing about WHICH ERP this is.
_GENERIC_WORDS = {"erp", "main", "control", "plane", "instance", "prod", "production", "local"}


def _words(value: object) -> set[str]:
    return {w for w in _SEPARATORS.split(str(value).strip().lower()) if w}


def _squash(value: object) -> str:
    return _SEPARATORS.sub("", str(value).strip().lower())


def erp_access_matches(my_keys: Iterable[str], offered: Iterable[object]) -> bool:
    """True when ``offered`` (the person's allowed ERPs) grants access to the ERP known as ``my_keys``."""
    mine = {k.strip().lower() for k in my_keys if k and k.strip()}
    offered_clean = [str(o).strip().lower() for o in offered if o is not None and str(o).strip()]
    if "*" in offered_clean:
        return True
    my_squashed = {_squash(k) for k in mine}
    # distinctive words only: "inhyma" yes, "erp" / "01" no (a number alone must not tie two different ERPs together)
    my_words = {w for k in mine for w in _words(k) if w not in _GENERIC_WORDS and not w.isdigit()}
    for entry in offered_clean:
        if entry == "control-plane":
            continue
        if _squash(entry) in my_squashed:
            return True
        if _words(entry) & my_words:
            return True
    return False


def describe_denial(my_keys: Iterable[str], offered: Iterable[object]) -> str:
    """A precise, safe sentence for the 403 body: what ERP_Main offered versus what this ERP is known as."""
    offered_list = sorted({str(o).strip().lower() for o in offered if o is not None and str(o).strip() and str(o).strip() != "control-plane"})
    mine = sorted({k.strip().lower() for k in my_keys if k and k.strip()})
    return (
        f"ERP_Main grants access to {offered_list or 'no ERP'}, but this ERP is registered as {mine}. "
        "An administrator must grant this ERP in ERP_Main (User & Access), or correct the ERP key so both match."
    )