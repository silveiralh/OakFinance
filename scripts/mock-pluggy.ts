// Mock mínimo da API da Pluggy para E2E e integração (tech §8.2). Roda no Deno.
// As rotas do sandbox (contas, transações, webhooks) chegam na T-077.
const PORT = 54400;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function handle(request: Request): Response {
  const { pathname } = new URL(request.url);
  if (pathname === '/health') {
    return json({ status: 'ok' });
  }
  return json({ code: 404, message: 'rota não simulada' }, 404);
}

if (import.meta.main) {
  Deno.serve({ port: PORT, hostname: '127.0.0.1' }, handle);
}
