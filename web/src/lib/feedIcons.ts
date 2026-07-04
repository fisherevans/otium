// Feed icon registry (#45, expanded #72). A feed's `icon` field stores a stable
// *key* (e.g. "comedy"); this maps that key to a Lucide glyph. Lucide is MIT and
// tree-shakeable, so only the icons imported here ship - no icon font, no CDN.
//
// The set is intentionally broad so a feed can pick something close to its topic
// without a bespoke asset. Locality/region gets extra coverage (Fisher's key
// example - "an icon per state") using the closest lucide place glyphs; literal
// per-state silhouettes are a custom-SVG art task and out of scope here. Where
// Lucide has no exact match we use the closest clean single-ink glyph. Icons
// render at currentColor so they inherit the card's ink - never a color fill.
//
// Keys are stable: existing feeds store them, so rename/remove is a migration.
// Add freely; only reuse a glyph across keys when the topics truly overlap.
//
// This module is deliberately pure TS: it exports component *references* and a
// lookup, and the .tsx consumers do the rendering (keeps the registry importable
// from anywhere without pulling JSX into a .ts file).

import {
  // place / region / locality
  MapPin,
  Map,
  Navigation,
  Compass,
  Globe,
  Flag,
  Home,
  Building2,
  Landmark,
  Church,
  Mountain,
  TreePine,
  Trees,
  Waves,
  Anchor,
  Tent,
  // news / civics / society
  Newspaper,
  Vote,
  Gavel,
  Scale,
  Shield,
  Megaphone,
  Users,
  Handshake,
  Baby,
  GraduationCap,
  // tech / science / data
  Terminal,
  Cpu,
  Smartphone,
  Bot,
  BrainCircuit,
  Database,
  Lock,
  ShieldCheck,
  Atom,
  FlaskConical,
  Dna,
  Microscope,
  Telescope,
  Calculator,
  Sigma,
  BarChart3,
  LineChart,
  Zap,
  Rocket,
  Moon,
  Star,
  // money
  Briefcase,
  TrendingUp,
  DollarSign,
  Wallet,
  PiggyBank,
  Bitcoin,
  ShoppingBag,
  // arts / media / words
  Music,
  Guitar,
  Mic,
  Podcast,
  Radio,
  Clapperboard,
  Video,
  Tv,
  Camera,
  Palette,
  Type,
  PenTool,
  Feather,
  Quote,
  BookOpen,
  Library,
  Languages,
  Drama,
  // food / drink
  Utensils,
  UtensilsCrossed,
  ChefHat,
  Coffee,
  Beer,
  Wine,
  Cookie,
  // making / home / craft
  Hammer,
  Wrench,
  Axe,
  Scissors,
  Tractor,
  Sprout,
  Flower2,
  Leaf,
  Recycle,
  // health / body / mind
  HeartPulse,
  Stethoscope,
  Brain,
  Dumbbell,
  Footprints,
  // play / hobbies / sport
  Gamepad2,
  Dices,
  Trophy,
  Bike,
  Disc,
  // travel / motion
  Plane,
  Car,
  Train,
  Bus,
  Ship,
  Sailboat,
  // nature / animals / weather
  PawPrint,
  Dog,
  Cat,
  Bird,
  Fish,
  Sun,
  Cloud,
  CloudSun,
  // generic
  Rss,
  type LucideIcon,
} from "lucide-react";

export interface FeedIconDef {
  key: string; // stored in feeds.icon
  label: string; // shown in the picker + used for search
  Icon: LucideIcon;
}

