# Wenbu

Wenbu is a Windows desktop app for playing and reading untranslated games, manga and novels. It keeps a library of your local games and translates them with the LLM of your choice.

## Features

- **Game library**: register local games and launch them from one place.
- **RPG Maker translation**: translate the data of RPG Maker XP, VX, VX Ace, MV and MZ games, with the originals backed up first.
- **Translation overlay**: read live translations on top of a running game, with text hooked through [LunaHook](https://github.com/HIllya51/LunaTranslator).
- **Live subtitles**: transcribe and translate a game's speech as it plays.
- **Manga**: translate a folder of pages with [manga-image-translator](https://github.com/zyddnys/manga-image-translator), then fix the result in the editor.
- **Novels**: translate novels with glossaries that keep names and terms consistent.
- **Your own models**: connect any supported LLM provider, define presets and track what each one costs.

## Install

Download the latest `wenbu-…-setup.exe` from [Releases](https://github.com/xianoem/wenbu/releases) and run it. After that Wenbu keeps itself up to date: it downloads a new version in the background and installs it the next time you quit or restart.

### Windows may warn you about the installer

Wenbu is free and open source, and its installer is not code signed, because a signing certificate costs money every year. Windows doesn't know an unsigned installer, so the first time you run it SmartScreen shows "Windows protected your PC". To continue, choose **More info**, then **Run anyway**. You see this once; updates install without it.

Some antivirus tools may also flag Wenbu. To show a translation over a running game, Wenbu reads the game's text from inside the game's process, and that is the same technique some malware uses, so tools that judge by behaviour can mistake it for one. This is a false positive.

You don't have to take that on trust:

- Every installer is built from this repository's source by [GitHub Actions](https://github.com/xianoem/wenbu/actions), not on someone's computer.
- The source is here to read, and you can build the installer yourself with the steps below.

## Development

You need:

- [Node.js](https://nodejs.org) 24 and [pnpm](https://pnpm.io) 11
- [uv](https://docs.astral.sh/uv/)
- Visual Studio Build Tools 2022, with its C++ tools and CMake
- The [Vulkan SDK](https://vulkan.lunarg.com)

```bash
pnpm install
pnpm build:native
pnpm dev
```

Before sending a change, run:

```bash
pnpm check
pnpm test
pnpm build
```

`pnpm dist` builds the Windows installer.

## License

Wenbu is licensed under the [GNU General Public License v3.0](LICENSE).
