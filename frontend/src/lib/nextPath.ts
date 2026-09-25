/** Where to go after signing in: only paths inside this app, never another site ("//evil.com" or "https://…"). */
export function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/plan";
}
