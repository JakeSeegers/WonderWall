---
name: update-wall-project
description: Update a project's blurb (LAST EDIT), PLANS, or DEFINITION on the Project Wall, or add a new project/cause card. Use when the user asks to update the wall, change what a project's card says, refresh a "last edit" line, or add a new project or cause to the wall.
---

# Update a Project Wall entry

All project content lives in a single file, `projects.json`, at the repo
root — never edit `index.html` for a content change. `index.html` only
`fetch()`es this file at load; it has no project data hardcoded in it.

## The schema

Each entry is one object in the top-level array:

```json
{
  "id": "kebab-case-slug",
  "name": "Display Name",
  "url": "https://example.com/" ,
  "color": "#hexcolor",
  "text": "#hexcolor",
  "definition": "One or two sentences: what this project or cause actually is.",
  "edit": "One sentence: the most recent real update.",
  "plans": "One sentence, usually starting \"Next: \" — what's coming."
}
```

- **id**: lowercase, hyphenated, must be unique and must never change once
  set (nothing else keys off it, but stability is still good hygiene).
- **url**: set to `null` (not an empty string) for a project or cause that
  isn't a visitable site — its card's VISIT link is hidden automatically
  when `url` is falsy. Don't invent a URL to fill this field.
- **color** / **text**: the card's background and text color. Pick a color
  not already used by another entry so cards stay visually distinct on the
  wall and the minimap. `text` needs real contrast against `color` — a dark
  hex on a light `color`, a light hex on a dark one.
- **definition**: what the thing *is*. Grounded, not marketing copy — if
  it's a coded project, prefer pulling this from its actual README or
  design doc rather than guessing.
- **edit**: what actually happened most recently. For a coded project,
  prefer the real latest commit message/date over something invented —
  clone the project's repo and check `git log -1` rather than making this
  up.
- **plans**: what's next. For a coded project, a real TODO/roadmap item if
  one exists; otherwise a plausible, modest next step — don't overpromise.

Fields NOT in the schema: no `glue`, no `yPos` — those are simulation
state, assigned fresh by `index.html` on load. Don't add them here.

## Workflow

1. `cd` into the repo, `git pull origin main` first — this file gets
   edited independently of everything else, so pull before editing to
   avoid clobbering a concurrent change.
2. Read the current `projects.json`.
3. **Updating an existing project**: find its object by `id` or `name`,
   change only the field(s) asked for (usually `edit`, sometimes `plans`
   or `definition`). Leave everything else untouched.
4. **Adding a new project**: append a new object following the schema
   above. Ask the user for anything you don't actually know — especially
   `url` (or confirm it should be `null`) and a real basis for `edit`/
   `definition` — rather than inventing plausible-sounding content for
   something that will be shown to real visitors.
5. Validate the file is still valid JSON before committing
   (`python3 -c "import json; json.load(open('projects.json'))"` or
   equivalent) — a syntax error here breaks the whole wall, since
   `index.html`'s fetch has no per-project fallback.
6. Commit with a message describing what changed and for which project
   (e.g. `Update Godaigo's LAST EDIT`), push to `main`.

## What this skill does not do

It does not touch card count, layout, colors used elsewhere in the CSS, or
any simulation/physics logic (fall rate, glue decay, spray economics) —
those live in `index.html` and `backend/ARCHITECTURE.md`'s "Game balance"
section respectively, and are a different, much more consequential kind of
change than editing a blurb.
