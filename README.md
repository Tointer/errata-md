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
- fragments can't be marked as archived, instead you can hide them in subfolders
- to get filesystem access, project was ported to the electron, forcing me to remove bun and use node instead





