/**
 * `policy` se prueba como lo que es: una función de texto a diagnósticos y
 * modelo evaluable. Ni un doble — no hay nada que simular, porque no hay nada
 * que llamar.
 */
import { describe, expect, it } from 'vitest';
import { compile, hasErrors, type Diagnostic, type DiagnosticCode } from '../src/index.js';

/** Un artefacto mínimo y coherente, sobre el que cada caso cambia una cosa. */
function artifact(body: string): string {
  return `version: 1
capabilities:
  - id: crm.contact.read
upstreams:
  - id: crm
    transport: { kind: mcp-stdio, command: crm-server }
    tools:
      - name: get_contact
        capability: crm.contact.read
accounts:
  - id: crm-ro
    secret: { ref: "env://CRM_RO" }
principals:
  issuers:
    - id: ci
      kind: static-key
      attributes:
        role: automation
${body}`;
}

const BASE_GRANTS = `grants:
  - to: { issuer: ci, attributes: { role: automation } }
    capabilities: [crm.contact.read]
    using: crm-ro
`;

function codes(diagnostics: readonly Diagnostic[]): DiagnosticCode[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function withCode(diagnostics: readonly Diagnostic[], code: DiagnosticCode): Diagnostic {
  const found = diagnostics.find((diagnostic) => diagnostic.code === code);
  if (found === undefined) throw new Error(`No hay diagnóstico \`${code}\`; llegaron: ${codes(diagnostics).join(', ')}`);
  return found;
}

describe('un artefacto coherente', () => {
  it('compila sin hallazgos', () => {
    const result = compile(artifact(BASE_GRANTS));
    expect(result.diagnostics).toEqual([]);
    expect(result.policy?.grants).toHaveLength(1);
    expect(result.policy?.capabilities[0]?.realized).toBe(true);
  });

  it('interpreta la ventana del techo', () => {
    const result = compile(
      artifact(`grants:
  - to: { issuer: ci }
    capabilities: [crm.contact.read]
    using: crm-ro
    limits: { calls: 20, per: 24h }
`),
    );
    expect(result.policy?.grants[0]?.limits).toEqual({ calls: 20, per: '24h', windowMs: 86_400_000 });
  });

  it('el resultado no depende del orden de las concesiones', () => {
    const one = compile(
      artifact(`grants:
  - to: { issuer: ci, attributes: { role: automation } }
    capabilities: [crm.contact.read]
    using: crm-ro
  - to: { issuer: ci }
    capabilities: [crm.contact.read]
    using: crm-ro
`),
    );
    const other = compile(
      artifact(`grants:
  - to: { issuer: ci }
    capabilities: [crm.contact.read]
    using: crm-ro
  - to: { issuer: ci, attributes: { role: automation } }
    capabilities: [crm.contact.read]
    using: crm-ro
`),
    );
    expect(one.diagnostics).toEqual([]);
    expect(other.diagnostics).toEqual([]);
  });
});

describe('lo que el esquema atrapa', () => {
  it('un YAML roto produce diagnóstico con posición, no una excepción', () => {
    const result = compile('version: 1\ncapabilities: [\n');
    expect(codes(result.diagnostics)).toContain('yaml_syntax');
    expect(withCode(result.diagnostics, 'yaml_syntax').position?.line).toBeGreaterThan(0);
  });

  it('un secreto literal en lugar de una referencia no valida', () => {
    const result = compile(
      `version: 1
capabilities: []
accounts:
  - id: crm-ro
    secret: "sk-esto-es-una-clave"
principals: { issuers: [] }
grants: []
`,
    );
    expect(codes(result.diagnostics)).toContain('schema_violation');
    expect(withCode(result.diagnostics, 'schema_violation').path).toContain('/accounts/0/secret');
  });

  it('un campo no declarado no pasa: el formato también falla cerrado', () => {
    const result = compile(artifact(`grants:
  - to: { issuer: ci }
    capabilities: [crm.contact.read]
    using: crm-ro
    deny: true
`));
    expect(codes(result.diagnostics)).toContain('schema_violation');
  });
});

describe('referencias colgantes', () => {
  it('una concesión que apunta a una cuenta inexistente', () => {
    const result = compile(artifact(`grants:
  - to: { issuer: ci }
    capabilities: [crm.contact.read]
    using: no-existe
`));
    const diagnostic = withCode(result.diagnostics, 'unknown_account_in_grant');
    expect(diagnostic.path).toBe('/grants/0/using');
    expect(diagnostic.position).toBeDefined();
    expect(result.policy).toBeUndefined();
  });

  it('una concesión que nombra una capacidad no declarada', () => {
    const result = compile(artifact(`grants:
  - to: { issuer: ci }
    capabilities: [crm.contact.write]
    using: crm-ro
`));
    expect(withCode(result.diagnostics, 'unknown_capability_in_grant').path).toBe('/grants/0/capabilities/0');
  });

  it('una concesión de un emisor no declarado', () => {
    const result = compile(artifact(`grants:
  - to: { issuer: corp }
    capabilities: [crm.contact.read]
    using: crm-ro
`));
    expect(withCode(result.diagnostics, 'unknown_issuer_in_grant').path).toBe('/grants/0/to/issuer');
  });

  it('un selector sobre un atributo que el emisor no declara', () => {
    const result = compile(artifact(`grants:
  - to: { issuer: ci, attributes: { team: ventas } }
    capabilities: [crm.contact.read]
    using: crm-ro
`));
    expect(withCode(result.diagnostics, 'attribute_not_declared').path).toBe('/grants/0/to/attributes/team');
  });

  it('un identificador declarado dos veces señala la primera aparición', () => {
    const result = compile(
      `version: 1
capabilities:
  - id: crm.contact.read
  - id: crm.contact.read
accounts:
  - id: crm-ro
    secret: { ref: "env://CRM_RO" }
principals: { issuers: [] }
grants: []
`,
    );
    const diagnostic = withCode(result.diagnostics, 'duplicate_id');
    expect(diagnostic.path).toBe('/capabilities/1');
    expect(diagnostic.related[0]?.path).toBe('/capabilities/0');
  });

  it('un emisor oidc con un atributo literal en lugar de un claim', () => {
    const result = compile(
      `version: 1
capabilities: []
accounts: []
principals:
  issuers:
    - id: corp
      kind: oidc
      attributes: { team: ventas }
grants: []
`,
    );
    expect(withCode(result.diagnostics, 'claim_mapping_expected').path).toBe('/principals/issuers/0/attributes/team');
  });
});

describe('la ambigüedad sobre la segunda identidad', () => {
  /** El mismo artefacto base, con dos cuentas: la segunda identidad en disputa. */
  function withTwoAccounts(grants: string): string {
    return `version: 1
capabilities:
  - id: crm.contact.read
upstreams:
  - id: crm
    transport: { kind: mcp-stdio, command: crm-server }
    tools:
      - name: get_contact
        capability: crm.contact.read
accounts:
  - id: crm-ro
    secret: { ref: "env://CRM_RO" }
  - id: crm-rw
    secret: { ref: "env://CRM_RW" }
principals:
  issuers:
    - id: ci
      kind: static-key
      attributes:
        role: automation
${grants}`;
  }

  it('falla en compilación y señala las dos concesiones', () => {
    const result = compile(
      withTwoAccounts(`grants:
  - to: { issuer: ci }
    capabilities: [crm.contact.read]
    using: crm-ro
  - to: { issuer: ci, attributes: { role: automation } }
    capabilities: [crm.contact.read]
    using: crm-rw
`),
    );
    const diagnostic = withCode(result.diagnostics, 'ambiguous_grant');
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.path).toBe('/grants/0');
    expect(diagnostic.related[0]?.path).toBe('/grants/1');
    expect(result.policy).toBeUndefined();
  });

  it('no hay ambigüedad si los selectores son disjuntos', () => {
    const result = compile(
      withTwoAccounts(`grants:
  - to: { issuer: ci, attributes: { role: automation } }
    capabilities: [crm.contact.read]
    using: crm-ro
  - to: { issuer: ci, attributes: { role: humano } }
    capabilities: [crm.contact.read]
    using: crm-rw
`),
    );
    expect(codes(result.diagnostics)).not.toContain('ambiguous_grant');
  });

  it('no hay ambigüedad si las concesiones coinciden con la misma cuenta', () => {
    const result = compile(
      artifact(`grants:
  - to: { issuer: ci }
    capabilities: [crm.contact.read]
    using: crm-ro
  - to: { issuer: ci, attributes: { role: automation } }
    capabilities: [crm.contact.read]
    using: crm-ro
    limits: { calls: 1, per: 1h }
`),
    );
    expect(codes(result.diagnostics)).not.toContain('ambiguous_grant');
    expect(hasErrors(result.diagnostics)).toBe(false);
  });
});

