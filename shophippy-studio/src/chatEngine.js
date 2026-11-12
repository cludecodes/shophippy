// Sara's conversation engine — local, context-aware reply brain.
// No network calls: everything stays in the visitor's browser.

const TIME_GREETING = () => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

const SERVICES = 'web applications, SaaS platforms, Android apps, UI/UX design, Cloud & DevOps, and AI integrations'
const RESPONSE_PROMISE = 'the team replies to quote requests within 24 business hours'

const PROJECT_PATTERNS = [
  { key: 'online store', re: /\b(e-?commerce|online store|online shop|shopify|dropship|sell(ing)? (my )?(products?|stuff) online)\b/i },
  { key: 'SaaS platform', re: /\b(saas|platform|dashboard|admin panel|subscription (app|service)|multi-?tenant)\b/i },
  { key: 'mobile app', re: /\b(mobile app|android|ios|iphone|play store|app store|cross-?platform app)\b/i },
  { key: 'web app', re: /\b(web app|web application|marketplace|booking (system|app)|crm|erp|portal|internal tool)\b/i },
  { key: 'AI integration', re: /\b(ai|chatbot|gpt|llm|machine learning|automation|automate)\b/i },
  { key: 'website', re: /\b(website|web ?site|landing page|company site|portfolio site|one-?pager)\b/i },
  { key: 'UI/UX design', re: /\b(ui|ux|design|figma|branding|wireframe|prototype)\b/i },
  { key: 'redesign or migration', re: /\b(redesign|rebuild|refactor|migrate|migration|wordpress|wix|squarespace|legacy|outdated)\b/i },
]

