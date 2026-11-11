// One place for everything about you and the site.
export const SITE = {
  url: "https://andriantam.com",
  name: "andriantam",
  // Full name: in the home page heading, the resume and the Person structured data.
  person: "Andrian Tam",
  handle: "andriantam",
  title: "Andrian Tam (andriantam) | Photographer, software engineer and brand builder",
  // The three roles, in this order, everywhere they appear.
  roles: ["Photographer", "Software engineer", "Brand builder"],
  description:
    "Andrian Tam (andriantam) is a photographer, software engineer and brand builder in Singapore: fifteen years behind the camera, six years building software at McKinsey & Company, now Head of Brand at TROOPERS. Hands-on, visual, and open to creative collaborations.",
  // The one slogan. Used in the footer, llms.txt and the home page.
  tagline: "Moments are not just meant to be captured, but to be experienced",
  // Where things stand on taking work. One wording, used wherever availability is mentioned.
  availability:
    "Not taking regular photography jobs for now. Photography went from hobby to business, and he stepped back to keep it a passion. Still open to creative projects worth making.",
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
