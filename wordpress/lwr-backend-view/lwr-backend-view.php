<?php
/**
 * Plugin Name: LWR Backend View
 * Description: Banner on Sensei course and lesson screens in wp-admin that links back to the studio, and a read-only public route the studio's backend view reads. Part of an unofficial concept.
 * Version: 0.3.0
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
const LWR_BACKEND_VIEW_VERSION = '0.3.0';

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

/**
 * The published course or lesson with this key, or null. The key is Learning Ledger's stable key, else the slug.
 * Spacefast's runtime empties anonymous post queries (wp/v2 answers spacefast_content_not_found, see the lwr-blog
 * route), so the IDs come straight from the posts table. Published, unprotected posts only: never drafts or private.
 */
function lwr_backend_view_find( string $type, string $key ): ?WP_Post {
	global $wpdb;
	$base = "SELECT p.ID FROM {$wpdb->posts} p";
	$where = " p.post_type = %s AND p.post_status = 'publish' AND p.post_password = ''";
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.DirectDatabaseQuery -- fixed SQL, values prepared.
	$id = $wpdb->get_var(
		$wpdb->prepare( "$base INNER JOIN {$wpdb->postmeta} m ON m.post_id = p.ID AND m.meta_key = '_lledger_stable_key' AND m.meta_value = %s WHERE $where ORDER BY p.ID LIMIT 1", $key, $type )
	);
	if ( ! $id ) {
		$id = $wpdb->get_var( $wpdb->prepare( "$base WHERE $where AND p.post_name = %s ORDER BY p.ID LIMIT 1", $type, $key ) );
	}
	// phpcs:enable
	$post = $id ? get_post( (int) $id ) : null;
	return ( $post instanceof WP_Post && 'publish' === $post->post_status ) ? $post : null;
}

/**
 * Published lessons of a course in Sensei's order (its per-course order meta, then menu order, then ID).
 *
 * @return array<int, array{id: int, key: string, title: string}>
 */
function lwr_backend_view_course_lessons( int $course_id ): array {
	global $wpdb;
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.DirectDatabaseQuery -- values prepared.
	$ids = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT p.ID FROM {$wpdb->posts} p
			INNER JOIN {$wpdb->postmeta} c ON c.post_id = p.ID AND c.meta_key = '_lesson_course' AND c.meta_value = %d
			LEFT JOIN {$wpdb->postmeta} o ON o.post_id = p.ID AND o.meta_key = %s
			WHERE p.post_type = 'lesson' AND p.post_status = 'publish' AND p.post_password = ''
			ORDER BY CAST(COALESCE(o.meta_value, '999999') AS UNSIGNED), p.menu_order, p.ID LIMIT 200",
			$course_id,
			'_order_' . $course_id
		)
	);
	// phpcs:enable
	$lessons = array();
	foreach ( $ids as $id ) {
		$lessons[] = array(
			'id'    => (int) $id,
			'key'   => lwr_backend_view_key( (int) $id ),
			'title' => get_the_title( (int) $id ),
		);
	}
	return $lessons;
}

/**
 * A read-only public response with a short cache.
 *
 * @param array<string, mixed>|null $data The body, or null for a 404.
 */
function lwr_backend_view_respond( ?array $data ): WP_REST_Response {
	$response = new WP_REST_Response( $data ?? array( 'code' => 'lwr_not_found' ), $data ? 200 : 404 );
	$response->header( 'Cache-Control', 'public, max-age=60' );
	$response->header( 'Vary', 'Accept-Encoding' );
	return $response;
}

/**
 * GET /wp-json/lwr-backend-view/v1/course/<key>.
 */
function lwr_backend_view_rest_course( WP_REST_Request $request ): WP_REST_Response {
	$post = lwr_backend_view_find( 'course', (string) $request->get_param( 'key' ) );
	if ( ! $post ) {
		return lwr_backend_view_respond( null );
	}
	return lwr_backend_view_respond(
		array(
			'id'      => (int) $post->ID,
			'key'     => lwr_backend_view_key( $post->ID ),
			'title'   => get_the_title( $post ),
			'content' => apply_filters( 'the_content', $post->post_content ), // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals -- core filter.
			'lessons' => lwr_backend_view_course_lessons( $post->ID ),
		)
	);
}

/**
 * GET /wp-json/lwr-backend-view/v1/lesson/<key>.
 */
function lwr_backend_view_rest_lesson( WP_REST_Request $request ): WP_REST_Response {
	$post = lwr_backend_view_find( 'lesson', (string) $request->get_param( 'key' ) );
	if ( ! $post ) {
		return lwr_backend_view_respond( null );
	}
	$course_id = (int) get_post_meta( $post->ID, '_lesson_course', true );
	$course    = $course_id ? get_post( $course_id ) : null;
	return lwr_backend_view_respond(
		array(
			'id'      => (int) $post->ID,
			'key'     => lwr_backend_view_key( $post->ID ),
			'title'   => get_the_title( $post ),
			'content' => apply_filters( 'the_content', $post->post_content ), // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals -- core filter.
			'course'  => ( $course instanceof WP_Post && 'publish' === $course->post_status ) ? lwr_backend_view_key( $course->ID ) : null,
		)
	);
}

/**
 * GET /wp-json/lwr-backend-view/v1/ids: post ids by stable key for the Learning Ledger program, the courses and
 * the lessons. Published, unprotected posts that carry the key meta only; on a duplicate key the lowest id wins.
 */
function lwr_backend_view_rest_ids(): WP_REST_Response {
	global $wpdb;
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.DirectDatabaseQuery -- fixed SQL, values prepared.
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT p.ID, p.post_type, m.meta_value AS skey FROM {$wpdb->posts} p
			INNER JOIN {$wpdb->postmeta} m ON m.post_id = p.ID AND m.meta_key = '_lledger_stable_key'
			WHERE p.post_type IN ( %s, %s, %s ) AND p.post_status = 'publish' AND p.post_password = ''
			ORDER BY p.ID LIMIT 500",
			'lledger_program',
			'course',
			'lesson'
		)
	);
	// phpcs:enable
	$groups = array(
		'program' => array(),
		'courses' => array(),
		'lessons' => array(),
	);
	$names  = array(
		'lledger_program' => 'program',
		'course'          => 'courses',
		'lesson'          => 'lessons',
	);
	foreach ( (array) $rows as $row ) {
		$group = $names[ $row->post_type ] ?? '';
		$key   = (string) $row->skey;
		if ( '' === $group || '' === $key || isset( $groups[ $group ][ $key ] ) ) {
			continue;
		}
		$groups[ $group ][ $key ] = (int) $row->ID;
	}
	// Objects, so an empty group is {} and not [].
	return lwr_backend_view_respond(
		array(
			'program' => (object) $groups['program'],
			'courses' => (object) $groups['courses'],
			'lessons' => (object) $groups['lessons'],
		)
	);
}

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'lwr-backend-view/v1',
			'/ids',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'lwr_backend_view_rest_ids',
				'permission_callback' => '__return_true',
			)
		);
		foreach ( array( 'course', 'lesson' ) as $type ) {
			register_rest_route(
				'lwr-backend-view/v1',
				'/' . $type . '/(?P<key>[A-Za-z0-9_.-]+)',
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => 'lwr_backend_view_rest_' . $type,
					'permission_callback' => '__return_true',
					'args'                => array(
						'key' => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				)
			);
		}
	}
);
