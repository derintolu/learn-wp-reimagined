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
  'bug-paragraph-closer': { 'pages/about.html': `<!-- wp:paragraph -->
<p>Hi there. This is my first WordPress site, and I'm building it myself.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>I'm learning as I go, so expect it to change a lot.</p>
<!-- /wp:paragraph -->
` },
  'cp-about-heading-code': { 'pages/about.html': `<!-- wp:paragraph -->
<p>Hi there. This is my first WordPress site, and I'm building it myself.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>I'm learning as I go, so expect it to change a lot.</p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2 class="wp-block-heading">What I'm working on</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Right now, I'm learning how blocks work.</p>
<!-- /wp:paragraph -->
` },
  'bug-filter-echo': { 'my-first-plugin/my-first-plugin.php': `<?php
/**
 * Plugin Name: My First Plugin
 * Description: My first WordPress plugin, built with Learn WordPress, reimagined.
 * Version: 1.0.0
 * Requires at least: 6.6
 * Requires PHP: 7.4
 * Author: You
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: my-first-plugin
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Stop if this file is opened directly, outside WordPress.
}

/**
 * Add a short thank-you note to the end of every post.
 */
function my_first_plugin_add_note( $content ) {
	$note = '<p class="my-first-plugin-note">Thanks for reading! This note was added by my first plugin.</p>';

	return $content . $note;
}
add_filter( 'the_content', 'my_first_plugin_add_note' );
` },
  'cp-enqueue-style-code': { 'my-first-plugin/my-first-plugin.php': `<?php
/**
 * Plugin Name: My First Plugin
 * Description: My first WordPress plugin, built with Learn WordPress, reimagined.
 * Version: 1.0.0
 * Requires at least: 6.6
 * Requires PHP: 7.4
 * Author: You
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: my-first-plugin
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Stop if this file is opened directly, outside WordPress.
}

/**
 * Add a short thank-you note to the end of every post.
 */
function my_first_plugin_add_note( $content ) {
	$note = '<p class="my-first-plugin-note">Thanks for reading! This note was added by my first plugin.</p>';

	return $content . $note;
}
add_filter( 'the_content', 'my_first_plugin_add_note' );

/**
 * Load the plugin's stylesheet on the front of the site.
 */
function my_first_plugin_enqueue_styles() {
	wp_enqueue_style( 'my-first-plugin', plugins_url( 'style.css', __FILE__ ), array(), '1.0.0' );
}
add_action( 'wp_enqueue_scripts', 'my_first_plugin_enqueue_styles' );
` },
  'bug-unescaped-name': { 'my-first-plugin/my-first-plugin.php': `<?php
/**
 * Plugin Name: My First Plugin
 * Description: My first WordPress plugin, built with Learn WordPress, reimagined.
 * Version: 1.0.0
 * Requires at least: 6.6
 * Requires PHP: 7.4
 * Author: You
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: my-first-plugin
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Stop if this file is opened directly, outside WordPress.
}

/**
 * Add a short thank-you note to the end of every post.
 */
function my_first_plugin_add_note( $content ) {
	$note = '<p class="my-first-plugin-note">Thanks for reading! This note was added by my first plugin.</p>';

	// Greet the visitor by name when the link ends in ?reader=Something.
	if ( isset( $_GET['reader'] ) ) {
		$reader = $_GET['reader'];
		$note = '<p class="my-first-plugin-note">Thanks for reading, ' . esc_html( $reader ) . '! This note was added by my first plugin.</p>';
	}

	return $content . $note;
}
add_filter( 'the_content', 'my_first_plugin_add_note' );

/**
 * Load the plugin's stylesheet on the front of the site.
 */
function my_first_plugin_enqueue_styles() {
	wp_enqueue_style( 'my-first-plugin', plugins_url( 'style.css', __FILE__ ), array(), '1.0.0' );
}
add_action( 'wp_enqueue_scripts', 'my_first_plugin_enqueue_styles' );
` },
  'cp-sanitize-name-code': { 'my-first-plugin/my-first-plugin.php': `<?php
/**
 * Plugin Name: My First Plugin
 * Description: My first WordPress plugin, built with Learn WordPress, reimagined.
 * Version: 1.0.0
 * Requires at least: 6.6
 * Requires PHP: 7.4
 * Author: You
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: my-first-plugin
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Stop if this file is opened directly, outside WordPress.
}

/**
 * Add a short thank-you note to the end of every post.
 */
function my_first_plugin_add_note( $content ) {
	$note = '<p class="my-first-plugin-note">Thanks for reading! This note was added by my first plugin.</p>';

	// Greet the visitor by name when the link ends in ?reader=Something.
	if ( isset( $_GET['reader'] ) ) {
		$reader = sanitize_text_field( wp_unslash( $_GET['reader'] ) );
		$note = '<p class="my-first-plugin-note">Thanks for reading, ' . esc_html( $reader ) . '! This note was added by my first plugin.</p>';
	}

	return $content . $note;
}
add_filter( 'the_content', 'my_first_plugin_add_note' );

/**
 * Load the plugin's stylesheet on the front of the site.
 */
function my_first_plugin_enqueue_styles() {
	wp_enqueue_style( 'my-first-plugin', plugins_url( 'style.css', __FILE__ ), array(), '1.0.0' );
}
add_action( 'wp_enqueue_scripts', 'my_first_plugin_enqueue_styles' );
` },
  'cp-theme-json-filter-code': { 'my-first-plugin/my-first-plugin.php': `<?php
/**
 * Plugin Name: My First Plugin
 * Description: My first WordPress plugin, built with Learn WordPress, reimagined.
 * Version: 1.0.0
 * Requires at least: 6.6
 * Requires PHP: 7.4
 * Author: You
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: my-first-plugin
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Stop if this file is opened directly, outside WordPress.
}

/**
 * Add a short thank-you note to the end of every post.
 */
function my_first_plugin_add_note( $content ) {
	$note = '<p class="my-first-plugin-note">Thanks for reading! This note was added by my first plugin.</p>';

	// Greet the visitor by name when the link ends in ?reader=Something.
	if ( isset( $_GET['reader'] ) ) {
		$reader = sanitize_text_field( wp_unslash( $_GET['reader'] ) );
		$note = '<p class="my-first-plugin-note">Thanks for reading, ' . esc_html( $reader ) . '! This note was added by my first plugin.</p>';
	}

	return $content . $note;
}
add_filter( 'the_content', 'my_first_plugin_add_note' );

/**
 * Load the plugin's stylesheet on the front of the site.
 */
function my_first_plugin_enqueue_styles() {
	wp_enqueue_style( 'my-first-plugin', plugins_url( 'style.css', __FILE__ ), array(), '1.0.0' );
}
add_action( 'wp_enqueue_scripts', 'my_first_plugin_enqueue_styles' );

/**
 * Give the theme's headings the purple from its own palette.
 */
function my_first_plugin_theme_json( $theme_json ) {
	$new_data = array(
		'version' => 3,
		'styles'  => array(
			'elements' => array(
				'heading' => array(
					'color' => array(
						'text' => 'var:preset|color|accent-3',
					),
				),
			),
		),
	);

	return $theme_json->update_with( $new_data );
}
add_filter( 'wp_theme_json_data_theme', 'my_first_plugin_theme_json' );
` },
};
