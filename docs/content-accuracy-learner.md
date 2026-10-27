# Content accuracy: Learner path

Research date: 2026-10-22. Current WordPress release at research time: **7.1.3**, according to `api.wordpress.org/core/version-check/1.7/`. The live preview (WordPress Playground, `wp: latest`) also reports 7.1.3 on its dashboard.

Every factual claim and code sample in `content/paths/learner/0[1-6]-*.yaml` was checked against the sources below (lessons 4 to 6 added in Task 6, same research date). The primary source course is *Beginner WordPress User* on learn.wordpress.org (https://learn.wordpress.org/course/beginner-wordpress-user/, 24 lessons). Where a Learn lesson doesn't cover a point, the WordPress user documentation (wordpress.org/documentation), the Block Editor Handbook or WordPress core and Gutenberg source fill the gap, and the gap is noted.

## Sources and the facts taken from them

### Learn WordPress: Beginner WordPress User
- https://learn.wordpress.org/lesson/introduction-to-wordpress-2/
  - WordPress lets you create your own website or blog, as a content management system, without learning to code.
  - It is free and open source: anyone can download and use it, and "anyone can contribute to the code or in other areas of WordPress to help improve it."
  - "More than 40% of all the websites in the world are built using WordPress."
  - A theme decides the site's look; plugins add functionality (selling products, forms, security, speed).
  - Gap: the lesson doesn't separate the public site from the admin area. That comes from the dashboard lesson and the Administration Screens doc.
- https://learn.wordpress.org/lesson/getting-started-with-the-wordpress-dashboard/
  - The dashboard is at `yourwebsite.com/wp-admin`, reached by logging in.
  - Admin bar: the Home icon opens the public site; the New menu; the user menu.
  - Screen Options controls which elements show; widgets can be hidden there and dragged to rearrange. Layout varies with plugins, hosting and configuration.
  - Widgets: At a Glance (counts of pages, posts, comments, plus theme and WordPress version), Activity, Quick Draft (saves a draft), WordPress Events and News.
  - Sidebar: content items at the top; functionality, appearance and settings grouped at the bottom.
  - Posts: dynamic content, reverse chronological. Pages: static content such as About or Contact. Media holds images, audio, spreadsheets and PDFs. Comments can be approved, replied to, marked as spam, trashed.
  - Appearance: change theme; block themes provide the Site Editor. Plugins: install and manage. Users: roles subscriber, contributor, author, editor, administrator.
  - Trash keeps items recoverable "up to 30 days".
- https://learn.wordpress.org/lesson/understanding-the-difference-between-wordpress-posts-and-pages/
  - "Posts are for dynamic, regularly updated content entries that are displayed in reverse chronological order." Pages are "static, timeless content that doesn't change frequently."
  - Post examples: blog articles, news, reviews, recipes. Page examples: Home, Services, About, Contact.
  - Posts can be drafted, published or scheduled. Categories are like "the table of contents for your blog"; tags are "more specific keywords". "Unlike posts, pages don't have categories or tags."
- https://learn.wordpress.org/lesson/creating-posts-and-pages-with-the-wordpress-block-editor/
  - Blocks are the building units of content: "build your site with blocks, no code required." Paragraphs, images, columns, galleries.
  - Add a block with the Inserter (top left, or inside the page) or by typing `/` and the block name, then Enter.
  - A selected block shows a toolbar (transform, move, alignment, bold, italic, link); the right sidebar holds the selected block's settings.
  - Gap: the lesson does not cover the Code editor. That comes from the WordPress Block Editor doc and the keyboard shortcuts doc.

### WordPress user documentation (wordpress.org/documentation)
- https://wordpress.org/documentation/article/dashboard-screen/
  - Default widgets: At a Glance, Activity (scheduled posts, recently published posts, recent comments), Quick Draft, WordPress Events and News, Welcome. Screen Options shows or hides each widget.
- https://wordpress.org/documentation/article/administration-screens/
  - Toolbar: the site name links to the site ("View Site"/"Visit Site" on hover). Screen Options and Help are hanging tabs under the toolbar.
  - Menu: Posts, Media, Pages, Comments, Appearance (Appearance > Editor for block themes), Plugins, Users, Tools (Import, Export, Site Health), Settings (General: site title; Reading: front page shows latest posts or a static page).
- https://wordpress.org/documentation/article/create-pages/
  - Pages are for non-chronological, timeless content; they can be organised into parent pages and subpages; by default they have no categories or tags; they are not included in feeds; a page can be set as a static front page.
- https://wordpress.org/documentation/article/wordpress-block-editor/
  - The three-dots Options menu has an Editor section: "By default, you will be in the Visual editor. Switch to the Code editor to view the entire post or page in the HTML code editor."
- https://wordpress.org/documentation/article/keyboard-shortcuts-block-editor/ (updated 2026-09-14)
  - Switch between visual editor and code editor: **Ctrl + Shift + Alt + M** (Windows) or **⇧ + ⌥ + ⌘ + M** (Mac).

### Block Editor Handbook (developer.wordpress.org)
- https://developer.wordpress.org/block-editor/explanations/architecture/key-concepts/
  - Blocks are serialized as HTML with comment delimiters, e.g. `<!-- wp:paragraph {"key": "value"} -->` … `<!-- /wp:paragraph -->`; the opening comment can carry a JSON object of attributes; a block is either a self-closing comment or an opening and closing pair.
- https://developer.wordpress.org/block-editor/explanations/architecture/data-flow/
  - Self-closing (purely dynamic) blocks use one comment ending in `/-->`.
- https://developer.wordpress.org/block-editor/reference-guides/block-api/block-edit-save/ (Validation), read but not cited by the lesson
  - The editor marks a block invalid only when its regenerated markup doesn't match the stored markup. For the lesson 3 bug it does match (the paragraph's own HTML is intact), so no invalid-block warning appears. See "Changes from the plan outline".
