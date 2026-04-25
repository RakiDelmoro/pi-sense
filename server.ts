import { serve } from 'bun';

const PORT = 3000;

const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function getMimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.'));
  return mimeTypes[ext] || 'application/octet-stream';
}

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    if (path === '/') {
      path = '/index.html';
    }

    const filePath = `.${path}`;
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      return new Response('Not Found', { status: 404 });
    }

    if (path.endsWith('.ts')) {
      const result = await Bun.build({
        entrypoints: [filePath],
        target: 'browser',
      });
      if (!result.success) {
        return new Response('Build Error', { status: 500 });
      }
      return new Response(result.outputs[0], {
        headers: { 'Content-Type': 'application/javascript' },
      });
    }

    return new Response(file, {
      headers: { 'Content-Type': getMimeType(path) },
    });
  },
});

console.log(`Pisense dev server running at http://localhost:${PORT}`);
