<?php
/**
 * Plugin Name: LWR Blog CLI
 * Description: `wp lwr-blog put` creates or updates a blog post by slug from base64 chunks, because a remote WP-CLI argument holds at most 4,096 characters. `GET /wp-json/lwr-blog/v1/posts` serves published posts read-only, because Spacefast hides wp/v2 content from anonymous callers.
 * Version: 0.2.0
 * Requires PHP: 8.1
 * License: GPL-2.0-or-later
 *
 * Works as a must-use plugin or a regular one. The build packs it to
 * dist/plugin/lwr-blog-cli-<version>.zip, installed by URL like the theme:
 *   sf wp -- plugin install https://learnwp.sqwrlz.com/plugin/lwr-blog-cli-<version>.zip --activate --force
 *
 * @package lwr-blog-cli
 */

defined( 'ABSPATH' ) || exit;

/**
 * One published post as the app's /blog pages read it.
 *
 * @param WP_Post $post A published post.
 * @return array<string,mixed>
 */
function lwr_blog_rest_shape( WP_Post $post ): array {
	$GLOBALS['post'] = $post; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- the_content needs it.
	setup_postdata( $post );
	$shape = array(
		'id'       => $post->ID,
		'slug'     => $post->post_name,
		'title'    => get_the_title( $post ),
		'date'     => get_post_time( 'c', true, $post ),
		'modified' => get_post_modified_time( 'c', true, $post ),
		'excerpt'  => wp_strip_all_tags( get_the_excerpt( $post ) ),
		'content'  => apply_filters( 'the_content', $post->post_content ), // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- core hook.
		'author'   => get_the_author_meta( 'display_name', (int) $post->post_author ),
	);
	wp_reset_postdata();
	return $shape;
}

/**
 * GET /wp-json/lwr-blog/v1/posts[?slug=]: published posts, newest first. Read-only.
 *
 * @param WP_REST_Request $request The request.
 */
function lwr_blog_rest_posts( WP_REST_Request $request ): WP_REST_Response {
	$query = array(
		'post_type'        => 'post',
		'post_status'      => 'publish',
		'has_password'     => false,
		'posts_per_page'   => 100,
		'orderby'          => 'date',
		'order'            => 'DESC',
		'no_found_rows'    => true,
		'suppress_filters' => true,
	);
	$slug = (string) $request->get_param( 'slug' );
	if ( '' !== $slug ) {
		$query['name']           = $slug;
		$query['posts_per_page'] = 1;
	}
	$posts    = array_map( 'lwr_blog_rest_shape', get_posts( $query ) );
	$response = new WP_REST_Response( $posts, 200 );
	$response->header( 'Cache-Control', 'public, max-age=60, stale-while-revalidate=600' );
	$response->header( 'Vary', 'Accept-Encoding' );
	return $response;
}

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'lwr-blog/v1',
			'/posts',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'lwr_blog_rest_posts',
				'permission_callback' => '__return_true',
				'args'                => array(
					'slug' => array(
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_title',
					),
				),
			)
		);
	}
);

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

/**
 * Creates or updates a post by slug. The body arrives as base64 chunks, concatenated in order.
 *
 * ## OPTIONS
 *
 * <slug>
 * : The post slug.
 *
 * <title>
 * : The post title.
 *
 * <excerpt>
 * : The post excerpt.
 *
 * <status>
 * : draft, pending, private or publish.
 *
 * <chunk>...
 * : The post content (block markup), base64-encoded, in one or more chunks.
 *
 * [--author=<id>]
 * : The author's user ID. Defaults to the existing post's author, or user 1 for a new post.
 *
 * @param string[]             $args  Positional arguments.
 * @param array<string,string> $assoc Named arguments.
 */
function lwr_blog_cli_put( array $args, array $assoc ): void {
	if ( count( $args ) < 5 ) {
		WP_CLI::error( 'usage: wp lwr-blog put <slug> <title> <excerpt> <status> <chunk1> [<chunk2>...]' );
	}
	[ $slug, $title, $excerpt, $status ] = $args;

	if ( sanitize_title( $slug ) !== $slug ) {
		WP_CLI::error( "slug '$slug' is not a valid post slug" );
	}
	if ( ! in_array( $status, array( 'draft', 'pending', 'private', 'publish' ), true ) ) {
		WP_CLI::error( "status must be draft, pending, private or publish, not '$status'" );
	}

	$content = '';
	foreach ( array_slice( $args, 4 ) as $i => $chunk ) {
		$part = base64_decode( $chunk, true );
		if ( false === $part ) {
			WP_CLI::error( sprintf( 'chunk %d is not valid base64', $i + 1 ) );
		}
		$content .= $part;
	}
	if ( '' === $content || ! mb_check_encoding( $content, 'UTF-8' ) ) {
		WP_CLI::error( 'the decoded content is empty or not UTF-8' );
	}

	$existing = get_posts(
		array(
			'name'             => $slug,
			'post_type'        => 'post',
			'post_status'      => 'any',
			'numberposts'      => 1,
			'suppress_filters' => true,
		)
	);
	$id = $existing ? (int) $existing[0]->ID : 0;

	$author = isset( $assoc['author'] ) ? (int) $assoc['author'] : ( $id ? (int) $existing[0]->post_author : 1 );
	if ( ! get_userdata( $author ) ) {
		WP_CLI::error( "no user with ID $author" );
	}
	// Run as the author, so block markup is saved as written when they may post unfiltered HTML.
	wp_set_current_user( $author );

	$postarr = array(
		'ID'           => $id,
		'post_type'    => 'post',
		'post_name'    => $slug,
		'post_title'   => $title,
		'post_excerpt' => $excerpt,
		'post_status'  => $status,
		'post_author'  => $author,
		'post_content' => $content,
	);
	$result = $id ? wp_update_post( wp_slash( $postarr ), true ) : wp_insert_post( wp_slash( $postarr ), true );
	if ( is_wp_error( $result ) ) {
		WP_CLI::error( $result );
	}
	$saved = get_post( $result );
	if ( ! $saved || $saved->post_name !== $slug ) {
		WP_CLI::error( sprintf( 'post %d was saved with slug %s, not %s', $result, $saved ? $saved->post_name : '?', $slug ) );
	}
	WP_CLI::success( sprintf( '%s post %d (%s, %d bytes).', $id ? 'Updated' : 'Created', $result, $status, strlen( $content ) ) );
}

WP_CLI::add_command( 'lwr-blog put', 'lwr_blog_cli_put' );
