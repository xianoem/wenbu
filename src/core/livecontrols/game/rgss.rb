# RGSSEval runs code in whatever scope the game was executing, so every reference is anchored: ::WenbuLive.

module ::WenbuLive
  SPEEDS = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0]
  FONT_SIZES = 6..48
  FIXNUM_LIMIT = 1073741823

  CLOSER_BYTES = "\xe3\x80\x81\xe3\x80\x82\xef\xbc\x8c\xef\xbc\x8e\xe3\x83\xbb\xef\xbc\x9a\xef\xbc\x9b\xef\xbc\x9f\xef\xbc\x81\xe3\x83\xbc\xe2\x80\xa6\xe2\x80\xa5\xe3\x80\x8d\xe3\x80\x8f\xef\xbc\x89\xe3\x80\x91\xe3\x80\x95\xe3\x80\x89\xe3\x80\x8b\xef\xbd\x9d\xef\xbc\xbd.,!?:;)]}"
  OPENER_BYTES = "\xe3\x80\x8c\xe3\x80\x8e\xef\xbc\x88\xe3\x80\x90\xe3\x80\x94\xe3\x80\x88\xe3\x80\x8a\xef\xbd\x9b\xef\xbc\xbb([{"
  SPEAKER_END_BYTES = ":\xef\xbc\x9a\xe3\x80\x91]"

  STATS = {
    'xp' => [
      ['maxHp', 'Max HP', 'maxhp'], ['maxMp', 'Max SP', 'maxsp'], ['strength', 'Strength', 'str'],
      ['dexterity', 'Dexterity', 'dex'], ['agility', 'Agility', 'agi'], ['intelligence', 'Intelligence', 'int']
    ],
    'vx' => [
      ['maxHp', 'Max HP', 'maxhp'], ['maxMp', 'Max MP', 'maxmp'], ['attack', 'Attack', 'atk'],
      ['defense', 'Defense', 'def'], ['spirit', 'Spirit', 'spi'], ['agility', 'Agility', 'agi']
    ],
    'vxace' => [
      ['maxHp', 'Max HP', 0], ['maxMp', 'Max MP', 1], ['attack', 'Attack', 2], ['defense', 'Defense', 3],
      ['magicAttack', 'Magic Attack', 4], ['magicDefense', 'Magic Defense', 5], ['agility', 'Agility', 6],
      ['luck', 'Luck', 7]
    ]
  }

  @hp_mode = 'none' if @hp_mode.nil?
  @speed = 1.0 if @speed.nil?
  @carry = {} if @carry.nil?

  def self.byte_size(text)
    text.respond_to?(:bytesize) ? text.bytesize : text.size
  end

  def self.reply(id, ok, text)
    @reply = Win32API.new('wenbu-rgss', 'wenbu_reply', ['L', 'L', 'P', 'L'], 'V') if @reply.nil?
    @reply.call(id, ok ? 1 : 0, text, byte_size(text))
  end

  def self.answer(id)
    begin
      data = Marshal.dump(plain(yield))
    rescue Exception => error
      reply(id, false, error.message.to_s)
      return
    end

    reply(id, true, data)
  end

  def self.plain(value)
    case value
    when Hash
      result = {}
      value.each { |key, item| result[key.to_s] = plain(item) }
      result
    when Array
      value.map { |item| plain(item) }
    when Integer
      value.abs > FIXNUM_LIMIT ? value.to_f : value
    when Float, String, true, false, nil
      value
    when Symbol
      value.to_s
    else
      value.inspect
    end
  end

  def self.text(bytes)
    bytes.respond_to?(:force_encoding) ? bytes.force_encoding('UTF-8') : bytes
  end

  def self.engine
    return 'vxace' if defined?(SceneManager)
    return 'vx' if defined?(RPG::BaseItem)
    'xp'
  end

  def self.ready?
    !$game_party.nil? && !$game_actors.nil? && !$game_switches.nil? && !$game_variables.nil? &&
      !$data_system.nil? && !$data_actors.nil?
  end

  def self.require_game
    raise 'not-ready: Start a new game or load a save first.' unless ready?
  end

  def self.members
    party = $game_party
    return [] if party.nil?
    return party.members if party.respond_to?(:members)
    return party.actors if party.respond_to?(:actors)
    []
  end

  def self.leader
    members[0]
  end

  def self.max_hp(battler)
    battler.respond_to?(:mhp) ? battler.mhp : battler.maxhp
  end

  def self.actor_id(battler)
    battler.instance_variable_get(:@actor_id)
  end

  def self.dead?(battler)
    battler.respond_to?(:dead?) ? battler.dead? : battler.hp <= 0
  end

  def self.death_state(battler)
    battler.respond_to?(:death_state_id) ? battler.death_state_id : 1
  end

  def self.max_gold
    $game_party.respond_to?(:max_gold) ? $game_party.max_gold : 9999999
  end

  def self.default_font_size
    Font.respond_to?(:default_size) ? Font.default_size : 22
  end

  def self.snapshot
    ready = ready?
    hero = ready ? leader : nil

    {
      'ready' => ready,
      'engine' => engine,
      'gold' => ready ? $game_party.gold : 0,
      'maxGold' => ready ? max_gold : 0,
      'hpMode' => @hp_mode,
      'fontSize' => @font_size,
      'defaultFontSize' => default_font_size,
      'speed' => @speed,
      'leader' => hero.nil? ? nil : hero.name
    }
  end

  def self.protect_hp(battler, value)
    return value unless @hp_mode == 'god' && battler.equal?(leader)
    max_hp(battler)
  end

  def self.revive(hero)
    hero.remove_state(death_state(hero)) if dead?(hero)
    hero.hp = max_hp(hero) if hero.hp < max_hp(hero)
  end

  def self.keep_killable(hero)
    id = actor_id(hero)
    alive = !dead?(hero)
    changed = id != @leader_id || @leader_dead
    hero.hp = 1 if changed && alive
    @leader_id = id
    @leader_dead = !alive
  end

  def self.tick
    poll_original_key
    return unless ready?
    record_dialogue
    hero = leader
    return if hero.nil?
    revive(hero) if @hp_mode == 'god'
    keep_killable(hero) if @hp_mode == 'killable'
  rescue StandardError
    nil
  end

  def self.one_hit?(user, target)
    @hp_mode == 'god' && user.is_a?(Game_Actor) && target.is_a?(Game_Enemy)
  end

  def self.set_hp_mode(mode)
    raise 'invalid: Unknown HP mode.' unless ['none', 'god', 'killable'].include?(mode)
    @hp_mode = mode
    @leader_id = nil
    @leader_dead = false
    tick
    snapshot
  end

  def self.set_gold(value)
    require_game
    target = [[value.to_i, 0].max, max_gold].min
    $game_party.gain_gold(target - $game_party.gold)
    snapshot
  end

  def self.choice?(window)
    window.class.name.to_s.include?('Choice')
  end

  def self.dialogue?(window)
    window.class.name.to_s.include?('Message') || choice?(window)
  end

  # VX Ace choice rows have a fixed height, so a larger font needs taller rows to stay readable.
  def self.line_height(window, height)
    return height if @font_size.nil? || !choice?(window)
    height + [@font_size - default_font_size, 0].max
  end

  def self.mark_dialogue(window, bitmap)
    bitmap.instance_variable_set(:@wenbu_dialogue, true) if !bitmap.nil? && dialogue?(window)
  rescue StandardError
    nil
  end

  # Applied before every draw: message systems reset the size per message or per character.
  def self.dialogue_font(bitmap)
    return if @font_size.nil? || bitmap.nil? || bitmap.disposed?
    return unless bitmap.instance_variable_get(:@wenbu_dialogue)
    bitmap.font.size = @font_size if bitmap.font.size != @font_size
  rescue StandardError
    nil
  end

  def self.mark_open_dialogue
    scene = defined?(SceneManager) ? SceneManager.scene : $scene
    return if scene.nil?

    scene.instance_variables.each do |name|
      window = scene.instance_variable_get(name)
      mark_dialogue(window, window.contents) if window.is_a?(Window) && !window.disposed?
    end
  rescue StandardError
    nil
  end

  def self.set_font_size(size)
    @font_size = size.nil? ? nil : [[size.to_i, FONT_SIZES.first].max, FONT_SIZES.last].min
    mark_open_dialogue
    snapshot
  end

  def self.set_speed(multiplier)
    value = multiplier.to_f
    raise 'invalid: Unsupported character speed.' unless SPEEDS.include?(value)
    @speed = value
    @carry = {}
    snapshot
  end

  def self.move_steps(character)
    return 1 if @speed == 1.0
    carry = (@carry[character.object_id] || 0.0) + @speed
    steps = carry.floor
    @carry[character.object_id] = carry - steps
    steps
  end

  def self.options
    @text_options = {
      'ui' => false, 'images' => false, 'wrap' => false, 'reflow' => false,
      'imageStyle' => 'cover', 'originalKey' => 'backquote', 'original' => false
    } if @text_options.nil?
    @text_options
  end

  def self.set_text_options(ui, images, wrap, reflow, image_style, original_key)
    ui_changed = options['ui'] != (ui == true)
    images_changed = options['images'] != (images == true) || options['imageStyle'] != image_style
    options['ui'] = ui == true
    options['images'] = images == true
    options['wrap'] = wrap == true
    options['reflow'] = reflow == true
    options['imageStyle'] = image_style == 'label' ? 'label' : 'cover'
    options['originalKey'] = original_key.to_s

    if ui_changed
      @queued = {}
      @fits = {}
      scene_windows.each { |window| refresh_window(window) }
    end

    repaint_images if images_changed && respond_to?(:repaint_images)
    nil
  end

  def self.code_of(c)
    c.unpack('U*')[0] || 0
  rescue StandardError
    0
  end

  def self.cjk?(c)
    code = code_of(c)
    (code >= 0x3000 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef)
  end

  # Ruby 1.9 compares strings by encoding, so the byte constants are read as UTF-8 once.
  def self.utf8(name)
    @utf8 = {} if @utf8.nil?
    @utf8[name] = text(const_get(name).dup) if @utf8[name].nil?
    @utf8[name]
  end

  def self.space?(c)
    c == ' ' || c == "\t" || code_of(c.to_s) == 0x3000
  end

  def self.control?(c)
    c.nil? || c.empty? || code_of(c) < 0x20
  end

  def self.closer?(c)
    !c.nil? && !c.empty? && utf8(:CLOSER_BYTES).include?(c)
  end

  def self.opener?(c)
    !c.nil? && !c.empty? && utf8(:OPENER_BYTES).include?(c)
  end

  def self.word_from(c, rest)
    chars = chars_of(rest[0, 96])
    word = c.dup
    index = 0

    if opener?(c) && !control?(chars[0])
      word << chars[0]
      index = 1
    elsif !cjk?(c)
      while index < chars.size && !space?(chars[index]) && !control?(chars[index]) && !cjk?(chars[index])
        word << chars[index]
        index += 1
      end
    end

    while index < chars.size && closer?(chars[index])
      word << chars[index]
      index += 1
    end

    word
  end

  # Breaks with the game's own new line, which also starts a new page when the window runs out of lines.
  def self.wrap_before(window, c, text, pos)
    return unless options['wrap']
    pos[:wenbu_own] = !((c.to_s + text) =~ /<wordwrap>/i).nil? if pos[:wenbu_own].nil?
    before = pos[:wenbu_before]
    pos[:wenbu_before] = c unless c == "\e"
    return if pos[:wenbu_own] || control?(c) || space?(c) || pos[:x] <= pos[:new_x] + 1

    starts = !opener?(before) && (cjk?(c) || opener?(c) || before.nil? || space?(before) || cjk?(before))

    if starts
      width = window.contents.text_size(word_from(c, text)).width
    elsif !closer?(c)
      width = window.contents.text_size(c).width
    else
      return
    end

    limit = window.respond_to?(:contents_width) ? window.contents_width : window.contents.width
    return if pos[:x] + width <= limit
    window.send(:process_new_line, text, pos)
    pos[:wenbu_before] = nil
  rescue StandardError
    nil
  end

  def self.chars_of(line)
    line.respond_to?(:each_char) ? line.each_char.to_a : line.split(//u)
  end

  def self.speaker?(line)
    last = chars_of(line.strip).last
    !last.nil? && utf8(:SPEAKER_END_BYTES).include?(last)
  end

  def self.reflow(text)
    return text unless options['wrap'] && options['reflow'] && (text =~ /<wordwrap>/i).nil?
    lines = text.split("\n", -1)
    out = lines[0].to_s.dup

    (1...lines.size).each do |index|
      line = lines[index]
      before = lines[index - 1]

      if line.strip.empty? || before.strip.empty? || (index == 1 && speaker?(before))
        out << "\n" << line
      else
        trimmed = line.sub(/\A\s+/, '')
        tight = cjk?(chars_of(before).last.to_s) && cjk?(chars_of(trimmed).first.to_s)
        out << (tight ? '' : ' ') << trimmed
      end
    end

    out
  end

  MAX_QUEUED = 200
  SQUEEZE = 0.8
  ELLIPSIS_BYTES = "\xe2\x80\xa6"
  ORIGINAL_KEYS = { 'backquote' => 0xC0, 'tab' => 0x09, 'alt' => 0x12 }

  def self.dict
    @dict = {} if @dict.nil?
    @dict
  end

  def self.queue
    @queue = [] if @queue.nil?
    @queue
  end

  def self.queued
    @queued = {} if @queued.nil?
    @queued
  end

  def self.fits
    @fits = {} if @fits.nil?
    @fits
  end

  def self.pending
    @pending = [] if @pending.nil?
    @pending
  end

  # Hiragana, katakana and kanji all start with UTF-8 lead bytes E3 to E9.
  def self.japanese?(text)
    text.unpack('C*').any? { |byte| byte >= 0xe3 && byte <= 0xe9 }
  end

  def self.scene_class
    scene = defined?(SceneManager) ? SceneManager.scene : $scene
    scene.nil? ? '' : scene.class.name.to_s
  rescue StandardError
    ''
  end

  def self.enqueue(report)
    queue << report if queue.size < MAX_QUEUED
  end

  def self.mark_window(window, bitmap)
    bitmap.instance_variable_set(:@wenbu_window, window) if !bitmap.nil? && !bitmap.disposed?
  rescue StandardError
    nil
  end

  def self.key_of(source)
    numbers = []
    key = source.gsub(/\d+/) do |digits|
      numbers << digits
      '{' + (numbers.size - 1).to_s + '}'
    end
    [key, numbers]
  end

  def self.fill_numbers(translated, numbers)
    translated.gsub(/\{(\d+)\}/) { |placeholder| numbers[$1.to_i] || placeholder }
  end

  def self.missed(bitmap, key, width)
    unless queued[key]
      queued[key] = true
      enqueue('key' => key, 'fit' => 'missing', 'width' => width.to_i, 'size' => bitmap.font.size, 'scene' => scene_class)
    end

    window = bitmap.instance_variable_get(:@wenbu_window)
    pending << window unless window.nil? || pending.any? { |item| item.equal?(window) }
  end

  def self.report_fit(key, fit, width, size)
    return if fits[key] == fit
    fits[key] = fit
    enqueue('key' => key, 'fit' => fit, 'width' => width.to_i, 'size' => size, 'scene' => scene_class)
  end

  def self.two_lines(source)
    chars = chars_of(source)
    middle = chars.size / 2
    best = nil
    chars.each_with_index do |c, index|
      best = index if c == ' ' && (best.nil? || (index - middle).abs < (best - middle).abs)
    end
    return [chars[0, middle].join, chars[middle..-1].join] if best.nil?
    [chars[0, best].join, chars[(best + 1)..-1].join]
  end

  def self.cut_to_fit(bitmap, source, limit)
    chars = chars_of(source)
    ellipsis = utf8(:ELLIPSIS_BYTES)
    chars.pop while chars.size > 1 && bitmap.text_size(chars.join.rstrip + ellipsis).width > limit
    chars.join.rstrip + ellipsis
  end

  def self.draw_fitted(bitmap, translated, x, y, width, height, align, key)
    size = bitmap.font.size
    limit = width.to_i > 0 ? width.to_i : 1000000
    fit = 'as-is'
    lines = [translated]

    if bitmap.text_size(translated).width > limit
      least = (size * 0.75).ceil
      bitmap.font.size -= 1 while bitmap.font.size > least && bitmap.text_size(translated).width > limit
      measured = bitmap.text_size(translated).width
      split = two_lines(translated)
      line = bitmap.text_size('A').height
      split_fits = height.to_i >= line * 2 && split.all? { |part| bitmap.text_size(part).width * SQUEEZE <= limit }

      if measured <= limit
        fit = 'smaller'
      elsif measured * SQUEEZE <= limit
        fit = 'squeezed'
      elsif split_fits
        fit = 'wrapped'
        lines = split
      else
        fit = 'too-long'
        lines = [cut_to_fit(bitmap, translated, limit / SQUEEZE)]
      end
    end

    begin
      if lines.size == 2
        half = height / 2
        yield(x, y, width, half, lines[0], align)
        yield(x, y + half, width, height - half, lines[1], align)
      else
        yield(x, y, width, height, lines[0], align)
      end
    ensure
      bitmap.font.size = size
    end

    report_fit(key, fit, width, size) unless key.nil?
  end

  def self.draw_translated(bitmap, args)
    return false unless options['ui'] && !options['original']
    return false if bitmap.instance_variable_get(:@wenbu_dialogue)

    if args[0].is_a?(Rect)
      rect = args[0]
      x, y, width, height = rect.x, rect.y, rect.width, rect.height
      source = args[1]
      align = args[2] || 0
    else
      x, y, width, height, source = args[0], args[1], args[2], args[3], args[4]
      align = args[5] || 0
    end

    return false unless source.is_a?(String) && japanese?(source)
    key, numbers = key_of(source)
    translated = dict[key]

    if translated.nil?
      missed(bitmap, key, width)
      return false
    end

    draw_fitted(bitmap, fill_numbers(translated, numbers), x, y, width, height, align, key) do |*parts|
      yield(*parts)
    end
    true
  rescue StandardError
    false
  end

  def self.scene_windows
    scene = defined?(SceneManager) ? SceneManager.scene : $scene
    return [] if scene.nil?
    scene.instance_variables.map { |name| scene.instance_variable_get(name) }.select do |value|
      value.is_a?(Window) && !value.disposed?
    end
  rescue StandardError
    []
  end

  def self.refresh_window(window)
    return if window.nil? || window.disposed? || !window.respond_to?(:refresh)
    window.refresh if window.method(:refresh).arity == 0
  rescue StandardError
    nil
  end

  def self.take_text
    reports = queue
    @queue = []
    reports
  end

  def self.add_texts(pairs)
    (pairs || []).each do |pair|
      next unless pair.is_a?(Array) && pair[0].is_a?(String) && pair[1].is_a?(String)
      dict[pair[0]] = pair[1]
    end

    waiting = pending
    @pending = []
    waiting.each { |window| refresh_window(window) }
    dict.size
  end

  def self.show_original(on)
    return nil if options['original'] == (on == true)
    options['original'] = on == true
    scene_windows.each { |window| refresh_window(window) }
    repaint_images if respond_to?(:repaint_images)
    nil
  end

  def self.images
    @images = {} if @images.nil?
    @images
  end

  def self.loaded
    @loaded = {} if @loaded.nil?
    @loaded
  end

  def self.painted
    @painted = [] if @painted.nil?
    @painted
  end

  def self.image_key(folder, filename)
    path = (folder.to_s + filename.to_s).gsub('\\', '/').sub(/\Agraphics\//i, '')
    path.sub(/\.(png|jpg|bmp)\z/i, '').downcase
  end

  def self.show_images?
    options['images'] && !options['original']
  end

  def self.background_of(bitmap, x, y, w, h)
    points = [[x - 1, y - 1], [x + w, y - 1], [x - 1, y + h], [x + w, y + h],
              [x + w / 2, y - 1], [x + w / 2, y + h], [x - 1, y + h / 2], [x + w, y + h / 2]]
    sum = [0, 0, 0]

    points.each do |px, py|
      color = bitmap.get_pixel([[px, 0].max, bitmap.width - 1].min, [[py, 0].max, bitmap.height - 1].min)
      sum[0] += color.red
      sum[1] += color.green
      sum[2] += color.blue
    end

    sum.map { |channel| channel / points.size }
  end

  def self.plain_draw(bitmap, parts)
    if bitmap.respond_to?(:wenbu_live_draw_text)
      bitmap.wenbu_live_draw_text(*parts)
    else
      bitmap.draw_text(*parts)
    end
  end

  def self.paint(bitmap, key)
    boxes = images[key]
    return if boxes.nil? || bitmap.disposed? || bitmap.instance_variable_get(:@wenbu_painted) == boxes
    restore_image(bitmap)
    copies = []
    size = bitmap.font.size
    color = bitmap.font.color.dup

    boxes.each do |box|
      x, y, w, h, translated = box
      copy = Bitmap.new(w, h)
      copy.blt(0, 0, bitmap, Rect.new(x, y, w, h))
      copies << copy
      background = background_of(bitmap, x, y, w, h)
      fill = options['imageStyle'] == 'label' ? background.map { |channel| channel * 0.2 } : background
      light = (0.299 * fill[0] + 0.587 * fill[1] + 0.114 * fill[2]) / 255.0 > 0.55
      bitmap.fill_rect(x, y, w, h, Color.new(fill[0], fill[1], fill[2]))
      bitmap.font.size = [(h * 0.8).floor, 10].max
      bitmap.font.color = light ? Color.new(0, 0, 0) : Color.new(255, 255, 255)
      draw_fitted(bitmap, translated, x, y, w, h, 1, nil) { |*parts| plain_draw(bitmap, parts) }
    end

    bitmap.font.size = size
    bitmap.font.color = color
    bitmap.instance_variable_set(:@wenbu_painted, boxes)
    bitmap.instance_variable_set(:@wenbu_copies, copies)
    painted << bitmap
  rescue StandardError
    nil
  end

  def self.restore_image(bitmap)
    boxes = bitmap.instance_variable_get(:@wenbu_painted)
    copies = bitmap.instance_variable_get(:@wenbu_copies)
    return if boxes.nil? || copies.nil?

    unless bitmap.disposed?
      boxes.each_with_index do |box, index|
        bitmap.fill_rect(box[0], box[1], box[2], box[3], Color.new(0, 0, 0, 0))
        bitmap.blt(box[0], box[1], copies[index], copies[index].rect)
      end
    end

    bitmap.instance_variable_set(:@wenbu_painted, nil)
    bitmap.instance_variable_set(:@wenbu_copies, nil)
    painted.delete_if { |other| other.equal?(bitmap) }
  rescue StandardError
    nil
  end

  def self.loaded_image(bitmap, folder, filename)
    return if bitmap.nil? || filename.to_s.empty?
    key = image_key(folder, filename)
    loaded[key] = bitmap
    paint(bitmap, key) if show_images? && !images[key].nil?
  rescue StandardError
    nil
  end

  def self.image_cache
    owner = defined?(RPG::Cache) ? RPG::Cache : (defined?(::Cache) ? ::Cache : nil)
    owner.nil? ? nil : owner.instance_variable_get(:@cache)
  end

  # Pictures the game loaded before Wenbu hooked loading are still in the cache.
  def self.collect_cached
    cache = image_cache
    return if cache.nil?

    cache.each do |path, bitmap|
      path = path[0] if path.is_a?(Array)
      next unless bitmap.is_a?(Bitmap) && !bitmap.disposed? && path.is_a?(String)
      key = image_key('', path)
      loaded[key] = bitmap if loaded[key].nil?
    end
  rescue StandardError
    nil
  end

  def self.paint_loaded
    collect_cached
    loaded.each do |key, bitmap|
      paint(bitmap, key) if !images[key].nil? && !bitmap.disposed?
    end
  end

  def self.repaint_images
    painted.dup.each { |bitmap| restore_image(bitmap) }
    paint_loaded if show_images?
  end

  def self.add_images(list)
    (list || []).each do |path, boxes|
      images[path.to_s.downcase] = boxes if path.is_a?(String) && boxes.is_a?(Array)
    end

    paint_loaded if show_images?
    images.size
  end

  # XP keeps its loader in RPG::Cache, VX and VX Ace in Cache.
  def self.hook_images
    owner = defined?(RPG::Cache) ? RPG::Cache : (defined?(::Cache) ? ::Cache : nil)
    return 'Cache does not exist in this game.' if owner.nil?
    singleton = class << owner; self; end
    return nil if singleton.method_defined?(:wenbu_live_load_bitmap)

    singleton.class_eval do
      alias_method :wenbu_live_load_bitmap, :load_bitmap
      define_method(:load_bitmap) do |*args|
        bitmap = wenbu_live_load_bitmap(*args)
        ::WenbuLive.loaded_image(bitmap, args[0], args[1])
        bitmap
      end
    end

    nil
  rescue StandardError => error
    'Cache: ' + error.message.to_s
  end

  def self.poll_original_key
    return unless options['ui'] || options['images']
    @key_state = Win32API.new('user32', 'GetAsyncKeyState', ['i'], 'i') if @key_state.nil?
    held = (@key_state.call(ORIGINAL_KEYS[options['originalKey']] || 0xC0) & 0x8000) != 0
    show_original(held) if held != options['original']
  rescue StandardError
    nil
  end

  def self.actors
    require_game
    result = []

    $data_actors.each do |data|
      next if data.nil? || data.name.to_s.empty?
      nickname = data.respond_to?(:nickname) ? data.nickname.to_s : ''
      result.push('id' => data.id, 'name' => data.name, 'nickname' => nickname)
    end

    result
  end

  def self.game_actor(id)
    raise 'invalid: That actor does not exist.' if $data_actors[id.to_i].nil?
    $game_actors[id.to_i]
  end

  def self.mp(hero)
    engine == 'xp' ? hero.sp : hero.mp
  end

  def self.experience(hero)
    hero.respond_to?(:exp) ? hero.exp : hero.instance_variable_get(:@exp).to_i
  end

  def self.param(hero, source)
    source.is_a?(Integer) ? hero.param(source) : hero.send(source)
  end

  def self.stat(key, label, value)
    { 'key' => key, 'label' => label, 'value' => value }
  end

  def self.actor(id)
    require_game
    hero = game_actor(id)
    stats = [stat('hp', 'HP', hero.hp), stat('mp', engine == 'xp' ? 'SP' : 'MP', mp(hero))]
    STATS[engine].each { |key, label, source| stats.push(stat(key, label, param(hero, source))) }
    stats.push(stat('level', 'Level', hero.level))
    stats.push(stat('experience', 'Experience', experience(hero)))
    nickname = hero.respond_to?(:nickname) ? hero.nickname.to_s : ''

    { 'id' => id.to_i, 'name' => hero.name, 'nickname' => nickname, 'stats' => stats }
  end

  def self.set_param(hero, source, value)
    if source.is_a?(Integer)
      hero.add_param(source, value - hero.param(source))
    else
      hero.send(source + '=', value)
    end
  end

  def self.set_level(hero, value)
    top = hero.respond_to?(:max_level) ? hero.max_level : 99
    level = [[value, 1].max, top].min

    if hero.respond_to?(:change_level)
      hero.change_level(level, false)
    else
      hero.level = level
    end
  end

  def self.set_experience(hero, value)
    if hero.respond_to?(:change_exp)
      hero.change_exp(value, false)
    else
      hero.exp = value
    end
  end

  def self.set_mp(hero, value)
    if engine == 'xp'
      hero.sp = value
    else
      hero.mp = value
    end
  end

  def self.set_stat(id, key, value)
    require_game
    hero = game_actor(id)
    amount = [value.to_i, 0].max

    if key == 'hp'
      hero.hp = amount
    elsif key == 'mp'
      set_mp(hero, amount)
    elsif key == 'level'
      set_level(hero, amount)
    elsif key == 'experience'
      set_experience(hero, amount)
    else
      row = STATS[engine].find { |entry| entry[0] == key }
      raise 'invalid: This game has no such stat.' if row.nil?
      set_param(hero, row[2], amount)
    end

    actor(id)
  end

  def self.database(kind)
    return $data_weapons if kind == 'weapon'
    return $data_armors if kind == 'armor'
    $data_items
  end

  def self.quantity(kind, item)
    party = $game_party
    return party.item_number(item) unless engine == 'xp'
    return party.weapon_number(item.id) if kind == 'weapon'
    return party.armor_number(item.id) if kind == 'armor'
    party.item_number(item.id)
  end

  def self.gain(kind, item, amount)
    party = $game_party
    return party.gain_item(item, amount) unless engine == 'xp'
    return party.gain_weapon(item.id, amount) if kind == 'weapon'
    return party.gain_armor(item.id, amount) if kind == 'armor'
    party.gain_item(item.id, amount)
  end

  def self.max_items(item)
    $game_party.respond_to?(:max_item_number) ? $game_party.max_item_number(item) : 99
  end

  def self.inventory_entry(kind, item)
    {
      'kind' => kind,
      'id' => item.id,
      'name' => item.name,
      'description' => item.description.to_s,
      'quantity' => quantity(kind, item)
    }
  end

  def self.inventory
    require_game
    result = []

    ['item', 'weapon', 'armor'].each do |kind|
      (database(kind) || []).each do |item|
        next if item.nil? || item.name.to_s.empty?
        result.push(inventory_entry(kind, item))
      end
    end

    result
  end

  def self.set_quantity(kind, id, amount)
    require_game
    item = (database(kind) || [])[id.to_i]
    raise 'invalid: That item does not exist.' if item.nil?
    target = [[amount.to_i, 0].max, max_items(item)].min
    gain(kind, item, target - quantity(kind, item))
    inventory_entry(kind, item)
  end

  def self.refresh_map
    $game_map.need_refresh = true if !$game_map.nil? && $game_map.respond_to?(:need_refresh=)
  end

  def self.switch_entry(id)
    { 'id' => id, 'name' => $data_system.switches[id].to_s, 'value' => $game_switches[id] == true }
  end

  def self.switches
    require_game
    (1...$data_system.switches.size).map { |id| switch_entry(id) }
  end

  def self.set_switch(id, value)
    require_game
    $game_switches[id.to_i] = value == true
    refresh_map
    switch_entry(id.to_i)
  end

  def self.variable_value(value)
    return value if value.is_a?(Numeric) || value.is_a?(String) || value == true || value == false
    return 0 if value.nil?
    value.inspect
  end

  def self.variable_entry(id)
    { 'id' => id, 'name' => $data_system.variables[id].to_s, 'value' => variable_value($game_variables[id]) }
  end

  def self.variables
    require_game
    (1...$data_system.variables.size).map { |id| variable_entry(id) }
  end

  def self.set_variable(id, value)
    require_game
    $game_variables[id.to_i] = value
    refresh_map
    variable_entry(id.to_i)
  end

  # The common shared-switch script keeps PUBLIC_DATA::SWITCH in PublicData.rvdata2, outside the save slots.
  def self.memory_saver
    return nil unless defined?(::PUBLIC_DATA) && ::PUBLIC_DATA.respond_to?(:write_public_data)
    ::PUBLIC_DATA
  end

  def self.shared_switches
    return nil if memory_saver.nil? || !::PUBLIC_DATA.const_defined?(:SWITCH)
    ids = ::PUBLIC_DATA::SWITCH.select { |id| id.is_a?(Integer) }
    { 'name' => 'PUBLIC_DATA', 'switchIds' => ids }
  end

  def self.switch_values(ids)
    raise 'not-ready: Load a save first.' if $game_switches.nil?
    ids.map { |id| $game_switches[id.to_i] == true }
  end

  def self.unlock_memories(ids)
    saver = memory_saver

    if $game_switches.nil? || (!ready? && saver.nil?)
      raise 'not-ready: Load a save first, so the game keeps what Wenbu unlocks.'
    end

    ids.each { |id| $game_switches[id.to_i] = true }
    refresh_map
    saver.write_public_data unless saver.nil?
    { 'saved' => !saver.nil? }
  end

  DIALOGUE_KEPT = 40

  @dialogue = [] if @dialogue.nil?

  def self.map_id
    $game_map.nil? ? 0 : $game_map.map_id
  end

  def self.message_text
    return $game_temp.message_text.to_s if engine == 'xp' && !$game_temp.nil?
    message = $game_message
    return '' if message.nil? || !message.respond_to?(:texts)
    message.texts.join("\n")
  end

  # Polled each frame rather than hooked, so scripts that rewrite the message classes still count.
  def self.record_dialogue
    text = message_text
    return if text == @last_dialogue
    @last_dialogue = text
    return if text.empty?
    speaker = !$game_message.nil? && $game_message.respond_to?(:face_name) ? $game_message.face_name.to_s : ''
    @dialogue.push({ 'mapId' => map_id, 'speaker' => speaker, 'text' => text })
    @dialogue.shift while @dialogue.size > DIALOGUE_KEPT
  rescue StandardError
    nil
  end

  def self.data_of(object)
    object.instance_variable_get(:@data) || []
  end

  def self.ids_on(object)
    data = data_of(object)
    (1...data.size).select { |id| data[id] == true }
  end

  def self.set_values(object)
    data = data_of(object)
    (1...data.size).map { |id| [id, variable_value(data[id])] }.reject { |pair| pair[1] == 0 || pair[1] == '' }
  end

  def self.self_switches_on
    data = $game_self_switches.nil? ? {} : data_of($game_self_switches)
    data.keys.select { |key| data[key] == true }.map { |key| [key[0], key[1], key[2].to_s] }
  end

  def self.held_items
    held = []

    [['item', :@items], ['weapon', :@weapons], ['armor', :@armors]].each do |kind, name|
      (($game_party.instance_variable_get(name)) || {}).each do |id, count|
        held.push([kind, id, count]) if count.to_i > 0
      end
    end

    held.sort
  end

  def self.party_ids
    (($game_party.instance_variable_get(:@actors)) || []).map { |actor| actor.is_a?(Integer) ? actor : actor.id }
  end

  def self.page_index(event)
    page = event.instance_variable_get(:@page)
    source = event.instance_variable_get(:@event)
    return -1 if page.nil? || source.nil?
    source.pages.index(page) || -1
  end

  def self.map_events
    return [] if $game_map.nil?
    $game_map.events.keys.sort.map { |id| $game_map.events[id] }.reject do |event|
      event.instance_variable_get(:@erased) == true
    end.map { |event| [event.id, event.x, event.y, page_index(event)] }
  end

  def self.in_battle?
    return $game_party.in_battle if $game_party.respond_to?(:in_battle)
    !$game_temp.nil? && $game_temp.respond_to?(:in_battle) && $game_temp.in_battle == true
  end

  def self.troop_id
    id = $game_troop.instance_variable_get(:@troop_id)
    return id unless id.nil?
    !$game_temp.nil? && $game_temp.respond_to?(:battle_troop_id) ? $game_temp.battle_troop_id : 0
  end

  def self.battle_enemies
    members = $game_troop.respond_to?(:members) ? $game_troop.members : $game_troop.enemies
    members.map { |enemy| [enemy.enemy_id, enemy.hp, max_hp(enemy)] }
  end

  def self.map_name
    return $game_map.display_name.to_s if !$game_map.nil? && $game_map.respond_to?(:display_name)
    ''
  end

  def self.guide_state
    require_game
    battle = in_battle?

    {
      'mapId' => map_id,
      'mapName' => map_name,
      'x' => $game_player.nil? ? 0 : $game_player.x,
      'y' => $game_player.nil? ? 0 : $game_player.y,
      'inBattle' => battle,
      'troopId' => battle ? troop_id : 0,
      'enemies' => battle ? battle_enemies : [],
      'switches' => ids_on($game_switches),
      'variables' => set_values($game_variables),
      'selfSwitches' => self_switches_on,
      'party' => party_ids,
      'items' => held_items,
      'gold' => $game_party.gold,
      'playtime' => Graphics.frame_count / Graphics.frame_rate,
      'events' => map_events,
      'dialogue' => @dialogue.dup
    }
  end

  # Each control hooks on its own, so a script that replaced one class costs only that control.
  def self.hook(name)
    return name + ' does not exist in this game.' unless Object.const_defined?(name)
    yield Object.const_get(name)
    nil
  rescue StandardError => error
    name + ': ' + error.message.to_s
  end

  def self.hook_frame
    singleton = class << Graphics; self; end
    return nil if singleton.method_defined?(:wenbu_live_update)

    singleton.class_eval do
      alias_method :wenbu_live_update, :update
      define_method(:update) do
        ::WenbuLive.tick
        wenbu_live_update
      end
    end

    nil
  rescue StandardError => error
    'Graphics: ' + error.message.to_s
  end

  def self.hook_hp
    hook('Game_Battler') do |klass|
      next if klass.method_defined?(:wenbu_live_set_hp)

      klass.class_eval do
        alias_method :wenbu_live_set_hp, :hp=
        define_method(:hp=) { |value| wenbu_live_set_hp(::WenbuLive.protect_hp(self, value)) }
      end
    end
  end

  def self.hook_one_hit_vxace(klass)
    klass.class_eval do
      alias_method :wenbu_live_make_damage_value, :make_damage_value
      define_method(:make_damage_value) do |user, item|
        wenbu_live_make_damage_value(user, item)
        @result.hp_damage = [hp, 1].max if ::WenbuLive.one_hit?(user, self) && @result.hp_damage > 0
      end
    end
  end

  def self.hook_one_hit_vx(klass)
    klass.class_eval do
      alias_method :wenbu_live_attack_damage, :make_attack_damage_value
      define_method(:make_attack_damage_value) do |attacker|
        wenbu_live_attack_damage(attacker)
        @hp_damage = [hp, 1].max if ::WenbuLive.one_hit?(attacker, self) && @hp_damage > 0
      end

      alias_method :wenbu_live_obj_damage, :make_obj_damage_value
      define_method(:make_obj_damage_value) do |user, obj|
        wenbu_live_obj_damage(user, obj)
        @hp_damage = [hp, 1].max if ::WenbuLive.one_hit?(user, self) && @hp_damage > 0
      end
    end
  end

  def self.finish_xp_enemy(user, target)
    return unless one_hit?(user, target) && target.damage.is_a?(Numeric) && target.damage > 0
    remaining = target.hp
    return if remaining <= 0
    target.damage += remaining
    target.hp = 0
  end

  def self.hook_one_hit_xp(klass)
    klass.class_eval do
      alias_method :wenbu_live_attack_effect, :attack_effect
      define_method(:attack_effect) do |attacker|
        result = wenbu_live_attack_effect(attacker)
        ::WenbuLive.finish_xp_enemy(attacker, self)
        result
      end

      alias_method :wenbu_live_skill_effect, :skill_effect
      define_method(:skill_effect) do |user, skill|
        result = wenbu_live_skill_effect(user, skill)
        ::WenbuLive.finish_xp_enemy(user, self)
        result
      end
    end
  end

  def self.hook_one_hit
    hook('Game_Battler') do |klass|
      next if klass.method_defined?(:wenbu_live_make_damage_value) ||
              klass.method_defined?(:wenbu_live_attack_damage) ||
              klass.method_defined?(:wenbu_live_attack_effect)

      if klass.method_defined?(:make_damage_value)
        hook_one_hit_vxace(klass)
      elsif klass.method_defined?(:make_attack_damage_value)
        hook_one_hit_vx(klass)
      else
        hook_one_hit_xp(klass)
      end
    end
  end

  def self.hook_font
    failure = hook('Window') do |klass|
      next if klass.method_defined?(:wenbu_live_set_contents)

      klass.class_eval do
        alias_method :wenbu_live_set_contents, :contents=
        define_method(:contents=) do |bitmap|
          ::WenbuLive.mark_dialogue(self, bitmap)
          ::WenbuLive.mark_window(self, bitmap)
          wenbu_live_set_contents(bitmap)
        end
      end
    end

    failure ||= hook('Bitmap') do |klass|
      next if klass.method_defined?(:wenbu_live_draw_text)

      klass.class_eval do
        alias_method :wenbu_live_draw_text, :draw_text
        define_method(:draw_text) do |*args|
          ::WenbuLive.dialogue_font(self)
          drawn = ::WenbuLive.draw_translated(self, args) { |*parts| wenbu_live_draw_text(*parts) }
          wenbu_live_draw_text(*args) unless drawn
        end

        alias_method :wenbu_live_text_size, :text_size
        define_method(:text_size) do |*args|
          ::WenbuLive.dialogue_font(self)
          wenbu_live_text_size(*args)
        end
      end
    end

    return failure unless failure.nil?

    failure ||= hook('Window_Base') do |klass|
      next unless klass.method_defined?(:line_height)
      next if klass.method_defined?(:wenbu_live_line_height)

      klass.class_eval do
        alias_method :wenbu_live_line_height, :line_height
        define_method(:line_height) do
          ::WenbuLive.line_height(self, wenbu_live_line_height)
        end
      end
    end

    return failure unless failure.nil?

    # VX Ace measures line heights from the font right after resetting it for each message.
    hook('Window_Base') do |klass|
      next unless klass.method_defined?(:reset_font_settings)
      next if klass.method_defined?(:wenbu_live_reset_font_settings)

      klass.class_eval do
        alias_method :wenbu_live_reset_font_settings, :reset_font_settings
        define_method(:reset_font_settings) do
          wenbu_live_reset_font_settings
          ::WenbuLive.dialogue_font(contents)
        end
      end
    end
  end

  def self.hook_movement(name)
    hook(name) do |klass|
      next if klass.method_defined?(:wenbu_live_update_move)

      klass.class_eval do
        alias_method :wenbu_live_update_move, :update_move
        define_method(:update_move) do
          ::WenbuLive.move_steps(self).times { wenbu_live_update_move }
        end
      end
    end
  end

  # VX Ace passes one character at a time with the rest of the text; XP and VX draw the whole page at once.
  def self.hook_word_wrap
    return 'Dialogue Word Wrap needs RPG Maker VX Ace, MV or MZ.' unless engine == 'vxace'

    failure = hook('Window_Message') do |klass|
      next if klass.method_defined?(:wenbu_live_process_character)

      klass.class_eval do
        alias_method :wenbu_live_process_character, :process_character
        define_method(:process_character) do |c, text, pos|
          ::WenbuLive.wrap_before(self, c, text, pos)
          wenbu_live_process_character(c, text, pos)
        end
      end
    end

    failure ||= hook('Game_Message') do |klass|
      next if klass.method_defined?(:wenbu_live_all_text)

      klass.class_eval do
        alias_method :wenbu_live_all_text, :all_text
        define_method(:all_text) do
          ::WenbuLive.reflow(wenbu_live_all_text)
        end
      end
    end

    failure
  end

  def self.hook_speed
    hook_movement('Game_Player')
  end

  def self.install
    frame = hook_frame
    hp = hook_hp
    one_hit = hook_one_hit

    unsupported = {}
    unsupported['hpMode'] = frame || hp unless (frame || hp).nil?
    unsupported['oneHit'] = one_hit unless one_hit.nil?
    font = hook_font
    unsupported['fontSize'] = font unless font.nil?
    unsupported['inGameText'] = font unless font.nil?
    speed = hook_speed
    unsupported['speed'] = speed unless speed.nil?
    word_wrap = hook_word_wrap
    unsupported['wordWrap'] = word_wrap unless word_wrap.nil?
    image_text = hook_images
    unsupported['imageText'] = image_text unless image_text.nil?

    { 'snapshot' => snapshot, 'unsupported' => unsupported }
  end
end
