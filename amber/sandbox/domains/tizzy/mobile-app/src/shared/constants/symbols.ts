/**
 * SF Symbol constants for Tizzy mobile app
 * Centralized mapping of emoji use cases to SF Symbol names
 * @see https://developer.apple.com/sf-symbols/
 */

export const symbols = {
  // Status/State Icons
  status: {
    error: 'exclamationmark.triangle.fill',
    warning: 'exclamationmark.circle.fill',
    success: 'checkmark.circle.fill',
    info: 'info.circle.fill',
    alert: 'bell.badge.fill',
    attention: 'exclamationmark.octagon.fill',
    question: 'questionmark.circle.fill',
    loading: 'arrow.clockwise.circle.fill',
    offline: 'wifi.slash',
    online: 'wifi',
    syncing: 'arrow.triangle.2.circlepath',
    synced: 'checkmark.icloud.fill',
    pending: 'clock.fill',
    blocked: 'nosign',
  },

  // Communication Icons
  communication: {
    microphone: 'mic.fill',
    microphoneMuted: 'mic.slash.fill',
    phone: 'phone.fill',
    phoneIncoming: 'phone.arrow.down.left.fill',
    phoneOutgoing: 'phone.arrow.up.right.fill',
    phoneMissed: 'phone.down.fill',
    chat: 'bubble.left.fill',
    chatMultiple: 'bubble.left.and.bubble.right.fill',
    message: 'message.fill',
    email: 'envelope.fill',
    emailOpen: 'envelope.open.fill',
    send: 'paperplane.fill',
    video: 'video.fill',
    videoMuted: 'video.slash.fill',
    speaker: 'speaker.wave.2.fill',
    speakerMuted: 'speaker.slash.fill',
    notification: 'bell.fill',
    notificationOff: 'bell.slash.fill',
  },

  // Environment/Context Icons
  context: {
    work: 'briefcase.fill',
    social: 'person.2.fill',
    meeting: 'calendar.badge.clock',
    family: 'house.fill',
    personal: 'person.fill',
    travel: 'airplane',
    exercise: 'figure.walk',
    food: 'fork.knife',
    shopping: 'cart.fill',
    learning: 'book.fill',
    entertainment: 'tv.fill',
    health: 'heart.fill',
    finance: 'dollarsign.circle.fill',
    location: 'mappin.circle.fill',
    home: 'house.circle.fill',
    office: 'building.2.fill',
    outdoor: 'sun.max.fill',
    indoor: 'lamp.table.fill',
  },

  // Progress/Achievement Icons
  progress: {
    target: 'target',
    targetAchieved: 'scope',
    growth: 'chart.line.uptrend.xyaxis',
    decline: 'chart.line.downtrend.xyaxis',
    wins: 'trophy.fill',
    chart: 'chart.bar.fill',
    chartPie: 'chart.pie.fill',
    percentage: 'percent',
    increase: 'arrow.up.circle.fill',
    decrease: 'arrow.down.circle.fill',
    goal: 'flag.fill',
    goalCompleted: 'flag.checkered',
    streak: 'flame.fill',
    milestone: 'star.fill',
    level: 'sparkles',
    badge: 'rosette',
  },

  // Settings/Actions Icons
  actions: {
    settings: 'gearshape.fill',
    edit: 'pencil.circle.fill',
    delete: 'trash.fill',
    add: 'plus.circle.fill',
    remove: 'minus.circle.fill',
    save: 'square.and.arrow.down.fill',
    export: 'square.and.arrow.up.fill',
    share: 'square.and.arrow.up',
    import: 'square.and.arrow.down',
    copy: 'doc.on.doc.fill',
    paste: 'doc.on.clipboard.fill',
    cut: 'scissors',
    undo: 'arrow.uturn.backward.circle.fill',
    redo: 'arrow.uturn.forward.circle.fill',
    search: 'magnifyingglass.circle.fill',
    filter: 'line.3.horizontal.decrease.circle.fill',
    sort: 'arrow.up.arrow.down.circle.fill',
    refresh: 'arrow.clockwise',
    close: 'xmark.circle.fill',
    cancel: 'xmark',
    confirm: 'checkmark',
    back: 'chevron.left',
    forward: 'chevron.right',
    more: 'ellipsis.circle.fill',
  },

  // Device Icons
  device: {
    battery: 'battery.100percent',
    batteryLow: 'battery.25percent',
    batteryCritical: 'battery.0percent',
    charging: 'battery.100percent.bolt',
    connected: 'antenna.radiowaves.left.and.right',
    disconnected: 'antenna.radiowaves.left.and.right.slash',
    bluetooth: 'bluetooth',
    bluetoothOff: 'bluetooth.slash',
    wifi: 'wifi',
    wifiOff: 'wifi.slash',
    cellular: 'antenna.radiowaves.left.and.right',
    cellularOff: 'antenna.radiowaves.left.and.right.slash',
    airplane: 'airplane',
    screen: 'display',
    phone: 'iphone',
    tablet: 'ipad',
    computer: 'laptopcomputer',
    watch: 'applewatch',
    brightness: 'sun.max.fill',
    volume: 'speaker.wave.3.fill',
    volumeMuted: 'speaker.slash.fill',
  },

  // Sentiment Icons
  sentiment: {
    positive: 'face.smiling.fill',
    neutral: 'face.dashed.fill',
    negative: 'face.frowning.fill',
    excited: 'hands.clap.fill',
    love: 'heart.fill',
    like: 'hand.thumbsup.fill',
    dislike: 'hand.thumbsdown.fill',
    celebrate: 'party.popper.fill',
    calm: 'wind',
    stressed: 'bolt.horizontal.fill',
    focused: 'eye.fill',
    tired: 'moon.fill',
    energetic: 'bolt.fill',
  },

  // Time/Schedule Icons
  time: {
    calendar: 'calendar',
    clock: 'clock.fill',
    timer: 'timer',
    stopwatch: 'stopwatch.fill',
    alarm: 'alarm.fill',
    today: 'calendar.circle.fill',
    past: 'clock.arrow.circlepath',
    future: 'hourglass',
    morning: 'sunrise.fill',
    afternoon: 'sun.max.fill',
    evening: 'sunset.fill',
    night: 'moon.stars.fill',
  },

  // Navigation Icons
  navigation: {
    home: 'house.fill',
    profile: 'person.crop.circle.fill',
    explore: 'safari.fill',
    activity: 'chart.bar.xaxis',
    insights: 'brain.head.profile',
    journal: 'book.closed.fill',
    goals: 'target',
    settings: 'gearshape.fill',
    help: 'questionmark.circle.fill',
    feedback: 'bubble.left.and.exclamationmark.bubble.right.fill',
  },

  // Data/Content Icons
  content: {
    folder: 'folder.fill',
    file: 'doc.fill',
    image: 'photo.fill',
    video: 'video.fill',
    audio: 'waveform',
    document: 'doc.text.fill',
    note: 'note.text',
    list: 'list.bullet',
    grid: 'square.grid.2x2.fill',
    tag: 'tag.fill',
    bookmark: 'bookmark.fill',
    star: 'star.fill',
    pin: 'pin.fill',
    link: 'link',
    attachment: 'paperclip',
  },

  // User/People Icons
  people: {
    person: 'person.fill',
    personCircle: 'person.crop.circle.fill',
    group: 'person.2.fill',
    groupLarge: 'person.3.fill',
    team: 'person.2.circle.fill',
    followers: 'person.line.dotted.person.fill',
    contact: 'person.crop.square.fill',
    avatar: 'person.crop.circle',
  },

  // Privacy/Security Icons
  security: {
    lock: 'lock.fill',
    unlock: 'lock.open.fill',
    shield: 'shield.fill',
    shieldChecked: 'checkmark.shield.fill',
    eye: 'eye.fill',
    eyeSlash: 'eye.slash.fill',
    key: 'key.fill',
    fingerprint: 'touchid',
    faceid: 'faceid',
  },
} as const;

export type Symbols = typeof symbols;

// Helper type to get all symbol names
export type SymbolName = typeof symbols[keyof typeof symbols][keyof typeof symbols[keyof typeof symbols]];

// Category type for filtering/organization
export type SymbolCategory = keyof typeof symbols;

/**
 * Helper function to get a symbol by category and name
 * @param category - The symbol category (e.g., 'status', 'communication')
 * @param name - The symbol name within the category (e.g., 'error', 'microphone')
 * @returns The SF Symbol name or undefined if not found
 */
export function getSymbol<C extends SymbolCategory>(
  category: C,
  name: keyof typeof symbols[C]
): string {
  return symbols[category][name] as string;
}

/**
 * Helper function to check if a symbol exists
 * @param category - The symbol category
 * @param name - The symbol name within the category
 * @returns True if the symbol exists
 */
export function hasSymbol<C extends SymbolCategory>(
  category: C,
  name: string
): name is keyof typeof symbols[C] {
  return name in symbols[category];
}
