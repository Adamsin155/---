const lum = (hex) => { const v = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return ((x + 0.05) / (y + 0.05)).toFixed(2); };
const pairs = {
  'navy glyph on soft': ['#0E2260', '#E4E8F3'], 'purple': ['#5B3FC4', '#EEE9FB'], 'green': ['#0F6B3D', '#E2F3EA'], 'orange': ['#A84B00', '#FFEFDC'], 'pink': ['#C4124F', '#FEEAF1'], 'blue': ['#1D4FB8', '#E4ECFD'], 'teal': ['#0B6B6B', '#DDF3F1'],
  'late tab text on hot-soft': ['#C4124F', '#FEEAF1'], 'on-hot on hot': ['#0B1533', '#F82272'], 'ink on hot-soft': ['#0B1533', '#FEEAF1'], 'ink-2 on hot-soft': ['#2E3957', '#FEEAF1'],
  'ink on amber-soft': ['#0B1533', '#FFF3D9'], 'white on amber': ['#FFFFFF', '#855400'], 'ink on soft': ['#0B1533', '#E4E8F3'], 'ink-2 on soft': ['#2E3957', '#E4E8F3'], 'muted on soft': ['#5A6480', '#E4E8F3'],
  'white on navy': ['#FFFFFF', '#071433'], 'navy num on white': ['#071433', '#FFFFFF'], 'muted on white': ['#5A6480', '#FFFFFF'], 'muted on hot-soft': ['#5A6480', '#FEEAF1'], 'muted on amber-soft': ['#5A6480', '#FFF3D9'],
  'ink-2 on amber-soft': ['#2E3957', '#FFF3D9'], 'ink-2 on ground': ['#2E3957', '#EEF0F4'], 'hot-text on white': ['#C4124F', '#FFFFFF'], 'white on hot-text': ['#FFFFFF', '#C4124F'],
  'navy-text on white': ['#0E2260', '#FFFFFF'], 'ink on white': ['#0B1533', '#FFFFFF'], 'edge soft border on ground(line-strong)': ['#C3C9D8', '#EEF0F4'],
};
for (const [k, [a, b]] of Object.entries(pairs)) console.log(cr(a, b).padStart(6), k, a, b);
