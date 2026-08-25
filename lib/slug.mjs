// Canonical slug for a film title, used for poster filenames and for the
// fuzzy side of the diary join.
//
//   "Everybody Wants Some!!"  -> everybody-wants-some
//   "20th Century Women"      -> 20th-century-women
//   "Amélie"                  -> amelie

export function slugify(title) {
  return String(title)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[’'`]/g, '')             // elide apostrophes rather than split on them
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Poster filename stem: slug + year, so same-titled films don't collide.
// "Luca" (2021) and "Luca" (2008) get distinct files.
export function posterStem(title, year) {
  return `${slugify(title)}-${year}`;
}

// Join key. Year is coerced to a string on both sides: config files carry it as
// a number, viewing_history.json as a string, and `2017 !== "2017"`.
export function filmKey(title, year) {
  return `${slugify(title)}::${String(year).trim()}`;
}
