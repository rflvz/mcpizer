/**
 * El `path` es la parte que hace útil un motivo. Un `path` que no resuelve
 * satisface el tipo y no sirve para nada: el bucle de corrección del invariante
 * 4 depende de que el sitio señalado exista de verdad
 * (`docs/diseno/verificacion.md` §3.3).
 */
import { describe, expect, it } from 'vitest';
import { compile, pointer, readDocument } from '../src/index.js';

const TEXT = `version: 1
capabilities:
  - id: crm.contact.read
accounts:
  - id: crm-ro
    secret: { ref: "env://CRM_RO" }
principals:
  issuers:
    - id: ci
      kind: static-key
      attributes:
        role: automation
grants:
  - to: { issuer: ci }
    capabilities: [crm.contact.read]
    using: crm-ro
`;

describe('resolución de punteros', () => {
  it('un puntero a una concesión cae sobre su propia línea', () => {
    const { document } = readDocument(TEXT);
    const position = document?.resolve('/grants/0');
    expect(position).toBeDefined();
    expect(TEXT.split('\n')[(position?.line ?? 1) - 1]).toContain('to:');
  });

  it('un puntero a un campo concreto cae sobre su valor', () => {
    const { document } = readDocument(TEXT);
    const position = document?.resolve('/grants/0/using');
    expect(TEXT.slice(position?.offset ?? 0)).toMatch(/^crm-ro/);
  });

  it('un puntero a una sección cae dentro del documento', () => {
    const { document } = readDocument(TEXT);
    expect(document?.resolve('/capabilities')?.offset).toBeLessThan(TEXT.length);
  });

  it('un puntero que no apunta a nada devuelve `undefined`, no una posición inventada', () => {
    const { document } = readDocument(TEXT);
    expect(document?.resolve('/grants/7/using')).toBeUndefined();
  });

  it('los segmentos con `/` o `~` se escapan y se recuperan', () => {
    expect(pointer('grants', 0, 'a/b')).toBe('/grants/0/a~1b');
    expect(pointer('x~y')).toBe('/x~0y');
  });
});

describe('todo diagnóstico señala una posición del documento', () => {
  it('y esa posición corresponde al texto que lo origina', () => {
    const broken = TEXT.replace('using: crm-ro', 'using: no-existe');
    const result = compile(broken);
    const lines = broken.split('\n');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.position).toBeDefined();
      const line = lines[(diagnostic.position?.line ?? 1) - 1];
      expect(line).toBeDefined();
    }
    expect(lines[(result.diagnostics[0]?.position?.line ?? 1) - 1]).toContain('no-existe');
  });
});
