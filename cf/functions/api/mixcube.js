/* GET /api/mixcube — cubo de categorias/produtos do escopo do usuário (lazy). */
import { emailSessao, registroUsuarios, json } from "./_lib.js";

export async function onRequestGet({ request, env }) {
  const email = await emailSessao(request, env);
  if (!email) return json({ erro: "nao_autenticado" }, 401);
  const usuarios = await registroUsuarios(env);
  const u = usuarios[email];
  if (!u) return json({ erro: "nao_cadastrado" }, 403);
  const raw = await env.BOOK_DATA.get("mix:" + u.chave);
  if (!raw) return json({ erro: "indisponivel" }, 503);
  return new Response(raw, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
