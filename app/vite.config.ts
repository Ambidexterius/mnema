import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
let soundOutput: string;
const completionSoundGuard = {
  name: 'required-completion-sound',
  apply: 'build' as const,
  configResolved(config) {
    soundOutput = resolve(config.root, config.build.outDir, 'sounds/transcription-complete.mp3');
  },
  closeBundle() {
    const original = readFileSync(
      new URL('./public/sounds/transcription-complete.mp3', import.meta.url),
    );
    if (original.length < 100 || !readFileSync(soundOutput).equals(original))
      throw new Error('Completion sound is missing or differs from the source asset');
  },
};
const extension =
  process.env.MNEMA_APP_EXTENSION === '1'
    ? resolve(import.meta.dirname, 'private/index.tsx')
    : undefined;
const extensionEntry = resolve(import.meta.dirname, 'extension.tsx');
const extensionResolver = {
  name: 'app-extension',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (
      extension &&
      source.startsWith('.') &&
      importer &&
      resolve(dirname(importer), source) === extensionEntry
    )
      return extension;
  },
};
export default defineConfig({
  plugins: [extensionResolver, completionSoundGuard],
  define: {
    'import.meta.env.VITE_DESIGN_WORKBENCH': JSON.stringify('false'),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client'))
          return;
        warn(warning);
      },
    },
  },
});
