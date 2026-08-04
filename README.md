# All You Need to Know

Everything you need to know before a movie, without spoilers. Enter any movie you're about to watch and get just the context: the tone, the cast and who they play, who directed it, where it sits in a series, its content rating, where to watch it, and a spoiler-free premise. That way you can walk in ready, without pausing to ask "wait, who's that?"

## What it gives you

- **Spoiler-free premise.** The synopsis is trimmed to just the setup (the first couple of sentences). Plot turns and endings are never shown.
- **Who you'll see.** Top-billed cast with the characters they play.
- **Where it sits in a series.** For sequels and franchises, it shows the full release order and how many films come before the one you're watching.
- **Good to know.** Director, writers, genre, country, runtime, and content rating.
- **Content rating.** Shown up front so you know what you're getting into.
- **Where to watch.** Streaming, rent, and buy options for your region (powered by JustWatch via TMDB).
- **Recently briefed.** Quick access to movies you've looked up, stored locally.
- **Shareable links.** Every briefing has its own URL you can send to a friend.

By design, it does not fetch reviews, plot keywords, or the full synopsis, since those are the things that tend to leak twists.

## How it works

- 100% client-side. No server, no build step, no running costs.
- Talks directly to the free [TMDB API](https://www.themoviedb.org/) from your browser.
- Your API key is stored only in your browser's `localStorage`, so it never leaves your device.

## Setup

1. Create a free account at [themoviedb.org](https://www.themoviedb.org/signup).
2. Go to [Settings, API](https://www.themoviedb.org/settings/api) and request a key (choose "Developer", which is free and instant).
3. Copy either your **API Read Access Token (v4)** or your **API Key (v3)**.
4. Open the app, click the settings icon, paste the key, and save.

That's it. Start searching.

## Run locally

Just open `index.html` in a browser. No dependencies, nothing to install.

Or serve it (optional):

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

## Deploy with GitHub Pages

1. Push to GitHub (already done if you're reading this in the repo).
2. Go to **Settings, Pages**.
3. Under "Build and deployment", set **Source: Deploy from a branch**, branch **main**, folder **/ (root)**.
4. Save. Your app will be live at `https://<username>.github.io/spoiler-free-movie-briefing/`.

## Roadmap

- Optional AI layer for richer written "what you need to know going in" primers (would require an LLM key).
- "Recap the previous films" mode for deep franchises.
- Shareable briefing links.

## Attribution

This product uses the TMDB API but is not endorsed or certified by [TMDB](https://www.themoviedb.org/).

## License

MIT