- https://developer.wordpress.org/block-editor/reference-guides/core-blocks/
  - `core/heading` attributes include `content` and `level`; `core/paragraph` attributes include `content`, `dropCap`, `direction`.

### Learn WordPress: Beginner WordPress User (lessons 4 and 6)
- https://learn.wordpress.org/lesson/what-is-the-difference-between-the-block-editor-and-site-editor/
  - Block editor: content of individual pages and posts ("the foundation of your site's content"). Site Editor: the site as a whole, templates such as header, footer and sidebar; Navigation, Styles, Pages, Templates, Patterns. "We don't add content to templates." Reached through Appearance > Editor with a block theme.
- https://learn.wordpress.org/lesson/intro-to-the-site-editor/ (modified 2026-03-31)
  - Appearance > Editor. Navigation: view and edit menus, reorder, three dots to rename, duplicate or delete; changes sync across the site. Pages: content goes in the Content block; header and footer are edited through the template. Templates control layout and usually include header and footer template parts. Patterns holds synced patterns and template parts.
- https://learn.wordpress.org/lesson/setting-up-your-pages-posts-site-logo-and-navigation-menu/
  - The header's menu defaults to a page list; pages are added automatically when you create them. Selecting the menu and choosing Edit detaches the page list so items can be managed one by one.
- https://learn.wordpress.org/lesson/wordpress-essentials-domains-and-hosting/
  - Domain: "the unique web address that visitors type into their browsers to find your site." Host: "a service that stores your website's files and makes them accessible to users on the internet." Mobile home analogy (domain = address, host = land). Choose for reliability, scalability, security (SSL certificates and regular backups), ease of use and affordability. Some hosts register a domain and install WordPress in one process. You can switch hosts and keep your domain.
- https://learn.wordpress.org/lesson/basic-wordpress-settings/
  - Settings > General: site title and tagline; "remember to add your tagline even though you might decide not to display it"; search engines read both. Settings > Reading: latest posts or a static page.
- https://learn.wordpress.org/lesson/how-to-find-help-with-wordpress-2/
  - Support forums (search, or post in Fixing WordPress / Everything else WordPress), each theme's or plugin's own support forum, the WordPress documentation, Learn WordPress.
