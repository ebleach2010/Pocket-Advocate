// Google reviews feed config.
//
// When the Google Business Profile exists, set GOOGLE_REVIEWS_URL to the
// public "read our reviews" link (it becomes the strip's tap-through), and
// wire the Places API key into the Worker to replace SAMPLE_REVIEWS with the
// real feed (see docs/SETUP.md § reviews). Until then the strip shows the
// samples below, clearly labeled as samples.
export const GOOGLE_REVIEWS_URL = null;

export const SAMPLE_REVIEWS = [
  { name: 'Sample review', stars: 5, text: 'Walked into my neuro appointment with a one-page list of questions. First visit in years where I felt heard.' },
  { name: 'Sample review', stars: 5, text: 'He went through two years of labs and found the pattern nobody had time to look for.' },
  { name: 'Sample review', stars: 5, text: 'The written report alone was worth it — my new specialist read it start to finish.' },
  { name: 'Sample review', stars: 5, text: 'Finally understood what my MRI report actually said, in plain English.' },
  { name: 'Sample review', stars: 5, text: 'The chat subscription is like having a translator for the medical system on call.' },
];
