// Home page content. Edit text here; images live in src/assets.
import type { ImageMetadata } from "astro";

import photography from "../assets/services/digital.jpg";
import videography from "../assets/services/video.jpg";
import hybrid from "../assets/services/hybrid.jpg";
import film from "../assets/services/film.jpg";
import drone from "../assets/services/drone.jpg";
import pov from "../assets/services/pov.jpg";
import tech from "../assets/services/web.jpg";

export interface Service {
  id: string;
  title: string;
  outcome: string; // what the client walks away with
  body: string;
  image: ImageMetadata;
  alt: string;
  href?: string;
}

export const SERVICES: Service[] = [
  {
    id: "photography",
    title: "Photography",
    outcome: "Sharp, story-led images you can publish the same week",
    body: "Automotive and motorsport, launches, corporate events, weddings and products. More than 15 years behind the camera, from rolling shots at Sepang to gala dinners and studio product work.",
    image: photography,
    alt: "andriantam photographing an event on stage with two camera bodies",
    href: "/portfolio",
  },
  {
    id: "videography",
    title: "Videography",
    outcome: "Cinematic edits in wide format and vertical reels",
    body: "Event recaps, brand films and social-first reels, shot with a cinematic tone. Formerly Tam's Up Productions.",
    image: videography,
    alt: "andriantam filming with a camera on a handheld gimbal",
    href: "/portfolio/videography",
  },
  {
    id: "hybrid",
    title: "Hybrid photo and video",
    outcome: "One person, both deliverables, one budget",
    body: "For lean productions that need photos and video from a single shooter. Some moments will exist on one format and not the other, and we agree on that up front.",
    image: hybrid,
    alt: "andriantam with a telephoto lens at a car event",
  },
  {
    id: "film",
    title: "Film photography",
    outcome: "Real film, for couples and brands that want texture",
    body: "35mm and medium format, including weddings shot on film. A slower, more deliberate way of working that shows in the final frames.",
    image: film,
    alt: "andriantam holding a twin-lens reflex medium format film camera",
  },
  {
    id: "drone",
    title: "Drone",
    outcome: "Aerial B-roll that gives your story scale",
    body: "Cinematic aerials for events, convoys and locations, flown with DJI drones from the Spark through to the Mini series.",
    image: drone,
    alt: "A DJI drone hovering above grass",
  },
  {
    id: "pov",
    title: "POV helmet camera",
    outcome: "The driver's-eye view your audience never gets",
    body: "Helmet-mounted point-of-view capture, with me as the on-camera POV talent, for drives, track sessions and experiential content.",
    image: pov,
    alt: "andriantam wearing a helmet rig with a mounted point-of-view camera",
  },
  {
    id: "tech",
    title: "Tech consulting",
    outcome: "A senior software engineer in your corner",
    body: "Nearly 10 years building software for clients across Asia, Europe, the US and Australia, including six years at McKinsey Digital. I advise on technical direction and help build software engineering teams.",
    image: tech,
    alt: "andriantam coding on a laptop in a workshop",
    href: "/resume",
  },
];

// Client logos. Files in src/assets/brands.
export const CLIENTS: { name: string; file: string; url?: string }[] = [
  { name: "Tokyo Auto Salon Kuala Lumpur", file: "tas.png", url: "https://www.instagram.com/p/DCMhx-NSxQJ" },
  { name: "Fanatec GT World Challenge", file: "fanatec.png", url: "https://www.gt-world-challenge.com/" },
  { name: "Motul", file: "Motul_logo.png", url: "https://www.instagram.com/p/DCqX60PS2j2/" },
  { name: "MG Motor Malaysia", file: "mg.png", url: "https://www.mgmalaysia.com/" },
  { name: "Chery Malaysia", file: "chery.png", url: "https://www.chery.my/" },
  { name: "GAC Motor", file: "gac.png", url: "https://gacmotor.com.my/" },
  { name: "Jaecoo Malaysia", file: "jaecoo.png", url: "https://www.jaecoo.com.my/" },
  { name: "Giti Tyres Singapore", file: "giti.png", url: "https://www.giti.com.sg/" },
  { name: "Malaysia Autoshow", file: "mas.png", url: "https://autoshow.my/" },
  { name: "Robb Report Malaysia", file: "robb-report.png", url: "https://robbreport.com.my/" },
  { name: "Ferrari Owners Club Malaysia", file: "ferrari-owners.png", url: "https://focm.com.my/" },
  { name: "Lamborghini Owners Malaysia", file: "lambo-owners-malaysia.png", url: "https://www.facebook.com/LamborghiniOwnersMalaysia" },
  { name: "Oversteer movie", file: "oversteer-sq.png", url: "https://www.instagram.com/togelifestyle/reel/DAXfGWFyb3M/" },
  { name: "Solarvest", file: "solarvest-logo.png", url: "https://www.instagram.com/p/DA-rMgjy8pF/" },
  { name: "Scientex", file: "scientex.png", url: "https://scientex.com.my/" },
  { name: "Controls Switchgear", file: "controls.png", url: "https://www.controls.com.my/" },
  { name: "DS Home", file: "ds-home.png", url: "https://dshome2u.com.my/" },
  { name: "Yashcotton", file: "yashcotton.png" },
  { name: "Troopers", file: "troopers.png", url: "https://www.troopers.com.my/home" },
  { name: "Mr Lubricant", file: "mr-lube.jpg", url: "https://www.facebook.com/share/p/yymFNzH7ZUu7t3RL" },
  { name: "Kazuto Garage", file: "kazuto.png", url: "https://www.youtube.com/c/KazutoGarage" },
  { name: "Recstorm Pictures", file: "recstorm.png", url: "https://www.instagram.com/recstorm_pictures/" },
  { name: "Momenz Creation", file: "momenz.png", url: "https://momenz.my/" },
];

