# errata-md

This repository is a fork of the original [Errata](https://github.com/nokusukun/errata). The goal of this fork is not to redesign the core writing model, but to push Errata toward a filesystem-first workflow where story data is readable, movable, and configurable from markdown files.

## Why

Mostly because I want to use it alongside Obsidian. I can create an Errata vault inside an Obsidian vault, making it convenient to move text from the Obsidian "idea space" to Errata files and back.

It is also friendlier to external agents, since they can work with story content by reading and editing `.md` files.

## What Is Different In This Fork

The original app's core ideas are still here: fragment-based writing, block-driven context assembly, plugin support, and model-assisted prose workflows. The main differences are in storage, packaging, and product direction.

### Filesystem-first story storage

This fork treats the filesystem as the source of truth.

- Story content, LLM guidelines, character cards, and lore fragments are synced to markdown files instead of living in internal storage.
- Story settings and metadata are preserved in `.errata/_story.md`.
- Human-facing content is kept in visible folders.
- App-only internal state is pushed under `.errata/` so the story root stays understandable.

Current story layout:

```text
<vault>/stories/<story-id>/
  story.md
  Guidelines/
  Characters/
  Lorebook/
  Prose/
  .errata/
    _story.md
```

`story.md` is a compiled reading view. Files in the visible folders are the source of truth for story content.

### Desktop and runtime

This version keeps the upstream Electron desktop shell and Bun server sidecar. The desktop app lets you choose a vault folder and reopen recent vaults. Provider configuration and application logs stay in the global application-data directory; story content stays in the selected vault.

### Sacrifices

- Native story timelines are disabled for Markdown vaults; only the compatibility timeline `Main` remains. Duplicate a story folder when you need a separate version.

### Archive behavior

- A fragment is treated as archived when its markdown file lives inside an `Archive/` subfolder under its normal type folder.
- Moving a file into `Guidelines/Archive/`, `Characters/Archive/`, `Lorebook/Archive/`, or `Prose/Archive/` archives it.
- Moving it back out restores it.
- The app surfaces that as `archived` state in listings, but the source of truth is the file location, not a persisted frontmatter flag.


## Markdown Formatting Rules

Errata reads visible story files directly from markdown. Supported visible folders:

- `Guidelines/` → guideline fragments
- `Characters/` → character fragments
- `Lorebook/` → knowledge fragments
- `Prose/` → prose fragments

Each of those folders may also contain an `Archive/` subfolder. Files inside that subfolder are considered archived and are excluded from normal fragment listings.

### Filename rules

- In `Guidelines/`, `Characters/`, and `Lorebook/`, the filename becomes the fragment name.
- For those same folders, the fragment ID is normally derived from the filename, so you do not need to write `id`, `name`, or `type` in frontmatter. Errata may preserve an explicit `id` when you rename a fragment in the app so references remain valid.
- In `Prose/`, filenames are managed by Errata because section order is encoded into them.

### Frontmatter

Frontmatter is optional.

If present, use standard markdown frontmatter at the top of the file:

```md
---
description: "Short description"
tags: ["tone", "scene"]
refs: ["ch-mira-vale"]
sticky: true
placement: "user"
order: 0
meta: {"someFlag":true}
---
Your fragment content here.
```

Values are parsed as JSON-like scalar values because Errata writes frontmatter using JSON serialization. In practice that means:

- strings should be quoted when you write them manually
- arrays should use JSON array syntax
- booleans are `true` / `false`
- objects can be written into `meta` if needed, though most users should avoid editing `meta` directly

### Default values when frontmatter is missing

If you create a bare `.md` file with no frontmatter, Errata fills in defaults.

- `description`: empty string
- `tags`: empty list
- `refs`: empty list
- `placement`: `user`
- `order`: `0`
- `sticky`: `true` for guidelines, characters, and lore; other types use their registered defaults

### Freezing rules for markdown files

For `Guidelines/`, `Characters/`, and `Lorebook/`, markdown body text is treated as frozen by default.

- If a file has no delimiter, the entire body is considered frozen.
- If a file contains `<!-- editable -->`, everything before that delimiter is treated as frozen.
- Everything after that delimiter is treated as editable.
- Set `editable: true` in frontmatter to opt out of the default body freeze. Existing explicit frozen sections in `meta` still apply.

Example:

```md
Core canon that AI should preserve exactly.

<!-- editable -->

Session-specific notes that Errata may update.
```

### What Errata writes back

When Errata saves visible markdown fragments, it may write:

- frontmatter for supported fields, including `editable: true` for fully editable fragments
- the `<!-- editable -->` delimiter when a fragment has a frozen leading section and a separate editable tail

Visible markdown files normally do not need `id`, `type`, `createdAt`, or `updatedAt`. Errata derives those from folder structure, filenames, and `.errata/` internal records, with an explicit `id` retained when needed to preserve a renamed fragment's identity.

### Internal data

App-only state stays under `.errata/`.

- story settings and metadata
- timestamps and version history
- prose ordering metadata
- librarian state
- other internal indexes

That means the visible markdown files stay relatively clean while Errata still keeps the internal bookkeeping it needs.

## Getting Started

Clone this fork and start the development server with Bun:

```bash
git clone https://github.com/Tointer/errata-md.git
cd errata-md
bun install
bun run dev
```

Open `http://localhost:7739` and configure an LLM provider in the onboarding wizard or Settings > Providers. Set `DATA_DIR` before starting the server to use a specific vault folder.

### Desktop on Windows

Build the desktop app and create a shortcut:

```powershell
bun run electron:pack
bun run electron:shortcut
```

Open **Errata Markdown** from your desktop, or run `bun run electron:start`. Choose your vault in the story library. The shortcut points to `release/win-unpacked/Errata.exe` in this checkout, so keep that folder in place. After updating the source, close the app and run `bun run electron:pack` again.

## Documentation

- [Markdown vaults](docs/markdown-vaults.md)
- [Full documentation index](docs/README.md)
