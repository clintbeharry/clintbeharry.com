// Portfolio content — edit everything here.
//
// Each project is one { } block in the PROJECTS array. Fields:
//   uid        PERMANENT key used to derive each project's image-slot ids.
//              Set it once and NEVER change it — dropped images are saved
//              against it. You can freely rename `id`, `title`, etc.
//   id         internal key — drives the #anchor (unique, no spaces)
//   num        the big index label ("01")
//   categories ["product"] — drives the section filter
//   title      project name (the big heading)
//   year       e.g. "2025"  (leave "" to hide)
//   tags       little chips, e.g. ["Product Design", "AI", "0→1"]
//   desc       one-line summary under the title
//   problem / process / impact   the write-up shown under each section's image
//
// Tip: to add a project, copy a whole { } block, paste it as a new array
// item, and change the id + fields. Empty strings just render blank.

window.PROJECTS = [
  {
    id: "meta-genai",
    uid: "meta-genai",
    role: "Meta Reality Labs, Staff Product Designer & Prototyper",
    num: "01",
    categories: ["product"],
    title: "Generative AI Characters for Meta",
    year: "2025",
    tags: ["Product Design", "AI", "0\u21921"],
    desc: "I turned complex character creation into a simple AI conversation for the world's largest social platform, but the breakthrough was aligning leadership & engineering.",
    problem: "Meta's character creation tool worked like a traditional game engine: model it, rig it, animate it, then manually wire it into the scene and code. **It was built for technical artists, not the mainstream audience Meta wanted AI to reach.** Leadership wanted a bold AI-native replacement, engineering doubted the data could support it, and users had their own mental model entirely. No one was aligned.",
    process: "As the new design lead, I had to pull the team together. I ran competitive analysis and user research to understand how people expected to build a character, and what types of characters they wanted to create.\n\nThen I worked with engineering to map what our training data could actually support by character type. **That mapping was what leadership had been missing: a clear picture of what was possible now versus later.**\n\nI brought it to the wider team and leadership myself, which got the roadmap signed off, freed up budget for more engineers and training data, and became the plan I designed the interface around.",
    solution: "We assumed speed to a full 3D character was what mattered, but we were wrong. **Users wanted to approve each stage: concept, model, texture, then animation, rather than commit to one long generation.** So I designed a branching, step-by-step conversation instead of a single prompt.\n\nAI confidence wasn't uniform across character types:\nA. Strong training data got open-ended chat so they user could create anything.\nB. Weaker trained types like quadrupeds got guided multiple-choice toward what we could reliably generate.\nC. Near-zero training meant declining gracefully instead of failing silently.\n\n**That meant three interconnected UI languages for one non-deterministic design system**, generated with AI myself and refined through taste & team crits, which pioneered the process for Meta's agentic AI interfaces going forward.",
    impact: "Six months after the impasse, we shipped. Character creation rose **430%** over the next three months, time-to-create dropped **10x**, and retention was **3x** higher. My mapping spread internally, shared organically across multiple AI orgs with thousands of staff. **Leadership learned a process to roadmap AI feature confidence against real training investment, and how to act immediately with design systems for the messy middle.**\n\nLink to Project: [Meta Horizon Worlds Desktop Editor](https://developers.meta.com/horizon-worlds/)",
  },
  {
    id: "wsj-immersed",
    uid: "wsj-immersed",
    role: "Self-Initiated, Solo Designer & Developer",
    num: "02",
    categories: ["product"],
    title: "Immersed in The Wall Street Journal",
    year: "",
    tags: ["Product Design", "Editorial"],
    desc: "A quiz designed to expand the polarized \"AI is good! AI is bad!\" debates from sweeping headlines to nuanced thinking and deep conversations about our humanity.",
    problem: "Most online debate about AI collapses into one flat argument, AI is good, AI is bad, with no room for the actual texture: **someone might welcome AI in transportation and recoil at it in art.** There was no lightweight way to locate where you actually stood across dozens of concrete use cases, or to have a real conversation about it with someone else instead of restating a headline-level opinion at them.",
    process: "I designed and built this myself, writing all 100 use cases from reading AI news daily and drawing on my past social science research background, collaborating with AI itself to surface categories and hot topics across domains like art, healthcare, and transportation. I kept scope narrow on purpose: no accounts, no AI recommendations, no debate threads, just a fast, honest read on where someone stands. I iterated hard on the rating scale, cutting emojis that turned out unreadable in the middle of the spectrum, and **orienting it as AI to Human so the real question became what it means to stay human, not how much AI you want.**",
    solution: "To make a spectrum work in just four taps, I gave the scale its own visual language: a horizontal line with four divisions, marked by a smiley emoji for you and a peace sign for a friend, which quietly forms bunny ears when your perspectives align {bunny}\n\nProgress is tracked by a bouncing, karaoke-style face that thinks while you decide 🤔 smiles when you answer 🙂 and falls asleep if you stall 😴 building to a real confetti finish, **emotionally engaging without the dark patterns competitors use.**\n\nAlpha testing changed the whole focus. People found their own profile interesting, but it was comparing with friends that sparked real conversation. So I redesigned around comparison: showing what two people agreed on before how they differed, surfacing the three questions they disagreed on most, and adding a one-tap way to paste those specific questions in a chat to continue the conversation.",
    impact: "Upon public release, the comparison mode did exactly what I'd hoped: it pulled people into deeper, more specific conversations about AI instead of the usual all-or-nothing debate, several kept talking well after they'd finished. **The bigger pattern emerging in early data is more personal \u2014 a rough shape of what people believe AI can never replace: art, love, and death.**\n\nLink to Project: https://2aiornot2.ai/\nCompare yourself: [My Profile](https://2aiornot2.ai/r/v2.1321233311032301021113222333131213020312123113222212210211021022232313103301002100223212130001011111)",
  },
  {
    id: "wonderscope",
    uid: "wonderscope",
    role: "Within XR, Founding Product Designer",
    num: "03",
    categories: ["product"],
    title: "Wonderscope",
    year: "",
    tags: ["Product Design"],
    desc: "An award-winning AR experience where kids read aloud to converse with an AI character, a reading mechanic that led to the company's acquisition.",
    problem: "Within had built one of the first VR storytelling platforms, but VR's audience was tiny. Apple's early ARKit access promised something much bigger, AR on millions of devices, if we could figure out what an interactive AR story for kids should even be. There was no playbook: no precedent for how a child should talk to a living character, and no way yet to teach a five year old to grant camera and mic permissions or set up an AR scene. **In research, we found 0% of kids could set up AR correctly in existing apps.**",
    process: "As founding product designer, I led research and design across a team spanning research, visual design, 3D art, content, and six game engineers, plus an external prototyping team and three content studio partners. Research showed the real friction: camera and mic permissions were a big ask, kids had never heard of \"AR\" but understood Pok\u00e9mon Go, and they didn't want a story narrated at them. **They wanted a character that felt alive in their home and wanted to talk back.**",
    solution: "We assumed an AR storybook playing out around a child would be enough. It wasn't: kids wanted a real back and forth. **So I designed a conversational loop instead: the character speaks, then listens,** and a child responds by reading the line on screen aloud, which AI maps to text before the story continues. The AI adapted to a wide range of reading levels and accents, technology Amira Learning later built its acquisition case around.\n\nKids also loved searching their rooms for hidden virtual objects (and parents loved watching their screen-timing kids moving around!) so we added story beats to encourage them to find items for the character to progress.\n\nTo fix the 0% setup problem, I designed onboarding as its own interactive story. A character walks a child through permissions and room scanning as part of the adventure, and lands a quadcopter in their room to match the area the story needs to play on (inspired a pizza delivery).",
    impact: "Wonderscope launched to 150K downloads and won an Apple Design Award, with coverage in Vogue, Variety, CNET, and Ad Week. **The reading-through-conversation mechanic became the product's real value, teaching kids to read rather than just entertaining them,** which is what led Amira Learning to acquire the company. The platform has since taught over a million kids to read.\n\nLink to Project: [Wonderscope joins Amira Learning](https://www.prnewswire.com/news-releases/amira-learning-acquires-withins-award-winning-childrens-reading-app-wonderscope-301636372.html)",
  },
  {
    id: "storypilot",
    uid: "storypilot",
    role: "Company, Role",
    num: "04",
    categories: ["product"],
    title: "StoryPilot",
    year: "",
    tags: ["Product Design"],
    desc: "Placeholder summary \u2014 one line on what this project was and why it mattered.",
    problem: "Placeholder problem statement \u2014 describe the challenge this project set out to solve.",
    process: "Placeholder process notes \u2014 describe the approach, research, and key decisions along the way.",
    solution: "Placeholder solution — describe what you designed and shipped in response.",
    impact: "Placeholder impact statement \u2014 describe the outcome and what changed as a result.",
  },
  {
    id: "case-study-five",
    uid: "case-study-five",
    role: "Dow Jones Innovation Lab, Lead Product Designer",
    num: "05",
    categories: ["product"],
    title: "The Wall Street Journal VR",
    year: "",
    tags: ["Product Design"],
    desc: "The Wall Street Journal's flagship experience for the launch of Google's VR platform, turning stock market data into something you could grab and explore.",
    problem: "On July 8th, 1889, The Wall Street Journal made its debut. It was published by Charles Henry Dow, Edward Davis Jones and the often overlooked Charles Bergstresser from a small office in lower Manhattan.\n\nOver 130 years later, Google needed a flagship experience to launch its new VR platform, and picked The Wall Street Journal as launch partner. WSJ needed something that read as premium journalism, not a novelty demo, and could hold up to repeat, extended use instead of a five minute curiosity visit. **That's a hard bar for VR: headsets are known for making people sick, straining their eyes, and wearing out their welcome fast,** especially with dense financial content.",
    process: "Contracted through Emblematic Group as lead designer on the engagement, I designed an experience spanning breaking news, immersive video, and a 3D stock market visualization, all built to fit within WSJ's strict brand style guide. **That constraint meant I couldn't just design one-off screens, I had to translate their 2D design system into a spatial one.**",
    solution: "VR headsets make people sick and tired fast, so I designed this as a sit down, passive experience with minimal gesture controls, letting people calmly consume content for extended periods. For reading, that meant applying WSJ's typography and color rules to 3D space: large windows positioned farther back, oversized text, and a dark, low contrast palette to keep articles comfortable to read.\n\n**The stock market visualization turned the market into a sector landscape:** 3D heights mapped to profit and loss, grabbed and rotated with spatial hand controllers, zoomed into subsectors, compared side by side, giving people a density of financial data no flat chart could match. Every material, color, and type choice across the experience came from a spatial design system I built specifically to extend WSJ's existing style guide into three dimensions, rather than one-off decisions per screen.",
    impact: "It launched at Google I/O and was covered by CNET, Fast Company, and The Verge. Once real users got in, they spent most of their time in the immersive video and the 3D stock visualization, the two things only VR could do, and the least time reading articles, confirming VR's value wasn't replicating what 2D screens already do well. **The spatial design system I built outlived the platform itself, where it's still the foundation for WSJ's spatial content and software today.**",
  },
];
