import { describe, expect, it } from 'vitest';
import { buildCatalog, realizedCapabilities, visibleTools, type CatalogEntry } from '../src/index.js';

function entry(name: string, capability: string | undefined, upstreamId = 'crm'): CatalogEntry {
  return { upstreamId, name, description: undefined, inputSchema: undefined, capability };
}

describe('el mapeo tool→capacidad', () => {
  it('es de muchas a una, y esa es la situación normal', () => {
    const catalog = buildCatalog([
      entry('get_contact', 'crm.contact.read'),
      entry('search_contacts', 'crm.contact.read'),
      entry('buscar', 'crm.contact.read', 'crm-legado'),
    ]);
    expect(realizedCapabilities(catalog)).toEqual(['crm.contact.read']);
    expect(visibleTools(catalog, ['crm.contact.read'])).toHaveLength(3);
  });

  it('una tool sin capacidad declarada no entra en el catálogo', () => {
    const catalog = buildCatalog([entry('get_contact', 'crm.contact.read'), entry('delete_contact', undefined)]);
    expect(catalog.tools.map((tool) => tool.name)).toEqual(['get_contact']);
    expect(catalog.unmapped).toEqual([{ upstreamId: 'crm', name: 'delete_contact' }]);
  });

  it('y no aparece en ningún catálogo filtrado, se conceda lo que se conceda', () => {
    const catalog = buildCatalog([entry('delete_contact', undefined)]);
    expect(visibleTools(catalog, ['crm.contact.read', 'crm.contact.write'])).toEqual([]);
  });
});

describe('el catálogo filtrado', () => {
  it('solo contiene lo concedido: lo demás no sale marcado, no sale', () => {
    const catalog = buildCatalog([entry('get_contact', 'crm.contact.read'), entry('upsert_contact', 'crm.contact.write')]);
    expect(visibleTools(catalog, ['crm.contact.read']).map((tool) => tool.name)).toEqual(['get_contact']);
  });

  it('sin capacidades concedidas no se ve nada', () => {
    const catalog = buildCatalog([entry('get_contact', 'crm.contact.read')]);
    expect(visibleTools(catalog, [])).toEqual([]);
  });
});
