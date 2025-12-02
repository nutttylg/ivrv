import { readFileSync } from 'fs';
import { join } from 'path';

export default async function handler(req: Request) {
  const html = readFileSync(join(process.cwd(), 'index-v2.html'), 'utf-8');

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  });
}
