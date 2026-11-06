/* Local friction against obvious filler, not a claim to judge someone's intent. */
globalThis.FocusReason = {
  validate(value) {
    const text = String(value || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();
    if (text.length > 240) return 'Keep your reason under 240 characters.';
    const words = text.match(/\p{L}+(?:['’]\p{L}+)*/gu) || [];
    const letters = words.join('');
    if (words.length < 4 || letters.length < 10 || words.filter(w => w.length >= 3).length < 2) {
      return 'Use at least four words about what you want from this video.';
    }
    const counts = new Map();
    for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
    if (counts.size < 3 || Math.max(...counts.values()) > words.length / 2) {
      return 'Describe your reason instead of repeating the same words.';
    }
    const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'poiuytrewq', 'lkjhgfdsa', 'mnbvcxz'];
    const filler = word => /(.)\1{3,}/u.test(word) || /^(.{1,4})\1{2,}$/u.test(word)
      || (word.length >= 4 && rows.some(row => row.includes(word)))
      || (/^[a-z]{6,}$/.test(word) && !/[aeiouy]/.test(word));
    if (words.some(filler) || /(.{1,3})\1{5,}/u.test(letters)) {
      return 'Repeated letters and keyboard patterns do not count. Write a short reason.';
    }
    return '';
  }
};
