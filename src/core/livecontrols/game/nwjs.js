// ES5 only: MV games ship Chromium as old as version 41.
;(function (root) {
  'use strict'

  var SPEEDS = [0.5, 0.75, 1, 1.5, 2, 3]
  var FONT_SIZES = { min: 6, max: 48 }

  var STATS = [
    ['maxHp', 'Max HP', 0],
    ['maxMp', 'Max MP', 1],
    ['attack', 'Attack', 2],
    ['defense', 'Defense', 3],
    ['magicAttack', 'Magic Attack', 4],
    ['magicDefense', 'Magic Defense', 5],
    ['agility', 'Agility', 6],
    ['luck', 'Luck', 7],
  ]

  var WRAP_PLUGINS = ['YEP_MessageCore', 'VisuMZ_1_MessageCore', 'CGMZ_MessageSystem']

  var CLOSERS = '、。，．・：；？！ー…‥」』）】〕〉》｝］〙〗.,!?:;)]}'
  var OPENERS = '「『（【〔〈《｛［〘〖([{'

  var live = root.__wenbuLive || { state: { hpMode: 'none', speed: 1, fontSize: null } }
  var state = live.state

  state.text = state.text || {
    ui: false,
    images: false,
    wrap: false,
    reflow: false,
    imageStyle: 'cover',
    originalKey: 'backquote',
    original: false,
  }

  root.__wenbuLive = live

  function fail(reason, message) {
    throw new Error(reason + ': ' + message)
  }

  function isReady() {
    return Boolean(
      root.$gameParty &&
      root.$gameActors &&
      root.$gameSwitches &&
      root.$gameVariables &&
      root.$dataSystem &&
      root.$dataActors,
    )
  }

  function requireGame() {
    if (!isReady()) {
      fail('not-ready', 'Start a new game or load a save first.')
    }
  }

  function leader() {
    var party = root.$gameParty

    if (!party) {
      return null
    }

    if (party.leader) {
      return party.leader() || null
    }

    return party.members()[0] || null
  }

  function defaultFontSize() {
    if (root.$gameSystem && root.$gameSystem.mainFontSize) {
      return root.$gameSystem.mainFontSize()
    }

    if (root.Window_Base && root.Window_Base.prototype.standardFontSize) {
      return root.Window_Base.prototype.standardFontSize()
    }

    return 28
  }

  function snapshot() {
    var ready = isReady()
    var hero = ready ? leader() : null

    return {
      ready: ready,
      engine: root.Utils && root.Utils.RPGMAKER_NAME === 'MZ' ? 'mz' : 'mv',
      gold: ready ? root.$gameParty.gold() : 0,
      maxGold: ready ? root.$gameParty.maxGold() : 0,
      hpMode: state.hpMode,
      fontSize: state.fontSize,
      defaultFontSize: defaultFontSize(),
      speed: state.speed,
      leader: hero ? hero.name() : null,
    }
  }

  function isLeader(battler) {
    return battler === leader()
  }

  function revive(hero) {
    if (hero.isDead()) {
      hero.removeState(hero.deathStateId())
    }

    if (hero.hp < hero.mhp) {
      hero.setHp(hero.mhp)
    }
  }

  function keepKillable(hero) {
    var id = hero.actorId()
    var alive = !hero.isDead()

    if ((id !== state.leaderId || state.leaderDead) && alive) {
      hero.setHp(1)
    }

    state.leaderId = id
    state.leaderDead = !alive
  }

  function tick() {
    if (!isReady()) {
      return
    }

    try {
      recordDialogue()
    } catch (ignored) {
      // A missing message class costs the guide its dialogue log, never the other controls.
    }

    var hero = leader()

    if (!hero) {
      return
    }

    if (state.hpMode === 'god') {
      revive(hero)
    }

    if (state.hpMode === 'killable') {
      keepKillable(hero)
    }
  }

  function setHpMode(mode) {
    if (mode !== 'none' && mode !== 'god' && mode !== 'killable') {
      fail('invalid', 'Unknown HP mode.')
    }

    state.hpMode = mode
    state.leaderId = undefined
    state.leaderDead = false
    tick()

    return snapshot()
  }

  function setGold(value) {
    requireGame()

    var party = root.$gameParty
    var target = Math.max(0, Math.min(party.maxGold(), Math.trunc(Number(value))))

    party.gainGold(target - party.gold())

    return snapshot()
  }

  function windowNamed(window, klass, part) {
    var name = window.constructor && window.constructor.name

    return (
      (root[klass] && window instanceof root[klass]) ||
      (typeof name === 'string' && name.indexOf(part) >= 0)
    )
  }

  function isChoice(window) {
    return windowNamed(window, 'Window_ChoiceList', 'Choice')
  }

  function isDialogue(window) {
    return windowNamed(window, 'Window_Message', 'Message') || isChoice(window)
  }

  // Choice rows have a fixed height, so a larger font needs taller rows to stay readable.
  function extraLineHeight() {
    return state.fontSize === null ? 0 : Math.max(0, state.fontSize - defaultFontSize())
  }

  function markDialogue(window) {
    if (window && window.contents && isDialogue(window)) {
      window.contents._wenbuDialogue = true
    }
  }

  // Applied before every draw: message plugins reset the size per message or per character.
  function dialogueFont(bitmap) {
    if (state.fontSize !== null && bitmap && bitmap._wenbuDialogue) {
      bitmap.fontSize = state.fontSize
    }
  }

  function markOpenDialogue() {
    var scene = root.SceneManager && root.SceneManager._scene

    if (!scene) {
      return
    }

    Object.keys(scene).forEach(function (key) {
      var value = scene[key]

      if (value && root.Window_Base && value instanceof root.Window_Base) {
        markDialogue(value)
      }
    })
  }

  function setFontSize(size) {
    state.fontSize =
      size === null
        ? null
        : Math.max(FONT_SIZES.min, Math.min(FONT_SIZES.max, Math.round(Number(size))))

    markOpenDialogue()

    return snapshot()
  }

  function setSpeed(multiplier) {
    var value = Number(multiplier)

    if (SPEEDS.indexOf(value) < 0) {
      fail('invalid', 'Unsupported character speed.')
    }

    state.speed = value

    return snapshot()
  }

  function isCjk(c) {
    var code = c ? c.charCodeAt(0) : 0

    return (code >= 0x3000 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef)
  }

  function isSpace(c) {
    return c === ' ' || c === '\t' || c === '　'
  }

  function isControl(c) {
    return !c || c.charCodeAt(0) < 0x20
  }

  var ESCAPE_BODY = /^(?:[A-Za-z]+(?:\[[^\]]*\])?(?:<[^>]*>)?|.)/

  function skipEscapes(text, index) {
    var at = index

    for (;;) {
      var code = text[at] === '\x1b' ? ESCAPE_BODY.exec(text.slice(at + 1, at + 64)) : null

      if (!code) {
        return at
      }

      at += 1 + code[0].length
    }
  }

  function startsWord(text, index) {
    var c = text[index]
    var before = text[index - 1]

    if (index === 0 || OPENERS.indexOf(before) >= 0) {
      return false
    }

    return isCjk(c) || OPENERS.indexOf(c) >= 0 || isSpace(before) || isCjk(before)
  }

  function wordAt(text, index) {
    var end = index + 1

    if (OPENERS.indexOf(text[index]) >= 0 && !isControl(text[end])) {
      end++
    }

    if (!isCjk(text[index]) && OPENERS.indexOf(text[index]) < 0) {
      while (
        end < text.length &&
        !isSpace(text[end]) &&
        !isControl(text[end]) &&
        !isCjk(text[end])
      ) {
        end++
      }
    }

    while (end < text.length && CLOSERS.indexOf(text[end]) >= 0) {
      end++
    }

    return text.slice(index, end)
  }

  function ownWordWrap() {
    var plugins = root.$plugins || []

    for (var i = 0; i < plugins.length; i++) {
      var plugin = plugins[i]
      var parameters = (plugin && plugin.parameters) || {}

      if (plugin && plugin.status && WRAP_PLUGINS.indexOf(plugin.name) >= 0) {
        for (var key in parameters) {
          if (/word ?wrap/i.test(key) && String(parameters[key]) === 'true') {
            return plugin.name
          }
        }
      }
    }

    return null
  }

  // MV keeps the drawn line in textState.x; MZ also holds characters it has not drawn yet.
  function lineX(window, textState) {
    return textState.x + (textState.buffer ? window.textWidth(textState.buffer) : 0)
  }

  function lineStart(textState) {
    return textState.startX !== undefined ? textState.startX : textState.left || 0
  }

  // Breaks with the game's own line break, so its new line and new page rules still apply.
  function wrapBefore(window, textState) {
    var text = textState.text
    var index = textState.index
    var c = text[index]

    if (!state.text.wrap || live.ownWrap || (c !== '\x1b' && (isControl(c) || isSpace(c)))) {
      return
    }

    if (textState.wenbuOwnWrap === undefined) {
      textState.wenbuOwnWrap = text.indexOf('<WordWrap>') >= 0
    }

    if (textState.wenbuOwnWrap) {
      return
    }

    var x = lineX(window, textState)
    var limit = window.contentsWidth()

    if (x <= lineStart(textState) + 1) {
      return
    }

    var width

    if (startsWord(text, index)) {
      width = window.textWidth(wordAt(text, c === '\x1b' ? skipEscapes(text, index) : index))
    } else if (c !== '\x1b' && CLOSERS.indexOf(c) < 0) {
      width = window.textWidth(c)
    } else {
      return
    }

    if (x + width > limit) {
      textState.text = text.slice(0, index) + '\n' + text.slice(index)
    }
  }

  function isSpeaker(line) {
    return /[:：】]\s*$/.test(line) || /^\s*[【[][^】\]]*[】\]]\s*$/.test(line)
  }

  function reflow(text) {
    if (!state.text.wrap || !state.text.reflow || live.ownWrap || text.indexOf('<WordWrap>') >= 0) {
      return text
    }

    var lines = text.split('\n')
    var out = lines[0]

    for (var i = 1; i < lines.length; i++) {
      var line = lines[i]
      var before = lines[i - 1]

      if (line.trim() === '' || before.trim() === '' || (i === 1 && isSpeaker(before))) {
        out += '\n' + line
      } else {
        var tight = isCjk(before[before.length - 1]) && isCjk(line.replace(/^\s+/, '')[0])

        out += (tight ? '' : ' ') + line.replace(/^\s+/, '')
      }
    }

    return out
  }

  var JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/
  var MAX_QUEUED = 200

  live.dict = live.dict || {}
  live.queue = live.queue || []
  live.queued = live.queued || {}
  live.fits = live.fits || {}
  live.pending = live.pending || []

  function sceneClass() {
    var scene = root.SceneManager && root.SceneManager._scene

    return scene && scene.constructor && scene.constructor.name ? scene.constructor.name : ''
  }

  function enqueue(report) {
    if (live.queue.length < MAX_QUEUED) {
      live.queue.push(report)
    }
  }

  function keyOf(text) {
    var numbers = []

    var key = text.replace(/\d+/g, function (digits) {
      numbers.push(digits)

      return '{' + (numbers.length - 1) + '}'
    })

    return { key: key, numbers: numbers }
  }

  function fillNumbers(text, numbers) {
    return text.replace(/\{(\d+)\}/g, function (placeholder, index) {
      return numbers[index] !== undefined ? numbers[index] : placeholder
    })
  }

  function allowedWidth(maxWidth) {
    return typeof maxWidth === 'number' && maxWidth > 0 && maxWidth < 100000 ? maxWidth : 0
  }

  function missed(bitmap, key, maxWidth) {
    if (!live.queued[key]) {
      live.queued[key] = true

      enqueue({
        key: key,
        fit: 'missing',
        width: allowedWidth(maxWidth),
        size: bitmap.fontSize,
        scene: sceneClass(),
      })
    }

    var window = bitmap._wenbuWindow

    if (window && !window._wenbuPending) {
      window._wenbuPending = true
      live.pending.push(window)
    }
  }

  function reportFit(key, fit, maxWidth, size) {
    if (live.fits[key] !== fit) {
      live.fits[key] = fit

      enqueue({
        key: key,
        fit: fit,
        width: allowedWidth(maxWidth),
        size: size,
        scene: sceneClass(),
      })
    }
  }

  function twoLines(text) {
    var middle = Math.floor(text.length / 2)
    var best = -1

    for (var i = 0; i < text.length; i++) {
      if (text[i] === ' ' && (best < 0 || Math.abs(i - middle) < Math.abs(best - middle))) {
        best = i
      }
    }

    if (best < 0) {
      return [text.slice(0, middle), text.slice(middle)]
    }

    return [text.slice(0, best), text.slice(best + 1)]
  }

  function cutToFit(bitmap, text, limit) {
    var cut = text

    while (cut.length > 1 && bitmap.measureTextWidth(cut.replace(/\s+$/, '') + '…') > limit) {
      cut = cut.slice(0, -1)
    }

    return cut.replace(/\s+$/, '') + '…'
  }

  var SQUEEZE = 0.8

  function drawFitted(bitmap, original, text, args, key) {
    var size = bitmap.fontSize
    var x = args[1]
    var y = args[2]
    var maxWidth = args[3]
    var lineHeight = args[4]
    var align = args[5]
    var limit = allowedWidth(maxWidth) || Infinity
    var fit = 'as-is'
    var lines = [text]

    if (bitmap.measureTextWidth(text) > limit) {
      var min = Math.ceil(size * 0.75)

      while (bitmap.fontSize > min && bitmap.measureTextWidth(text) > limit) {
        bitmap.fontSize--
      }

      var width = bitmap.measureTextWidth(text)
      var split = twoLines(text)

      var splitFits =
        lineHeight >= bitmap.fontSize * 2.2 &&
        bitmap.measureTextWidth(split[0]) * SQUEEZE <= limit &&
        bitmap.measureTextWidth(split[1]) * SQUEEZE <= limit

      if (width <= limit) {
        fit = 'smaller'
      } else if (width * SQUEEZE <= limit) {
        fit = 'squeezed'
      } else if (splitFits) {
        fit = 'wrapped'
        lines = split
      } else {
        fit = 'too-long'
        lines = [cutToFit(bitmap, text, limit / SQUEEZE)]
      }
    }

    try {
      if (lines.length === 2) {
        original.call(bitmap, lines[0], x, y, maxWidth, lineHeight / 2, align)
        original.call(bitmap, lines[1], x, y + lineHeight / 2, maxWidth, lineHeight / 2, align)
      } else {
        original.call(bitmap, lines[0], x, y, maxWidth, lineHeight, align)
      }
    } finally {
      bitmap.fontSize = size
    }

    if (key !== undefined) {
      reportFit(key, fit, maxWidth, size)
    }
  }

  function drawTranslated(bitmap, original, args) {
    var text = args[0]

    if (
      !state.text.ui ||
      bitmap._wenbuDialogue ||
      typeof text !== 'string' ||
      !JAPANESE.test(text)
    ) {
      return false
    }

    if (state.text.original) {
      return false
    }

    var parts = keyOf(text)
    var translated = live.dict[parts.key]

    if (translated === undefined) {
      missed(bitmap, parts.key, args[3])

      return false
    }

    drawFitted(bitmap, original, fillNumbers(translated, parts.numbers), args, parts.key)

    return true
  }

  function refreshWindow(window) {
    if (
      window &&
      window.contents &&
      typeof window.refresh === 'function' &&
      window.refresh.length === 0
    ) {
      try {
        window.refresh()
      } catch (ignored) {
        // The window shows the translation on its next own redraw instead.
      }
    }
  }

  function sceneWindows() {
    var scene = root.SceneManager && root.SceneManager._scene
    var found = []

    if (!scene || !root.Window_Base) {
      return found
    }

    var layer = scene._windowLayer

    ;((layer && layer.children) || []).forEach(function (child) {
      if (child instanceof root.Window_Base) {
        found.push(child)
      }
    })

    Object.keys(scene).forEach(function (key) {
      var value = scene[key]

      if (value instanceof root.Window_Base && found.indexOf(value) < 0) {
        found.push(value)
      }
    })

    return found
  }

  function takeText() {
    var reports = live.queue

    live.queue = []

    return reports
  }

  function addTexts(pairs) {
    ;(pairs || []).forEach(function (pair) {
      if (pair && typeof pair[0] === 'string' && typeof pair[1] === 'string') {
        live.dict[pair[0]] = pair[1]
      }
    })

    var waiting = live.pending

    live.pending = []

    waiting.forEach(function (window) {
      window._wenbuPending = false
      refreshWindow(window)
    })

    return Object.keys(live.dict).length
  }

  function showOriginal(on) {
    if (state.text.original === Boolean(on)) {
      return null
    }

    state.text.original = Boolean(on)

    sceneWindows().forEach(function (window) {
      refreshWindow(window)
    })

    if (live.imagesChanged) {
      live.imagesChanged()
    }

    return null
  }

  live.images = live.images || {}
  live.loaded = live.loaded || {}
  live.painted = live.painted || []

  function imageKey(folder, filename) {
    var name = String(folder || '')
      .replace(/^(www\/)?img\//i, '')
      .replace(/\/+$/, '')

    return (name + '/' + String(filename || '')).replace(/\.(png|rpgmvp|png_)$/i, '').toLowerCase()
  }

  function whenLoaded(bitmap, run) {
    if (!bitmap.isReady || bitmap.isReady()) {
      run()
    } else if (bitmap.addLoadListener) {
      bitmap.addLoadListener(run)
    }
  }

  function parseHex(color) {
    var hex = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(String(color || ''))

    return hex ? [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)] : [0, 0, 0]
  }

  function toHex(rgb) {
    return (
      '#' +
      rgb
        .map(function (channel) {
          var value = Math.max(0, Math.min(255, Math.round(channel)))

          return (value < 16 ? '0' : '') + value.toString(16)
        })
        .join('')
    )
  }

  function backgroundOf(bitmap, x, y, w, h) {
    var width = bitmap.width || x + w + 1
    var height = bitmap.height || y + h + 1

    var points = [
      [x - 1, y - 1],
      [x + w, y - 1],
      [x - 1, y + h],
      [x + w, y + h],
      [x + w / 2, y - 1],
      [x + w / 2, y + h],
      [x - 1, y + h / 2],
      [x + w, y + h / 2],
    ]

    var sum = [0, 0, 0]

    points.forEach(function (point) {
      var px = Math.max(0, Math.min(width - 1, Math.floor(point[0])))
      var py = Math.max(0, Math.min(height - 1, Math.floor(point[1])))
      var rgb = parseHex(bitmap.getPixel(px, py))

      sum[0] += rgb[0]
      sum[1] += rgb[1]
      sum[2] += rgb[2]
    })

    return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length]
  }

  function paint(bitmap, key) {
    var boxes = live.images[key]
    var signature = JSON.stringify(boxes)

    if (!boxes || bitmap._wenbuPainted === signature) {
      return
    }

    restoreImage(bitmap)

    var saved = []
    var fontSize = bitmap.fontSize
    var textColor = bitmap.textColor
    var outlineWidth = bitmap.outlineWidth

    boxes.forEach(function (box) {
      var x = box[0]
      var y = box[1]
      var w = box[2]
      var h = box[3]
      var copy = new root.Bitmap(w, h)

      copy.blt(bitmap, x, y, w, h, 0, 0)
      saved.push(copy)

      var background = backgroundOf(bitmap, x, y, w, h)
      var label = state.text.imageStyle === 'label'

      var fill = label
        ? background.map(function (channel) {
            return channel * 0.2
          })
        : background

      var light = (0.299 * fill[0] + 0.587 * fill[1] + 0.114 * fill[2]) / 255 > 0.55

      bitmap.fillRect(x, y, w, h, toHex(fill))
      bitmap.fontSize = Math.max(10, Math.floor(h * 0.8))
      bitmap.textColor = light ? '#000000' : '#ffffff'
      bitmap.outlineWidth = 0
      drawFitted(bitmap, root.Bitmap.prototype.drawText, box[4], [box[4], x, y, w, h, 'center'])
    })

    bitmap.fontSize = fontSize
    bitmap.textColor = textColor
    bitmap.outlineWidth = outlineWidth
    bitmap._wenbuPainted = signature
    bitmap._wenbuSaved = { boxes: boxes, copies: saved }
    live.painted.push(bitmap)
  }

  function restoreImage(bitmap) {
    var saved = bitmap._wenbuSaved

    if (!saved) {
      return
    }

    saved.boxes.forEach(function (box, index) {
      bitmap.clearRect(box[0], box[1], box[2], box[3])
      bitmap.blt(saved.copies[index], 0, 0, box[2], box[3], box[0], box[1])
    })

    bitmap._wenbuSaved = null
    bitmap._wenbuPainted = null

    live.painted = live.painted.filter(function (other) {
      return other !== bitmap
    })
  }

  function showImages() {
    return state.text.images && !state.text.original
  }

  function loadedImage(bitmap, folder, filename) {
    if (!bitmap || !filename) {
      return
    }

    var key = imageKey(folder, filename)

    live.loaded[key] = bitmap

    if (showImages() && live.images[key]) {
      whenLoaded(bitmap, function () {
        paint(bitmap, key)
      })
    }
  }

  // Pictures the game loaded before Wenbu hooked loading are still in ImageManager's cache.
  function collectCached() {
    var manager = root.ImageManager

    if (!manager) {
      return
    }

    var mz = manager._cache || {}
    var mv = (manager._imageCache && manager._imageCache._items) || {}

    Object.keys(mz).forEach(function (url) {
      remember(url, mz[url])
    })

    Object.keys(mv).forEach(function (url) {
      remember(url.replace(/:\d+$/, ''), mv[url] && mv[url].bitmap)
    })
  }

  function remember(url, bitmap) {
    var parts = /^(.*\/)([^/]+)$/.exec(String(url))

    if (parts && bitmap && !live.loaded[imageKey(parts[1], parts[2])]) {
      live.loaded[imageKey(parts[1], parts[2])] = bitmap
    }
  }

  function repaintImages() {
    live.painted.slice().forEach(function (bitmap) {
      restoreImage(bitmap)
    })

    if (!showImages()) {
      return
    }

    collectCached()

    Object.keys(live.loaded).forEach(function (key) {
      var bitmap = live.loaded[key]

      if (live.images[key]) {
        whenLoaded(bitmap, function () {
          paint(bitmap, key)
        })
      }
    })
  }

  live.imagesChanged = repaintImages

  function addImages(images) {
    ;(images || []).forEach(function (image) {
      if (image && typeof image[0] === 'string' && image[1]) {
        live.images[image[0].toLowerCase()] = image[1]
      }
    })

    if (showImages()) {
      collectCached()

      Object.keys(live.loaded).forEach(function (key) {
        var bitmap = live.loaded[key]

        if (live.images[key]) {
          whenLoaded(bitmap, function () {
            paint(bitmap, key)
          })
        }
      })
    }

    return Object.keys(live.images).length
  }

  function hookImages() {
    return hook('ImageManager', function (manager) {
      wrap(manager, 'loadBitmap', function (original) {
        return function (folder, filename) {
          var bitmap = original.apply(this, arguments)

          try {
            loadedImage(bitmap, folder, filename)
          } catch (ignored) {
            // A picture that cannot be painted keeps its own text.
          }

          return bitmap
        }
      })
    })
  }

  var ORIGINAL_KEYS = { backquote: ['Backquote'], tab: ['Tab'], alt: ['AltLeft', 'AltRight'] }

  function hookOriginalKey() {
    var page = root.document

    if (!page || !page.addEventListener || live.keysHooked) {
      return
    }

    live.keysHooked = true

    var matches = function (event) {
      var codes = ORIGINAL_KEYS[state.text.originalKey] || ORIGINAL_KEYS.backquote

      return codes.indexOf(event.code) >= 0
    }

    page.addEventListener('keydown', function (event) {
      if ((state.text.ui || state.text.images) && matches(event) && !event.repeat) {
        showOriginal(true)
      }
    })

    page.addEventListener('keyup', function (event) {
      if (matches(event)) {
        showOriginal(false)
      }
    })
  }

  function setTextOptions(ui, images, wrap, reflowLines, imageStyle, originalKey) {
    var uiChanged = state.text.ui !== Boolean(ui)

    var imagesChanged =
      state.text.images !== Boolean(images) || state.text.imageStyle !== imageStyle

    state.text.ui = Boolean(ui)
    state.text.images = Boolean(images)
    state.text.wrap = Boolean(wrap)
    state.text.reflow = Boolean(reflowLines)
    state.text.imageStyle = imageStyle === 'label' ? 'label' : 'cover'
    state.text.originalKey = String(originalKey || 'backquote')

    if (uiChanged) {
      live.queued = {}
      live.fits = {}

      sceneWindows().forEach(function (window) {
        refreshWindow(window)
      })
    }

    if (imagesChanged && live.imagesChanged) {
      live.imagesChanged()
    }

    return null
  }

  function actors() {
    requireGame()

    return root.$dataActors
      .filter(function (data) {
        return data && data.name
      })
      .map(function (data) {
        return { id: data.id, name: data.name, nickname: data.nickname || '' }
      })
  }

  function gameActor(id) {
    if (!root.$dataActors[id]) {
      fail('invalid', 'That actor does not exist.')
    }

    return root.$gameActors.actor(id)
  }

  function stat(key, label, value) {
    return { key: key, label: label, value: value }
  }

  function actor(id) {
    requireGame()

    var hero = gameActor(id)
    var stats = [stat('hp', 'HP', hero.hp), stat('mp', 'MP', hero.mp)]

    STATS.forEach(function (row) {
      stats.push(stat(row[0], row[1], hero.param(row[2])))
    })

    stats.push(stat('level', 'Level', hero.level))
    stats.push(stat('experience', 'Experience', hero.currentExp()))

    return { id: id, name: hero.name(), nickname: hero.nickname() || '', stats: stats }
  }

  function findStat(key) {
    var found = null

    STATS.forEach(function (row) {
      if (row[0] === key) {
        found = row
      }
    })

    return found
  }

  function setStat(id, key, value) {
    requireGame()

    var hero = gameActor(id)
    var amount = Math.max(0, Math.trunc(Number(value)))
    var row = findStat(key)

    if (key === 'hp') {
      hero.setHp(amount)
    } else if (key === 'mp') {
      hero.setMp(amount)
    } else if (key === 'level') {
      hero.changeLevel(Math.max(1, Math.min(hero.maxLevel(), amount)), false)
    } else if (key === 'experience') {
      hero.changeExp(amount, false)
    } else if (row) {
      hero.addParam(row[2], amount - hero.param(row[2]))
    } else {
      fail('invalid', 'This game has no such stat.')
    }

    return actor(id)
  }

  function database(kind) {
    if (kind === 'weapon') {
      return root.$dataWeapons
    }

    if (kind === 'armor') {
      return root.$dataArmors
    }

    return root.$dataItems
  }

  function inventoryEntry(kind, item) {
    return {
      kind: kind,
      id: item.id,
      name: item.name,
      description: item.description || '',
      quantity: root.$gameParty.numItems(item),
    }
  }

  function inventory() {
    requireGame()

    var result = []

    ;['item', 'weapon', 'armor'].forEach(function (kind) {
      ;(database(kind) || []).forEach(function (item) {
        if (item && item.name) {
          result.push(inventoryEntry(kind, item))
        }
      })
    })

    return result
  }

  function setQuantity(kind, id, amount) {
    requireGame()

    var item = (database(kind) || [])[id]

    if (!item) {
      fail('invalid', 'That item does not exist.')
    }

    var party = root.$gameParty
    var target = Math.max(0, Math.min(party.maxItems(item), Math.trunc(Number(amount))))

    party.gainItem(item, target - party.numItems(item), false)

    return inventoryEntry(kind, item)
  }

  function switchEntry(id) {
    return {
      id: id,
      name: root.$dataSystem.switches[id] || '',
      value: root.$gameSwitches.value(id) === true,
    }
  }

  function switches() {
    requireGame()

    var result = []

    for (var id = 1; id < root.$dataSystem.switches.length; id++) {
      result.push(switchEntry(id))
    }

    return result
  }

  function setSwitch(id, value) {
    requireGame()
    root.$gameSwitches.setValue(id, value === true)

    return switchEntry(id)
  }

  function variableValue(value) {
    var kind = typeof value

    if (kind === 'number' || kind === 'string' || kind === 'boolean') {
      return value
    }

    if (value === null || value === undefined) {
      return 0
    }

    return JSON.stringify(value)
  }

  function variableEntry(id) {
    return {
      id: id,
      name: root.$dataSystem.variables[id] || '',
      value: variableValue(root.$gameVariables.value(id)),
    }
  }

  function variables() {
    requireGame()

    var result = []

    for (var id = 1; id < root.$dataSystem.variables.length; id++) {
      result.push(variableEntry(id))
    }

    return result
  }

  function setVariable(id, value) {
    requireGame()
    root.$gameVariables.setValue(id, value)

    return variableEntry(id)
  }

  function memorySaver() {
    var utakata = root.utakata || {}

    var savers = [
      [utakata.CommonSave, 'save'],
      [utakata.CommonSaveManager, 'save'],
      [root.ConfigManager, 'saveCommonVariables'],
      [root.DataManager, 'saveSharedInfo'],
      [root.DataManager, 'saveGlobalInfo'],
      [root.PersistManager, 'save'],
    ]

    for (var i = 0; i < savers.length; i++) {
      var owner = savers[i][0]
      var method = savers[i][1]

      if (owner && typeof owner[method] === 'function') {
        return owner[method].bind(owner)
      }
    }

    return null
  }

  function sharedSwitches() {
    return null
  }

  function switchValues(ids) {
    if (!root.$gameSwitches) {
      fail('not-ready', 'Load a save first.')
    }

    return ids.map(function (id) {
      return root.$gameSwitches.value(id) === true
    })
  }

  function unlockMemories(ids) {
    var save = memorySaver()

    if (!root.$gameSwitches || (!isReady() && !save)) {
      fail('not-ready', 'Load a save first, so the game keeps what Wenbu unlocks.')
    }

    ids.forEach(function (id) {
      root.$gameSwitches.setValue(id, true)
    })

    if (save) {
      save()
    }

    return { saved: save !== null }
  }

  var DIALOGUE_KEPT = 40

  state.dialogue = state.dialogue || []

  function mapId() {
    return root.$gameMap && root.$gameMap.mapId ? root.$gameMap.mapId() : 0
  }

  // Polled each frame rather than hooked, so plugins that rewrite the message classes still count.
  function recordDialogue() {
    var message = root.$gameMessage
    var lines = message && (message._texts || message.texts)
    var text = lines && lines.length > 0 ? lines.join('\n') : ''

    if (text === '' || text === state.lastDialogue) {
      state.lastDialogue = text

      return
    }

    state.lastDialogue = text

    var speaker = typeof message.speakerName === 'function' ? message.speakerName() : ''

    state.dialogue.push({ mapId: mapId(), speaker: speaker || '', text: text })

    if (state.dialogue.length > DIALOGUE_KEPT) {
      state.dialogue.splice(0, state.dialogue.length - DIALOGUE_KEPT)
    }
  }

  function idsOn(data) {
    var ids = []

    for (var id = 1; id < (data || []).length; id++) {
      if (data[id] === true) {
        ids.push(id)
      }
    }

    return ids
  }

  function setValues(data) {
    var values = []

    for (var id = 1; id < (data || []).length; id++) {
      var value = data[id]

      if (value !== 0 && value !== undefined && value !== null && value !== '') {
        values.push([id, typeof value === 'object' ? String(value) : value])
      }
    }

    return values
  }

  function selfSwitchesOn() {
    var data = (root.$gameSelfSwitches && root.$gameSelfSwitches._data) || {}

    return Object.keys(data)
      .filter(function (key) {
        return data[key] === true
      })
      .map(function (key) {
        var parts = key.split(',')

        return [Number(parts[0]), Number(parts[1]), parts[2]]
      })
  }

  function heldItems() {
    var party = root.$gameParty

    var held = []

    ;[
      ['item', party._items],
      ['weapon', party._weapons],
      ['armor', party._armors],
    ].forEach(function (group) {
      Object.keys(group[1] || {}).forEach(function (id) {
        if (group[1][id] > 0) {
          held.push([group[0], Number(id), group[1][id]])
        }
      })
    })

    return held
  }

  function mapEvents() {
    var events = root.$gameMap && root.$gameMap.events ? root.$gameMap.events() : []

    return events
      .filter(function (event) {
        return event && !event._erased
      })
      .map(function (event) {
        return [event.eventId(), event.x, event.y, event._pageIndex]
      })
  }

  function battleEnemies() {
    var troop = root.$gameTroop

    return troop && troop.members
      ? troop.members().map(function (enemy) {
          return [enemy.enemyId(), enemy.hp, enemy.mhp]
        })
      : []
  }

  function guideState() {
    requireGame()

    var party = root.$gameParty
    var player = root.$gamePlayer || {}
    var inBattle = Boolean(party.inBattle && party.inBattle())

    return {
      mapId: mapId(),
      mapName: root.$gameMap && root.$gameMap.displayName ? root.$gameMap.displayName() : '',
      x: player.x || 0,
      y: player.y || 0,
      inBattle: inBattle,
      troopId: inBattle && root.$gameTroop ? root.$gameTroop._troopId || 0 : 0,
      enemies: inBattle ? battleEnemies() : [],
      switches: idsOn(root.$gameSwitches._data),
      variables: setValues(root.$gameVariables._data),
      selfSwitches: selfSwitchesOn(),
      party: (party._actors || []).slice(),
      items: heldItems(),
      gold: party.gold(),
      playtime: root.$gameSystem ? root.$gameSystem.playtime() : 0,
      events: mapEvents(),
      dialogue: state.dialogue.slice(),
    }
  }

  // Each control hooks on its own, so a plugin that replaced one class costs only that control.
  function hook(name, install) {
    var target = root[name]

    if (!target) {
      return name + ' does not exist in this game.'
    }

    try {
      install(target)

      return null
    } catch (error) {
      return name + ': ' + (error && error.message ? error.message : String(error))
    }
  }

  function wrap(owner, method, makeReplacement) {
    var marker = '_wenbu_' + method

    if (owner[marker]) {
      return
    }

    var original = owner[method]

    if (typeof original !== 'function') {
      throw new Error(method + ' is missing.')
    }

    owner[method] = makeReplacement(original)
    owner[marker] = true
  }

  function hookFrame() {
    var manager = root.SceneManager

    if (!manager) {
      return 'SceneManager does not exist in this game.'
    }

    try {
      wrap(manager, 'updateScene', function (original) {
        return function () {
          try {
            tick()
          } catch (ignored) {
            // A control must never stop the game's frame.
          }

          return original.apply(this, arguments)
        }
      })

      return null
    } catch (error) {
      return 'SceneManager: ' + error.message
    }
  }

  function hookHp() {
    return hook('Game_BattlerBase', function (klass) {
      wrap(klass.prototype, 'setHp', function (original) {
        return function (hp) {
          return original.call(this, state.hpMode === 'god' && isLeader(this) ? this.mhp : hp)
        }
      })

      wrap(root.Game_Battler.prototype, 'addState', function (original) {
        return function (stateId) {
          if (state.hpMode === 'god' && isLeader(this) && stateId === this.deathStateId()) {
            return undefined
          }

          return original.apply(this, arguments)
        }
      })
    })
  }

  function hookOneHit() {
    return hook('Game_Action', function (klass) {
      wrap(klass.prototype, 'makeDamageValue', function (original) {
        return function (target, critical) {
          var value = original.call(this, target, critical)
          var subject = this.subject()

          if (
            state.hpMode === 'god' &&
            subject &&
            subject.isActor() &&
            target &&
            target.isEnemy() &&
            this.isHpEffect() &&
            value > 0
          ) {
            return Math.max(1, target.hp)
          }

          return value
        }
      })
    })
  }

  function hookFont() {
    return hook('Window_Base', function (klass) {
      wrap(klass.prototype, 'createContents', function (original) {
        return function () {
          var result = original.apply(this, arguments)

          markDialogue(this)

          if (this.contents) {
            this.contents._wenbuWindow = this
          }

          return result
        }
      })

      wrap(klass.prototype, 'resetFontSettings', function (original) {
        return function () {
          var result = original.apply(this, arguments)

          dialogueFont(this.contents)

          return result
        }
      })

      wrap(klass.prototype, 'lineHeight', function (original) {
        return function () {
          var height = original.apply(this, arguments)

          return isChoice(this) ? height + extraLineHeight() : height
        }
      })

      wrap(root.Bitmap.prototype, 'drawText', function (original) {
        return function () {
          dialogueFont(this)

          try {
            if (drawTranslated(this, original, arguments)) {
              return undefined
            }
          } catch (ignored) {
            // A translation that cannot be drawn leaves the game's own text.
          }

          return original.apply(this, arguments)
        }
      })

      wrap(root.Bitmap.prototype, 'measureTextWidth', function (original) {
        return function () {
          dialogueFont(this)

          return original.apply(this, arguments)
        }
      })
    })
  }

  function hookWordWrap() {
    live.ownWrap = ownWordWrap()

    if (live.ownWrap) {
      return 'This game already wraps its own dialogue (' + live.ownWrap + ').'
    }

    var failure = hook('Window_Message', function (klass) {
      wrap(klass.prototype, 'processCharacter', function (original) {
        return function (textState) {
          try {
            wrapBefore(this, textState)
          } catch (ignored) {
            // A wrong measurement must never stop a message.
          }

          return original.apply(this, arguments)
        }
      })
    })

    failure =
      failure ||
      hook('Game_Message', function (klass) {
        wrap(klass.prototype, 'allText', function (original) {
          return function () {
            return reflow(original.apply(this, arguments))
          }
        })
      })

    if (!failure && root.Window_ScrollText) {
      hook('Window_ScrollText', function (klass) {
        wrap(klass.prototype, 'processCharacter', function (original) {
          return function (textState) {
            try {
              wrapBefore(this, textState)
            } catch (ignored) {
              // As above.
            }

            return original.apply(this, arguments)
          }
        })
      })
    }

    return failure
  }

  function hookSpeed() {
    return hook('Game_CharacterBase', function (klass) {
      wrap(klass.prototype, 'distancePerFrame', function (original) {
        return function () {
          var distance = original.apply(this, arguments)

          return this === root.$gamePlayer ? distance * state.speed : distance
        }
      })
    })
  }

  function install() {
    if (!root.Game_BattlerBase || !root.Window_Base || !root.SceneManager) {
      fail('not-ready', 'The game is still loading.')
    }

    var unsupported = {}
    var hp = hookFrame() || hookHp()
    var oneHit = hookOneHit()
    var font = hookFont()
    var speed = hookSpeed()
    var wordWrap = hookWordWrap()
    var images = hookImages()

    if (images) {
      unsupported.imageText = images
    }

    if (wordWrap) {
      unsupported.wordWrap = wordWrap
    }

    if (hp) {
      unsupported.hpMode = hp
    }

    if (oneHit) {
      unsupported.oneHit = oneHit
    }

    if (font) {
      unsupported.fontSize = font
      unsupported.inGameText = font
    }

    if (speed) {
      unsupported.speed = speed
    }

    markOpenDialogue()
    hookOriginalKey()

    return { snapshot: snapshot(), unsupported: unsupported }
  }

  var commands = {
    install: install,
    snapshot: snapshot,
    setHpMode: setHpMode,
    setGold: setGold,
    setFontSize: setFontSize,
    setSpeed: setSpeed,
    setTextOptions: setTextOptions,
    takeText: takeText,
    addTexts: addTexts,
    addImages: addImages,
    showOriginal: showOriginal,
    actors: actors,
    actor: actor,
    setStat: setStat,
    inventory: inventory,
    setQuantity: setQuantity,
    switches: switches,
    setSwitch: setSwitch,
    variables: variables,
    setVariable: setVariable,
    sharedSwitches: sharedSwitches,
    switchValues: switchValues,
    unlockMemories: unlockMemories,
    guideState: guideState,
  }

  live.call = function (name, args) {
    try {
      if (!Object.prototype.hasOwnProperty.call(commands, name)) {
        fail('invalid', 'Unknown command ' + name + '.')
      }

      return JSON.stringify({ ok: true, value: commands[name].apply(null, args || []) })
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error && error.message ? error.message : String(error),
      })
    }
  }

  return live.call('install', [])
})(window)
