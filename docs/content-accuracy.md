# Content accuracy: Block theme path

Research date: 2026-10-19. Current WordPress release at research time: **7.1.3**, according to `api.wordpress.org/core/version-check/1.7/`. The newest branch is 7.1, and 7.0.7 and 6.9.10 are still offered.

Every factual claim and code sample in `content/paths/block-theme/*.yaml` was checked against the sources below. Where the sources disagree, the **live schema and WordPress core source** win, and the disagreement is noted.

## Sources and the facts taken from them

### theme.json schema (schemas.wp.org)
- https://schemas.wp.org/trunk/theme.json, plus the per-release schemas `https://schemas.wp.org/wp/{6.5,6.6,6.9,7.0,7.1}/theme.json`. These redirect to `raw.githubusercontent.com/WordPress/gutenberg/{branch}/schemas/json/theme.json`.
  - **Version history:**
    - In the 6.5 schema, `version` has `enum: [2]`.
    - In the 6.6 schema, it has `enum: [3]`.
    - In the 6.9, 7.0, 7.1 and trunk schemas, it has `const: 3`.
    - So **version 3 is current for WordPress 7.x** and has been since 6.6.
  - **Top-level properties:** `$schema`, `version`, `title`, `slug`, `description`, `blockTypes`, `settings`, `styles`, `customTemplates`, `templateParts`, `patterns`.
  - **`settings.color.palette` items:** the properties are `name`, `slug` and `color`. All three are `required`, and `additionalProperties: false` is set. The description says each preset generates `--wp--preset--color--{slug}` plus `.has-{slug}-color`, `.has-{slug}-background-color` and `.has-{slug}-border-color`.
  - **`settings.color.defaultPalette`:** "Allow users to choose colors from the default palette." It defaults to `true`.
  - **`settings.layout`:** `contentSize` ("Sets the max-width of the content"), `wideSize` (max width of `.alignwide`), `allowEditing`, `allowCustomContentAndWideSize`.
  - **`settings.appearanceTools`** enables these controls:
    - background: backgroundImage, backgroundSize
    - border: color, radius, style, width
    - color: link, heading, button, caption
    - dimensions: aspectRatio, height, minHeight, minWidth, width
    - position: sticky
    - spacing: blockGap, margin, padding
    - typography: lineHeight
  - **`styles` and elements:** `styles.color` has `background`, `gradient` and `text`. The allowed `styles.elements` are `button`, `link`, `heading`, `h1` to `h6`, `caption`, `cite`, `select` and `textInput`.
  - **`templateParts` items:** `name` (required), `title`, `area` (default `uncategorized`).

### WordPress core source (wordpress-develop, branch 7.1)
- https://raw.githubusercontent.com/WordPress/wordpress-develop/7.1/src/wp-includes/class-wp-theme.php
  - `is_block_theme()` returns true when `templates/index.html` (or the legacy `block-templates/index.html`) exists and is readable.
  - A theme that isn't a block theme and has no `index.php` gets the `theme_no_index` error. This confirms that **block themes don't need `index.php`**.
  - When the `Name` header is empty, it falls back to the stylesheet (folder) name (`sanitize_header`, `case 'Name'`).
  - `get_block_patterns()` skips a pattern file with no `Slug` ("Slug" field missing) or no `Title` ("Title" field missing), reporting each through `_doing_it_wrong`. An invalid slug is reported but not skipped.
- https://raw.githubusercontent.com/WordPress/wordpress-develop/7.1/src/wp-includes/class-wp-theme-json.php
  - `LATEST_SCHEMA = 3`.
  - The palette preset's `value_key` is `'color'`.
  - `get_settings_values_by_slug()` skips a preset that has no value key ("If we don't have a value, then don't add it to the result"). So **a palette entry with `value` instead of `color` produces no CSS custom property or classes, and raises no error.** That is the basis of the lesson 1 bug.
- https://raw.githubusercontent.com/WordPress/wordpress-develop/7.1/src/wp-includes/block-patterns.php
  - `_register_theme_block_patterns()` registers the active theme's `patterns/` files on `init`.
- https://raw.githubusercontent.com/WordPress/wordpress-develop/7.1/src/wp-includes/blocks/post-template.php
  - When `query.inherit` is true, the loop uses the global `$wp_query`.
