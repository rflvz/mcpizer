// VIOLACIÓN: probar el núcleo no puede necesitar un doble. Si lo necesita,
// el núcleo ha dejado de ser una función de datos a datos.
import { vi, it, expect } from 'vitest';
vi.mock('../src/clock.js', () => ({ now: () => 0 }));
it('decide', () => { expect(true).toBe(true); });
