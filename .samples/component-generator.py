#!/usr/bin/env python3
"""Generate RuneScape Wiki component page drafts from an outfit page.

Example:
    python tools/runescape_component_generator.py \
        --outfit "Desert Wanderer outfit" \
        --output-dir drafts
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from html import unescape
from pathlib import Path
from typing import Iterable, List, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

API_ENDPOINT = "https://runescape.wiki/api.php"
USER_AGENT = "RunescapeWikiComponentGenerator/0.1 (+local-cli-tool)"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create draft component pages from a RuneScape Wiki outfit page."
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument(
        "--outfit-url",
        help="Full wiki URL for the outfit page (for example: https://runescape.wiki/w/Desert_Wanderer_outfit).",
    )
    source_group.add_argument(
        "--outfit",
        help="Wiki page title for the outfit (for example: Desert Wanderer outfit).",
    )
    parser.add_argument(
        "--output-dir",
        default="component_drafts",
        help="Directory to write generated draft files into.",
    )
    parser.add_argument(
        "--include-existing",
        action="store_true",
        help="Include component links even when the wiki reports the page already exists.",
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Print generated drafts to stdout instead of writing files.",
    )
    return parser.parse_args()


def title_from_url(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.scheme.startswith("http"):
        raise ValueError("Outfit URL must start with http:// or https://")

    match = re.search(r"/w/([^?#]+)", parsed.path)
    if not match:
        raise ValueError("Could not parse wiki title from URL path. Expected /w/<Title>.")

    return unescape(match.group(1).replace("_", " ")).strip()


def title_from_input(outfit_url: str | None, outfit: str | None) -> str:
    if outfit:
        return unescape(outfit.replace("_", " ")).strip()
    if outfit_url:
        return title_from_url(outfit_url)
    raise ValueError("Either --outfit-url or --outfit must be provided.")


def call_parse_api(title: str) -> dict:
    params = (
        "action=parse"
        f"&page={quote(title, safe='')}"
        "&prop=links|wikitext"
        "&format=json"
        "&formatversion=2"
    )
    url = f"{API_ENDPOINT}?{params}"

    request = Request(url, headers={"User-Agent": USER_AGENT})

    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        raise RuntimeError(f"Wiki API returned HTTP {exc.code} for title '{title}'.") from exc
    except URLError as exc:
        raise RuntimeError(f"Failed to reach wiki API: {exc.reason}") from exc

    payload = json.loads(body)
    if "error" in payload:
        info = payload["error"].get("info", "Unknown API error")
        raise RuntimeError(f"Wiki API error: {info}")
    if "parse" not in payload:
        raise RuntimeError("Unexpected API response: missing 'parse' key.")
    return payload["parse"]


def base_name_from_outfit_title(outfit_title: str) -> str:
    base = re.sub(r"\s*\(override\)\s*$", "", outfit_title, flags=re.IGNORECASE).strip()
    base = re.sub(r"\s+outfit$", "", base, flags=re.IGNORECASE).strip()
    if not base:
        raise ValueError("Could not determine outfit base name from title.")
    return base


def normalize(title: str) -> str:
    return re.sub(r"\s+", " ", title).strip().lower()


def component_name_prefixes(outfit_title: str) -> List[str]:
    base = re.sub(r"\s*\(override\)\s*$", "", outfit_title, flags=re.IGNORECASE).strip()
    prefixes = [base]
    stripped = re.sub(
        r"\s+(?:outfit|set|robes?|armou?r|attire|garb|costume|regalia)$",
        "",
        base,
        flags=re.IGNORECASE,
    ).strip()
    if stripped and normalize(stripped) != normalize(base):
        prefixes.append(stripped)
    return prefixes


def matches_component_prefix(candidate_title: str, prefixes: Sequence[str]) -> bool:
    cand = normalize(candidate_title)
    for prefix in prefixes:
        pref = normalize(prefix)
        if cand == pref or cand.startswith(pref + " "):
            return True
    return False


def candidate_components(links: Iterable[dict], outfit_title: str, include_existing: bool) -> List[str]:
    prefixes = component_name_prefixes(outfit_title)
    outfit_normalized = normalize(outfit_title)

    collected: List[str] = []
    seen = set()

    for link in links:
        ns = link.get("ns")
        exists = link.get("exists", False)
        title = str(link.get("title", "")).strip()

        if ns != 0 or not title:
            continue
        if normalize(title) == outfit_normalized:
            continue

        title_normalized = normalize(title)
        if not matches_component_prefix(title, prefixes):
            continue

        if (not include_existing) and exists:
            continue

        if title_normalized in seen:
            continue

        seen.add(title_normalized)
        collected.append(title)

    return sorted(collected, key=lambda t: t.lower())


def clean_component_line(line: str) -> str:
    text = line.strip()
    text = re.sub(r"^[*#:;]+\s*", "", text)
    text = re.sub(r"^[-\u2022]\s*", "", text)
    text = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.strip(" '\"")
    return re.sub(r"\s+", " ", text).strip()


def extract_wikilink_titles(line: str) -> List[str]:
    titles: List[str] = []
    for match in re.finditer(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]", line):
        raw = match.group(1).strip()
        if not raw:
            continue
        # Ignore namespaced links such as File:, Category:, etc.
        if ":" in raw:
            continue
        titles.append(unescape(raw.replace("_", " ")).strip())
    return titles


def extract_table_first_cell_text(line: str) -> str | None:
    stripped = line.strip()
    if not stripped.startswith("|"):
        return None
    cell_text = stripped[1:].split("||", 1)[0]
    candidate = clean_component_line(cell_text)
    return candidate or None


def fallback_components_from_lead_tables_and_lists(wikitext: str, outfit_title: str) -> List[str]:
    prefixes = component_name_prefixes(outfit_title)
    outfit_normalized = normalize(outfit_title)
    found: List[str] = []
    seen = set()
    in_table = False

    for line in wikitext.splitlines():
        stripped = line.strip()

        if is_level_two_heading(stripped):
            break

        if stripped.startswith("{|"):
            in_table = True
            continue
        if in_table and stripped.startswith("|}"):
            in_table = False
            continue

        candidates: List[str] = []
        if in_table and (
            stripped.startswith("|")
            or stripped.startswith("!")
            or stripped.startswith("|-")
        ):
            candidates.extend(extract_wikilink_titles(line))
            table_candidate = extract_table_first_cell_text(line)
            if table_candidate:
                candidates.append(table_candidate)
        elif re.match(r"^[*#:;\-\u2022]\s*", stripped):
            candidates.extend(extract_wikilink_titles(line))
            if not candidates:
                cleaned = clean_component_line(stripped)
                if cleaned:
                    candidates.append(cleaned)

        for candidate in candidates:
            norm = normalize(candidate)
            if norm == outfit_normalized:
                continue
            if not matches_component_prefix(candidate, prefixes):
                continue
            if norm in seen:
                continue
            seen.add(norm)
            found.append(candidate)

    return found


def unlinked_components_from_wikitext(wikitext: str, outfit_title: str) -> List[str]:
    lines = wikitext.splitlines()
    collecting = False
    collected_any = False
    found: List[str] = []
    seen = set()
    prefixes = component_name_prefixes(outfit_title)
    marker_pattern = re.compile(r"\b(?:contains|consists of|comprised of)\b", flags=re.IGNORECASE)

    for line in lines:
        stripped = line.strip()

        if not collecting:
            marker_match = marker_pattern.search(line)
            if not marker_match:
                continue
            prefix_text = line[: marker_match.start()]
            has_set_or_outfit = re.search(r"\b(?:set|outfit)\b", prefix_text, flags=re.IGNORECASE)
            # Support marker phrases embedded in a sentence, e.g.
            # "... It consists of the following:".
            has_it_subject = re.search(r"\bit\s*$", prefix_text, flags=re.IGNORECASE)
            if not has_set_or_outfit and not has_it_subject:
                continue
            collecting = True

            # Handle inline content after the marker on the same line when it
            # looks like component content (link or list marker), and ignore
            # descriptor text such as "5 pieces:".
            remainder = line[marker_match.end() :].strip()
            if remainder and (
                "[[" in remainder or re.match(r"^[*#:;\-\u2022]\s*", remainder)
            ):
                candidate = clean_component_line(remainder)
                if candidate and normalize(candidate) != normalize(outfit_title):
                    norm = normalize(candidate)
                    if norm not in seen:
                        seen.add(norm)
                        found.append(candidate)
                        collected_any = True
            continue

        if not stripped:
            if collected_any:
                break
            continue
        if stripped.startswith("=="):
            break

        # Parse table lines by extracting linked page titles.
        if stripped.startswith("{|") or stripped.startswith("|-") or stripped.startswith("|}") or stripped.startswith("|") or stripped.startswith("!"):
            for title in extract_wikilink_titles(line):
                if normalize(title) == normalize(outfit_title):
                    continue
                if not matches_component_prefix(title, prefixes):
                    continue
                norm = normalize(title)
                if norm in seen:
                    continue
                seen.add(norm)
                found.append(title)
                collected_any = True
            table_candidate = extract_table_first_cell_text(line)
            if table_candidate:
                if normalize(table_candidate) != normalize(outfit_title) and matches_component_prefix(table_candidate, prefixes):
                    norm = normalize(table_candidate)
                    if norm not in seen:
                        seen.add(norm)
                        found.append(table_candidate)
                        collected_any = True
            continue

        if stripped.startswith("{{") or stripped.startswith("}}"):
            if collected_any:
                break
            continue

        candidate = clean_component_line(stripped)
        if not candidate:
            if collected_any:
                break
            continue

        if normalize(candidate) == normalize(outfit_title):
            continue

        norm = normalize(candidate)
        if norm in seen:
            continue

        seen.add(norm)
        found.append(candidate)
        collected_any = True

    if found:
        return found
    return fallback_components_from_lead_tables_and_lists(wikitext, outfit_title)


def filesystem_name(title: str) -> str:
    # Preserve readable page names while removing Windows-invalid filename chars.
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", title).strip()
    name = name.rstrip(" .")
    return name or "untitled"


def infer_weapon_slot_and_type(component_title: str) -> tuple[str, str] | None:
    title = normalize(component_title)
    type_keywords = [
        ("2h Crossbow", ["2h crossbow", "two-handed crossbow", "two handed crossbow"]),
        ("Magic Off-hand", ["magic off-hand", "magic offhand", "off-hand orb", "offhand orb", "orb", "book", "grimoire", "tome", "focus"]),
        ("Shield", ["shield", "buckler", "kiteshield", "kite shield", "ward", "defender"]),
        ("Dagger", ["dagger", "dirk", "stiletto"]),
        ("Sword", ["sword", "scimitar", "sabre", "rapier", "katana", "blade"]),
        ("Mace", ["mace", "flail", "morning star", "pain", "agony"]),
        ("Axe", ["axe", "hatchet", "battleaxe", "battle axe"]),
        ("Claw", ["claw", "talon"]),
        ("Whip", ["whip", "lash"]),
        ("Spear", ["spear", "hasta", "trident", "halberd", "glaive", "scythe"]),
        ("Maul", ["maul", "warhammer", "war hammer", "hammer"]),
        ("Crossbow", ["crossbow"]),
        ("Thrown", ["thrown", "dart", "knife", "javelin", "chakram", "shuriken"]),
        ("Bow", ["bow", "longbow", "shortbow"]),
        ("Wand", ["wand"]),
        ("Staff", ["staff", "battlestaff", "battle staff", "crozier"]),
    ]
    weapon_type = None
    for inferred_type, keywords in type_keywords:
        if any(keyword in title for keyword in keywords):
            weapon_type = inferred_type
            break
    if not weapon_type:
        return None

    is_offhand = bool(re.search(r"\boff[ -]?hand\b|\boh\b", title))
    is_two_handed = bool(re.search(r"\b2h\b|\b2-handed\b|\btwo-handed\b|\btwo handed\b", title))

    if is_offhand or weapon_type in {"Shield", "Magic Off-hand"}:
        slot = "Off-hand"
    elif is_two_handed or weapon_type in {"Bow", "2h Crossbow", "Staff", "Maul", "Spear"}:
        slot = "Two-handed"
    else:
        slot = "Main hand"

    return slot, weapon_type


def infer_slot(component_title: str) -> str | None:
    weapon = infer_weapon_slot_and_type(component_title)
    if weapon:
        return weapon[0]
    title = normalize(component_title)
    slot_keywords = [
        ("Head", ["helmet", "hat", "hood", "mask", "headpiece", "helm", "head", "coif", "cowl", "tricorne", "bandana", "circlet", "ears", "coronet", "hood"]),
        ("Torso", ["platebody", "body", "chest", "torso", "robe top", "top", "jacket", "coat", "shirt", "cuirass", "armour", "brigadine", "doublet", "coat top", "garb top", "tunic", "vest", "breastplate"]),
        ("Legs", ["platelegs", "legs", "legguards", "chaps", "robe bottom", "bottom", "trousers", "pants", "skirt", "shorts", "greaves", "cuisses", "breeches", "leggings", "coat bottom", "garb bottom", "faulds", "legplates", "gown", "legwear", "tassets"]),
        ("Hands", ["gauntlets", "gloves", "mitts", "bracers", "gauntlets", "hook", "handwraps", "hands", "grasps", "wraps"]),
        ("Feet", ["boots", "shoes", "sandals", "feet"]),
        ("Back", ["cape", "cloak", "backpack", "tail", "shroud"]),
        ("Wings", ["wings"]),
        ("Neck", ["necklace", "amulet", "neck"]),
    ]

    for slot, keywords in slot_keywords:
        if any(keyword in title for keyword in keywords):
            return slot
    return None


def indefinite_article_for(phrase: str) -> str:
    lowered = phrase.strip().lower()
    if lowered.startswith(("a ", "an ")):
        return lowered.split(" ", 1)[0]
    first_alpha = next((ch for ch in lowered if "a" <= ch <= "z"), "")
    return "an" if first_alpha in {"a", "e", "i", "o", "u"} else "a"


def slot_sentence(slot: str | None) -> str:
    if not slot:
        return "a [[cosmetic override]]"
    article = indefinite_article_for(slot)
    return f"{article} {slot.lower()} slot [[cosmetic override]]"


def weapon_style_from_type(weapon_type: str | None) -> str | None:
    if not weapon_type:
        return None
    melee_types = {"Dagger", "Sword", "Mace", "Axe", "Claw", "Whip", "Spear", "Maul", "Shield"}
    ranged_types = {"Crossbow", "2h Crossbow", "Thrown", "Bow"}
    magic_types = {"Wand", "Staff", "Magic Off-hand"}
    if weapon_type in melee_types:
        return "melee"
    if weapon_type in ranged_types:
        return "ranged"
    if weapon_type in magic_types:
        return "magic"
    return None


def component_lead_sentence(component_title: str, outfit_title: str, slot: str | None, weapon_type: str | None) -> str:
    if weapon_type:
        style = weapon_style_from_type(weapon_type)
        article = indefinite_article_for(slot or "")
        if style:
            descriptor = f"{article} {slot.lower()} [[{style}]] weapon [[cosmetic override]]"
        else:
            descriptor = f"{article} {slot.lower()} weapon [[cosmetic override]]"
    else:
        descriptor = slot_sentence(slot)

    linked_outfit = f"[[{outfit_title}]]"
    override_match = re.match(r"^(.*?)\s+\((override)\)\s*$", outfit_title, flags=re.IGNORECASE)
    if override_match:
        base = override_match.group(1).strip()
        linked_outfit = f"[[{base} (override)|{base}]]"

    if normalize(component_title) == normalize(outfit_title):
        return f"'''{component_title}''' is {descriptor}."
    return f"'''{component_title}''' is {descriptor} that is part of the {linked_outfit}."


def extract_infobox_value(wikitext: str, key: str) -> str | None:
    pattern = rf"(?im)^\|{re.escape(key)}\s*=\s*(.+)$"
    match = re.search(pattern, wikitext)
    if not match:
        return None
    value = match.group(1).strip()
    return value if value else None


def outfit_release_update(wikitext: str) -> tuple[str, str]:
    release = extract_infobox_value(wikitext, "release") or ""
    update = extract_infobox_value(wikitext, "update") or ""
    return release, update


def outfit_recolour_value(wikitext: str) -> str:
    return extract_infobox_value(wikitext, "recolour") or "No"


def outfit_members_value(wikitext: str) -> str:
    return extract_infobox_value(wikitext, "members") or "No"


def outfit_chathead_size(wikitext: str) -> str:
    for line in wikitext.splitlines():
        if "chathead" not in line.lower():
            continue
        match = re.search(r"\|(\d+px)\b", line, flags=re.IGNORECASE)
        if match:
            return match.group(1)
    return "80px"


def outfit_chathead_lines_for_component(wikitext: str, component_title: str) -> List[str]:
    component_norm = normalize(component_title)
    found: List[str] = []
    seen = set()

    for line in wikitext.splitlines():
        stripped = line.strip()
        if is_level_two_heading(stripped):
            break
        if "chathead" not in stripped.lower():
            continue

        line_norm = normalize(stripped.replace("_", " "))
        if component_norm not in line_norm:
            continue

        if re.search(r"^\[\[(?:file|image):.+\]\]$", stripped, flags=re.IGNORECASE):
            candidate = stripped
        elif re.search(r"^(?:file|image):", stripped, flags=re.IGNORECASE):
            candidate = f"[[{stripped}]]"
        else:
            continue

        norm = normalize(candidate)
        if norm in seen:
            continue
        seen.add(norm)
        found.append(candidate)

    return found


def discontinued_override_template(wikitext: str) -> str | None:
    match = re.search(r"(?im)^\{\{Discontinued override[^}]*\}\}\s*$", wikitext)
    if not match:
        return None
    return match.group(0).strip()


def is_level_two_heading(line: str) -> bool:
    return bool(re.match(r"^==[^=].*==\s*$", line.strip()))


def extract_section(wikitext: str, heading: str, trim_tail_noise: bool = False) -> str | None:
    lines = wikitext.splitlines()
    start_idx = None
    heading_line = f"=={heading}=="

    for idx, line in enumerate(lines):
        if line.strip().lower() == heading_line.lower():
            start_idx = idx
            break

    if start_idx is None:
        return None

    end_idx = len(lines)
    for idx in range(start_idx + 1, len(lines)):
        if is_level_two_heading(lines[idx]):
            end_idx = idx
            break

    section_lines = lines[start_idx:end_idx]
    while section_lines and not section_lines[-1].strip():
        section_lines.pop()

    if trim_tail_noise:
        # Trim common tail noise often present after the final section.
        while section_lines:
            tail = section_lines[-1].strip()
            if re.match(r"^\[\[[a-z-]{2,}:.+\]\]$", tail, flags=re.IGNORECASE):
                section_lines.pop()
                continue
            if re.match(r"^\{\{[^{}|]+\}\}$", tail):
                section_lines.pop()
                continue
            break

    while section_lines and not section_lines[-1].strip():
        section_lines.pop()

    if not section_lines:
        return None
    return "\n".join(section_lines)


def bottom_navigation_templates(wikitext: str) -> List[str]:
    lines = wikitext.splitlines()
    templates: List[str] = []

    idx = len(lines) - 1
    while idx >= 0 and not lines[idx].strip():
        idx -= 1

    while idx >= 0:
        line = lines[idx].strip()
        if not line:
            idx -= 1
            continue
        if re.match(r"^\[\[[a-z-]{2,}:.+\]\]$", line, flags=re.IGNORECASE):
            idx -= 1
            continue
        if re.match(r"^\{\{.+\}\}$", line):
            if not re.match(r"^\{\{\s*reflist(?:\s*\|[^}]*)?\s*\}\}$", line, flags=re.IGNORECASE):
                templates.append(line)
            idx -= 1
            continue
        break

    templates.reverse()
    return templates


def cosmetic_override_slot_value(wikitext: str) -> str | None:
    section = extract_section(wikitext, "Cosmetic override")
    if not section:
        return None
    return extract_infobox_value(section, "slot")


def is_weapon_slot(slot: str | None) -> bool:
    if not slot:
        return False
    normalized = normalize(slot).replace("_", " ").replace("-", " ")
    return normalized in {"main hand", "off hand", "two handed", "2h"}


def components_by_slot(components: Sequence[str]) -> dict[str, str]:
    by_slot: dict[str, str] = {}
    for component in components:
        slot = infer_slot(component)
        if slot and slot not in by_slot:
            by_slot[slot] = component
    return by_slot


def weapon_components(components: Sequence[str]) -> List[str]:
    weapon_slots = {"Main hand", "Off-hand", "Two-handed"}
    found: List[str] = []
    for component in components:
        slot = infer_slot(component)
        if slot in weapon_slots:
            found.append(component)
    return found


def render_set_cosmetic_override_section(outfit_title: str, components: Sequence[str]) -> str:
    by_slot = components_by_slot(components)
    mainhand = by_slot.get("Main hand")
    offhand = by_slot.get("Off-hand")
    two_handed = by_slot.get("Two-handed")

    # Infobox supports either mainhand/offhand combination or 2h, but not all three.
    use_two_handed_mode = bool(two_handed) and not (mainhand and offhand)
    if use_two_handed_mode:
        selected_weapon_components = {two_handed}
    else:
        selected_weapon_components = {mainhand, offhand}

    slot_fields = [
        ("head", "Head"),
        ("back", "Back"),
        ("neck", "Neck"),
        ("wings", "Wings"),
        ("torso", "Torso"),
        ("legs", "Legs"),
        ("hands", "Hands"),
        ("feet", "Feet"),
    ]
    lines = [
        "==Cosmetic override==",
        "{{Infobox Cosmetic override",
        "|slot = Set",
        f"|maleimage = {outfit_title} equipped (male).png",
        f"|femaleimage = {outfit_title} equipped (female).png",
    ]
    for field, slot_name in slot_fields:
        component = by_slot.get(slot_name)
        if component:
            lines.append(f"|{field} = {component}")
    if use_two_handed_mode:
        if two_handed:
            lines.append(f"|2h = {two_handed}")
    else:
        if mainhand:
            lines.append(f"|mainhand = {mainhand}")
        if offhand:
            lines.append(f"|offhand = {offhand}")
    lines.extend(["}}", ""])

    overflow_weapons = [
        component
        for component in weapon_components(components)
        if component not in selected_weapon_components
    ]
    if overflow_weapons:
        lines.extend(
            [
                "In addition, this pack also includes the following components:",
                "{{Cosmetic override gallery",
            ]
        )
        for component in overflow_weapons:
            lines.append(f"|{component}")
        lines.extend(["}}", ""])

    return "\n".join(lines)


def replace_or_insert_section(wikitext: str, heading: str, new_section: str) -> str:
    lines = wikitext.splitlines()
    heading_line = f"=={heading}=="
    start_idx = None

    for idx, line in enumerate(lines):
        if line.strip().lower() == heading_line.lower():
            start_idx = idx
            break

    if start_idx is not None:
        end_idx = len(lines)
        for idx in range(start_idx + 1, len(lines)):
            if is_level_two_heading(lines[idx]):
                end_idx = idx
                break
        replacement = new_section.split("\n")
        merged = lines[:start_idx] + replacement + lines[end_idx:]
        return "\n".join(merged).rstrip() + "\n"

    insert_idx = None
    for idx, line in enumerate(lines):
        if line.strip().lower() == "==release history==":
            insert_idx = idx
            break

    if insert_idx is None:
        merged = lines + ["", *new_section.split("\n")]
    else:
        merged = lines[:insert_idx] + new_section.split("\n") + [""] + lines[insert_idx:]
    return "\n".join(merged).rstrip() + "\n"


def render_modified_outfit_page(wikitext: str, outfit_title: str, components: Sequence[str]) -> str:
    new_section = render_set_cosmetic_override_section(outfit_title, components)
    updated = replace_or_insert_section(wikitext, "Cosmetic override", new_section)
    # Remove the set-contains label line while leaving item bullet lines intact.
    updated = re.sub(
        r"(?im)^ *(?:(?:the|this)\b[^\n]*(?:set|outfit)\b[^\n]*|it\b[^\n]*)(?:contains|consists of|comprised of)\b[^\n]*:?\s*\n",
        "",
        updated,
    )
    # Remove component bullet lines from the outfit page draft.
    for component in components:
        updated = re.sub(rf"(?im)^\*\s*{re.escape(component)}\s*\n", "", updated)
    # If the set list is removed, avoid leaving an empty line before clear-left.
    updated = re.sub(r"\n\n(\{\{clear\|left\}\})", r"\n\1", updated)
    # Normalize plain override links to use display text without "(override)".
    updated = re.sub(
        r"\[\[([^\]|]+?)\s+\(override\)\]\]",
        r"[[\1 (override)|\1]]",
        updated,
        flags=re.IGNORECASE,
    )
    return updated


def render_draft(
    component_title: str,
    outfit_title: str,
    release: str,
    update: str,
    members: str,
    recolour: str,
    chathead_size: str,
    chathead_lines: Sequence[str],
    discontinued_template: str | None,
    release_history_section: str | None,
    update_history_section: str | None,
    navigation_templates: Sequence[str],
) -> str:
    weapon_data = infer_weapon_slot_and_type(component_title)
    slot = weapon_data[0] if weapon_data else infer_slot(component_title)
    weapon_type = weapon_data[1] if weapon_data else None
    slot_field = slot if slot else ""
    lines: List[str] = []

    if discontinued_template:
        lines.append(discontinued_template)

    lines.extend(
        [
            "{{Infobox Skin",
            f"|name = {component_title}",
            "|image = No",
            f"|release = {release}",
            f"|update = {update}",
            f"|members = {members}",
            f"|recolour = {recolour}",
            "|dbrow_id = ",
            "|id = ",
            "}}",
        ]
    )

    intro_lines = [component_lead_sentence(component_title, outfit_title, slot, weapon_type), ""]

    if slot == "Head":
        if chathead_lines:
            intro_lines = [*chathead_lines, *intro_lines]
        else:
            intro_lines.insert(0, f"[[File:{component_title} chathead.png|left|{chathead_size}]]")

    lines.extend(intro_lines)
    lines.extend(
        [
            "==Cosmetic override==",
            "{{Infobox Cosmetic override",
            f"|slot = {slot_field}",
        ]
    )
    if weapon_type and slot in {"Main hand", "Off-hand", "Two-handed"}:
        lines.append(f"|type = {weapon_type}")
        lines.append(f"|image = {component_title} equipped.png")
    else:
        lines.append(f"|maleimage = {component_title} equipped (male).png")
        lines.append(f"|femaleimage = {component_title} equipped (female).png")
    lines.extend(["}}", ""])

    if release_history_section:
        lines.extend([release_history_section, ""])

    if update_history_section:
        lines.extend([update_history_section, ""])

    if navigation_templates:
        lines.extend(navigation_templates)

    lines.append("")
    return "\n".join(lines)


def write_drafts(
    titles: Sequence[str],
    outfit_title: str,
    release: str,
    update: str,
    members: str,
    recolour: str,
    chathead_size: str,
    discontinued_template: str | None,
    release_history_section: str | None,
    update_history_section: str | None,
    navigation_templates: Sequence[str],
    source_outfit_wikitext: str,
    output_dir: Path,
    preview: bool,
) -> None:
    modified_outfit_page = render_modified_outfit_page(source_outfit_wikitext, outfit_title, titles)

    if preview:
        for title in titles:
            chathead_lines = outfit_chathead_lines_for_component(source_outfit_wikitext, title)
            print(f"===== {title} =====")
            print(
                render_draft(
                    title,
                    outfit_title,
                    release,
                    update,
                    members,
                    recolour,
                    chathead_size,
                    chathead_lines,
                    discontinued_template,
                    release_history_section,
                    update_history_section,
                    navigation_templates,
                )
            )
        print(f"===== {outfit_title} (modified outfit page) =====")
        print(modified_outfit_page)
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    for title in titles:
        chathead_lines = outfit_chathead_lines_for_component(source_outfit_wikitext, title)
        filepath = output_dir / f"{filesystem_name(title)}.wiki"
        filepath.write_text(
            render_draft(
                title,
                outfit_title,
                release,
                update,
                members,
                recolour,
                chathead_size,
                chathead_lines,
                discontinued_template,
                release_history_section,
                update_history_section,
                navigation_templates,
            ),
            encoding="utf-8",
        )
        print(f"Wrote {filepath}")

    outfit_filepath = output_dir / f"{filesystem_name(outfit_title)}.wiki"
    outfit_filepath.write_text(modified_outfit_page, encoding="utf-8")
    print(f"Wrote {outfit_filepath}")


def main() -> int:
    args = parse_args()

    try:
        outfit_title = title_from_input(args.outfit_url, args.outfit)
        parsed = call_parse_api(outfit_title)
        links = parsed.get("links", [])
        linked_components = candidate_components(links, outfit_title, args.include_existing)
        wikitext = str(parsed.get("wikitext", ""))
        extracted_components = unlinked_components_from_wikitext(wikitext, outfit_title)
        release, update = outfit_release_update(wikitext)
        members = outfit_members_value(wikitext)
        recolour = outfit_recolour_value(wikitext)
        chathead_size = outfit_chathead_size(wikitext)
        discontinued_template = discontinued_override_template(wikitext)
        release_history_section = extract_section(wikitext, "Release history")
        update_history_section = extract_section(wikitext, "Update history", trim_tail_noise=True)
        navigation_templates = bottom_navigation_templates(wikitext)

        if extracted_components:
            # Prefer explicit component lists/tables when present to avoid
            # pulling in loosely related pages that only share the name prefix.
            component_map = {normalize(title): title for title in extracted_components}
        else:
            component_map = {normalize(title): title for title in linked_components}
        components = sorted(component_map.values(), key=lambda t: t.lower())

        if not components:
            if is_weapon_slot(cosmetic_override_slot_value(wikitext)):
                components = [outfit_title]
            else:
                print(
                    "No candidate component pages found. Try --include-existing or confirm the outfit URL/title.",
                    file=sys.stderr,
                )
                return 1

        print(f"Outfit: {outfit_title}")
        print(f"Component candidates: {len(components)}")
        for title in components:
            print(f" - {title}")

        write_drafts(
            components,
            outfit_title,
            release,
            update,
            members,
            recolour,
            chathead_size,
            discontinued_template,
            release_history_section,
            update_history_section,
            navigation_templates,
            wikitext,
            Path(args.output_dir) / filesystem_name(outfit_title),
            args.preview,
        )
        return 0
    except Exception as exc:  # pragma: no cover - simple CLI error path
        print(f"Error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
