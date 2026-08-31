export function normalizeUrl(link: any): string {
  if (typeof link !== 'string' || !link.trim()) return '';
  try {
    const url = new URL(link);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href;
    }
  } catch {}
  return '';
}

export function normalizeSource(link: any): string {
  const url = normalizeUrl(link);
  if (!url) return 'Unknown';
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return 'Unknown';
  }
}

export function normalizeTitle(title: any): string {
  return (typeof title === 'string' && title.trim()) ? title.trim() : 'No title';
}

export function normalizeDescription(snippet: any): string {
  return (typeof snippet === 'string' && snippet.trim()) ? snippet.trim() : 'No description available';
}

export function normalizeDate(date: any): string | undefined {
  return (typeof date === 'string' && date.trim()) ? date.trim() : undefined;
}
