import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defineConfig} from 'vite';
const {version}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
let soundOutput:string;
const completionSoundGuard={name:'required-completion-sound',apply:'build' as const,configResolved(config){soundOutput=resolve(config.root,config.build.outDir,'sounds/transcription-complete.mp3')},closeBundle(){const original=readFileSync(new URL('./public/sounds/transcription-complete.mp3',import.meta.url));if(original.length<100||!readFileSync(soundOutput).equals(original))throw new Error('Completion sound is missing or differs from the source asset')}};
export default defineConfig({plugins:[completionSoundGuard],define:{'import.meta.env.VITE_DESIGN_WORKBENCH':JSON.stringify('false'),'import.meta.env.VITE_APP_VERSION':JSON.stringify(version)},build:{rollupOptions:{onwarn(warning,warn){if(warning.code==='MODULE_LEVEL_DIRECTIVE'&&warning.message.includes('use client'))return;warn(warning)}}}});
