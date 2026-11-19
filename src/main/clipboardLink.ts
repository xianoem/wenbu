const longestLink = 2048

/** Only a lone web address leaves main; other clipboard text never reaches core. */
export const clipboardLink = (text: string) => {
  const trimmed = text.trim()

  if (trimmed.length > longestLink || /\s/.test(trimmed)) {
    return undefined
  }

  const url = URL.parse(trimmed)

  return url !== null && (url.protocol === 'https:' || url.protocol === 'http:')
    ? trimmed
    : undefined
}
