import type { MediaWikiClient } from '@/core/mediawiki/client';

type ParseLink = {
  ns?: number;
  exists?: unknown;
  title?: string;
};

type ParseResponse = {
  links?: ParseLink[];
  wikitext?: string;
};

export type GeneratedDraft = {
  title: string;
  filename: string;
  content: string;
  kind: 'component' | 'outfit';
};

export type DraftBundle = {
  outfitTitle: string;
  components: string[];
  drafts: GeneratedDraft[];
};

export type GenerateDraftOptions = {
  outfitInput: string;
  includeExisting: boolean;
};

function decodeEntities(value: string) {
  if (typeof document === 'undefined') {
    return value;
  }
  const node = document.createElement('textarea');
  node.innerHTML = value;
  return node.value;
}

function titleFromUrl(urlValue: string) {
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new Error('Outfit URL must start with http:// or https://');
  }
  if (!parsed.protocol.startsWith('http')) {
    throw new Error('Outfit URL must start with http:// or https://');
  }
  const match = parsed.pathname.match(/\/w\/([^?#]+)/);
  if (!match) {
    throw new Error('Could not parse wiki title from URL path. Expected /w/<Title>.');
  }
  return decodeEntities(decodeURIComponent(match[1]).replace(/_/g, ' ')).trim();
}

function titleFromInput(outfitInput: string) {
  const trimmed = outfitInput.trim();
  if (!trimmed) {
    throw new Error('Outfit title or URL is required.');
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return titleFromUrl(trimmed);
  }
  return decodeEntities(trimmed.replace(/_/g, ' ')).trim();
}

function normalize(title: string) {
  return title.replace(/\s+/g, ' ').trim().toLowerCase();
}

function componentNamePrefixes(outfitTitle: string) {
  const base = outfitTitle.replace(/\s*\(override\)\s*$/i, '').trim();
  const prefixes = [base];
  const stripped = base
    .replace(/\s+(?:outfit|set|robes?|armou?r|attire|garb|costume|regalia)$/i, '')
    .trim();
  if (stripped && normalize(stripped) !== normalize(base)) {
    prefixes.push(stripped);
  }
  return prefixes;
}

function matchesComponentPrefix(candidateTitle: string, prefixes: string[]) {
  const cand = normalize(candidateTitle);
  return prefixes.some((prefix) => {
    const pref = normalize(prefix);
    return cand === pref || cand.startsWith(`${pref} `);
  });
}

function candidateComponents(links: ParseLink[], outfitTitle: string, includeExisting: boolean) {
  const prefixes = componentNamePrefixes(outfitTitle);
  const outfitNormalized = normalize(outfitTitle);
  const seen = new Set<string>();
  const collected: string[] = [];

  for (const link of links) {
    const ns = link.ns;
    const exists = Boolean(link.exists);
    const title = String(link.title ?? '').trim();
    if (ns !== 0 || !title) {
      continue;
    }
    if (normalize(title) === outfitNormalized) {
      continue;
    }
    if (!matchesComponentPrefix(title, prefixes)) {
      continue;
    }
    if (!includeExisting && exists) {
      continue;
    }
    const key = normalize(title);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    collected.push(title);
  }
  return collected.sort((a, b) => a.localeCompare(b));
}

function cleanComponentLine(line: string) {
  let text = line.trim();
  text = text.replace(/^[*#:;]+\s*/, '');
  text = text.replace(/^[-\u2022]\s*/, '');
  text = text.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2');
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/^[ '"`]+|[ '"`]+$/g, '');
  return text.replace(/\s+/g, ' ').trim();
}

function extractWikilinkTitles(line: string) {
  const titles: string[] = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  for (const match of line.matchAll(re)) {
    const raw = (match[1] ?? '').trim();
    if (!raw) {
      continue;
    }
    if (raw.includes(':')) {
      continue;
    }
    titles.push(decodeEntities(raw.replace(/_/g, ' ')).trim());
  }
  return titles;
}

function extractTableFirstCellText(line: string) {
  const stripped = line.trim();
  if (!stripped.startsWith('|')) {
    return null;
  }
  const cellText = stripped.slice(1).split('||', 1)[0];
  const candidate = cleanComponentLine(cellText);
  return candidate || null;
}

function isLevelTwoHeading(line: string) {
  return /^==[^=].*==\s*$/.test(line.trim());
}

function fallbackComponentsFromLeadTablesAndLists(wikitext: string, outfitTitle: string) {
  const prefixes = componentNamePrefixes(outfitTitle);
  const outfitNormalized = normalize(outfitTitle);
  const found: string[] = [];
  const seen = new Set<string>();
  let inTable = false;

  for (const line of wikitext.split('\n')) {
    const stripped = line.trim();
    if (isLevelTwoHeading(stripped)) {
      break;
    }
    if (stripped.startsWith('{|')) {
      inTable = true;
      continue;
    }
    if (inTable && stripped.startsWith('|}')) {
      inTable = false;
      continue;
    }

    const candidates: string[] = [];
    if (inTable && (stripped.startsWith('|') || stripped.startsWith('!') || stripped.startsWith('|-'))) {
      candidates.push(...extractWikilinkTitles(line));
      const tableCandidate = extractTableFirstCellText(line);
      if (tableCandidate) {
        candidates.push(tableCandidate);
      }
    } else if (/^[*#:;\-\u2022]\s*/.test(stripped)) {
      candidates.push(...extractWikilinkTitles(line));
      if (candidates.length === 0) {
        const cleaned = cleanComponentLine(stripped);
        if (cleaned) {
          candidates.push(cleaned);
        }
      }
    }

    for (const candidate of candidates) {
      const key = normalize(candidate);
      if (key === outfitNormalized) {
        continue;
      }
      if (!matchesComponentPrefix(candidate, prefixes)) {
        continue;
      }
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      found.push(candidate);
    }
  }
  return found;
}

function unlinkedComponentsFromWikitext(wikitext: string, outfitTitle: string) {
  const lines = wikitext.split('\n');
  const found: string[] = [];
  const seen = new Set<string>();
  const prefixes = componentNamePrefixes(outfitTitle);
  const markerPattern = /\b(?:contains|consists of|comprised of)\b/i;
  let collecting = false;
  let collectedAny = false;

  for (const line of lines) {
    const stripped = line.trim();
    if (!collecting) {
      const marker = markerPattern.exec(line);
      if (!marker) {
        continue;
      }
      const prefixText = line.slice(0, marker.index);
      const hasSetOrOutfit = /\b(?:set|outfit)\b/i.test(prefixText);
      const hasItSubject = /\bit\s*$/i.test(prefixText);
      if (!hasSetOrOutfit && !hasItSubject) {
        continue;
      }
      collecting = true;
      const remainder = line.slice(marker.index + marker[0].length).trim();
      if (remainder && (remainder.includes('[[') || /^[*#:;\-\u2022]\s*/.test(remainder))) {
        const candidate = cleanComponentLine(remainder);
        if (candidate && normalize(candidate) !== normalize(outfitTitle)) {
          const key = normalize(candidate);
          if (!seen.has(key)) {
            seen.add(key);
            found.push(candidate);
            collectedAny = true;
          }
        }
      }
      continue;
    }

    if (!stripped) {
      if (collectedAny) {
        break;
      }
      continue;
    }
    if (stripped.startsWith('==')) {
      break;
    }

    if (
      stripped.startsWith('{|') ||
      stripped.startsWith('|-') ||
      stripped.startsWith('|}') ||
      stripped.startsWith('|') ||
      stripped.startsWith('!')
    ) {
      for (const title of extractWikilinkTitles(line)) {
        if (normalize(title) === normalize(outfitTitle)) {
          continue;
        }
        if (!matchesComponentPrefix(title, prefixes)) {
          continue;
        }
        const key = normalize(title);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        found.push(title);
        collectedAny = true;
      }
      const tableCandidate = extractTableFirstCellText(line);
      if (tableCandidate && normalize(tableCandidate) !== normalize(outfitTitle) && matchesComponentPrefix(tableCandidate, prefixes)) {
        const key = normalize(tableCandidate);
        if (!seen.has(key)) {
          seen.add(key);
          found.push(tableCandidate);
          collectedAny = true;
        }
      }
      continue;
    }

    if (stripped.startsWith('{{') || stripped.startsWith('}}')) {
      if (collectedAny) {
        break;
      }
      continue;
    }

    const candidate = cleanComponentLine(stripped);
    if (!candidate) {
      if (collectedAny) {
        break;
      }
      continue;
    }
    if (normalize(candidate) === normalize(outfitTitle)) {
      continue;
    }
    const key = normalize(candidate);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    found.push(candidate);
    collectedAny = true;
  }

  if (found.length > 0) {
    return found;
  }
  return fallbackComponentsFromLeadTablesAndLists(wikitext, outfitTitle);
}

function filesystemName(title: string) {
  let name = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  name = name.replace(/[ .]+$/g, '');
  return name || 'untitled';
}

function inferWeaponSlotAndType(componentTitle: string): [string, string] | null {
  const title = normalize(componentTitle);
  const typeKeywords: Array<[string, string[]]> = [
    ['2h Crossbow', ['2h crossbow', 'two-handed crossbow', 'two handed crossbow']],
    ['Magic Off-hand', ['magic off-hand', 'magic offhand', 'off-hand orb', 'offhand orb', 'orb', 'book', 'grimoire', 'tome', 'focus']],
    ['Shield', ['shield', 'buckler', 'kiteshield', 'kite shield', 'ward', 'defender']],
    ['Dagger', ['dagger', 'dirk', 'stiletto']],
    ['Sword', ['sword', 'scimitar', 'sabre', 'rapier', 'katana', 'blade']],
    ['Mace', ['mace', 'flail', 'morning star', 'pain', 'agony']],
    ['Axe', ['axe', 'hatchet', 'battleaxe', 'battle axe']],
    ['Claw', ['claw', 'talon']],
    ['Whip', ['whip', 'lash']],
    ['Spear', ['spear', 'hasta', 'trident', 'halberd', 'glaive', 'scythe']],
    ['Maul', ['maul', 'warhammer', 'war hammer', 'hammer']],
    ['Crossbow', ['crossbow']],
    ['Thrown', ['thrown', 'dart', 'knife', 'javelin', 'chakram', 'shuriken']],
    ['Bow', ['bow', 'longbow', 'shortbow']],
    ['Wand', ['wand']],
    ['Staff', ['staff', 'battlestaff', 'battle staff', 'crozier']],
  ];

  let weaponType: string | null = null;
  for (const [inferredType, keywords] of typeKeywords) {
    if (keywords.some((keyword) => title.includes(keyword))) {
      weaponType = inferredType;
      break;
    }
  }
  if (!weaponType) {
    return null;
  }

  const isOffhand = /\boff[ -]?hand\b|\boh\b/.test(title);
  const isTwoHanded = /\b2h\b|\b2-handed\b|\btwo-handed\b|\btwo handed\b/.test(title);
  let slot = 'Main hand';
  if (isOffhand || weaponType === 'Shield' || weaponType === 'Magic Off-hand') {
    slot = 'Off-hand';
  } else if (isTwoHanded || ['Bow', '2h Crossbow', 'Staff', 'Maul', 'Spear'].includes(weaponType)) {
    slot = 'Two-handed';
  }
  return [slot, weaponType];
}

function inferSlot(componentTitle: string): string | null {
  const weapon = inferWeaponSlotAndType(componentTitle);
  if (weapon) {
    return weapon[0];
  }
  const title = normalize(componentTitle);
  const slotKeywords: Array<[string, string[]]> = [
    ['Head', ['helmet', 'hat', 'hood', 'mask', 'headpiece', 'helm', 'head', 'coif', 'cowl', 'tricorne', 'bandana', 'circlet', 'ears', 'coronet']],
    ['Torso', ['platebody', 'body', 'chest', 'torso', 'robe top', 'top', 'jacket', 'coat', 'shirt', 'cuirass', 'armour', 'brigadine', 'doublet', 'coat top', 'garb top', 'tunic', 'vest', 'breastplate']],
    ['Legs', ['platelegs', 'legs', 'legguards', 'chaps', 'robe bottom', 'bottom', 'trousers', 'pants', 'skirt', 'shorts', 'greaves', 'cuisses', 'breeches', 'leggings', 'coat bottom', 'garb bottom', 'faulds', 'legplates', 'gown', 'legwear', 'tassets']],
    ['Hands', ['gauntlets', 'gloves', 'mitts', 'bracers', 'hook', 'handwraps', 'hands', 'grasps', 'wraps']],
    ['Feet', ['boots', 'shoes', 'sandals', 'feet', 'sabatons']],
    ['Back', ['cape', 'cloak', 'backpack', 'tail', 'shroud']],
    ['Wings', ['wings']],
    ['Neck', ['necklace', 'amulet', 'neck']],
  ];
  for (const [slot, keywords] of slotKeywords) {
    if (keywords.some((keyword) => title.includes(keyword))) {
      return slot;
    }
  }
  return null;
}

function indefiniteArticleFor(phrase: string) {
  const lowered = phrase.trim().toLowerCase();
  if (lowered.startsWith('a ') || lowered.startsWith('an ')) {
    return lowered.split(' ', 1)[0];
  }
  const firstAlpha = [...lowered].find((ch) => ch >= 'a' && ch <= 'z') ?? '';
  return ['a', 'e', 'i', 'o', 'u'].includes(firstAlpha) ? 'an' : 'a';
}

function slotSentence(slot: string | null) {
  if (!slot) {
    return 'a [[cosmetic override]]';
  }
  const article = indefiniteArticleFor(slot);
  return `${article} ${slot.toLowerCase()} slot [[cosmetic override]]`;
}

function weaponStyleFromType(weaponType: string | null) {
  if (!weaponType) {
    return null;
  }
  const meleeTypes = new Set(['Dagger', 'Sword', 'Mace', 'Axe', 'Claw', 'Whip', 'Spear', 'Maul', 'Shield']);
  const rangedTypes = new Set(['Crossbow', '2h Crossbow', 'Thrown', 'Bow']);
  const magicTypes = new Set(['Wand', 'Staff', 'Magic Off-hand']);
  if (meleeTypes.has(weaponType)) {
    return 'melee';
  }
  if (rangedTypes.has(weaponType)) {
    return 'ranged';
  }
  if (magicTypes.has(weaponType)) {
    return 'magic';
  }
  return null;
}

function componentLeadSentence(componentTitle: string, outfitTitle: string, slot: string | null, weaponType: string | null) {
  let descriptor = slotSentence(slot);
  if (weaponType) {
    const style = weaponStyleFromType(weaponType);
    const article = indefiniteArticleFor(slot ?? '');
    descriptor = style
      ? `${article} ${slot?.toLowerCase()} [[${style}]] weapon [[cosmetic override]]`
      : `${article} ${slot?.toLowerCase()} weapon [[cosmetic override]]`;
  }

  let linkedOutfit = `[[${outfitTitle}]]`;
  const overrideMatch = outfitTitle.match(/^(.*?)\s+\((override)\)\s*$/i);
  if (overrideMatch) {
    const base = overrideMatch[1].trim();
    linkedOutfit = `[[${base} (override)|${base}]]`;
  }

  if (normalize(componentTitle) === normalize(outfitTitle)) {
    return `'''${componentTitle}''' is ${descriptor}.`;
  }
  return `'''${componentTitle}''' is ${descriptor} that is part of the ${linkedOutfit}.`;
}

function extractInfoboxValue(wikitext: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = wikitext.match(new RegExp(`^\\|${escaped}\\s*=\\s*(.+)$`, 'im'));
  if (!match) {
    return null;
  }
  const value = match[1].trim();
  return value || null;
}

function outfitReleaseUpdate(wikitext: string): [string, string] {
  return [extractInfoboxValue(wikitext, 'release') ?? '', extractInfoboxValue(wikitext, 'update') ?? ''];
}

function outfitRecolourValue(wikitext: string) {
  return extractInfoboxValue(wikitext, 'recolour') ?? 'No';
}

function outfitMembersValue(wikitext: string) {
  return extractInfoboxValue(wikitext, 'members') ?? 'No';
}

function outfitChatheadSize(wikitext: string) {
  for (const line of wikitext.split('\n')) {
    if (!line.toLowerCase().includes('chathead')) {
      continue;
    }
    const match = line.match(/\|(\d+px)\b/i);
    if (match) {
      return match[1];
    }
  }
  return '80px';
}

function outfitChatheadLinesForComponent(wikitext: string, componentTitle: string) {
  const componentNorm = normalize(componentTitle);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const line of wikitext.split('\n')) {
    const stripped = line.trim();
    if (isLevelTwoHeading(stripped)) {
      break;
    }
    if (!stripped.toLowerCase().includes('chathead')) {
      continue;
    }
    const lineNorm = normalize(stripped.replace(/_/g, ' '));
    if (!lineNorm.includes(componentNorm)) {
      continue;
    }
    let candidate: string | null = null;
    if (/^\[\[(?:file|image):.+\]\]$/i.test(stripped)) {
      candidate = stripped;
    } else if (/^(?:file|image):/i.test(stripped)) {
      candidate = `[[${stripped}]]`;
    }
    if (!candidate) {
      continue;
    }
    const key = normalize(candidate);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    found.push(candidate);
  }
  return found;
}

function discontinuedOverrideTemplate(wikitext: string) {
  const match = wikitext.match(/^\{\{Discontinued override[^}]*\}\}\s*$/im);
  return match ? match[0].trim() : null;
}

function extractSection(wikitext: string, heading: string, trimTailNoise = false) {
  const lines = wikitext.split('\n');
  const headingLine = `==${heading}==`.toLowerCase();
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === headingLine);
  if (startIndex < 0) {
    return null;
  }
  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (isLevelTwoHeading(lines[index])) {
      endIndex = index;
      break;
    }
  }
  const sectionLines = lines.slice(startIndex, endIndex);
  while (sectionLines.length > 0 && !sectionLines[sectionLines.length - 1].trim()) {
    sectionLines.pop();
  }

  if (trimTailNoise) {
    while (sectionLines.length > 0) {
      const tail = sectionLines[sectionLines.length - 1].trim();
      if (/^\[\[[a-z-]{2,}:.+\]\]$/i.test(tail)) {
        sectionLines.pop();
        continue;
      }
      if (/^\{\{[^{}|]+\}\}$/.test(tail)) {
        sectionLines.pop();
        continue;
      }
      break;
    }
  }
  while (sectionLines.length > 0 && !sectionLines[sectionLines.length - 1].trim()) {
    sectionLines.pop();
  }
  return sectionLines.length > 0 ? sectionLines.join('\n') : null;
}

function bottomNavigationTemplates(wikitext: string) {
  const lines = wikitext.split('\n');
  const templates: string[] = [];
  let idx = lines.length - 1;
  while (idx >= 0 && !lines[idx].trim()) {
    idx -= 1;
  }
  while (idx >= 0) {
    const line = lines[idx].trim();
    if (!line) {
      idx -= 1;
      continue;
    }
    if (/^\[\[[a-z-]{2,}:.+\]\]$/i.test(line)) {
      idx -= 1;
      continue;
    }
    if (/^\{\{.+\}\}$/.test(line)) {
      if (!/^\{\{\s*reflist(?:\s*\|[^}]*)?\s*\}\}$/i.test(line)) {
        templates.push(line);
      }
      idx -= 1;
      continue;
    }
    break;
  }
  return templates.reverse();
}

function cosmeticOverrideSlotValue(wikitext: string) {
  const section = extractSection(wikitext, 'Cosmetic override');
  if (!section) {
    return null;
  }
  return extractInfoboxValue(section, 'slot');
}

function isWeaponSlot(slot: string | null) {
  if (!slot) {
    return false;
  }
  const normalized = normalize(slot).replace(/_/g, ' ').replace(/-/g, ' ');
  return new Set(['main hand', 'off hand', 'two handed', '2h']).has(normalized);
}

function componentsBySlot(components: string[]) {
  const bySlot: Record<string, string> = {};
  for (const component of components) {
    const slot = inferSlot(component);
    if (slot && !bySlot[slot]) {
      bySlot[slot] = component;
    }
  }
  return bySlot;
}

function weaponComponents(components: string[]) {
  const slots = new Set(['Main hand', 'Off-hand', 'Two-handed']);
  return components.filter((component) => {
    const slot = inferSlot(component);
    return Boolean(slot && slots.has(slot));
  });
}

function renderSetCosmeticOverrideSection(outfitTitle: string, components: string[]) {
  const bySlot = componentsBySlot(components);
  const mainhand = bySlot['Main hand'];
  const offhand = bySlot['Off-hand'];
  const twoHanded = bySlot['Two-handed'];
  const useTwoHandedMode = Boolean(twoHanded) && !(mainhand && offhand);
  const selected = new Set<string>(useTwoHandedMode ? [twoHanded].filter(Boolean) as string[] : [mainhand, offhand].filter(Boolean) as string[]);

  const slotFields: Array<[string, string]> = [
    ['head', 'Head'],
    ['back', 'Back'],
    ['neck', 'Neck'],
    ['wings', 'Wings'],
    ['torso', 'Torso'],
    ['legs', 'Legs'],
    ['hands', 'Hands'],
    ['feet', 'Feet'],
  ];

  const lines = [
    '==Cosmetic override==',
    '{{Infobox Cosmetic override',
    '|slot = Set',
    `|maleimage = ${outfitTitle} equipped (male).png`,
    `|femaleimage = ${outfitTitle} equipped (female).png`,
  ];
  for (const [field, slotName] of slotFields) {
    const component = bySlot[slotName];
    if (component) {
      lines.push(`|${field} = ${component}`);
    }
  }
  if (useTwoHandedMode) {
    if (twoHanded) {
      lines.push(`|2h = ${twoHanded}`);
    }
  } else {
    if (mainhand) {
      lines.push(`|mainhand = ${mainhand}`);
    }
    if (offhand) {
      lines.push(`|offhand = ${offhand}`);
    }
  }
  lines.push('}}', '');

  const overflowWeapons = weaponComponents(components).filter((component) => !selected.has(component));
  if (overflowWeapons.length > 0) {
    lines.push('In addition, this pack also includes the following components:', '{{Cosmetic override gallery');
    for (const component of overflowWeapons) {
      lines.push(`|${component}`);
    }
    lines.push('}}', '');
  }
  return lines.join('\n');
}

function replaceOrInsertSection(wikitext: string, heading: string, newSection: string) {
  const lines = wikitext.split('\n');
  const headingLine = `==${heading}==`.toLowerCase();
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === headingLine);

  if (startIndex >= 0) {
    let endIndex = lines.length;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (isLevelTwoHeading(lines[index])) {
        endIndex = index;
        break;
      }
    }
    const merged = [...lines.slice(0, startIndex), ...newSection.split('\n'), ...lines.slice(endIndex)];
    return `${merged.join('\n').replace(/\s+$/, '')}\n`;
  }

  const insertIndex = lines.findIndex((line) => line.trim().toLowerCase() === '==release history==');
  const merged = insertIndex < 0
    ? [...lines, '', ...newSection.split('\n')]
    : [...lines.slice(0, insertIndex), ...newSection.split('\n'), '', ...lines.slice(insertIndex)];
  return `${merged.join('\n').replace(/\s+$/, '')}\n`;
}

function renderModifiedOutfitPage(wikitext: string, outfitTitle: string, components: string[]) {
  const section = renderSetCosmeticOverrideSection(outfitTitle, components);
  let updated = replaceOrInsertSection(wikitext, 'Cosmetic override', section);
  updated = updated.replace(
    /^ *(?:(?:the|this)\b[^\n]*(?:set|outfit)\b[^\n]*|it\b[^\n]*)(?:contains|consists of|comprised of)\b[^\n]*:?\s*\n/gim,
    '',
  );
  for (const component of components) {
    const escaped = component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    updated = updated.replace(new RegExp(`^\\*\\s*${escaped}\\s*\\n`, 'gim'), '');
  }
  updated = updated.replace(/\n\n(\{\{clear\|left\}\})/g, '\n$1');
  updated = updated.replace(/\[\[([^\]|]+?)\s+\(override\)\]\]/gi, '[[$1 (override)|$1]]');
  return updated;
}