describe('señales que no impiden compilar', () => {
  it('una capacidad que ninguna tool realiza', () => {
    const result = compile(
      `version: 1
capabilities:
  - id: crm.contact.read
accounts: []
principals: { issuers: [] }
grants: []
`,
    );
    expect(withCode(result.diagnostics, 'capability_not_realized').severity).toBe('warning');
    expect(result.policy).toBeDefined();
  });

  it('una cuenta que nadie usa', () => {
    const result = compile(artifact('grants: []'));
    expect(withCode(result.diagnostics, 'unused_account').severity).toBe('warning');
    expect(result.policy).toBeDefined();
  });
});

describe('el catálogo declarado', () => {
  it('un mapeo a una tool que ya no existe es un error', () => {
    const result = compile(artifact(BASE_GRANTS), { catalog: [{ upstream: 'crm', name: 'otra_cosa' }] });
    expect(withCode(result.diagnostics, 'tool_not_in_catalog').path).toBe('/upstreams/0/tools/0/name');
    expect(result.policy).toBeUndefined();
  });

  it('una tool nueva que ningún mapeo cubre es un aviso, porque el fallo cerrado ya hizo lo correcto', () => {
    const result = compile(artifact(BASE_GRANTS), {
      catalog: [
        { upstream: 'crm', name: 'get_contact' },
        { upstream: 'crm', name: 'delete_contact' },
      ],
    });
    expect(withCode(result.diagnostics, 'catalog_tool_unmapped').severity).toBe('warning');
    expect(result.policy).toBeDefined();
  });
});
