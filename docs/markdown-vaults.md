# Markdown vaults

This fork stays close to upstream Errata: it uses Bun for development and for
the compiled server sidecar shipped inside the upstream Electron desktop shell.
Its intentional product difference is storage. Story content is ordinary
Markdown that can live inside an Obsidian vault or any other folder.

## Layout

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

`story.md` is a compiled reading view. Files in the four visible folders are
the editable source of truth. `.errata/` contains app-only state such as story
metadata, prose ordering, associations, version history, librarian state, and
agent configuration.

## Filenames and IDs

- `Characters/Io Dren.md` becomes character `ch-io-dren`.
- `Guidelines/Scene Discipline.md` becomes guideline
  `gl-scene-discipline`.
- `Lorebook/Glass Coast.md` becomes knowledge `kn-glass-coast`.
- Errata manages `Prose/` filenames because their numeric prefixes encode
  prose-chain order.

You normally do not need `id`, `name`, or `type` fields in visible files. When
a visible fragment is renamed inside Errata, the app may add an `id` field to
preserve references and upstream version history across the filename change.

## Optional frontmatter

Bare Markdown files work. Supported frontmatter fields use JSON-compatible
values:

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
Fragment content.
```

Missing descriptions, tags, and references default to empty values.
Placement defaults to `user`, order to `0`, and characters, guidelines, and
knowledge default to sticky.

## Frozen and editable text

For characters, guidelines, and knowledge, the body is frozen by default. To
leave a tail that Errata may edit, add the delimiter:

```md
Core canon that should remain unchanged.

<!-- editable -->

Session-specific notes.
```

## Archiving

Move a file into an `Archive/` directory beneath its normal folder to archive
it, for example `Characters/Archive/Mira Vale.md`. Move it back to restore it.
The location is authoritative; an `archived` frontmatter flag is not required.

## Desktop vaults and global state

Packaged desktop builds expose the active vault in the story library. The vault
dialog can choose a folder, reopen a recent vault, reveal it in the system file
manager, or forget it from the recent list. Switching vaults restarts only the
Bun sidecar and reloads the same upstream Electron window.

Provider configuration, logs, and the recent-vault list stay in Errata's global
application-data directory. Story content and story-specific state stay in the
selected vault. For command-line development, set `DATA_DIR` before running
`bun run dev`; live vault switching is a packaged-desktop feature.

## Timeline compatibility

Markdown vaults expose one compatibility timeline named `Main`. Creating,
renaming, or deleting alternate upstream timelines is disabled. Duplicate a
story directory when you need a filesystem-native branch.
