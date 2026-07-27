/**
 * `CredentialResolver` sobre Vault, contra un Vault de mentira que habla el API
 * real (`verification/fixtures/vault/server.js`).
 *
 * Lo que se comprueba no es que sepamos construir una URL: es que **ningún modo
 * de fallo degrada a ejecutar sin credencial** y que **ningún mensaje lleva
 * material**. Los dos son el invariante 6, y son la razón de que este adaptador
 * merezca existir frente al de variables de entorno.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startVault, type VaultFixture } from '../../verification/lib/fixtures.js';
import { vaultCredentials } from '../src/vault-credentials.js';

const SECRETO = 'centinela-de-boveda-4c1f7ae2';

let boveda: VaultFixture | undefined;

async function conBoveda(): Promise<VaultFixture> {
  boveda = await startVault({
    secrets: {
      'kv/mcpizer/crm-ro': { value: SECRETO },
      'kv/mcpizer/crm-rw': { token: 'otro-centinela-9d2b', value: 'el-de-por-defecto' },
    },
  });
  return boveda;
}

afterEach(async () => {
  await boveda?.close();
  boveda = undefined;
});

describe('canjea la referencia por material', () => {
  it('resuelve `vault://montaje/ruta` por el campo de por defecto', async () => {
    const vault = await conBoveda();
    const resolver = vaultCredentials({ address: vault.url, token: vault.token });

    expect(await resolver.resolve('vault://kv/mcpizer/crm-ro')).toEqual({ value: SECRETO });
  });

  it('la referencia puede nombrar el campo', async () => {
    const vault = await conBoveda();
    const resolver = vaultCredentials({ address: vault.url, token: vault.token });

    expect(await resolver.resolve('vault://kv/mcpizer/crm-rw#token')).toEqual({ value: 'otro-centinela-9d2b' });
  });

  it('pide exactamente la ruta declarada, y nada más', async () => {
    const vault = await conBoveda();
    const resolver = vaultCredentials({ address: vault.url, token: vault.token });
    await resolver.resolve('vault://kv/mcpizer/crm-ro');

    // Nunca especulativamente, nunca para varias cuentas "por si acaso".
    expect(vault.peticiones).toEqual(['/v1/kv/data/mcpizer/crm-ro']);
  });
});

describe('ningún fallo degrada a ejecutar sin credencial', () => {
  it('la bóveda inalcanzable aborta', async () => {
    const vault = await conBoveda();
    const resolver = vaultCredentials({ address: vault.url, token: vault.token, timeoutMs: 500 });
    await vault.detiene();

    await expect(resolver.resolve('vault://kv/mcpizer/crm-ro')).rejects.toThrow(/no responde/);
  });

  it('el token que no vale aborta, y no dice cuál era', async () => {
    const vault = await conBoveda();
    const resolver = vaultCredentials({ address: vault.url, token: 'token-equivocado-a1b2c3' });

    await expect(resolver.resolve('vault://kv/mcpizer/crm-ro')).rejects.toThrow(
      /niega el acceso a `vault:\/\/kv\/mcpizer\/crm-ro`/,
    );
    await expect(resolver.resolve('vault://kv/mcpizer/crm-ro')).rejects.not.toThrow(/a1b2c3/);
  });

  it('la referencia desconocida aborta', async () => {
    const vault = await conBoveda();
    const resolver = vaultCredentials({ address: vault.url, token: vault.token });

    await expect(resolver.resolve('vault://kv/mcpizer/no-existe')).rejects.toThrow(/no existe en la bóveda/);
  });

  it('el secreto sin el campo pedido aborta', async () => {
    const vault = await conBoveda();
    const resolver = vaultCredentials({ address: vault.url, token: vault.token });

    await expect(resolver.resolve('vault://kv/mcpizer/crm-ro#no-esta')).rejects.toThrow(/campo `no-esta`/);
  });

  it('lo que no es `vault://` no es suyo', async () => {
    const vault = await conBoveda();
    const resolver = vaultCredentials({ address: vault.url, token: vault.token });

    await expect(resolver.resolve('env://ALGO')).rejects.toThrow(/no es `vault:\/\/`/);
  });
});

describe('ningún mensaje de error lleva material', () => {
  it('se nombra la referencia, que es un asa, nunca lo que hay al otro lado', async () => {
    const vault = await conBoveda();
    const resolver = vaultCredentials({ address: vault.url, token: vault.token });

    const mensajes: string[] = [];
    for (const ref of ['vault://kv/mcpizer/no-existe', 'vault://kv/mcpizer/crm-ro#no-esta', 'vault://mal']) {
      await resolver.resolve(ref).catch((error: unknown) => {
        mensajes.push(error instanceof Error ? `${error.message} ${String(error.cause ?? '')}` : String(error));
      });
    }

    expect(mensajes).toHaveLength(3);
    expect(mensajes.join('\n')).not.toContain(SECRETO);
    expect(mensajes.join('\n')).not.toContain(vault.token);
  });
});
