export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyFindReplace(source: string, pattern: string, replace: string, useRegex: boolean, caseSensitive: boolean) {
  if (!useRegex) {
    const flags = caseSensitive ? 'g' : 'gi';
    const escaped = escapeRegExp(pattern);
    const regex = new RegExp(escaped, flags);
    const matches = source.match(regex)?.length ?? 0;
    return { text: source.replace(regex, replace), matches };
  }

  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(pattern, flags);
  const matches = source.match(regex)?.length ?? 0;
  return { text: source.replace(regex, replace), matches };
}

export function addCategoryTag(source: string, category: string) {
  const normalized = category.startsWith('Category:') ? category : `Category:${category}`;
  const tag = `[[${normalized}]]`;
  return source.includes(tag) ? source : `${source.trimEnd()}\n${tag}\n`;
}

export function removeCategoryTag(source: string, category: string) {
  const normalized = category.startsWith('Category:') ? category : `Category:${category}`;
  const tag = `[[${normalized}]]`;
  return source.replace(new RegExp(`\\n?${escapeRegExp(tag)}\\n?`, 'gi'), '\n').trimEnd() + '\n';
}
