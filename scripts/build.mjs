// Bundles Orbis into self-contained HTML files:
//   dist/index.html   a complete document (host anywhere, or open from disk)
//   dist/embed.html   the same page without the document wrapper, for hosts
//                     that supply their own <html>/<head>/<body>
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const html = await readFile(join(root, 'index.html'), 'utf8');

const between = (a, b) => {
  const i = html.indexOf(a);
  const j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`markers ${a} / ${b} not found`);
  return html.slice(i + a.length, j).trim();
};
const head = between('<!--BUILD:HEAD-->', '<!--/BUILD:HEAD-->');
const body = between('<!--BUILD:BODY-->', '<!--/BUILD:BODY-->');
const title = /<title>(.*?)<\/title>/.exec(html)[1];
const description = /<meta name="description" content="(.*?)">/.exec(html)[1];

const result = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const script = `<script>\n${js}</script>`;
const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
${head}
</head>
<body>
${body}
${script}
</body>
</html>
`;
const embed = `<title>${title}</title>
${head}
${body}
${script}
`;

await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/index.html'), full);
await writeFile(join(root, 'dist/embed.html'), embed);
console.log(`dist/index.html  ${(full.length / 1024).toFixed(1)} KB`);
console.log(`dist/embed.html  ${(embed.length / 1024).toFixed(1)} KB`);
