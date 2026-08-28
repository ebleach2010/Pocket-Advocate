// Google reviews feed. Real reviews, transcribed from the Google listing
// (provided by Eric, 2026-07-11).
//
// THE PROFILE IS LIVE NOW. Eric, 2026-08-28: "any request for a review gets a
// link to my Google reviews: https://g.page/r/CUKWU6xlposHEAE/review"
//
// TWO LINKS, NOT ONE, because they are two different jobs and the wrong one in
// the wrong place is a dead end for whoever taps it.
//
// The link he gave is a WRITE link: it opens Google's own "leave a review"
// form for this business, and it is what goes anywhere the app ASKS someone
// for a review. Following it while signed out lands on a Google sign in, which
// is Google's doing and is what leaving a review requires.
//
// The READ link is what belongs under a wall of reviews, where the reader
// wants more of them rather than a form. Resolving the short link on
// 2026-08-28 gave up the place id it carries, which is what both the read link
// and any future Places API call are built from:
//
//   place id  ChIJX3ioajAvlIURQpZTrGWmiwc
//
// PULLING the reviews back in, which he also asked for, weekly, is NOT wired
// here and must not be claimed as working. It needs the Google Places API,
// which needs a key this Worker does not have (see .env.example: there is no
// Google key among its secrets), and Places returns at most five reviews.
// loadReviews below still merges in the ones his own clients leave in the app.
export const GOOGLE_PLACE_ID = 'ChIJX3ioajAvlIURQpZTrGWmiwc';
export const GOOGLE_REVIEW_WRITE_URL = 'https://g.page/r/CUKWU6xlposHEAE/review';
export const GOOGLE_REVIEWS_URL =
  `https://search.google.com/local/reviews?placeid=${GOOGLE_PLACE_ID}`;

// Tap-to-call: Eric's Grasshopper business line (provided 2026-07-12).
// The Google Business voice number belongs to another business, so the app
// deliberately uses this one. About and Reviews render call buttons from it.
export const BUSINESS_PHONE = '+12086708608';

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
