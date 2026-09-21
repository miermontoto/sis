import { describe, expect, it } from 'vitest';
import { normalizeInstanceUrl, instanceHost } from './instance-url';

describe('normalizeInstanceUrl', () => {
  it('assumes https when no scheme is given', () => {
    expect(normalizeInstanceUrl('sis.example.org')).toBe('https://sis.example.org');
  });

  it('strips paths, query and trailing slashes down to the origin', () => {
    expect(normalizeInstanceUrl('https://sis.example.org/login?x=1')).toBe('https://sis.example.org');
    expect(normalizeInstanceUrl('  https://sis.example.org/  ')).toBe('https://sis.example.org');
  });

  it('keeps a non-default port', () => {
    expect(normalizeInstanceUrl('sis.example.org:8443')).toBe('https://sis.example.org:8443');
  });

  it('rejects http and other schemes', () => {
    expect(normalizeInstanceUrl('http://sis.example.org')).toBeNull();
    expect(normalizeInstanceUrl('ftp://sis.example.org')).toBeNull();
  });

  it('rejects empty and unparseable input', () => {
    expect(normalizeInstanceUrl('')).toBeNull();
    expect(normalizeInstanceUrl('   ')).toBeNull();
    expect(normalizeInstanceUrl('https://')).toBeNull();
    expect(normalizeInstanceUrl('not a url')).toBeNull();
  });
});

describe('instanceHost', () => {
  it('returns host with port when present', () => {
    expect(instanceHost('https://sis.example.org:8443')).toBe('sis.example.org:8443');
    expect(instanceHost('https://sis.mier.info')).toBe('sis.mier.info');
  });
});
