// Google reviews feed — real reviews, transcribed from the Google listing
// (provided by Eric, 2026-07-11).
//
// When the Google Business Profile under the LLC is live, set
// GOOGLE_REVIEWS_URL to the public "read our reviews" link and every card
// becomes a tap-through. Wiring the live Places API feed through the Worker
// can replace this static list later (docs/SETUP.md).
export const GOOGLE_REVIEWS_URL = null;

// Tap-to-call: Eric's Grasshopper business line (provided 2026-07-12).
// The Google Business voice number belongs to another business, so the app
// deliberately uses this one. About and Reviews render call buttons from it.
export const BUSINESS_PHONE = '+12086708608';
// The same number, formatted for a person to read.
export const BUSINESS_PHONE_TEXT = '(208) 670-8608';

export const REVIEWS = [
  {
    name: 'Jessica Naylor',
    stars: 5,
    text: 'This interview was a really positive experience for me. The interviewer was very kind, respectful, and easy to talk to, which made the whole process feel comfortable instead of intimidating. The work being done is so important, and it meant a lot to speak with someone who truly related to my experiences. I took a lot away from the conversation.',
  },
  {
    name: 'Max GG',
    stars: 5,
    text: 'Good information and help for autoimmune encephalitis patients that often get lost and have no one to help them.',
  },
  {
    name: 'Adam Leach',
    stars: 5,
    text: '',
  },
];

/**
 * Every review a page should show: the reviews Eric has published from real
 * cases, newest first, then the transcribed Google ones.
 *
 * Best effort by design. A reviews page that goes blank because an endpoint
 * hiccuped is worse than one showing only the Google list, so a failure here
 * is silent and the baseline stands.
 */
export async function loadReviews() {
  try {
    const res = await fetch('/api/reviews');
    if (!res.ok) return REVIEWS;
    const mine = ((await res.json()).reviews || [])
      .filter((r) => r && r.stars)
      .map((r) => ({
        name: String(r.name || 'A client'),
        stars: Math.max(1, Math.min(5, Math.round(Number(r.stars)) || 5)),
        text: String(r.text || ''),
      }));
    return mine.length ? [...mine, ...REVIEWS] : REVIEWS;
  } catch {
    return REVIEWS;
  }
}