- https://raw.githubusercontent.com/WordPress/wordpress-develop/7.1/src/wp-includes/version.php
  - `$required_php_version = '7.4'`, so the theme's `Requires PHP: 7.4` is valid.
- https://raw.githubusercontent.com/WordPress/wordpress-develop/7.1/src/wp-admin/themes.php and `theme-install.php`
  - The admin labels are "Add Theme" and "Upload Theme".
- https://raw.githubusercontent.com/WordPress/wordpress-develop/7.1/src/wp-content/themes/twentytwentyfive/ (`templates/index.html`, `parts/header.html`, `parts/footer.html`, `patterns/template-query-loop.php`, `theme.json`)
  - The index template, header and footer are built mostly from Pattern blocks.
  - This is the reference for the Query Loop markup.
  - Its `theme.json` uses `"version": 3`.

### Developer Handbook: Theme Handbook
- https://developer.wordpress.org/themes/core-concepts/theme-structure/
  - The two required files are `style.css` (theme data such as name and description) and `templates/index.html` (the default/fallback template, "necessary for WordPress to consider this a block theme").
  - The standard folders are `parts`, `patterns` (registered automatically), `styles` (style variations) and `templates`.
  - Optional files: `functions.php` (loaded automatically), `screenshot.png` (1200×900, PNG or JPG), `readme.txt` (required for the Theme Directory) and `theme.json`.
- https://developer.wordpress.org/themes/basics/main-stylesheet-style-css/
  - WordPress shows the header comment under Appearance > Themes.
  - These fields are required for the Theme Directory: Theme Name, Author, Description, Version, Requires at least, Tested up to, Requires PHP, License, License URI and Text Domain.
- https://developer.wordpress.org/themes/core-concepts/including-assets/
  - A theme loads `style.css` by enqueueing it with `wp_enqueue_style()` and `get_stylesheet_uri()` from `functions.php`.
- https://developer.wordpress.org/themes/global-settings-and-styles/introduction-to-theme-json/
  - The top-level sections are `version`, `$schema`, `settings` ("which block controls appear, configure presets"), `styles`, `customTemplates`, `templateParts` and `patterns`.
  - `$schema` is optional but recommended, because it gives editor hints and error reporting.
  - **Outdated:** this page still says "The API is currently at version 2". The schema and core say 3, so the lessons teach 3 and tell learners that some handbook pages still show 2.
- https://developer.wordpress.org/themes/global-settings-and-styles/settings/color/
  - Setting `defaultPalette` to `false` disables the core colours.
- https://developer.wordpress.org/themes/global-settings-and-styles/settings/layout/
  - `contentSize` and `wideSize` take valid CSS lengths, with an example of `40rem`.
  - The page recommends 45 to 75 characters per line.
  - `wideSize` should be larger than the content width but not full screen, because full alignment is separate.
  - Inner blocks can use the content width.
- https://developer.wordpress.org/themes/global-settings-and-styles/styles/
  - Styles can be set at the global, element and block levels.
  - Styles set in theme.json can be customised in Appearance > Editor > Styles without specificity issues.
  - The block-level example uses `core/code`.
- https://developer.wordpress.org/themes/global-settings-and-styles/styles/applying-styles/
  - Root styles apply to `<body>`.
  - The elements are button, caption, cite, heading, h1 to h6 and link.
  - `button` and `link` support `:hover`, `:focus`, `:active` and `:visited`.
  - Block styles overrule element styles, for example Button and Heading.
- https://developer.wordpress.org/themes/global-settings-and-styles/styles/using-presets/
  - Presets become `--wp--preset--{feature}--{slug}`.
  - In theme.json, reference them as `var:preset|{feature}|{slug}`, for example `var:preset|color|base`. This form "always appears correctly throughout the interface".
  - Save the `var(--wp--preset--…)` form for CSS.
- https://developer.wordpress.org/themes/global-settings-and-styles/style-variations/
  - Style variations are JSON files in `/styles`, alternative versions of theme.json ("skins").
- https://developer.wordpress.org/themes/templates/introduction-to-templates/
  - Templates are `.html` files of block markup in `/templates`, and parts live in `/parts`.
  - WordPress outputs `<html>`, `<head>` and `<body>` for block themes.
  - The block markup anatomy is prefix `wp:`, namespace, slug and JSON settings, and core blocks omit `core/`.
  - Build the layout in the Site Editor and copy it from the Code editor (Options ⋮).
  - Saving in the Site Editor stores the change in the database and overrides the file.
