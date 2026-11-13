import { bundledFonts } from '#contract/Manga'
import { useLocalFonts } from '#lib/useLocalFonts'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '#ui/select'

const galleryChoice = ''

export function FontPicker({
  font,
  galleryFont,
  onFont,
}: {
  readonly font: string | undefined
  readonly galleryFont: string
  readonly onFont: (font: string | undefined) => void
}) {
  const { fonts: installed, load } = useLocalFonts()

  const items = {
    [galleryChoice]: `Gallery font · ${galleryFont}`,
    ...Object.fromEntries(bundledFonts.map((each) => [each, each])),
    ...Object.fromEntries(installed.map((family) => [family, family])),
    ...(font === undefined ? {} : { [font]: font }),
  }

  return (
    <Select
      items={items}
      value={font ?? galleryChoice}
      onOpenChange={load}
      onValueChange={(chosen) =>
        onFont(chosen === galleryChoice || chosen === null ? undefined : chosen)
      }
    >
      <SelectTrigger aria-label="Font" size="sm" className="w-full rounded-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={galleryChoice}>Gallery font · {galleryFont}</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Comes with Wenbu</SelectLabel>
          {bundledFonts.map((each) => (
            <SelectItem key={each} value={each}>
              {each}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Installed</SelectLabel>
          {installed.map((family) => (
            <SelectItem key={family} value={family}>
              {family}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