const REPLY_POOLS = {
  greeting: [
    () => `${TIME_GREETING()}! I'm Sara, Shophippy's virtual project guide. What are you hoping to build?`,
    () => `${TIME_GREETING()}! Great to see you. Are you exploring services, timelines, or ready for a quote?`,
    () => `Hey there! I can walk you through services, process, or pricing — or jump straight to the quote form. What brings you here?`,
  ],
  services: [
    (c) => `Shophippy covers ${SERVICES}.${c.project ? ` For something like your ${c.project}, they'd usually start with a short scoping call.` : ''} Which of those is closest to your idea?`,
    (c) => `They build ${SERVICES} — from a first version to full launch.${c.project ? ` Your ${c.project} fits right in that list.` : ''} Want a rough idea of timelines or budget?`,
    () => `Think of them as a full software studio: ${SERVICES}. Tell me a little about your idea and I'll point you to the right next step.`,
  ],
  pricing: [
    (c) => `Planning ranges run from under $150 up to $1,200–$2,000+ (approx. PKR equivalents at PKR 276.95 per USD, rate checked Nov 11, 2026). The final quote depends on scope${c.project ? ` — for your ${c.project}, the quote form captures exactly what's needed` : ''}. Want me to take you to the quote form?`,
    (c) => `It depends on scope, but planning ranges go from under $150 up to $1,200–$2,000+. Share the details in the free quote form and ${RESPONSE_PROMISE}. Sound good?`,
    () => `Budgets vary a lot by scope. The quote form lists the same ranges the team plans with (USD or PKR), and you'll get a proper estimate within 24 business hours. Shall I open it for you?`,
  ],
  timeline: [
    (c) => `Timelines depend on scope — a focused landing page can take days, while something like your ${c.project || 'platform'} usually takes weeks. The team shares progress every week, and the quote form includes timeline options so you can set expectations upfront.`,
    () => `They don't guess timelines without scope, but the quote form asks for your preferred timeline and ${RESPONSE_PROMISE}. You'll get weekly progress updates once work starts.`,
    () => `Honestly? It depends on what you're building. That said, work runs on weekly updates, and the quote form has timeline options — pick what suits you and the team will confirm what's realistic.`,
  ],
  process: [
    () => `The flow is simple: share your project scope, design direction, and timeline in the quote form → the team responds within 24 business hours → kickoff, then design and development with progress shared every week until launch.`,
    () => `Kickoff → weekly-updated design and development → launch. Nothing hidden, no surprise phases. The quote form is step one if you'd like to start.`,
    () => `You bring the idea and constraints, they handle discovery, design, build, and launch — with a progress update every week. Want to start with the quote form?`,
  ],
  portfolio: [
    () => `Recent highlights: a subscription analytics suite, a doctor and clinic booking app, and a headless storefront rebuild. Which is closest to what you have in mind?`,
    () => `The portfolio includes a subscription analytics suite, a clinic booking app, and a headless storefront rebuild. Any of those in the same family as your project?`,
  ],
  stack: [
    () => `They choose the stack per project rather than forcing one — modern web frameworks for apps, native/cross-platform for Android, plus cloud and DevOps tooling on the backend. What matters more to you: speed to launch or a specific technology?`,
    () => `No single fixed stack — they pick tools that fit the project (web frameworks, Android, cloud/DevOps, AI integrations). If you need a specific technology, mention it in the quote form and they'll plan around it.`,
  ],
  payments: [
    () => `Payment details (schedule, methods, invoicing) are confirmed directly with the team when your quote is accepted — I don't handle billing. The quote form is the fastest way to get that conversation started.`,
    () => `Billing is arranged with the team once your quote is finalized. I stay out of payment details, but the quote form kicks off that conversation within 24 business hours.`,
  ],
  revisions: [
    () => `Changes and iterations are a normal part of the weekly-update process — you review progress as it happens and request adjustments along the way. Scope changes are discussed openly rather than sprung on you.`,
    () => `They build in feedback loops: you see progress weekly and can request changes as work advances. Big scope shifts get discussed before they happen. What kind of change are you thinking about?`,
  ],
  security: [
    () => `Everything you share goes straight to the team — nothing is published or shared. If you need an NDA signed before discussing details, mention it in the quote form and they'll arrange it.`,
    () => `Your project details stay between you and the team. NDAs are welcome — note it in the quote form and they'll sort it before deeper discussions.`,
  ],
  meeting: [
    () => `I'm the virtual guide, so I can't join calls myself — but share your project in the quote form and the team will set up a call to talk it through. They respond within 24 business hours.`,
    () => `Calls are arranged by the team after you submit the quote form — it captures everything they need to prep for a useful conversation. Want me to open it?`,
  ],
  location: [
    () => `Shophippy is proudly based in Pakistan and serves clients worldwide — remote-friendly across time zones.`,
    () => `Based in Pakistan, working with clients around the world. Where are you joining from?`,
  ],
  maintenance: [
    () => `Yes — support and maintenance for existing projects are covered: redesigns, new features, bug fixes, and migrations. Tell me what you currently have and what you'd like to change.`,
    () => `They take on existing codebases too — maintenance, new features, redesigns, migrations. What's the current state of your project?`,
  ],
  human: [
    () => `I'm Sara, the studio's virtual project guide — not a live person. But everything you share through the quote form reaches the real team, and ${RESPONSE_PROMISE}. I can also answer questions about services, pricing, or process meanwhile.`,
    () => `No humans behind this chat — just me, Sara, keeping things quick. For a real conversation, use the quote form and the team will follow up within 24 business hours. Want me to open it?`,
  ],
  identity: [
    () => `I'm Sara — a virtual project guide for Shophippy, not an AI model pretending otherwise and not a live agent. I keep answers quick and point you to the quote form when you're ready.`,
    () => `Sara here — virtual guide, fully local to this page (your messages never leave the browser). Ask me about services, process, pricing, or portfolios.`,
  ],
  thanks: [
    (c) => `You're very welcome${c.name ? `, ${c.name}` : ''}! Anything else I can help with?`,
    (c) => `Happy to help${c.name ? `, ${c.name}` : ''}! If you're ready, the quote form takes about two minutes.`,
    () => `Anytime! Ping me whenever you have another question.`,
  ],
  bye: [
    (c) => `Thanks for stopping by${c.name ? `, ${c.name}` : ''} — good luck with the project, and the quote form is here whenever you're ready.`,
    () => `See you around! The team's quote form stays one click away.`,
    () => `Take care! Come back anytime — I don't sleep.`,
  ],
  acknowledgeProject: [
    (c) => `Got it — ${c.project}. Do you already have designs or an existing codebase, or is this from scratch?`,
    (c) => `Nice — ${c.project}. Roughly what's your budget and timeline looking like? The quote form turns those into a proper estimate.`,
    (c) => `Noted — ${c.project}. What's the single most important thing it should do for you?`,
  ],
  fallback: [
    (c) => `I don't want to guess about that one. I'm solid on ${SERVICES}, pricing ranges, timelines, and the process — or,${c.project ? ` about your ${c.project},` : ''} what would you like to dig into?`,
    (c) => `That's a bit outside my lane, honestly. I can help with services, budgets, timelines, the process, or examples of past work${c.project ? ` — or more about your ${c.project}` : ''}. Which one?`,
    () => `Hmm, I'd rather not make something up. Try me on services, pricing, process, timelines, or their portfolio — or use the quote form for anything the team should answer directly.`,
  ],
}