- https://developer.wordpress.org/themes/templates/template-hierarchy/
  - `index.html` is the only required template.
  - The single-post fallback chain ends with `single.html`, then `singular.html`, then `index.html`.
- https://developer.wordpress.org/themes/templates/template-parts/
  - Parts must sit directly in `/parts`, because nested folders are unsupported.
  - Parts are included with `<!-- wp:template-part {"slug":"header","tagName":"header"} /-->`. `slug` is required and loads `/parts/{slug}.html`, and `tagName` sets the wrapper.
  - The default areas are `uncategorized` (General), `header` and `footer`.
  - Database edits overrule theme files.
- https://developer.wordpress.org/themes/global-settings-and-styles/template-parts/
  - The `templateParts` entries take `area`, `name` and `title`.
- https://developer.wordpress.org/themes/patterns/introduction-to-patterns/
  - Patterns are groups of blocks.
  - All theme-registered patterns are **not synced**: inserting one creates a new instance, and later changes don't affect earlier uses.
  - Bundling patterns in a theme gives access to PHP, for example for i18n, which template parts don't have.
- https://developer.wordpress.org/themes/patterns/registering-patterns/
  - Files in `/patterns` with a valid header are registered automatically.
  - The header fields are Title, Slug (`namespace/pattern-name`), Categories, Description, Viewport Width, Inserter, Keywords, Block Types, Post Types and Template Types.
  - The page recommends at least Title, Slug and Categories.
  - Example: `Slug: themeslug/hero`, `Categories: featured`.
- https://developer.wordpress.org/themes/patterns/usage-in-templates/
  - Templates and parts include a pattern with `<!-- wp:pattern {"slug":"namespace/pattern-slug"} /-->`.
  - The Pattern block isn't in the inserter.
  - The slug must include the namespace.

### Developer Handbook: Block Editor Handbook
- https://developer.wordpress.org/block-editor/reference-guides/theme-json-reference/theme-json-living/
  - "This is the living specification for **version 3** of theme.json."
  - Palette items are `{ name, slug, color }`.
  - Also documents the layout `contentSize`/`wideSize` definitions and the `templateParts` name/title/area properties.
- https://developer.wordpress.org/block-editor/reference-guides/theme-json-reference/theme-json-migrations/
  - The v2 to v3 migration changes the `defaultFontSizes` and `defaultSpacingSizes` defaults.
  - The lessons avoid custom `fontSizes` and `spacingSizes`, so the theme isn't affected.
- https://raw.githubusercontent.com/WordPress/gutenberg/trunk/packages/block-library/src/query/block.json
  - The default `query` attribute object includes `"inherit": true`.

### Learn WordPress
- https://learn.wordpress.org/lesson/theme-structure/
  - The two required files are style.css and templates/index.html, and theme.json is optional.
  - The four standard folders are templates, styles, patterns and parts.
  - Screenshot: 1200×900.
- https://learn.wordpress.org/lesson/global-settings-and-styles/
  - theme.json is the theme's configuration file. It covers `$schema`, version, settings, styles, template parts, custom templates and patterns, and the settings/styles hierarchy.
  - The lesson shows `version 2`, which is out of date.
- https://learn.wordpress.org/lesson/template-overview/
  - Templates pull in parts and patterns.
  - Plain HTML in a block template shows as an error in the Site Editor.
  - Load order: theme, then child theme, then user customisations in the database.
- https://learn.wordpress.org/lesson/theme-patterns/
  - Pattern files are PHP with a header comment. The common fields are title, slug and categories, and they are registered automatically.
- https://learn.wordpress.org/lesson/use-the-create-block-theme-plugin-for-exports-and-theme-variations/
  - Editor changes are stored in the database.
  - Create Block Theme can save changes to theme files, export a zip, and create a blank, cloned or child theme.
- https://learn.wordpress.org/course/develop-your-first-low-code-block-theme/
  - Course context for the order of the path: style.css, theme.json, templates/index.html, template parts and Create Block Theme.
- https://learn.wordpress.org/tutorial/anatomy-of-a-block-theme/
  - **Outdated:** this tutorial says `index.php` "is a required file". Core 7.1 (`is_block_theme()` / `theme_no_index`) proves otherwise, so lesson 1 says so explicitly.

