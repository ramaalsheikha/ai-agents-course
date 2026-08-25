const TATWEEL = /\u0640/g;
const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const BIDI_CONTROLS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const REPLACEMENT = /\uFFFD/g;
const ARABIC_INDIC = /[\u0660-\u0669]/g;
const EXTENDED_ARABIC_INDIC = /[\u06F0-\u06F9]/g;
const ARABIC_PUNCTUATION = /[\u060C\u061B\u061F\u066A\u066B\u066C]/g;
const HORIZONTAL_SPACE = /[^\S\r\n]+/g;
const BLANK_LINES = /\n{3,}/g;
const TRAILING_SPACE = /[^\S\r\n]+$/gm;

const ARABIC_LETTER = /[\u0600-\u06FF\u0750-\u077F]/;
const PRESENTATION_FORM = /[\uFB50-\uFDFF\uFE70-\uFEFF]/;

const PUNCTUATION_MAP = {
  "،": ",",
  "؛": ";",
  "؟": "?",
  "٪": "%",
  "٫": ".",
  "٬": ",",
};

export const hasArabic = (text) => ARABIC_LETTER.test(text);

export const hasPresentationForms = (text) => PRESENTATION_FORM.test(text);

export const normalizeArabic = (text) =>
  text
    .normalize("NFKC")
    .replace(TATWEEL, "")
    .replace(DIACRITICS, "")
    .replace(ARABIC_INDIC, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(EXTENDED_ARABIC_INDIC, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_PUNCTUATION, (mark) => PUNCTUATION_MAP[mark] ?? mark);

export const normalizeText = (text) => {
  const base = hasArabic(text) ? normalizeArabic(text) : text.normalize("NFKC");

  return base
    .replace(BIDI_CONTROLS, "")
    .replace(REPLACEMENT, "")
    .replace(HORIZONTAL_SPACE, " ")
    .replace(TRAILING_SPACE, "")
    .replace(BLANK_LINES, "\n\n")
    .trim();
};
