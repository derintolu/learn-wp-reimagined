/**
 * The learner's intended answer for every code checkpoint and planted bug, keyed by checkpoint id or bug id, then by file name.
 * tests/content/paths.test.ts runs these against the real content; every content task adds its entries here.
 */
export const SOLUTIONS: Record<string, Record<string, string>> = {
  'bug-palette-value-key': { 'theme.json': `{
  "$schema": "https://schemas.wp.org/trunk/theme.json",
  "version": 3,
  "settings": {
    "color": {
      "palette": [
        { "name": "Base", "slug": "base", "color": "#ffffff" },
        { "name": "Contrast", "slug": "contrast", "color": "#1e1e1e" },
        { "name": "Subtle", "slug": "subtle", "color": "#f0f0f0" }
      ]
    }
  }
}
` },
  'cp-settings-code': { 'theme.json': `{
  "$schema": "https://schemas.wp.org/trunk/theme.json",
  "version": 3,
  "settings": {
    "color": {
      "palette": [
        { "name": "Base", "slug": "base", "color": "#ffffff" },
        { "name": "Contrast", "slug": "contrast", "color": "#1e1e1e" },
        { "name": "Subtle", "slug": "subtle", "color": "#f0f0f0" },
        { "name": "Accent", "slug": "accent", "color": "#3858e9" }
      ]
    },
    "layout": {
      "contentSize": "40rem",
      "wideSize": "64rem"
    }
  }
}
` },
  'cp-header-part-code': { 'templates/index.html': `<!-- wp:template-part {"slug":"header","tagName":"header"} /-->

<!-- wp:group {"tagName":"main","layout":{"type":"constrained"}} -->
<main class="wp-block-group">
	<!-- wp:query {"query":{"perPage":10,"pages":0,"offset":0,"postType":"post","order":"desc","orderBy":"date","author":"","search":"","exclude":[],"sticky":"","inherit":true}} -->
	<div class="wp-block-query">
		<!-- wp:post-template -->
			<!-- wp:post-title {"isLink":true} /-->
			<!-- wp:post-excerpt /-->
		<!-- /wp:post-template -->

		<!-- wp:query-pagination -->
			<!-- wp:query-pagination-previous /-->
			<!-- wp:query-pagination-next /-->
		<!-- /wp:query-pagination -->

		<!-- wp:query-no-results -->
			<!-- wp:paragraph -->
			<p>Nothing to show yet.</p>
			<!-- /wp:paragraph -->
		<!-- /wp:query-no-results -->
	</div>
	<!-- /wp:query -->
</main>
<!-- /wp:group -->
` },
  'cp-global-styles-code': { 'theme.json': `{
  "$schema": "https://schemas.wp.org/trunk/theme.json",
  "version": 3,
  "settings": {
    "color": {
      "palette": [
        {
          "name": "Base",
          "slug": "base",
          "color": "#ffffff"
        },
        {
          "name": "Contrast",
          "slug": "contrast",
          "color": "#1e1e1e"
        },
        {
          "name": "Subtle",
          "slug": "subtle",
          "color": "#f0f0f0"
        },
        {
          "name": "Accent",
          "slug": "accent",
          "color": "#3858e9"
        }
      ]
    },
    "layout": {
      "contentSize": "40rem",
      "wideSize": "64rem"
    }
  },
  "styles": {
    "color": {
      "background": "var:preset|color|base",
      "text": "var:preset|color|contrast"
    },
    "elements": {
      "link": {
        "color": {
          "text": "var:preset|color|accent"
        }
      }
    }
  }
}` },
  'bug-pattern-header': { 'patterns/hero.php': `<?php
/**
 * Title: Hero
 * Slug: my-block-theme/hero
 * Categories: featured
 */
?>
<!-- wp:group {"tagName":"section","align":"full","layout":{"type":"constrained"}} -->
<section class="wp-block-group alignfull">
	<!-- wp:heading {"level":1} -->
	<h1 class="wp-block-heading">Hello from my block theme</h1>
	<!-- /wp:heading -->

	<!-- wp:paragraph -->
	<p>This section is a pattern. Insert it from the Patterns tab and make it your own.</p>
	<!-- /wp:paragraph -->
</section>
<!-- /wp:group -->
` },
};
