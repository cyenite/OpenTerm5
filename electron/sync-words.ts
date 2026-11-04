// 256 short, distinct, easily read words: one per byte, so six words carry 48 bits of a key's hash.
export const pairingWordList = [
  'acorn', 'actor', 'album', 'alley', 'amber', 'anchor', 'angle', 'ankle', 'apple', 'apron', 'arena', 'arrow', 'atlas', 'attic', 'award', 'bacon',
  'badge', 'bagel', 'baker', 'ballet', 'bamboo', 'banana', 'banjo', 'barrel', 'basket', 'beach', 'beaver', 'bell', 'bench', 'berry', 'bison', 'blanket',
  'bloom', 'boat', 'bonus', 'boots', 'bottle', 'bowl', 'brain', 'branch', 'bread', 'brick', 'bridge', 'broom', 'bubble', 'bucket', 'buffalo', 'bundle',
  'butter', 'button', 'cabin', 'cactus', 'camel', 'camera', 'candle', 'canoe', 'canyon', 'carbon', 'carpet', 'carrot', 'castle', 'cedar', 'cello', 'chair',
  'chalk', 'cherry', 'chess', 'chimney', 'circle', 'citrus', 'clock', 'cloud', 'clover', 'coast', 'cobra', 'coconut', 'comet', 'compass', 'copper', 'coral',
  'cotton', 'cowboy', 'crane', 'crayon', 'cricket', 'crown', 'crystal', 'cupcake', 'curtain', 'cushion', 'daisy', 'dancer', 'desert', 'diamond', 'dolphin', 'domino',
  'donkey', 'dragon', 'drum', 'eagle', 'easel', 'echo', 'elbow', 'emerald', 'engine', 'falcon', 'fabric', 'feather', 'fence', 'ferry', 'fiddle', 'flag',
  'flame', 'flute', 'forest', 'fossil', 'fountain', 'fox', 'frog', 'galaxy', 'garden', 'garlic', 'gate', 'giraffe', 'glacier', 'glove', 'goat', 'golf',
  'gorilla', 'grape', 'guitar', 'hammer', 'harbor', 'harp', 'hazel', 'helmet', 'hippo', 'honey', 'horizon', 'hotel', 'iceberg', 'igloo', 'island', 'ivory',
  'jacket', 'jaguar', 'jasmine', 'jelly', 'jungle', 'kayak', 'kettle', 'kiwi', 'koala', 'ladder', 'lagoon', 'lantern', 'laptop', 'lemon', 'lettuce', 'library',
  'lily', 'lion', 'lizard', 'lobster', 'locket', 'magnet', 'mango', 'maple', 'marble', 'meadow', 'melon', 'mirror', 'mitten', 'monkey', 'moose', 'mountain',
  'muffin', 'napkin', 'needle', 'nest', 'noodle', 'oasis', 'ocean', 'olive', 'onion', 'orange', 'orchid', 'otter', 'owl', 'paddle', 'palace', 'panda',
  'parrot', 'peach', 'peanut', 'pebble', 'pelican', 'pencil', 'penguin', 'pepper', 'piano', 'pickle', 'pigeon', 'pillow', 'pilot', 'planet', 'plum', 'pocket',
  'pony', 'potato', 'pumpkin', 'puzzle', 'quartz', 'rabbit', 'radio', 'raven', 'ribbon', 'river', 'robin', 'rocket', 'saddle', 'salmon', 'sandal', 'saturn',
  'scarf', 'shell', 'shovel', 'silver', 'sketch', 'sled', 'spider', 'sponge', 'squirrel', 'statue', 'stone', 'sugar', 'summit', 'sunset', 'swan', 'table',
  'tiger', 'tomato', 'torch', 'tractor', 'trumpet', 'tulip', 'turtle', 'umbrella', 'valley', 'velvet', 'violin', 'volcano', 'wagon', 'walnut', 'whale', 'zebra',
] as const;
