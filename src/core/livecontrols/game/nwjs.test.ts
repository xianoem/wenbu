import { describe, expect, it } from '@effect/vitest'
import type { RuntimeArgument } from '../GameRuntime'
import source from './nwjs.js?raw'

class FakeImage {
  complete = false
  naturalWidth = 0
  private source = ''
  private loaded: Array<() => void> = []

  addEventListener(event: string, listener: () => void) {
    if (event === 'load') {
      this.loaded.push(listener)
    }
  }

  get src() {
    return this.source
  }

  set src(value: string) {
    this.source = value
    this.complete = true
    this.naturalWidth = 1
    this.loaded.forEach((listener) => listener())
  }
}

const makeGame = () => {
  const reads: Array<string> = []
  const drawn: Array<number> = []
  const texts: Array<{ readonly text: string; readonly size: number; readonly y: number }> = []

  class Bitmap {
    fontSize = 28

    drawText(text?: string, _x?: number, y?: number, _maxWidth?: number, _lineHeight?: number) {
      drawn.push(this.fontSize)

      if (text !== undefined) {
        texts.push({ text, size: this.fontSize, y: y ?? 0 })
      }
    }

    measureTextWidth(text = '') {
      return (text.length * this.fontSize) / 2
    }

    textColor = '#ffffff'
    painted: Array<string> = []
    ready = true
    listeners: Array<() => void> = []
    width = 32
    height = 16

    context = {
      drawImage: (image: FakeImage) => {
        this.painted.push(`draw ${Buffer.from(image.src.split(',')[1] ?? '', 'base64').toString()}`)
      },
    }

    clear() {
      this.painted.push('clear')
    }

    _setDirty() {
      this.painted.push('dirty')
    }

    blt(source: Bitmap, sx: number, sy: number, w: number, h: number, dx: number, dy: number) {
      this.painted.push(
        `blt ${source === this ? 'self' : 'copy'} ${sx},${sy},${w},${h} -> ${dx},${dy}`,
      )
    }

    isReady() {
      return this.ready
    }

    addLoadListener(listener: () => void) {
      this.listeners.push(listener)
    }

    load() {
      this.ready = true
      this.listeners.splice(0).forEach((listener) => listener())
    }
  }

  const imageCache = new Map<string, Bitmap>()

  const ImageManager = {
    loadBitmap(folder: string, filename: string) {
      const url = `${folder}${filename}.png`
      const cached = imageCache.get(url) ?? new Bitmap()

      imageCache.set(url, cached)

      return cached
    },
    _cache: new Map<string, Bitmap>(),
  }

  class Window_Base {
    contents = new Bitmap()

    createContents() {
      this.contents = new Bitmap()
    }

    resetFontSettings() {
      this.contents.fontSize = 28
    }

    standardFontSize() {
      return 28
    }

    lineHeight() {
      return 36
    }
  }

  interface TextState {
    text: string
    index: number
    x: number
    y: number
    left: number
  }

  class Window_Message extends Window_Base {
    printed: Array<{ readonly c: string; readonly y: number }> = []
    pauses = 0
    width = 100
    lines = 4

    textWidth(text: string) {
      return text.length * 10
    }

    contentsWidth() {
      return this.width
    }

    processCharacter(textState: TextState) {
      const c = textState.text[textState.index] ?? ''

      const code =
        c === '\x1b' ? /^[A-Z]+\[\d+\]/.exec(textState.text.slice(textState.index + 1)) : null

      if (code !== null) {
        textState.index += 1 + code[0].length
        this.printed.push({ c: c + code[0], y: textState.y })

        return
      }

      if (c === '\n') {
        this.processNewLine(textState)

        return
      }

      textState.index++
      this.printed.push({ c, y: textState.y })
      textState.x += this.textWidth(c)
    }

    processNewLine(textState: TextState) {
      textState.x = textState.left
      textState.y += 36
      textState.index++

      if (textState.y + 36 > this.lines * 36) {
        this.pauses++
        textState.y = 0
      }
    }

    show(text: string, left = 0) {
      const textState = { text, index: 0, x: left, y: 0, left }

      while (textState.index < textState.text.length) {
        this.processCharacter(textState)
      }

      const lines = new Map<number, string>()

      for (const { c, y } of this.printed) {
        lines.set(y, (lines.get(y) ?? '') + c)
      }

      return [...lines.values()].map((line) => line.trimEnd())
    }
  }

  class Game_Message {
    texts: Array<string> = []

    allText() {
      return this.texts.join('\n')
    }
  }

  class Window_ChoiceList extends Window_Base {}

  class Window_Gold extends Window_Base {}

  class Window_Menu extends Window_Base {
    label = ''
    width = 200
    height = 36
    refreshes = 0

    refresh() {
      this.refreshes++
      this.contents.drawText(this.label, 0, 0, this.width, this.height)
    }

    show(label: string, width = 200, height = 36) {
      this.label = label
      this.width = width
      this.height = height
      this.createContents()
      this.refresh()

      return texts.at(-1)
    }
  }

  class Game_BattlerBase {
    hp = 100
    mhp = 100
    mp = 10
    states: Array<number> = []
    paramPlus = [0, 0, 0, 0, 0, 0, 0, 0]

    setHp(hp: number) {
      this.hp = hp

      if (hp === 0) {
        this.addState(1)
      }
    }

    setMp(mp: number) {
      this.mp = mp
    }

    deathStateId() {
      return 1
    }

    isDead() {
      return this.states.includes(1)
    }

    addState(stateId: number) {
      this.states.push(stateId)
    }

    removeState(stateId: number) {
      this.states = this.states.filter((id) => id !== stateId)
    }

    param(id: number) {
      return 10 + (this.paramPlus[id] ?? 0)
    }

    addParam(id: number, value: number) {
      this.paramPlus[id] = (this.paramPlus[id] ?? 0) + value
    }

    isActor() {
      return false
    }

    isEnemy() {
      return false
    }
  }

  class Game_Battler extends Game_BattlerBase {}

  class Game_Actor extends Game_Battler {
    level = 1
    readonly id: number

    constructor(id: number) {
      super()
      this.id = id
    }

    actorId() {
      return this.id
    }

    name() {
      return `Hero ${this.id}`
    }

    nickname() {
      return ''
    }

    currentExp() {
      return 0
    }

    changeLevel(level: number) {
      this.level = level
    }

    changeExp() {}

    maxLevel() {
      return 99
    }

    override isActor() {
      return true
    }
  }

  class Game_Enemy extends Game_Battler {
    override isEnemy() {
      return true
    }
  }

  class Game_Action {
    readonly user: Game_Battler

    constructor(user: Game_Battler) {
      this.user = user
    }

    subject() {
      return this.user
    }

    isHpEffect() {
      return true
    }

    makeDamageValue(_target: Game_Battler) {
      return 7
    }
  }

  class Game_CharacterBase {
    distancePerFrame() {
      return 0.25
    }
  }

  class Game_Player extends Game_CharacterBase {}

  class Game_Follower extends Game_CharacterBase {}

  const actors = [new Game_Actor(1), new Game_Actor(2)]
  let gold = 50
  const switches = new Map<number, boolean>()
  const message = new Game_Message()

  const mapEvent = (id: number, x: number, y: number, pageIndex: number, erased = false) => ({
    eventId: () => id,
    x,
    y,
    _pageIndex: pageIndex,
    _erased: erased,
  })

  const window: Record<string, unknown> = {
    Bitmap,
    Image: FakeImage,
    require: (module: string) =>
      module === 'fs'
        ? {
            readFileSync: (file: string) => {
              reads.push(file)

              return Buffer.from(`png:${file}`)
            },
          }
        : undefined,
    ImageManager,
    Window_Base,
    Window_Message,
    Game_Message,
    Game_BattlerBase,
    Game_Battler,
    Game_Action,
    Game_CharacterBase,
    Game_Follower,
    SceneManager: { _scene: undefined, updateScene: () => undefined },
  }

  const loadSave = () => {
    Object.assign(window, {
      $gamePlayer: new Game_Player(),
      $gameParty: {
        leader: () => actors[0],
        members: () => actors,
        gold: () => gold,
        maxGold: () => 9999,
        gainGold: (amount: number) => {
          gold += amount
        },
        inBattle: () => false,
        _actors: [1, 2],
        _items: { 7: 2, 9: 0 },
        _weapons: { 3: 1 },
        _armors: {},
      },
      $gameActors: { actor: (id: number) => actors[id - 1] },
      $gameSwitches: {
        _data: [null, true, false, true],
        value: (id: number) => switches.get(id) ?? false,
        setValue: (id: number, value: boolean) => switches.set(id, value),
      },
      $gameVariables: { _data: [0, 0, 3, 'left', 0], value: () => 0, setValue: () => undefined },
      $gameSelfSwitches: { _data: { '3,7,A': true, '3,8,B': false } },
      $gameMap: {
        mapId: () => 3,
        displayName: () => 'Riverside',
        events: () => [mapEvent(7, 4, 5, 1), mapEvent(8, 10, 2, -1), mapEvent(9, 1, 1, 0, true)],
      },
      $gameSystem: { playtime: () => 754 },
      $gameTroop: { _troopId: 0, members: () => [] },
      $gameMessage: message,
      $dataSystem: { switches: ['', 'Door open'], variables: [''] },
      $dataActors: [null, { id: 1, name: 'Hero 1' }, { id: 2, name: 'Hero 2' }],
    })
  }

  // SAFETY: the function body only evaluates its source argument, which yields the JSON string the
  // runtime's install returns, as DevTools does in a game.
  const evaluate = new Function('window', 'source', 'return eval(source)') as (
    page: Record<string, unknown>,
    code: string,
  ) => string

  const install = () => JSON.parse(evaluate(window, source))

  const call = (name: string, ...args: ReadonlyArray<RuntimeArgument>) => {
    // SAFETY: install, run before every call, defines window.__wenbuLive with this shape.
    const live = window['__wenbuLive'] as {
      call: (name: string, args: ReadonlyArray<RuntimeArgument>) => string
    }

    return JSON.parse(live.call(name, args))
  }

  // SAFETY: SceneManager is the object above, its updateScene hooked by install.
  const frame = () => (window['SceneManager'] as { updateScene: () => void }).updateScene()

  return {
    window,
    reads,
    actors,
    drawn,
    texts,
    ImageManager,
    loadSave,
    install,
    call,
    frame,
    Game_Action,
    Game_Enemy,
    Window_Message,
    Window_ChoiceList,
    Window_Gold,
    Window_Menu,
    Game_Message,
    Game_Player,
    Game_Follower,
    Game_CharacterBase,
    message,
  }
}

