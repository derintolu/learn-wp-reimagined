<?php
/**
 * Plugin Name: LWR Blog CLI
 * Description: `wp lwr-blog put`: creates or updates a blog post by slug from base64 chunks, because a remote WP-CLI argument holds at most 4,096 characters.
 * Version: 0.1.0
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