// Order here is the picker's grid order, grouped by theme so scanning is easy.
// Category keys first, generic default last. `label` doubles as the search term,
// so keep it descriptive (multiple words help the search hit).
export const FEED_ICONS: FeedIconDef[] = [
  // --- locality / region / place (#72) ---
  { key: "local", label: "Local / region", Icon: MapPin },
  { key: "region", label: "Region / state / map", Icon: Map },
  { key: "city", label: "City / metro", Icon: Building2 },
  { key: "neighborhood", label: "Neighborhood / home town", Icon: Home },
  { key: "civic", label: "Civic / landmark / capitol", Icon: Landmark },
  { key: "directions", label: "Directions / navigation", Icon: Navigation },
  { key: "compass", label: "Compass / bearings", Icon: Compass },
  { key: "world", label: "World / global", Icon: Globe },
  { key: "country", label: "Country / flag", Icon: Flag },
  { key: "coast", label: "Coast / lake / shore", Icon: Waves },
  { key: "harbor", label: "Harbor / port", Icon: Anchor },
  { key: "mountains", label: "Mountains / highlands", Icon: Mountain },
  { key: "forest", label: "Forest / pines", Icon: TreePine },
  { key: "parks", label: "Parks / trees", Icon: Trees },

  // --- news / society / civics ---
  { key: "news", label: "News", Icon: Newspaper },
  { key: "politics", label: "Politics / elections", Icon: Vote },
  { key: "law", label: "Law / justice", Icon: Scale },
  { key: "courts", label: "Courts / legal", Icon: Gavel },
  { key: "security", label: "Security / defense", Icon: Shield },
  { key: "opinion", label: "Opinion / commentary", Icon: Megaphone },
  { key: "community", label: "Community / people", Icon: Users },
  { key: "policy", label: "Policy / diplomacy", Icon: Handshake },
  { key: "parenting", label: "Parenting / family / kids", Icon: Baby },
  { key: "education", label: "Education / learning", Icon: GraduationCap },
  { key: "faith", label: "Faith / religion", Icon: Church },

  // --- tech / science / data ---
  { key: "dev", label: "Dev / code / programming", Icon: Terminal },
  { key: "tech", label: "Tech / hardware", Icon: Cpu },
  { key: "mobile", label: "Mobile / gadgets", Icon: Smartphone },
  { key: "ai", label: "AI / machine learning", Icon: Bot },
  { key: "neural", label: "Neural nets / deep learning", Icon: BrainCircuit },
  { key: "data", label: "Data / databases", Icon: Database },
  { key: "privacy", label: "Privacy / encryption", Icon: Lock },
  { key: "cybersec", label: "Cybersecurity", Icon: ShieldCheck },
  { key: "science", label: "Science / physics", Icon: Atom },
  { key: "chemistry", label: "Chemistry / lab", Icon: FlaskConical },
  { key: "biology", label: "Biology / genetics", Icon: Dna },
  { key: "medicine-sci", label: "Microbiology / research", Icon: Microscope },
  { key: "astronomy", label: "Astronomy / telescope", Icon: Telescope },
  { key: "math", label: "Math / calculation", Icon: Calculator },
  { key: "stats", label: "Statistics / formulas", Icon: Sigma },
  { key: "charts", label: "Charts / analytics", Icon: BarChart3 },
  { key: "energy", label: "Energy / power", Icon: Zap },
  { key: "space", label: "Space / rockets", Icon: Rocket },
  { key: "astro-night", label: "Night sky / moon", Icon: Moon },
  { key: "stars", label: "Stars / cosmos", Icon: Star },

  // --- money / business ---
  { key: "business", label: "Business", Icon: Briefcase },
  { key: "markets", label: "Markets / trading", Icon: LineChart },
  { key: "growth", label: "Growth / startups", Icon: TrendingUp },
  { key: "finance", label: "Finance / money", Icon: DollarSign },
  { key: "personal-finance", label: "Personal finance / wallet", Icon: Wallet },
  { key: "savings", label: "Savings / investing", Icon: PiggyBank },
  { key: "crypto", label: "Crypto / bitcoin", Icon: Bitcoin },
  { key: "shopping", label: "Shopping / retail / deals", Icon: ShoppingBag },

  // --- arts / media / words ---
  { key: "music", label: "Music", Icon: Music },
  { key: "guitar", label: "Guitar / instruments", Icon: Guitar },
  { key: "podcast", label: "Podcast / audio", Icon: Mic },
  { key: "podcasts", label: "Podcasts (feed)", Icon: Podcast },
  { key: "radio", label: "Radio / broadcast", Icon: Radio },
  { key: "film", label: "Film / cinema", Icon: Clapperboard },
  { key: "video", label: "Video / YouTube", Icon: Video },
  { key: "tv", label: "TV / streaming", Icon: Tv },
  { key: "photography", label: "Photography", Icon: Camera },
  { key: "art", label: "Art / design", Icon: Palette },
  { key: "typography", label: "Typography / type", Icon: Type },
  { key: "writing", label: "Writing", Icon: PenTool },
  { key: "poetry", label: "Poetry / prose", Icon: Feather },
  { key: "quotes", label: "Quotes", Icon: Quote },
  { key: "reading", label: "Reading / essays", Icon: BookOpen },
  { key: "books", label: "Books / library", Icon: Library },
  { key: "language", label: "Languages / translation", Icon: Languages },
  { key: "comedy", label: "Comedy", Icon: Drama },

  // --- food / drink ---
  { key: "food", label: "Food / cooking", Icon: Utensils },
  { key: "restaurants", label: "Restaurants / dining", Icon: UtensilsCrossed },
  { key: "recipes", label: "Recipes / chef", Icon: ChefHat },
  { key: "coffee", label: "Coffee / cafe", Icon: Coffee },
  { key: "beer", label: "Beer / brewing", Icon: Beer },
  { key: "wine", label: "Wine", Icon: Wine },
  { key: "baking", label: "Baking / sweets", Icon: Cookie },

  // --- making / home / craft / garden ---
  { key: "making", label: "Making / DIY", Icon: Hammer },
  { key: "repair", label: "Repair / tools", Icon: Wrench },
  { key: "woodworking", label: "Woodworking", Icon: Axe },
  { key: "crafts", label: "Crafts / sewing", Icon: Scissors },
  { key: "farming", label: "Farming / agriculture", Icon: Tractor },
  { key: "garden", label: "Garden / growing", Icon: Sprout },
  { key: "flowers", label: "Flowers / plants", Icon: Flower2 },
  { key: "environment", label: "Environment / climate", Icon: Leaf },
  { key: "sustainability", label: "Sustainability / recycling", Icon: Recycle },

  // --- health / body / mind ---
  { key: "health", label: "Health / fitness", Icon: HeartPulse },
  { key: "medicine", label: "Medicine / clinical", Icon: Stethoscope },
  { key: "psychology", label: "Psychology / mind", Icon: Brain },
  { key: "fitness", label: "Fitness / gym", Icon: Dumbbell },
  { key: "running", label: "Running / walking", Icon: Footprints },

  // --- play / hobbies / sport ---
  { key: "games", label: "Games / gaming", Icon: Gamepad2 },
  { key: "boardgames", label: "Board games / tabletop", Icon: Dices },
  { key: "sports", label: "Sports", Icon: Trophy },
  { key: "cycling", label: "Cycling / bikes", Icon: Bike },
  { key: "disc-golf", label: "Disc golf", Icon: Disc },

  // --- travel / motion ---
  { key: "travel", label: "Travel / flights", Icon: Plane },
  { key: "cars", label: "Cars / automotive", Icon: Car },
  { key: "trains", label: "Trains / rail", Icon: Train },
  { key: "transit", label: "Transit / buses", Icon: Bus },
  { key: "boating", label: "Boating / ships", Icon: Ship },
  { key: "sailing", label: "Sailing", Icon: Sailboat },
  { key: "camping", label: "Camping / outdoors", Icon: Tent },
  { key: "outdoors", label: "Outdoors / hiking", Icon: Mountain },

  // --- nature / animals / weather ---
  { key: "nature", label: "Nature / animals", Icon: PawPrint },
  { key: "dogs", label: "Dogs", Icon: Dog },
  { key: "cats", label: "Cats", Icon: Cat },
  { key: "birds", label: "Birds / birding", Icon: Bird },
  { key: "fishing", label: "Fishing / fish", Icon: Fish },
  { key: "weather", label: "Weather / forecast", Icon: CloudSun },
  { key: "sky", label: "Sky / clouds", Icon: Cloud },
  { key: "sun", label: "Sun / summer", Icon: Sun },
  { key: "history", label: "History", Icon: Landmark },

  // --- generic ---
  { key: "default", label: "Generic feed", Icon: Rss },
];

const BY_KEY: Record<string, LucideIcon> = Object.fromEntries(FEED_ICONS.map((d) => [d.key, d.Icon]));

// feedIcon resolves a stored key to its Lucide component, or null when the key
// is unset/unknown (the caller then falls back to the feed's color swatch).
export function feedIcon(key?: string | null): LucideIcon | null {
  if (!key) return null;
  return BY_KEY[key] ?? null;
}
