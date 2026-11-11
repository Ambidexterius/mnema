import {readFileSync} from 'node:fs';
import {defineConfig} from 'vite';
const {version}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
export default defineConfig({define:{'import.meta.env.VITE_DESIGN_WORKBENCH':JSON.stringify('false'),'import.meta.env.VITE_APP_VERSION':JSON.stringify(version)},build:{rollupOptions:{onwarn(warning,warn){if(warning.code==='MODULE_LEVEL_DIRECTIVE'&&warning.message.includes('use client'))return;warn(warning)}}}});
