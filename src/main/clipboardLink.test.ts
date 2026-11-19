import { describe, expect, it } from '@effect/vitest'
import { clipboardLink } from './clipboardLink'

describe('clipboardLink', () => {
  it('takes a copied web address', () => {
    expect(clipboardLink('  https://hitomi.la/galleries/2841903.html\n')).toBe(
      'https://hitomi.la/galleries/2841903.html',
    )
  })

  it('ignores text that is not just one address', () => {
    expect(clipboardLink('see https://hitomi.la/galleries/2841903.html')).toBeUndefined()
    expect(clipboardLink('https://a.example https://b.example')).toBeUndefined()
  })

  it('ignores addresses that are not on the web', () => {
    expect(clipboardLink('file:///C:/Users/me/secret.txt')).toBeUndefined()
  })

  it('ignores very long text', () => {
    expect(clipboardLink(`https://example.com/${'a'.repeat(3000)}`)).toBeUndefined()
  })
})
