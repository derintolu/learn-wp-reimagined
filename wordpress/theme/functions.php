<?php
/**
 * Learn WordPress, reimagined: Blog theme.
 *
 * @package lwr-blog
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'wp_enqueue_scripts',
	static function () {
		$theme = wp_get_theme();
		wp_enqueue_style( 'lwr-blog', get_stylesheet_uri(), array(), $theme->get( 'Version' ) );
	}
);

add_action(
	'after_setup_theme',
	static function () {
		add_editor_style( 'style.css' );
	}
);

/**
 * Mark the header's Blog link as current on blog views. The header nav is
 * static HTML (it links into the app, not to WordPress pages), so core's
 * navigation block can't work this out on its own.
 */
add_filter(
	'render_block_core/html',
	static function ( $content ) {
		if ( ! str_contains( $content, 'data-lwr-blog-link' ) ) {
			return $content;
		}
		if ( is_home() ) {
			$current = 'page';
		} elseif ( is_singular( 'post' ) || is_category() || is_tag() || is_author() || is_date() ) {
			$current = 'true';
		} else {
			return $content;
		}
		return str_replace( 'data-lwr-blog-link', 'data-lwr-blog-link aria-current="' . $current . '"', $content );
	}
);

/**
 * Author archives are not part of this site: the blog lives in the app at /blog. Send them there, and keep
 * user URLs out of the public sitemap.
 */
add_action(
	'template_redirect',
	static function () {
		if ( is_author() ) {
			wp_safe_redirect( home_url( '/blog' ), 301 );
			exit;
		}
	}
);

add_filter(
	'wp_sitemaps_add_provider',
	static function ( $provider, $name ) {
		return 'users' === $name ? false : $provider;
	},
	10,
	2
);
