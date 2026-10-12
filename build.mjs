// node build.mjs           → dist-live/  the live site Cloudflare Pages serves (sign-in, shared D1 data)
// node build.mjs preview   → dist-preview/PlaneShare.html  the demo as one file for the Claude preview
//                            (React from cdnjs, fictional data on the device)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';

const target = process.argv[2] === 'preview' ? 'preview' : 'live';
const css = readFileSync('src/ui/styles.css', 'utf8');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Semi+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@500;600&display=swap">';
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
const common = { entryPoints: ['src/main.tsx'], bundle: true, format: 'iife', target: 'es2020', jsx: 'transform', minify: true, write: false, legalComments: 'none' };

if (target === 'preview') {
  const globals = {
    name: 'globals',
    setup(b) {
      b.onResolve({ filter: /^react(-dom)?(\/client)?$/ }, (a) => ({ path: a.path, namespace: 'g' }));
      b.onLoad({ filter: /.*/, namespace: 'g' }, (a) => ({ contents: `module.exports = ${a.path.startsWith('react-dom') ? 'window.ReactDOM' : 'window.React'};`, loader: 'js' }));
    },
  };
  const out = await build({ ...common, plugins: [globals], define: { 'process.env.NODE_ENV': '"production"', __LIVE__: 'false' } });
  mkdirSync('dist-preview', { recursive: true });
  writeFileSync('dist-preview/PlaneShare.html', `<title>PlaneShare</title>
<meta name="theme-color" content="#0B2545">
${fonts}
<style>${css}</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>${safe(out.outputFiles[0].text)}</script>
`);
  console.log('dist-preview/PlaneShare.html', (out.outputFiles[0].text.length / 1024).toFixed(0) + 'KB js');
} else {
  const out = await build({ ...common, define: { 'process.env.NODE_ENV': '"production"', __LIVE__: 'true' } });
  rmSync('dist-live', { recursive: true, force: true });
  mkdirSync('dist-live', { recursive: true });
  cpSync('public', 'dist-live', { recursive: true });
  writeFileSync('dist-live/app.js', out.outputFiles[0].text);
  writeFileSync('dist-live/index.html', `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>PlaneShare</title>
<meta name="theme-color" content="#0B2545">
<meta name="robots" content="noindex, nofollow">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="PlaneShare">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${fonts}
<style>:root{padding-top:env(safe-area-inset-top,0px)}body{margin:0}[hidden]{display:none!important}${css}</style>
</head><body><div id="root"></div>
<script src="/app.js?v=${Date.now().toString(36)}"></script>
</body></html>
`);
  console.log('dist-live/', (out.outputFiles[0].text.length / 1024).toFixed(0) + 'KB js');
}