export interface Testimonial {
  name: string;
  context: string;
  quote: string;
  photo: string; // file in src/assets/testimonials
}

export const TESTIMONIALS: Testimonial[] = [
  { name: "Moo Voon Hoe", context: "Wedding", photo: "moo.jpeg", quote: "Andrian's dedication to our wedding day was truly unparalleled. From the intimate details to the grand celebrations, he masterfully seized every moment with an artistic flair. We would highly recommend him to anyone looking for a professional, skillful and authentic photographer." },
  { name: "Ka Kit Leong", context: "Track day", photo: "ka_kit.jpg", quote: "Taking my car to the track was an adrenaline rush, and the photos capture the experience perfectly. Crisp shots, from the car's details to the blur of motion that conveys pure speed. These aren't just pictures; they're bottled exhilaration." },
  { name: "Rolo Khor", context: "Personal car shoot", photo: "rolo.jpg", quote: "This photographer knows what I want in car photography. Stunning clarity in motion from the right angles. Also willing to suggest places based on the subject to achieve the best match. Trust him to tell you where to shoot." },
  { name: "Andrew Wong", context: "Cars and Coffee Malaysia", photo: "andrew_wong.jpeg", quote: "Andrian is a very dedicated and focused professional photographer. If you task this man on a mission, rest assured he accomplishes it beyond your ordinary expectations." },
  { name: "Tyler Yap", context: "Automotive photography", photo: "tyler.jpg", quote: "Pictures were sharp, angles and backgrounds were amazing. Quality is consistent and the resolution was amazing. I finally have amazing rolling shots of my car in Sepang." },
  { name: "Andrea Tommy Jok", context: "Graduation shoot", photo: "andrea.jpg", quote: "Super kind and understanding of my situation. Great in guiding and executing the style of shoot that I was going for, and super open about shooting locations." },
  { name: "Ken Lim", context: "Freelance collaboration", photo: "ken_lim.jpg", quote: "Very professional photographer, he can fulfil all my requirements. Unique angles, nice colour tone. Highly recommended." },
  { name: "YY Yap", context: "Surprise proposal", photo: "yy.jpg", quote: "He managed to squeeze in my big day of proposal at very short notice. The photos made good memories for us." },
  { name: "Rakesh Kahan", context: "Automotive photography", photo: "rakesh.jpg", quote: "Very high resolution and sharp pictures, every picture was in focus, and the angles were on point. Definitely recommended for car photoshoots." },
  { name: "Ng Hoi Yew", context: "Automotive photography", photo: "ng_hoi_yew.jpg", quote: "Super sharp, high res, high quality. The angle was perfect and you can feel the motion." },
  { name: "Dnesh Jothiahnantham", context: "Automotive photography", photo: "dnesh.jpg", quote: "The photos were perfect: crisp, clear and super high resolution. I would definitely recommend them for car shoots." },
  { name: "Azlan", context: "Automotive photography", photo: "azlan.jpg", quote: "Very sharp, with emotion captured. There's a story frozen in time." },
  { name: "M Fairuz B Rosli", context: "SES Dynamics Track Day 2024", photo: "fairuz.jpg", quote: "The shots were a masterpiece. The way it was organised was priceless." },
];

// Answers written from facts on the site. Shown on the photography page and marked up as FAQPage.
export const FAQ: { q: string; a: string }[] = [
  {
    q: "Is andriantam taking photography bookings?",
    a: "Not regular jobs for now. Photography started as a hobby and became a business, and Andrian stepped back from client work to keep it a passion. He is still open to creative projects, and happy to talk photography over coffee: email andriantamwj@gmail.com.",
  },
  {
    q: "What kind of photography did andriantam do?",
    a: "Automotive and motorsport (rolling shots, track days, car launches), corporate and brand events, weddings and couples, products, and food. He also shoots film in 35mm and medium format.",
  },
  {
    q: "Where is andriantam based?",
    a: "Singapore. He photographed across Malaysia, and in Singapore, Australia and around Southeast Asia.",
  },
  {
    q: "Does Andrian shoot on film?",
    a: "Yes. He shoots 35mm and medium format film, and has shot weddings on film.",
  },
];

export const VIDEOS = [
  { id: "oWwDPp2DEF4", title: "Motul Awesome Racing Team at Sepang Circuit 1000KM 2024", client: "MR Lubricant Sdn Bhd" },
  { id: "HsjUOL-zKVI", title: "Oversteer Movie Malaysia exclusive car gathering, meet and greet", client: "andriantam" },
  { id: "3Gkq9NFsofQ", title: "What is the car scene like in Sydney and NSW?", client: "andriantam" },
];

export const REELS = [
  "https://www.instagram.com/p/DAncNeGSL6M/",
  "https://www.instagram.com/p/DAXfGWFyb3M/",
  "https://www.instagram.com/p/C-XjDedSN2s/",
];

// Albums featured on the home page, by Flickr album title. Change freely.
export const FEATURED_ALBUMS = [
  "Fanatec GT World Challenge",
  "Tokyo Auto Salon KL 2024",
  "Voon Hoe & Melissa",
  "Gumball 3000 Kuala Lumpur",
  "Solarvest iGEM 2024",
  "Volvo EX30 Media Drive",
];
