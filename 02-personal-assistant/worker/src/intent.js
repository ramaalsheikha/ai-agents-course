const MAX_SMALL_TALK_CHARS = 80;

const normalize = (message) =>
  String(message ?? "")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const SMALL_TALK_PATTERNS = [
  /^(hi+|hey+|hello+|yo|sup|howdy|hola|salam|salaam|greetings)( there| again| assistant)?$/,
  /^good (morning|afternoon|evening|night)$/,
  /^(how are you|how r u|how are u|how you doing|hows it going|how s it going|what s up|whats up)( today)?$/,
  /^(thanks|thank you|thanks a lot|thank you so much|thx|ty|appreciate it|much appreciated)$/,
  /^(bye|goodbye|see you|see ya|later|take care|have a good day)$/,
  /^(ok|okay|k|kk|cool|nice|great|awesome|perfect|got it|sure|alright|fine|yes|yeah|yep|no|nope)$/,
  /^(who are you|what are you|what can you do|what do you do|introduce yourself|tell me about yourself)$/,
  /^(مرحبا|اهلا|اهلين|هلا|السلام عليكم|وعليكم السلام|صباح الخير|مساء الخير|تحيه)$/u,
  /^(شكرا|شكرا لك|مشكور|يعطيك العافيه|الله يعطيك العافيه)$/u,
  /^(مع السلامه|وداعا|الي اللقاء|باي)$/u,
  /^(كيف حالك|كيفك|شلونك|كيف الحال|اخبارك)$/u,
  /^(من انت|ما انت|ماذا تفعل|ماذا يمكنك ان تفعل|عرف بنفسك|شو بتعمل)$/u,
  /^(تمام|حسنا|طيب|جميل|ممتاز|نعم|لا)$/u,
];

export const isSmallTalk = (message) => {
  const text = normalize(message);
  if (!text || text.length > MAX_SMALL_TALK_CHARS) return false;

  return SMALL_TALK_PATTERNS.some((pattern) => pattern.test(text));
};
