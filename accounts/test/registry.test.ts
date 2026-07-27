import { describe, expect, it } from 'vitest';
import { bind, registryOf, usable, type AccountRecord } from '../src/index.js';

const record = (id: string, disabled = false): AccountRecord => ({
  ref: { id },
  secret: { uri: `vault://kv/mcpizer/${id}` },
  disabled,
});

const REGISTRY = registryOf([record('crm-ro'), record('crm-rw', true)]);

describe('la resolución del vínculo', () => {
  it('distingue desconocida de deshabilitada', () => {
    expect(bind(REGISTRY, 'crm-ro')).toMatchObject({ kind: 'bound' });
    expect(bind(REGISTRY, 'crm-rw')).toMatchObject({ kind: 'disabled' });
    expect(bind(REGISTRY, 'no-existe')).toEqual({ kind: 'unknown', id: 'no-existe' });
  });

  it('solo una cuenta vinculada es utilizable', () => {
    expect(usable(bind(REGISTRY, 'crm-ro'))).toBe(true);
    expect(usable(bind(REGISTRY, 'crm-rw'))).toBe(false);
    expect(usable(bind(REGISTRY, 'no-existe'))).toBe(false);
  });
});

describe('la referencia al secreto', () => {
  it('es una referencia, no material: nada canjeable vive aquí', () => {
    const binding = bind(REGISTRY, 'crm-ro');
    expect(binding.kind).toBe('bound');
    if (binding.kind !== 'bound') return;
    expect(Object.keys(binding.record.secret)).toEqual(['uri']);
    expect(binding.record.secret.uri).toMatch(/^[a-z][a-z0-9+.-]*:\/\//);
  });

  it('el asa no lleva el secreto encima', () => {
    const binding = bind(REGISTRY, 'crm-ro');
    if (binding.kind !== 'bound') throw new Error('debería vincular');
    expect(Object.keys(binding.record.ref)).toEqual(['id']);
  });
});
