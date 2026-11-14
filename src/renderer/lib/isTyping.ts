export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
