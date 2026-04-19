# errata-md

This repository is a fork of the original [Errata](https://github.com/nokusukun/errata). The goal of this fork is not to redesign the core writing model, but to push Errata toward a filesystem-first workflow where story data is readable, movable, and configurable from markdown files.

## Why
Mostly because I want to use it alongside obsidian. Now I can create errata vault inside obsidian vault, making it convenient to move text from obsidian "idea space" to errata files and back.

On top of that, its more friendly to outside agents, since they can now do things to the story by just reading .md files

## What Is Different In This Fork

The original app's core ideas are still here: fragment-based writing, block-driven context assembly, plugin support, and model-assisted prose workflows. The main differences are in storage, packaging, and product direction.

### Filesystem-first story storage

This fork treats the filesystem as the source of truth.

- Story content, llms guidelines, character cards, lore fragments is synced to markdown files instead of living in internal storage.
- Story settings and metadata are preserved in markdown/frontmatter.
- Human-facing content is kept in visible folders.
- App-only internal state is pushed under `.errata/` so the story root stays understandable.

Current story layout is  shaped around editable files:

```text
<vault>/stories/<story-id>/
	story.md
	Guidelines/
	Characters/
	Lorebook/
	Prose/
	.errata/
```

### Sacrifices
- no more native story branches, but you can duplicate story folder to get similar result
- to get filesystem access, project was ported to the electron, forcing me to remove bun and use node instead

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

#### Filename rules

- In `Guidelines/`, `Characters/`, and `Lorebook/`, the filename becomes the fragment name.
- For those same folders, the fragment ID is derived from the filename, so you do not need to write `id`, `name`, or `type` in frontmatter.
- In `Prose/`, filenames are managed by Errata because section order is encoded into them.

#### Frontmatter

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

#### Default values when frontmatter is missing

If you create a bare `.md` file with no frontmatter, Errata fills in defaults.

- `description`: empty string
- `tags`: empty list
- `refs`: empty list
- `placement`: `user`
- `order`: `0`
- `sticky`: `true`

#### Freezing rules for markdown files

For `Guidelines/`, `Characters/`, and `Lorebook/`, markdown body text is treated as frozen by default.

- If a file has no delimiter, the entire body is considered frozen.
- If a file contains `<!-- editable -->`, everything before that delimiter is treated as frozen.
- Everything after that delimiter is treated as editable.

Example:

```md
Core canon that AI should preserve exactly.

<!-- editable -->

Session-specific notes that Errata may update.
```

#### What Errata writes back

When Errata saves visible markdown fragments, it may write:

- frontmatter for supported fields
- the `<!-- editable -->` delimiter when a fragment has a frozen leading section and a separate editable tail

Errata does not need `id`, `type`, `createdAt`, or `updatedAt` in visible markdown files. Those are derived from folder structure, filenames, and `.errata/` internal records.

#### Internal data

App-only state stays under `.errata/`.

- timestamps
- prose ordering metadata
- librarian state
- other internal indexes

That means the visible markdown files stay relatively clean while Errata still keeps the internal bookkeeping it needs.