- https://learn.wordpress.org/course/beginner-wordpress-user/
  - Later lessons cover the Media Library, block patterns, security, spam, backups, SEO and headings for accessibility and SEO (lesson 6's "what next" list).

### Learn WordPress: AI-Powered WordPress (lesson 5)
- https://learn.wordpress.org/course/ai-powered-wordpress/
  - Course title "AI-Powered WordPress". Introduces "AI features built into WordPress 7.0 and the canonical AI plugin". The course page lists a publication date of 3 September 2026 (modified 27 September 2026); the brief's 18 September launch date may be the announcement. Not material to the lesson, which gives no date.
- https://learn.wordpress.org/lesson/what-is-wordpress-ai/ (published 2026-09-04)
  - WordPress 7.0 "introduced native AI capabilities directly into core": the AI Client (7.0+) and the Abilities API (6.9+). The AI plugin and the MCP Adapter are separate installs. The AI Client is a "messenger"; the provider does "the thinking". Cloud providers: Anthropic (Claude), Google (Gemini), OpenAI (GPT), needing an API key and possibly costing money. Local: Ollama, llama.cpp, needing capable hardware. Set up once at Settings > Connectors; every plugin using the AI Client shares the credentials.
- https://learn.wordpress.org/lesson/installing-the-ai-plugin-and-connecting-a-provider/
  - The plugin is called "AI", by the WordPress.org team, free. Settings > Connectors lists Anthropic, Google, OpenAI with Install; each connector is a small plugin; after install a key field appears. Features are switched on at Settings > AI; start with one or two.
- https://learn.wordpress.org/lesson/writing-assistance-titles-excerpts-and-summaries/
  - Toggles under Settings > AI > Editor Experiments. Title Generation: "Generate" button above the title, suggestions in a modal, "Select". Excerpt Generation: "Generate Excerpt". Content Summarization: inserts a Content Summary block you can move, edit or delete. Content Resizing: Shorten, Expand, Rephrase. Translation: "read it closely before you publish".
- https://learn.wordpress.org/lesson/generating-alt-text-for-images/
  - On upload, "the alt text field is pre-populated". "AI-generated alt text is a draft." The model can misidentify objects or miss context; good alt text "conveys meaning, not just content"; decorative images should have empty alt text, the plugin still generates one and "it is your job to clear it". Playground can't generate alt text.
- https://learn.wordpress.org/lesson/reviewing-and-improving-content-with-editorial-tools/
  - Editorial Notes: notes per block in Accessibility, Readability, Grammar, SEO. AI suggestions are "a starting point, not a final answer". Grammar notes may flag deliberate choices; check against your voice. Needs a live provider; can't be tested in Playground.
- https://learn.wordpress.org/lesson/building-ai-into-your-publishing-workflow/
  - "AI-generated titles, excerpts, and replies are starting points." "Reading the post once more after applying is not optional."
- Gap: none of the course lessons fetched says to verify facts in general. The lesson's "Check names, dates, prices" line is framed as what the reading looks for, introduced by the alt text lesson's sourced warning that the model can misidentify things. It makes no claim about a WordPress feature.

### Other sources for lesson 5
- https://make.wordpress.org/core/2026/03/18/introducing-the-connectors-api-in-wordpress-7-0/ (Greg Ziółkowski, 2026-03-18)
  - "Registered connectors appear on a new Settings > Connectors admin screen", as cards. Featured connectors: Anthropic, Google, OpenAI. Key lookup order: environment variable, PHP constant, database; database keys "are not encrypted" but masked in the UI.
- https://make.wordpress.org/core/2026/05/14/wordpress-7-0-field-guide/
  - WP AI Client is "a central interface that lets plugins communicate with generative AI models". Connectors screen under Settings > Connectors with three default providers. The field guide lists no user-facing AI writing feature in core. So the lesson says core has the plumbing, and the writing features come from the AI plugin.
- https://wordpress.org/plugins/ai/ (version 1.4.0, updated 2026-10-05, tested up to 7.1.3)
  - Experiments are opt-in under Settings > AI: Alt Text Generation, Content Resizing, Content Summarization, Content Translation, Editorial Notes, Editorial Updates, Excerpt Generation, Title Generation, Type-Ahead Text and more. The plugin is experimental and may change; test on a staging site first. Features need manual triggering.

### WordPress user documentation (lessons 4 and 6)
- https://wordpress.org/documentation/article/site-editor/ (updated 2026-09-14, content for 7.1)
  - Site Editor is "only" available with a block theme; Appearance > Editor. Menu items: Identity (title, tagline, logo, icon), Styles, Pages, Navigation, Patterns (synced patterns and template parts), Templates (including search results and 404). Save lists all synced patterns, navigation menus, templates and template parts you changed; you can save all or some; header and footer changes apply to every page using them. Back chevron; the WordPress toolbar stays visible in 7.1.
- https://wordpress.org/documentation/article/navigation-block/ (updated 2026-10-08, overhauled for 7.1)
  - With no existing menu, the Navigation block starts with a Page List, which "automatically displays your published pages and adds newly published pages to the menu". Choosing Edit converts it to Page Link blocks; "After the conversion, newly published pages are no longer added to the menu automatically." Custom links and submenus can be added. Overlay can collapse the menu into an icon on mobile.
- https://wordpress.org/documentation/article/site-editor-navigation/ (checked 2026-10-22; added to lesson 4's sources in the final fix wave)
  - Appearance > Editor > Navigation lists all your menus; you can rename, duplicate or delete a menu, reorder or delete items, and open Focus Mode to edit a menu in full. Only available with a block theme. Changes must be saved. A menu made there only shows on the site once a Navigation block in a template part (such as the Header) uses it.
- https://wordpress.org/documentation/article/wordpress-block-editor/ (updated 2026-09-14)
  - Top toolbar: Save draft (hidden once published), View, Publish ("Make your post/page available publicly"), View Page after publishing.
- https://wordpress.org/documentation/article/page-post-settings-sidebar/
  - Status: Draft, Pending, Private (only site admins and editors), Scheduled, Published, Password protected. Publish date can schedule.
- https://wordpress.org/documentation/article/settings-reading-screen/
  - "Discourage search engines from indexing this site" asks search engines not to index; "it is up to search engines to honor your request"; it allows normal visitors.

### WordPress and Gutenberg source
- https://raw.githubusercontent.com/WordPress/gutenberg/trunk/packages/block-library/src/heading/block.json and `save.jsx`
  - `level` defaults to `2`; the block supports `className`, so saved markup is `<h2 class="wp-block-heading">…</h2>`. (Older markup without the class is accepted through the block's deprecations, which is why the checkpoint doesn't require the class.)
  - `level` is a comment attribute, and `save.jsx` builds the tag from it (`'h' + level`). So `<h3>` under a bare `<!-- wp:heading -->` doesn't match what the block saves, and the editor marks it invalid. The checkpoint accepts a bare opener with `<h2>`, or an opener whose JSON has `"level":N` (2 to 6) with `<hN>` (fix round 1). Inline markup inside the heading and paragraph is allowed.
- https://raw.githubusercontent.com/WordPress/gutenberg/trunk/packages/block-library/src/paragraph/block.json and `save.jsx`
  - `className` support is `false`, so a plain paragraph saves as `<p>…</p>` with no class.
- https://raw.githubusercontent.com/WordPress/wordpress-develop/trunk/src/wp-includes/class-wp-block-parser.php
  - A `block-opener` is pushed on a stack; a later opener before any closer becomes an inner block of the first; at the end of the document, unclosed blocks get "an implicit closer". So a paragraph that is missing `<!-- /wp:paragraph -->` swallows the blocks after it. This is the basis of the lesson 3 bug.

### Checked in WordPress Playground (WordPress 7.1.3, Twenty Twenty-Five)
- Pages written by the site preview appear under Pages; `pages/home.html` is listed as "Home — Front Page".
- Pretty permalinks are on: `/about/` opens the About page.
- The editor's Options menu has an Editor section with "Visual editor" and "Code editor" (shortcut shown as ⇧⌥⌘M); the Code editor has an "Exit code editor" link.
- With the lesson 3 bug: the public About page shows both paragraphs. In the visual editor only the first paragraph shows, with no warning. The Code editor shows the second paragraph nested inside the first, with two closing comments at the end.
- The site preview now boots logged in (`login: true` for the site kind, ruling R7, fix round 1), so lesson 1 opens on the dashboard and lesson 2 on Pages. Lesson 1's copy no longer explains logging in.
- At the preview's narrow width the admin menu collapses behind a menu button and the toolbar's site link is a house icon.
- Lessons 4 to 6 (Task 6, WordPress 7.1.3, Twenty Twenty-Five, in the lesson preview and a local `@wp-playground/cli` server):
  - The Site Editor's menu reads Identity, Styles, Pages, Navigation, Patterns, Templates. At the preview's narrow width there is no live canvas beside it, so lesson 4 says the menu takes the whole width there.
  - In WordPress 7.1 the page-editing view (Site Editor > Pages, or the block editor) doesn't show the header by default, so the Learn lesson's "Edit your template to edit this block" step couldn't be reproduced. Lesson 4 makes no claim about it.
  - The header menu on the front end shows About, Home, Sample Page with no menu set up: the Page List fallback. Navigation in the Site Editor shows the menu's items.
  - Settings > Connectors exists in core at `/wp-admin/options-connectors.php` with no plugin installed: "All of your API keys and credentials are stored here and shared across plugins. Configure once and use everywhere.", a banner "The AI plugin can use your AI connectors to generate featured images, alt text, titles, excerpts and more.", then Anthropic, Google and OpenAI with Install. (A local CLI site also listed Akismet; the lesson preview doesn't, so the lesson doesn't mention it.) Settings > AI does not exist without the plugin.
  - Publishing a page: Publish opens "Are you ready to publish?" / "Double-check your settings before publishing." with Visibility: Public and Publish: Immediately, then "… is now live." with the page address, Copy and View Page. Afterwards the button reads Save. The Status & visibility popover lists Draft, Pending, Private ("Only visible to site admins and editors."), Scheduled, Published, Password protected.

## Changes from the plan outline

- None to titles, order, counts, preview kind or bug placement. Lesson 1's title is "What WordPress is, and a tour of the dashboard"; lesson 2's is "Posts and pages, and when to use which"; lesson 3's is "Blocks, and the Code editor view".
- **The bug's symptom differs from the brief.** The brief expected "the editor reports invalid content". In WordPress 7.1.3 it doesn't: the parser nests the second paragraph inside the first, the first paragraph's own markup is still valid, and the editor silently hides the second paragraph. The lesson and the bug explanation describe what really happens ("visitors still see both paragraphs, but in the editor the second one disappears"). The bug, its file and its place in lesson 3 are unchanged.
- Lesson 3's `landing` is `/about/`, so the learner sees their About page change after Apply to site. An editor URL would need the page's ID, which isn't fixed.
- The block-edit-save Validation page was replaced in lesson 3's sources by the Data flow page, since the lesson no longer makes a validation claim.
- Lesson 3's checkpoint branches all targeted `ln-blocks` at first, because lesson 4 didn't exist yet. Task 6 pointed advance and skip at lesson 4.
- **Task 6, lessons 4 to 6.** Titles: "The Site Editor, and your site's menu"; "AI in WordPress 7, and checking what it writes"; "Publishing, and what comes next". Order, counts, preview kind and checkpoint kinds (free-text, free-text, none) are as planned.
- **Lesson 5's scope.** Core WordPress 7 has the AI Client and the Settings > Connectors screen, but no built-in writing features: titles, excerpts, summaries, alt text and editorial notes come from the official AI plugin (field guide, course and plugin page agree). The lesson says exactly that, rather than calling the writing features "built-in". The title reads "AI in WordPress 7" for the same reason.
- **Lesson 5 has a `landing`** (`/wp-admin/options-connectors.php`), which the outline left blank: the Connectors screen exists in core, so the learner can see it. The learner isn't asked to connect a provider: there's no key, and the AI plugin isn't installed in the preview, so nothing can be generated there.
- **Lesson 6 has no `landing`**, so its preview opens the front page, where the learner's menu and pages show.
- Lesson 3's advance and skip branches now go to `ln-navigation-and-site-editor`; their messages lead into lesson 4. Lessons 4 and 5 send advance and skip to the next lesson, as the block theme path's later lessons do.
- `path.yaml` `finalFiles` is unchanged: lessons 4 to 6 add no page files and no checks.

## Checklist

- [x] **01 What WordPress is, and a tour of the dashboard** (`ln-what-is-wordpress`)
  - CMS, free and open source, the 40% figure, themes and plugins match Introduction to WordPress.
  - `/wp-admin`, the widgets and Screen Options match the dashboard lesson and the Dashboard screen doc.
  - The menu descriptions match the dashboard lesson and Administration Screens (Tools and Settings come from the doc, which the lesson leaves for later).
  - Checked in Playground (7.1.3): the dashboard, toolbar and widgets; at the preview's narrow width the menu sits behind the menu button and the toolbar shows a house icon for the site.
- [x] **02 Posts and pages** (`ln-posts-and-pages`)
  - Purpose, examples, dates, categories and tags match the posts-and-pages lesson.
  - Parent pages, no taxonomies and no feeds match Create pages.
  - Quick Edit fields and the 30-day trash match Create pages and the dashboard lesson.
  - "Home — Front Page" in the Pages list and Settings > Reading match Administration Screens and were seen in Playground.
- [x] **03 Blocks, and the Code editor view** (`ln-blocks`)
  - Inserter, slash command, block toolbar and settings sidebar match the block editor lesson.
  - Options menu > Code editor and the shortcuts match the Block Editor and keyboard shortcuts docs.
  - Comment delimiters, attributes JSON and self-closing blocks match Key concepts and Data flow.
  - Heading level 2 default and `wp-block-heading` class match the Gutenberg source.
  - The heading check ties the tag to the `level` attribute (fix round 1); cases in `tests/content/learner-checks.test.ts`.
  - The missing-closer wording follows the parser: later blocks nest inside the unclosed one, the next closer closes the nested block, and the unclosed block runs to the end (fix round 1).
  - The missing-closer behaviour matches the core parser and was seen in Playground: hidden in the visual editor, nested in the Code editor, both paragraphs on the public page.

- [x] **04 The Site Editor, and your site's menu** (`ln-navigation-and-site-editor`)
  - Block editor vs Site Editor, Appearance > Editor and the block-theme requirement match the difference lesson and the Site Editor doc.
  - The six menu items match the Site Editor doc and were seen in 7.1.3.
  - Templates, template parts, "you don't write content into a template" and Save listing changed items match the Intro lesson and the Site Editor doc.
  - Page List fallback, Edit converting to Page Links and new pages no longer added match the Navigation block doc and the navigation lesson; the About page in the menu was seen in the preview.
  - Site Editor > Navigation as the place to manage menus matches the Site Editor navigation doc, now listed in the lesson's sources.
  - Checkpoint rubric matches the beats (Site Editor Navigation or the header's Navigation block; shared header or menu). Checked in the browser: a single-page answer goes to review, a Site Editor answer advances.
- [x] **05 AI in WordPress 7, and checking what it writes** (`ln-ai-in-wordpress`)
  - AI Client, providers, API keys, costs, local models and shared credentials match What is WordPress AI? and the field guide.
  - Settings > Connectors, its cards and the banner were seen in the preview; unencrypted, masked keys match the Connectors API dev note.
  - The AI plugin's features, Settings > AI, opt-in experiments and "experimental" match the plugin page and the writing, alt text and editorial lessons.
  - "Nothing runs until you switch a feature on, and most only run when you click" (final fix wave): the earlier "Nothing runs until you ask" contradicted alt text being pre-populated on upload. Features are opt-in under Settings > AI, and most need a click; alt text fills in on upload once switched on.
  - The connectors beat now says "There's no key, and the AI plugin isn't installed here, so nothing can be generated in this practice site" (final fix wave), stating why from what's in the preview rather than crediting the course with a Playground claim.
  - The three quotes are verbatim from the editorial tools, alt text and workflow lessons. The alt text advice matches the alt text lesson.
  - Every WordPress 7 AI feature named is sourced; nothing about features the sources don't confirm.
  - Checkpoint checked in the browser: "publish it as it is" goes to review, a two-check answer with a reason advances.
- [x] **06 Publishing, and what comes next** (`ln-publish`)
  - Save draft, View, Publish, the pre-publish check, "is now live" and Save afterwards match the Block Editor doc and were seen in 7.1.3.
  - Status options match the Settings sidebar doc and the 7.1.3 popover.
  - Tagline and Discourage search engines match Basic settings and the Reading screen doc.
  - Domain, hosting and choosing a host match the domains and hosting lesson. The paste-into-Code-editor step matches the finale's "Make it a real site" copy.
  - Help sources match How to find help; the "what next" topics are later lessons in Beginner WordPress User.
  - No checkpoint; the lesson completes at the end of its beats and links to `/finale/learner` (checked in the browser).

## Finale reference pages

`content/paths/learner/path.yaml` `finalFiles` holds `pages/home.html` (the read-only front page) and `pages/about.html` (lesson 3's intended answer). `scripts/build-content.ts` fails the build unless they pass every lesson's checks. Both use only `core/heading` and `core/paragraph` markup as their save functions output it.
