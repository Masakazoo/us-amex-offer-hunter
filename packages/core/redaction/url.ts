/** Run-local aliases, not hashes: unknown hosts/paths may themselves contain PII. */
export class UrlRedactor {
  private hosts = new Map<string, string>();
  private paths = new Map<string, string>();
  sanitize(raw: string): { url: string; host: string; path: string } {
    try {
      const value = new URL(raw);
      if (!['https:', 'http:'].includes(value.protocol)) throw new Error();
      const host =
        value.hostname === 'www.americanexpress.com'
          ? value.hostname
          : this.alias(this.hosts, value.host, 'host-');
      const path =
        value.pathname === '/'
          ? '/'
          : '/' +
            this.alias(this.paths, value.origin + value.pathname, 'route-');
      return { url: `${value.protocol}//${host}${path}`, host, path };
    } catch {
      return { url: 'redacted', host: 'redacted', path: '/redacted' };
    }
  }
  private alias(map: Map<string, string>, key: string, prefix: string): string {
    let alias = map.get(key);
    if (!alias) {
      alias = `${prefix}${map.size + 1}`;
      map.set(key, alias);
    }
    return alias;
  }
}
