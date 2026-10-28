<?php
/**
 * Plugin Name: LWR Backend View
 * Description: Banner on Sensei course and lesson screens in wp-admin that links back to the studio. Part of an unofficial concept.
 * Version: 0.1.0
 * Requires at least: 6.4
 * Requires PHP: 8.0
 * Author: Learn WP Reimagined
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: lwr-backend-view
 *
 * @package LwrBackendView
 */

defined( 'ABSPATH' ) || exit;

const LWR_BACKEND_VIEW_STUDIO  = 'https://learnwp.sqwrlz.com';
const LWR_BACKEND_VIEW_VERSION = '0.1.0';

/**
 * The post type of the current admin screen when it is a Sensei course or lesson screen, else ''.
 */
function lwr_backend_view_post_type(): string {
	if ( ! function_exists( 'get_current_screen' ) ) {
		return '';
	}
	$screen = get_current_screen();
	if ( ! $screen || ! in_array( $screen->post_type, array( 'course', 'lesson' ), true ) ) {
		return '';
	}
	return $screen->post_type;
}

/**
 * Learning Ledger's stable key for a post, or the post slug when the meta is absent.
 */
function lwr_backend_view_key( int $post_id ): string {
	$key = (string) get_post_meta( $post_id, '_lledger_stable_key', true );
	if ( '' !== $key ) {
		return $key;
	}
	$post = get_post( $post_id );
	return $post ? (string) $post->post_name : '';
}

/**
 * Prints the banner on course and lesson list and edit screens.
 */
function lwr_backend_view_notice(): void {
	$type = lwr_backend_view_post_type();
	if ( '' === $type || ! current_user_can( 'edit_posts' ) ) {
		return;
	}

	$screen  = get_current_screen();
	$post_id = ( $screen && 'post' === $screen->base ) ? (int) get_the_ID() : 0;
	$key     = $post_id ? lwr_backend_view_key( $post_id ) : '';

	$is_lesson = 'lesson' === $type;
	$label     = $is_lesson
		? __( 'Take the lesson in the studio', 'lwr-backend-view' )
		: __( 'Take the course in the studio', 'lwr-backend-view' );
	// List screens and unsaved posts have no single item to link to, so they link to the studio home.
	$url = '' !== $key
		? LWR_BACKEND_VIEW_STUDIO . ( $is_lesson ? '/learn/' : '/path/' ) . rawurlencode( $key )
		: LWR_BACKEND_VIEW_STUDIO . '/';

	/* translators: %s: "lesson" or "course". */
	$copy = sprintf( __( "This is the backend view: Sensei's own page for this %s.", 'lwr-backend-view' ), $type );

	printf(
		'<div class="notice lwr-backend-view" role="region" aria-label="%1$s"><p class="lwr-backend-view__copy">%2$s</p><a class="lwr-backend-view__link" href="%3$s">%4$s</a><span class="lwr-backend-view__sticker">%5$s</span></div>',
		esc_attr__( 'Backend view', 'lwr-backend-view' ),
		esc_html( $copy ),
		esc_url( $url ),
		esc_html( $label ),
		esc_html__( 'unofficial concept', 'lwr-backend-view' )
	);
}
add_action( 'admin_notices', 'lwr_backend_view_notice' );

/**
 * Loads the banner styles on the same screens only.
 */
function lwr_backend_view_enqueue(): void {
	if ( '' === lwr_backend_view_post_type() ) {
		return;
	}
	wp_enqueue_style(
		'lwr-backend-view',
		plugins_url( 'banner.css', __FILE__ ),
		array(),
		LWR_BACKEND_VIEW_VERSION
	);
}
add_action( 'admin_enqueue_scripts', 'lwr_backend_view_enqueue' );
