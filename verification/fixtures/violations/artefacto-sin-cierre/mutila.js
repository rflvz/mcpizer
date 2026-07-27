#!/usr/bin/env node
/**
 * El caso que hace fallar "el artefacto es autocontenido".
 *
 *   node mutila.js <artefacto> <destino>
 *
 * Copia un artefacto **sin su cierre de dependencias**: el programa entero, sus
 * declaraciones, su manifiesto, y ningún `node_modules`. Es lo que queda si el
 * empaquetado deja de arrastrar lo que el fichero de bloqueo dice, o si alguien
 * cambia `pnpm deploy` por un `cp -r dist`.
 *
 * Lo interesante es que *parece* un artefacto: tiene punto de entrada, tiene
 * versión, y `ls` no delata nada. Solo se cae al arrancar — y por eso la
 * comprobación de al lado tiene que arrancarlo y no limitarse a mirarlo.
 */
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , origen, destino] = process.argv;
if (origen === undefined || destino === undefined) {
  process.stderr.write('Uso: node mutila.js <artefacto> <destino>\n');
  process.exit(2);
}

mkdirSync(destino, { recursive: true });
cpSync(join(origen, 'dist'), join(destino, 'dist'), { recursive: true });
cpSync(join(origen, 'package.json'), join(destino, 'package.json'));

process.stdout.write(`${destino}\n`);
