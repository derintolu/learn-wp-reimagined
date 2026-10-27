# Content accuracy: Vibe coder path

Research date: 2026-10-22. Current WordPress release: **7.1** (the live preview, WordPress Playground with `wp: latest`, loads 7.1; its console reports "Loaded WordPress version (7.1)"). Core source was read on the `7.1` branch of wordpress-develop.

Every factual claim and code sample in `content/paths/vibe-coder/0[1-6]-*.yaml` was checked against the sources below. The primary source course is *Beginner WordPress Developer* on learn.wordpress.org (https://learn.wordpress.org/course/beginner-wordpress-developer/), its hooks, enqueuing and security lessons. The Plugin Handbook, the Common APIs Handbook (security) and the Code Reference on developer.wordpress.org fill the gaps, and the gaps are noted.

**The checks are textual.** Every `fixChecks` and checkpoint check on this path is a `regex` or `contains` test on the PHP source in the learner's workspace. No PHP is executed by the checks. The regexes accept common correct variants (whitespace, single or double quotes, named, anonymous or arrow-function callbacks, `add_action` before or after the function) and reject the planted mistake and the plausible wrong fixes listed in `tests/content/vibe-coder-checks.test.ts`. The PHP actually runs only in the live preview, in WordPress Playground.

## Sources and the facts taken from them

### Learn WordPress: Beginner WordPress Developer
- https://learn.wordpress.org/lesson/wordpress-hooks/ (published 2024-07-01, modified 2025-03-11)
  - Hooks let code "interact with or modify the execution of a WordPress request at specific, predefined spots". Two types: action hooks and filter hooks.
  - Example: `add_filter( 'the_content', 'wp_learn_amend_content' );` appending a "Thanks for reading!" paragraph to post content (the model for the lesson's note, adapted).
- https://learn.wordpress.org/lesson/action-hooks/ (published 2024-03-08, modified 2025-02-20)
  - An action lets code run at a specific point in a request. `add_action( hook, callback )`; the callback is a normal PHP function. Example: `after_setup_theme` with `add_theme_support`.
- https://learn.wordpress.org/lesson/filter-hooks/ (published 2024-03-08, modified 2024-11-20)
  - Core: `$content = apply_filters( 'the_content', $content );` in `wp-includes/post-template.php`. The callback must return the updated value. Example `wp_learn_amend_content( $content )` appends markup and returns `$content`.
  - The lesson says "Not returning something will cause a fatal error on your WordPress site." See "Known discrepancies": for `the_content` in WordPress 7.1 with a block theme it doesn't; the content comes up empty. The lesson doesn't repeat the fatal-error claim.
- https://learn.wordpress.org/lesson/enqueuing-css-or-javascript/ (published 2024-04-03, modified 2024-08-22)
  - Plugins enqueue CSS and JS because WordPress controls where assets appear; `wp_enqueue_scripts` for the front end, `admin_enqueue_scripts` for the dashboard; `wp_enqueue_style` and `wp_enqueue_script` take a unique handle and a source URL; WordPress outputs the tags itself.
  - The lesson builds the URL as `plugins_url() . '/bookstore/bookstore.css'`. Our lesson uses the Plugin Handbook form `plugins_url( 'style.css', __FILE__ )` instead (same result, doesn't hard-code the folder name).
  - Gap: no warning about `init` or printing `<link>` tags. Those come from core source (below).
- https://learn.wordpress.org/lesson/securely-developing-plugins-and-themes/ (published 2024-05-11, modified 2025-05-13)
  - "Don't trust any data". Sanitize input as early as possible (`sanitize_text_field()` for names); validate; escape output as late as possible (`esc_html()`).
  - Gap: no `$_GET` and no `wp_unslash()`. Those come from the Code Reference (below).

### Plugin Handbook (developer.wordpress.org/plugins)
- https://developer.wordpress.org/plugins/hooks/
  - "an action takes the info it receives, does something with it, and returns nothing"; "a filter takes the info it receives, modifies it somehow, and returns it."
  - Filters "are meant to work in an isolated manner, and should never have side effects such as affecting global variables and output." "Filters expect to have something returned back to them."
- https://developer.wordpress.org/plugins/hooks/actions/
  - "Callback functions for an Action do not return anything back to the calling Action hook." `add_action()` needs a hook name and a callback; optional priority and accepted args. "the default priority … is 10"; lower numbers run first.
- https://developer.wordpress.org/plugins/hooks/filters/
  - Filters modify data during execution; callback receives the value and returns it. Examples with `the_title` and `body_class`.
- https://developer.wordpress.org/plugins/javascript/enqueuing/
  - "Scripts must be enqueued from one of a few action hooks": `wp_enqueue_scripts` (front end), `admin_enqueue_scripts`, `login_enqueue_scripts`. You "cannot enqueue scripts directly from your plugin code page when it is loaded." "For portability, use `plugins_url()`", e.g. `plugins_url( '/js/myjquery.js', __FILE__ )`.
- https://developer.wordpress.org/plugins/plugin-basics/header-requirements/
  - Only `Plugin Name` is required. Other fields used: Description, Version, Requires at least, Requires PHP, Author, License, License URI, Text Domain.
- https://developer.wordpress.org/plugins/plugin-basics/best-practices/
  - "All globally accessible code should be prefixed with a unique identifier" (the lesson's `my_first_plugin_` prefix). `if ( ! defined( 'ABSPATH' ) ) { exit; }` to block direct access (in every lesson file).

### Common APIs Handbook: Security (developer.wordpress.org/apis/security)
- https://developer.wordpress.org/apis/security/
  - Guiding principles: "Never trust user input." "Escape as late as possible." "Sanitization is okay, but validation/rejection is better." "validate and sanitize user input before using it, and … escape on output."
- https://developer.wordpress.org/apis/security/escaping/
  - "It is best to do the output escaping as late as possible, ideally as data is being outputted." "You always want to escape when you echo, not before." `esc_html()`: "Use anytime an HTML element encloses a section of data being displayed." The list of escapers includes `esc_attr()`, `esc_url()`, `esc_textarea()`, `wp_kses_post()`.
- https://developer.wordpress.org/apis/security/sanitizing/
  - `$title = sanitize_text_field( $_POST['title'] );`. Validation is preferred over sanitization. Doesn't mention `wp_unslash`.

### Code Reference (developer.wordpress.org/reference)
- https://developer.wordpress.org/reference/hooks/the_content/: "Filters the post content." `$content` is the content of the current post; runs after retrieval from the database and before printing. Recommends `in_the_loop()`/`is_main_query()` checks in real plugins (the lesson's note skips them for simplicity; not claimed either way).
- https://developer.wordpress.org/reference/functions/the_content/ and core `wp-includes/post-template.php` (7.1): `the_content()` gets the content, runs `apply_filters( 'the_content', $content )`, then `str_replace( ']]>', ']]&gt;', $content )`, then echoes.
- https://developer.wordpress.org/reference/hooks/init/: "Most of WP is loaded at this stage, and the user is authenticated." (lesson 1 says `init` "fires once WordPress has loaded, on every request").
- https://developer.wordpress.org/reference/hooks/wp_enqueue_scripts/: "Fires when scripts and styles are enqueued"; used for both scripts and styles; the proper hook for front-end assets.
- https://developer.wordpress.org/reference/functions/wp_enqueue_style/: `wp_enqueue_style( $handle, $src = '', $deps = array(), $ver = false, $media = 'all' )`; handle should be unique; `$ver` is added to the URL for cache busting (false = WordPress version).
- https://developer.wordpress.org/reference/functions/plugins_url/: `plugins_url( $path = '', $plugin = '' )`; `$plugin` is "A full path to a file inside a plugin"; output like `http://www.example.com/wp-content/plugins/my-plugin/images/wordpress.png`. Source: `$url .= '/' . ltrim( $path, '/' );`, so a leading slash is fine (the check accepts `/style.css`).
- Core `src/wp-includes/plugin.php` (7.1): `plugin_dir_url( $file )` returns `trailingslashit( plugins_url( '', $file ) )`, the plugin folder's URL with a trailing slash, so `plugin_dir_url( __FILE__ ) . 'style.css'` gives the same URL as `plugins_url( 'style.css', __FILE__ )` (lesson 2 names it as the other common form).
- https://developer.wordpress.org/reference/functions/esc_html/: "Escaping for HTML blocks"; uses `_wp_specialchars()` with `ENT_QUOTES`.
- https://developer.wordpress.org/reference/functions/sanitize_text_field/: checks for invalid UTF-8, converts single `<` to entities, strips all tags, removes line breaks, tabs and extra whitespace, strips percent-encoded characters.
- https://developer.wordpress.org/reference/functions/wp_unslash/: removes slashes from data passed to APIs that expect unslashed data.
- https://developer.wordpress.org/reference/functions/wp_magic_quotes/: "Adds magic quotes to `$_GET`, `$_POST`, `$_COOKIE`, and `$_SERVER`" (lesson 3 names the first three).

### Task 8 sources (lessons 4 to 6), researched 2026-10-22

#### Lesson 4: template hierarchy
- https://learn.wordpress.org/lesson/templates-3/ (published 2024-04-02, modified 2024-07-31): templates "represent the overall document structure of the front end"; block templates are block markup; a single post without single.html/singular.html "would default to using the index.html template"; index is required; single, page, archive (categories, authors), search, 404.
- https://developer.wordpress.org/themes/templates/template-hierarchy/ (updated 2024-07-24): single post `single-{post_type}-{post_name}` → `single-{post_type}` → `single` → `singular` → `index`; category `category-{slug}` → `category-{id}` → `category` → `archive` → `index`; block templates are `.html` in `/templates`; `index.html` is the only required block template.
- https://developer.wordpress.org/themes/templates/introduction-to-templates/ (modified 2023-12-14): Site Editor changes "are saved in their site's database", e.g. saving "overwriting the `/templates/home.html` template file" (lesson: "their version is saved in the site's database, and it's used in place of the theme's file").
- Twenty Twenty-Five's templates, wordpress-develop branch 7.1, `src/wp-content/themes/twentytwentyfive/templates` (GitHub contents API, 8 entries): `404.html`, `archive.html`, `home.html`, `index.html`, `page-no-title.html`, `page.html`, `search.html`, `single.html`. No `category*.html`, `singular.html` or `front-page.html`. `archive.html` has a `query-title` and `term-description` block; `index.html` and `home.html` have no query-title (hidden-blog-heading + template-query-loop patterns).
- Core `src/wp-includes/template.php` (7.1) `get_query_template()`: `apply_filters( "{$type}_template_hierarchy", $templates )`, then `locate_template()`, then `locate_block_template( $template, $type, $templates )`, then `apply_filters( "{$type}_template", ... )`. `get_single_template()` builds `single-{post_type}-{post_name}.php`, `single-{post_type}.php`, `single.php`; `get_category_template()` builds `category-{slug}.php`, `category-{term_id}.php`, `category.php`.
- Core `src/wp-includes/template-loader.php` (7.1): `$tag_templates` lists `is_category => get_category_template` before `is_archive => get_archive_template`; the loop moves on while the getter returns empty; fallback `get_index_template()`; then `apply_filters( 'template_include', $template )` ("Filters the path of the current template before including it.").
- Core `src/wp-includes/block-template.php` (7.1) `locate_block_template()`: resolves the block template from the same hierarchy (so `{$type}_template_hierarchy` affects block themes), sets `$_wp_current_template_id` / `$_wp_current_template_content`, returns `ABSPATH . WPINC . '/template-canvas.php'`; returns `''` for a non-index type with no match so the loader keeps searching (why a category request on TT5 falls through to archive). `resolve_block_template()` queries `get_block_templates()`, which includes Site Editor-edited `wp_template` posts.
- https://developer.wordpress.org/reference/hooks/template_include/: "Filters the path of the current template before including it." No block-theme note; the lesson's "returning your own PHP file skips the block template" follows from template-canvas.php being the file that renders `$_wp_current_template_content`.
- https://developer.wordpress.org/reference/functions/register_block_template/: since 6.7.0; name in the form `plugin_uri//template_name`; args title, description, content, post_types, plugin; shows in the Site Editor.

#### Lesson 5: wp_theme_json_data_theme
- https://learn.wordpress.org/lesson/global-settings-and-styles/ (published 2024-04-02, modified 2024-07-30): settings vs styles; hierarchy WordPress defaults → theme → user (Site Editor, "takes priority over all other levels").
- https://make.wordpress.org/core/2022/10/10/filters-for-theme-json-data/ (André Maneiro, 2022-10-10): four filters `wp_theme_json_data_default`, `_blocks`, `_theme`, `_user`; callback receives a `WP_Theme_JSON_Data`, returns it via `return $theme_json->update_with( $new_data );`; new data must declare its version so WordPress can migrate it.
- https://developer.wordpress.org/reference/hooks/wp_theme_json_data_theme/: "Filters the data provided by the theme for global styles and settings."; param `WP_Theme_JSON_Data $theme_json`; since 6.1.0; source `apply_filters( 'wp_theme_json_data_theme', new WP_Theme_JSON_Data( $theme_json_data, 'theme' ) )` in class-wp-theme-json-resolver.php. User notes use `'version' => 3` ("Mandatory, or it won't work").
- https://developer.wordpress.org/reference/classes/wp_theme_json_data/update_with/: "Updates the theme.json with the given data."; `$new_data` "Array following the theme.json specification."; returns "The own instance with access to the modified data."; since 6.1.0.
- Core `class-wp-theme-json-data.php` (7.1): `update_with()` body `$this->theme_json->merge( new WP_Theme_JSON( $new_data, $this->origin ) ); return $this;`.
- Core `class-wp-theme-json-resolver.php` (7.1) `get_theme_data()`: after the filter, `if ( $theme_json instanceof WP_Theme_JSON_Data ) { ... get_theme_json() } else { $config = $theme_json->get_data(); ... }`. Returning null or an array calls `get_data()` on a non-object: fatal error. Seen in Playground: "There has been a critical error on this website." (`l5-noreturn-fatal-1440.png`).
- Core `class-wp-theme-json.php` (7.1): `const LATEST_SCHEMA = 3;`; the constructor runs `WP_Theme_JSON_Schema::migrate()`. `merge()`: `array_replace_recursive` then "Replace the presets." — an incoming theme-origin `settings.color.palette` replaces the theme's whole palette (no merge by slug); style values merge at the leaf level.
- Core `class-wp-theme-json-schema.php` (7.1) `migrate()`: `if ( ! isset( $theme_json['version'] ) ) { $theme_json = array( 'version' => WP_Theme_JSON::LATEST_SCHEMA ); }` — the whole input is discarded. Versions 1 and 2 are migrated (the check accepts 2). Seen in Playground: without `version` the heading stays black (`l5-noversion-1440.png`).
- Twenty Twenty-Five `theme.json` (7.1): `"version": 3`; palette base #FFFFFF, contrast #111111, accent-1 #FFEE58, accent-2 #F6CFF4, accent-3 #503AA8, accent-4 #686868, accent-5 #FBFAF3, accent-6 color-mix(...); `styles.color` background base / text contrast; headings set no colour (only size, weight, letter spacing).
- https://developer.wordpress.org/themes/global-settings-and-styles/styles/using-presets/: `var:preset|color|{slug}` form in theme.json (also used in the block theme path's doc).

#### Lesson 6: ship it
- https://learn.wordpress.org/lesson/plugin-requirements/ (published 2024-03-09, modified 2025-02-20): header needs at least the plugin name; recommended description and version; main plugin file; folder changes the slug.
- https://developer.wordpress.org/plugins/plugin-basics/header-requirements/: only Plugin Name required; Description "fewer than 140 characters"; Version; Requires at least; Requires PHP; Author; Author URI; License; License URI; Text Domain; Domain Path; Network; Update URI; Requires Plugins; Plugin URI.
- https://developer.wordpress.org/reference/functions/validate_plugin_requirements/ (since 5.2.0; Requires Plugins 6.5.0; readme fallback removed 5.8.0) and https://developer.wordpress.org/reference/functions/activate_plugin/ (returns the WP_Error before activating): "won't activate the plugin on a site that's older".
- https://developer.wordpress.org/plugins/plugin-basics/best-practices/: prefix "at least 4 letters long, though we recommend 5"; prefix functions, classes/interfaces/traits (unless namespaced), namespaces, globals, options and transients; avoid `__`, `wp_`, `WordPress`, `_`. Same-name functions are a PHP fatal "Cannot redeclare" (PHP behaviour).
- https://developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/ (page updated 2026-03-11): 18 guidelines; lesson names 1 (GPL), 4 (human-readable), 7 (no tracking without consent), 8 (no executable code via third parties, incl. non-service CDNs for JS/CSS), 13 (WordPress default libraries, e.g. jQuery), 10 ("Powered By" links opt-in).
- https://developer.wordpress.org/plugins/wordpress-org/how-your-readme-txt-works/: readme header Contributors, Tags, Tested up to (WordPress version tested), Stable tag (which `/tags/` version), License; Requires at least/PHP come from the main PHP file since 5.8.
- https://developer.wordpress.org/plugins/wordpress-org/planning-submitting-and-maintaining-plugins/: submit a complete zip; reviewed before approval; then a Subversion repository; "Your plugin URL cannot be changed after you submit it, but the display name can".
- Core `src/wp-admin/menu.php` (7.1): submenu label `__( 'Add Plugin' )` for plugin-install.php; `plugin-install.php` title "Add Plugins", toggle "Upload Plugin". Lesson 6 says **Plugins > Add Plugin > Upload Plugin**.

### WordPress core source (wordpress-develop, branch 7.1)
- `src/wp-includes/template-canvas.php`: `$template_html = get_the_block_template_html();` runs **before** `<!DOCTYPE html>` is printed. So anything a block-theme callback echoes while the template renders lands at the very top of the response, above the header.
- `src/wp-includes/blocks/post-content.php`: `$content = apply_filters( 'the_content', … ); … if ( empty( $content ) ) { return ''; }`. A filter that returns nothing gives an empty Post Content block, not an error.
- `src/wp-includes/class-wp.php`: `public $public_query_vars` includes `name` (and `p`, `page`, `s`, `author` and more), which is why lesson 3's parameter isn't called `name`.
- `src/wp-includes/functions.wp-scripts.php`, `_wp_scripts_maybe_doing_it_wrong()`: returns early if `init`, `wp_enqueue_scripts`, `admin_enqueue_scripts` or `login_enqueue_scripts` has fired; otherwise `_doing_it_wrong` with "Scripts and styles should not be registered or enqueued until the wp_enqueue_scripts, admin_enqueue_scripts, or login_enqueue_scripts hooks." Called from `wp_enqueue_style()`. So a loose call in the plugin file (which loads before `init`) is flagged; a call on `init` is not flagged but queues the style for every request, the dashboard included. Lesson 2 says exactly this.

### Checked in WordPress Playground (WordPress 7.1, Twenty Twenty-Five, plugin preview)
- See the "Browser checks" section of the Task 7 report for screenshots. Facts the lessons rely on:
  - The plugin preview boots with My First Plugin active (its `the_content` filter runs as soon as the bug is applied), logged out, on Twenty Twenty-Five.
  - Pretty permalinks are on: `/hello-world/` opens the default "Hello world!" post with its content ("Welcome to WordPress. This is your first post…").
  - Lesson 1 bug: the post's text and the note appear at the very top of the page, above the site title and header (seen). That the Post Content block itself renders empty comes from `post-content.php` above. After the fix, the note sits under the post content (seen).
  - Lesson 2: after enqueueing, the note shows the stylesheet (blue left border, pale blue background).
  - Lesson 3: with the bug, `?reader=%3Cmark%3ESam%3C%2Fmark%3E` shows "Sam" highlighted (HTML injected); with `esc_html()` the tags show as text; with `sanitize_text_field()` too, the tags are stripped and "Sam" shows plain.

## Changes from the plan outline

- None to counts, order, ids, preview kind or bug placement. Titles: "Hooks, actions and filters"; "Loading CSS the WordPress way"; "Escaping output, sanitizing input".
- **Lesson 1's bug symptom, stated precisely.** The brief says the content "vanishes". In WordPress 7.1 with a block theme, the post's content area is empty, and the echoed content and note appear at the very top of the page, above the header (see template-canvas.php above). The beats and the bug explanation describe both halves. This is a clearer clue than a blank page.
- **Lesson 3's input is `$_GET['reader']`** (a query-string parameter) rather than a registered WordPress query var: reading `get_query_var()` would need a `query_vars` filter first, which is outside the lesson. The security lessons and handbook pages use `$_POST`/`$_GET` directly.
- **Not `?name=`.** The first draft used `?name=`. In the browser, `/hello-world/?name=…` served the Sample Page instead of the post: `name` is one of WordPress's public query vars (`WP::$public_query_vars` in core `class-wp.php`, 7.1), used to look a post up by its slug. The parameter is `reader`, and the lesson says why in one sentence.
- **The demo tag is `<mark>`.** `<em>` was invisible because the note's own style was italic at first, and `<strong>` was faint in Twenty Twenty-Five's light body weight. `<mark>` gives an unmistakable yellow highlight, and it's harmless. The note's stylesheet no longer sets italics.
- **Lesson 3 splits the work:** the planted bug is the missing `esc_html()` on output; the code checkpoint then adds `sanitize_text_field()` (with `wp_unslash()`, recommended, not required by the check) on input while keeping `esc_html()`.
- **Lesson 2 adds `my-first-plugin/style.css`** as a starter file (editable). Each lesson keeps its editable PHP in the main file, so nothing is `require`d (the Task 2 boot risk doesn't arise).
- **Branches (Task 8):** the graph flows 1→2→3→4→5→6. Lesson 3's advance and skip now go to `vc-template-hierarchy` (skip message no longer says "More lessons are on the way"); lesson 4's advance and skip go to lesson 5; lesson 5's to lesson 6; every review goes back to its own lesson. Lesson 6 has no checkpoint.
- **Lesson 4 title** is "Which template renders this page?" (outline id kept). It has no starter files: the workspace shows the learner's plugin read-only, as the learner path's free-text lessons do. Landing `/category/uncategorized/` so the prediction (archive.html) can be checked against the "Category: Uncategorized" title that only archive.html renders on TT5.
- **Lesson 5's visible change is a style, not a palette colour.** Because `update_with()` replaces the whole theme palette (see merge() above), changing one palette colour would need all eight entries. The lesson instead sets `styles.elements.heading.color.text` to `var:preset|color|accent-3`; TT5 sets no heading colour, so "Hello world!" turns purple (seen, `l5-applied-1440.png`). The palette-replacement trap is taught in a beat.
- **Lesson 5's starter** is lesson 3's intended answer; the theme.json callback is added to the main file (nothing `require`d).
- **Placement hints** gained start points for lessons 4, 5 and 6.
- `finalFiles` holds the lesson 5 intended answer (lesson 3's plus the `wp_theme_json_data_theme` callback) and `style.css`.

## Known discrepancies in upstream sources (for the Training Team)

- Filter Hooks lesson: "Not returning something will cause a fatal error on your WordPress site." For `the_content` in WordPress 7.1 with a block theme, returning nothing gives empty post content (`post-content.php` returns `''` for empty content); no fatal error. With a classic theme, `the_content()` passes `null` to `str_replace()`, which PHP 8.1+ reports as a deprecation, not a fatal error.
- Enqueuing CSS or JavaScript lesson builds a plugin URL with `plugins_url() . '/bookstore/bookstore.css'`, which hard-codes the plugin folder; the Plugin Handbook's `plugins_url( 'file', __FILE__ )` doesn't.

## Checklist

- [x] **01 Hooks, actions and filters** (`vc-actions-and-filters`)
  - Hooks, actions (return nothing) and filters (take, change, return) match the Hooks, Actions and Filters handbook pages and the three Learn lessons.
  - `add_action` arguments and default priority 10 match the Actions page. `init` matches its Code Reference entry.
  - `apply_filters( 'the_content', $content )` matches core and the Filter Hooks lesson. "No side effects, including output" matches the Hooks page.
  - Plugin header (`Plugin Name` the only required field), the prefix advice and the ABSPATH guard match the Plugin Handbook.
  - The bug's symptom (content at the top, empty content area) matches core source and was seen in Playground.
  - Checks: no echo/print outside comments, a return of `$content` with `$note`, the `add_filter` kept, the note's class kept. Cases in `tests/content/vibe-coder-checks.test.ts`.
  - Free-text checkpoint rubric matches the beats; the fallback offers a right and a wrong answer.
- [x] **02 Loading CSS the WordPress way** (`vc-enqueueing`)
  - Why enqueue, handles, and the three hooks match the Learn lesson, the Enqueuing page and the `wp_enqueue_scripts` reference.
  - `wp_enqueue_style()` signature and defaults match its reference. `plugins_url( 'style.css', __FILE__ )` and its output match the plugins_url reference.
  - "Doing it wrong" for a loose call, and `init` queueing for every request, match `_wp_scripts_maybe_doing_it_wrong()` in core.
  - Checks: `wp_enqueue_style( handle, plugins_url( 'style.css', __FILE__ ) … )` (or `plugin_dir_url( __FILE__ ) . 'style.css'`, fix round 1) inside a callback hooked by `add_action` to `wp_enqueue_scripts` (named in either order, anonymous or arrow), and the `the_content` filter kept. Accepts a return type on the callback (`: void`, fix round 1). Rejects `init`, a loose call, a mismatched callback name, a hand-typed URL, a missing `__FILE__`, `wp_enqueue_script`, and an echoed `<link>`.
- [x] **03 Escaping output, sanitizing input** (`vc-escaping-and-sanitizing`)
  - "Never trust user input", sanitize early, escape late match the Security page, the Escaping and Sanitizing pages and the Learn security lesson.
  - `esc_html()` and the other escapers match the Escaping page and the esc_html reference.
  - `sanitize_text_field()`'s five steps match its reference. Slashes on `$_GET`, `$_POST`, `$_COOKIE` match `wp_magic_quotes()`; `wp_unslash()` matches its reference.
  - The highlighted, escaped and stripped results were seen in Playground.
  - Bug checks: `esc_html( $reader )`, and every `$reader` that isn't an assignment target sits directly inside `esc_html(` (fix round 1; this replaced a check that only caught `.` joins and double-quoted strings, which a raw `sprintf()` sink slipped past), the greeting and the return kept. Rejects escaping early on input, `esc_attr`, `strip_tags`, double-quoted interpolation, a raw `sprintf()`, `esc_html( $reader )` only in a comment or on another variable, a stray `echo $reader`, and deleting the greeting. Accepts `sprintf()` with `esc_html( $reader )`.
  - Checkpoint checks: `$reader = sanitize_text_field( [wp_unslash(] $_GET['reader'] … )`, also in the ternary form `$reader = isset( $_GET['reader'] ) ? sanitize_text_field( … ) : '';` (fix round 1), `esc_html( $reader )` kept, no raw `$reader`, the `isset()` kept. Rejects dropping the escape, sanitizing on output instead, `sanitize_email`, and dropping `isset()`.

- [x] **04 Which template renders this page?** (`vc-template-hierarchy`)
  - Hierarchy lists for single posts and categories match the Theme Handbook hierarchy page and core `get_single_template()`/`get_category_template()`/template-loader.
  - TT5's eight template files match the 7.1 source tree; `/category/uncategorized/` → archive.html (no category templates) matches core and the "Category: Uncategorized" title seen in Playground (`l4-beats-1440.png`).
  - `index` the only required block template matches the hierarchy page. Site Editor edits saved in the database match Introduction to Templates.
  - `{$type}_template_hierarchy`, `register_block_template()` (6.7, `plugin//name`), `template_include` and `template-canvas.php` match core source and Code Reference.
  - Free-text rubric: archive.html with the fall-back reason; skip for a correct plugin-side mechanism. Fallback offers a right (archive) and a wrong (index) answer.
- [x] **05 Changing theme.json from your plugin** (`vc-theme-json-from-code`)
  - Four layers and filters match the dev note and Learn global settings lesson; TT5 palette/slugs match its theme.json.
  - Fix round 1: beat 2 teaches the pattern with a different style (root `styles.color.text` = `var:preset|color|accent-4`, TT5's grey), and the your-turn beat states the goal (headings, `elements` > `heading` > `color` > `text`, `accent-3`) without giving the finished code, so the learner writes the callback.
  - `update_with()` returns the same object; not returning → fatal (resolver source, seen in Playground). Missing `version` discards the array (schema migrate(), seen). Palette replaces, styles merge (merge()).
  - Checks: `->update_with(` inside a callback hooked with `add_filter` to `wp_theme_json_data_theme` (named either order, anonymous or arrow); the object returned (`return $x->update_with( … );` with no call chained after it, or `$x->update_with(...)` then `return $x;`, or an arrow fn with no chained call; fix round 1); typed parameters and return types accepted on named, anonymous and arrow callbacks (fix round 1); `'version' => 3` (2 or `WP_Theme_JSON::LATEST_SCHEMA` accepted); `styles > elements > heading|h1 > color > text` = `var:preset|color|accent-3` (or the CSS var form); the_content filter kept. Rejects no return, returning the array or `get_data()` (also chained, `update_with( … )->get_data()`, fix round 1), missing version, the default/blocks/user layer, `add_action`, a mismatched callback name, a palette entry instead, `settings` instead of `styles`, another colour, `background`, and dropping the_content filter.
- [x] **06 Ship your plugin** (`vc-ship-it`), no checkpoint
  - Header fields match Header Requirements; activation blocked on old WordPress/PHP matches validate_plugin_requirements()/activate_plugin().
  - Prefixing rules match Best Practices. Directory guidelines and readme fields match the guidelines and readme pages; submission facts match Planning, Submitting and Maintaining.
  - Menu path "Plugins > Add Plugin > Upload Plugin" matches 7.1 `menu.php` and `plugin-install.php`.

## Finale reference plugin

`content/paths/vibe-coder/path.yaml` `finalFiles` holds `my-first-plugin/my-first-plugin.php` (lesson 5's intended answer: the note filter, the greeting with `sanitize_text_field( wp_unslash() )` and `esc_html()`, the enqueue on `wp_enqueue_scripts`, and the `wp_theme_json_data_theme` callback giving headings `accent-3`) and `my-first-plugin/style.css`. `scripts/build-content.ts` fails the build unless they pass every lesson's checks. `previewFiles` holds only the main file's header, which the preview activates at boot. All PHP variants in the lessons and tests' SOLUTIONS pass `php -l` (PHP CLI).