function detectProject(text) {
  for (const { key, re } of PROJECT_PATTERNS) {
    if (re.test(text)) return key
  }
  return null
}

function matches(text, patterns) {
  return patterns.some((p) => p.test(text))
}

export function createSaraEngine() {
  const memory = {
    name: null,
    project: null,
    askedIntro: false,
    poolIndex: {},
    lastIntent: null,
    visitorMessages: 0,
  }

  const pick = (key, context) => {
    const pool = REPLY_POOLS[key]
    const index = memory.poolIndex[key] || 0
    memory.poolIndex[key] = (index + 1) % pool.length
    return pool[index](context)
  }

  const context = () => ({ name: memory.name, project: memory.project })

  return function reply(message) {
    const text = message.trim()
    const lower = text.toLowerCase()
    memory.visitorMessages++

    // Capture the visitor's name.
    const nameMatch = lower.match(/\b(?:my name is|i am|i'?m|call me|this is)\s+([a-z][a-z'’-]{1,30})\b/i)
    let capturedName = null
    if (nameMatch && !['interested', 'looking', 'trying', 'wondering', 'building', 'planning', 'here'].includes(nameMatch[1])) {
      capturedName = nameMatch[1][0].toUpperCase() + nameMatch[1].slice(1)
      if (!memory.name) memory.name = capturedName
    }

    // Track what they want to build.
    const newProject = detectProject(lower)
    if (newProject && newProject !== memory.project) {
      memory.project = newProject
      memory.askedIntro = false
    }

    const c = context()
    const namePrefix = capturedName && memory.name === capturedName ? `${TIME_GREETING()}, ${memory.name}! ` : ''

    // Farewells and thanks come first so "thanks, bye" doesn't hit deeper intents.
    if (/\b(bye|goodbye|see ya|see you|later|good ?night|take care)\b/.test(lower)) {
      memory.lastIntent = 'bye'
      return namePrefix + pick('bye', c)
    }
    if (/\b(thanks|thank you|thx|appreciate it|that helps|helpful)\b/.test(lower)) {
      memory.lastIntent = 'thanks'
      return namePrefix + pick('thanks', c)
    }
    if (/\b(human|real person|live agent|actual person|speak to (someone|a human|your team)|talk to (someone|a human|your team)|team member|is anyone (there|real))\b/.test(lower)) {
      memory.lastIntent = 'human'
      return namePrefix + pick('human', c)
    }
    if (/\b(who are you|your name|what are you|are you (a )?(bot|robot|ai|real|human|person)|are you real)\b/.test(lower)) {
      memory.lastIntent = 'identity'
      return namePrefix + pick('identity', c)
    }

    // A brand-new project mention deserves acknowledgment before generic greetings:
    // "hi, I want an online store" should get a reply about the store, not "what are you building?"
    if (newProject) {
      memory.lastIntent = 'project'
      const warmPrefix = memory.visitorMessages <= 2 && !capturedName ? `${TIME_GREETING()}! ` : ''
      return warmPrefix + namePrefix + pick('acknowledgeProject', c)
    }

    // A fresh self-introduction with nothing else in the message.
    if (capturedName) {
      memory.lastIntent = 'name'
      return `Nice to meet you, ${memory.name}! ${memory.project ? `So — your ${memory.project}: designs ready, or starting from scratch?` : 'So, what are you hoping to build?'}`
    }

    // Greetings — friendlier mid-conversation if we already know them.
    if (/\b(hi|hello|hey|hiya|salaam|salam|good morning|good afternoon|good evening|yo)\b/.test(lower) && text.length < 60) {
      memory.lastIntent = 'greeting'
      if (memory.name && !capturedName) {
        return `Hey ${memory.name}! Where were we — services, pricing, or your ${memory.project || 'project'}?`
      }
      return namePrefix + pick('greeting', c)
    }

    if (/\b(how are you|how's it going|how is it going|whats up|what's up|what do you do for fun)\b/.test(lower)) {
      memory.lastIntent = 'greeting'
      return `I'm doing great, thanks for asking${memory.name ? `, ${memory.name}` : ''} — ready to talk shop whenever you are. ${memory.project ? `So, your ${memory.project}: what stage is it at?` : 'What are you planning to build?'}`
    }

    if (/\b(price|pricing|cost|how much|budget|quote|rates?|charge|expensive|cheap|afford|usd|pkr|rupees?|dollars?)\b/.test(lower)) {
      memory.lastIntent = 'pricing'
      return namePrefix + pick('pricing', c)
    }
    if (/\b(how long|timeline|deadline|how fast|when can|how soon|delivery time|weeks?|months?|days?)\b/.test(lower)) {
      memory.lastIntent = 'timeline'
      return namePrefix + pick('timeline', c)
    }
    if (/\b(process|how does it work|how do (you|we|things) (work|start|go)|workflow|steps|kickoff|get started|how to start|where do (we|i) start)\b/.test(lower)) {
      memory.lastIntent = 'process'
      return namePrefix + pick('process', c)
    }
    if (/\b(what (do|can) you (do|offer|build)|services?|service|offer|build|develop|make|website|web app|mobile|android|design|cloud|devops|ai|integration|develop)\b/.test(lower)) {
      memory.lastIntent = 'services'
      return namePrefix + pick('services', c)
    }
    if (/\b(portfolio|examples?|case stud|past (work|projects?)|previous (work|projects?)|have you built|samples?)\b/.test(lower)) {
      memory.lastIntent = 'portfolio'
      return namePrefix + pick('portfolio', c)
    }
    if (/\b(stack|technolog|framework|react|node|python|flutter|tools|which language|programming)\b/.test(lower)) {
      memory.lastIntent = 'stack'
      return namePrefix + pick('stack', c)
    }
    if (/\b(pay|payment|invoice|billing|methods? of payment|deposit|upfront|installments?|milestone)\b/.test(lower)) {
      memory.lastIntent = 'payments'
      return namePrefix + pick('payments', c)
    }
    if (/\b(revision|revisions|changes?|rework|redo|iterate|feedback|unhappy|not happy|fix it)\b/.test(lower)) {
      memory.lastIntent = 'revisions'
      return namePrefix + pick('revisions', c)
    }
    if (/\b(nda|privacy|private|confidential|secure|security|data safe|intellectual property|ip rights|ownership)\b/.test(lower)) {
      memory.lastIntent = 'security'
      return namePrefix + pick('security', c)
    }
    if (/\b(call|meeting|meet|zoom|google meet|schedule|appointment|demo|discover call|consultation)\b/.test(lower)) {
      memory.lastIntent = 'meeting'
      return namePrefix + pick('meeting', c)
    }
    if (/\b(where|located|location|based|country|pakistan|karachi|remote|worldwide|international|time ?zone)\b/.test(lower)) {
      memory.lastIntent = 'location'
      return namePrefix + pick('location', c)
    }
    if (/\b(maintenance|support|bug|bugs|existing|current (site|app|project)|codebase|redesign|migrate|migration|update my|add features?)\b/.test(lower)) {
      memory.lastIntent = 'maintenance'
      return namePrefix + pick('maintenance', c)
    }

    // Short agreements/disagreements — respond in context of what was last discussed.
    if (/\b(yes|yeah|yep|sure|ok(ay)?|sounds good|alright|definitely|absolutely)\b/.test(lower) && text.length < 25) {
      memory.lastIntent = 'acknowledge'
      if (memory.project) {
        return `Great! The quote form captures everything about your ${memory.project} — scope, design direction, timeline. Want me to open it?`
      }
      return `Great! Tell me a bit about what you're building and I'll point you the right way.`
    }
    if (/\b(no|nope|not now|not really|nah|maybe later)\b/.test(lower) && text.length < 25) {
      memory.lastIntent = 'acknowledge'
      return `No problem at all. I'm here if you change your mind — or if you just want to talk through the idea first.`
    }

    // A new project mention with no other intent: acknowledge it warmly.
    if (newProject) {
      memory.lastIntent = 'project'
      return namePrefix + pick('acknowledgeProject', c)
    }

    // Vague short messages — nudge the conversation forward.
    if (text.length < 12 && !memory.project) {
      memory.lastIntent = 'fallback'
      return `Could you tell me a little more? Even one line about what you want to build helps a lot.`
    }

    memory.lastIntent = 'fallback'
    return namePrefix + pick('fallback', c)
  }
}