function renderDraft(
  componentTitle: string,
  outfitTitle: string,
  release: string,
  update: string,
  members: string,
  recolour: string,
  chatheadSize: string,
  chatheadLines: string[],
  discontinuedTemplate: string | null,
  releaseHistorySection: string | null,
  updateHistorySection: string | null,
  navigationTemplates: string[],
) {
  const weaponData = inferWeaponSlotAndType(componentTitle);
  const slot = weaponData ? weaponData[0] : inferSlot(componentTitle);
  const weaponType = weaponData ? weaponData[1] : null;
  const lines: string[] = [];

  if (discontinuedTemplate) {
    lines.push(discontinuedTemplate);
  }
  lines.push(
    '{{Infobox Skin',
    `|name = ${componentTitle}`,
    '|image = No',
    `|release = ${release}`,
    `|update = ${update}`,
    `|members = ${members}`,
    `|recolour = ${recolour}`,
    '|dbrow_id = ',
    '|id = ',
    '}}',
  );

  const intro = [componentLeadSentence(componentTitle, outfitTitle, slot, weaponType), ''];
  if (slot === 'Head') {
    if (chatheadLines.length > 0) {
      intro.unshift(...chatheadLines);
    } else {
      intro.unshift(`[[File:${componentTitle} chathead.png|left|${chatheadSize}]]`);
    }
  }
  lines.push(...intro);
  lines.push('==Cosmetic override==', '{{Infobox Cosmetic override', `|slot = ${slot ?? ''}`);
  if (weaponType && ['Main hand', 'Off-hand', 'Two-handed'].includes(slot ?? '')) {
    lines.push(`|type = ${weaponType}`, `|image = ${componentTitle} equipped.png`);
  } else {
    lines.push(`|maleimage = ${componentTitle} equipped (male).png`, `|femaleimage = ${componentTitle} equipped (female).png`);
  }
  lines.push('}}', '');

  if (releaseHistorySection) {
    lines.push(releaseHistorySection, '');
  }
  if (updateHistorySection) {
    lines.push(updateHistorySection, '');
  }
  if (navigationTemplates.length > 0) {
    lines.push(...navigationTemplates);
  }
  lines.push('');
  return lines.join('\n');
}

