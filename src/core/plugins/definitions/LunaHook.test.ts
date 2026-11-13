import { describe, expect, it } from '@effect/vitest'
import { pluginPath } from './LunaHook'

describe('LunaHook', () => {
  it('unpacks the hook libraries, the locale tools and their licences', () => {
    expect(
      [
        'LunaTranslator_x64/files/LunaHook/LunaHost64.dll',
        'LunaTranslator_x64/files/LunaHook/LunaTmpFontLoader.dll',
        'LunaTranslator_x64/files/Locale/ntleas046_x64/x86/ntleas.exe',
        'LunaTranslator_x64/files/Locale/Locale_Remulator/LRConfig.xml',
        'LunaTranslator_x64/files/Locale/Locale.Emulator/LEProc.exe',
        'LunaTranslator_x64/LICENSES/LICENSE.InWILL.Locale_Remulator',
        'LunaTranslator_x64/LunaTranslator.exe',
      ].map(pluginPath),
    ).toEqual([
      'LunaHost64.dll',
      undefined,
      'locale/ntleas/x86/ntleas.exe',
      'locale/locale-remulator/LRConfig.xml',
      undefined,
      'LICENSES/Locale_Remulator',
      undefined,
    ])
  })
})
