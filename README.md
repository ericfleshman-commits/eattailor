# EatTailor

An AI nutrition coach you talk to instead of a database you search. Built December 2025, rebuilt July 2026 with an overnight AI agent pipeline.

**Live demo:** https://erics-mac-mini.tail6938d5.ts.net (yes, it runs on a Mac mini in my apartment)

## The idea

Nutrition apps make you do the work: scan barcodes, search databases, guess serving sizes. EatTailor flips it. You say "had two slices of Costco pepperoni pizza" and the app logs it, estimates macros, and updates your day. Guidance over tracking.

## What it does

- **Conversational logging.** Natural language in, structured meal data out. No barcodes, no database search.
- **Structured tool loop.** The model does not free-text guess into the UI. It calls typed tools (log_meal, delete_meal, suggest_meal, answer_question) and the server is the single writer to the database. The client renders state; it never parses AI prose with regexes. (v1 did. It was a mistake. See below.)
- **Training-aware coaching.** Strava integration feeds workout context into every chat turn, so advice accounts for what you actually did today. Currently dormant in production; workouts can be logged by typing them.
- **Proactive briefs.** A 6am morning brief and evening close-out, generated server-side on a schedule. Built, tested, and switched off by config, because it turns out I do not want my nutrition app texting me at 6am. The feature exists; the off switch is the product decision.

## Stack

- Vanilla JS PWA frontend, no framework
- Node.js / Express backend
- OpenAI API (structured tool calls, not prose parsing)
- Firebase Auth (Google sign-in) + Firestore, per-user security rules
- Strava OAuth + webhook (dormant)
- Hosted on a Mac mini behind a Tailscale Funnel. Hosting cost: zero dollars.

## The rebuild story

The December 2025 version worked as a demo but had a classic LLM app flaw: the AI answered in prose and the client scraped macros out of it with three different regexes. Deleting a meal relied on the model emitting a magic `[DELETE:...]` marker. It worked until it did not.

The July 2026 rebuild ran as scoped overnight sprints executed by AI coding agents, with each sprint reviewed against the actual diff before the next one fired. Sprint reviews caught real failures the agents reported as done: a scheduler that was written but never wired into the server, client regexes that were supposed to be deleted and were not, a dual-writer race between client and server. Each got a targeted fix sprint and a re-review.

Net result: app.js shrank from 3,014 to about 2,500 lines while gaining features, the server became the only writer, and the chat core became a 215-line module with its own test suite.

## Honest limitations

- Macro estimates are LLM estimates with sanity checks, not a lab. Good enough to steer a week of eating, not for clinical use.
- Two users in production. This is a portfolio piece and a personal tool, not a startup.
- Strava sync is wired but off (their API program now requires a paid subscription I no longer keep).

## Running it

```
npm install
cp .env.example .env   # add your own keys
node server.js
```

Requires a Firebase project (Auth + Firestore), an OpenAI API key, and optionally Strava API credentials.
