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