export async function generateDraftBundle(wiki: MediaWikiClient, options: GenerateDraftOptions): Promise<DraftBundle> {
  const outfitTitle = titleFromInput(options.outfitInput);
  const response = await wiki.request<{ parse?: ParseResponse; error?: { info?: string } }>({
    action: 'parse',
    page: outfitTitle,
    prop: 'links|wikitext',
    formatversion: 2,
  });
  if (!response.parse) {
    throw new Error('Unexpected API response: missing parse data.');
  }

  const wikitext = String(response.parse.wikitext ?? '');
  const linkedComponents = candidateComponents(response.parse.links ?? [], outfitTitle, options.includeExisting);
  const extractedComponents = unlinkedComponentsFromWikitext(wikitext, outfitTitle);
  const [release, update] = outfitReleaseUpdate(wikitext);
  const members = outfitMembersValue(wikitext);
  const recolour = outfitRecolourValue(wikitext);
  const chatheadSize = outfitChatheadSize(wikitext);
  const discontinuedTemplate = discontinuedOverrideTemplate(wikitext);
  const releaseHistorySection = extractSection(wikitext, 'Release history');
  const updateHistorySection = extractSection(wikitext, 'Update history', true);
  const navigationTemplates = bottomNavigationTemplates(wikitext);

  const baseComponents = extractedComponents.length > 0 ? extractedComponents : linkedComponents;
  const componentMap = new Map<string, string>();
  for (const title of baseComponents) {
    componentMap.set(normalize(title), title);
  }
  let components = [...componentMap.values()].sort((a, b) => a.localeCompare(b));

  if (components.length === 0) {
    if (isWeaponSlot(cosmeticOverrideSlotValue(wikitext))) {
      components = [outfitTitle];
    } else {
      throw new Error('No candidate component pages found. Try Include existing pages or confirm the outfit title/URL.');
    }
  }

  const drafts: GeneratedDraft[] = components.map((title) => {
    const chatheadLines = outfitChatheadLinesForComponent(wikitext, title);
    return {
      title,
      filename: `${filesystemName(title)}.wiki`,
      content: renderDraft(
        title,
        outfitTitle,
        release,
        update,
        members,
        recolour,
        chatheadSize,
        chatheadLines,
        discontinuedTemplate,
        releaseHistorySection,
        updateHistorySection,
        navigationTemplates,
      ),
      kind: 'component',
    };
  });

  drafts.push({
    title: outfitTitle,
    filename: `${filesystemName(outfitTitle)}.wiki`,
    content: renderModifiedOutfitPage(wikitext, outfitTitle, components),
    kind: 'outfit',
  });

  return {
    outfitTitle,
    components,
    drafts,
  };
}