### WordPress.org plugin directory
- https://wordpress.org/plugins/create-block-theme/ (checked through `api.wordpress.org/plugins/info/1.2/`; version 2.10.2, updated 2026-10-01)
  - The plugin adds a panel in the Editor, opened from an icon to the right of Save.
  - Its options include Save Changes (to Theme), Export Zip, Create Blank Theme, Create Theme Variation, and clone or child theme.

## Accuracy checklist (Step 4)

Each lesson was checked claim by claim against the sources above. Every code sample was also run through the content checks, using `scripts/build-content` and `runChecks`, with these results:
- The starters fail the checkpoint.
- The intended solutions pass.
- Plausible wrong answers fail.

The final `theme.json` was also audited key by key against the WP 7.1 schema.

- [x] **01 What makes a block theme** (`bt-what-is-a-block-theme`)
  - Required files: verified against core `is_block_theme()`.
  - "index.php not needed": verified against core `theme_no_index`.
  - Version 3 since 6.6 and current in 7.1: verified against the schemas and `LATEST_SCHEMA`.
  - Palette keys: verified against the schema's `required` and `additionalProperties`.
  - The bug (`value` vs `color`): the silent skip is verified against `get_settings_values_by_slug`.
  - The `<html>/<head>/<body>` claim matches Intro to Templates.
- [x] **02 style.css and theme.json settings** (`bt-style-css-and-theme-json`)
  - Header fields match the style.css page.
  - The Name fallback to the folder name is verified against core.
  - "CSS below the header isn't loaded on its own" matches Including Assets.
  - `defaultPalette` matches the schema and the Color page.
  - The `appearanceTools` list is a subset of the schema description.
  - The layout keys and the 45 to 75 character guidance match the Layout page.
  - The "Requires at least: 6.6" rationale is verified against the schemas.
- [x] **03 Templates and template parts** (`bt-templates-and-parts`)
  - Block markup anatomy matches Intro to Templates.
  - The hierarchy fallback matches Template Hierarchy.
  - Query Loop markup follows TT5 and core `block.json`, and the `inherit` behaviour is verified in `post-template.php`.
  - Template Part block attributes, the no-subfolders rule and the default areas match Template Parts.
  - The database-override claim matches Template Parts and Intro to Templates.
- [x] **04 Global styles** (`bt-global-styles`)
  - The three levels match Styles and Applying Styles.
  - The element list (the subset taught) and pseudo-classes match Applying Styles and the schema.
  - "Block styles win over element styles" matches Applying Styles.
  - The `var:preset|color|slug` syntax and the CSS-var guidance match Using Presets.
- [x] **05 Block patterns** (`bt-patterns`)
  - "Not synced" matches Intro to Patterns.
  - The header fields and namespaced slug match Registering Patterns.
  - "No Title or no Slug means not registered" is verified in core `get_block_patterns()`. Header field names are matched by `get_file_data`, which is case-insensitive, so the fix check uses the `i` flag.
  - The Pattern block markup matches Usage in Templates.
  - The TT5 claim is verified against the theme files.
- [x] **06 Ship your block theme** (`bt-ship-it`)
  - The Create Block Theme features and panel location match the plugin readme and the Learn lesson.
  - Screenshot size, `readme.txt` and `functions.php` match Theme Structure.
  - Style variations match the Style Variations page.
  - The admin labels "Add Theme > Upload Theme" are verified against core 7.1 (an earlier draft said "Add New Theme", which was corrected).

## Known discrepancies in upstream sources (for the Training Team)

- The Theme Handbook's "Introduction to theme.json" says the API "is currently at version 2". The schema (since 6.6) and core (`LATEST_SCHEMA = 3`) say 3. Many handbook code samples still use `"version": 2`.
- The Learn tutorial "Anatomy of a Block Theme" says `index.php` is required for block themes. Core hasn't required it for block themes since `is_block_theme()` arrived (5.9).
- The style.css handbook page's example header is for Twenty Twenty, which is a classic theme.

## Finale

The theme the path builds is: `style.css` (L1), `theme.json` (L1 bug fix, then edited in L2 and L4), `templates/index.html` and `parts/header.html` (L3), and `patterns/hero.php` (L5).

The learner's edits to `theme.json`, `templates/index.html` and `patterns/hero.php` are stored in `record.files`. When the starter files are merged, later lessons' starters must win over earlier ones (L4's `theme.json` over L1/L2's), and the learner's edits win over all of them.
