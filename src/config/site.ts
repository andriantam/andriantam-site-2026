// One place for everything about you and the site.
export const SITE = {
  url: "https://www.andriantam.com",
  name: "andriantam",
  // Full name: only on the resume and in the Person structured data that tells search engines who andriantam is.
  person: "Andrian Tam",
  handle: "andriantam",
  title: "andriantam | Head of Brand, software engineer and photographer",
  description:
    "andriantam is Head of Brand at TROOPERS Singapore and a software engineer who spent six years at McKinsey & Company's digital practice. A photographer for over fifteen years, now shooting for the love of it.",
  tagline: "Moments are not just meant to be captured, but to be experienced",
  locale: "en_SG",
  location: { city: "Singapore", country: "Singapore", countryCode: "SG" },
  email: "andriantamwj@gmail.com",
  whatsapp: "https://wa.me/60122954950",
  social: {
    instagram: "https://www.instagram.com/andriantam/",
    instagramToge: "https://www.instagram.com/togelifestyle/",
    youtube: "https://www.youtube.com/@AndrianTam",
    linkedin: "https://www.linkedin.com/in/andriantam/",
    twitch: "https://www.twitch.tv/andriantam",
    flickr: "https://www.flickr.com/photos/39413324@N06/",
    blogger: "https://diy-andrian.blogspot.com/",
  },
  business: {
    name: "Toge Business Solutions",
    registration: "202403168509 (RA0114024-P)",
  },
};

// Feature flags
export const FLAGS = {
  // Web and software projects are supported in the portfolio but hidden until you switch this on.
  showDevProjects: false,
};

// Ads: AdSense loads on article pages only. Auto ads work with just the client id.
// Add slot ids from your AdSense account to place fixed in-article units instead.
export const ADS = {
  client: "ca-pub-4471934479866915",
  inArticleSlot: "",
  endOfArticleSlot: "",
};

// Cloudflare Web Analytics (cookieless). Paste the token from the Cloudflare dashboard.
export const ANALYTICS = {
  cloudflareToken: "",
};
