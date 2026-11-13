export const isCheckPage = (status: number, headers: Headers, body: string) => {
  const cloudflare =
    (status === 403 || status === 503 || status === 429) &&
    (headers.get('server')?.toLowerCase().includes('cloudflare') === true ||
      /<title>Just a moment/i.test(body))

  const firewall =
    (status === 202 || status === 412) && (headers.has('x-waf-uuid') || /probe\.js/.test(body))

  return cloudflare || firewall
}