describe('MV and MZ runtime', () => {
  it('installs every hook and waits for a save before touching the party', () => {
    const game = makeGame()
    const installed = game.install()

    expect(installed.value.unsupported).toEqual({})
    expect(installed.value.snapshot).toMatchObject({ ready: false, hpMode: 'none', speed: 1 })

    expect(game.call('setGold', 10)).toEqual({
      ok: false,
      error: 'not-ready: Start a new game or load a save first.',
    })
  })

  it('keeps the protagonist alive in God Mode and lets the party finish enemies in one hit', () => {
    const game = makeGame()

    game.install()
    game.loadSave()
    game.call('setHpMode', 'god')

    const [hero, friend] = game.actors

    hero?.setHp(0)
    friend?.setHp(5)
    hero?.addState(1)
    game.frame()

    const enemy = new game.Game_Enemy()

    enemy.hp = 300

    expect([hero?.hp, hero?.isDead(), friend?.hp]).toEqual([100, false, 5])
    expect(new game.Game_Action(hero!).makeDamageValue(enemy)).toBe(300)
  })

  it('sets the protagonist to 1 HP in Killable Mode', () => {
    const game = makeGame()

    game.install()
    game.loadSave()
    game.call('setHpMode', 'killable')

    expect(game.actors[0]?.hp).toBe(1)
  })

  it('applies the dialogue font size to choices, with rows tall enough for it', () => {
    const game = makeGame()

    game.install()
    game.call('setFontSize', 36)

    const choices = new game.Window_ChoiceList()
    const gold = new game.Window_Gold()

    choices.createContents()
    choices.contents.drawText()

    expect([game.drawn, choices.lineHeight(), gold.lineHeight()]).toEqual([[36], 44, 36])

    game.call('setFontSize', 20)

    expect(choices.lineHeight()).toBe(36)
  })

  it('applies the dialogue font size to message windows only', () => {
    const game = makeGame()

    game.install()
    game.call('setFontSize', 36)

    const message = new game.Window_Message()
    const gold = new game.Window_Gold()

    message.createContents()
    gold.createContents()
    message.resetFontSettings()
    message.contents.drawText()
    gold.contents.drawText()
    game.call('setFontSize', null)
    message.contents.fontSize = 28
    message.contents.drawText()

    expect(game.drawn).toEqual([36, 28, 28])
  })

  it('speeds up the protagonist only, once, even when installed twice', () => {
    const game = makeGame()

    game.install()
    game.install()
    game.loadSave()
    game.call('setSpeed', 2)

    // SAFETY: loadSave puts a Game_Player in $gamePlayer.
    const player = game.window['$gamePlayer'] as InstanceType<typeof game.Game_Player>
    const npc = new game.Game_CharacterBase()
    const follower = new game.Game_Follower()

    expect([
      player.distancePerFrame(),
      npc.distancePerFrame(),
      follower.distancePerFrame(),
    ]).toEqual([0.5, 0.25, 0.25])

    expect(game.call('setSpeed', 1.25)).toEqual({
      ok: false,
      error: 'invalid: Unsupported character speed.',
    })
  })

  describe('Dialogue Word Wrap', () => {
    const wrapping = (options: { readonly reflow?: boolean } = {}) => {
      const game = makeGame()

      game.install()
      game.call('setTextOptions', false, true, options.reflow ?? false, 'backquote')

      return game
    }

    it('leaves dialogue alone until it is turned on', () => {
      const game = makeGame()

      game.install()

      expect(new game.Window_Message().show('The quick brown fox jumps')).toEqual([
        'The quick brown fox jumps',
      ])
    })

    it('breaks between words at the window width, after the face', () => {
      const game = wrapping()

      expect(new game.Window_Message().show('The quick brown fox jumps')).toEqual([
        'The quick',
        'brown fox',
        'jumps',
      ])

      expect(new game.Window_Message().show('One two three four', 40)).toEqual([
        'One',
        'two',
        'three',
        'four',
      ])
    })

    it('keeps the line breaks the text already has', () => {
      const game = wrapping()

      expect(new game.Window_Message().show('Hi.\nThe quick brown fox')).toEqual([
        'Hi.',
        'The quick',
        'brown fox',
      ])
    })

    it('continues on a new page when the window runs out of lines', () => {
      const game = wrapping()
      const message = new game.Window_Message()

      message.lines = 2
      message.show('The quick brown fox jumps over')

      expect(message.pauses).toBe(1)
    })

    it('splits words longer than a line and text without spaces', () => {
      const game = wrapping()

      expect(new game.Window_Message().show('Supercalifragilistic')).toEqual([
        'Supercalif',
        'ragilistic',
      ])

      expect(new game.Window_Message().show('あいうえおかきくけこさしす')).toEqual([
        'あいうえおかきくけこ',
        'さしす',
      ])
    })

    it('never starts a line with closing punctuation or ends one with an opening bracket', () => {
      const game = wrapping()

      expect(new game.Window_Message().show('あいうえおかきくけこ、さ')).toEqual([
        'あいうえおかきくけ',
        'こ、さ',
      ])

      expect(new game.Window_Message().show('あいうえおかきくけ「こ」')).toEqual([
        'あいうえおかきくけ',
        '「こ」',
      ])
    })

    it('measures the word after a colour code', () => {
      const game = wrapping()

      expect(new game.Window_Message().show('The quick \x1bC[2]brown')).toEqual([
        'The quick',
        '\x1bC[2]brown',
      ])
    })

    it('reflows the Japanese line breaks into one paragraph, keeping the speaker line', () => {
      const game = wrapping({ reflow: true })
      const message = new game.Game_Message()

      message.texts = ['Rin:', 'I never thought', "I'd see you here.", '', 'Bye.']

      expect(message.allText()).toBe("Rin:\nI never thought I'd see you here.\n\nBye.")

      game.call('setTextOptions', false, true, false, 'backquote')

      expect(message.allText()).toBe("Rin:\nI never thought\nI'd see you here.\n\nBye.")
    })

    it('steps aside for messages and games that wrap on their own', () => {
      const game = wrapping({ reflow: true })

      expect(new game.Window_Message().show('<WordWrap>The quick brown fox')).toEqual([
        '<WordWrap>The quick brown fox',
      ])

      const own = makeGame()

      own.window['$plugins'] = [
        { name: 'YEP_MessageCore', status: true, parameters: { 'Word Wrapping': 'true' } },
      ]

      expect(own.install().value.unsupported).toEqual({
        wordWrap: 'This game already wraps its own dialogue (YEP_MessageCore).',
      })
    })
  })

  describe('In-Game Text', () => {
    const translating = () => {
      const game = makeGame()

      game.install()
      game.call('setTextOptions', true, false, false, 'backquote')

      return game
    }

    it('reports Japanese menu text once and draws its translation when it arrives', () => {
      const game = translating()
      const menu = new game.Window_Menu()

      expect(menu.show('アイテム')).toMatchObject({ text: 'アイテム' })
      menu.refresh()
      new game.Window_Menu().show('Gold')

      expect(game.call('takeText').value).toEqual([
        { key: 'アイテム', fit: 'missing', width: 200, size: 28, scene: '' },
      ])

      game.call('addTexts', [['アイテム', 'Item']])

      expect([menu.refreshes, game.texts.at(-1)?.text]).toEqual([3, 'Item'])

      expect(game.call('takeText').value).toEqual([
        { key: 'アイテム', fit: 'as-is', width: 200, size: 28, scene: '' },
      ])
    })

    it('keeps numbers out of the key and puts them back', () => {
      const game = translating()

      game.call('addTexts', [['残り {0} 回', '{0} left']])

      expect(new game.Window_Menu().show('残り 5 回')?.text).toBe('5 left')
    })

    it('fits a long translation: smaller, squeezed, on two lines, then cut off', () => {
      const game = translating()

      game.call('addTexts', [['速度', 'Message speed']])

      const fits = [
        new game.Window_Menu().show('速度', 182),
        new game.Window_Menu().show('速度', 140),
        new game.Window_Menu().show('速度', 120),
      ]

      expect(fits.map((fit) => [fit?.text, fit?.size])).toEqual([
        ['Message speed', 28],
        ['Message speed', 21],
        ['Message speed', 21],
      ])

      new game.Window_Menu().show('速度', 90, 72)

      expect(game.texts.slice(-2).map((line) => [line.text, line.y])).toEqual([
        ['Message', 0],
        ['speed', 36],
      ])

      expect(new game.Window_Menu().show('速度', 50)?.text).toBe('Mess…')

      expect(
        game.call('takeText').value.map((report: { readonly fit: string }) => report.fit),
      ).toEqual(['as-is', 'smaller', 'squeezed', 'wrapped', 'too-long'])
    })

    it('leaves dialogue, Latin text and the original key alone', () => {
      const game = translating()
      const message = new game.Window_Message()

      game.call('addTexts', [['アイテム', 'Item']])
      message.createContents()
      message.contents.drawText('はい', 0, 0, 200, 36)
      new game.Window_Menu().show('Gold')
      game.call('showOriginal', true)

      expect(new game.Window_Menu().show('アイテム')?.text).toBe('アイテム')
      expect(game.call('takeText').value).toEqual([])

      game.call('showOriginal', false)

      expect(new game.Window_Menu().show('アイテム')?.text).toBe('Item')
    })

    it('shows the original text while the player holds the original key', () => {
      const game = makeGame()
      const listeners = new Map<string, (event: { code: string; repeat: boolean }) => void>()

      game.window['document'] = {
        addEventListener: (type: string, listener: (event: { code: string }) => void) =>
          listeners.set(type, listener),
      }

      game.install()
      game.call('setTextOptions', true, false, false, 'tab')
      game.call('addTexts', [['アイテム', 'Item']])
      listeners.get('keydown')?.({ code: 'Backquote', repeat: false })

      expect(new game.Window_Menu().show('アイテム')?.text).toBe('Item')

      listeners.get('keydown')?.({ code: 'Tab', repeat: false })

      expect(new game.Window_Menu().show('アイテム')?.text).toBe('アイテム')

      listeners.get('keyup')?.({ code: 'Tab', repeat: false })

      expect(new game.Window_Menu().show('アイテム')?.text).toBe('Item')
    })

    it('draws the game text as it is while translation is off', () => {
      const game = makeGame()

      game.install()
      game.call('addTexts', [['アイテム', 'Item']])

      expect(new game.Window_Menu().show('アイテム')?.text).toBe('アイテム')
      expect(game.call('takeText').value).toEqual([])
    })
  })

  describe('Image Text', () => {
    const title = [['pictures/title', 'C:/data/title.1.png']]

    const drawn = (file: string) => ['clear', `draw png:${file}`, 'dirty']

    it('draws the Translated Picture over a picture as it loads', () => {
      const game = makeGame()

      game.install()
      game.call('setPictures', title)

      const picture = game.ImageManager.loadBitmap('img/pictures/', 'Title')

      expect(picture.painted).toEqual(drawn('C:/data/title.1.png'))
    })

    it('draws pictures that loaded before the list arrived, once', () => {
      const game = makeGame()

      game.install()

      const picture = game.ImageManager.loadBitmap('img/pictures/', 'Title')

      game.call('setPictures', title)
      game.call('setPictures', title)

      expect(picture.painted).toEqual([
        ...drawn('C:/data/title.1.png'),
        'clear',
        'blt copy 0,0,32,16 -> 0,0',
        ...drawn('C:/data/title.1.png'),
      ])
    })

    it('waits for a picture that is still loading', () => {
      const game = makeGame()

      game.install()

      const picture = game.ImageManager.loadBitmap('img/pictures/', 'Other')

      picture.ready = false
      game.call('setPictures', [['pictures/other', 'C:/data/other.1.png']])

      expect(picture.painted).toEqual([])

      picture.load()

      expect(picture.painted).toEqual(drawn('C:/data/other.1.png'))
    })

    it('reads a picture again after it stopped being drawn, rather than keeping it', () => {
      const game = makeGame()

      game.install()
      game.ImageManager.loadBitmap('img/pictures/', 'Title')
      game.call('setPictures', title)
      game.call('setPictures', [['pictures/title', 'C:/data/title.2.png']])
      game.call('setPictures', title)

      expect(game.reads).toEqual([
        'C:/data/title.1.png',
        'C:/data/title.2.png',
        'C:/data/title.1.png',
      ])
    })

    it('puts the original back while the key is held and when the picture is withdrawn', () => {
      const game = makeGame()

      game.install()
      game.call('setPictures', title)

      const picture = game.ImageManager.loadBitmap('img/pictures/', 'Title')

      game.call('showOriginal', true)
      game.call('showOriginal', false)
      game.call('setPictures', [])

      const restored = ['clear', 'blt copy 0,0,32,16 -> 0,0']

      expect(picture.painted).toEqual([
        ...drawn('C:/data/title.1.png'),
        ...restored,
        ...drawn('C:/data/title.1.png'),
        ...restored,
      ])
    })
  })

  it('reports where the player is and the state Story Progress is judged from', () => {
    const game = makeGame()

    game.install()
    game.loadSave()
    game.message.texts = ['\\N[1]: Bring me a Moonpetal,', 'and I will brew it.']
    game.frame()
    game.frame()
    game.message.texts = []
    game.frame()

    expect(game.call('guideState').value).toEqual({
      mapId: 3,
      mapName: 'Riverside',
      x: 0,
      y: 0,
      inBattle: false,
      troopId: 0,
      enemies: [],
      switches: [1, 3],
      variables: [
        [2, 3],
        [3, 'left'],
      ],
      selfSwitches: [[3, 7, 'A']],
      party: [1, 2],
      items: [
        ['item', 7, 2],
        ['weapon', 3, 1],
      ],
      gold: 50,
      playtime: 754,
      events: [
        [7, 4, 5, 1],
        [8, 10, 2, -1],
      ],
      dialogue: [
        { mapId: 3, speaker: '', text: '\\N[1]: Bring me a Moonpetal,\nand I will brew it.' },
      ],
    })
  })

  it('edits gold, stats and switches', () => {
    const game = makeGame()

    game.install()
    game.loadSave()

    expect(game.call('setGold', 1_000_000).value.gold).toBe(9999)

    const actor = game.call('setStat', 1, 'attack', 55).value

    expect(actor.stats.find((stat: { key: string }) => stat.key === 'attack')).toEqual({
      key: 'attack',
      label: 'Attack',
      value: 55,
    })

    expect(game.call('setSwitch', 1, true).value).toEqual({ id: 1, name: 'Door open', value: true })
  })

  it('unlocks memories and writes them to the shared save', () => {
    const game = makeGame()

    game.install()

    expect(game.call('unlockMemories', [2, 3]).error).toBe(
      'not-ready: Load a save first, so the game keeps what Wenbu unlocks.',
    )

    game.loadSave()
    expect(game.call('unlockMemories', [2, 3]).value).toEqual({ saved: false })
    expect(game.call('switchValues', [1, 2, 3]).value).toEqual([false, true, true])

    const saved: Array<string> = []

    game.window['utakata'] = { CommonSave: { save: () => saved.push('common') } }
    expect(game.call('unlockMemories', [1]).value).toEqual({ saved: true })
    expect(saved).toEqual(['common'])
  })

  it('unlocks on the title screen when a shared save keeps the switches', () => {
    const game = makeGame()
    const switches = new Map<number, boolean>()
    const saved: Array<string> = []

    game.install()

    Object.assign(game.window, {
      $gameSwitches: {
        value: (id: number) => switches.get(id) ?? false,
        setValue: (id: number, value: boolean) => switches.set(id, value),
      },
      $dataSystem: { switches: [''], variables: [''] },
      ConfigManager: { saveCommonVariables: () => saved.push('config') },
    })

    expect(game.call('unlockMemories', [4]).value).toEqual({ saved: true })
    expect(switches.get(4)).toBe(true)
    expect(saved).toEqual(['config'])
  })
})
